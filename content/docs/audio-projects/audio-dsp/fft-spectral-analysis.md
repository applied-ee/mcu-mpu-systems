---
title: "FFT & Spectral Analysis"
weight: 30
---

# FFT & Spectral Analysis

The Fast Fourier Transform converts a block of time-domain audio samples into a frequency-domain representation — a set of complex values (or magnitude/phase pairs) at discrete frequency bins. On an MCU, spectral analysis is used for audio visualization (LED spectrum displays, VU meters), pitch detection, feedback suppression, and as a preprocessor for more complex algorithms. The FFT itself is computationally tractable on Cortex-M4 and ESP32 (a 1024-point Q15 FFT takes roughly 70,000 cycles on Cortex-M4 using CMSIS-DSP), but the choices surrounding it — block size, window function, overlap, and magnitude calculation — determine whether the result is musically useful or misleading.

For ML-oriented audio feature extraction (MFCCs, mel spectrograms, log-filterbanks), see [Edge AI — Audio Feature Extraction]({{< relref "/docs/edge-ai/audio-speech/audio-feature-extraction" >}}).

## Block Size and Frequency Resolution

The FFT operates on a fixed block of N samples. The frequency resolution — the spacing between adjacent bins — is the sample rate divided by N:

| N | Bin Width at 16 kHz | Bin Width at 48 kHz | RAM (Q15 complex) | Cycles (M4, Q15) |
|---|---|---|---|---|
| 128 | 125 Hz | 375 Hz | 512 B | ~5,000 |
| 256 | 62.5 Hz | 187.5 Hz | 1 KB | ~12,000 |
| 512 | 31.25 Hz | 93.75 Hz | 2 KB | ~28,000 |
| 1024 | 15.625 Hz | 46.875 Hz | 4 KB | ~65,000 |
| 2048 | 7.8125 Hz | 23.4375 Hz | 8 KB | ~140,000 |
| 4096 | 3.906 Hz | 11.72 Hz | 16 KB | ~300,000 |

The tradeoff is fundamental: larger N gives finer frequency resolution but requires more memory, more computation, and higher latency (the block must be filled before the FFT runs). For a real-time spectrum display updating at 30 fps, the maximum block size is limited by the sample rate and desired refresh rate — at 48 kHz with 50% overlap, a 2048-point FFT updates every 21.3 ms (47 fps).

## Real FFT

Audio data is real-valued (no imaginary component). A real-valued FFT of N points produces only N/2+1 unique frequency bins (the upper half mirrors the lower half for real input). CMSIS-DSP provides `arm_rfft_q15` and `arm_rfft_fast_f32` which exploit this symmetry, using half the computation and memory of a complex FFT.

```c
/* CMSIS-DSP — Real FFT, Q15 */
#include "arm_math.h"

#define FFT_SIZE 1024

static arm_rfft_instance_q15 rfft_inst;
static q15_t fft_input[FFT_SIZE];
static q15_t fft_output[FFT_SIZE];  /* Complex output: interleaved [Re,Im] */

void spectrum_init(void)
{
    arm_rfft_init_q15(&rfft_inst, FFT_SIZE, 0 /* forward */, 1 /* bit-reverse */);
}

void compute_spectrum(const q15_t *audio_block)
{
    memcpy(fft_input, audio_block, FFT_SIZE * sizeof(q15_t));
    arm_rfft_q15(&rfft_inst, fft_input, fft_output);
    /* fft_output contains N complex values as interleaved [Re0,Im0,Re1,Im1,...] */
}
```

On ESP32, the ESP-DSP library provides `dsps_fft2r_sc16` (16-bit complex FFT) and `dsps_fft2r_fc32` (32-bit float FFT). The float version typically performs better on ESP32 due to the lack of SIMD Q15 instructions.

## Window Functions

Applying an FFT to a raw block of audio produces spectral leakage — energy from a frequency that does not align exactly with a bin spreads across neighboring bins, smearing the spectrum. A window function tapers the block edges toward zero, trading main-lobe width (frequency resolution) for side-lobe suppression (reduced leakage).

| Window | Main Lobe Width | Side-Lobe Level | Best For |
|---|---|---|---|
| Rectangular (none) | Narrowest (1 bin) | -13 dB | Not recommended for audio |
| Hann | 2 bins | -31 dB | General audio spectral analysis |
| Hamming | 2 bins | -42 dB | Speech processing, STFT |
| Blackman | 3 bins | -58 dB | High dynamic range measurement |
| Flat-top | 4 bins | -44 dB | Amplitude-accurate measurement |

The Hann window is the default choice for most audio spectral analysis — it provides a good balance between frequency resolution and leakage suppression. Pre-compute the window as a Q15 array and multiply element-wise before the FFT:

```c
/* Pre-computed Hann window, Q15, length N */
static q15_t hann_window[FFT_SIZE];

void init_hann_window(void)
{
    for (int i = 0; i < FFT_SIZE; i++) {
        float w = 0.5f * (1.0f - cosf(2.0f * M_PI * i / (FFT_SIZE - 1)));
        hann_window[i] = (q15_t)(w * 32767.0f);
    }
}

void apply_window(q15_t *buffer)
{
    arm_mult_q15(buffer, hann_window, buffer, FFT_SIZE);
}
```

## Bin-to-Frequency Mapping

Each FFT bin k corresponds to a center frequency:

```
f(k) = k × (sample_rate / N)
```

Bin 0 is DC. Bin N/2 is the Nyquist frequency. For a 1024-point FFT at 48 kHz, bin 100 corresponds to 4687.5 Hz.

For musical applications, the linear bin spacing of the FFT maps poorly to human pitch perception, which is approximately logarithmic. A common approach is to group FFT bins into logarithmically spaced bands (octave or third-octave bands) for display. Alternatively, for pitch detection, the bin with the maximum magnitude gives a frequency estimate with resolution equal to one bin width — interpolation between the peak bin and its neighbors (parabolic interpolation) improves this to approximately 1/10th of a bin width.

## Magnitude Calculation

The FFT output is complex: each bin has a real and imaginary component. The magnitude is `sqrt(Re² + Im²)`, but the `sqrt` is computationally expensive on MCUs without FPU. Common alternatives:

**Magnitude squared** (no sqrt): `Re² + Im²` — sufficient for relative comparisons, peak detection, and spectrum display where only relative levels matter. Uses two multiplications and one addition per bin.

**Approximate magnitude**: the alpha-max-plus-beta-min approximation provides a fast estimate within ~4% error:

```c
/* Fast magnitude approximation — ~4% max error */
q15_t fast_magnitude(q15_t re, q15_t im)
{
    q15_t abs_re = (re < 0) ? -re : re;
    q15_t abs_im = (im < 0) ? -im : im;
    q15_t max_val = (abs_re > abs_im) ? abs_re : abs_im;
    q15_t min_val = (abs_re > abs_im) ? abs_im : abs_re;
    /* 0.96 × max + 0.4 × min ≈ magnitude */
    return (q15_t)(((q31_t)max_val * 31457 + (q31_t)min_val * 13107) >> 15);
}
```

CMSIS-DSP provides `arm_cmplx_mag_q15()` which computes exact magnitude using an internal square root.

## Tips

- Use a power-of-two block size that matches the DMA buffer size to avoid copying data into a separate FFT input buffer. If the DMA buffer is 256 stereo samples, one channel provides 256 mono samples — a direct FFT input.
- For spectrum display applications, overlap-add with 50% overlap and a Hann window provides smooth updates. Each new block shares half its samples with the previous block, doubling the update rate without increasing the buffer size.
- Store the window coefficients in flash (const array) to save RAM on memory-constrained devices.

## Caveats

- The Q15 real FFT in CMSIS-DSP modifies the input buffer. If the original audio data is needed after the FFT (e.g., for pass-through monitoring), copy it to a separate buffer before calling `arm_rfft_q15`.
- FFT block size creates a fundamental latency floor. A 1024-point FFT at 48 kHz requires 21.3 ms of audio to fill — the spectral analysis is always at least one block period behind real time.
- Zero-padding (appending zeros to make a shorter block fit a larger FFT size) increases the apparent frequency resolution (smoother interpolation between bins) but does not increase the true resolving power — two tones separated by less than 1/T Hz (where T is the original signal duration) still appear as one peak regardless of zero-padding.

## In Practice

- **Spectrum display shows energy in all bins even during silence** — the noise floor of the ADC and analog front end is always present. With a 12-bit ADC, the quantization noise floor sits at approximately -72 dBFS, visible across all bins. A magnitude threshold or logarithmic (dB) display scale makes this less visually distracting.
- **A known single-tone test signal spreads across 5–10 bins** — spectral leakage from missing or incorrect windowing. Applying a Hann window concentrates most energy into 2–3 bins. If the window is applied but leakage persists, verify the window length matches the FFT size exactly.
- **FFT output magnitudes are unexpectedly small (near zero) for loud signals** — Q15 FFT functions apply internal scaling to prevent overflow. CMSIS-DSP's `arm_rfft_q15` divides by N during the FFT. The output values must be interpreted with this scaling in mind, or compensated by left-shifting the result.
