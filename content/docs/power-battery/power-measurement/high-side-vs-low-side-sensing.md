---
title: "High-Side vs Low-Side Sensing"
weight: 20
---

# High-Side vs Low-Side Sensing

The shunt resistor must go somewhere in the current path — either between the supply and the load (high-side) or between the load and ground (low-side). This choice determines the common-mode voltage the measurement circuit must handle, the complexity of the amplifier, and whether the load's ground connection remains undisturbed. Both topologies are widely used, and each has distinct advantages and failure modes.

## Low-Side Sensing

In low-side sensing, the shunt resistor sits between the load's ground return and the system ground plane. The voltage across the shunt is referenced to ground, making it straightforward to measure with a ground-referenced op-amp or a single-ended ADC input.

```
    V_SUPPLY ──────────► LOAD ──────┐
                                     │
                                  ┌──┴──┐
                                  │R_SHUNT│
                                  └──┬──┘
                                     │
                        ┌────────────┤
                        │            │
                     V_SENSE       GND
                   (ground-referenced)
```

The signal voltage at the amplifier input is within a few millivolts of ground, so a standard rail-to-rail op-amp (such as the MCP6001 or OPA340) can amplify it directly. No special common-mode rejection capability is needed, and the circuit works with any single-supply op-amp that can operate near its negative rail.

**The fundamental problem**: the load no longer connects directly to ground. The shunt resistor inserts a small voltage offset (V = I × R_shunt) between the load's ground pin and the true system ground. At 1A through a 100mΩ shunt, the load's ground sits 100mV above system ground. This offset:

- Shifts the load's I/O logic levels by 100mV — usually acceptable for 3.3V logic but problematic for 1.8V signaling
- Disrupts ground-referenced communication buses (UART, SPI, I2C) if other devices on the bus reference a different ground potential
- Makes the load's ground potential vary with current — a load drawing pulsed current creates a time-varying ground offset that appears as noise on every signal referenced to that ground
- Prevents sensing current to multiple loads sharing the same ground path, since the shunt resistance is in the shared return

Low-side sensing is most appropriate for isolated loads with no shared signal connections — for example, measuring the total current drawn by a self-contained sensor module where only the power rail is being monitored.

## High-Side Sensing

In high-side sensing, the shunt resistor sits between the power supply and the load. The load's ground connection remains unbroken, preserving signal integrity on all ground-referenced interfaces.

```
    V_SUPPLY ───┬───┐
                │ ┌─┴──┐
                │ │R_SHUNT│
                │ └─┬──┘
                │   │
                │   └──────────► LOAD ──────► GND
                │
            V_SENSE+ = V_SUPPLY
            V_SENSE- = V_SUPPLY - (I × R_SHUNT)
```

The voltage across the shunt is still only millivolts (the same I × R signal), but both terminals sit at or near the supply voltage. On a 12V system, the amplifier must measure a 50mV differential signal while rejecting 12V of common-mode voltage. On a 48V system, the common-mode voltage is 48V. This demands a current sense amplifier with high common-mode rejection ratio (CMRR) and a common-mode voltage range (CMVR) that encompasses the supply rail.

## Current Sense Amplifier ICs

Dedicated current sense amplifiers integrate the differential-to-single-ended conversion, level shifting, and gain in a single small-package IC. These devices accept the millivolt signal from the shunt, reject the common-mode voltage, and output a ground-referenced voltage proportional to the current.

### INA180 (Texas Instruments)

The INA180 is a high-side current sense amplifier in an SOT-23-5 package, available in four fixed-gain variants:

| Variant  | Gain (V/V) | Gain Error (typ) | Bandwidth | Offset Voltage |
|----------|-----------|-------------------|-----------|----------------|
| INA180A1 | 20        | ±0.3%             | 350 kHz   | ±150 µV        |
| INA180A2 | 50        | ±0.3%             | 210 kHz   | ±150 µV        |
| INA180A3 | 100       | ±0.3%             | 85 kHz    | ±150 µV        |
| INA180A4 | 200       | ±0.3%             | 45 kHz    | ±150 µV        |

- **CMVR**: −0.2V to +26V (operates with supply voltages up to 26V)
- **Supply voltage**: 2.7V to 5.5V
- **Quiescent current**: 260 µA typical
- **Output**: Ground-referenced, rail-to-rail

The INA180A3 (gain = 100) with a 10mΩ shunt produces 1V output per amp of load current — a convenient scaling for a 3.3V ADC measuring 0 to 3A. The output is calculated as:

```
V_OUT = I_LOAD × R_SHUNT × GAIN
V_OUT = 1A × 0.010Ω × 100 = 1.000V
V_OUT = 3A × 0.010Ω × 100 = 3.000V
```

### INA213 (Texas Instruments)

The INA213 provides a fixed gain of 50V/V with a wider common-mode range, making it suitable for higher-voltage applications:

- **CMVR**: −0.3V to +26V
- **Supply voltage**: 2.7V to 26V (can be powered from the same rail being measured)
- **Gain**: 50V/V ±2%
- **Bandwidth**: 80 kHz
- **Offset voltage**: ±250 µV max
- **Package**: SOT-23-6 (includes REF pin for bidirectional sensing)

The REF pin on the INA213 accepts an external reference voltage that offsets the output. For unidirectional sensing, REF connects to GND and the output swings from 0V to V_SUPPLY. For bidirectional sensing (monitoring charge and discharge current in a battery circuit), REF connects to V_SUPPLY/2 so the output swings above and below the midpoint:

```
Unidirectional:  V_OUT = (I_LOAD × R_SHUNT × 50) + V_REF    where V_REF = 0V
Bidirectional:   V_OUT = (I_LOAD × R_SHUNT × 50) + V_SUPPLY/2
                 Positive current → V_OUT > V_SUPPLY/2
                 Negative current → V_OUT < V_SUPPLY/2
```

### INA181 Series (Texas Instruments)

The INA181 family offers the same gain options as the INA180 (20/50/100/200 V/V) but with an extended common-mode voltage range of −0.2V to +26V and lower offset voltage (±35 µV typical). The improved offset makes the INA181 a better choice when measuring small currents where the shunt voltage is only a few hundred microvolts. Available in SOT-23-5.

### MAX4080 (Analog Devices / Maxim)

For high-voltage applications (automotive 24V/48V buses, industrial power rails), the MAX4080 operates with common-mode voltages up to 76V:

- **CMVR**: 0V to +76V
- **Gain options**: 5V/V (MAX4080T) or 20V/V (MAX4080F)
- **Supply voltage**: 4.5V to 76V (powered directly from the high-voltage bus)
- **Bandwidth**: 100 kHz
- **Package**: 8-pin SOIC

## Gain Selection and Output Scaling

The amplifier gain should be chosen so that the maximum expected current produces an output voltage near the ADC's full-scale input, without clipping. For a 3.3V ADC reference:

| R_SHUNT | Gain | I_MAX for 3.3V output | Current per ADC LSB (12-bit) |
|---------|------|-----------------------|------------------------------|
| 100mΩ   | 20   | 1.65A                 | 402 µA                       |
| 100mΩ   | 50   | 660mA                 | 161 µA                       |
| 100mΩ   | 100  | 330mA                 | 80.6 µA                      |
| 10mΩ    | 50   | 6.6A                  | 1.61 mA                      |
| 10mΩ    | 100  | 3.3A                  | 806 µA                       |
| 10mΩ    | 200  | 1.65A                 | 402 µA                       |

If the maximum current exceeds the amplifier's output range, either the shunt value must decrease (reducing signal amplitude) or the gain must decrease (reducing resolution). There is no substitute for a larger ADC dynamic range when the current spans several decades.

## Common-Mode Voltage Range

The common-mode voltage range (CMVR) of the sense amplifier defines the voltage range that the shunt resistor terminals can sit at while the amplifier operates correctly. For high-side sensing on a 12V rail, the CMVR must extend to at least 12V. For a 5V USB supply, a CMVR of 5.5V or higher provides adequate margin.

Operating outside the CMVR causes the amplifier output to saturate or produce erroneous readings — this failure mode is silent, producing plausible-looking but incorrect data. The CMVR must cover the full range of the supply voltage under all conditions, including startup transients and load dump events that may momentarily exceed the nominal supply.

## Bidirectional Sensing

Battery systems, regenerative motor drives, and energy harvesting circuits require measurement of current flowing in both directions through the shunt. Unidirectional sense amplifiers can only measure current in one direction; reverse current drives the output to 0V and the actual negative current value is lost.

Bidirectional current sense amplifiers (or unidirectional amplifiers with a reference offset, like the INA213 with REF = V_SUPPLY/2) solve this by centering the output around a reference voltage:

```c
/* Bidirectional current reading with INA213, REF = VCC/2 = 1.65V
 * R_SHUNT = 50mΩ, GAIN = 50V/V
 * V_OUT = (I × R_SHUNT × GAIN) + 1.65V
 *
 * Charging (positive current):   V_OUT > 1.65V
 * Discharging (negative current): V_OUT < 1.65V
 */

#define V_REF_MV        1650   /* VCC/2 reference */
#define AMP_GAIN        50
#define R_SHUNT_MOHM    50     /* 50mΩ */

int32_t read_bidirectional_current_ma(ADC_HandleTypeDef *hadc)
{
    HAL_ADC_Start(hadc);
    HAL_ADC_PollForConversion(hadc, 10);
    uint32_t counts = HAL_ADC_GetValue(hadc);

    /* Convert to mV */
    int32_t v_out_mv = (int32_t)((uint32_t)counts * 3300 / 4096);

    /* Subtract reference to get signed sense voltage */
    int32_t v_sense_mv = v_out_mv - V_REF_MV;

    /* Convert to mA: I = V_sense / (GAIN × R_SHUNT) */
    /* v_sense_mv / (50 × 0.050) = v_sense_mv / 2.5 */
    int32_t current_ma = v_sense_mv * 1000 / (AMP_GAIN * R_SHUNT_MOHM);

    return current_ma;  /* positive = charging, negative = discharging */
}
```

## Differential Amplifier Configurations

When a dedicated current sense amplifier IC is unavailable or unsuitable, a discrete differential amplifier built from an op-amp and four resistors can measure the shunt voltage. The classic instrumentation amplifier topology uses three op-amps for high input impedance and adjustable gain, but for many embedded applications, a single-op-amp difference amplifier suffices:

```
        R1            R2
 IN+ ───┤├────┬────┤├──── V_OUT
              │
              │ (op-amp)
              │
 IN- ───┤├────┴────┤├──── GND
        R3            R4

 V_OUT = (IN+ − IN−) × (R2 / R1)   when R1/R2 = R3/R4
```

Resistor matching is critical: a 0.1% mismatch between the R1/R2 and R3/R4 ratios translates directly into common-mode rejection error. At a common-mode voltage of 12V, a 0.1% mismatch produces a 12mV error — comparable to the shunt signal itself. Precision matched resistor networks (such as the Vishay ACAS 0606 series, four resistors in a single package matched to 0.02%) solve this problem, but the cost often exceeds that of a dedicated current sense amplifier IC.

## Tips

- Default to high-side sensing for any system where the load shares signals or ground connections with other devices — the ground disturbance from low-side sensing is the most common source of unexplained communication errors in mixed-signal systems
- Select an amplifier with a CMVR at least 10% above the maximum expected supply voltage to accommodate transient overshoot and startup conditions
- For initial prototyping, the INA180A3 (100V/V gain) with a 10mΩ shunt is a versatile starting point — it provides 1V/A scaling and works on any supply up to 26V with a 3.3V MCU ADC
- Use the INA213's REF pin for bidirectional sensing rather than adding a separate level-shifting circuit — the integrated reference input maintains gain accuracy and minimizes component count
- When routing high-side sense amplifier PCB traces, keep the differential sense traces short, equal in length, and parallel to each other to maximize common-mode noise rejection
- Add a 100nF bypass capacitor directly at the amplifier's supply pin and a 100pF–1nF filter capacitor across the differential inputs to reject switching noise from DC-DC converters

## Caveats

- **Low-side sensing disrupts the ground path for all load-referenced signals** — UART, SPI, and I2C between the load and other devices on the board will see a time-varying ground offset proportional to load current, causing communication errors at high currents
- **Operating an amplifier outside its CMVR produces plausible but incorrect readings** — The output does not rail or flag an error; it simply reports a wrong value, making this failure mode difficult to detect without independent verification
- **The INA180's 26V CMVR means it cannot be used on a 28V avionics bus or 48V automotive rail** — Use the MAX4080 (76V) or INA186 (48V) for these applications
- **Gain error and offset voltage compound** — A ±0.3% gain error plus a ±150µV offset on the INA180 produces a worst-case error of 450µA at 1A full scale; for precision applications, in-system calibration against a known reference current is necessary
- **Bidirectional amplifiers using a voltage divider for V_REF introduce an additional error source** — Resistor divider drift with temperature shifts the zero-current point; using a precision voltage reference (such as the REF3318 for 1.8V or LM4040 for other voltages) provides better long-term stability
- **A single-op-amp difference amplifier requires four matched resistors** — Off-the-shelf 1% resistors provide only about 40dB CMRR, which is inadequate for high-side sensing on supplies above 5V; use 0.1% matched networks or a dedicated sense amplifier IC

## In Practice

- A motor controller with low-side current sensing that works on the bench but corrupts SPI communication to a sensor in the final product is experiencing ground offset from the shunt — moving to high-side sensing eliminates the interaction without changing the firmware or the sensor wiring
- An INA180 on a 24V bus that reports zero current regardless of load is operating outside its 26V CMVR during load-dump transients that push the bus to 30V+ — replacing with a MAX4080 (76V CMVR) resolves the issue
- Current readings that drift over a 10-minute test without a changing load often indicate self-heating of the shunt resistor, thermal drift of the amplifier offset, or both — a metal foil shunt (15 ppm/°C) and a chopper-stabilized amplifier reduce drift to negligible levels
- A battery monitor reporting symmetric charge and discharge currents when only discharge is occurring has the INA213's REF pin connected to a noisy divider — switching to a precision reference stabilizes the zero-crossing point
- A prototype with a discrete difference amplifier that shows 10% error on a 3.3V supply but 40% error on a 12V supply has resistor mismatch — the error scales with common-mode voltage, confirming that CMRR is the limiting factor, not gain accuracy
