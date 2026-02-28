---
title: "Charge Pumps & Rail Generation"
weight: 30
---

# Charge Pumps & Rail Generation

Not every rail in an embedded system needs an inductor-based converter. Charge pumps generate auxiliary voltages — doubled, inverted, or fractionally scaled — using only capacitors and switches. When current requirements are modest (under 100–200 mA) and magnetic EMI is a concern, charge pumps offer a smaller, quieter, and often cheaper alternative to inductors. Negative voltage rails for op-amp symmetric supplies, boosted rails for LED gate drivers, and bias voltages for MEMS sensors are classic charge-pump applications in battery-powered systems.

## Operating Principle

A charge pump transfers energy between capacitors using switches (typically internal MOSFETs) driven by a clock. The basic voltage doubler works in two phases:

**Phase 1 (Charge):** The flying capacitor (C_fly) connects between Vin and ground. It charges to Vin through low-impedance switches.

**Phase 2 (Transfer):** The switches reconfigure so the bottom plate of C_fly connects to Vin and the top plate connects to the output through a diode or switch. The output sees Vin + V_Cfly = 2 × Vin (minus switch and diode drops). An output capacitor (C_out) smooths the pulsed charge delivery.

For a voltage inverter, the same two-phase process applies, but during the transfer phase, the flying capacitor's polarity is reversed relative to ground, producing −Vin at the output.

The fundamental relationship for an unregulated charge pump's output impedance:

```
R_out ≈ 1 / (f_sw × C_fly)
```

At f_sw = 100 kHz and C_fly = 1 µF, R_out ≈ 10 Ω. Under 20 mA load, the output droops by 200 mV from the ideal voltage. Increasing the switching frequency or the flying capacitor value reduces this impedance.

## Voltage Doubling

A voltage doubler converts 3.3 V to approximately 6.6 V (minus losses). Common applications:

- **LED drivers:** White and blue LEDs have forward voltages of 2.8–3.5 V. Driving them from a 3.3 V rail leaves no headroom for a current-limiting resistor. A doubled rail of 6.0–6.6 V provides ample headroom.
- **Gate drive for N-channel MOSFETs:** An N-channel FET used as a high-side switch needs a gate voltage above Vin. A charge pump generating 6.6 V from 3.3 V provides adequate overdrive for logic-level FETs (Vgs(th) = 1.0–2.0 V).
- **RS-485 transceivers:** Some transceivers (e.g., MAX485) require 5 V supply. A charge pump from 3.3 V can generate the required rail for low-current transceiver ICs.

### MAX1044 — Doubler/Inverter

The MAX1044 (Maxim/Analog Devices) is a classic charge pump IC supporting both doubling and inverting configurations:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 1.5–10 V |
| Output current (doubling) | Up to 20 mA (at Vin = 5 V) |
| Output current (inverting) | Up to 10 mA |
| Switching frequency | 10 kHz (internal oscillator) |
| Quiescent current | 200 µA |
| Package | DIP-8, SOIC-8 |

The MAX1044 is breadboard-friendly in DIP-8 and requires only two external capacitors (10 µF flying, 10 µF output). The BOOST pin can be driven with an external clock up to 45 kHz to increase output current and reduce ripple, or connected to an external capacitor to double the internal oscillator frequency.

### ICL7660 — The Classic

The ICL7660 (originally Intersil, now Renesas) is the original CMOS charge pump IC, dating to the 1980s but still widely used:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 1.5–10 V |
| Output current (inverting) | Up to 10 mA |
| Switching frequency | 10 kHz (typical) |
| Quiescent current | 170 µA |
| Package | DIP-8, SOIC-8 |

The ICL7660 defaults to an inverting configuration (Vin → −Vin). Voltage doubling requires connecting the output of the inverting stage to the input in a cascade arrangement. The low switching frequency (10 kHz) results in higher output ripple and larger required capacitors compared to modern alternatives. Electrolytic capacitors (10–100 µF) are typically used with the ICL7660 due to the low frequency — ceramic capacitors at these values were impractical when the IC was designed.

## Voltage Inversion

Generating a negative rail from a positive supply is the most common charge-pump application in mixed-signal designs. A symmetric supply (e.g., ±3.3 V) is required for many op-amp circuits to handle signals that swing below ground.

### TPS60400 — Inverting Charge Pump

The TPS60400 from Texas Instruments is a modern, low-current inverting charge pump:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 1.6–5.5 V |
| Output voltage | −Vin (unregulated) |
| Output current | Up to 60 mA |
| Switching frequency | 250 kHz (fixed) |
| Quiescent current | 35 µA |
| Package | SOT-23-5 |

At 250 kHz, the TPS60400 can use small ceramic capacitors (1 µF flying, 1 µF output — both X5R or X7R). The output voltage at no load is approximately −Vin + 50 mV (losses from switch resistance). Under 20 mA load, the output drops to approximately −Vin + 300 mV. The SOT-23-5 package makes it suitable for space-constrained designs.

A typical application: generating −3.3 V from a 3.3 V rail to supply the negative rail of an OPA2340 or MCP6022 op-amp. The op-amp draws 750 µA to 1 mA from each rail, well within the TPS60400's capacity.

### LM2776 — Low-Noise Inverter

The LM2776 from Texas Instruments targets noise-sensitive analog applications:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 2.7–5.5 V |
| Output voltage | −Vin (unregulated) |
| Output current | Up to 100 mA |
| Switching frequency | 1 MHz (fixed) |
| Quiescent current | 45 µA |
| Package | SOT-23-5 |

The 1 MHz switching frequency reduces output ripple to approximately 3 mV peak-to-peak at 10 mA load (compared to 15–20 mV for a 10 kHz device at the same load). The higher frequency also pushes the fundamental switching noise above the audio band and into a range that is easier to filter. The LM2776 requires 1 µF flying and 2.2 µF output capacitors, both ceramic.

## Regulated vs. Unregulated Charge Pumps

Most charge pumps are **unregulated** — the output voltage depends on the input voltage and load current. The output impedance model is:

```
V_out = ±N × Vin − I_load × R_out
```

Where N is the multiplication factor (1 for inversion, 2 for doubling) and R_out depends on switching frequency, flying capacitor size, and switch resistance.

**Regulated charge pumps** include an internal feedback loop that adjusts the effective duty cycle or switch impedance to maintain a constant output voltage. Examples:

| IC | Type | Regulated Output | Max Current |
|----|------|-----------------|-------------|
| TPS60150 | Doubler | 5.0 V fixed | 100 mA |
| LM2767 | Inverter | Adjustable (with ext. resistor) | 100 mA |
| MAX1720 | Inverter | −Vin (unregulated) | 100 mA |

Regulated charge pumps are less efficient than unregulated ones (the regulation loop dissipates the excess voltage as heat, similar to an LDO), but they provide a stable output voltage regardless of input variation — important when the input is a Li-Ion cell that swings from 4.2 V to 3.0 V.

## Flying Capacitor and Output Capacitor Sizing

### Flying Capacitor (C_fly)

The flying capacitor determines the charge pump's output impedance and current capability. Larger values reduce output impedance:

```
R_out ≈ 1 / (f_sw × C_fly)
```

| f_sw | C_fly = 0.1 µF | C_fly = 1.0 µF | C_fly = 10 µF |
|------|----------------|----------------|----------------|
| 10 kHz | 1000 Ω | 100 Ω | 10 Ω |
| 100 kHz | 100 Ω | 10 Ω | 1 Ω |
| 1 MHz | 10 Ω | 1 Ω | 0.1 Ω |

At 250 kHz (TPS60400) with 1 µF: R_out ≈ 4 Ω. Under 20 mA load, voltage droop = 80 mV. Under 60 mA load, droop = 240 mV. The datasheet's maximum output current rating accounts for this droop remaining within usable limits.

The flying capacitor must be rated for the voltage across it — which is approximately Vin for a doubler or inverter. For a 3.3 V input, a 6.3 V or 10 V rated capacitor is appropriate. X5R or X7R ceramic capacitors are preferred; avoid Y5V dielectric because its capacitance drops dramatically with temperature and DC bias.

### Output Capacitor (C_out)

The output capacitor smooths the pulsed charge delivery and provides energy during the non-transfer phase. Output ripple is approximately:

```
V_ripple ≈ I_load / (f_sw × C_out)
```

At I_load = 20 mA, f_sw = 250 kHz, C_out = 1 µF:

```
V_ripple ≈ 0.020 / (250e3 × 1e-6) = 80 mV
```

Increasing C_out to 4.7 µF reduces ripple to approximately 17 mV. For noise-sensitive analog applications, 10 µF or larger output capacitors are common, combined with a series RC filter (10 Ω + 1 µF) between the charge pump output and the sensitive load.

## Advantages Over Inductor-Based Converters

- **No magnetic EMI:** Inductors generate magnetic fields that couple into nearby traces and components. Charge pumps use only electric fields within capacitors, producing no stray magnetic flux. This matters for designs near magnetic sensors (magnetometers, current-sense transformers) or RF circuits.
- **Smaller footprint:** A charge pump IC in SOT-23-5 plus two 0402-size capacitors occupies less than 10 mm². An equivalent inductor-based converter requires a 3 × 3 mm or larger inductor plus the IC and capacitors.
- **Lower height profile:** Ceramic capacitors are 0.5–1.0 mm tall. Power inductors are 1.0–3.0 mm tall. For ultra-thin designs (wearables, smart cards), charge pumps enable significantly lower overall height.
- **Lower cost at low current:** A TPS60400 (SOT-23-5) plus two 1 µF capacitors costs less than a buck/boost IC plus inductor plus two capacitors for applications under 50 mA.

## Disadvantages and Limitations

- **Limited current capability:** Most charge pumps are rated for 50–200 mA maximum. Inductor-based converters routinely handle 1–5 A in similar-size packages.
- **Output impedance increases at low frequency:** Older charge pumps (ICL7660, MAX1044) switching at 10 kHz have output impedances in the tens of ohms, limiting load current and causing significant voltage droop.
- **Fixed voltage ratios:** An unregulated charge pump can only produce integer multiples or fractions of the input voltage (×2, ×(−1), ×0.5, ×(−0.5)). Arbitrary voltage ratios require regulated variants with efficiency penalties.
- **No energy storage in magnetics:** An inductor stores energy that can sustain output during load transients. A charge pump's energy storage is limited to the capacitors, resulting in worse transient response for sudden load steps.
- **Efficiency limited by voltage ratio mismatch:** A doubler producing 6.6 V from 3.3 V is near 100 % efficient (minus switch losses). But a regulated doubler producing 5.0 V from 3.3 V must dissipate the difference (6.6 V − 5.0 V = 1.6 V) across its regulation element, reducing efficiency to approximately 5.0/6.6 = 76 % — worse than an inductor-based boost converter at the same conversion ratio.

## Tips

- For negative rail generation under 10 mA (op-amp bias), the TPS60400 in SOT-23-5 with two 1 µF capacitors is the simplest and smallest solution — total BOM cost under $1.00 at quantity.
- Size the flying capacitor for 2–3× the minimum calculated value to account for capacitance derating under DC bias and temperature — a "1 µF" X5R capacitor at 3.3 V bias and 85 °C may only deliver 0.7 µF.
- Add a 10 Ω series resistor between the charge pump output and a sensitive analog load, followed by a 10 µF bypass capacitor at the load — this RC filter attenuates switching ripple by 20–30 dB above the filter's corner frequency.
- Use the LM2776 (1 MHz) instead of the ICL7660 (10 kHz) for new designs — the 100× higher switching frequency allows 100× smaller capacitors and produces far less ripple.
- For voltage doubling applications under 5 mA, consider a Dickson charge pump built from discrete diodes and capacitors driven by an MCU timer output — no dedicated IC required.

## Caveats

- **Unregulated output tracks input variation** — A charge pump inverter producing −Vin from a Li-Ion cell will swing from −4.2 V (full charge) to −3.0 V (discharged). If the load requires a specific negative voltage, a regulated charge pump or a post-regulation LDO is necessary.
- **Capacitor ESR affects efficiency** — At high switching frequencies (1 MHz), the ESR of the flying and output capacitors becomes a significant loss mechanism. Use low-ESR ceramic capacitors (X5R or X7R); avoid electrolytic capacitors with modern high-frequency charge pumps.
- **Startup inrush can be high** — When the charge pump enables, the flying and output capacitors charge from zero, drawing a brief high-current pulse from the supply. A 10 µF output capacitor charging to 3.3 V in 100 µs draws a peak current of approximately 330 mA. Soft-start circuitry (present in the LM2776 but absent in the ICL7660) mitigates this.
- **Flying capacitor voltage rating is often overlooked** — In a doubling configuration, the flying capacitor sees Vin across it. In a cascaded or Dickson multiplier, capacitors in later stages see higher voltages. Always verify the voltage stress on each capacitor in multi-stage topologies.
- **Charge pumps radiate at their switching frequency** — While they avoid magnetic EMI, the switched current on the PCB traces generates electric-field emissions at the fundamental and harmonics of the switching frequency. If the switching frequency or its harmonics fall in a sensitive band (e.g., AM broadcast, GPS L1 at 1575 MHz), interference is possible.

## In Practice

- A mixed-signal design using an LM4562 op-amp with ±5 V supplies, where the positive rail comes from USB and the negative rail comes from an LM2776 inverter, produces a cleaner analog output than the same design using a virtual ground (resistor divider) to simulate a negative rail — the true negative supply allows full bipolar swing without common-mode limitations.
- A design that replaces an ICL7660 with an LM2776 and switches from 10 µF electrolytic capacitors to 1 µF ceramic capacitors typically sees a 50 % reduction in board area for the charge pump circuit and a 10× reduction in output ripple.
- A gate driver circuit for a high-side N-channel MOSFET that uses a charge-pump bootstrap (like the IR2104 half-bridge driver) can fail if the high-side on-time exceeds the bootstrap capacitor's hold-up time — the gate voltage droops and RDS(on) increases, potentially causing thermal failure.
- A negative rail feeding an op-amp that "works on the bench" but clips unexpectedly in production often has an unregulated charge pump whose output voltage drops under the combined load of multiple op-amp channels — checking the voltage under worst-case load (all channels active, maximum output swing) reveals the droop.
- A wearable design that cannot tolerate any component taller than 1 mm above the PCB surface uses a TPS60400 charge pump instead of an inductor-based inverter — the tallest component in the charge pump solution is the SOT-23-5 IC at 0.95 mm, while even the smallest power inductor is 1.0 mm tall.
