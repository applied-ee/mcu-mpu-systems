---
title: "PWM Speed Control"
weight: 10
---

# PWM Speed Control

A brushed DC motor's speed is approximately proportional to the average voltage across its terminals. Rather than varying a supply voltage directly — which wastes power as heat in a linear regulator — the standard embedded approach is pulse-width modulation: a transistor switches the full supply voltage on and off at a fixed frequency, and the motor's inductance smooths the pulsed current into a nearly steady flow. The duty cycle sets the effective voltage, and therefore the speed.

## PWM Frequency Selection

The choice of PWM frequency involves three competing constraints:

| Frequency Range | Behavior |
|----------------|----------|
| < 1 kHz | Audible whine; coil vibration; jerky motion at low duty cycles |
| 1–5 kHz | Reduced audible noise; still possible hum with some motors |
| 5–25 kHz | Above human hearing; good balance of switching loss and smoothness |
| > 25 kHz | Inaudible; increased switching losses in the MOSFET; may require faster gate drive |

For most small brushed DC motors (< 5 A), 20 kHz is a practical default. This is above the audible range, keeps switching losses manageable in logic-level MOSFETs, and works well with the electrical time constants of typical hobby and industrial motors (L/R ~ 0.5–5 ms).

The motor's electrical time constant τ = L/R determines how much current ripple a given PWM frequency produces. If the PWM period is much shorter than τ, current ripple is small and the motor sees nearly DC. If the period approaches τ, ripple increases and the motor may vibrate or run hot.

## Duty Cycle to Speed

The idealized relationship is:

```
Speed ≈ (Duty Cycle) × (Supply Voltage − I×R_winding) / K_V
```

In practice, the linear region holds from roughly 10–90 % duty cycle. Below ~10 %, friction and cogging torque prevent rotation. Above ~90 %, the motor approaches no-load speed and further duty cycle increase yields diminishing returns.

### STM32 HAL Example — Timer-Based PWM

```c
/* TIM3 Channel 1, 20 kHz PWM on PA6 */
htim3.Instance = TIM3;
htim3.Init.Prescaler = 0;
htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
htim3.Init.Period = (SystemCoreClock / 20000) - 1;  /* 20 kHz */
htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
HAL_TIM_PWM_Init(&htim3);

TIM_OC_InitTypeDef sConfigOC = {0};
sConfigOC.OCMode = TIM_OCMODE_PWM1;
sConfigOC.Pulse = 0;  /* Start at 0 % duty */
sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;
HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_1);
HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);

/* Set duty cycle (0–100 %) */
__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1,
    (duty_pct * htim3.Init.Period) / 100);
```

### Arduino Example

```cpp
// Pin 9 (Timer1 on Uno) — set to ~20 kHz using ICR1
TCCR1A = _BV(COM1A1) | _BV(WGM11);
TCCR1B = _BV(WGM13) | _BV(WGM12) | _BV(CS10);  // No prescaler
ICR1 = 799;  // 16 MHz / 20 kHz = 800 counts
OCR1A = 0;   // Start at 0 % duty

// Set duty cycle
OCR1A = (uint16_t)((duty_pct * 799UL) / 100);
```

## Low-Side vs High-Side Switching

**Low-side switching** places the MOSFET between the motor and ground. The gate is referenced to ground, making it easy to drive from a microcontroller GPIO. This is the simplest topology and works well for unidirectional control.

```
V_motor ──┬── Motor ──┬── MOSFET (drain)
          │           │
          │           └── MOSFET (source) ── GND
          │
          └── Flyback diode ── GND
```

**High-side switching** places the MOSFET between the supply and the motor. This keeps the motor terminal grounded when off (useful for safety and braking), but requires a gate voltage higher than the supply rail — typically provided by a charge pump or bootstrap circuit. P-channel MOSFETs can simplify high-side switching for lower-voltage applications (< 20 V), but have higher RDS(on) than equivalent N-channel devices.

| Topology | Gate Drive | Grounding | Typical Use |
|----------|-----------|-----------|-------------|
| Low-side N-FET | Simple (logic-level) | Motor floats when off | Single-direction, cost-sensitive |
| High-side P-FET | Inverted logic, limited to low voltage | Motor grounded when off | < 20 V, moderate current |
| High-side N-FET + bootstrap | Requires gate driver IC | Motor grounded when off | H-bridge, high performance |

## Soft Start

Ramping the duty cycle from 0 % to the target value over 50–200 ms limits inrush current and reduces mechanical stress on gears and couplings. A simple linear ramp in the control loop is sufficient for most applications:

```c
for (uint16_t dc = 0; dc <= target_duty; dc += 2) {
    __HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1,
        (dc * htim3.Init.Period) / 100);
    HAL_Delay(5);  /* 5 ms per step → ~250 ms to full speed */
}
```

## Tips

- 20 kHz is a safe starting frequency for motors under 5 A. If audible whine persists, the motor's mechanical resonance may be near the PWM frequency — shifting up to 25 kHz usually eliminates it.
- Use the timer's auto-reload preload (ARPE) on STM32 to ensure glitch-free duty cycle updates. Without preload, changing the compare register mid-period can produce a runt pulse.
- Measure actual motor current at 100 % duty before selecting the MOSFET. Stall current — not running current — determines the worst-case thermal load on the switch.
- Keep the PWM wire between the MCU and the gate driver short. Long runs pick up noise and slow edge rates, increasing switching losses.

## Caveats

- Running a MOSFET at 50 kHz with a slow gate driver can produce enough switching loss to overheat the FET even if RDS(on) losses are acceptable. Always check both conduction and switching losses.
- analogWrite() on AVR defaults to ~490 Hz or ~980 Hz depending on the timer — far too low for smooth motor control. Direct timer register configuration is necessary for frequencies above a few kHz.
- At very low duty cycles (< 5 %), the on-time may be shorter than the MOSFET's turn-on time plus the gate driver's propagation delay. The switch never fully enhances, and it dissipates power in the linear region instead of switching cleanly.
- PWM frequency is not infinitely adjustable on most timers. The achievable frequencies depend on the timer clock and the counter resolution — a 72 MHz timer with a 16-bit counter can hit 20 kHz with ~3600 counts of duty cycle resolution, but a 16 MHz timer at the same frequency gives only 800 counts (~10-bit resolution).

## In Practice

- **Audible whine from the motor at a specific duty cycle** often indicates that the PWM frequency coincides with a mechanical resonance of the motor or its mount. Shifting the frequency by even 1–2 kHz can eliminate the noise entirely without affecting speed control.

- **Motor vibrates but does not spin at low duty cycles.** The applied voltage is below the threshold needed to overcome static friction and cogging torque. Increasing the minimum commanded duty to 10–15 % (or implementing a kick-start pulse) resolves this.

- **MOSFET runs warm even at low duty cycles.** This commonly appears when the gate voltage is too low for full enhancement — the FET operates in its linear region, dissipating power as heat. Logic-level MOSFETs (VGS(th) ≤ 2.0 V) or a dedicated gate driver eliminates the issue with 3.3 V MCU outputs.

- **Motor speed changes noticeably when load varies.** Without closed-loop control, a brushed DC motor slows under load because the increased current raises the I×R drop across the winding, reducing back-EMF and therefore speed. Adding current or speed feedback is the standard fix for load-dependent speed regulation.
