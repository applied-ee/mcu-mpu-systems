---
title: "Signal Conditioning Circuits"
weight: 20
---

# Signal Conditioning Circuits

The voltage at a sensor's output is rarely in the right form for direct connection to an ADC pin. It may exceed the ADC's reference voltage, have too high an output impedance, carry noise at frequencies that alias into the measurement band, or swing below ground. Signal conditioning — the analog circuitry between the sensor and the ADC — scales, buffers, filters, and protects the signal so that the digitized result faithfully represents the physical quantity being measured.

## Voltage Dividers for Level Shifting

When a sensor output exceeds the ADC's input range (typically 0–3.3 V), a resistive voltage divider scales it down. The output voltage is:

```
V_out = V_in * R2 / (R1 + R2)
```

**Example: Monitoring a 12 V battery with a 3.3 V ADC**

Target: scale 0–15 V to 0–3.0 V (leaving 0.3 V headroom below VREF).

```
V_out / V_in = 3.0 / 15.0 = 0.2
R2 / (R1 + R2) = 0.2
```

Choosing R2 = 10 kohm gives R1 = 40 kohm. Standard values: R1 = 39 kohm, R2 = 10 kohm, yielding a ratio of 0.204 (V_out = 3.06 V at 15 V input — acceptable).

The divider's output impedance is the parallel combination of R1 and R2:

```
R_out = R1 || R2 = (39k * 10k) / (39k + 10k) = 7.96 kohm
```

This 8 kohm source impedance requires an ADC sample time of at least 56 cycles on an STM32F4 at 30 MHz ADCCLK to allow the sample capacitor to settle to 12-bit accuracy. Higher divider resistances save power but demand longer sample times or an op-amp buffer.

| Application             | V_in Range | R1       | R2       | Ratio  | R_out    |
|-------------------------|-----------|----------|----------|--------|----------|
| 12 V battery monitor    | 0–15 V   | 39 kohm  | 10 kohm  | 0.204  | 7.96 kohm|
| 24 V industrial sense   | 0–30 V   | 100 kohm | 10 kohm  | 0.091  | 9.09 kohm|
| 5 V sensor to 3.3 V ADC| 0–5 V    | 10 kohm  | 20 kohm  | 0.667  | 6.67 kohm|
| USB VBUS detection      | 0–5.5 V  | 10 kohm  | 15 kohm  | 0.600  | 6.0 kohm |

**Power dissipation** through the divider is continuous. For the 12 V battery monitor: I = 12 V / 49 kohm = 0.245 mA, P = 2.9 mW. Increasing resistor values to 390 kohm / 100 kohm drops the current to 24.5 uA but raises R_out to 79.6 kohm — requiring either a very long sample time or a buffer amplifier.

## Op-Amp Voltage Followers (Buffers)

A unity-gain voltage follower presents the sensor signal to the ADC through a low output impedance (typically sub-100 ohm), eliminating the dependency between source impedance and ADC sample time.

```
Sensor output --> [+] Op-Amp --> ADC_IN
                  [-] <------/
```

The op-amp must be rail-to-rail input and output (RRIO) if the signal spans the full 0–3.3 V range. Common choices:

| Part        | Supply Range | GBW     | Slew Rate | Input Offset | Package     |
|-------------|-------------|---------|-----------|-------------|-------------|
| MCP6001     | 1.8–6 V    | 1 MHz   | 0.6 V/us  | +/-3 mV     | SOT-23-5    |
| OPA340      | 2.7–5.5 V  | 5.5 MHz | 6 V/us    | +/-0.5 mV   | SOT-23-5    |
| LMV321     | 2.7–5.5 V  | 1 MHz   | 1 V/us    | +/-7 mV     | SOT-23-5    |
| OPA2376    | 2.2–5.5 V  | 5.5 MHz | 2 V/us    | +/-5 uV     | SOIC-8      |

For DC or slowly varying signals (temperature, pressure, battery voltage), a 1 MHz GBW op-amp like the MCP6001 is more than sufficient. For signals with frequency content above a few kilohertz — audio, vibration sensors — a higher GBW part prevents gain rolloff and phase shift from distorting the signal.

**Decoupling:** Every op-amp needs a 100 nF ceramic capacitor directly across its supply pins, placed within 5 mm of the package. Without it, the op-amp can oscillate at high frequency, injecting noise into the measurement.

## Instrumentation Amplifiers for Bridge Sensors

Bridge sensors (load cells, strain gauges, Wheatstone bridge pressure sensors) produce a small differential voltage — typically 1-20 mV/V of excitation — superimposed on a large common-mode voltage at half the bridge supply. An instrumentation amplifier (INA) rejects the common-mode voltage and amplifies only the differential signal.

**Example: HX711 + load cell is the popular approach, but for direct MCU ADC integration:**

A 350 ohm strain gauge load cell with 2 mV/V sensitivity, excited at 3.3 V, produces:
- Full-scale differential output: 3.3 V * 2 mV/V = 6.6 mV
- Common-mode voltage: ~1.65 V (half bridge supply)

To map 0–6.6 mV to 0–3.0 V, the required gain is:

```
G = 3.0 V / 6.6 mV = 454
```

The INA333 (Texas Instruments) sets gain with a single resistor:

```
G = 1 + (100 kohm / R_G)
R_G = 100 kohm / (G - 1) = 100 kohm / 453 = 220.75 ohm
```

Standard value: R_G = 221 ohm (E96 series), giving G = 453.2.

| INA Part   | Supply    | CMRR (min) | Input Offset | Gain Range  | Typical Use           |
|------------|-----------|------------|-------------|-------------|----------------------|
| INA333     | 1.8–5.5 V| 100 dB     | +/-25 uV    | 1–1000      | Strain gauges        |
| INA128     | +/-2.25–18 V| 120 dB  | +/-50 uV    | 1–10000     | Precision bridges    |
| AD623      | 3–12 V   | 90 dB      | +/-200 uV   | 1–1000      | General purpose      |
| INA826     | 3–36 V   | 107 dB     | +/-150 uV   | 1–1000      | Industrial sensors   |

## RC Anti-Alias Filters

Any signal component above half the ADC's sampling rate (the Nyquist frequency) folds back into the measurement band as an alias. A low-pass filter before the ADC attenuates these high-frequency components. The simplest version is a single-pole RC filter:

```
         R_f
Vin ---/\/\/\---+--- Vout (to ADC)
                |
               C_f
                |
               GND
```

The cutoff frequency (-3 dB point) is:

```
f_c = 1 / (2 * pi * R_f * C_f)
```

A single-pole filter rolls off at -20 dB/decade. To achieve meaningful attenuation at the Nyquist frequency, the cutoff should be set well below half the sample rate — a factor of 5–10x below is typical.

**Example: 100 Hz signal sampled at 1 kSPS**

Nyquist frequency = 500 Hz. Target cutoff: 100 Hz (allows the signal through, attenuates above).

```
Choose C_f = 100 nF
R_f = 1 / (2 * pi * 100 * 100e-9) = 15.9 kohm
```

Standard value: R_f = 15 kohm, giving f_c = 106 Hz.

Attenuation at 500 Hz (Nyquist):

```
A = -20 * log10(sqrt(1 + (500/106)^2)) = -13.6 dB
```

This provides moderate attenuation. For signals requiring better alias rejection, a second-order filter (two RC stages, possibly with a buffer between them) achieves -40 dB/decade.

| Target Signal BW | Sample Rate | f_c Target | R_f      | C_f     | Atten. at Nyquist |
|------------------|-------------|-----------|----------|---------|-------------------|
| 10 Hz (temp)     | 100 SPS     | 15 Hz     | 100 kohm | 100 nF  | -20.5 dB          |
| 100 Hz (pressure)| 1 kSPS      | 150 Hz    | 10 kohm  | 100 nF  | -10.5 dB          |
| 1 kHz (vibration)| 10 kSPS     | 1.5 kHz   | 10 kohm  | 10 nF   | -10.5 dB          |
| 5 kHz (audio)    | 44.1 kSPS   | 8 kHz     | 2 kohm   | 10 nF   | -8.3 dB           |

Note that the filter resistor adds to the ADC's source impedance. The total resistance (R_f + R_source) determines the required ADC sample time. This is often the dominant constraint in the design.

## Input Protection

ADC inputs are vulnerable to voltages exceeding VREF or dropping below ground. Most MCU datasheets specify absolute maximum ratings of VDDA + 0.3 V and -0.3 V on analog input pins. Exceeding these ratings risks latch-up (parasitic thyristor turn-on) or permanent damage.

### Clamping Diodes

A pair of Schottky diodes from the ADC input to VDDA and GND clamps excursions to within one diode drop (0.2–0.3 V for Schottky) of the rails:

```
         VDDA
          |
         ---  D1 (Schottky, anode to signal)
          |
Signal --+--- series R (1-10 kohm) --- ADC_IN
          |
         ---  D2 (Schottky, cathode to signal)
          |
         GND
```

The series resistor limits current through the clamping diodes during a fault. A 1 kohm resistor limits current to 33 mA at a 33 V transient — well within the rating of most small-signal Schottky diodes (BAT54 series, rated for 200 mA).

### TVS Diodes

For higher-energy transients (industrial environments, field-deployed sensors), a bidirectional TVS diode (e.g., PESD3V3L2BT — 3.3 V clamping, SOT-23 package) absorbs the energy that would otherwise flow through the clamping diodes. TVS diodes respond in nanoseconds and handle surge currents of several amperes.

### Combined Protection Circuit

A robust input protection network for industrial applications:

```
Field sensor --> series R (10 kohm) --> TVS to GND --> RC filter --> Schottky clamps --> ADC_IN
```

This layered approach handles both fast transients (TVS) and sustained overvoltage (series R + Schottky clamps), while the RC filter serves double duty as anti-alias filtering and current limiting.

## Transfer Functions and System Gain

The complete signal path from sensor to ADC code has a composite transfer function. Documenting it explicitly prevents confusion when interpreting raw ADC values:

```
Physical quantity (e.g., temperature in C)
    --> Sensor transduction (e.g., 10 mV/C for LM35)
    --> Signal conditioning gain (e.g., 2x amplifier)
    --> ADC conversion (e.g., 3.3 V / 4096 counts)
    = ADC counts per physical unit
```

**Example: LM35 temperature sensor through a 2x gain amplifier**

```
Sensor: 10 mV/C
Amplifier: gain = 2
ADC: 12-bit, VREF = 3.3 V

Volts per count = 3.3 / 4096 = 0.000806 V/count
Volts per degree = 0.010 * 2 = 0.020 V/C

Counts per degree = 0.020 / 0.000806 = 24.8 counts/C
Temperature = ADC_raw / 24.8
```

Capturing this chain in a comment block above the conversion code saves significant debugging time when readings appear incorrect.

## Tips

- Place the anti-alias filter physically close to the ADC input pin, not near the sensor — the filter should be the last thing the signal passes through before the MCU.
- Choose film or C0G/NP0 ceramic capacitors for filter and reference bypass applications — X7R and X5R ceramics lose capacitance with applied DC voltage (up to 50% at rated voltage), which shifts the filter cutoff.
- When using a voltage divider, add a 100 nF capacitor in parallel with the bottom resistor (R2) to create a low-impedance path for AC noise to ground — this forms a combined divider and low-pass filter.
- For bridge sensors, run the excitation voltage from the same reference as the ADC (ratiometric measurement) — this cancels reference voltage drift because both the bridge output and the ADC full-scale track together.
- A common sanity check for buffer amplifier circuits is to measure the output with no input connected — the offset voltage and any oscillation become visible immediately.

## Caveats

- **Voltage dividers draw continuous current** — A 10 kohm + 10 kohm divider on a 12 V rail dissipates 7.2 mW and draws 0.6 mA continuously. In battery-powered systems, this quiescent drain may exceed the sensor's own current consumption.
- **Op-amp input bias current flows through source impedance** — A CMOS op-amp with 1 pA input bias is negligible, but a bipolar-input op-amp with 80 nA bias flowing through a 100 kohm source resistance creates an 8 mV offset — 10 LSB at 12-bit resolution.
- **Single-pole RC filters provide poor alias rejection** — At only -20 dB/decade, a single RC filter needs to be set very low relative to the sample rate to achieve meaningful attenuation. This limits the signal bandwidth more than necessary. Active second-order filters (Sallen-Key topology) achieve -40 dB/decade with modest complexity.
- **Clamping diodes have leakage current** — Schottky diodes conduct microampere-level leakage that flows through the source resistance and creates an offset voltage. At elevated temperatures (60–85 C), leakage increases by 10–100x. In precision applications, use high-impedance clamping or rely on the MCU's internal protection diodes alone.
- **Instrumentation amplifiers have a gain-bandwidth tradeoff** — An INA333 at gain = 450 has an effective bandwidth of only about 6 kHz (GBW / gain). The signal must be well within this bandwidth, or the output will be attenuated and phase-shifted.

## In Practice

**A voltage divider reading that slowly drifts upward over hours** often points to resistor self-heating in high-voltage applications. The power dissipated in R1 raises its temperature, changing its resistance (typical TCR for thick-film resistors: +/-100 ppm/C). For a 39 kohm resistor dissipating 3 mW, the temperature rise is small, but in compact layouts near other heat sources, the effect compounds.

**Bridge sensor readings that fluctuate by 5-10 counts even with a stable load** commonly trace to excitation voltage noise. If the bridge excitation comes from the 3.3 V supply rather than a dedicated reference, switching noise from the MCU's digital core modulates the bridge output. Switching to a ratiometric measurement (powering the bridge from VREF) or adding an LC filter on the excitation supply typically resolves this.

**An op-amp buffer that produces readings several millivolts away from the direct-connected sensor output** usually reveals the op-amp's input offset voltage. The MCP6001 specifies +/-3 mV typical offset, which is 3.7 LSB at 12-bit / 3.3 V. For applications requiring sub-millivolt accuracy, a precision op-amp like the OPA2376 (+/-5 uV offset) or a chopper-stabilized part eliminates this error.

**ADC readings that are noisier with the anti-alias filter installed than without it** can occur when the filter resistor is too large, increasing the thermal noise contribution. The thermal noise of a resistor is `V_n = sqrt(4 * k * T * R * BW)`. A 100 kohm resistor over a 1 kHz bandwidth generates 1.27 uV RMS of noise — small. But if the ADC's noise floor is similarly small (as on the STM32H7 at 16-bit resolution), the added resistor noise becomes significant. Reducing the filter resistance and increasing the capacitance proportionally maintains the same cutoff while reducing noise.
