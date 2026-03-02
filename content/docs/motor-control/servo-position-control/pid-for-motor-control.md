---
title: "PID for Motor Control"
weight: 30
---

# PID for Motor Control

A PID (Proportional–Integral–Derivative) controller is the standard algorithm for closed-loop motor control. It compares the measured position or velocity to the commanded setpoint and computes a drive output that minimizes the error. In motor control, PID loops close the gap between open-loop guesswork and precise, repeatable positioning — but only if they are tuned correctly. A poorly tuned PID produces oscillation, overshoot, or sluggish response that can be worse than no feedback at all.

## PID Equation

The standard discrete-time PID controller:

```
output = Kp × error + Ki × Σ(error × dt) + Kd × Δerror / dt
```

| Term | Effect | Motor Control Role |
|------|--------|-------------------|
| **P** (proportional) | Output proportional to current error | Main driving force toward setpoint |
| **I** (integral) | Output proportional to accumulated error | Eliminates steady-state error (friction, gravity) |
| **D** (derivative) | Output proportional to rate of change of error | Damps overshoot, resists rapid changes |

## Implementation

```c
typedef struct {
    float Kp, Ki, Kd;
    float integral;
    float prev_error;
    float integral_limit;  /* Anti-windup clamp */
    float output_min, output_max;
} pid_t;

float pid_update(pid_t *pid, float setpoint, float measurement, float dt) {
    float error = setpoint - measurement;

    /* Proportional */
    float p_term = pid->Kp * error;

    /* Integral with anti-windup */
    pid->integral += error * dt;
    if (pid->integral > pid->integral_limit) pid->integral = pid->integral_limit;
    if (pid->integral < -pid->integral_limit) pid->integral = -pid->integral_limit;
    float i_term = pid->Ki * pid->integral;

    /* Derivative with low-pass filter */
    float derivative = (error - pid->prev_error) / dt;
    pid->prev_error = error;
    float d_term = pid->Kd * derivative;

    /* Sum and clamp output */
    float output = p_term + i_term + d_term;
    if (output > pid->output_max) output = pid->output_max;
    if (output < pid->output_min) output = pid->output_min;

    return output;
}
```

## Position Loop vs Velocity Loop

### Velocity Control

A single PID loop compares the commanded velocity to the measured velocity (from encoder differentiation) and outputs a PWM duty cycle:

```
Velocity setpoint → [PID] → PWM duty → Motor → Encoder → Velocity feedback
```

### Position Control

A single PID loop compares the commanded position to the measured position and outputs a PWM duty cycle:

```
Position setpoint → [PID] → PWM duty → Motor → Encoder → Position feedback
```

### Cascaded Control (Position + Velocity)

For best performance, an outer position loop generates a velocity command, and an inner velocity loop generates the PWM output:

```
Position setpoint → [Position PID] → Velocity setpoint → [Velocity PID] → PWM duty
                         ↑                                      ↑
                    Position feedback                     Velocity feedback
```

The inner velocity loop runs faster (1–10 kHz) than the outer position loop (100–1000 Hz). This structure prevents overshoot better than a single position loop because the velocity loop limits how fast the motor approaches the target.

## Integral Windup

When the motor is stalled or the output is saturated (maximum PWM), the error persists and the integral term accumulates without bound. When the stall clears, the accumulated integral produces massive overshoot before it unwinds.

**Anti-windup strategies:**

1. **Clamp the integral:** Limit the integral accumulator to a maximum value (shown in the code above)
2. **Conditional integration:** Stop accumulating when the output is saturated
3. **Back-calculation:** Reduce the integral proportionally to the amount of output saturation

```c
/* Conditional integration — don't accumulate when output is saturated */
if (output < pid->output_max && output > pid->output_min) {
    pid->integral += error * dt;
}
```

## Derivative Filtering

The derivative term amplifies noise — encoder quantization noise, electrical interference, and measurement jitter all produce large Δerror values at the sampling rate. A low-pass filter on the derivative term smooths the response:

```c
/* Exponential moving average on derivative */
float alpha = 0.1f;  /* Filter coefficient (0.05–0.2 typical) */
float raw_derivative = (error - pid->prev_error) / dt;
pid->filtered_derivative = alpha * raw_derivative +
                           (1.0f - alpha) * pid->filtered_derivative;
float d_term = pid->Kd * pid->filtered_derivative;
```

Alternatively, compute the derivative on the **measurement** rather than the error to avoid a spike when the setpoint changes:

```c
/* Derivative on measurement (not error) — eliminates setpoint kick */
float derivative = -(measurement - pid->prev_measurement) / dt;
```

## Tuning Guide

### Ziegler-Nichols (Empirical)

1. Set Ki = 0, Kd = 0
2. Increase Kp until the system oscillates with constant amplitude (marginal stability). Record this as Ku (ultimate gain) and the oscillation period as Tu.
3. Apply the Ziegler-Nichols formulas:

| Controller | Kp | Ki | Kd |
|-----------|----|----|-----|
| P only | 0.5 × Ku | 0 | 0 |
| PI | 0.45 × Ku | 0.54 × Ku / Tu | 0 |
| PID | 0.6 × Ku | 1.2 × Ku / Tu | 0.075 × Ku × Tu |

These values are aggressive starting points — typically reduce all gains by 30–50 % for a smoother response.

### Manual Tuning

1. **Start with P only.** Increase Kp until the system responds quickly but overshoots. Back off slightly.
2. **Add I.** Start small (Ki = Kp / 100). Increase until steady-state error is eliminated. Too much I causes slow oscillation.
3. **Add D.** Start small (Kd = Kp × 10 × dt). Increase until overshoot is damped. Too much D causes high-frequency jitter.

## Sample Rate Considerations

| Application | Typical PID Rate | Reasoning |
|------------|-----------------|-----------|
| Velocity control | 1–10 kHz | Must be fast enough to track speed transients |
| Position control | 100–1000 Hz | Mechanical system is slower; higher rates waste CPU |
| Cascaded (inner velocity) | 10–20 kHz | Matched to PWM frequency |
| Cascaded (outer position) | 500–1000 Hz | 5–10× slower than inner loop |

## Tips

- Start tuning with the inner loop (velocity) before the outer loop (position). A well-tuned velocity loop makes position tuning much easier; the reverse is not true.
- Use derivative-on-measurement rather than derivative-on-error. This eliminates the derivative kick when the setpoint changes suddenly (e.g., a new position command).
- Log the setpoint, measurement, error, and output at the PID update rate during tuning. Plotting these signals reveals overshoot, oscillation, and steady-state error patterns that are invisible from motor behavior alone.
- For position control of a DC motor, a reasonable starting point is Kp = 1.0, Ki = 0.1, Kd = 0.01 (units depend on scaling). Adjust from there based on observed response.

## Caveats

- PID tuned at one operating point (speed, load) may oscillate or be sluggish at another. Motor friction, back-EMF, and inertia all change with operating conditions. Gain scheduling (different PID parameters for different speed/load ranges) addresses this.
- Integer overflow in the integral term is a silent failure in fixed-point PID implementations. If the accumulator overflows, the sign flips and the motor suddenly reverses at full speed. Using 32-bit or 64-bit accumulators and clamping prevents this.
- The derivative term computed from encoder counts at low speed produces a staircase signal (zero for several samples, then a spike). This injects high-frequency energy into the output. The low-pass filter on the derivative (or a higher-resolution encoder) is essential at low speeds.
- Mechanical backlash in the gear train creates a dead zone that the PID cannot compensate for — the controller increases output, nothing moves (backlash zone), then the motor suddenly jumps to the new position. Backlash compensation in software or a backlash-free gear train is the fix.

## In Practice

- **Motor oscillates around the target position with decreasing amplitude.** Kp is near the optimal value but Kd is too low to damp the overshoot. Increasing Kd gradually (10 % increments) damps the oscillation. If the oscillation does not decrease (constant amplitude), Kp is at the instability boundary and should be reduced.

- **Motor reaches the target but takes several seconds to settle the last 1–2 counts.** The integral term is too weak to overcome static friction (stiction) quickly. Increasing Ki speeds up the final settling, but excessive Ki causes overshoot on the approach. A common compromise is a deadband of ±1 count at the target, accepting that final count-level precision is not achievable without a higher-resolution encoder.

- **Motor output chatters rapidly between forward and reverse.** The derivative gain is too high and amplifies encoder noise. Each quantization step in the position reading produces a large derivative spike that flips the output direction. Reducing Kd and adding derivative filtering eliminates the chatter.

- **PID works well at low speed but oscillates at high speed.** The phase delay of the sensor and control loop becomes significant at high speed, reducing the system's phase margin. The gains that are stable at low speed push the system past the stability boundary at high speed. Reducing all gains or implementing gain scheduling based on velocity resolves the speed-dependent oscillation.
