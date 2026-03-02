---
title: "Current Sensing & Limiting"
weight: 30
---

# Current Sensing & Limiting

Knowing how much current a motor draws — and being able to limit it — is essential for protecting both the motor and the drive electronics. Stall current in a brushed DC motor can be 5–10× the running current; a 12 V motor with 1 Ω winding resistance pulls 12 A at stall, even if it runs at 1–2 A under normal load. Without current limiting, a stall event can overheat windings, saturate H-bridge MOSFETs, blow fuses, or trip power supplies.

## Shunt Resistor Sensing

The simplest current-sensing method places a low-value resistor (the shunt) in series with the motor. The voltage across the shunt is proportional to current (V = I × R_shunt). An ADC or comparator reads this voltage to measure or limit current.

### Low-Side Shunt

The shunt sits between the MOSFET source and ground. The sensed voltage is ground-referenced, making it easy to read with an MCU ADC:

```
Motor ── MOSFET (drain)
              │
         MOSFET (source)
              │
         R_shunt (10–100 mΩ)
              │
             GND
```

At 3 A through a 50 mΩ shunt, the sense voltage is 150 mV. A 12-bit ADC with 3.3 V reference has 0.8 mV/count resolution — enough to resolve ~16 mA per count, giving reasonable precision for motor control.

| Shunt Value | Voltage at 1 A | Voltage at 5 A | Power at 5 A |
|-------------|---------------|---------------|-------------|
| 10 mΩ | 10 mV | 50 mV | 0.25 W |
| 50 mΩ | 50 mV | 250 mV | 1.25 W |
| 100 mΩ | 100 mV | 500 mV | 2.5 W |

### High-Side Shunt

The shunt sits between the supply and the H-bridge. This senses current regardless of which direction the motor is running, but the sense voltage is at the supply rail — a differential amplifier or high-side current sense IC is required.

## Current Sense Amplifiers

For low shunt voltages (< 100 mV), a dedicated current sense amplifier provides gain and level-shifting:

| IC | Type | Gain | Bandwidth | Input Offset |
|----|------|------|-----------|-------------|
| INA180 | Low-side/high-side | 20, 50, 100, 200 V/V | 350 kHz | ±150 µV |
| INA213 | High-side | 50 V/V | 80 kHz | ±35 µV |
| MAX4080 | High-side | 20 V/V | 200 kHz | ±2 mV |

With a 50 mΩ shunt and an INA180A3 (100 V/V gain), 1 A produces 50 mV × 100 = 5.0 V output — well within 3.3 V ADC range needs a lower gain setting. At 50 V/V gain: 50 mV × 50 = 2.5 V output at 1 A, leaving headroom up to ~1.3 A before clipping.

### Amplifier Output to ADC

```c
/* Read motor current via INA180 + low-side 50 mΩ shunt */
/* INA180A2: gain = 50 V/V */
uint16_t adc_raw = HAL_ADC_GetValue(&hadc1);
float v_sense = (adc_raw / 4095.0f) * 3.3f;     /* ADC voltage */
float i_motor = v_sense / (0.050f * 50.0f);       /* V / (R_shunt × gain) */
```

## Current Chopping (Cycle-by-Cycle Limiting)

For fast overcurrent protection, a comparator monitors the shunt voltage and disables the PWM output within a single switching cycle. This is faster than any firmware-based ADC approach:

```
R_shunt voltage ──► (+) Comparator ──► Timer BREAK input
                     (−) V_ref (DAC or resistor divider)
```

When the shunt voltage exceeds the reference, the comparator trips the timer's break input, forcing all PWM outputs low. The STM32 advanced timer break function handles this entirely in hardware with sub-microsecond response.

### STM32 Break Input Configuration

```c
/* Configure TIM1 break input for overcurrent shutdown */
TIM_BreakDeadTimeConfigTypeDef sBreakConfig = {0};
sBreakConfig.BreakState = TIM_BREAK_ENABLE;
sBreakConfig.BreakPolarity = TIM_BREAKPOLARITY_HIGH;
sBreakConfig.AutomaticOutput = TIM_AUTOMATICOUTPUT_ENABLE;
HAL_TIMEx_ConfigBreakDeadTime(&htim1, &sBreakConfig);

/* Set current limit via DAC: 3 A × 0.050 Ω × 50 gain = 7.5 V → clamp to 3.0 V */
/* Adjusted: 3 A × 0.050 Ω = 150 mV at shunt; comparator threshold accordingly */
```

## Firmware-Based Current Limiting

When hardware comparators are not available, the ADC can sample current at regular intervals and reduce PWM duty when current exceeds a threshold:

```c
void motor_current_limit(float i_measured, float i_limit) {
    if (i_measured > i_limit) {
        /* Reduce duty cycle proportionally */
        float reduction = (i_measured - i_limit) / i_limit;
        current_duty -= (uint16_t)(reduction * 100);
        if (current_duty < 0) current_duty = 0;
        __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1,
            (current_duty * htim3.Init.Period) / 100);
    }
}
```

This approach is much slower than hardware chopping — ADC conversion plus firmware processing takes 10–100 µs, during which current can overshoot significantly. It is adequate for thermal protection but not for protecting MOSFETs from instantaneous overcurrent.

## Tips

- Size the shunt resistor so that full-load current produces 50–200 mV. Lower voltages reduce power loss but require higher-gain amplifiers and are more susceptible to noise. Higher voltages waste power (I²R loss in the shunt).
- Use Kelvin (4-wire) connections to the shunt resistor on the PCB. The sense traces must connect directly to the resistor pads, not to the high-current path, or trace resistance adds error.
- Place a small RC filter (100 Ω + 1 nF) on the sense amplifier input to suppress switching-edge transients. The filter time constant (100 ns) should be short compared to the PWM period but long enough to reject ringing.
- Sample the ADC for current measurement in the middle of the PWM on-time (center-aligned trigger). This avoids capturing switching transients and gives a reading closest to the average motor current.

## Caveats

- Ground bounce in high-current circuits can shift the MCU's ground reference relative to the shunt resistor ground, introducing offset errors in low-side sensing. Star grounding and separate sense ground traces mitigate this.
- Current sense amplifiers have finite bandwidth. An INA180 at 350 kHz cannot track the leading edge of a 20 kHz PWM cycle — it shows the average current, not the instantaneous peak. For cycle-by-cycle protection, a fast comparator (< 1 µs response) is necessary.
- SMD shunt resistors (2512, 2010 packages) have significant temperature coefficient at high current. A 50 mΩ resistor rated at 1 W will self-heat at 2.5 A (0.31 W), shifting its resistance by 1–3 % depending on TCR.
- Motor inrush current at startup can be 5–10× the running current and lasts 10–50 ms. Setting the current limit too aggressively prevents the motor from starting. A startup blanking period or higher initial threshold avoids false trips.

## In Practice

- **ADC current reading oscillates wildly at a fixed duty cycle.** Sampling is synchronized to switching edges rather than the center of the PWM on-time. The ADC captures the current during ringing and shoot-through transients. Moving the ADC trigger to center-aligned mode stabilizes the reading.

- **Current measurement reads zero even with the motor running.** The most common cause is reversed shunt amplifier inputs — the output saturates at the rail and looks like zero current after scaling. Checking the raw amplifier output voltage with a multimeter reveals the saturation.

- **Motor stalls under load and the current limit never triggers.** The shunt is in the low-side path of an H-bridge, and during freewheeling the motor current flows through the body diode and bypasses the shunt entirely. Moving the shunt to the high side of the supply senses current in both directions.

- **Overcurrent protection trips immediately on motor startup.** Inrush current exceeds the steady-state limit. Adding a 20–50 ms blanking window after motor enable — or raising the threshold temporarily during startup — allows normal acceleration without nuisance trips.
