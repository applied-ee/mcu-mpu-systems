---
title: "Sensorless Back-EMF"
weight: 50
---

# Sensorless Back-EMF

Eliminating Hall sensors from a BLDC motor reduces cost, connector count, and failure points — but the controller must determine rotor position from the motor's own electrical signals. The dominant technique for trapezoidal (six-step) sensorless drives is **back-EMF zero-crossing detection**: when one phase is floating (undriven), its terminal voltage crosses the virtual neutral point at a predictable rotor angle. Detecting this crossing provides the timing reference for the next commutation event.

## Zero-Crossing Principle

In six-step commutation, one of the three phases is always floating. The back-EMF on the floating phase swings between the positive supply and ground as the rotor magnets pass by. The zero crossing of this back-EMF (relative to the motor's virtual neutral point) occurs at 30° electrical before the next commutation event.

```
Phase voltage (floating)
     │
 Vbus├── ┐         ┌──
     │    \       /
 Vn  ├─────X─────X────── Zero-crossing points
     │      \   /
  0  ├───────└─┘
     └──────────────────── θ electrical
          30°  90° 150°
```

Each zero crossing corresponds to the midpoint of the 60° floating interval. After detecting the crossing, the firmware delays 30° electrical before commutating to the next state.

## Comparator-Based Detection

The simplest hardware approach uses analog comparators to detect the zero-crossing:

```
                 ┌──────────────┐
Phase A (float)──┤(+)           │
                 │  Comparator  ├──► MCU input capture
Virtual neutral──┤(−)           │
                 └──────────────┘
```

The virtual neutral voltage is reconstructed from the three motor phases through a resistor divider network:

```
Phase A ──┬── 10 kΩ ──┐
Phase B ──┤── 10 kΩ ──┼── Virtual Neutral
Phase C ──┘── 10 kΩ ──┘
```

This reconstructed neutral is accurate only when the motor runs — at standstill, all phases are at the same potential and no back-EMF exists.

### Filter Network

Motor switching noise produces false zero-crossing detections. A low-pass filter on each comparator input suppresses the noise:

```
Phase ── 10 kΩ ──┬── 100 pF ──┐
                 │             GND
                 └── to comparator (+)
```

The filter time constant (1 µs with these values) must be short enough to not delay the zero-crossing detection by more than a few electrical degrees at maximum speed.

## ADC-Based Detection

Instead of comparators, the floating phase voltage can be sampled by an ADC during the PWM off-time (when all FETs are off and the motor phases reflect true back-EMF):

```c
/* Sample floating phase ADC during PWM off-time */
/* Timer trigger at the center of the low-side on-time */
float v_floating = read_adc_channel(floating_phase);
float v_neutral  = (v_a + v_b + v_c) / 3.0f;

if (prev_above_neutral && v_floating < v_neutral) {
    /* Falling zero-crossing detected */
    zero_crossing_detected = true;
    zc_timestamp = __HAL_TIM_GET_COUNTER(&htim_commutation);
}
prev_above_neutral = (v_floating > v_neutral);
```

ADC-based detection is more flexible (thresholds can be adjusted in software) but has higher latency than comparator-based approaches.

## Commutation Timing

After detecting a zero crossing, the next commutation should occur 30° electrical later. The firmware estimates this delay based on the time between consecutive zero crossings:

```c
/* Zero-crossing detected — schedule commutation */
uint32_t zc_period = zc_timestamp - prev_zc_timestamp;
uint32_t commutation_delay = zc_period / 2;  /* 30° = half of 60° */

/* Timer interrupt fires after commutation_delay */
__HAL_TIM_SET_COMPARE(&htim_commutation, TIM_CHANNEL_1,
    zc_timestamp + commutation_delay);
prev_zc_timestamp = zc_timestamp;
```

The 30° delay assumes the speed is roughly constant between zero crossings. During acceleration, the actual 30° interval is shorter than estimated (the motor is speeding up), and during deceleration it is longer. Compensation factors or predictive algorithms improve timing accuracy during transients.

## Startup Without Sensors

Back-EMF is proportional to speed — at standstill, there is no back-EMF and zero-crossing detection cannot work. Sensorless BLDC motors require a special startup sequence:

### Open-Loop Forced Commutation

1. **Align:** Energize one commutation state for 200–500 ms to pull the rotor to a known position
2. **Ramp:** Step through the commutation sequence at a fixed, gradually increasing frequency (blind commutation)
3. **Handover:** Once the rotor reaches sufficient speed (~10–15 % of rated) for reliable zero-crossing detection, switch to closed-loop sensorless control

```c
/* Open-loop startup ramp */
uint32_t startup_period = 20000;  /* Initial step period (µs) — slow */
uint32_t min_period = 2000;       /* Target period for handover */

for (int step = 0; startup_period > min_period; step++) {
    apply_commutation(startup_table[step % 6]);
    delay_us(startup_period);
    startup_period -= startup_period / 20;  /* Exponential ramp */
}

/* Switch to sensorless closed-loop control */
sensorless_mode = true;
```

### Startup Challenges

| Challenge | Consequence | Mitigation |
|-----------|------------|------------|
| Unknown rotor position | First step may produce reverse torque | Alignment phase before ramping |
| Too-fast ramp | Motor cannot synchronize, stalls | Conservative ramp rate, current monitoring |
| Too-slow ramp | Extended startup time, current heating | Adaptive ramp based on current draw |
| Load during startup | Higher current needed, may stall | Increase alignment current, slower ramp |

## Tips

- Use hardware comparators with interrupt capture rather than ADC polling for zero-crossing detection. The reduced latency (< 1 µs vs 10–50 µs for ADC) significantly improves commutation timing accuracy at high speeds.
- Add a blanking window after each commutation event (typically 30° electrical or ~25 % of the zero-crossing period) to ignore switching transients and ringing. Without blanking, the comparators register false zero crossings within microseconds of each commutation.
- During the open-loop startup ramp, monitor phase current. If current exceeds 150 % of rated, the ramp is too aggressive — the rotor cannot follow the forced commutation and the excess current heats the windings without producing useful torque.
- For bidirectional sensorless control, the zero-crossing polarity (rising vs falling) reverses with direction. The firmware must select the correct comparator edge based on the direction command.

## Caveats

- Sensorless back-EMF detection fails below ~10 % of rated speed. The back-EMF amplitude is too small for reliable zero-crossing detection, and electrical noise dominates. Applications requiring precise low-speed control need Hall sensors or an encoder.
- The open-loop startup sequence consumes more current than steady-state operation and may take 200–500 ms. Applications with frequent start/stop cycles (like robotic actuators) pay a startup penalty each time.
- PWM switching noise on the floating phase can be 10–100× larger than the back-EMF signal at low speeds. Aggressive filtering reduces noise but adds phase delay to the zero-crossing detection, introducing commutation timing error.
- Load variations during startup (e.g., a propeller encountering wind) can cause the motor to fall out of synchronization during the open-loop ramp. Robust startup requires monitoring synchronization (current waveform shape) and restarting if necessary.

## In Practice

- **Motor starts reliably unloaded but stalls during startup with a load.** The open-loop ramp accelerates faster than the loaded motor can follow. The rotor falls behind the rotating field, and the commutation angles become incorrect. Slowing the ramp and increasing the alignment current (to establish a stronger starting torque) improves loaded startup reliability.

- **Motor runs but commutation sounds rough and current is higher than expected.** The commutation timing is offset — the 30° delay after zero crossing is incorrect, either too early or too late. Adjusting the delay (sometimes called "timing advance") by ±5° and monitoring current consumption identifies the optimum. Minimum current at a given speed corresponds to correct commutation timing.

- **Motor loses sensorless tracking during rapid throttle changes.** During sudden acceleration, the zero-crossing intervals change faster than the firmware's timing estimator can track. The commutation falls out of phase, producing reverse torque and a stall. Rate-limiting the throttle command (maximum acceleration in software) prevents the tracking from diverging.

- **False zero crossings trigger commutation too early, causing a characteristic buzzing sound.** Switching transients from the PWM are coupling into the comparator inputs. The blanking window is either missing or too short. Increasing the blanking duration to 30 % of the expected zero-crossing period suppresses the false triggers. If the blanking is already at maximum, adding hardware RC filtering on the comparator inputs provides additional noise rejection.
