---
title: "Closed-Loop Stepper & Servo"
weight: 40
---

# Closed-Loop Stepper & Servo

Open-loop stepper control works until it does not — a missed step goes undetected, and every subsequent position is wrong by that amount. Closing the loop with an encoder transforms a stepper into a servo-like system: the controller knows the actual shaft position and can correct for missed steps, stalls, and load disturbances. The trade-off is additional hardware (encoder), firmware complexity (feedback loop), and the need to reconcile two fundamentally different control approaches: the discrete step-counting world of stepper drivers and the continuous feedback world of servo control.

## Why Close the Loop on a Stepper?

| Problem | Open-Loop | Closed-Loop |
|---------|----------|-------------|
| Missed steps | Undetected; cumulative error | Detected and corrected |
| Stall | Motor loses position silently | Detected; can retry or alarm |
| Over-dimensioning | Must size motor for worst-case load | Can run closer to torque limit |
| Holding current | Full current always (heat) | Can reduce current when in position |
| Resonance | Must avoid resonance band | Feedback damps resonance |

## Architecture Options

### 1. Correction-Only (Step Loss Detection)

The encoder monitors for missed steps and adds correction steps when a deviation is detected. The step/direction driver operates normally; the feedback loop adds or subtracts extra steps.

```c
/* Correction-only closed-loop */
int32_t expected_position = commanded_steps * counts_per_step;
int32_t actual_position = read_encoder();
int32_t error = expected_position - actual_position;

if (abs(error) > counts_per_step) {
    /* Add correction steps */
    int correction_steps = error / counts_per_step;
    issue_extra_steps(correction_steps);
}
```

**Pros:** Simple; works with any step/direction driver.
**Cons:** Correction is discrete (full steps); reacts after error occurs.

### 2. Full Servo Mode (PID-Based)

The stepper motor is driven by a current-loop controller with encoder feedback, exactly like a brushless servo — bypassing the step/direction interface entirely. The MCU runs a position PID loop that outputs a torque command, which is translated into phase currents.

This requires direct control of the motor's coil currents (bypassing the step/direction driver IC) and a firmware PID loop.

### 3. Intelligent Stepper Drivers (TMC2209 + Encoder)

The TMC2209's StallGuard feature provides rudimentary stall detection without an encoder. For true closed-loop operation, the TMC5160 integrates a motion controller with encoder feedback, handling the complete position loop in silicon:

| Driver | Closed-Loop Capability |
|--------|----------------------|
| A4988, DRV8825 | None — open-loop only |
| TMC2209 | StallGuard (sensorless stall detection), no encoder input |
| TMC5160 | Encoder input, position loop, internal ramp generator |
| TMC4671 | Full servo FOC controller with encoder interface |
| iHSV57 / CL57T | Integrated closed-loop stepper drive (motor + driver + encoder) |

## Stepper vs Servo Trade-Offs

| Factor | Stepper (Open-Loop) | Stepper (Closed-Loop) | DC/BLDC Servo |
|--------|--------------------|-----------------------|---------------|
| Position accuracy | ±1–5 % of full step | Encoder-limited | Encoder-limited |
| Torque at standstill | Excellent (full holding torque) | Excellent | Requires active current control |
| Torque at high speed | Drops rapidly above mid-band | Drops rapidly (same motor) | Maintains torque to rated speed |
| Resonance | Problematic in mid-band | Damped by feedback | No resonance |
| Cost (motor + driver) | Low | Moderate | Higher |
| Firmware complexity | Low | Moderate to high | High |
| Efficiency | Low (constant current, heat) | Moderate (reduced hold current) | High (current proportional to load) |

**When to use a stepper:** Low to moderate speed, high holding torque, cost-sensitive, and loads are predictable enough that stalls are rare.

**When to use a servo:** High speed, high dynamics, variable loads, and/or efficiency matters (battery-powered, continuous duty).

## Encoder Mounting Considerations

| Mounting Point | Advantages | Disadvantages |
|---------------|-----------|---------------|
| Motor shaft (before gearbox) | High resolution; detects motor stalls | Misses gearbox backlash and compliance |
| Output shaft (after gearbox) | Measures actual load position | Lower effective resolution; slower feedback |
| Dual encoder (both) | Best of both worlds | Cost, complexity |

For closed-loop steppers, motor-shaft mounting is most common because the encoder's primary job is detecting missed steps, not measuring load position.

## Implementing Stall Detection with TMC2209

```c
/* TMC2209 StallGuard configuration */
tmc2209_write(SGTHRS, 40);  /* Threshold (tune empirically) */

/* Read StallGuard result */
uint16_t sg_result = tmc2209_read(SG_RESULT);
/* sg_result approaches 0 at stall; high values = light load */

/* DIAG pin interrupt for stall detection */
void stall_isr(void) {
    stop_motor();
    /* Flag stall condition for recovery logic */
    stall_detected = true;
}
```

StallGuard is effective for sensorless homing (detect mechanical end stop via stall) and basic overload protection, but it is not a replacement for true encoder-based closed-loop control. The detection is binary (stall / no stall) and only works above ~100 RPM.

## Tips

- For retrofitting closed-loop control to an existing stepper system, start with correction-only mode. It requires minimal firmware changes and works with the existing step/direction driver. Full servo mode can be explored later if the correction frequency is unacceptably high.
- Use TMC2209 StallGuard for sensorless homing instead of mechanical limit switches. This eliminates switches, wiring, and their failure modes. Configure a low speed (100–200 mm/s) and a moderate threshold; the motor stalls against the end stop and StallGuard triggers the home event.
- When comparing stepper vs servo for a new design, calculate the duty cycle first. A stepper dissipating 8 W of holding current 24/7 may cost less in hardware but more in total system cost (heatsinking, power supply sizing, energy) than a servo that draws only the current the load demands.
- Calibrate the encoder counts-per-step relationship at commissioning. The nominal value is (encoder PPR × 4) / (motor steps/rev × microstep divisor), but any mechanical misalignment between the encoder and motor shaft introduces a ratio error that accumulates over revolutions.

## Caveats

- Closing the loop on a stepper with a simple PID controlling the step rate can produce worse behavior than open loop if the PID gains are wrong. The discrete nature of stepper motion (it moves in steps, not continuously) creates a nonlinearity that standard PID theory does not account for. The deadband must be at least one full step.
- StallGuard threshold varies with speed, temperature, and motor characteristics. A threshold tuned at room temperature may false-trigger in a cold environment (motor resistance changes, current profile shifts). Regular re-tuning or adaptive thresholds are necessary for outdoor or industrial environments.
- An encoder on the motor shaft does not detect coupler or belt slip between the motor and the load. The encoder shows correct motor position while the load position drifts. For critical applications, the encoder must be on the load side.
- Closed-loop stepper systems do not gain additional speed range. The motor's torque-speed curve still drops off at high speed, and the feedback loop cannot create torque that the motor physics cannot deliver. Feedback prevents stalls but does not extend the speed envelope.

## In Practice

- **Closed-loop stepper oscillates around the target position with a ±1 step limit cycle.** The PID output alternates between one step forward and one step backward because the encoder resolution is finer than the step size. Adding a deadband of ±1 step (or ±2 microsteps) around the target eliminates the oscillation without meaningful loss of accuracy.

- **StallGuard triggers during rapid acceleration but not during actual stalls at low speed.** During acceleration, motor current increases and the back-EMF profile changes, causing StallGuard to report a false stall. At low speed (< 100 RPM), StallGuard is insensitive and misses real stalls. This combination makes StallGuard useful for homing (at controlled speed) but unreliable as a general-purpose stall detector.

- **Motor position is accurate for short moves but drifts over long multi-revolution moves.** The encoder-to-step ratio has a calibration error. A 0.1 % ratio error accumulates to one full step every 1000 steps — invisible on short moves but significant on long ones. Correcting the ratio or using the encoder's index pulse to reset the position counter once per revolution eliminates the drift.

- **Closed-loop system draws less power and runs cooler than the same motor in open loop.** With feedback, the controller reduces hold current when the motor is in position and increases it only when the load requires correction. Open-loop operation maintains full current continuously regardless of load. The thermal difference is substantial — 30–50 % lower average power in many applications.
