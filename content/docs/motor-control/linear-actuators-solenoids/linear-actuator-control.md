---
title: "Linear Actuator Control"
weight: 20
---

# Linear Actuator Control

A linear actuator converts rotary motor motion into linear push/pull motion — typically using a DC motor driving a leadscrew or ball screw inside a sealed tube. The external interface is two wires (motor+ and motor−), and the actuator extends or retracts depending on polarity. Stroke lengths range from 50 mm to 1000+ mm, with force ratings from 50 N (light duty) to 10,000+ N (industrial). From the embedded control perspective, a linear actuator is a bidirectional DC motor with end stops — the control circuitry is an H-bridge, and the primary challenges are knowing the current position and protecting the actuator at end of travel.

## Actuator Types

| Type | Internal Mechanism | Speed | Force | Backdrivability |
|------|-------------------|-------|-------|----------------|
| Acme screw | Trapezoidal leadscrew | Slow (5–30 mm/s) | High (500–10,000 N) | Non-backdrivable (holds position without power) |
| Ball screw | Recirculating ball bearing screw | Fast (10–100 mm/s) | High | Backdrivable (needs brake to hold) |
| Belt/rack | Belt or rack and pinion | Fast (50–500 mm/s) | Low–medium | Backdrivable |

Most embedded applications use acme-screw actuators because they hold position when unpowered — an important safety feature for adjustable furniture, valves, and platforms.

## H-Bridge Drive

Linear actuators are driven identically to brushed DC motors:

```c
/* Extend actuator */
void actuator_extend(uint8_t speed_pct) {
    HAL_GPIO_WritePin(DIR_A_PORT, DIR_A_PIN, GPIO_PIN_SET);
    HAL_GPIO_WritePin(DIR_B_PORT, DIR_B_PIN, GPIO_PIN_RESET);
    __HAL_TIM_SET_COMPARE(&htim_pwm, TIM_CHANNEL_1,
        (speed_pct * htim_pwm.Init.Period) / 100);
}

/* Retract actuator */
void actuator_retract(uint8_t speed_pct) {
    HAL_GPIO_WritePin(DIR_A_PORT, DIR_A_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(DIR_B_PORT, DIR_B_PIN, GPIO_PIN_SET);
    __HAL_TIM_SET_COMPARE(&htim_pwm, TIM_CHANNEL_1,
        (speed_pct * htim_pwm.Init.Period) / 100);
}

/* Stop actuator (brake) */
void actuator_stop(void) {
    HAL_GPIO_WritePin(DIR_A_PORT, DIR_A_PIN, GPIO_PIN_RESET);
    HAL_GPIO_WritePin(DIR_B_PORT, DIR_B_PIN, GPIO_PIN_RESET);
    __HAL_TIM_SET_COMPARE(&htim_pwm, TIM_CHANNEL_1, 0);
}
```

Integrated H-bridge ICs (DRV8871, BTS7960, IBT-2) are commonly used. Size the driver for the actuator's stall current — an actuator rated at 3 A running current may draw 8–15 A at stall or end stop.

## Limit Switch Integration

Most linear actuators have internal or external limit switches at full extension and full retraction:

```
         ┌───────── Actuator motor ─────────┐
         │                                   │
    SW_retract                           SW_extend
    (NC contact)                         (NC contact)
         │                                   │
    ─────┘                               ────┘
```

### Internal Limit Switches

Many actuators include built-in limit switches wired in series with the motor. At end of travel, the switch opens and the motor stops — no firmware intervention required. The MCU can detect the stop by monitoring current (drops to zero) or by reading the switch contacts if they are accessible.

### External Limit Switches

For actuators without internal switches, external microswitches or inductive proximity sensors at each end of travel provide the stop signal:

```c
/* Monitor limit switches — stop motor at end of travel */
void actuator_safety_check(void) {
    if (direction == EXTENDING &&
        HAL_GPIO_ReadPin(LIMIT_EXT_PORT, LIMIT_EXT_PIN) == GPIO_PIN_SET) {
        actuator_stop();
    }
    if (direction == RETRACTING &&
        HAL_GPIO_ReadPin(LIMIT_RET_PORT, LIMIT_RET_PIN) == GPIO_PIN_SET) {
        actuator_stop();
    }
}
```

## Position Feedback

### Potentiometer Feedback

Many linear actuators include a built-in potentiometer (10 kΩ typical) that varies linearly with stroke position:

```c
/* Read actuator position from built-in potentiometer */
uint16_t adc_raw = HAL_ADC_GetValue(&hadc1);
float position_mm = (float)adc_raw / 4095.0f * STROKE_LENGTH_MM;
```

Calibrate by reading the ADC at both ends of travel and mapping linearly between them.

### Current-Based Position Estimation

Without a position sensor, current monitoring provides rough position information:
- **Current spike at end of travel:** The motor stalls against the limit, and current rises sharply. Detecting this spike (> 2× running current for > 100 ms) indicates the actuator has reached the end.
- **Runtime-based estimation:** At a known speed (mm/s), elapsed time approximates position. Accuracy degrades with load variation.

```c
/* Detect end-of-travel via current sensing */
float i_motor = read_motor_current();
if (i_motor > STALL_CURRENT_THRESHOLD && motion_time > MIN_MOTION_TIME) {
    actuator_stop();
    /* Actuator has reached end of travel */
}
```

## Tips

- Always implement current-based stall detection as a safety backup, even when limit switches are present. A broken limit switch wire allows the motor to stall at the end stop, drawing high current continuously until something overheats or fails.
- Add a soft-start ramp (0 to full PWM over 100–200 ms) to reduce inrush current and mechanical stress on the leadscrew and gear train.
- For position control with a potentiometer, use a PID loop with a generous deadband (±1–2 mm). The potentiometer noise and leadscrew backlash make sub-millimeter precision unrealistic with this feedback method.
- Run the actuator to both limits during initialization to establish reference positions. This calibration step accounts for potentiometer drift and mounting tolerances.

## Caveats

- Linear actuators have a maximum duty cycle, typically 25 % for low-cost units (1 minute on, 3 minutes off). Exceeding this limit overheats the internal DC motor, which has no airflow inside the sealed tube. Continuous-duty actuators exist but are larger and more expensive.
- The stall current at end of travel can be 3–5× the running current. If the firmware fails to stop the motor when a limit is reached, the current flows continuously through the stalled motor and driver. Thermal protection (driver IC or fuse) is the last line of defense.
- Potentiometer feedback linearity is typically ±2–3 % of full stroke. At the very ends of travel, the potentiometer may have a dead zone where position changes do not register.
- Reversing an actuator under load (e.g., extending against a spring that is pushing back, then retracting) produces a current spike as the motor transitions from driving against the load to being driven by it. The H-bridge must handle this regenerative current safely.

## In Practice

- **Actuator extends but does not retract (or vice versa).** One side of the H-bridge has failed — an open MOSFET or a blown driver output. The motor receives voltage in one polarity but not the other. Measuring voltage across the motor terminals in both directions reveals the dead side.

- **Actuator stops short of full extension.** The internal limit switch has shifted, the potentiometer calibration drifted, or the load increased enough to stall the motor before reaching the end. Current monitoring during the move shows whether the motor stalled (high current) or the switch tripped (current drops to zero).

- **Position reading from the potentiometer is noisy and jumps by ±5 mm.** The ADC reference voltage is noisy, the potentiometer wiper has a dirty spot, or motor switching noise couples into the ADC input. Adding a 10 µs ADC sample time, a 100 nF filter capacitor on the pot output, and averaging 8–16 ADC samples reduces the noise to ±1 mm.

- **Actuator overheats after 5 minutes of continuous operation.** The duty cycle rating is exceeded. The sealed tube traps heat, and the internal motor (typically a small brushed DC motor) reaches its thermal limit. Implementing a duty cycle timer in firmware (stop for 3× the run time) prevents overheating, though it limits the application's responsiveness.
