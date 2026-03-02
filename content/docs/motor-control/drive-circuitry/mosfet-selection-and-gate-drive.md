---
title: "MOSFET Selection & Gate Drive"
weight: 10
---

# MOSFET Selection & Gate Drive

The MOSFET is the workhorse switch in every motor drive, solenoid circuit, and power stage covered in this section. Selecting the right MOSFET means matching its voltage, current, and thermal ratings to the load — and then ensuring the gate drive circuit can switch it on and off fast enough to keep switching losses low. A MOSFET that looks perfect on the datasheet can fail in practice if the gate is driven too slowly, the thermal path is inadequate, or the parasitic inductance in the layout causes voltage spikes.

## Key Selection Parameters

| Parameter | Symbol | What It Means | How to Size |
|-----------|--------|--------------|-------------|
| Drain-source voltage | VDS(max) | Maximum voltage the FET can block | ≥ 2× supply voltage (margin for spikes) |
| Continuous drain current | ID | Current the FET can carry indefinitely | ≥ stall/peak current of the load |
| On-resistance | RDS(on) | Resistance when fully enhanced | Lower = less heat; check at actual VGS |
| Gate threshold voltage | VGS(th) | Minimum VGS to begin turning on | < MCU output voltage for direct drive |
| Total gate charge | Qg | Charge needed to fully turn on the gate | Determines gate driver current and switching speed |
| Maximum gate voltage | VGS(max) | Absolute max gate-source voltage | Typically ±20 V; must not be exceeded |

### RDS(on) — The Misleading Spec

Datasheets specify RDS(on) at a specific VGS (usually 10 V) and temperature (25 °C). In practice:

- At VGS = 3.3 V (direct MCU drive), RDS(on) can be 2–5× the datasheet spec at VGS = 10 V
- RDS(on) increases with temperature: roughly +0.4 %/°C for silicon MOSFETs
- A FET with 10 mΩ at VGS=10V, 25°C may show 30–50 mΩ at VGS=3.3V, 100°C

Always check the RDS(on) vs VGS curve on the datasheet, not just the headline number.

## Logic-Level MOSFETs

For direct drive from 3.3 V MCU GPIOs, use MOSFETs specified as "logic level" — fully enhanced at VGS = 2.5–4.5 V:

| Part | VDS | ID | RDS(on) at VGS=3.3V | Qg | Package |
|------|-----|----|--------------------|-----|---------|
| IRLZ44N | 55 V | 47 A | ~30 mΩ | 48 nC | TO-220 |
| IRLML6344 | 30 V | 5 A | ~29 mΩ | 6.8 nC | SOT-23 |
| AOD4184A | 40 V | 50 A | ~5 mΩ | 52 nC | TO-252 |
| Si2302 | 20 V | 2.6 A | ~55 mΩ | 5.4 nC | SOT-23 |

## Gate Driver ICs

When the MCU cannot directly provide enough current to switch the MOSFET quickly, or when driving high-side N-channel FETs (which need VGS above the supply rail), a gate driver IC is required:

| IC | Type | Peak Drive Current | Propagation Delay | Supply |
|----|------|-------------------|-------------------|--------|
| MCP1407 | Low-side, non-inverting | 6 A | 40 ns | 4.5–18 V |
| IR2110 | High/low-side (bootstrap) | 2 A / 2 A | 120 ns | 10–20 V |
| IR2104 | Half-bridge (bootstrap) | 0.36 A | 600 ns | 10–20 V |
| DRV8320 | Three-phase (integrated) | 1 A | 50 ns | 6–60 V |

### Why Gate Drive Current Matters

The MOSFET gate is a capacitor (Ciss = Cgs + Cgd). Charging and discharging this capacitance through a resistance determines the switching speed:

```
t_rise ≈ Qg / I_drive
```

A MOSFET with Qg = 50 nC driven by a GPIO sourcing 10 mA takes ~5 µs to turn on — during which the FET is in its linear region, dissipating significant power. The same FET driven by a gate driver at 2 A turns on in ~25 ns.

| Drive Source | Typical Peak Current | Turn-On Time (Qg=50 nC) |
|-------------|---------------------|------------------------|
| MCU GPIO (3.3 V, 10 mA) | 10 mA | ~5 µs |
| MCU GPIO (3.3 V, 20 mA) | 20 mA | ~2.5 µs |
| Gate driver IC (2 A) | 2 A | ~25 ns |
| Gate driver IC (6 A) | 6 A | ~8 ns |

### Gate Resistor

A small resistor (1–10 Ω) in series with the gate driver output limits the current peak and damps oscillation from parasitic inductance in the gate loop:

```
Gate driver output ── R_gate (4.7 Ω) ── MOSFET gate
                                         │
                                    R_gs (10 kΩ) pull-down
                                         │
                                       Source/GND
```

The pull-down resistor (10 kΩ) ensures the gate is discharged when the driver is unpowered or in high-impedance mode.

## High-Side Drive

Driving an N-channel MOSFET on the high side requires VGS > VDS — meaning the gate must be driven above the supply rail. Two approaches:

### Bootstrap

A capacitor charged from the low-side supply during the low-side FET's on-time provides the elevated gate voltage. Covered in detail in [H-Bridge Circuits]({{< relref "../dc-motors/h-bridge-circuits" >}}).

### Charge Pump

Gate driver ICs with an integrated charge pump (e.g., LTC4440, NCP5181) generate a floating supply for the high-side gate without requiring a low-side on-time to refresh. Better for DC (100 % duty cycle) applications but limited in available current.

## Tips

- Select MOSFETs with VDS ≥ 2× the supply voltage. Inductive ringing and flyback spikes on the drain routinely reach 1.5× supply even with protection diodes.
- Check the RDS(on) at the actual gate drive voltage, not the headline specification at VGS=10 V. For 3.3 V direct drive, the SOA (safe operating area) curves and RDS(on) vs VGS plots are essential.
- Keep the gate drive loop (driver → gate → source → driver ground) as short as possible on the PCB. Inductance in this loop causes ringing on the gate signal, which can cause false turn-on of the complementary FET in an H-bridge (Miller effect).
- For MOSFETs switching at > 100 kHz, calculate switching losses (P_sw = 0.5 × VDS × ID × (t_on + t_off) × f_sw) in addition to conduction losses (P_cond = ID² × RDS(on)). At high frequencies, switching losses dominate.

## Caveats

- The MOSFET body diode has slow reverse recovery in many standard FETs. In bridge circuits, this causes a current spike when the complementary FET turns on. Select FETs with fast body diodes or add external Schottky diodes.
- VGS(th) on the datasheet is the threshold where the FET barely begins to conduct (typically at 250 µA). Full enhancement requires VGS significantly above this — typically VGS(th) + 2–4 V. A FET with VGS(th) = 2 V is not fully enhanced at 2 V.
- Parallel MOSFETs for higher current require matched gate resistors (one per FET) to ensure simultaneous switching. Without individual gate resistors, the FET with the lowest threshold carries all the current during switching transitions.
- ESD damage to the gate oxide is cumulative and invisible. A MOSFET that was handled without ESD precautions may work initially but have a reduced VGS(max) and fail unexpectedly under voltage stress.

## In Practice

- **MOSFET runs very hot at modest current levels.** The gate voltage is too low for full enhancement — the FET operates in its linear region, acting as a resistor rather than a switch. Measuring VDS while the FET is on (should be < 0.5 V at rated current) reveals the issue. Adding a gate driver or selecting a logic-level FET resolves the thermal problem.

- **Oscilloscope shows ringing on the gate signal at each switching transition.** Parasitic inductance in the gate loop (long traces, poor layout) resonates with the gate capacitance. The ringing can exceed VGS(max) and damage the gate oxide. Adding a gate resistor (4.7–10 Ω) damps the resonance; shortening the gate loop on the PCB eliminates it.

- **MOSFET fails immediately when first powered on with no load.** Gate drive voltage exceeds VGS(max) (±20 V for most FETs). This happens when a 12 V gate driver is used with a FET rated for ±12 V VGS, or when the bootstrap voltage adds to a high supply rail. Checking VGS with a scope before first power-on catches this.

- **H-bridge has inconsistent dead time and occasional shoot-through.** The high-side FET turns on faster than the low-side turns off (or vice versa) due to different gate charge requirements or asymmetric gate driver strengths. Adjusting individual gate resistor values to equalize switching times, or relying on the timer's hardware dead-time generator, prevents the overlap.
