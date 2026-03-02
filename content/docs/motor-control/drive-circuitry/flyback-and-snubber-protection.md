---
title: "Flyback & Snubber Protection"
weight: 20
---

# Flyback & Snubber Protection

Every inductive load in this section — motors, solenoids, relays, and actuators — stores energy in a magnetic field. When the current through the inductance is interrupted (FET turns off, relay opens), the stored energy (E = ½LI²) must go somewhere. Without a designed dissipation path, the inductance forces the voltage across the switch to spike upward until it finds a path: avalanche breakdown of the MOSFET, arcing across relay contacts, or conduction through parasitic paths. Protection circuits provide a controlled energy dissipation path that clamps the voltage to a safe level.

## Flyback Diode

The simplest and most common protection: a diode reverse-biased during normal operation that conducts when the inductive voltage reverses at turn-off.

```
V+ ──── Inductive Load ──┬── D1 (cathode at V+, anode at drain)
                         │
                    MOSFET drain
                         │
                    MOSFET source ── GND
```

When the MOSFET turns off, the inductor drives the drain below ground (for low-side switching), and D1 forward-biases, clamping the voltage to V+ + V_F (one diode drop above supply).

### Diode Selection

| Parameter | Requirement | Reasoning |
|-----------|------------|-----------|
| VR (reverse voltage) | ≥ supply voltage | Must block in normal operation |
| IF (forward current) | ≥ load current at turn-off | Carries full inductor current momentarily |
| Recovery time (trr) | < 100 ns (Schottky preferred) | Slow recovery causes current spike at next turn-on |
| Power rating | Depends on duty cycle | Average power = ½LI² × f_switching |

| Diode | Type | VR | IF | trr | Package |
|-------|------|----|----|-----|---------|
| 1N5819 | Schottky | 40 V | 1 A | ~10 ns | Axial |
| SS34 | Schottky | 40 V | 3 A | ~10 ns | SMA |
| 1N5822 | Schottky | 40 V | 3 A | — | Axial |
| MBR2045 | Schottky | 45 V | 20 A | — | TO-220 |
| 1N4148 | Fast signal | 75 V | 200 mA | 4 ns | Axial |
| 1N4007 | Standard | 1000 V | 1 A | 30 µs | Axial |

The 1N4007 works as a flyback diode but its 30 µs reverse recovery allows reverse current on each turn-on, increasing switch losses. Schottky diodes are preferred for all motor and solenoid applications.

## Flyback Diode + Zener (Fast Turn-Off)

A plain flyback diode clamps the voltage tightly, but current decays slowly (τ = L/R_coil). Adding a Zener diode in series raises the clamp voltage, accelerating current decay:

```
V+ ──── Load ──┬── D1 ── Zener ── V+
               │
          MOSFET drain
```

The MOSFET drain sees V_supply + V_zener + V_F at turn-off. The Zener must be chosen so this sum is within the MOSFET's VDS rating.

| Configuration | Clamp Voltage | Turn-Off Speed | MOSFET Stress |
|--------------|--------------|---------------|--------------|
| Schottky only | V+ + 0.3 V | Slow | Minimal |
| Schottky + 24 V Zener | V+ + 24.3 V | ~3× faster | VDS must handle sum |
| Schottky + 36 V Zener | V+ + 36.3 V | ~5× faster | VDS must handle sum |

## RC Snubber

An RC snubber across the switch or across the load absorbs the energy by damping the LC ringing from the inductance and parasitic capacitance:

```
Across the MOSFET (drain to source):
    R (10–100 Ω) in series with C (1–100 nF)
```

The snubber limits the peak voltage by absorbing energy in the resistor. It also damps the oscillation that occurs when the inductor resonates with the MOSFET's output capacitance (Coss).

### Snubber Sizing (Simplified)

```
C_snub ≈ I_peak² × L / V_clamp²
R_snub ≈ V_clamp / I_peak

Example: L = 10 mH, I_peak = 2 A, V_clamp = 60 V
C_snub ≈ (4 × 0.01) / 3600 ≈ 11 nF → use 10 nF
R_snub ≈ 60 / 2 = 30 Ω → use 33 Ω
```

Snubber power dissipation: P = ½ × C × V² × f_switching. At 10 nF, 60 V, 20 kHz: P = 0.36 W — use a resistor rated for at least 0.5 W.

## TVS (Transient Voltage Suppressor) Clamp

A TVS diode provides fast (< 1 ns) voltage clamping with high peak current capability:

```
V+ ──── Load ──┬── TVS (bidirectional or unidirectional) ── GND
               │
          MOSFET drain
```

TVS diodes are available in specific clamp voltages (36 V, 48 V, etc.) and can handle very high peak currents (50–600 A peak for SMD, kA for axial) for brief transients. They are preferred over Zener diodes for protection because they have much higher surge current ratings.

| TVS Part | Standoff Voltage | Clamp Voltage (at Ipp) | Peak Current | Package |
|----------|-----------------|----------------------|-------------|---------|
| SMAJ36A | 36 V | 58 V at 6.9 A | 400 W peak | SMA |
| SMBJ48A | 48 V | 78 V at 5.1 A | 600 W peak | SMB |
| P6KE36A | 36 V | 50 V at 8 A | 600 W peak | Axial |

## Choosing the Right Protection

| Load Type | Recommended Protection | Notes |
|----------|----------------------|-------|
| Solenoid (infrequent switching) | Schottky flyback diode | Simple, reliable |
| Solenoid (fast cycling) | Schottky + Zener | Fast turn-off needed |
| Relay coil | Schottky flyback diode | Release time usually not critical |
| DC motor (H-bridge) | Body diode of FETs + MOSFET snubber | Most H-bridge ICs handle this internally |
| Motor (single FET, low-side) | Schottky flyback diode | Across motor terminals |
| High-voltage inductive load | TVS clamp | Fast response, high energy |

## Tips

- Place the flyback diode physically as close to the inductive load as possible, not at the MOSFET. The inductance of the wiring between the diode and the load adds to the spike voltage seen at the switch.
- For motors in H-bridge configurations, the body diodes of the MOSFETs typically serve as the flyback path. External flyback diodes across the motor terminals (in addition to the body diodes) provide extra protection during fault conditions.
- Use the MOSFET's avalanche energy rating (EAS) as a backup check — even if the protection circuit is designed correctly, verify that the MOSFET can survive a single avalanche event in case the protection fails.
- When adding a snubber, start with calculated values and adjust on the bench with an oscilloscope. The optimal snubber is the smallest RC that damps the ringing below the MOSFET's VDS rating.

## Caveats

- A flyback diode across a motor in an H-bridge (cathode to V+, anode to motor terminal) can create a short circuit during normal operation — the diode forward-biases when the opposite H-bridge leg drives that terminal high. Flyback protection in H-bridges must be implemented with the body diodes of the FETs, not with external diodes across the motor.
- Snubber resistors dissipate power continuously at the switching frequency. At high PWM frequencies (20+ kHz), snubber power dissipation can be significant — verify that the resistor rating is adequate.
- TVS diodes have a leakage current at their standoff voltage. On high-impedance circuits, this leakage can cause unexpected behavior. For motor drives (low impedance), leakage is negligible.
- Multiple protection devices in parallel (flyback diode + TVS + snubber) are sometimes necessary on high-energy inductive loads. Each device has a response time and energy capacity — the fastest-responding device (TVS) catches the initial spike, and the flyback diode handles the sustained current.

## In Practice

- **Voltage spike on the MOSFET drain measures 80 V on a 24 V supply, even with a flyback diode installed.** The diode is too far from the load — trace inductance between the diode and the solenoid coil adds to the spike. Moving the diode directly to the coil terminals or adding a TVS at the MOSFET reduces the spike to a safe level.

- **MOSFET fails after months of reliable operation.** Each switching cycle produces a voltage spike that barely exceeds the VDS rating. The cumulative stress degrades the drain-source junction (repetitive avalanche). Reducing the spike below 80 % of VDS rating with better protection (lower-voltage TVS, faster diode) provides adequate margin for long-term reliability.

- **Relay takes 15 ms to release with a simple flyback diode, causing timing issues.** The diode clamps the coil voltage to V_supply + 0.3 V, and the current decays with time constant L/R_coil ≈ 50 mH / 100 Ω = 0.5 ms for ~3τ = 1.5 ms. With actual values: high-inductance relay coils can have τ = 5 ms, giving ~15 ms release time. Adding a 30 V Zener in series with the diode increases the decay voltage and drops release time to ~3–5 ms.

- **Oscilloscope shows ringing at 1–5 MHz on the MOSFET drain after turn-off.** The motor inductance resonates with the MOSFET's output capacitance (Coss) and the parasitic capacitance of the PCB layout. While the peak voltage may be within VDS rating, the high-frequency ringing radiates EMI. An RC snubber (10–100 Ω + 1–10 nF) across the MOSFET damps the oscillation within 1–2 cycles.
