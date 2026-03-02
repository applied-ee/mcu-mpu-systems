---
title: "Power Layout & Decoupling"
weight: 50
---

# Power Layout & Decoupling

Motor drive circuits switch amps of current at tens of kHz through inductive loads — the resulting high dI/dt produces voltage transients, ground bounce, and radiated EMI that can reset the MCU, corrupt ADC readings, and interfere with communication buses. The PCB layout of the power stage is as important as the schematic. A motor drive that works on a breadboard may fail on a PCB with poor layout, and vice versa — the difference is parasitic inductance, ground impedance, and capacitor placement.

## The Problem: Switching Transients

When a MOSFET switches 5 A in 50 ns, the current changes at:

```
dI/dt = 5 A / 50 ns = 100 MA/s = 10⁸ A/s
```

Any inductance in the current path produces a voltage spike:

```
V = L × dI/dt
```

With just 10 nH of trace inductance: V = 10 × 10⁻⁹ × 10⁸ = 1 V. This 1 V spike appears on every switching edge, on every trace that carries the switching current — including the ground plane, the supply rail, and any sense lines that share those paths.

## Bulk Capacitors

Bulk capacitors on the motor supply rail store energy locally, providing the high-frequency current demand that the power supply's wires (with their inductance) cannot deliver fast enough:

| Capacitor Type | Typical Value | ESR | Role |
|---------------|-------------|-----|------|
| Electrolytic (radial) | 100–1000 µF | 50–500 mΩ | Low-frequency energy storage |
| Ceramic (MLCC) | 1–10 µF | 5–20 mΩ | High-frequency bypass (> 100 kHz) |
| Polymer electrolytic | 100–470 µF | 10–50 mΩ | Best of both worlds (low ESR, high C) |

### Sizing the Bulk Cap

The bulk capacitor must supply the switching current during one PWM cycle without excessive voltage droop:

```
ΔV = I_load × D × T_pwm / C_bulk

Example: 5 A, 50% duty, 20 kHz (T = 50 µs)
ΔV = 5 × 0.5 × 50×10⁻⁶ / 100×10⁻⁶ = 1.25 V ripple

With 470 µF: ΔV = 0.27 V — acceptable for 12 V supply (2.2 %)
```

### Capacitor Placement

Place the bulk electrolytic **directly at the power stage** — between the motor supply input and the ground return, within 1–2 cm of the MOSFET drains. Place the ceramic bypass cap (1–10 µF) even closer, ideally on the same side of the board as the FETs, with vias to the ground plane.

```
Power input ──── Bulk cap (+) ────────── MOSFET drain
                     │                       │
                Bulk cap (−) ── GND plane ── MOSFET source
                     │
               Ceramic cap (close to FET)
```

## Star Grounding

The fundamental layout principle for mixed-signal motor drives: **the high-current return path must not share copper with the signal ground.** A single ground plane is acceptable if the current paths are arranged so that motor return current does not flow under the MCU or analog section.

### Two-Zone Layout

```
┌──────────────────────────────────────┐
│                                      │
│   Logic Zone          Power Zone     │
│   ┌──────────┐      ┌───────────┐   │
│   │ MCU      │      │ MOSFETs   │   │
│   │ ADC      │      │ Motor     │   │
│   │ Sensors  │      │ connectors│   │
│   └──────────┘      └───────────┘   │
│        │                   │         │
│        └────── Star ───────┘         │
│               Point                  │
│           (single connection         │
│            to power supply GND)      │
└──────────────────────────────────────┘
```

The star point is the single location where the logic ground and power ground meet — typically at the power supply input connector. Motor return current flows through the power ground zone and back to the supply without passing under the logic section.

## High-Current Trace Sizing

PCB traces carrying motor current must be wide enough to avoid excessive voltage drop and heating:

| Current | 1 oz Cu (35 µm) Width | 2 oz Cu (70 µm) Width | ΔT at Width |
|---------|----------------------|----------------------|------------|
| 1 A | 0.3 mm | 0.15 mm | ~10 °C rise |
| 3 A | 1.5 mm | 0.75 mm | ~10 °C rise |
| 5 A | 3.5 mm | 1.8 mm | ~10 °C rise |
| 10 A | 10 mm | 5 mm | ~10 °C rise |
| 20 A+ | Copper pour / polygon | Copper pour / polygon | Depends on area |

For currents above 5 A, use copper pours (polygons) rather than traces. The pour should be as wide and short as possible to minimize both resistance and inductance.

## Decoupling Strategy

### Power Stage Decoupling

- **Bulk cap (100–470 µF electrolytic):** Within 2 cm of the FETs
- **Bypass cap (1–10 µF ceramic):** Directly at the MOSFET source/drain
- **High-frequency cap (100 nF ceramic):** Directly across gate driver IC supply pins

### MCU Decoupling

- **100 nF ceramic** on every VDD/VSS pair, within 3 mm of the pins
- **10 µF ceramic** on the main VDD rail
- **Isolated from motor supply** — connected through a ferrite bead or a separate regulator

### Gate Driver Decoupling

- **100 nF + 10 µF** on the VCC pin, as close as possible
- **Bootstrap capacitor** (100 nF–1 µF) on the boot pin (covered in H-bridge circuits)
- **Short, low-inductance connection** from the bypass cap GND pad to the driver's GND pin

## Ferrite Beads for Isolation

A ferrite bead in series with the logic supply (between the motor supply regulator and the MCU VDD) filters high-frequency noise from the motor stage:

```
Motor V+ ──── Regulator (5V/3.3V) ──── Ferrite bead ──── MCU VDD
                                                            │
                                                     100 nF + 10 µF
                                                            │
                                                         MCU GND
```

Select a ferrite bead with high impedance at the switching frequency (~100–1000 Ω at 10–100 MHz) and low DC resistance (< 1 Ω) to avoid voltage drop.

## Tips

- Route motor current paths as short, wide, closed loops. The area enclosed by the current loop determines radiated EMI — a smaller loop radiates less. Keep the supply trace and return trace (or ground plane) directly above/below each other to minimize loop area.
- Never route sensitive signals (ADC inputs, I²C/SPI bus, UART) under or parallel to motor power traces. The switching dI/dt induces voltages in nearby traces proportional to the mutual inductance.
- Use a solid ground plane on at least one inner layer. Do not cut slots or gaps in the ground plane under high-speed signal traces — this forces return current to detour around the gap, increasing inductance and EMI.
- For prototype boards, use a dedicated motor driver breakout board connected to the MCU board through short wires. This provides natural separation between the power stage and logic that is difficult to achieve on a single breadboard.

## Caveats

- A ground plane shared between the motor stage and the MCU does not automatically solve ground noise. If motor return current flows through copper under the MCU, the voltage drop (I × R_copper) appears as ground bounce on the MCU's analog reference. Proper partitioning or a star ground is still necessary.
- Electrolytic capacitors have high ESR at high frequencies — they are effectively resistors above ~100 kHz. The ceramic bypass cap handles the high-frequency current; the electrolytic handles the low-frequency ripple. Both are needed.
- Via inductance (~0.5–1 nH per via) limits the effectiveness of ground connections through vias. For high-current ground connections, use multiple vias in parallel (4–8 vias) to reduce the total inductance to the ground plane.
- Motor cables act as antennas for both radiated and conducted EMI. Twisting the motor power and return wires reduces the effective loop area and radiated noise. Shielded cable is even better for environments with EMI-sensitive equipment nearby.

## In Practice

- **MCU resets randomly during motor operation.** Motor switching transients couple into the MCU power supply through shared ground paths. Measuring the MCU VDD with a scope shows dips of 100–500 mV coinciding with motor PWM edges. Adding a ferrite bead between the motor-side regulator and the MCU VDD, plus 10 µF + 100 nF directly at the MCU power pins, filters the transients. If resets persist, separating the ground return paths (star grounding) addresses the root cause.

- **ADC readings are noisy and jump by 20–50 counts during motor operation.** Ground bounce from motor current flowing through shared copper shifts the ADC's reference voltage. The noise correlates with PWM switching — sampling during the quiet period (center of on-time or off-time) reduces the noise. Moving the ADC ground and reference bypass capacitor to the quiet zone of the ground plane eliminates it.

- **Motor runs normally but an I²C sensor on the same board occasionally returns wrong data.** The SDA and SCL lines run near the motor power traces and pick up transient pulses that the I²C peripheral interprets as valid edges. Rerouting the I²C lines away from the motor traces, or adding 100 pF capacitors on SDA/SCL (slowing edges but improving noise immunity), resolves the communication errors.

- **Supply voltage at the MOSFET drains sags by 2 V under load, even though the bench supply shows a stable 12 V.** The inductance and resistance of the long supply wires drops voltage under the high dI/dt of PWM switching. Adding a 470 µF bulk capacitor at the board's power input (close to the FETs, not at the bench supply) provides local energy storage that the wires cannot supply fast enough.
