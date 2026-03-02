---
title: "Solenoid Drive Circuits"
weight: 10
---

# Solenoid Drive Circuits

A solenoid is an electromagnet with a movable plunger — apply current and the plunger pulls in (or pushes out); remove current and a return spring resets it. The electrical interface is simple (a coil), but the drive circuit must handle the inductive energy stored in the coil when current is interrupted. A solenoid coil storing even modest energy (½LI²) can generate voltage spikes of hundreds of volts when the drive transistor turns off — enough to destroy MOSFETs, upset nearby logic, and weld relay contacts.

## Pull and Push Solenoids

| Type | Motion | Common Use |
|------|--------|-----------|
| Pull (linear) | Plunger retracts into coil | Door latches, pinball mechanisms, valve actuators |
| Push (linear) | Plunger extends from coil | Dispensers, strikers |
| Rotary | Armature rotates ~30–90° | Flag indicators, rotary latches |

Electrical characteristics for typical DC solenoids:

| Parameter | Small (12 V, 5 W) | Medium (24 V, 20 W) | Large (24 V, 50 W) |
|-----------|-------------------|--------------------|--------------------|
| Coil resistance | 30 Ω | 29 Ω | 12 Ω |
| Steady-state current | 0.4 A | 0.83 A | 2.0 A |
| Inductance (plunger out) | 10–30 mH | 30–80 mH | 50–200 mH |
| Pull-in force | 2–5 N | 10–30 N | 30–80 N |
| Stroke | 5–10 mm | 10–15 mm | 10–25 mm |

## Basic Drive Circuit (Low-Side N-FET)

```
V_supply ──── Solenoid coil ──┬── MOSFET (drain)
                              │
                         D1 (flyback)
                              │
                         MOSFET (source) ── GND
                              │
               MCU GPIO ── Gate (via resistor)
```

```c
/* Simple solenoid control — GPIO drives low-side MOSFET */
void solenoid_on(void) {
    HAL_GPIO_WritePin(SOL_PORT, SOL_PIN, GPIO_PIN_SET);
}

void solenoid_off(void) {
    HAL_GPIO_WritePin(SOL_PORT, SOL_PIN, GPIO_PIN_RESET);
}
```

### MOSFET Selection

For a 24 V, 2 A solenoid:

| Parameter | Minimum Requirement | Example Part |
|-----------|-------------------|-------------|
| VDS | > 24 V (≥ 40 V with margin) | IRLZ44N (55 V) |
| ID | > 2 A continuous | IRLZ44N (47 A) |
| VGS(th) | < 3.0 V for 3.3 V MCU drive | IRLZ44N (1.0–2.0 V) |
| RDS(on) at VGS = 3.3 V | Low enough to avoid heating | IRLZ44N (~0.022 Ω) |

Power dissipation: 2 A² × 0.022 Ω = 0.088 W — negligible for this FET.

## Flyback Protection

When the MOSFET turns off, current through the solenoid inductance cannot stop instantly. The coil voltage reverses and spikes to whatever level is needed to force current through any available path. Without protection, this spike appears across the MOSFET's drain-source and can exceed 100 V on a 24 V circuit.

### Flyback Diode

A diode across the coil (cathode at V+, anode at the MOSFET drain) clamps the spike to one diode drop above the supply:

```
V_supply ──── Solenoid ──┬── D1 (flyback) ── V_supply
                         │
                    MOSFET drain
```

The diode carries the full coil current immediately after turn-off. A fast-recovery or Schottky diode rated for the coil current is required:

| Diode | Type | IF | VR | Notes |
|-------|------|----|----|-------|
| 1N5819 | Schottky | 1 A | 40 V | Good for small solenoids |
| 1N5822 | Schottky | 3 A | 40 V | Medium solenoids |
| SS34 | Schottky | 3 A | 40 V | SMD alternative |
| 1N4007 | Standard recovery | 1 A | 1000 V | Works but slow — extends release time |

### Release Time vs Protection

A simple flyback diode clamps the voltage to ~0.5 V above supply, but the coil current decays slowly (τ = L/R_coil, which can be 5–20 ms). This delays the mechanical release of the plunger — critical for fast-cycling applications.

To speed up release, a Zener diode in series with the flyback diode raises the clamp voltage, increasing the voltage across the coil resistance and driving current down faster:

```
V_supply ──── Solenoid ──┬── D_flyback ── Zener (30 V) ── V_supply
                         │
                    MOSFET drain
```

The MOSFET sees V_supply + V_zener during turn-off — the FET's VDS rating must accommodate this.

| Protection | Clamp Voltage | Release Time | MOSFET Stress |
|-----------|--------------|-------------|--------------|
| Schottky diode only | V_supply + 0.3 V | Slow (L/R) | Low |
| Diode + 30 V Zener | V_supply + 30.3 V | ~3× faster | Moderate (must rate VDS) |
| TVS clamp (36 V) | ~36 V | Fast | Must rate VDS > 36 V |
| RC snubber | V_supply + I×R_snub | Adjustable | Low if sized correctly |

## Hold Current Reduction

A solenoid's pull-in force is much higher than its holding force. Once the plunger is seated, the current can be reduced to 30–50 % using PWM, saving power and reducing heat:

```c
/* Pull-in at 100 % duty, then reduce to hold */
void solenoid_activate(void) {
    /* Full power for pull-in (50–100 ms) */
    __HAL_TIM_SET_COMPARE(&htim_sol, TIM_CHANNEL_1, htim_sol.Init.Period);
    HAL_Delay(100);

    /* Reduce to 40 % duty for hold */
    __HAL_TIM_SET_COMPARE(&htim_sol, TIM_CHANNEL_1,
        (40 * htim_sol.Init.Period) / 100);
}
```

For a 24 V, 0.83 A solenoid, hold current at 40 % duty is ~0.33 A. Power drops from 20 W to ~3.2 W — the difference between needing a heatsink and not.

## Tips

- Always include a flyback diode, even during prototyping. A single turn-off event without protection can destroy a MOSFET. The diode costs less than any other component in the circuit.
- Size the MOSFET for stall/pull-in current, not hold current. Pull-in current can be 2–3× the steady-state value as the coil inductance is lower with the plunger extended.
- Use a separate power supply rail for solenoids, isolated from the MCU's logic supply. Solenoid switching transients (even with flyback protection) inject noise into the power rail.
- For high-speed cycling applications (> 10 Hz), use a Zener + diode flyback circuit to minimize release time. The slow decay with a plain flyback diode limits the maximum cycling rate.

## Caveats

- A 1N4007 (standard recovery diode) works as a flyback diode but its slow reverse recovery (30 µs) allows reverse current to flow briefly when the MOSFET turns on, creating a current spike. Schottky diodes have no reverse recovery delay.
- Solenoids have a maximum duty cycle rating (often 25–50 % for intermittent-duty types). Exceeding this rating overheats the coil. Continuous-duty solenoids are available but larger and more expensive for the same force.
- The inductance of a solenoid changes significantly with plunger position — fully retracted (plunger in) has 2–5× higher inductance than fully extended. This means the stored energy ½LI² varies with position, affecting the flyback spike magnitude.
- Driving a solenoid with PWM for hold-current reduction requires the PWM frequency to be above audible range (> 20 kHz) to avoid buzz. The solenoid coil acts as a speaker at audible frequencies.

## In Practice

- **MOSFET fails after a few hundred solenoid cycles.** The flyback diode is missing, oriented backwards, or has a broken solder joint. Each cycle produces a voltage spike that degrades the MOSFET. The failure is cumulative — the FET may survive hundreds of spikes before the gate oxide breaks down. Checking for the flyback diode with an oscilloscope (measure drain voltage at turn-off) reveals the spike.

- **Solenoid buzzes audibly during hold.** PWM hold-current reduction is running at an audible frequency (1–10 kHz). The coil's magnetic force oscillates at the PWM rate, vibrating the plunger. Increasing the PWM frequency to 25–40 kHz moves the buzz above hearing. If the plunger still rattles mechanically, increasing hold current slightly provides more clamping force.

- **Solenoid activates on power-up before firmware initializes.** The MOSFET gate floats high during the MCU's startup sequence, turning on the solenoid briefly. A 10 kΩ pull-down resistor from gate to source ensures the FET stays off until firmware drives the GPIO.

- **Solenoid plunger releases slowly, causing mechanical timing issues.** The flyback diode allows the coil current to decay gradually (τ = L/R). For a 50 mH coil with 15 Ω resistance, τ ≈ 3.3 ms — the plunger release may take 10–15 ms. Adding a Zener in series with the flyback diode increases the decay voltage and reduces the time constant to ~1 ms.
