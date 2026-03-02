---
title: "Step/Direction Interface"
weight: 20
---

# Step/Direction Interface

The step/direction interface is the standard control protocol between a microcontroller and a stepper driver IC. Two signals control motion: a **STEP** pulse advances the motor by one (micro)step, and a **DIR** level sets the rotation direction. A third signal, **ENABLE**, activates or deactivates the driver's output stage. This simple protocol decouples motion planning in firmware from the power electronics in the driver, and it is used by virtually every stepper driver from the A4988 to industrial servo drives.

## Signal Definitions

| Signal | Type | Function |
|--------|------|----------|
| STEP | Rising-edge triggered | Each rising edge advances one step |
| DIR | Level (high/low) | Sets rotation direction; must be stable before STEP edge |
| ENABLE | Level (active low, typically) | Low = outputs active; High = outputs disabled (motor coasts) |

## Pulse Timing Requirements

Every driver has minimum timing specifications for the step/direction interface:

| Parameter | A4988 | DRV8825 | TMC2209 |
|-----------|-------|---------|---------|
| Minimum STEP pulse width (high) | 1 µs | 1.9 µs | 100 ns |
| Minimum STEP pulse width (low) | 1 µs | 1.9 µs | 100 ns |
| DIR setup time before STEP | 200 ns | 650 ns | 20 ns |
| Maximum step frequency | 500 kHz | 250 kHz | 2+ MHz |

The DRV8825 is notably slow — its 1.9 µs minimum pulse width limits the maximum step rate to ~250 kHz (250,000 microsteps/s). At 1/16 microstepping, this is 15,625 full steps/s or ~4,687 RPM for a 200-step motor — usually not a practical limitation, but it can limit very high-speed applications.

## Timer-Based Step Generation (STM32)

For precise and consistent step timing, use a hardware timer in output compare mode:

```c
/* TIM2 Channel 1 generating step pulses on PA0 */
/* Target: 1000 steps/s → 1 ms period, 5 µs pulse width */
htim2.Instance = TIM2;
htim2.Init.Prescaler = 71;           /* 72 MHz / 72 = 1 MHz tick */
htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
htim2.Init.Period = 999;             /* 1000 µs = 1 kHz step rate */
HAL_TIM_Base_Init(&htim2);

TIM_OC_InitTypeDef sConfigOC = {0};
sConfigOC.OCMode = TIM_OCMODE_PWM1;
sConfigOC.Pulse = 5;                 /* 5 µs pulse width */
sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
HAL_TIM_PWM_ConfigChannel(&htim2, &sConfigOC, TIM_CHANNEL_1);
HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1);
```

Changing the step rate means updating the timer's auto-reload register (ARR). For acceleration profiles, the ARR is updated in a timer interrupt at each step.

### Changing Speed

```c
/* Update step rate to 2000 steps/s */
__HAL_TIM_SET_AUTORELOAD(&htim2, 499);  /* 500 µs period */
```

## GPIO Bit-Bang Step Generation (Arduino)

For simpler applications, direct GPIO toggling works but is less timing-precise:

```cpp
void step_motor(int steps, int delay_us) {
    for (int i = 0; i < steps; i++) {
        digitalWrite(STEP_PIN, HIGH);
        delayMicroseconds(5);           // Pulse width
        digitalWrite(STEP_PIN, LOW);
        delayMicroseconds(delay_us);    // Step period
    }
}
```

This blocks the main loop during motion. For non-blocking operation, use a timer interrupt or the AccelStepper library.

## Enable/Disable Behavior

When ENABLE is deasserted (typically driven high), the driver disables its output MOSFETs and the motor is free to rotate — there is no holding torque. This saves power and reduces heat but loses position certainty.

Common patterns:
- **Always enabled:** Maximum holding torque; motor runs hot at idle.
- **Disable after timeout:** Reduce current or disable entirely after motion completes and a hold period elapses. Risk: external forces can move the shaft while disabled.
- **Current reduction:** Some drivers (TMC2209) support reducing hold current to 50 % automatically after motion stops, rather than fully disabling. This maintains some holding torque at lower power.

## Step Counting and Position Tracking

In an open-loop stepper system, the firmware must track position by counting steps. Every step pulse increments or decrements a position counter based on the DIR signal state:

```c
volatile int32_t position_steps = 0;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM2) {
        if (HAL_GPIO_ReadPin(DIR_PORT, DIR_PIN) == GPIO_PIN_SET)
            position_steps++;
        else
            position_steps--;
    }
}
```

This counter is the only position reference — if steps are lost (due to stall, electrical noise, or missed pulses), the position drifts with no indication from the driver. Closed-loop systems with encoder feedback address this (see [Closed-Loop Stepper & Servo]({{< relref "../servo-position-control/closed-loop-stepper-and-servo" >}})).

## Tips

- Set the DIR pin at least 1 µs before the STEP edge, even if the datasheet specifies less. This margin costs nothing and avoids direction glitches caused by signal propagation on long wires.
- Use hardware timers for step generation whenever possible. GPIO bit-banging in a main loop produces uneven step timing when interrupts fire, causing audible irregularities and potentially missed steps at high speeds.
- Pull the ENABLE pin high through a 10 kΩ resistor to ensure the driver starts disabled. Floating enable pins can cause the motor to energize and jump on power-up.
- Keep STEP and DIR wires short (< 30 cm) or use differential signaling for longer cable runs. Capacitive loading on long wires slows edges and can fail to meet the driver's minimum pulse width.

## Caveats

- The DRV8825 requires 1.9 µs minimum pulse width — nearly 2× the A4988. Code written for the A4988 that uses `delayMicroseconds(1)` may produce pulses too short for the DRV8825, resulting in missed steps with no error indication.
- Changing DIR while a STEP pulse is high violates timing requirements on most drivers. The direction change may or may not be registered, depending on the internal latch timing — an intermittent failure that is difficult to diagnose.
- The ENABLE pin on most stepper drivers does not provide a controlled deceleration — it simply cuts power. If the motor is spinning at high speed when disabled, momentum carries the shaft past the intended stop point.
- Step frequency limits in datasheets are electrical maximums. The motor's torque-speed curve drops off well before the driver's maximum rate. A motor that stalls at 1000 RPM cannot be driven to 5000 RPM just because the driver supports the step frequency.

## In Practice

- **Motor occasionally misses a step during long moves but works fine for short moves.** Electrical noise on the STEP line from nearby motor wiring causes extra edges that the driver counts as steps. The problem accumulates over long moves. Routing STEP and DIR away from motor power wires and adding a 1 nF capacitor on the STEP input filters the noise.

- **Motor direction reverses unexpectedly mid-move.** The DIR line picks up a transient from the STEP signal (crosstalk) and briefly changes state. This is most likely with long parallel wires between the MCU and the driver. Separating the signal lines or using shielded cable eliminates the coupling.

- **Motor moves the correct number of steps but final position is off by one step.** The DIR pin changes state too close to the STEP edge, violating the setup time. The last (or first) step executes in the wrong direction. Adding a delay between setting DIR and the first STEP pulse corrects the positioning.

- **Motor makes a grinding noise at high step rates.** The requested step frequency exceeds the motor's torque-speed capability at the current load and supply voltage. Reducing the maximum speed or increasing the supply voltage (within driver limits) allows the motor to keep up.
