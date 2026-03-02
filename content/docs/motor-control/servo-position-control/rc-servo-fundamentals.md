---
title: "RC Servo Fundamentals"
weight: 10
---

# RC Servo Fundamentals

An RC servo is a self-contained position actuator: a small DC motor, a gear train, a position-sensing potentiometer, and a control circuit — all in one package. The control interface is a single PWM signal where the pulse width commands a shaft angle. No encoder, no PID tuning, no motor driver — just a pulse and the servo moves. This simplicity makes RC servos the standard actuator for hobby robotics, pan/tilt camera mounts, valve control, and any application needing moderate-precision angular positioning without a custom servo loop.

## PWM Control Signal

The standard RC servo protocol uses a 50 Hz (20 ms period) PWM signal where only the pulse width carries information:

| Pulse Width | Typical Angle |
|-------------|---------------|
| 1000 µs | −90° (or 0°) |
| 1500 µs | Center (0° or 90°) |
| 2000 µs | +90° (or 180°) |

The actual range varies by manufacturer. Many servos accept pulses from 500–2500 µs for a full 180° range; some are restricted to 1000–2000 µs for 120° or less.

```c
/* STM32 — 50 Hz servo PWM on TIM3 CH1 */
htim3.Init.Prescaler = 71;        /* 72 MHz / 72 = 1 MHz tick */
htim3.Init.Period = 19999;        /* 20 ms period */
HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);

/* Set position (angle 0–180°) */
uint16_t pulse_us = 1000 + (angle * 1000 / 180);  /* 1000–2000 µs */
__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, pulse_us);
```

```cpp
/* Arduino — using Servo library */
#include <Servo.h>
Servo myservo;
myservo.attach(9);       /* Pin 9 */
myservo.write(90);       /* Center position */
myservo.writeMicroseconds(1500);  /* Same, but explicit µs */
```

## Analog vs Digital Servos

| Feature | Analog | Digital |
|---------|--------|---------|
| Internal update rate | 50 Hz (matches input) | 300–400 Hz (internal PID loop) |
| Holding torque | Lower (updates at 50 Hz) | Higher (faster correction) |
| Response speed | Slower initial movement | Faster initial response |
| Power consumption at idle | Lower | Higher (constant correction) |
| Deadband | 4–8 µs | 1–2 µs (more precise) |
| Price | Lower | Higher |
| Buzzing at rest | Rare | Common (high-frequency corrections) |

Digital servos run their internal control loop at a much higher rate than the incoming PWM signal. This means they resist external disturbances better (stiffer) but draw more idle current doing so.

## Key Specifications

| Parameter | Budget Servo (SG90) | Mid-Range (MG996R) | High-End (Savox SH-1250MG) |
|-----------|-------------------|-------------------|---------------------------|
| Torque at 6 V | 1.8 kg·cm | 11 kg·cm | 8 kg·cm |
| Speed (60° at 6 V) | 0.12 s | 0.14 s | 0.07 s |
| Weight | 9 g | 55 g | 33 g |
| Gear material | Nylon | Metal | Metal |
| Bearing | Bushing | Bushing | Dual ball bearing |
| Rotation range | ~180° | ~180° | ~180° |
| Voltage range | 4.8–6 V | 4.8–7.2 V | 6–7.4 V |

**Torque units:** Servo torque is conventionally specified in kg·cm (kilogram-force × centimeters). To convert: 1 kg·cm ≈ 0.098 N·m.

## Power Supply Considerations

Servos draw significant current during motion — stall current on a standard-size servo can reach 1–2 A, and a sudden direction change can spike much higher:

| Scenario | Current Draw (typical) |
|----------|----------------------|
| Idle (holding position) | 10–50 mA |
| Moving (no load) | 100–300 mA |
| Moving (moderate load) | 300–800 mA |
| Stall | 1.0–2.5 A |

**Never power servos from the MCU's 5 V regulator.** The current draw exceeds what USB or LDO regulators can provide, and the voltage sag on the rail can brown-out the MCU. Use a dedicated servo power supply (5–6 V BEC, or a bench supply) with the ground connected to the MCU ground.

### Multi-Servo Power

Multiple servos amplify the supply challenge. Six servos moving simultaneously can draw 3–5 A total. Size the supply wiring and capacitance accordingly:

- Use 18 AWG or heavier wire for the servo power bus
- Add 470–1000 µF electrolytic at the power distribution point
- Add 100 µF at each servo connector if the bus length exceeds 20 cm

## Continuous-Rotation Servos

A modified servo with the position feedback potentiometer disconnected (or replaced with fixed resistors) becomes a continuous-rotation motor:

| Pulse Width | Behavior |
|-------------|----------|
| 1000 µs | Full speed, one direction |
| 1500 µs | Stop (or near-stop) |
| 2000 µs | Full speed, opposite direction |

Continuous-rotation servos are not position-controllable — the pulse width sets speed and direction, not angle. They are useful for small wheeled robots but have poor speed precision (dead band around center is typically ±20 µs).

## Tips

- Use `writeMicroseconds()` instead of `write(angle)` on Arduino for finer control. The angle-to-µs mapping in the Servo library may not match the servo's actual range, and microsecond control avoids this abstraction.
- Test the servo's actual range by slowly sweeping from 500–2500 µs and noting where it hits the mechanical end stop. Commanding a position beyond the end stop stalls the motor and draws continuous high current.
- Place a 100 µF capacitor directly across each servo's power pins to buffer current transients. This prevents voltage dips that cause the servo to reset or jitter.
- For smooth motion, ramp the commanded position over time rather than jumping directly to the target. A 1–2 ms update interval with 1–5 µs per step produces visually smooth movement.

## Caveats

- Cheap servos (SG90, MG90S) have significant gear backlash — typically 2–4° of free play. This limits effective positioning accuracy regardless of the PWM resolution.
- Servo jitter (small oscillation at rest) is caused by noise on the PWM signal, a noisy power supply, or the servo's internal deadband being narrower than the PWM noise floor. Clean power and a stable timer-generated PWM minimize jitter.
- Servos have no feedback to the MCU — there is no way to confirm that the shaft actually reached the commanded position. If the load exceeds the stall torque, the servo stalls silently.
- The 50 Hz update rate is a convention, not a strict requirement for most servos. Many servos respond correctly at 100–330 Hz (faster update rate), but some older analog servos expect exactly 50 Hz and misbehave at other rates.

## In Practice

- **Servo jitters continuously at rest.** The PWM signal has timing noise wider than the servo's deadband (typically 4–8 µs for analog, 1–2 µs for digital). This commonly appears when PWM is generated by software (bit-bang, `delay()`-based) or when the power supply has ripple. Switching to hardware timer PWM and adding capacitors on the servo supply eliminates the jitter.

- **Servo moves to the correct position but buzzes audibly.** This is characteristic of digital servos — the high-frequency internal PID loop continuously corrects for tiny position errors. If the load creates a spring-back force, the servo fights it at hundreds of Hz. Reducing the load or accepting the buzz as normal for digital servos is typical. Some high-end servos have a configurable deadband to reduce this.

- **Multiple servos cause the MCU to reset when they move simultaneously.** The combined inrush current sags the power rail below the MCU's brownout threshold. The servos and MCU share a power source without sufficient decoupling. A separate power supply for servos (with common ground to MCU) eliminates the resets.

- **Servo position drifts over several degrees after an hour of operation.** The internal potentiometer wears or heats up, changing its resistance and shifting the feedback reference. This is a known failure mode of cheap servos under continuous duty. Replacing with a higher-quality servo with a longer-life potentiometer — or switching to a proper servo motor with encoder — addresses long-term drift.
