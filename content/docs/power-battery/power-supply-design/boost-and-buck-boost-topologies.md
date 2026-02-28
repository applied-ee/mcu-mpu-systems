---
title: "Boost & Buck-Boost Topologies"
weight: 20
---

# Boost & Buck-Boost Topologies

A single lithium-ion cell delivers 4.2 V at full charge but sags to 3.0 V — or lower under heavy load — at end of discharge. A buck converter regulating 3.3 V output loses regulation once the cell drops below roughly 3.5 V, discarding 15–20 % of the battery's usable energy. Boost converters step voltage up, enabling operation from deeply discharged cells. Buck-boost converters handle both cases — seamlessly stepping down when the cell is above 3.3 V and stepping up when it drops below — extracting nearly the full capacity of the cell. Choosing between boost, buck-boost, and plain buck determines how much runtime the system can extract from a given battery.

## When Buck Is Not Enough

The fundamental limitation of a buck converter is that its output must be lower than its input minus the dropout voltage. For a 3.3 V output, a typical buck converter requires at least 3.45–3.6 V input. A lithium-ion cell at 3.5 V has roughly 20 % of its charge remaining. A system using only a buck converter either wastes that energy or shuts down prematurely. The discharge curve of a typical 18650 cell illustrates the problem:

| State of Charge | Cell Voltage (unloaded) | Cell Voltage (200 mA load) |
|----------------|------------------------|---------------------------|
| 100 % | 4.20 V | 4.10 V |
| 80 % | 3.95 V | 3.85 V |
| 60 % | 3.80 V | 3.70 V |
| 40 % | 3.70 V | 3.55 V |
| 20 % | 3.55 V | 3.35 V |
| 10 % | 3.40 V | 3.15 V |
| 5 % | 3.20 V | 2.95 V |

Below 20 % state of charge, the cell voltage under load drops into the range where a buck converter cannot maintain 3.3 V. A buck-boost or boost converter recovers this remaining energy.

## Boost Converters

A boost converter steps voltage up by storing energy in an inductor during the ON phase and releasing it to the output at a higher voltage during the OFF phase. The duty cycle relates input and output: D = 1 − (Vin / Vout), assuming ideal components.

### TPS61200 — Low-Iq Boost

The TPS61200 from Texas Instruments operates from 0.3–5.5 V input, producing a fixed or adjustable output up to 5.5 V. Key specifications:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 0.3–5.5 V |
| Output voltage | Up to 5.5 V (adjustable) |
| Maximum output current | 300 mA (at Vin = 3.3 V, Vout = 5.0 V) |
| Quiescent current | 55 µA (operating), < 1 µA (shutdown) |
| Switching frequency | Up to 1.3 MHz |
| Package | QFN-10 (3 × 3 mm) |

The TPS61200 can start from a single alkaline cell (0.9 V) and boost to 3.3 V, making it suitable for disposable-battery devices. It includes a power-save mode that reduces Iq at light loads by lowering the switching frequency. The pass-through mode engages when Vin > Vout, allowing the IC to act as a near-lossless pass-through — useful in designs where an external charger may supply 5 V directly.

One critical limitation: a boost converter cannot reduce its output below Vin. If a freshly charged Li-Ion cell at 4.2 V feeds a boost converter set for 3.3 V, the output will sit at approximately 4.2 V minus the body-diode drop. This makes a plain boost converter unsuitable as the sole regulator for a 3.3 V rail powered by a Li-Ion cell.

## Buck-Boost Converters

A buck-boost converter combines both topologies, automatically transitioning between buck mode (when Vin > Vout) and boost mode (when Vin < Vout). The transition region — where Vin ≈ Vout — is the most challenging operating point, requiring seamless mode switching without output glitches.

### TPS63001 — 3.3 V Buck-Boost

The TPS63001 from Texas Instruments is a widely used buck-boost converter optimized for single-cell Li-Ion to 3.3 V conversion:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 1.8–5.5 V |
| Output voltage | 3.3 V (fixed) |
| Maximum output current | 800 mA (at Vin = 3.6 V), 500 mA (at Vin = 2.4 V) |
| Peak efficiency | 96 % |
| Quiescent current | 50 µA (operating) |
| Switching frequency | Up to 2.4 MHz |
| Package | QFN-14 (3 × 3 mm) |

The TPS63001 uses a four-switch (H-bridge) topology with synchronous rectification, enabling high efficiency in both buck and boost modes. In the transition region (Vin ≈ 3.3 V), the converter alternates between buck and boost cycles on a pulse-by-pulse basis. The output ripple may increase slightly in this region (10–20 mV instead of the typical 5–10 mV) but remains well-regulated.

### LTC3440 — Buck-Boost Alternative

The LTC3440 from Analog Devices (formerly Linear Technology) provides similar functionality:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 2.4–5.5 V |
| Output voltage | Adjustable (set by resistor divider) |
| Maximum output current | 600 mA |
| Peak efficiency | 95 % |
| Quiescent current | 25 µA |
| Switching frequency | 300 kHz–2 MHz (adjustable) |
| Package | DFN-10 (3 × 3 mm), MSOP-10 |

The LTC3440 offers an adjustable switching frequency via an external resistor, allowing optimization for either efficiency (lower frequency, larger inductor) or size (higher frequency, smaller inductor). The Burst Mode operation reduces Iq to 25 µA at light loads, making it competitive for low-power designs.

## Efficiency Across the Input Voltage Range

Buck-boost efficiency varies with the Vin-to-Vout ratio. The converter operates most efficiently when it spends most of its time in a single mode (pure buck or pure boost). In the transition region, efficiency dips slightly due to the mode-switching overhead.

Typical TPS63001 efficiency at 3.3 V output, 100 mA load:

| Input Voltage | Operating Mode | Efficiency |
|--------------|----------------|------------|
| 5.0 V | Buck | 93 % |
| 4.2 V | Buck | 95 % |
| 3.6 V | Buck | 96 % |
| 3.3 V | Buck-Boost transition | 92 % |
| 3.0 V | Boost | 93 % |
| 2.7 V | Boost | 91 % |
| 2.4 V | Boost | 88 % |
| 2.0 V | Boost | 82 % |

At very low input voltages, efficiency drops because the boost ratio increases, requiring higher duty cycles and larger inductor currents for the same output power. The inductor current in boost mode is approximately:

```
I_inductor = I_out / (1 - D) = I_out × Vout / (Vin × η)
```

At Vin = 2.0 V, Vout = 3.3 V, η = 0.82, and I_out = 100 mA:

```
I_inductor = 0.1 × 3.3 / (2.0 × 0.82) ≈ 201 mA
```

The inductor sees significantly higher current in deep boost mode, which increases conduction losses and may approach saturation limits.

## Output Current Derating

A critical consideration: maximum output current decreases as input voltage drops. The converter has a maximum switch current (set by internal current limiting), and as the boost ratio increases, more of that switch current goes to maintaining the output voltage, leaving less for the load.

TPS63001 output current derating:

| Input Voltage | Max Output Current |
|--------------|-------------------|
| 5.0 V | 800 mA |
| 4.2 V | 800 mA |
| 3.6 V | 800 mA |
| 3.3 V | 600 mA |
| 3.0 V | 500 mA |
| 2.7 V | 400 mA |
| 2.4 V | 300 mA |
| 2.0 V | 200 mA |

A system that draws 500 mA at 3.3 V from a TPS63001 will operate correctly when the cell is above 3.0 V but will hit the current limit and drop out of regulation below 2.7 V. The design must account for worst-case load at worst-case input voltage.

## Component Selection

### Inductor

Buck-boost converters typically require a 2.2 µH inductor (TPS63001 datasheet recommendation). The inductor must handle the peak current in boost mode at the lowest expected input voltage. For a 500 mA output at 2.4 V input:

```
I_peak ≈ I_inductor_avg + ΔI_L / 2
```

With I_inductor_avg ≈ 760 mA (accounting for 88 % efficiency) and ΔI_L ≈ 400 mA at 2.4 MHz:

```
I_peak ≈ 760 + 200 = 960 mA
```

An inductor rated for at least 1.2–1.5 A saturation current is necessary. Recommended parts:

| Inductor | Value | Isat | DCR | Size |
|----------|-------|------|-----|------|
| Coilcraft XFL4020-222 | 2.2 µH | 3.15 A | 38 mΩ | 4.0 × 4.0 × 2.1 mm |
| Würth 744043002 | 2.2 µH | 1.8 A | 90 mΩ | 4.0 × 4.0 × 1.8 mm |
| Murata LQH44PN2R2MP0 | 2.2 µH | 1.95 A | 75 mΩ | 4.5 × 3.2 × 2.8 mm |

### Capacitors

Input and output capacitors for the TPS63001: the datasheet recommends 10 µF ceramic (X5R or X7R, 10 V rated) on the input and 22 µF on the output. Both should be placed within 3 mm of the respective IC pins. DC bias derating means a 22 µF, 6.3 V capacitor at 3.3 V bias delivers roughly 15–18 µF effective capacitance. Using two 10 µF capacitors in parallel provides equivalent capacitance with better ESR.

## Layout Considerations

Buck-boost layout follows similar principles to buck converters, with the added complication that both the input and output sides carry pulsed current. The four-switch topology has two hot loops:

1. **Input loop:** Input capacitor → high-side NFET → inductor → low-side NFET → ground → input capacitor. Minimize this loop area.
2. **Output loop:** Output capacitor → high-side PFET → inductor → low-side PFET → ground → output capacitor. Minimize this loop area as well.

The inductor should be placed between the input and output capacitors, with the IC as close to the inductor as possible. Both input and output ground returns should connect to the IC ground pins through short, wide traces or — preferably — a solid ground plane.

Avoid routing sensitive signal traces (ADC inputs, feedback dividers, crystal connections) near the inductor or switch-node connections. The switch node on a TPS63001 swings between 0 V and 5.5 V at up to 2.4 MHz with transition times of 5–10 ns, generating significant dv/dt coupling.

## When to Use Buck vs. Boost vs. Buck-Boost

| Criterion | Buck | Boost | Buck-Boost |
|-----------|------|-------|------------|
| Vin always > Vout + dropout | Best choice | Not applicable | Works but less efficient |
| Vin always < Vout | Not applicable | Best choice | Works but less efficient |
| Vin crosses Vout during operation | Cannot regulate | Output uncontrolled | Required |
| Typical Li-Ion → 3.3 V (full discharge range) | Loses 15–20 % capacity | Output uncontrolled when cell > 3.3 V | Best choice |
| Li-Ion → 1.8 V (core rail) | Best choice (always Vin > Vout) | Not applicable | Unnecessary overhead |
| Single alkaline cell → 3.3 V | Not applicable (1.5 V < 3.3 V) | Best choice | Works but boost is simpler |
| Two AA cells → 3.3 V (3.0 V → 2.0 V range) | Not applicable | Not ideal (Vin can exceed Vout when fresh) | Best choice |
| Peak efficiency priority | Highest (96–97 %) | High (93–95 %) | Slightly lower (92–96 %) |
| Component count | Lowest | Low | Higher (4 FETs vs. 2) |
| Cost | Lowest | Low | Moderate |

## Tips

- For Li-Ion to 3.3 V applications requiring full discharge range, a buck-boost converter is almost always the correct choice — the added cost (typically $0.30–0.50 more than a buck) is offset by 15–20 % more usable battery capacity.
- Place a 100 nF bypass capacitor in addition to the bulk 10 µF input capacitor — the small capacitor handles high-frequency transients that the larger capacitor's ESL cannot absorb.
- Check the output current derating table at the lowest expected input voltage under load — a converter rated for 800 mA at 4.2 V may only deliver 300 mA at 2.4 V.
- Set the switching frequency as high as the efficiency budget allows to minimize inductor size — a 2.2 MHz converter can use a 2.2 µH inductor, while a 500 kHz converter needs 10 µH for similar ripple performance.
- If the system has a 1.8 V core rail and a 3.3 V I/O rail, use a buck converter for the 1.8 V rail (Vin is always above 1.8 V across the Li-Ion discharge range) and a buck-boost only for the 3.3 V rail.

## Caveats

- **Buck-boost transition region increases ripple** — In the narrow Vin band around Vout (typically ±200 mV), the converter alternates between buck and boost on a cycle-by-cycle basis, which can increase output ripple by 2–3× compared to steady-state operation in either mode.
- **Boost converters have no output disconnect** — Most boost converters have a path from input to output through the inductor and body diode of the synchronous FET. If the input is present but the converter is disabled, the output still sees approximately Vin − 0.3 V. A load switch on the output is needed for true power isolation.
- **Inrush current at startup can be severe** — A buck-boost converter with 22 µF of output capacitance and a 1 ms soft-start draws a brief inrush pulse that can cause a voltage dip on the battery rail, potentially triggering undervoltage lockout on other converters sharing the same cell.
- **Efficiency numbers in datasheets use optimized layouts** — The evaluation board layout is tuned for best-case EMI and efficiency. A custom PCB with longer traces, split ground planes, or suboptimal capacitor placement may see 3–5 % lower efficiency.
- **The inductor is shared between both modes** — Unlike separate buck and boost converters, the inductor in a buck-boost sees the worst-case current of both modes. Sizing it only for the buck-mode current will cause saturation when the converter enters boost mode at low input voltage.

## In Practice

- A wearable device using a 100 mAh LiPo cell and a TPS63001 runs approximately 15–20 % longer than the same device with a TPS62802 buck-only converter, because the buck-boost extracts energy from the cell all the way down to 2.0 V instead of cutting off at 3.5 V.
- A system that works on the bench with a bench supply at 3.6 V but fails in the field is often running on a battery that sags below 3.3 V under transient load — replacing the buck converter with a buck-boost resolves the intermittent resets.
- An unexpected output voltage of 4.2 V on a boost converter configured for 3.3 V, measured when the cell is fully charged, is normal behavior — the boost converter cannot reduce its output below Vin, and a buck-boost should be used instead.
- A buck-boost converter that oscillates or produces excessive ripple specifically at Vin ≈ 3.3 V (but works well at 4.2 V and 2.5 V) is exhibiting the known transition-region behavior — adding 10 µF of output capacitance or selecting a newer IC with improved mode-transition control usually resolves it.
- A design using an LTC3440 with a 300 kHz switching frequency and a 10 µH inductor in a large 5 × 5 mm package can be shrunk significantly by switching to a TPS63001 at 2.4 MHz with a 2.2 µH inductor in a 4 × 4 mm footprint — the frequency-size tradeoff is substantial.
