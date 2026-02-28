---
title: "Ultra-Low-Power Harvesting Budgets"
weight: 40
---

# Ultra-Low-Power Harvesting Budgets

An energy harvesting system achieves indefinite operation only when the energy harvested over every relevant time period (day, week, worst-case month) equals or exceeds the energy consumed. This energy balance equation governs every design decision — panel size, storage capacity, duty cycle, and transmit strategy. Violating the balance even slightly causes the storage element to trend toward depletion, eventually crossing the undervoltage threshold and shutting the system down. Building a reliable harvesting budget requires quantifying both sides of the equation with realistic numbers, accounting for seasonal variation, weather, component degradation, and the gap between datasheet values and field measurements.

The fundamental challenge is that harvested energy is intermittent and variable while the system's minimum functionality requirements are fixed. A BLE sensor node that must transmit every 60 seconds cannot reduce its duty cycle just because it is cloudy — but it can defer non-critical tasks, reduce transmit power, or skip redundant readings when stored energy is low.

## The Energy Balance Equation

```
E_harvested_per_day >= E_consumed_per_day

Where:
  E_harvested = P_panel * eta_harvester * T_light * k_margin
  E_consumed  = (P_active * T_active + P_sleep * T_sleep) * N_cycles_per_day
                + E_overhead

  P_panel        = panel output power at actual deployment illumination
  eta_harvester  = harvesting IC efficiency (typically 0.70 - 0.90)
  T_light        = hours of usable illumination per day
  k_margin       = derating factor for dust, aging, angle (typically 0.5 - 0.8)
  P_active       = system power during active phase
  P_sleep        = system power during sleep phase
  T_active       = active phase duration per cycle
  T_sleep        = sleep phase duration per cycle
  N_cycles_per_day = number of wake-sleep cycles per day
  E_overhead     = harvester Iq, supercap leakage, voltage regulator Iq
```

## Calculating Available Harvested Energy

The available energy from a solar panel depends on the deployment environment:

**Outdoor deployment example — 70mm x 55mm panel in temperate climate:**

| Season | Peak sun hours | Panel Pmax at peak | Daily energy (raw) | After losses (x0.7) |
|--------|---------------|-------------------|-------------------|---------------------|
| Summer | 5.5 hours | 100mW | 1980 J | 1386 J |
| Spring/Fall | 3.5 hours | 80mW | 1008 J | 706 J |
| Winter | 1.5 hours | 60mW | 324 J | 227 J |

"Peak sun hours" represents the equivalent number of hours at 1000 W/m^2 that produces the same total daily irradiation. The 0.7 derating accounts for harvester efficiency (85%), panel angle losses (90%), and dust/aging (92%): 0.85 x 0.90 x 0.92 = 0.70.

**Indoor deployment example — 50mm x 50mm amorphous Si panel, office environment:**

| Condition | Illumination | Panel power | Hours/day | Daily energy (raw) | After losses (x0.75) |
|-----------|-------------|-------------|-----------|-------------------|----------------------|
| Weekday, lights on | 300 lux | 100uW | 10 | 3.6 J | 2.7 J |
| Weekday, dim | 100 lux | 25uW | 4 | 0.36 J | 0.27 J |
| Weekend/holiday | 10 lux | 1uW | 24 | 0.086 J | 0.065 J |

Indoor harvesting produces orders of magnitude less energy than outdoor. A system that consumes 50uW average and harvests 100uW for 10 hours per day seems balanced — but weekends and holidays with nearly zero harvesting create multi-day deficits that the storage element must bridge.

## BLE Sensor Node Power Budget

A concrete example using the Nordic nRF52832 as the MCU and radio:

```
System states and power consumption:

State               Duration    Current at 3.0V    Energy
-----------         --------    ---------------    ------
Deep sleep (RTC on) 59.970s     1.9uA              0.342 mJ
Wake + sensor read  5ms         4.0mA              0.060 mJ
BLE advertise TX    3ms         11.0mA (0dBm)      0.099 mJ
Radio ramp + settle 2ms         8.0mA              0.048 mJ
Post-TX processing  5ms         4.0mA              0.060 mJ
Return to sleep     0.023s      4.0mA              0.000 mJ
                    --------                       ---------
Total per 60s cycle 60.000s                        0.609 mJ

Average power = 0.609mJ / 60s = 10.15uW
Average current at 3.0V = 3.38uA
```

**Daily energy consumption:**
```
E_system = 10.15uW * 86,400s = 877 mJ/day

Add overhead:
  Harvester Iq:     488nA * 3.0V * 86400s = 126 mJ/day
  Supercap leakage: ~3uA * 3.0V * 86400s = 778 mJ/day (steady-state)
  LDO Iq:           500nA * 3.0V * 86400s = 130 mJ/day

Total daily consumption: 877 + 126 + 778 + 130 = 1911 mJ/day
```

The supercapacitor leakage dominates the overhead budget, consuming more energy than the MCU and radio combined. This is a common and often overlooked finding in harvesting budget calculations.

## Minimum Panel Size for Indefinite Operation

Working backward from the daily energy requirement to determine the minimum panel:

```
Required harvest: 1911 mJ/day = 1.911 J/day

Outdoor (winter worst case, 1.5 peak sun hours):
  P_panel_min = E_daily / (T_light * 3600 * eta)
  P_panel_min = 1.911 / (1.5 * 3600 * 0.70) = 0.506 mW

  A 25mm x 25mm monocrystalline panel producing 22mW at peak sun
  delivers 0.506mW on average during winter — marginally sufficient.
  Panel utilization: 0.506mW / 22mW = 2.3% of peak rating.

Indoor (weekday, 300 lux, 10 hours):
  P_panel_min = E_daily / (T_light * 3600 * eta)
  P_panel_min = 1.911 / (10 * 3600 * 0.75) = 70.8uW

  A 50mm x 50mm amorphous panel producing ~100uW at 300 lux
  provides 70.8uW after losses — barely sufficient on weekdays.

Indoor (weekend — near zero harvest):
  The system must survive on stored energy alone.
  For a 60-hour weekend: E_bridge = 1911mJ/day * 2.5 days = 4778 mJ

  Required supercap (3.0V to 2.0V swing):
    C = 2 * E / (V_max^2 - V_min^2)
    C = 2 * 4.778 / (9.0 - 4.0) = 1.91F
    A 2.0F or 2.2F supercapacitor covers the weekend bridge.
```

## Seasonal and Weather Variation

Designing for average conditions guarantees failure during worst-case periods. The critical design parameter is the worst-case month — typically December or January in the Northern Hemisphere:

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Winter solstice | 2–4x reduction in daily solar energy vs summer | Size panel and storage for December |
| Consecutive cloudy days | 3–7 days at 10–30% of clear-sky irradiance | Storage sized for 5+ day bridge |
| Snow/ice coverage | 100% power loss until cleared | Mounting angle >45 deg for self-clearing |
| Dust/pollen accumulation | 5–15% annual degradation | Annual cleaning or oversized panel |
| Panel aging | 0.5–1% efficiency loss per year | 10-year derating factor of 0.90 |

For a 10-year deployment in a temperate outdoor environment, a conservative derating stack:

```
k_total = k_winter * k_cloudy * k_dust * k_aging
k_total = 0.40 * 0.30 * 0.85 * 0.90 = 0.092

This means the panel must be sized ~11x larger than the average-case
calculation suggests to guarantee operation during the worst week of
the worst month in year 10.
```

## Energy Storage Sizing for Extended Dark Periods

The storage element must bridge the longest expected period without sufficient harvesting:

```
Outdoor system: Bridge 5 consecutive cloudy winter days
  E_bridge = 1.911 J/day * 5 days = 9.56 J

  Supercapacitor option (3.0V to 2.0V, including leakage overhead):
    Leakage adds ~30% to energy requirement over 5 days
    E_total = 9.56 * 1.3 = 12.4 J
    C = 2 * 12.4 / (9.0 - 4.0) = 4.96F --> use 5.0F or 5.5F

  Battery option (LIR2032, 40mAh at 3.7V):
    Battery energy: 40mAh * 3.7V * 3.6 = 532 J
    5-day requirement: 12.4 J
    Battery utilization: 2.3% — massive margin for bridging
    But: only 300-500 cycles vs >500,000 for supercap
```

For outdoor systems with multi-day bridge requirements, a small rechargeable battery often makes more practical sense than a very large (and physically large) supercapacitor. The supercap-only approach works best when bridge times are measured in hours rather than days.

## Power Management Firmware Patterns

Firmware can actively manage the energy budget by adapting behavior to the available stored energy:

### Check-Before-Transmit Pattern

```c
// Read supercapacitor voltage via ADC before transmitting
uint16_t vstor_mv = adc_read_vstor();

if (vstor_mv >= VSTOR_TX_THRESHOLD_MV) {
    // Sufficient energy for full TX cycle
    sensor_read();
    ble_advertise(TX_POWER_0DBM);
} else if (vstor_mv >= VSTOR_MIN_THRESHOLD_MV) {
    // Low energy: read sensor, store locally, skip TX
    sensor_read();
    flash_store_reading();
    // Transmit stored readings in bulk when energy recovers
} else {
    // Critical energy: do nothing, return to sleep immediately
    // Preserving storage for RTC and RAM retention
}
```

### Adaptive Duty Cycle Pattern

```c
#define INTERVAL_NORMAL_S     60    // 1-minute cycle when energy is good
#define INTERVAL_ECO_S       300    // 5-minute cycle when energy is low
#define INTERVAL_SURVIVAL_S  3600   // 1-hour cycle when energy is critical

#define VSTOR_NORMAL_MV      2800   // Above 2.8V: normal operation
#define VSTOR_ECO_MV         2400   // 2.4V-2.8V: economy mode
#define VSTOR_SURVIVAL_MV    2100   // 2.1V-2.4V: survival mode
                                     // Below 2.1V: harvester UV shuts system down

uint32_t get_next_wake_interval(uint16_t vstor_mv) {
    if (vstor_mv >= VSTOR_NORMAL_MV) {
        return INTERVAL_NORMAL_S;
    } else if (vstor_mv >= VSTOR_ECO_MV) {
        return INTERVAL_ECO_S;
    } else if (vstor_mv >= VSTOR_SURVIVAL_MV) {
        return INTERVAL_SURVIVAL_S;
    } else {
        // Should not reach here — UV threshold shuts down first
        return INTERVAL_SURVIVAL_S;
    }
}
```

### Opportunistic Burst Transmit Pattern

```c
// Accumulate readings during low-energy periods
// Burst-transmit when energy is abundant

#define READINGS_BUFFER_SIZE  64
static sensor_reading_t readings[READINGS_BUFFER_SIZE];
static uint8_t reading_count = 0;

void duty_cycle_handler(void) {
    sensor_reading_t reading = sensor_read();
    readings[reading_count++] = reading;

    uint16_t vstor_mv = adc_read_vstor();

    if (vstor_mv >= VSTOR_BURST_THRESHOLD_MV && reading_count >= 4) {
        // Energy is abundant: transmit all buffered readings
        ble_transmit_bulk(readings, reading_count);
        reading_count = 0;
    } else if (reading_count >= READINGS_BUFFER_SIZE) {
        // Buffer full: must transmit regardless of energy state
        ble_transmit_bulk(readings, reading_count);
        reading_count = 0;
    }
    // Otherwise: store reading, skip TX, save energy
}
```

## Achieving Indefinite Operation: Complete Analysis

Bringing all factors together for a concrete design:

```
Target: BLE temperature/humidity sensor, indefinite outdoor operation
Location: 52 deg N latitude (e.g., London, Berlin)
MCU: nRF52832
Sensor: Sensirion SHT40 (1ms measurement, 300uA active)
Radio: BLE advertising, 0dBm, 60-second interval
Storage: 2.2F supercapacitor at 3.0V + LIR2032 backup
Panel: 70mm x 55mm Panasonic AM-1815CA

Energy consumption:
  Average system power: 10.15uW (as calculated above)
  Harvester + regulator overhead: 4.22uW
  Supercap leakage (steady-state): 9.0uW
  Total average: 23.4uW

Harvesting (worst-case December at 52 deg N):
  Peak sun hours: 0.8 hours/day
  Panel output at peak: 100mW
  Effective daily harvest: 100mW * 0.8h * 3600 * 0.70 = 201.6 J
  Daily consumption: 23.4uW * 86400 = 2.02 J
  Margin: 201.6 / 2.02 = 99.8x — massive surplus even in worst case

Harvesting (worst-case: 5 cloudy days at 10% irradiance):
  5-day harvest: 201.6 * 0.10 * 5 = 100.8 J
  5-day consumption: 2.02 * 5 = 10.1 J
  Net energy: +90.7 J — still positive

Bridge time on supercap alone (no harvest):
  E_usable = 0.5 * 2.2 * (3.0^2 - 2.0^2) = 5.5 J
  Bridge time = 5.5 / (23.4e-6) = 235,043 seconds = 2.72 days

Bridge time with LIR2032 backup:
  Battery energy: 532 J (at 40mAh)
  Bridge time = 532 / 23.4e-6 = 22.7 million seconds = 263 days
  But battery cycle life limits this to ~400 deep discharge events

Conclusion: This system operates indefinitely in outdoor temperate
climates with generous margin. The supercap bridges 2.7 days alone;
the LIR2032 provides seasonal insurance for extended dark periods.
```

## Comparison of Energy Sources

Solar is the most common but not the only harvesting source. Power density varies by orders of magnitude:

| Energy Source | Typical Power Density | Typical Voltage | Best Application |
|-------------- |----------------------|-----------------|-----------------|
| Outdoor solar (direct) | 10–100 mW/cm^2 | 0.5–0.6V per cell | Outdoor sensors, trackers |
| Outdoor solar (cloudy) | 1–10 mW/cm^2 | 0.4–0.5V per cell | Outdoor with oversized panel |
| Indoor solar (office) | 10–100 uW/cm^2 | 0.3–0.5V per cell | Building automation, smart tags |
| Thermal (TEG, 10 deg C dT) | 1–10 mW/cm^2 | 20–100mV | Industrial monitoring, body heat |
| Thermal (TEG, 2 deg C dT) | 10–50 uW/cm^2 | 5–20mV | HVAC duct monitoring |
| Vibration (piezo, machine) | 100–500 uW/cm^3 | 2–20V AC | Motor/pump monitoring |
| Vibration (piezo, human) | 1–10 uW/cm^3 | 1–5V AC | Wearables (limited) |
| RF (WiFi ambient) | 0.001–1 uW/cm^2 | 0.1–0.5V DC | Very low power only |
| RF (dedicated 915MHz TX) | 1–100 uW/cm^2 at 1m | 0.5–2V DC | Wireless power transfer |

TEGs (thermoelectric generators) produce very low voltages, requiring harvester ICs with sub-100mV minimum operating voltage (AEM10941 at 50mV, or specialized TEG harvesters like the LTC3108 at 20mV). Piezoelectric sources produce high AC voltages that need rectification before the harvesting IC — the LTC3588-1 integrates a full-bridge rectifier specifically for piezo sources.

RF energy harvesting (rectennas) produces the least power of any source and is viable only for systems consuming under 1uW average or for systems placed near a dedicated RF transmitter. The Powercast P2110B reference design harvests from a dedicated 915MHz transmitter and provides approximately 50uW at 1 meter range.

## Tips

- Always calculate the energy budget for the worst-case month, not the annual average — a system that balances on average fails during winter if storage cannot bridge the deficit
- Include supercapacitor leakage in the consumption budget from the start; it is often the largest single consumer in a nano-power system, especially with new or large-value capacitors
- Monitor VSTOR voltage in firmware and log it over time; trending data reveals whether the system is gaining or losing energy on a daily basis, catching slow imbalances before they cause failure
- Design the firmware with at least three power modes (normal, economy, survival) so the system degrades gracefully rather than operating normally until sudden death

## Caveats

- **Average power calculations hide peak power requirements** — A system averaging 10uW still needs milliamps during active phases; the storage element must supply these peaks without excessive voltage droop, regardless of how low the average is
- **Harvester efficiency drops at very low input power** — The BQ25570's boost converter efficiency falls from 90% at 1mW input to 70% at 10uW input; the efficiency number in the budget calculation should match the actual operating point, not the peak datasheet value
- **Supercapacitor leakage is temperature-dependent** — Leakage roughly doubles for every 10 degrees C above 25 degrees C; a system deployed in a sun-heated outdoor enclosure at 60 degrees C may see 8x the leakage assumed from 25 degrees C bench testing
- **Battery backup does not mean infinite life** — A LIR2032 used as a seasonal buffer might cycle 50–100 times per year; at 400 cycle life, it needs replacement every 4–8 years, adding maintenance cost to a nominally "deploy and forget" system

## In Practice

- A smart agriculture sensor network deployed across 200 nodes in Northern Europe achieves 98% uptime over three years by sizing panels for December worst-case and including a 100mAh LiPo backup — the 2% downtime traces to four nodes placed under dense canopy where winter light levels drop below the cold-start threshold even with oversized panels
- An indoor air quality monitor designed for office deployment survives weekdays comfortably but fails every Monday morning after long weekends — the fix involves increasing the supercapacitor from 0.47F to 2.2F and adding a survival-mode firmware state that stretches the duty cycle to 10 minutes during detected darkness
- A bridge health monitoring system using piezoelectric vibration harvesting collects 200uW from highway traffic during the day but nothing at night — the 3.3F supercap bridge lasts through quiet nighttime hours but depletes during consecutive holiday weekends with minimal traffic; adding a small solar panel as a secondary source eliminates the problem
- A wearable medical patch harvesting from body heat via a 20mm x 20mm TEG produces only 30uW from the typical 5 degree C skin-to-ambient gradient, but the BLE beacon averages 12uW — sufficient in theory, yet field failures occur when ambient temperature exceeds 30 degrees C and the gradient shrinks to 2 degrees C, collapsing TEG output to 5uW; a seasonal firmware profile that increases the advertising interval during summer months restores energy balance
