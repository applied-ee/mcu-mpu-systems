---
title: "Audio DSP on MCUs"
weight: 20
bookCollapseSection: true
---

# Audio DSP on MCUs

Digital signal processing on a microcontroller operates under constraints that desktop audio software never encounters. A Cortex-M4 running at 168 MHz has roughly 2–3 million cycles per audio frame at 48 kHz — enough for a biquad filter cascade and a compressor, but not enough for a naive floating-point reverb. Fixed-point arithmetic, SIMD instructions (the Cortex-M4/M7 DSP extensions), and careful memory layout are not optional optimizations — they are the baseline for any real-time audio processing chain that needs to complete before the next DMA buffer is due.

These pages cover the DSP building blocks most commonly needed in embedded audio: fixed-point number formats, filter design and implementation, spectral analysis, dynamics processing, and time-domain effects. The focus is on practical implementation on Cortex-M and ESP32, using CMSIS-DSP and ESP-DSP where applicable.

## Pages

- **[Fixed-Point Audio Arithmetic]({{< relref "fixed-point-audio-arithmetic" >}})** — Q15/Q31 formats, saturation arithmetic, accumulator width, gain and mixing in integer math, and CMSIS-DSP helper functions.

- **[FIR & IIR Filters for Audio]({{< relref "fir-iir-audio-filters" >}})** — Biquad IIR (low-pass, high-pass, bandpass, notch, peaking EQ), FIR filters, coefficient calculation, direct-form II transposed, and cycle budgets.

- **[FFT & Spectral Analysis]({{< relref "fft-spectral-analysis" >}})** — Windowing functions, real FFT on fixed-point data, bin-to-frequency mapping, magnitude estimation, and block size selection.

- **[Dynamics Processing]({{< relref "dynamics-processing" >}})** — Compressor, limiter, gate, and expander implementations: envelope detection, attack/release in fixed-point, gain curves, and look-ahead trade-offs.

- **[Audio Effects & Mixing]({{< relref "audio-effects-mixing" >}})** — Delay lines, echo, reverb (comb + allpass networks), chorus, circular buffers in SRAM and PSRAM, and stereo panning/mixing.
