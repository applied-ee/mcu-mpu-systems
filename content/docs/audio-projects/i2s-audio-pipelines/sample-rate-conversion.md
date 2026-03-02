---
title: "Sample Rate Conversion"
weight: 40
---

# Sample Rate Conversion

Sample rate conversion (SRC) becomes necessary whenever two audio components in a system operate at different sample rates — a 16 kHz voice capture feeding a 48 kHz playback pipeline, a USB audio interface at 44.1 kHz connected to an I2S codec at 48 kHz, or two I2S buses clocked from independent oscillators that drift relative to each other. On a desktop, SRC is a library call with negligible CPU cost. On a Cortex-M4, a high-quality sample rate converter can consume 30–50% of the available cycles, making the choice of algorithm and quality level a direct engineering trade-off.

## Integer-Ratio Conversion

When the input and output sample rates share a simple integer relationship, conversion reduces to interpolation (upsampling) and decimation (downsampling) by integer factors.

**Upsampling by factor L**: insert L-1 zero-valued samples between each input sample, then low-pass filter at the original Nyquist frequency. The filter removes imaging artifacts caused by the zero-insertion.

**Downsampling by factor M**: low-pass filter at the target Nyquist frequency, then discard M-1 out of every M samples. The filter prevents aliasing of frequencies above the new Nyquist limit.

**Rational ratio conversion (L/M)**: upsample by L, filter, then downsample by M. The filter is applied once at the lower of the two Nyquist frequencies, operating at the intermediate (upsampled) rate.

| Conversion | Ratio | Interpolation | Decimation | Filter Rate |
|---|---|---|---|---|
| 16 kHz → 48 kHz | 3/1 | L=3 | M=1 | 48 kHz |
| 48 kHz → 16 kHz | 1/3 | L=1 | M=3 | 48 kHz |
| 44.1 kHz → 48 kHz | 160/147 | L=160 | M=147 | 7.056 MHz |
| 8 kHz → 44.1 kHz | 441/80 | L=441 | M=80 | 3.528 MHz |

The 44.1 kHz ↔ 48 kHz conversion illustrates the problem: the simplest integer ratio is 160/147, requiring an intermediate sample rate of 7.056 MHz. A direct implementation is impractical — but polyphase filter decomposition makes it efficient.

## Polyphase Filters

A polyphase filter decomposes a large FIR filter into L sub-filters (phases), each processing only the samples that would be non-zero after upsampling. Instead of inserting zeros, upsampling, and filtering at the high intermediate rate, the polyphase structure computes only the output samples that are actually needed — reducing computation by a factor of L.

For rational conversion from rate F_in to F_out = F_in × L/M:

1. Design a single FIR low-pass filter with N taps operating at the intermediate rate (F_in × L).
2. Decompose it into L sub-filters of N/L taps each.
3. For each output sample, select the appropriate phase and compute one sub-filter convolution with the input samples.

The computational cost per output sample is N/L multiply-accumulate operations — independent of the upsampling factor L. A 480-tap FIR decomposed into 160 phases requires only 3 MACs per output sample.

```c
/* Simplified polyphase SRC structure */
typedef struct {
    const float *coeffs;     /* FIR coefficients, length = num_phases * taps_per_phase */
    float *history;          /* Input sample history, length = taps_per_phase */
    int num_phases;          /* L (interpolation factor) */
    int taps_per_phase;      /* N / L */
    int decim_factor;        /* M (decimation factor) */
    int phase_accumulator;   /* Tracks current phase position */
} polyphase_src_t;

int polyphase_process(polyphase_src_t *src, const float *in,
                      float *out, int in_frames)
{
    int out_count = 0;
    for (int i = 0; i < in_frames; i++) {
        /* Shift input into history buffer */
        shift_in(src->history, src->taps_per_phase, in[i]);

        /* Generate output samples for this input */
        while (src->phase_accumulator < src->num_phases) {
            const float *phase_coeffs =
                &src->coeffs[src->phase_accumulator * src->taps_per_phase];
            out[out_count++] = dot_product(phase_coeffs, src->history,
                                           src->taps_per_phase);
            src->phase_accumulator += src->decim_factor;
        }
        src->phase_accumulator -= src->num_phases;
    }
    return out_count;
}
```

## Linear Interpolation

For non-critical audio paths (notification sounds, voice prompts, UI feedback), linear interpolation provides minimal-cost sample rate conversion at the expense of quality. Each output sample is computed as a weighted average of two adjacent input samples:

```c
/* Linear interpolation SRC — fixed-point fractional phase */
typedef struct {
    int32_t phase;          /* Fractional position, Q0.31 */
    int32_t phase_step;     /* (F_in / F_out) in Q0.31 */
    int16_t prev_sample;
} linear_src_t;

void linear_src_init(linear_src_t *src, uint32_t in_rate, uint32_t out_rate)
{
    src->phase = 0;
    src->phase_step = (int32_t)(((uint64_t)in_rate << 31) / out_rate);
    src->prev_sample = 0;
}

int linear_src_process(linear_src_t *src, const int16_t *in,
                       int16_t *out, int in_count)
{
    int out_count = 0;
    int in_idx = 0;

    while (in_idx < in_count) {
        int32_t frac = src->phase & 0x7FFFFFFF;  /* Fractional part */
        int32_t result = (int32_t)src->prev_sample * (0x7FFFFFFF - frac)
                       + (int32_t)in[in_idx] * frac;
        out[out_count++] = (int16_t)(result >> 31);

        src->phase += src->phase_step;
        while (src->phase >= 0x7FFFFFFF && in_idx < in_count) {
            src->prev_sample = in[in_idx++];
            src->phase -= 0x7FFFFFFF;
        }
    }
    return out_count;
}
```

Linear interpolation attenuates high frequencies — it acts as a crude low-pass filter with a sinc-shaped frequency response that rolls off above about one-third of the sample rate. For voice (bandwidth below 4 kHz at 16 kHz sample rate), this is barely noticeable. For music, the loss of high-frequency content is clearly audible.

## Asynchronous Sample Rate Conversion (ASRC)

When two clocks are nominally the same frequency but derived from independent oscillators — for example, a USB audio host at 48,000.0 Hz and an I2S codec at 47,999.3 Hz — the sample rates drift relative to each other. Over time, this drift causes buffer overruns or underruns. ASRC continuously adjusts the conversion ratio to track the actual clock relationship.

The typical ASRC implementation:

1. **Measure drift** — Monitor the fill level of the buffer between the two clock domains. A steadily increasing fill level means the source is faster; decreasing means the sink is faster.
2. **Adjust ratio** — Feed the fill level error through a PI (proportional-integral) controller to compute a fine correction to the resampling ratio.
3. **Resample** — Apply the continuously varying ratio through a polyphase filter or polynomial interpolator.

On platforms with hardware ASRC (some STM32H7 SAI configurations, dedicated audio SoCs), drift compensation is handled transparently. On software-only platforms, ASRC adds CPU overhead for the ratio tracking and adaptive resampling.

## Quality/CPU Trade-Offs

| Method | Quality | CPU per Output Sample | RAM | Best For |
|---|---|---|---|---|
| Linear interpolation | Low | 2 MACs | ~8 bytes state | UI sounds, voice prompts |
| Polyphase FIR (48 taps/phase) | Good | 48 MACs | N × sizeof(coeff) + history | General audio, voice |
| Polyphase FIR (128 taps/phase) | High | 128 MACs | N × sizeof(coeff) + history | Music playback |
| CMSIS-DSP `arm_fir_interpolate` | Good | Depends on tap count | Provided by library | Cortex-M with CMSIS-DSP |
| libsamplerate (SRC_SINC_FASTEST) | High | ~100 MACs | ~4 KB | Linux SBCs, A-class |

On a Cortex-M4 at 168 MHz, a 48-tap-per-phase polyphase filter converting 16 kHz → 48 kHz consumes approximately 2–3% of CPU per mono channel. A 128-tap-per-phase filter at 44.1 kHz → 48 kHz consumes 8–12%.

## Tips

- For simple integer-ratio conversions (2x, 3x), CMSIS-DSP provides `arm_fir_interpolate_q15` and `arm_fir_decimate_q15` with optimized Cortex-M implementations. These are substantially faster than generic C implementations.
- Pre-compute polyphase filter coefficients offline (in Python/MATLAB) and store them as const arrays — computing filter coefficients at runtime wastes flash and startup time.
- When converting between 44.1 kHz and 48 kHz, consider whether the application truly needs it. If both the source and sink can operate at the same rate, avoiding SRC entirely is the best option.

## Caveats

- Linear interpolation introduces aliasing artifacts on downsampling — it does not include an anti-aliasing filter. Downsampling with linear interpolation produces audible distortion on signals with energy near Nyquist.
- Polyphase filter design requires careful specification of the transition band and stopband attenuation. Insufficient stopband rejection (below 80 dB for 16-bit audio) allows imaging or aliasing artifacts that are subtle but measurable.
- ASRC drift correction with an aggressive PI controller can introduce audible pitch modulation (warbling). The controller bandwidth should be much lower than the audio bandwidth — typically a correction rate of 1–10 Hz.

## In Practice

- **Periodic clicks at a slow rate (every few seconds) in a dual-clock system** — a classic symptom of clock drift without ASRC. The buffer between the two clock domains periodically overflows or underflows, causing a discontinuity. The click rate depends on the PPM difference between the two clocks.
- **High-frequency content sounds dull after SRC** — linear interpolation or an under-specified polyphase filter is attenuating the upper frequency range. Comparing the spectrum before and after SRC reveals the rolloff.
- **Slight pitch shift in converted audio** — indicates the SRC ratio is not exact. For integer-ratio conversion, this usually means the actual sample rates do not have the expected relationship (e.g., the codec is running at 47.952 kHz instead of 48 kHz due to a PLL configuration error).
