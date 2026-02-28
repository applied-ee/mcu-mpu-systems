---
title: "Decoupling & Bypass Capacitors"
weight: 20
---

# Decoupling & Bypass Capacitors

Every digital IC draws short, sharp bursts of current on each clock edge as internal transistors switch. These transient demands — often lasting only nanoseconds — cannot be met by a distant voltage regulator through long PCB traces. Decoupling capacitors, placed immediately next to the power pins, act as local charge reservoirs that supply current during these transients and prevent the supply voltage from drooping below the IC's minimum operating level.

## Why Decoupling Is Necessary

An STM32F4 running at 168MHz switches millions of internal gates per clock cycle. Each transition draws a momentary current spike that can reach hundreds of milliamps for a few nanoseconds. The inductance of even a 10mm PCB trace (roughly 10nH) limits how fast current can change through it. Without a local capacitor to supply this transient current, the voltage at the VDD pin dips briefly — potentially below the minimum operating voltage, causing bit errors, register corruption, or hard faults.

## Value Selection and Placement

The baseline rule is one 100nF (0.1µF) ceramic capacitor per VDD pin, placed as close to the pin as physically possible with short, wide traces. This value resonates with typical trace inductance to provide effective decoupling from roughly 1MHz to 100MHz. For MCUs with multiple VDD pins — the STM32F405, for instance, has four VDD pins plus a VDDA — each pin gets its own 100nF capacitor.

A bulk capacitor of 10–47µF (ceramic or low-ESR tantalum) is placed near the IC to handle lower-frequency transients and replenish the smaller capacitors. The STM32 hardware design guide recommends a 4.7µF ceramic on VDDA and 4.7µF bulk capacitors on VDD, in addition to the per-pin 100nF capacitors.

## ESR and ESL at High Frequency

A real capacitor is not a perfect charge reservoir — it has parasitic equivalent series resistance (ESR) and equivalent series inductance (ESL). At high frequencies, the ESL dominates, and the capacitor behaves like an inductor rather than a capacitor. A 100nF 0402-size ceramic capacitor self-resonates around 80–100MHz; above that frequency, it provides almost no decoupling. This is why some high-speed designs add a small 1nF or 100pF capacitor in parallel — its self-resonant frequency is higher, extending the effective decoupling range past 500MHz.

## Multi-Layer Board Considerations

On a four-layer board with dedicated power and ground planes, the planes themselves act as a large distributed capacitor (typically 50–200pF per square centimeter, depending on dielectric thickness). Via placement matters: the capacitor should connect to the power and ground planes through vias placed directly on or immediately adjacent to the capacitor pads, not routed through a trace first. Every millimeter of trace between the capacitor and the via adds inductance that defeats the purpose of close placement.

## Tips

- Place 100nF capacitors on the same layer as the IC, directly adjacent to each VDD pin — routing through a via to reach a capacitor on another layer adds inductance and degrades high-frequency decoupling
- Use 0402 or 0603 ceramic capacitors (X5R or X7R dielectric) for decoupling — smaller packages have lower parasitic inductance
- Add a single 4.7µF to 10µF bulk capacitor within 10mm of the MCU for low-frequency decoupling and to support current during wake-from-sleep transients
- Check the MCU's hardware design guide for specific recommendations — STM32 datasheets include reference schematics with exact values and placement
- For VDDA (analog supply), add a ferrite bead between VDDA and VDD in addition to the local decoupling capacitor to filter digital switching noise from the analog domain

## Caveats

- **Y5V and Z5U dielectric capacitors lose most of their capacitance at DC bias** — A 100nF Y5V capacitor at 3.3V DC bias may provide only 20–30nF of actual capacitance, which is inadequate for decoupling
- **A capacitor placed 15mm away with a thin trace provides almost no high-frequency decoupling** — The trace inductance at 100MHz makes the capacitor invisible to the IC during fast transients
- **More capacitance is not always better** — Adding excessive bulk capacitance near a regulator can cause startup instability or slow the output voltage ramp, potentially violating the MCU's power-on rise-time requirements
- **Tantalum capacitors can fail short under voltage spikes** — If used for bulk decoupling, derate tantalum capacitors to at most 50% of their rated voltage to avoid catastrophic failure

## In Practice

- An MCU that runs stable at lower clock speeds but exhibits random hard faults or peripheral register corruption at full speed often has insufficient decoupling — the supply voltage is drooping below minimum during transient current spikes at the higher clock rate
- A board that works with one firmware build but fails with another that enables DMA or uses more peripherals simultaneously commonly shows a decoupling deficiency — the increased transient current demand exceeds what the local capacitors can supply
- Probing a VDD pin with an oscilloscope and seeing spikes or ringing correlated with clock edges confirms inadequate local decoupling — the amplitude of the noise indicates how far the supply deviates from nominal
- An ADC that produces noisy readings despite clean analog input signals often traces back to missing or poorly placed VDDA decoupling — digital switching noise couples onto the analog supply through shared ground or power paths
