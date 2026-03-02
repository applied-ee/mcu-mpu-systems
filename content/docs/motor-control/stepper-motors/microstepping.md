---
title: "Microstepping"
weight: 30
---

# Microstepping

Full-step drive produces 200 discrete positions per revolution (1.8° each) with abrupt current transitions between steps. This causes audible noise, vibration, and resonance problems — particularly at low speeds. Microstepping divides each full step into smaller increments by shaping the coil currents as sine/cosine waveforms, producing smoother motion and reducing acoustic noise. Nearly every modern stepper driver supports microstepping, and it is the default operating mode for 3D printers, CNC machines, and most embedded motion systems.

## Microstepping Principle

In a two-phase stepper, full-step drive alternates between four states: (A+, B+), (A+, B−), (A−, B−), (A−, B+). The rotor snaps between these four positions per electrical cycle.

With microstepping, the current in each phase follows a sinusoidal profile:

```
I_A = I_peak × cos(θ)
I_B = I_peak × sin(θ)
```

Where θ advances in increments of (360° / microsteps_per_full_step). At 1/16 microstepping, θ increments by 22.5° per microstep, giving 16 intermediate positions between each full step.

## Microstep Resolution Levels

| Mode | Steps/Rev | Angular Resolution | Typical Use |
|------|----------|-------------------|-------------|
| Full step | 200 | 1.8° | Rarely used; maximum torque, maximum vibration |
| Half step (1/2) | 400 | 0.9° | Basic smoothing |
| 1/4 | 800 | 0.45° | General purpose |
| 1/8 | 1600 | 0.225° | 3D printing default (many boards) |
| 1/16 | 3200 | 0.1125° | Common default for A4988, DRV8825 |
| 1/32 | 6400 | 0.056° | TMC2209 interpolated |
| 1/256 | 51200 | 0.007° | TMC2209 with interpolation from 1/16 input |

## Electrical vs Mechanical Reality

Microstepping improves smoothness but does **not** proportionally improve positional accuracy. The mechanical accuracy of a stepper motor is limited by:

- **Manufacturing tolerances:** Tooth spacing, bearing runout, and magnet uniformity introduce errors of ±3–5 % of a full step (±0.05–0.09°) regardless of microstep setting.
- **Load-dependent deflection:** The rotor position under load deviates from the commanded position by an angle proportional to torque / holding torque. At 50 % of holding torque, deflection is ~7° electrical (about 1.5 full steps for a 200-step motor).
- **Torque reduction:** Each microstep position has lower holding torque than a full step. At fine microstep positions (45° electrical from a full step), holding torque drops to ~70 % of the full-step value.

The practical positional accuracy of microstepping is roughly equivalent to 1/4 stepping (~0.45°) for most motors, regardless of whether the driver is set to 1/16 or 1/256. The benefit of higher microstep settings is smoother motion and lower noise, not higher accuracy.

## Current Waveform Quality

The quality of microstepping depends on how accurately the driver regulates coil current at each microstep position. Key factors:

- **Current regulation method:** Chopper-based current regulation (A4988, DRV8825, TMC2209) actively controls current at each step, producing good waveforms. Voltage-mode drive produces distorted waveforms because motor back-EMF and winding resistance vary with speed.
- **Decay mode:** When the driver reduces current (stepping from a high-current microstep to a lower one), the current must decay through the winding inductance. Fast decay forces current down quickly but increases ripple; slow decay is smoother but may not reach the target in time for the next microstep. Mixed decay modes (used by TMC drivers) optimize this trade-off.
- **Current ripple:** The chopping frequency (typically 20–50 kHz) determines current ripple magnitude. Higher chopping frequencies reduce ripple but increase driver losses.

## TMC2209 Interpolation

The TMC2209 includes a hardware interpolation engine that takes a 1/16 microstep input and internally interpolates to 1/256 microsteps. This means the MCU generates step pulses at the 1/16 rate (3200 steps/rev), but the driver smooths the current waveforms as if running at 1/256 (51200 steps/rev). The result is extremely quiet operation — often called StealthChop — without requiring the MCU to generate high-frequency step pulses.

```
MCU step rate:   3200 steps/rev × 10 rev/s = 32,000 steps/s
Driver output:   51200 steps/rev × 10 rev/s = 512,000 µsteps/s (interpolated)
```

## Configuration Example (A4988 Microstep Selection)

The A4988 uses three pins (MS1, MS2, MS3) to select the microstep mode:

| MS1 | MS2 | MS3 | Resolution |
|-----|-----|-----|-----------|
| Low | Low | Low | Full step |
| High | Low | Low | 1/2 step |
| Low | High | Low | 1/4 step |
| High | High | Low | 1/8 step |
| High | High | High | 1/16 step |

These pins have internal pull-downs, so leaving them unconnected defaults to full-step mode. Tie them high or low with 10 kΩ resistors or connect directly to VIO.

## Tips

- Default to 1/16 microstepping for general-purpose applications. This provides smooth motion without requiring extremely high step rates from the MCU.
- Use TMC2209 with StealthChop and interpolation for applications where acoustic noise matters (desktop 3D printers, lab equipment, consumer products). The noise reduction over A4988/DRV8825 is dramatic.
- When calculating maximum speed, remember that the step rate scales with the microstep setting. A motor at 1/16 microstepping needs 16× the step frequency to reach the same RPM as full stepping.
- Measure actual positional accuracy with a dial indicator or encoder before assuming that higher microstepping improves precision. The difference between 1/8 and 1/256 in actual position accuracy is typically unmeasurable.

## Caveats

- Microstepping reduces holding torque at intermediate positions. At the midpoint between two full steps (45° electrical), the restoring torque is sin(45°) ≈ 70 % of the full-step torque. Applications near the torque limit may need to account for this reduction.
- The TMC2209's interpolation engine adds a slight delay (< 1 full step) to the motion response. For applications requiring exact, instantaneous step-to-position correspondence (some CNC probing routines), interpolation should be disabled.
- At very high microstep settings without interpolation (e.g., 1/128 via SPI on TMC drivers), the required step frequency for moderate speeds can exceed what a GPIO-based step generator can produce reliably.
- Mixing microstep modes during a move (e.g., changing from 1/16 to 1/4 for higher speed) causes a position error equal to the difference in quantization. This is rarely worth the complexity.

## In Practice

- **Motor is much quieter at 1/16 microstepping than full step, but positional accuracy has not improved.** This is expected. Microstepping smooths the current waveform and eliminates the mechanical ringing at each full step, but the actual rotor position accuracy is limited by motor tolerances and load deflection. The smoothness improvement is real; the resolution improvement is largely electrical, not mechanical.

- **Motor hums or resonates at specific speeds in full-step mode but runs smoothly with microstepping.** Full-step drive excites the motor's natural resonant frequency (typically 50–200 Hz for NEMA 17). Microstepping splits the excitation energy across many smaller steps, avoiding the single-frequency resonance. This is one of the primary practical benefits of microstepping.

- **Motor loses steps at high speed with 1/16 microstepping but works at 1/4.** The step rate at 1/16 is 4× higher than 1/4 for the same RPM. If the MCU or the driver cannot sustain the required pulse rate — or if the motor's torque at that speed is marginal — reducing the microstep setting trades smoothness for reliable high-speed operation.

- **TMC2209 in StealthChop mode loses steps under heavy load.** StealthChop optimizes for quiet operation, not maximum torque. Switching to SpreadCycle mode (via UART configuration) increases torque at the expense of slightly more audible noise. Many applications use StealthChop at low speed and switch to SpreadCycle above a threshold.
