---
title: "Analog Front-End & Signal Conditioning"
weight: 10
bookCollapseSection: true
---

# Analog Front-End & Signal Conditioning

Every analog sensor ultimately produces a voltage (or current) that an ADC must convert to a digital value. What sits between the transducer and the ADC — amplifiers, filters, voltage dividers, reference sources — determines whether the digital result is meaningful or buried in noise. A 12-bit ADC is only as good as the signal presented to its input pin: impedance mismatches cause settling errors, missing anti-alias filters allow high-frequency noise to fold into the measurement band, and an unstable voltage reference makes every reading drift.

This subsection covers the cross-cutting concerns that apply to any analog sensor integration: ADC peripheral configuration, the passive and active circuits that condition a sensor's output, oversampling and averaging techniques that extract resolution beyond the ADC's native bit depth, and the calibration workflows that map raw codes to physical units.

## Pages

- **[ADC Configuration & Sampling Strategy]({{< relref "adc-configuration-and-sampling" >}})** — Resolution, sample time, channel sequencing, reference voltage selection, and the DMA patterns that keep conversion data flowing without CPU intervention.
- **[Signal Conditioning Circuits]({{< relref "signal-conditioning-circuits" >}})** — Voltage dividers, op-amp buffers, instrumentation amplifiers, anti-alias filters, and protection circuits between the sensor and the ADC pin.
- **[Oversampling & Noise Reduction]({{< relref "oversampling-and-noise-reduction" >}})** — Hardware and software oversampling, decimation for extra effective bits, averaging strategies, and when oversampling helps versus when it just averages noise.
- **[Calibration & Linearization]({{< relref "calibration-and-linearization" >}})** — Offset and gain calibration, multi-point linearization, lookup tables versus polynomial fits, and storing calibration data in flash.
