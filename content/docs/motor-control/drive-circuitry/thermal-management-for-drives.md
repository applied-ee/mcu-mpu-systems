---
title: "Thermal Management for Drives"
weight: 40
---

# Thermal Management for Drives

Power MOSFETs, motor driver ICs, and shunt resistors in motor drive circuits dissipate significant heat. A MOSFET switching a 5 A motor at 20 kHz with 20 mΩ RDS(on) dissipates 0.5 W in conduction alone — add switching losses and the total can reach 1–3 W per device. In an H-bridge with four FETs, that is 2–12 W of heat in a small area. Without adequate thermal design, junction temperatures rise until the device derate, malfunction, or fail. Thermal management is not an afterthought — it determines the practical current limit of the drive circuit.

## Junction Temperature Model

The thermal path from the semiconductor junction to ambient air follows a resistive model:

```
T_junction = T_ambient + P_dissipated × (R_θJC + R_θCS + R_θSA)
```

| Symbol | Meaning | Typical Values |
|--------|---------|---------------|
| R_θJC | Junction to case | 0.5–5 °C/W (depends on package) |
| R_θCS | Case to heatsink | 0.2–1.0 °C/W (depends on interface) |
| R_θSA | Heatsink to ambient | 2–50 °C/W (depends on heatsink + airflow) |
| T_J(max) | Maximum junction temperature | 150–175 °C (silicon) |

### Package Thermal Resistance

| Package | Typical R_θJA (no heatsink) | Typical R_θJC | Notes |
|---------|---------------------------|---------------|-------|
| SOT-23 | 200–300 °C/W | 50–100 °C/W | Very limited; < 0.5 W practical |
| DPAK (TO-252) | 50–100 °C/W | 1–3 °C/W | Heatsinks to PCB copper |
| D2PAK (TO-263) | 40–60 °C/W | 0.5–2 °C/W | Larger pad; better thermal |
| TO-220 | 50–65 °C/W | 1–3 °C/W | Bolt-on heatsink possible |
| QFN-28 (driver IC) | 30–50 °C/W | 5–15 °C/W | Thermal pad critical |

## Power Dissipation Calculation

### Conduction Loss

```
P_cond = I_RMS² × RDS(on) × (1 + TC × ΔT)
```

Where TC ≈ 0.004 /°C for silicon MOSFETs. At 100 °C above ambient, RDS(on) is ~40 % higher than the 25 °C spec.

### Switching Loss

```
P_sw = 0.5 × VDS × ID × (t_on + t_off) × f_sw
```

| Parameter | Example Value |
|-----------|-------------|
| VDS | 24 V |
| ID | 5 A |
| t_on + t_off | 50 ns (with gate driver) |
| f_sw | 20 kHz |
| P_sw | 0.5 × 24 × 5 × 50e-9 × 20000 = 0.06 W |

At 20 kHz with a fast gate driver, switching losses are small. At 100 kHz with slow gate drive (500 ns transitions): P_sw = 0.6 W — suddenly significant.

### Total Loss per FET

```
P_total = P_cond + P_sw
Example: 5² × 0.025 × 1.4 + 0.06 = 0.94 W (at 100 °C junction)
```

For an H-bridge with two FETs conducting at any time: 2 × 0.94 = 1.88 W total.

## Heatsinking

### PCB Copper Area as Heatsink (DPAK, D2PAK, QFN)

Surface-mount packages dissipate heat primarily through the thermal pad into the PCB copper. The copper area directly under and around the package determines R_θSA:

| Copper Area | Approximate R_θSA | Practical Power (ΔT = 50°C) |
|------------|-------------------|------------------------------|
| 1 cm² | 80–100 °C/W | 0.5 W |
| 4 cm² | 40–50 °C/W | 1.0 W |
| 16 cm² (4×4 cm) | 20–30 °C/W | 2.0 W |
| 25 cm² + vias to inner layers | 10–15 °C/W | 3.5 W |

Use thermal vias (0.3 mm diameter, 1.2 mm pitch, array of 5×5 or more) under the thermal pad to connect to inner copper planes. This can halve R_θSA compared to single-layer copper.

### Bolt-On Heatsink (TO-220)

For TO-220 packages, a bolt-on aluminum heatsink provides the lowest thermal resistance:

| Heatsink Type | R_θSA | With Fan |
|--------------|-------|----------|
| Small clip-on (10 × 10 mm) | 20–30 °C/W | — |
| Medium fin (25 × 25 × 10 mm) | 10–15 °C/W | 5–8 °C/W |
| Large fin (40 × 40 × 20 mm) | 6–10 °C/W | 3–5 °C/W |

Apply thermal compound or a thermal pad between the TO-220 tab and the heatsink to fill air gaps (R_θCS ≈ 0.2–0.5 °C/W with compound vs 1–2 °C/W dry).

## Thermal Derating

As junction temperature rises, the maximum safe current decreases. The derating curve on the MOSFET datasheet shows this relationship:

```
I_D(max) at T_J = I_D(25°C) × √((T_J(max) − T_J) / (T_J(max) − 25°C))
```

At T_J = 125°C with T_J(max) = 150°C: I_D = I_D(25°C) × √(25/125) = I_D(25°C) × 0.45 — the MOSFET can only carry 45 % of its rated current at this temperature.

## Driver IC Thermal Management

Integrated driver ICs (DRV8825, TB6612FNG, L298N) have internal thermal protection that reduces output current or shuts down when the die temperature exceeds a threshold:

| IC | Thermal Shutdown | Thermal Warning | Action |
|----|-----------------|----------------|--------|
| DRV8825 | ~150 °C | None | Latched shutdown (requires power cycle) |
| TMC2209 | ~150 °C | UART status flag | Auto-recovers when cool |
| L298N | ~130 °C | None | Shutdown, auto-recovers |
| TB6612FNG | ~170 °C | None | Shutdown, auto-recovers |

## Tips

- Calculate the expected power dissipation before selecting the MOSFET package. If P_total > 1 W, a SOT-23 package is insufficient. If P_total > 3 W, a bare DPAK on copper may need thermal vias or a heatsink.
- Use an infrared thermometer or thermal camera during testing to identify hot spots. The junction temperature is always higher than the case temperature — typically by R_θJC × P_dissipated (5–15 °C for TO-220, up to 30 °C for QFN).
- Design for 80 % of the maximum junction temperature (120 °C for 150 °C parts) to provide margin for ambient temperature variations and component aging.
- Forced airflow (a small fan) can reduce R_θSA by 2–3× compared to natural convection. For enclosed installations without airflow, derate the design conservatively.

## Caveats

- The "50 A" rating on a DPAK MOSFET assumes the case is held at 25 °C — which requires infinite heatsinking. The practical continuous current for a DPAK on a PCB is typically 5–15 A depending on copper area and airflow.
- Thermal shutdown on driver ICs is a last-resort protection, not a design feature. Operating at the thermal limit cycles the IC between shutdown and recovery, producing intermittent motor operation. The root cause (insufficient heatsinking, excessive current) must be addressed.
- Copper pours on the PCB top and bottom layers conduct heat well (thermal conductivity ~400 W/m·K), but FR4 between layers is a poor thermal conductor (~0.3 W/m·K). Thermal vias through the FR4 are essential for heat transfer to inner or bottom layers.
- RDS(on) × I² underestimates total losses at PWM frequencies above 50 kHz because switching losses (which increase linearly with frequency) become comparable to conduction losses.

## In Practice

- **MOSFET case temperature measures 85 °C under load.** Using the package R_θJC (e.g., 2 °C/W for TO-220) and the dissipated power (e.g., 1.5 W): T_junction ≈ 85 + (2 × 1.5) = 88 °C. This is within the 150 °C limit but leaves only 62 °C of margin. If ambient temperature rises to 50 °C, T_junction reaches 123 °C — marginal. Adding a heatsink or improving airflow provides the necessary margin.

- **Motor driver IC thermally shuts down after 30 seconds of continuous operation.** The IC's thermal pad is not properly soldered to the PCB ground plane, or the ground plane is too small. Reworking the solder joint (ensuring full contact between the thermal pad and the PCB pad) and increasing the copper pour area around the IC typically resolves the thermal limitation.

- **Two MOSFETs in parallel share current unevenly, and one runs significantly hotter.** The hotter FET has lower RDS(on) (from manufacturing variation), carries more current, heats up further, and RDS(on) increases with temperature — eventually the two FETs thermally equalize. If the initial imbalance is too large, the hotter FET may exceed its thermal limit before equilibrium. Matching FETs from the same production lot and using individual gate resistors improves balance.

- **Circuit works on the bench but overheats in the enclosure.** Natural convection requires airflow around the heatsink. An enclosed box with no ventilation traps heat, raising ambient temperature inside the enclosure by 20–40 °C above external ambient. Adding ventilation openings at the bottom and top of the enclosure (chimney effect) or a small fan restores adequate cooling.
