---
title: "Acceleration Profiles"
weight: 40
---

# Acceleration Profiles

A stepper motor cannot instantly jump from standstill to high speed — the rotor has inertia, and the available torque decreases as speed increases. If the step rate ramps too quickly, the rotor cannot keep up with the rotating magnetic field and the motor stalls. Acceleration profiles define how the step rate changes over time, balancing move speed against the risk of stall and the mechanical smoothness required by the application.

## Maximum Start Rate

The **maximum start rate** (or start/stop speed) is the highest step frequency at which the motor can start from rest without ramping. It depends on rotor inertia, load inertia, and the motor's holding torque:

| Motor Size | Typical Max Start Rate (full step) | Notes |
|-----------|-----------------------------------|-------|
| NEMA 14 | 500–1000 steps/s | Low inertia, light loads |
| NEMA 17 | 200–500 steps/s | Standard 3D printer / CNC |
| NEMA 23 | 100–300 steps/s | Higher inertia, heavier loads |

At microstepping, multiply by the microstep divisor: a NEMA 17 at 1/16 microstepping can start at ~3200–8000 microsteps/s (200–500 full steps/s).

Starting above the maximum start rate causes the motor to stall immediately — the rotor never synchronizes with the stepping sequence.

## Trapezoidal Profile

The simplest acceleration profile ramps the step rate linearly from the start rate to the target speed, holds at the target speed (cruise phase), and then decelerates linearly to a stop:

```
Speed
  │         ┌────────────────┐
  │        /                  \
  │       /                    \
  │      /                      \
  │─────/                        \─────
  └──────────────────────────────────── Time
   Start  Accel   Cruise   Decel  Stop
```

### Implementation with Timer Period Updates

Each step interrupt recalculates the timer period based on the current speed:

```c
/* Trapezoidal acceleration — called on each step interrupt */
volatile uint32_t current_speed = START_SPEED;  /* steps/s */
volatile uint32_t target_speed  = 5000;         /* steps/s */
volatile uint32_t accel_rate    = 10000;        /* steps/s² */
volatile int32_t  steps_remaining;
volatile int32_t  decel_steps;

void step_isr(void) {
    steps_remaining--;

    /* Calculate steps needed to decelerate from current speed */
    decel_steps = (current_speed * current_speed) / (2 * accel_rate);

    if (steps_remaining <= decel_steps) {
        /* Deceleration phase */
        current_speed -= accel_rate / current_speed;
        if (current_speed < START_SPEED) current_speed = START_SPEED;
    } else if (current_speed < target_speed) {
        /* Acceleration phase */
        current_speed += accel_rate / current_speed;
        if (current_speed > target_speed) current_speed = target_speed;
    }

    /* Update timer period */
    uint32_t period = TIMER_FREQ / current_speed;
    __HAL_TIM_SET_AUTORELOAD(&htim2, period - 1);
}
```

### Constant-Acceleration Step Timing (David Austin Algorithm)

For exact constant-acceleration profiles, the time between steps follows:

```
t_n = t_0 × (√(n+1) − √n)
```

Where t_0 is the initial step interval and n is the step number. This is computationally expensive with square roots. The approximation by David Austin uses:

```
c_n = c_{n-1} − (2 × c_{n-1}) / (4n + 1)
```

Where c_n is the timer count for step n. This converges on constant acceleration using only integer arithmetic.

```c
/* Austin algorithm — integer-only acceleration */
int32_t c = c0;  /* Initial interval (timer counts) */
int32_t n = 0;

void step_isr(void) {
    n++;
    c = c - (2 * c) / (4 * n + 1);
    if (c < c_min) c = c_min;  /* Clamp to max speed */
    __HAL_TIM_SET_AUTORELOAD(&htim2, c - 1);
}
```

## S-Curve Profile

An S-curve profile replaces the abrupt acceleration changes (jerk) at the start and end of a trapezoidal ramp with smooth transitions. The acceleration itself ramps up and down, producing a velocity profile with smooth second derivatives:

```
Speed
  │         ╭────────────────╮
  │        ╱                  ╲
  │       ╱                    ╲
  │      ╱                      ╲
  │─────╱                        ╲─────
  └──────────────────────────────────── Time
```

S-curves reduce mechanical vibration and stress on couplings and belts but are more complex to implement. The profile has seven segments: jerk-up, constant accel, jerk-down, cruise, jerk-up (decel), constant decel, jerk-down (stop).

For most embedded stepper applications, trapezoidal profiles are sufficient. S-curves are used in high-performance CNC, robotics, and applications with flexible mechanical systems.

## Stall Avoidance

Stalling occurs when the load torque exceeds the motor's available torque at the current speed. The torque-speed curve of a stepper motor drops off rapidly above a certain speed (the pull-out torque curve). Practical acceleration rates must stay within this envelope:

- **Conservative rule:** Limit acceleration to use no more than 50 % of available torque for acceleration, leaving 50 % for the load.
- **Empirical tuning:** Start with low acceleration (1000 steps/s²), increase until stalling is observed, then back off by 20–30 %.
- **Load-dependent:** The required deceleration margin increases with heavier or more variable loads.

### TMC2209 StallGuard

The TMC2209 includes StallGuard — a sensorless stall detection feature that monitors back-EMF through the driver FETs. When the motor stalls or approaches stall, the StallGuard value drops below a configurable threshold, triggering the DIAG output pin:

```c
/* TMC2209 UART configuration for StallGuard */
tmc2209_write_register(SGTHRS, 50);  /* StallGuard threshold (0–255) */
/* DIAG pin goes high when SG_RESULT < 2 × SGTHRS */
```

StallGuard works reliably above ~100 RPM but is unreliable at low speeds where back-EMF is minimal.

## Tips

- Start with a trapezoidal profile and the David Austin algorithm. This handles 90 % of stepper applications with minimal firmware complexity.
- Always include a deceleration phase. Stopping a stepper instantly at high speed can cause the motor to overshoot by multiple steps — the rotor's inertia carries it past the intended position.
- Test acceleration with the actual mechanical load, not just the motor alone. The motor-only stall speed is much higher than the stall speed with a leadscrew, belt, and workpiece attached.
- For very short moves where the motor never reaches cruise speed, the profile becomes a triangle (accel → immediate decel). The firmware must detect when the move distance is too short for full acceleration and compute the peak speed accordingly.

## Caveats

- The mid-band resonance of stepper motors (typically 500–2000 steps/s at full step) causes a torque dip that can trigger stalls during acceleration through this range. Accelerating quickly through the resonance band — rather than trying to cruise within it — avoids the problem.
- Integer overflow is a real risk in step-timing calculations. At high step rates, the timer period is small, and the acceleration correction term (2c / (4n+1)) can underflow. Using 32-bit or 64-bit arithmetic for intermediate calculations prevents silent errors.
- The Austin algorithm produces a slight acceleration error (< 0.5 %) on the first few steps. For most applications this is negligible, but precision motion systems may need a corrected initial value.
- StallGuard sensitivity varies with motor speed, temperature, and microstep mode. The threshold requires tuning for each specific motor and load combination — a value that works at one speed may false-trigger or miss stalls at another.

## In Practice

- **Motor stalls only during the first few steps of a move.** The initial acceleration exceeds the motor's start-rate capability. The rotor never synchronizes with the stepping, so it vibrates instead of rotating. Reducing the initial step rate or lowering the acceleration resolves the stall.

- **Motor stalls at a specific speed during acceleration, then runs fine if manually helped past that speed.** This is the mid-band resonance. The motor has a torque dip at this speed that causes it to lose synchronization. Increasing the acceleration to pass through the resonance zone quickly — or adding mechanical damping — eliminates the stall.

- **Move distance is consistently short by 1–2 steps.** The deceleration calculation does not account for the exact number of steps remaining, and the motor stops one or two steps early. Using the decel_steps formula (v² / 2a) correctly and handling the rounding ensures the motor reaches the target position.

- **Motor makes a clunking noise at the start and end of each move.** The abrupt acceleration change (jerk) at the transition between acceleration and cruise excites mechanical resonance in the belt or coupling. Switching to an S-curve profile or adding a short jerk-limiting ramp at each transition smooths the mechanical impact.
