---
title: "Stepper Types & Wiring"
weight: 10
---

# Stepper Types & Wiring

Stepper motors come in several physical constructions — permanent magnet, variable reluctance, and hybrid — but in embedded practice, the vast majority are **hybrid steppers** in NEMA 17 or NEMA 23 frames, with 200 steps per revolution (1.8° per step). The critical distinction for wiring and drive electronics is between **unipolar** and **bipolar** configurations, which determine how many wires the motor has and what type of driver is required.

## Unipolar vs Bipolar

| Parameter | Unipolar (5 or 6 wire) | Bipolar (4 wire) |
|-----------|----------------------|-----------------|
| Wires | 5, 6, or 8 | 4 |
| Coil access | Center-tapped windings | Full windings |
| Driver complexity | Single transistor per phase | H-bridge per phase |
| Torque per frame size | Lower (only half winding active) | Higher (full winding active) |
| Common drivers | ULN2003, ULN2803 | A4988, DRV8825, TMC2209 |

A **6-wire** motor has two center-tapped coils. Each center tap connects to the supply, and the driver grounds each half-winding in sequence. Only half the copper is active at any time, reducing torque by ~30 % compared to bipolar drive.

A **4-wire** motor has two independent coils with no center tap. A bipolar driver (H-bridge per phase) reverses current direction through the full winding, using all the copper. This is the standard for modern CNC and 3D printing.

An **8-wire** motor can be wired as either unipolar or bipolar, or in series/parallel bipolar configurations for different voltage/current trade-offs.

## Coil Identification

When wire colors are unlabeled or nonstandard, the coils can be identified with a multimeter:

1. **Measure resistance between all wire pairs.** Wires belonging to the same coil show low resistance (1–10 Ω typical). Wires from different coils show open circuit (∞).
2. **For 6-wire motors:** The center tap has half the resistance to each end. If end-to-end measures 4 Ω, center-to-end measures 2 Ω.
3. **Verify phase pairing:** Connect one coil to a driver and step the motor. If the shaft vibrates but does not rotate, the coils are miswired — one phase has wires from two different coils.

### Common Wire Color Codes

| Motor | Coil A | Coil A' | Center A | Coil B | Coil B' | Center B |
|-------|--------|---------|----------|--------|---------|----------|
| Typical NEMA 17 (4-wire) | Black | Green | — | Red | Blue | — |
| Typical NEMA 17 (6-wire) | Black | Green | Yellow | Red | Blue | White |

Color codes vary by manufacturer. Always verify with a multimeter.

## Holding Torque vs Detent Torque

**Holding torque** is the maximum torque the motor can resist when its coils are energized at rated current. This is the headline specification (e.g., 0.4 N·m for a typical NEMA 17). It represents the stiffness of the magnetic detent when the rotor is locked at a full-step position.

**Detent torque** is the residual magnetic torque felt when the coils are unpowered — caused by the permanent magnets in hybrid steppers aligning with the stator teeth. Detent torque is typically 5–10 % of holding torque.

| Specification | Typical NEMA 17 | Typical NEMA 23 |
|--------------|----------------|----------------|
| Holding torque | 0.3–0.6 N·m | 1.0–3.0 N·m |
| Detent torque | 0.02–0.04 N·m | 0.05–0.15 N·m |
| Rated current | 1.0–2.0 A/phase | 2.0–4.0 A/phase |
| Winding resistance | 1.2–3.0 Ω | 0.5–2.0 Ω |
| Winding inductance | 2–8 mH | 2–10 mH |

## 8-Wire Motor Configurations

| Configuration | Connection | Voltage | Current | Torque | Use Case |
|--------------|-----------|---------|---------|--------|----------|
| Series | Two halves per phase in series | 2× rated V | 1× rated I | Maximum torque at low speed | Low-speed positioning |
| Parallel | Two halves per phase in parallel | 1× rated V | 2× rated I | Better high-speed torque | Higher speed applications |
| Half-coil (unipolar) | Center tap to supply | 1× rated V | 1× rated I | ~70 % of bipolar torque | Simple driver |

## Tips

- Default to bipolar wiring and a bipolar driver (A4988, TMC2209) for new designs. The torque advantage of full-winding drive outweighs the minor driver complexity increase.
- When identifying coils, spin the shaft by hand with and without pairs of wires shorted together. Shorting a coil pair produces noticeable magnetic resistance (back-EMF braking); shorting wires from different coils has no effect.
- For 8-wire motors, series connection at the driver's rated voltage gives the most holding torque. Parallel connection is preferred when the driver can supply the doubled current and the application needs speed.
- Record wire-to-coil mappings with a label or photo during initial wiring. Re-identifying coils during field troubleshooting wastes significant time.

## Caveats

- Swapping two wires within a phase reverses the step direction for that phase. The motor vibrates in place instead of rotating — it appears to be a power problem but is purely a wiring error.
- The rated current is per phase, not total. A 2 A/phase motor with both phases energized (as in holding position) draws up to 4 A from the supply through the driver. Power supply sizing must account for this.
- Winding resistance and inductance specifications are per phase. In series 8-wire configuration, both values double; in parallel, resistance halves and inductance quarters.
- Detent torque is not negligible in low-force applications. A NEMA 17 with 0.03 N·m detent torque requires ~30 g·cm of force to rotate by hand — this cogging is felt in applications like camera sliders and can affect motion smoothness at very low speeds.

## In Practice

- **Motor vibrates loudly but does not rotate.** This is the classic symptom of swapped wires within a phase. The two coils are fighting each other — one tries to step forward, the other backward. Swapping the two wires of one coil (A with A') resolves it immediately.

- **Motor rotates but only in one direction; reversing the direction input causes vibration.** One phase is wired correctly and the other is reversed. The motor can step in the direction where both phases agree, but stalls when they oppose. Reversing one wire pair on the stuck-direction phase fixes the issue.

- **Motor gets very hot at standstill.** Steppers draw full rated current when holding position. A NEMA 17 at 1.7 A with 1.5 Ω winding resistance dissipates ~4.3 W per phase (8.6 W total) continuously. Case temperatures of 60–80 °C are normal under full hold current. Reducing hold current to 50–70 % via the driver's current reduction feature drops the temperature significantly with only modest loss of holding torque.

- **Measured coil resistance does not match the datasheet.** Temperature is the most common cause — copper resistance increases by ~0.4 %/°C. A coil that measures 1.5 Ω at 25 °C reads ~1.8 Ω at 75 °C. Less commonly, corrosion on the connector pins or a poor crimp adds series resistance.
