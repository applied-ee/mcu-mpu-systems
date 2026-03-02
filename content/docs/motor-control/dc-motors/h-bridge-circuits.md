---
title: "H-Bridge Circuits"
weight: 20
---

# H-Bridge Circuits

An H-bridge is four switches arranged in an "H" topology around a motor, allowing current to flow through the motor in either direction. By activating diagonal pairs of switches, the bridge reverses the motor's polarity without changing the supply wiring. This is the standard circuit for bidirectional DC motor control, and it appears in everything from toy cars to industrial drives.

## Basic H-Bridge Topology

```
        V+
        │
   ┌────┴────┐
   │         │
 Q1(HS)    Q3(HS)
   │         │
   ├── Motor ─┤
   │         │
 Q2(LS)    Q4(LS)
   │         │
   └────┬────┘
        │
       GND
```

| State | Q1 | Q2 | Q3 | Q4 | Motor |
|-------|----|----|----|----|-------|
| Forward | ON | OFF | OFF | ON | CW rotation |
| Reverse | OFF | ON | ON | OFF | CCW rotation |
| Brake (low-side) | OFF | ON | OFF | ON | Shorted to GND — dynamic braking |
| Coast | OFF | OFF | OFF | OFF | Freewheeling — motor coasts |

## Shoot-Through Protection

If both the high-side and low-side switches in the same leg turn on simultaneously, a dead short appears across the supply — often called shoot-through. This can destroy MOSFETs in microseconds. Protection requires **dead time**: a brief interval (typically 0.5–2 µs) where both switches in a leg are off before the complementary switch turns on.

### Hardware Dead Time (STM32 Advanced Timers)

STM32 advanced timers (TIM1, TIM8) have built-in dead-time generators:

```c
TIM_BreakDeadTimeConfigTypeDef sBreakDeadTimeConfig = {0};
sBreakDeadTimeConfig.DeadTime = 72;  /* 72 / 72 MHz = 1.0 µs */
sBreakDeadTimeConfig.BreakState = TIM_BREAK_ENABLE;
sBreakDeadTimeConfig.BreakPolarity = TIM_BREAKPOLARITY_HIGH;
sBreakDeadTimeConfig.AutomaticOutput = TIM_AUTOMATICOUTPUT_ENABLE;
HAL_TIMEx_ConfigBreakDeadTime(&htim1, &sBreakDeadTimeConfig);
```

The dead time value is specified in timer clock ticks. At 72 MHz, a dead time of 72 ticks gives exactly 1.0 µs — sufficient for most logic-level MOSFETs. Faster GaN or SiC switches may need as little as 100 ns; slower IGBTs may need 2–3 µs.

### Software Dead Time

For timers without hardware dead-time insertion, firmware must enforce the delay:

```c
void set_forward(void) {
    HAL_GPIO_WritePin(Q3_PORT, Q3_PIN, GPIO_PIN_RESET);  /* Q3 off */
    HAL_GPIO_WritePin(Q4_PORT, Q4_PIN, GPIO_PIN_RESET);  /* Q4 off */
    delay_us(2);  /* Dead time */
    HAL_GPIO_WritePin(Q1_PORT, Q1_PIN, GPIO_PIN_SET);    /* Q1 on */
    HAL_GPIO_WritePin(Q2_PORT, Q2_PIN, GPIO_PIN_SET);    /* Q2 on — wrong leg! */
}
```

Software dead time is fragile — interrupts during the delay window can extend it unpredictably, and logic errors (like the bug above where Q2 is activated instead of Q4) are not caught by hardware.

## Integrated H-Bridge Driver ICs

For motors under ~3 A, integrated H-bridge ICs simplify the design:

| IC | Voltage | Current (cont.) | Features |
|----|---------|-----------------|----------|
| DRV8871 | 6.5–45 V | 3.6 A | Built-in current limiting, two-pin interface |
| TB6612FNG | 2.5–13.5 V | 1.2 A | Dual H-bridge, standby mode |
| L298N | 5–46 V | 2 A (per channel) | Legacy, high RDS(on), requires external diodes |
| BTS7960 | 5.5–27.5 V | 43 A (half-bridge) | High current, built-in protection |

The L298N is still widely available on breakout boards but has ~2 V of drop across its bipolar output transistors, wasting significant power. MOSFET-based drivers like the DRV8871 or TB6612FNG are preferred for new designs.

## Bootstrap Gate Drive

High-side N-channel MOSFETs need a gate voltage above the supply rail. A bootstrap circuit uses a capacitor charged during the low-side on-time to provide this elevated voltage:

```
        V_supply
           │
     ┌─────┤
     │    D_boot (Schottky)
     │     │
     │   C_boot (100 nF–1 µF)
     │     │
     ├─── HO (gate driver high-side output)
     │
   Q_HS (N-FET)
     │
   Switch node ──── Motor
     │
   Q_LS (N-FET)
     │
    GND
```

The bootstrap capacitor must be refreshed periodically — it charges only when the low-side FET is on. At high duty cycles (> 95 %), the low-side on-time may be too short to fully recharge the capacitor, causing the high-side gate voltage to droop and the FET to lose enhancement. Most gate driver datasheets specify a minimum low-side on-time for reliable bootstrap operation, typically 1–5 µs.

### Bootstrap Component Selection

| Parameter | Typical Value | Notes |
|-----------|--------------|-------|
| C_boot | 100 nF – 1 µF | 10× gate charge of high-side FET minimum |
| D_boot | Schottky, fast recovery | Reverse recovery < 50 ns; VF < 0.5 V |
| Refresh time | 1–5 µs minimum | Depends on C_boot and charge current |

## PWM Strategies for H-Bridges

**Sign-magnitude PWM:** One leg is held static (e.g., Q3 on, Q4 off for forward), and the other leg is PWM'd. Simple to implement; motor current flows through the body diode during off-time.

**Lock anti-phase (LAP):** Both legs are PWM'd with complementary signals. 50 % duty = zero average voltage (motor brakes). Above 50 % = forward; below 50 % = reverse. Provides smooth zero-crossing behavior but doubles the effective switching frequency seen by the motor.

| Strategy | Zero-Speed Behavior | Switching Losses | Implementation |
|----------|-------------------|-----------------|----------------|
| Sign-magnitude | Coast (or brake if low-side on) | Lower (one leg switches) | Simpler |
| Lock anti-phase | Active braking | Higher (both legs switch) | Smooth through zero |

## Tips

- Start with an integrated H-bridge IC for prototyping. Discrete H-bridges with four MOSFETs and a gate driver are powerful but have many failure modes during bring-up.
- Size the bootstrap capacitor at 10× the total gate charge (Qg) of the high-side FET to ensure reliable turn-on even with component tolerance and leakage.
- Use the STM32 advanced timer's break input connected to a current-sense comparator — this provides hardware-speed shutdown on overcurrent, independent of firmware response time.
- Place a 100 nF ceramic capacitor directly across the motor terminals to suppress brush noise. This reduces EMI coupled back into the H-bridge control signals.

## Caveats

- Body diodes of MOSFETs conduct motor current during dead time and freewheeling. If the body diode has slow reverse recovery, it can cause current spikes when the complementary FET turns on. Use MOSFETs with fast body diodes or add external Schottky diodes in parallel.
- The L298N's 2 V output drop means a 12 V motor receives only ~10 V at full duty. Power dissipation in the L298N at 2 A is ~4 W — enough to require a heatsink even at moderate loads.
- Software-only dead-time control is unreliable under heavy interrupt load. A missed deadline of even 1 µs can cause shoot-through. Hardware dead-time generators are strongly preferred for any design beyond prototyping.
- Exceeding 95 % duty cycle with bootstrap gate drivers can cause gate voltage droop, pushing the high-side FET into its linear region. Clamping maximum duty to 95–97 % avoids this.

## In Practice

- **Motor briefly jerks on direction change then runs normally.** The shoot-through interval during the transition is too long or the dead time is missing. A current probe on the supply shows a spike at the switching instant. Adding or increasing dead time resolves the current spike; the mechanical jerk disappears.

- **H-bridge MOSFET fails after running fine for hours.** This commonly appears when the bootstrap capacitor slowly loses charge at high duty cycles, causing the high-side FET to partially enhance and dissipate power as heat. The failure is thermal and may not be immediate — the FET runs progressively hotter over minutes before catastrophic failure.

- **Motor runs at noticeably different speed forward vs reverse.** Asymmetric RDS(on) between the two legs, or different dead-time settings on complementary channels, causes one direction to have a higher effective voltage than the other. Measuring the duty cycle at the motor terminals with a scope reveals the imbalance.

- **Audible buzz at standstill with lock anti-phase PWM.** At exactly 50 % duty, small imbalances in the switching timing cause a net current to flow through the motor, producing vibration without rotation. Adding a narrow dead band (49–51 % = brake) eliminates the buzz.
