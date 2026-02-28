---
title: "Buck Converters in Practice"
weight: 10
---

# Buck Converters in Practice

A single lithium-ion cell delivers 4.2 V at full charge and sags to about 3.0 V at cutoff. Most MCU systems need a regulated 3.3 V rail, making the buck (step-down) converter the default topology for the upper portion of the discharge curve — from 4.2 V down to roughly 3.5 V, where the converter still maintains dropout headroom. Modern micro-buck ICs achieve 90–96 % efficiency in this range, draw sub-microamp quiescent currents in sleep, and fit in packages smaller than 2 mm × 2 mm. Selecting the right IC, inductor, and capacitors — and placing them correctly on the PCB — determines whether the system meets its efficiency, noise, and thermal targets.

## Why Buck for Battery-to-3.3 V

The buck topology switches a high-side FET to chop the input voltage and filters the result through an inductor and output capacitor. For a 4.2 V → 3.3 V conversion, the duty cycle is roughly D = Vout / Vin = 3.3 / 4.2 ≈ 0.79, which is comfortably within the operating range of most buck controllers. Peak efficiency occurs near this duty cycle because conduction losses in the FETs are proportional to (1 − D) × I² × RDS(on), and switching losses scale with frequency and voltage swing. As the cell discharges toward 3.5 V, the duty cycle approaches 0.94 and dropout eventually forces the converter into 100 % duty (pass-through) mode, where it can no longer regulate. Below that threshold, a buck-boost topology is required.

## Specific ICs for Battery-to-3.3 V

| Parameter | TPS62802 | AP3429A | TLV62568 |
|-----------|----------|---------|----------|
| Input voltage range | 1.8–5.5 V | 2.5–5.5 V | 2.5–5.5 V |
| Output current (max) | 2 A | 2 A | 1 A |
| Quiescent current (Iq) | 400 nA (PFM) | 22 µA | 3.8 µA |
| Switching frequency | 2.2 MHz (typical) | 1.5 MHz | 1.5 MHz |
| Package | SOT-23-like (DSBGA, 1.05 × 0.70 mm) | SOT-23-5 | SOT-23-6 |
| Fixed output options | 3.3 V, 1.8 V, adj | 3.3 V, 1.2 V, adj | 3.3 V, 1.8 V, adj |
| Key feature | Ultra-low Iq, tiny footprint | Low cost, simple design | Good balance of Iq and size |

The **TPS62802** from Texas Instruments is a standout for battery-powered systems requiring ultra-low standby power. At 400 nA quiescent current, it consumes negligible energy during MCU sleep modes. The internal FETs handle 2 A output, and the 2.2 MHz switching frequency allows the use of a small 1 µH inductor. The DSBGA package (1.05 × 0.70 mm) is the smallest available but requires reflow soldering and careful pad design.

The **AP3429A** from Diodes Incorporated targets cost-sensitive designs. The SOT-23-5 package is widely available and easy to hand-solder for prototyping. The 22 µA quiescent current is higher than the TPS62802 but acceptable for systems that do not spend extended periods in sleep.

The **TLV62568** from Texas Instruments sits between the two — 3.8 µA quiescent current in a SOT-23-6 package, with 1 A output capability. It is well suited for sensor nodes drawing 50–200 mA average with periodic sleep intervals.

## Efficiency Curves and Load Dependence

Buck converter efficiency is not a single number — it varies dramatically with load current. A typical efficiency profile for a 4.2 V → 3.3 V conversion:

| Load Current | TPS62802 (PFM) | TPS62802 (Forced PWM) | AP3429A |
|-------------|-----------------|----------------------|---------|
| 100 µA | 90 % | 40 % | 60 % |
| 1 mA | 93 % | 55 % | 75 % |
| 10 mA | 95 % | 82 % | 88 % |
| 100 mA | 95 % | 93 % | 92 % |
| 500 mA | 93 % | 93 % | 90 % |
| 1 A | 91 % | 91 % | 88 % |
| 2 A | 87 % | 87 % | 84 % |

At light loads (below 10 mA), the difference between PFM and forced-PWM modes is enormous. In forced PWM, the converter continues switching at full frequency regardless of load, wasting power on gate drive and switching losses. In PFM (pulse-frequency modulation) mode, the converter skips pulses and only switches when the output droops below the regulation threshold. The TPS62802's 400 nA Iq in PFM mode means the converter itself nearly vanishes from the power budget during MCU deep sleep.

The penalty of PFM mode is output ripple. In forced PWM at 2.2 MHz, output ripple is typically 5–10 mV. In PFM mode at light load, ripple can reach 20–40 mV at a much lower effective frequency (sometimes audible in the 1–10 kHz range). For noise-sensitive analog circuits, forcing PWM mode and accepting the efficiency hit may be necessary.

## Light-Load Efficiency: PFM vs. PWM

Most modern buck ICs automatically transition between PFM and PWM based on load. The transition point is typically between 10–100 mA, set internally by the IC. Key behavioral differences:

**PFM mode (light load):**
- Switching occurs in bursts — short groups of pulses followed by idle periods
- Output ripple frequency varies with load (not a fixed frequency)
- EMI spectrum is spread across a wider bandwidth, making it harder to filter but lower in peak amplitude
- Iq drops to the datasheet quiescent specification

**Forced PWM mode (all loads):**
- Constant switching frequency, predictable EMI spectrum
- Clean, low-ripple output at all loads
- Higher losses at light load due to continuous switching
- Useful for applications requiring constant-frequency operation (e.g., AM radio nearby, sensitive ADC measurements)

The TPS62802 enters PFM automatically below approximately 20 mA. There is no mode pin — it is always auto-PFM. The TLV62568 offers a MODE pin: pulling it high forces PWM; leaving it floating or low enables auto-PFM.

## Inductor Selection

The inductor is the most critical external component. Four parameters govern selection:

**Inductance value:** Determined by the target ripple current. For a buck converter, the peak-to-peak inductor ripple current is:

```
ΔI_L = (Vin - Vout) × D / (f_sw × L)
```

For a 4.2 V → 3.3 V conversion at 2.2 MHz with a 1 µH inductor:

```
ΔI_L = (4.2 - 3.3) × (3.3/4.2) / (2.2e6 × 1e-6)
       = 0.9 × 0.786 / 2.2
       ≈ 0.32 A peak-to-peak
```

This gives a ripple ratio of about 16 % at 2 A load — well within the recommended 20–40 % range. A 2.2 µH inductor would halve the ripple but increase the physical size and may slow transient response.

**Saturation current (Isat):** The inductor must not saturate at the peak current, which is I_load + ΔI_L/2. For a 2 A load with 0.32 A ripple, the peak is 2.16 A. Selecting an inductor rated for at least 2.5–3 A Isat provides margin. Common choices:

| Inductor | Value | Isat | DCR | Size |
|----------|-------|------|-----|------|
| Murata LQH2MCN1R0M52 | 1.0 µH | 2.7 A | 55 mΩ | 2.0 × 1.6 × 0.9 mm |
| Würth 744373240010 | 1.0 µH | 3.6 A | 40 mΩ | 3.0 × 3.0 × 1.2 mm |
| TDK VLS201610CX-1R0M | 1.0 µH | 2.8 A | 80 mΩ | 2.0 × 1.6 × 1.0 mm |
| Coilcraft XFL3012-102 | 1.0 µH | 5.0 A | 24 mΩ | 3.0 × 3.0 × 1.2 mm |

**DCR (DC resistance):** Causes conduction losses (P = I² × DCR). At 2 A with a 55 mΩ DCR inductor, the loss is 220 mW — significant. The Coilcraft XFL3012 at 24 mΩ loses only 96 mW but costs more and occupies a larger footprint.

**Size tradeoff:** Smaller inductors (2.0 × 1.6 mm) fit tighter layouts but have higher DCR and lower Isat. Larger inductors (3.0 × 3.0 mm) offer lower DCR and higher current handling. For designs under 500 mA, 2.0 × 1.6 mm inductors are adequate. Above 1 A, the 3.0 × 3.0 mm class is preferred.

## Input and Output Capacitor Selection

**Input capacitors** handle the pulsed current drawn by the buck converter's switching. The RMS current in the input capacitor is approximately:

```
I_cin_rms = I_out × sqrt(D × (1 - D))
```

At 2 A load and D = 0.79: I_cin_rms ≈ 2 × sqrt(0.79 × 0.21) ≈ 0.81 A. A single 10 µF, 0603-size X5R ceramic capacitor (rated 10 V) handles this, but two 10 µF in parallel reduce ESR and improve ripple current sharing. Use X5R or X7R dielectric — Y5V capacitors lose 50–80 % of their capacitance at the DC bias voltage and are unsuitable.

**DC bias derating** is critical for MLCC (ceramic) capacitors. A 10 µF, 6.3 V, 0402-size X5R capacitor may derate to 4–5 µF at 4.2 V DC bias. Always check the manufacturer's DC bias curves. Selecting a 10 V-rated capacitor for a 4.2 V rail provides significantly more actual capacitance. Common practice is to use 10 V-rated capacitors on the input and 6.3 V-rated on the 3.3 V output.

**Output capacitors** filter the inductor ripple and support load transients. Most micro-buck datasheets recommend 22 µF on the output. A 22 µF, 6.3 V, 0805-size X5R capacitor provides roughly 15–18 µF effective capacitance at 3.3 V bias. Two 10 µF capacitors in parallel are a reasonable alternative if board space is tight in one axis. The output ripple voltage is:

```
V_ripple ≈ ΔI_L / (8 × f_sw × C_out)
```

With ΔI_L = 0.32 A, f_sw = 2.2 MHz, and C_out = 18 µF (effective):

```
V_ripple ≈ 0.32 / (8 × 2.2e6 × 18e-6) ≈ 1.0 mV
```

This is well within the 10 mV target for most digital loads.

## PCB Layout Guidelines

Poor layout can negate the performance advantages of even the best buck IC. The critical layout rules:

**1. Minimize the hot loop.** The switching current path — from input capacitor, through the high-side FET, through the inductor, through the output capacitor, and back through ground to the input capacitor — must be as short and tight as possible. This loop radiates EMI proportional to its area and the di/dt of the switching current. Place the input capacitor within 2 mm of the VIN and GND pins, and the inductor directly adjacent to the SW pin.

**2. Ground plane continuity.** Use a solid, unbroken ground plane on the layer immediately below the converter. Do not route signal traces through the ground area under the converter. The return current follows the path of least impedance, and slots in the ground plane force current to detour, increasing loop area and EMI.

**3. Output capacitor placement.** Place the output capacitor close to the load, not just close to the converter. If the load is an MCU 20 mm away, place one output capacitor near the converter's VOUT pin and a second near the MCU's VDD pin.

**4. Feedback trace routing.** For adjustable-output converters using a resistor divider, route the feedback trace (FB pin) away from the SW node and inductor. The SW node swings between 0 V and VIN at the switching frequency and couples noise into adjacent traces. Kelvin-connect the feedback divider to the output capacitor, not to a remote point on the output rail.

**5. Thermal pad connection.** Many buck ICs have an exposed thermal pad on the bottom. Connect this pad to the ground plane with multiple vias (4–9 vias in a grid pattern) to provide both electrical ground and thermal relief. Insufficient thermal vias can cause the IC to thermal-shutdown under sustained high-current loads.

## Enable Pin and Soft-Start Behavior

The enable (EN) pin controls whether the converter is active or in shutdown. In shutdown, input current drops to the leakage level (typically < 100 nA). Key behaviors:

- **Active-high logic:** Most buck ICs activate when EN is pulled above a threshold (typically 0.7–1.2 V) and shut down when EN is low. The TPS62802 has a 0.58 V typical enable threshold.
- **Internal pull-up or pull-down:** Some ICs include an internal pull-up resistor on EN (converter starts by default). Others leave EN floating, requiring an external pull-up. Always check the datasheet — a floating EN pin on an IC without an internal pull-up leaves the converter in an undefined state.
- **Soft-start:** Limits inrush current during startup by ramping the output voltage over a defined period (typically 0.5–5 ms). The TPS62802 has an internal 0.7 ms soft-start. Longer soft-start reduces inrush current stress on the battery and input capacitors but delays power availability. For sequenced multi-rail designs, the soft-start time directly affects the minimum delay between rail enable signals.

A common pattern for battery systems: connect EN to an MCU GPIO or a physical power switch through a voltage divider. During MCU deep sleep, the buck converter remains enabled to maintain the MCU supply rail. A separate load switch (controlled by the MCU) can disconnect downstream peripherals to minimize total system current.

## Tips

- Select an inductor with an Isat rating at least 30 % above the maximum load current to account for inductor tolerance, temperature derating, and transient peaks.
- Use X5R or X7R dielectric for all capacitors in the power path — Y5V and Z5U ceramics lose too much capacitance under DC bias and temperature to be reliable.
- Check the DC bias derating curves for the specific capacitor part number, not just the generic series — two "10 µF 0603 X5R" capacitors from different vendors can derate very differently.
- Place the input capacitor as close to the VIN and GND pins as physically possible — every millimeter of trace adds inductance that worsens voltage spikes at the switch node.
- If output ripple matters (feeding an ADC reference or RF VCO), consider adding a small LC post-filter (ferrite bead + 1 µF capacitor) after the main output capacitor.
- Use a fixed-output-voltage variant of the buck IC when possible — it eliminates the feedback resistor divider, saving two components and removing a noise coupling path.

## Caveats

- **Dropout voltage limits the useful range** — A buck converter operating at 4.2 V → 3.3 V stops regulating when the input drops below approximately 3.45–3.55 V (depending on RDS(on) and load current). At that point, the output follows the input minus the dropout voltage.
- **PFM mode creates variable-frequency noise** — While PFM dramatically improves light-load efficiency, the non-deterministic switching frequency makes EMI compliance harder and can interfere with AM radio bands or sensitive analog measurements.
- **Inductor saturation causes current runaway** — If the inductor saturates (peak current exceeds Isat), inductance drops sharply, ripple current spikes, and the converter may enter a destructive cycle of overcurrent followed by thermal shutdown. This is the most common failure mode in undersized designs.
- **MLCC capacitors are piezoelectric** — Ceramic capacitors on the output can produce audible noise (coil whine) in PFM mode at light loads, especially larger packages (0805 and above). Smaller packages or X7R dielectric reduce this effect.
- **Enable thresholds vary with temperature** — A marginal enable voltage near the threshold can cause oscillation (converter rapidly enabling and disabling) as temperature shifts the threshold.

## In Practice

- A battery-powered sensor node drawing 150 µA average with 200 mA periodic bursts benefits most from the TPS62802's 400 nA Iq — the converter's own consumption is negligible during the long sleep intervals between measurements.
- A prototype that shows excessive output ripple on an oscilloscope is often caused by probe ground lead inductance, not actual ripple — use a tip-and-barrel measurement technique or a dedicated ripple probe to get accurate readings.
- An efficiency measurement that consistently reads 5–8 % lower than the datasheet curve usually indicates the inductor DCR is higher than expected (often due to selecting a smaller, cheaper inductor) or the input/output capacitor ESR is too high.
- A buck converter that runs cool at 500 mA but overheats at 1.5 A on the same board likely has insufficient thermal vias under the exposed pad — adding 4–6 vias in a grid pattern to the ground plane typically resolves the thermal issue.
- A design that needs to sustain 3.3 V output all the way down to 3.0 V cell voltage cannot use a simple buck converter — a buck-boost topology (TPS63001 or similar) is required for the lower portion of the discharge curve.
