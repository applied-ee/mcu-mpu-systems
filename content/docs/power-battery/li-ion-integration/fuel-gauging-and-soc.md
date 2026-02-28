---
title: "Fuel Gauging & SOC"
weight: 40
---

# Fuel Gauging & SOC

Reporting battery state of charge (SOC) to a user — as a percentage, a bar graph, or a runtime estimate — requires translating raw electrochemical measurements into a meaningful number. The fundamental challenge is that no single measurement directly reveals how much energy remains in a lithium-ion cell. Voltage correlates with SOC but nonlinearly and with heavy dependence on load current and temperature. Current integration (Coulomb counting) tracks charge flow precisely but accumulates drift errors over time. Production fuel gauge ICs combine both methods with impedance tracking and learned cell models to achieve 1–3% accuracy, but even simple firmware-only approaches can produce usable results with appropriate calibration.

## Voltage-Based SOC Estimation

The simplest approach maps the cell's open-circuit voltage (OCV) to a state-of-charge percentage using a lookup table. The OCV-SOC relationship for a standard LCO/LiPo cell follows a characteristic S-curve:

| OCV (V) | SOC (%) | Region |
|---------|---------|--------|
| 4.20 | 100 | Fully charged |
| 4.10 | 90 | Upper plateau |
| 4.00 | 78 | Upper plateau |
| 3.90 | 65 | Mid-range |
| 3.80 | 52 | Mid-range (flattest region) |
| 3.70 | 38 | Mid-range |
| 3.60 | 22 | Lower knee |
| 3.50 | 12 | Lower knee |
| 3.40 | 5 | Near empty |
| 3.30 | 2 | Critical |
| 3.00 | 0 | Cutoff |

**Critical requirement**: This table is only valid for open-circuit voltage — the cell must be at rest (no load) for at least 30 minutes to allow the voltage to settle to its equilibrium value. Under load, the terminal voltage drops by I * R_internal, and the electrochemical relaxation effects add further transient voltage depression. Reading the voltage while the system draws 500 mA from a cell with 50-milliohm internal resistance produces a 25 mV error — enough to shift the SOC estimate by 5–10% in the flat mid-range region.

**Nonlinearity problem**: Between 3.6V and 3.9V (roughly 20–65% SOC), the OCV curve is nearly flat. A 100 mV change in this region represents a 40% change in SOC. Any voltage measurement error — ADC quantization, resistor divider tolerance, load-induced sag — maps to a large SOC error in this region. Below 3.5V and above 4.0V, the curve steepens, and voltage-to-SOC mapping becomes more accurate.

**Firmware implementation** for a basic voltage-based SOC estimate:

```c
/* OCV-SOC lookup table for standard LCO/LiPo cell */
typedef struct {
    uint16_t voltage_mv;  /* Open-circuit voltage in millivolts */
    uint8_t  soc_pct;     /* State of charge percentage */
} ocv_soc_entry_t;

static const ocv_soc_entry_t ocv_table[] = {
    { 4200, 100 },
    { 4150,  95 },
    { 4100,  90 },
    { 4050,  84 },
    { 4000,  78 },
    { 3950,  72 },
    { 3900,  65 },
    { 3850,  58 },
    { 3800,  52 },
    { 3750,  45 },
    { 3700,  38 },
    { 3650,  30 },
    { 3600,  22 },
    { 3550,  16 },
    { 3500,  12 },
    { 3450,   8 },
    { 3400,   5 },
    { 3350,   3 },
    { 3300,   2 },
    { 3200,   1 },
    { 3000,   0 },
};

#define OCV_TABLE_SIZE (sizeof(ocv_table) / sizeof(ocv_table[0]))

/**
 * Linear interpolation between two OCV-SOC table entries.
 * Requires voltage_mv to be between table bounds.
 */
uint8_t ocv_to_soc(uint16_t voltage_mv) {
    if (voltage_mv >= ocv_table[0].voltage_mv)
        return 100;
    if (voltage_mv <= ocv_table[OCV_TABLE_SIZE - 1].voltage_mv)
        return 0;

    for (uint8_t i = 0; i < OCV_TABLE_SIZE - 1; i++) {
        if (voltage_mv >= ocv_table[i + 1].voltage_mv) {
            /* Linear interpolation between table[i] and table[i+1] */
            uint16_t v_high = ocv_table[i].voltage_mv;
            uint16_t v_low  = ocv_table[i + 1].voltage_mv;
            uint8_t  s_high = ocv_table[i].soc_pct;
            uint8_t  s_low  = ocv_table[i + 1].soc_pct;

            uint16_t dv = v_high - v_low;
            uint16_t ds = s_high - s_low;
            uint16_t offset = voltage_mv - v_low;

            return s_low + (uint8_t)((offset * ds + dv / 2) / dv);
        }
    }
    return 0;
}
```

This lookup table approach works acceptably for systems that spend most of their time in sleep mode (where the "no load" requirement is approximately satisfied) or that can defer SOC reporting until after a rest period.

## Coulomb Counting

Coulomb counting integrates the current flowing into and out of the cell over time to track the net charge transferred. Starting from a known reference point (typically 100% after a full charge), the accumulated charge is subtracted from the known full capacity to produce a running SOC estimate.

The fundamental equation is:

```
SOC(t) = SOC(t0) - (1 / Q_full) * integral(I(t) dt, t0, t)
```

Where Q_full is the cell's full capacity in coulombs (or milliamp-hours), and I(t) is the instantaneous current (positive for discharge, negative for charge).

**Advantages over voltage-based methods**: Coulomb counting works under load, responds immediately to current changes, and maintains accuracy in the flat mid-range voltage region where voltage-based methods fail.

**Disadvantages**: Every current measurement has a small error, and these errors accumulate over time. A 1% current measurement error, integrated over 100 hours of operation, produces a 1% SOC drift. After many charge-discharge cycles without recalibration, the accumulated error can reach 10–20%. Additionally, Coulomb counting requires a known starting point — if the system loses power or resets, the SOC reference is lost.

## BQ27441 Gas Gauge IC

The Texas Instruments BQ27441-G1 is a single-cell fuel gauge IC that combines Coulomb counting with voltage-based correction, providing a self-calibrating SOC estimate over I2C. It uses TI's patented Impedance Track algorithm to model the cell's internal impedance and predict remaining capacity under the actual load conditions.

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Supply voltage | 2.6V to 4.5V (powered directly from cell) |
| Interface | I2C, 7-bit address 0x55 |
| Sense resistor | External, 10 milliohms typical |
| Current measurement range | -5A to +5A (at 10 milliohm sense) |
| Voltage measurement accuracy | +/- 10 mV |
| SOC reporting accuracy | +/- 1% after learning cycle |
| Quiescent current | 65 uA typical (normal mode), 1 uA (hibernate) |
| Package | 12-pin DSBGA (1.62mm x 1.58mm) |

**Connection diagram:**

```
         Cell+
          │
          ├────── VCC (BQ27441)
          │
          ├────── BAT (BQ27441) ── to charger/load positive
          │
          │              ┌──────────┐
          │              │ BQ27441  │
          │    SDA ──────│          │────── GPOUT (interrupt/alert)
          │    SCL ──────│          │
          │              └────┬─────┘
          │                   │ SRN/SRP
          │                   │
          │              ┌────┴────┐
          │              │ 10mΩ    │ Sense resistor
          │              │ (0805)  │
          │              └────┬────┘
          │                   │
         Cell- ───────────────┘
```

The sense resistor (typically 10 milliohms, 1% tolerance, 0.5W or higher) sits in the ground path between the cell negative terminal and the system ground. The BQ27441 measures the voltage across this resistor to determine current flow. A 10-milliohm resistor produces 10 mV at 1A, well within the BQ27441's measurement resolution.

## BQ27441 Register Map

The BQ27441 exposes battery status through a set of I2C-readable registers. All multi-byte values are little-endian (LSB first).

| Register | Address | Size | Unit | Description |
|----------|---------|------|------|-------------|
| Control | 0x00 | 2 bytes | — | Command/status register |
| Temperature | 0x02 | 2 bytes | 0.1 K | Internal temperature (or external if configured) |
| Voltage | 0x04 | 2 bytes | mV | Cell voltage |
| Flags | 0x06 | 2 bytes | — | Status flags (see below) |
| NominalAvailableCapacity | 0x08 | 2 bytes | mAh | Uncompensated remaining capacity |
| FullAvailableCapacity | 0x0A | 2 bytes | mAh | Compensated remaining capacity |
| RemainingCapacity | 0x0C | 2 bytes | mAh | Remaining capacity at current discharge rate |
| FullChargeCapacity | 0x0E | 2 bytes | mAh | Learned full charge capacity |
| AverageCurrent | 0x10 | 2 bytes | mA | Signed average current (negative = discharge) |
| StandbyCurrent | 0x12 | 2 bytes | mA | Standby current estimate |
| MaxLoadCurrent | 0x14 | 2 bytes | mA | Maximum load current estimate |
| AveragePower | 0x18 | 2 bytes | mW | Average power |
| StateOfCharge | 0x1C | 2 bytes | % | Filtered state of charge (0–100) |
| InternalTemperature | 0x1E | 2 bytes | 0.1 K | Die temperature |
| StateOfHealth | 0x20 | 2 bytes | % | State of health (percentage of design capacity) |
| RemainingCapacityUnfiltered | 0x28 | 2 bytes | mAh | Unfiltered remaining capacity |
| RemainingCapacityFiltered | 0x2A | 2 bytes | mAh | Filtered remaining capacity |
| FullChargeCapacityUnfiltered | 0x2C | 2 bytes | mAh | Unfiltered full charge capacity |
| FullChargeCapacityFiltered | 0x2E | 2 bytes | mAh | Filtered full charge capacity |
| StateOfChargeUnfiltered | 0x30 | 2 bytes | % | Unfiltered SOC |

**Flags register (0x06) bit definitions:**

| Bit | Name | Meaning |
|-----|------|---------|
| 15 | OT | Over-temperature condition detected |
| 14 | UT | Under-temperature condition detected |
| 9 | FC | Full charge detected |
| 8 | CHG | Charge in progress (current flowing into cell) |
| 4 | SOC1 | SOC threshold 1 crossed (configurable, default 15%) |
| 2 | SOCF | SOC Final threshold crossed (configurable, default 2%) |
| 1 | ITPOR | POR (power-on reset) occurred; gauge needs initialization |
| 0 | DSG | Discharging detected |

## Firmware Interface Pattern

Reading battery data from the BQ27441 over I2C follows a standard register-read pattern. The following example demonstrates initialization and periodic SOC polling:

```c
#include <stdint.h>
#include <stdbool.h>

#define BQ27441_ADDR          0x55

/* Standard registers */
#define BQ27441_VOLTAGE       0x04
#define BQ27441_FLAGS         0x06
#define BQ27441_REM_CAP       0x0C
#define BQ27441_FULL_CAP      0x0E
#define BQ27441_AVG_CURRENT   0x10
#define BQ27441_SOC           0x1C
#define BQ27441_SOH           0x20

/* Control subcommands (write to 0x00/0x01) */
#define BQ27441_CTRL_DEVICE_TYPE   0x0001
#define BQ27441_CTRL_FW_VERSION    0x0002
#define BQ27441_CTRL_SET_CFGUPDATE 0x0013
#define BQ27441_CTRL_SOFT_RESET    0x0042

/**
 * Read a 16-bit register from the BQ27441.
 * Returns value in host byte order.
 */
static uint16_t bq27441_read_reg(uint8_t reg) {
    uint8_t buf[2];
    i2c_write(BQ27441_ADDR, &reg, 1);
    i2c_read(BQ27441_ADDR, buf, 2);
    return (uint16_t)(buf[1] << 8) | buf[0];  /* Little-endian */
}

/**
 * Write a 16-bit control subcommand.
 */
static void bq27441_ctrl_cmd(uint16_t subcmd) {
    uint8_t buf[3];
    buf[0] = 0x00;                    /* Control register */
    buf[1] = (uint8_t)(subcmd);       /* LSB */
    buf[2] = (uint8_t)(subcmd >> 8);  /* MSB */
    i2c_write(BQ27441_ADDR, buf, 3);
}

/**
 * Verify BQ27441 is present on the bus.
 * Device type should read 0x0421.
 */
bool bq27441_verify(void) {
    bq27441_ctrl_cmd(BQ27441_CTRL_DEVICE_TYPE);
    delay_ms(1);
    uint16_t dev_type = bq27441_read_reg(0x00);
    return (dev_type == 0x0421);
}

typedef struct {
    uint16_t voltage_mv;
    int16_t  current_ma;    /* Negative = discharging */
    uint16_t soc_pct;
    uint16_t soh_pct;
    uint16_t remaining_mah;
    uint16_t full_cap_mah;
    uint16_t flags;
} bq27441_data_t;

/**
 * Read all commonly needed battery parameters in one call.
 */
void bq27441_read_all(bq27441_data_t *data) {
    data->voltage_mv   = bq27441_read_reg(BQ27441_VOLTAGE);
    data->current_ma   = (int16_t)bq27441_read_reg(BQ27441_AVG_CURRENT);
    data->soc_pct      = bq27441_read_reg(BQ27441_SOC);
    data->soh_pct      = bq27441_read_reg(BQ27441_SOH);
    data->remaining_mah = bq27441_read_reg(BQ27441_REM_CAP);
    data->full_cap_mah = bq27441_read_reg(BQ27441_FULL_CAP);
    data->flags        = bq27441_read_reg(BQ27441_FLAGS);
}
```

**Initialization sequence**: On first power-up, the BQ27441 needs to be configured with the cell's design capacity. This involves entering configuration update mode, writing the design capacity (in mAh), design energy (in mWh), and terminate voltage (in mV) to the data memory, then exiting configuration mode. The ITPOR flag in the Flags register indicates whether a POR has occurred, signaling that reconfiguration may be needed.

## SOC Reporting Smoothing

Raw SOC values — whether from voltage lookup or Coulomb counting — tend to fluctuate with load transients, temperature changes, and measurement noise. Displaying these raw values to a user creates a poor experience: the battery indicator jumps between 45% and 52% as the load varies, or drops from 15% to 8% when the radio transmits.

The BQ27441 provides both filtered (StateOfCharge, 0x1C) and unfiltered (StateOfChargeUnfiltered, 0x30) SOC values. The filtered value applies an internal smoothing algorithm that prevents large step changes and ensures the reported SOC decreases monotonically during discharge (no temporary increases due to load removal or temperature changes).

For systems implementing SOC in firmware without a dedicated gauge IC, a simple exponential moving average provides effective smoothing:

```c
static uint16_t smoothed_soc = 0;  /* Scaled by 256 for fixed-point precision */
static bool     soc_initialized = false;

/**
 * Update smoothed SOC with a new raw reading.
 * Alpha = 4/256 (~1.5%) gives a time constant of ~64 samples.
 * At 1 sample per minute, this smooths over approximately 1 hour.
 */
uint8_t update_smoothed_soc(uint8_t raw_soc) {
    if (!soc_initialized) {
        smoothed_soc = (uint16_t)raw_soc << 8;
        soc_initialized = true;
        return raw_soc;
    }

    /* Exponential moving average: new = old + alpha * (raw - old) */
    int16_t error = ((int16_t)raw_soc << 8) - (int16_t)smoothed_soc;
    smoothed_soc += error >> 6;  /* alpha = 1/64 */

    return (uint8_t)(smoothed_soc >> 8);
}
```

Additional smoothing strategies used in production firmware:
- **Monotonic enforcement**: During discharge, never report a SOC higher than the previous reported value. During charging, never report lower. This prevents the displayed percentage from bouncing up and down.
- **Rate limiting**: Limit SOC changes to at most 1% per minute. Large step changes (from load transients or recalibration events) are spread over several reporting intervals.
- **Endpoint locking**: When the cell voltage reaches 4.2V during charging, force the reported SOC to 100%. When the voltage drops below the cutoff threshold, force 0%. This ensures the endpoints are always correct, even if the intermediate tracking has accumulated error.

## Impedance Tracking

The BQ27441's Impedance Track algorithm goes beyond simple Coulomb counting by continuously modeling the cell's internal impedance. This model accounts for:

- **Ohmic resistance (R0)**: The immediate voltage drop proportional to current, corresponding to contact resistance, electrolyte ionic resistance, and electrode electronic resistance. Typically 20–80 milliohms for an 18650 cell.
- **Charge-transfer resistance (Rct)**: The electrochemical reaction resistance at the electrode-electrolyte interface. This component has a time constant in the seconds range and depends on SOC and temperature.
- **Diffusion impedance (Zw)**: The Warburg impedance representing lithium-ion diffusion through the electrode material. This component has a time constant of minutes and becomes dominant at low SOC and low temperature.

By tracking how the cell voltage responds to load changes over time, the BQ27441 separates these impedance components and builds a model that predicts the cell's voltage at any given current and SOC. This allows the gauge to report "remaining capacity at the current discharge rate" — accounting for the fact that a high-drain application will hit the cutoff voltage sooner than a low-drain one, even at the same SOC.

The impedance model also enables State of Health (SOH) reporting. As a cell ages, its impedance increases and its full charge capacity decreases. The BQ27441's SOH register (0x20) reports the ratio of the current full charge capacity to the design capacity, expressed as a percentage. A new cell reads 100%; after 300 cycles, a typical LCO cell reads 80–85%.

## Combining Voltage and Coulomb Counting

Production-grade SOC estimation uses voltage readings to calibrate Coulomb counting, correcting the accumulated integration error at known reference points:

1. **Full-charge calibration**: When the charger terminates (cell at 4.2V, current below C/10), reset the Coulomb counter to 100%. This eliminates all accumulated error.
2. **Empty calibration**: When the cell voltage reaches the cutoff threshold under load, reset to 0%. This corrects any downward drift.
3. **OCV correction during rest**: When the system enters sleep mode and the cell has been at rest for more than 30 minutes, compare the OCV-based SOC estimate with the Coulomb counter value. If they differ by more than 5%, gradually blend the Coulomb counter toward the OCV estimate.

This hybrid approach yields the best of both methods: Coulomb counting provides smooth, responsive tracking during active use, while voltage-based correction prevents long-term drift and re-establishes accuracy after power loss or reset.

## Tips

- Configure the BQ27441's design capacity to match the actual cell being used, not the nominal datasheet value — an over-specified capacity causes the gauge to report SOC values that are consistently too optimistic
- Place the 10-milliohm sense resistor as close to the BQ27441's SRP/SRN pins as possible, and route the sense traces as a Kelvin pair directly to the resistor pads — trace resistance in the sense path introduces a fixed offset error in current measurement
- Allow 2–3 full charge-discharge cycles after initial configuration for the Impedance Track algorithm to learn the cell's characteristics — SOC accuracy during the first few cycles may be off by 5–10%
- For voltage-only SOC estimation, take the voltage reading after a minimum 30-second rest period with no load — even brief rest periods improve accuracy compared to reading under active load
- Store the last known SOC and Coulomb counter state in non-volatile memory before entering shutdown — this allows the system to resume tracking after power-on without waiting for a full recalibration event

## Caveats

- **Voltage-based SOC is unreliable between 3.6V and 3.9V** — The OCV curve is nearly flat in this region, and a 10 mV measurement error can translate to a 10–15% SOC error; relying solely on voltage for UI display in this range produces an indicator that jumps erratically
- **Coulomb counting drifts without periodic recalibration** — If the system never fully charges or fully discharges, the Coulomb counter has no reference point to correct against, and accumulated error can reach 15–20% over several weeks
- **The BQ27441 draws 65 uA continuously** — In ultra-low-power systems that sleep at 1–5 uA, the fuel gauge becomes the dominant power consumer; for such systems, a firmware-only approach using periodic ADC voltage readings may be preferable despite lower accuracy
- **Sense resistor tolerance matters** — A 10-milliohm resistor with 5% tolerance (9.5–10.5 milliohms) introduces a 5% current measurement error that directly propagates into Coulomb counting; use 1% tolerance or better
- **Temperature affects both the OCV curve and impedance** — An OCV lookup table calibrated at 25 degrees C produces 5–10% SOC error at 0 degrees C; production systems maintain separate lookup tables for different temperature ranges or apply a temperature correction factor

## In Practice

- A consumer device that shows 50% battery for hours and then drops to 0% in minutes is using voltage-based SOC without Coulomb counting — the flat mid-range OCV curve makes the percentage appear stable until the voltage falls off the lower knee, at which point the remaining 15–20% drains with a steep voltage drop that the display tracks accurately
- A fuel gauge that reads 100% immediately after a fast partial charge (30 minutes on the charger) has likely lost its calibration reference — the Coulomb counter was not reset at a known endpoint, and the OCV reading during charging (which is higher than the actual OCV due to IR drop) fooled the voltage correction into over-estimating SOC
- A BQ27441 that reports 95% SOH on a cell that clearly delivers less than half its original runtime often has an incorrect design capacity configured — if the firmware set 3000 mAh as the design capacity but the actual cell is 2000 mAh, the SOH calculation uses the wrong denominator
- A battery indicator that drops from 20% to 0% during a brief Wi-Fi transmission burst is not smoothing the SOC output — the voltage sag during the 200 mA transmit pulse drops the cell voltage below 3.4V momentarily, and the firmware maps this loaded voltage directly to the OCV-SOC table without accounting for the IR drop
- A system that consistently shows 3–5% remaining capacity when the cell is actually empty has its empty-voltage threshold set too low — raising the cutoff voltage from 3.0V to 3.2V in the gauge configuration aligns the 0% endpoint with the point where the system can no longer operate reliably
