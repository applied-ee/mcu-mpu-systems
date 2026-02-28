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

## Impedance vs Frequency Behavior

A real capacitor is not a perfect charge reservoir — it has parasitic equivalent series resistance (ESR) and equivalent series inductance (ESL). Below its self-resonant frequency (SRF), a capacitor behaves capacitively — impedance drops as frequency rises. At the SRF, impedance reaches a minimum equal to the ESR. Above the SRF, the ESL dominates and the part behaves like an inductor — impedance rises with frequency.

A 100nF 0402-size ceramic capacitor self-resonates around 80–100MHz; a larger 100nF 0805 package resonates lower, around 20–50MHz, due to its higher parasitic inductance. Above the SRF, the capacitor provides almost no decoupling. This is why effective power distribution networks use multiple capacitor values in parallel — each value covers a different frequency band. A typical MCU decoupling network might use 10µF for the 100kHz–1MHz range, 100nF for 1–100MHz, and 1nF or 100pF for frequencies above 100MHz. The combined impedance curve stays low across the full bandwidth of the MCU's switching activity.

## MLCC DC Bias Derating

Ceramic capacitors (MLCCs) lose capacitance when a DC voltage is applied across them. The effect is pronounced in high-K dielectrics (X5R and especially Y5V) and in smaller packages. A 10µF 0402 X5R capacitor rated for 6.3V may retain only 3–4µF of actual capacitance at 3.3V DC bias — a 60% loss. Larger packages (0805 or 1206) and higher voltage ratings derate less severely. When selecting bulk decoupling capacitors, consulting the manufacturer's DC bias curves is essential. Specifying a 10µF capacitor that delivers only 4µF at operating voltage can leave the MCU without adequate low-frequency decoupling reserve.

## Ferrite Bead Filtering for Analog Rails

For analog supply pins (VDDA), a ferrite bead placed in series between the digital VDD rail and the analog supply forms a simple LC low-pass filter with the local decoupling capacitor. The ferrite bead presents high impedance at frequencies above a few megahertz, attenuating switching noise from digital logic and buck converters. A common configuration uses a 600-ohm-at-100MHz ferrite bead followed by a 1µF to 4.7µF ceramic capacitor on the VDDA side. The filter cutoff depends on the bead's impedance characteristic and the capacitor value, but practical implementations typically attenuate noise above 1–5MHz by 20–30dB.

## Multi-Layer Board Considerations

On a four-layer board with dedicated power and ground planes, the planes themselves act as a large distributed capacitor (typically 50–200pF per square centimeter, depending on dielectric thickness). Keeping the power and ground planes on adjacent inner layers with thin dielectric (e.g., 0.1mm core) maximizes this interplane capacitance, providing broadband high-frequency decoupling that discrete capacitors cannot match above several hundred megahertz.

Via placement matters: the capacitor should connect to the power and ground planes through vias placed directly on or immediately adjacent to the capacitor pads, not routed through a trace first. Every millimeter of trace between the capacitor and the via adds inductance that defeats the purpose of close placement.

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
- **MLCC capacitance drops significantly with applied DC voltage** — A nominally 10µF X5R 0402 capacitor at 3.3V may deliver only 3–4µF; specify larger packages or higher voltage ratings to compensate, and always consult manufacturer DC bias derating curves

## In Practice

- An MCU that runs stable at lower clock speeds but exhibits random hard faults or peripheral register corruption at full speed often has insufficient decoupling — the supply voltage is drooping below minimum during transient current spikes at the higher clock rate
- A board that works with one firmware build but fails with another that enables DMA or uses more peripherals simultaneously commonly shows a decoupling deficiency — the increased transient current demand exceeds what the local capacitors can supply
- Probing a VDD pin with an oscilloscope and seeing spikes or ringing correlated with clock edges confirms inadequate local decoupling — the amplitude of the noise indicates how far the supply deviates from nominal
- An ADC that produces noisy readings despite clean analog input signals often traces back to missing or poorly placed VDDA decoupling — digital switching noise couples onto the analog supply through shared ground or power paths
