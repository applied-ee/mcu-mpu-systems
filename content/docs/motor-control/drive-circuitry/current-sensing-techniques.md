---
title: "Current Sensing Techniques"
weight: 30
---

# Current Sensing Techniques

Measuring the current flowing through a motor, solenoid, or actuator serves three purposes: protection (overcurrent shutdown), regulation (current-loop control), and diagnostics (load monitoring, stall detection). The choice of sensing method depends on the current range, accuracy requirements, bandwidth, and whether the measurement is on the low side (ground-referenced) or high side (supply-referenced) of the load.

## Low-Side Shunt Sensing

A low-value resistor between the load and ground measures current as a ground-referenced voltage:

```
Load ── MOSFET drain
            │
       MOSFET source
            │
       R_shunt (10–100 mΩ)
            │
           GND
```

V_sense = I_load × R_shunt. The voltage is referenced to ground, making it directly readable by the MCU's ADC.

### Advantages and Limitations

| Advantage | Limitation |
|-----------|-----------|
| Ground-referenced (easy ADC interface) | Cannot sense in both H-bridge directions |
| No level-shifting needed | Introduces voltage drop between load and ground |
| Low cost | Ground bounce in high-current layouts corrupts measurement |

### Shunt Resistor Selection

| Current Range | Shunt Value | Voltage at Full Scale | Power Dissipation | Resistor Size |
|--------------|------------|----------------------|-------------------|--------------|
| 1 A | 100 mΩ | 100 mV | 0.1 W | 1206 or 2010 |
| 5 A | 20 mΩ | 100 mV | 0.5 W | 2512 |
| 10 A | 10 mΩ | 100 mV | 1.0 W | 2512 or through-hole |
| 30 A | 3 mΩ | 100 mV | 2.7 W | PCB trace or busbar |
| 50 A+ | 1 mΩ | 50 mV | 2.5 W | Manganin busbar |

For currents above ~20 A, the PCB trace itself can serve as the shunt resistor. Copper has a known resistivity (0.67 mΩ per square at 1 oz, 25 °C) but a high temperature coefficient (+0.4 %/°C).

## High-Side Shunt Sensing

The shunt sits between the supply and the load. This senses current regardless of H-bridge direction and keeps the load grounded — but the sense voltage rides on top of the supply rail:

```
V+ ── R_shunt ── Load ── MOSFET ── GND
       │    │
       └────┘ (sense voltage at V+ level)
```

A differential amplifier or dedicated high-side current sense IC translates the millivolt signal at the supply rail to a ground-referenced voltage the ADC can read.

### Dedicated Current Sense ICs

| IC | Type | Common-Mode Range | Gain | Bandwidth | Output |
|----|------|-------------------|------|-----------|--------|
| INA219 | I²C digital, high-side | 0–26 V | 1–8× PGA | 100 Hz (digital) | 12-bit register |
| INA226 | I²C digital, high-side | 0–36 V | 1–16× PGA | 140 Hz (digital) | 16-bit register |
| INA180 | Analog, bidirectional | −0.2 to 26 V | 20/50/100/200 | 350 kHz | Analog voltage |
| INA240 | Analog, high-side | −4 to 80 V | 20/50/100/200 | 400 kHz | Analog voltage |
| MAX4080 | Analog, high-side | 4.5–76 V | 20/60 | 200 kHz | Analog voltage |

### INA219 Example (I²C)

```c
/* INA219 configuration — 0.1 Ω shunt, 3.2 A full scale */
/* Calibration register = 0.04096 / (current_LSB × R_shunt) */
/* current_LSB = max_expected_I / 2^15 = 3.2 / 32768 = 97.66 µA */
/* Calibration = 0.04096 / (0.00009766 × 0.1) = 4194 → 0x1062 */

uint8_t config[] = {0x00, 0x39, 0x9F};  /* Config register: 32V, 320mV, 12-bit, cont */
HAL_I2C_Master_Transmit(&hi2c1, INA219_ADDR << 1, config, 3, 100);

uint8_t cal[] = {0x05, 0x10, 0x62};  /* Calibration register */
HAL_I2C_Master_Transmit(&hi2c1, INA219_ADDR << 1, cal, 3, 100);

/* Read current register */
uint8_t reg = 0x04;
HAL_I2C_Master_Transmit(&hi2c1, INA219_ADDR << 1, &reg, 1, 100);
uint8_t data[2];
HAL_I2C_Master_Receive(&hi2c1, INA219_ADDR << 1, data, 2, 100);
int16_t raw_current = (data[0] << 8) | data[1];
float current_A = raw_current * 0.00009766f;  /* current_LSB */
```

## Hall-Effect Current Sensors

Hall-effect sensors measure the magnetic field around a current-carrying conductor, providing galvanic isolation between the sensed current and the measurement circuit:

| Sensor | Type | Range | Sensitivity | Bandwidth | Isolation |
|--------|------|-------|-------------|-----------|-----------|
| ACS712-05A | Through-hole | ±5 A | 185 mV/A | 80 kHz | 2.1 kV |
| ACS712-20A | Through-hole | ±20 A | 100 mV/A | 80 kHz | 2.1 kV |
| ACS723-20A | SMD | ±20 A | 200 mV/A | 80 kHz | 3.0 kV |
| TMCS1108A2 | SMD | ±8 A | 400 mV/A | 600 kHz | 3 kV |

The ACS712 outputs V_supply/2 (typically 2.5 V) at zero current, with the output swinging above and below this offset proportionally to current:

```c
/* ACS712-20A current measurement */
uint16_t adc_raw = HAL_ADC_GetValue(&hadc1);
float v_sensor = (adc_raw / 4095.0f) * 3.3f;
float current_A = (v_sensor - 2.5f) / 0.100f;  /* 100 mV/A, offset at 2.5 V */
```

### Advantages of Hall Sensors

- **Galvanic isolation:** No electrical connection between power path and MCU
- **No insertion loss:** Conductor resistance is unchanged (unlike a shunt)
- **Bidirectional:** Measures current in both directions

### Limitations

- **Offset drift:** The zero-current output voltage drifts with temperature (typically ±1 %)
- **Bandwidth:** 80 kHz for ACS712 — adequate for motor control but not for individual PWM cycle sensing
- **Noise:** Hall output has ~20 mV p-p noise, limiting resolution to ~200 mA for ACS712-20A

## Tips

- For current-loop motor control (FOC, current chopping), use analog sense amplifiers (INA180, INA240) with shunt resistors. The bandwidth (350+ kHz) allows sensing within individual PWM cycles. Digital I²C sensors (INA219) are too slow for real-time control but excellent for monitoring.
- Calibrate the zero-current offset at startup. Read the sense amplifier or Hall sensor output before enabling the motor, and subtract this offset from all subsequent readings. Temperature drift during operation introduces ~1 % error.
- Use Kelvin connections (4-wire) to the shunt resistor pads. The PCB traces carrying high current have their own voltage drop — if the sense lines share these traces, the measurement includes trace resistance, not just the shunt.
- Place the ADC sampling trigger at the center of the PWM on-time (center-aligned PWM). This is the point of minimum switching noise and provides the most representative current reading.

## Caveats

- INA219 and INA226 provide digital readings at ~100–140 Hz — not fast enough for cycle-by-cycle current control. These devices are for monitoring (telemetry, logging, protection) rather than real-time control.
- Ground bounce from high-current switching can shift the MCU's ground reference relative to the shunt, introducing common-mode errors in low-side sensing. Separate the analog ground (shunt, sense amplifier, ADC reference) from the power ground (MOSFET source, motor return) and connect them at a single point.
- ACS712 Hall sensors have a ~66 kHz bandwidth, which aliases PWM current ripple into the measurement. An RC low-pass filter (1 kΩ + 100 nF → 1.6 kHz cutoff) on the sensor output removes the ripple and provides the average current, but adds 100 µs of phase delay.
- Shunt resistor values drift with temperature. Precision shunts use manganin alloy (TCR < 15 ppm/°C); cheap thick-film resistors can drift 100+ ppm/°C. For current-loop control in a motor drive that heats up significantly, the shunt's TCR matters.

## In Practice

- **Current reading drifts upward over time even though the load is constant.** The shunt resistor is self-heating, increasing its resistance and shifting the sense voltage. The effect is most pronounced on high-current circuits with small shunts. Selecting a lower-TCR shunt (manganin, 15 ppm/°C) or increasing the resistor size (2512 → 3920 or through-hole) reduces the thermal drift.

- **ADC current reading is noisy and contains a component at the PWM frequency.** The ADC is sampling during switching transients. Synchronizing the ADC trigger to the center of the PWM on-time (center-aligned mode) places the sample at the point of minimum noise. If the ADC has no hardware trigger, inserting a 1 µs delay after the PWM edge before starting the conversion provides a similar benefit.

- **High-side INA226 reports negative current when the motor brakes.** During regenerative braking, current flows backward through the shunt (from motor to supply). The INA226 correctly measures this as negative current. The firmware must handle negative current values rather than treating them as errors.

- **ACS712 reads 0.2 A when no current is flowing.** The zero-current offset voltage is not exactly VCC/2 — it varies by ±25 mV from part to part and drifts with temperature. A one-time calibration at startup (averaging 100+ samples with no current) establishes the true zero point and eliminates the offset error.
