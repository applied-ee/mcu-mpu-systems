---
title: "FIR & IIR Filters for Audio"
weight: 20
---

# FIR & IIR Filters for Audio

Audio filtering on an MCU is dominated by two filter types: FIR (Finite Impulse Response) and IIR (Infinite Impulse Response). FIR filters offer linear phase and unconditional stability but require many taps for sharp cutoffs — a 48 kHz low-pass filter with a narrow transition band may need 200+ taps, each costing one multiply-accumulate per sample. IIR filters achieve equivalent frequency shaping with 5 coefficients (a single biquad section), but introduce phase distortion and can become unstable with quantized fixed-point coefficients. In embedded audio, IIR biquads handle the bulk of the work — EQ, crossovers, high-pass DC removal — while FIR filters appear in sample rate conversion, linear-phase requirements, and anti-aliasing.

## Biquad IIR Filter

The biquad (second-order IIR section) is the building block of embedded audio filtering. A single biquad implements one of the standard filter types — low-pass, high-pass, bandpass, notch, peaking EQ, or shelving — using five coefficients (b0, b1, b2, a1, a2) and a two-sample state memory.

### Direct Form II Transposed

The preferred implementation for embedded audio is Direct Form II Transposed (DF2T), which minimizes intermediate signal levels and reduces quantization noise in fixed-point:

```c
/* Biquad DF2T — floating-point reference implementation */
typedef struct {
    float b0, b1, b2, a1, a2;
    float z1, z2;  /* State variables (delay elements) */
} biquad_t;

float biquad_process(biquad_t *f, float x)
{
    float y = f->b0 * x + f->z1;
    f->z1 = f->b1 * x - f->a1 * y + f->z2;
    f->z2 = f->b2 * x - f->a2 * y;
    return y;
}
```

Each output sample requires 5 multiplications and 4 additions — approximately 10 cycles on a Cortex-M4 with DSP extensions, or ~480,000 cycles per second at 48 kHz. A single Cortex-M4 at 168 MHz can run roughly 35 biquad sections in series on a mono channel before saturating.

### Q15 Biquad Implementation

```c
/* Biquad DF1 — Q15 with 32-bit accumulator */
/* Coefficients scaled to Q15 (divide by a0, negate a1/a2) */
typedef struct {
    q15_t b0, b1, b2, a1, a2;
    q15_t x1, x2, y1, y2;  /* DF1 state */
} biquad_q15_t;

q15_t biquad_q15_process(biquad_q15_t *f, q15_t x)
{
    q31_t acc = 0;
    acc += (q31_t)f->b0 * x;
    acc += (q31_t)f->b1 * f->x1;
    acc += (q31_t)f->b2 * f->x2;
    acc -= (q31_t)f->a1 * f->y1;  /* Note: a1, a2 are negated in storage */
    acc -= (q31_t)f->a2 * f->y2;

    q15_t y = (q15_t)__SSAT(acc >> 15, 16);

    f->x2 = f->x1; f->x1 = x;
    f->y2 = f->y1; f->y1 = y;
    return y;
}
```

CMSIS-DSP provides `arm_biquad_cascade_df1_q15()` and `arm_biquad_cascade_df2T_f32()` that process entire blocks with optimized loop unrolling and SIMD instructions.

## Coefficient Calculation

Filter coefficients are calculated from the desired frequency, Q factor (bandwidth), and gain using the Robert Bristow-Johnson audio EQ cookbook formulas. These are typically computed offline or at initialization — not per-sample.

### Common Filter Types

| Type | Parameters | Application |
|---|---|---|
| Low-pass | Fc, Q | Anti-aliasing, subwoofer crossover |
| High-pass | Fc, Q | DC removal, bass roll-off |
| Bandpass | Fc, BW | Vocal isolation, band selection |
| Notch | Fc, BW | Hum removal (50/60 Hz), feedback suppression |
| Peaking EQ | Fc, Q, Gain (dB) | Parametric equalizer bands |
| Low shelf | Fc, Gain (dB) | Bass boost/cut |
| High shelf | Fc, Gain (dB) | Treble boost/cut |

```python
# Python — Biquad coefficient calculation (peaking EQ)
import math

def peaking_eq(fs, fc, gain_db, Q):
    """Calculate biquad coefficients for peaking EQ filter."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * fc / fs
    alpha = math.sin(w0) / (2 * Q)

    b0 = 1 + alpha * A
    b1 = -2 * math.cos(w0)
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * math.cos(w0)
    a2 = 1 - alpha / A

    # Normalize by a0
    return (b0/a0, b1/a0, b2/a0, a1/a0, a2/a0)

# 1 kHz peaking EQ, +6 dB, Q=1.4, at 48 kHz
coeffs = peaking_eq(48000, 1000, 6.0, 1.4)
```

### Converting to Q15 Coefficients

Biquad coefficients for audio filters can exceed 1.0 (especially a1, which approaches -2.0 for low-frequency filters at high sample rates). Fitting these into Q15 requires scaling:

1. Find the maximum absolute coefficient value.
2. Determine a post-shift value that scales all coefficients into Q15 range.
3. Apply the inverse shift to the accumulator after the MAC loop.

CMSIS-DSP's `arm_biquad_cascade_df1_q15()` uses a `postShift` parameter for this purpose. A `postShift` of 1 means all coefficients are stored as Q14 (divided by 2), and the output is left-shifted by 1 after filtering.

## Cascading Biquad Sections

Higher-order filters are built by cascading multiple biquad sections in series. A 4th-order Butterworth low-pass requires two biquad sections; a 10-band parametric equalizer requires 10 sections.

```c
/* CMSIS-DSP — 3-section biquad cascade, Q15 */
#define NUM_STAGES 3

static q15_t coeffs[5 * NUM_STAGES];   /* {b0,b1,b2,a1,a2} × 3 */
static q15_t state[4 * NUM_STAGES];    /* {x[n-1],x[n-2],y[n-1],y[n-2]} × 3 */
static arm_biquad_casd_df1_inst_q15 filter;

void eq_init(void)
{
    /* Fill coeffs[] with calculated values for each section */
    arm_biquad_cascade_df1_init_q15(&filter, NUM_STAGES, coeffs, state, 1);
}

void eq_process(q15_t *buffer, uint32_t block_size)
{
    arm_biquad_cascade_df1_q15(&filter, buffer, buffer, block_size);
}
```

Section ordering matters for fixed-point: place sections with the highest Q (narrowest bandwidth / highest gain) last, so they process signals that have already been attenuated by earlier sections. This reduces the chance of intermediate overflow.

## FIR Filters

FIR filters compute each output sample as a weighted sum of the current and past N-1 input samples:

```
y[n] = b[0]*x[n] + b[1]*x[n-1] + ... + b[N-1]*x[n-N+1]
```

### When to Use FIR Over IIR

| Criterion | FIR | IIR (Biquad) |
|---|---|---|
| Phase response | Linear (symmetric coefficients) | Non-linear |
| Stability | Always stable | Can become unstable with quantization |
| Coefficients for sharp cutoff | 100–500+ | 5–25 (cascaded biquads) |
| CPU per sample | N MACs | 5 MACs per section |
| Latency | N/2 samples (group delay) | 1–2 samples per section |
| Best for | Sample rate conversion, linear-phase crossovers | EQ, dynamics, real-time filtering |

```c
/* CMSIS-DSP FIR filter — Q15 */
#define FIR_TAPS 64

static q15_t fir_coeffs[FIR_TAPS];
static q15_t fir_state[FIR_TAPS + BLOCK_SIZE - 1];
static arm_fir_instance_q15 fir_inst;

void fir_init(void)
{
    arm_fir_init_q15(&fir_inst, FIR_TAPS, fir_coeffs, fir_state, BLOCK_SIZE);
}

void fir_process(q15_t *input, q15_t *output, uint32_t block_size)
{
    arm_fir_q15(&fir_inst, input, output, block_size);
}
```

## Cycle Budgets

At 48 kHz mono, the CPU budget per sample is the clock frequency divided by 48,000:

| MCU | Clock | Cycles/Sample (48 kHz) | Approx. Biquad Sections | Approx. FIR Taps |
|---|---|---|---|---|
| Cortex-M0 | 48 MHz | 1,000 | ~10 | ~50 |
| Cortex-M4 | 168 MHz | 3,500 | ~35 | ~300 |
| Cortex-M7 | 480 MHz | 10,000 | ~100 | ~800 |
| ESP32 (one core) | 240 MHz | 5,000 | ~50 | ~400 |
| ESP32-S3 (one core) | 240 MHz | 5,000 | ~50 | ~400 |

These estimates assume mono processing. Stereo halves the available budget per channel. Overhead from DMA callbacks, RTOS scheduling, and other tasks consumes 10–30% of the total budget.

## Tips

- Design filter coefficients in Python or MATLAB, export as C arrays, and verify the frequency response on the MCU with a swept sine test signal. Coefficient quantization to Q15 can shift the actual cutoff frequency and Q from the design values.
- For DC removal (high-pass at a very low frequency), a single first-order IIR filter is sufficient and cheaper than a biquad: `y[n] = alpha * (y[n-1] + x[n] - x[n-1])` where alpha is close to 1.0 (e.g., 0.995 for a ~7 Hz cutoff at 48 kHz).
- Use block processing (process 64–256 samples per call) rather than sample-by-sample calls to reduce function call overhead and enable SIMD optimization.

## Caveats

- IIR filters with low cutoff frequencies at high sample rates produce coefficients very close to the limits of Q15 representation. A 20 Hz high-pass at 48 kHz may require Q31 coefficients to avoid instability. If the filter oscillates or produces DC offset, coefficient quantization is likely the cause.
- Changing biquad coefficients while audio is flowing (e.g., real-time EQ adjustment) can produce clicks if the state variables are not handled. Cross-fading between two filter instances, or using coefficient smoothing (updating coefficients gradually over 10–50 ms), avoids the discontinuity.
- CMSIS-DSP `arm_biquad_cascade_df1_q15()` expects coefficients in a specific order and with negated a1/a2 values. Providing standard-form coefficients without negation produces a filter with completely wrong behavior but no error indication.

## In Practice

- **Filter produces a constant DC offset that grows over time** — a sign of IIR instability caused by coefficient quantization. The poles have moved outside the unit circle due to rounding. Switching to Q31 coefficients or redesigning with a slightly higher cutoff frequency typically resolves it.
- **EQ adjustment produces an audible click** — the biquad state variables (z1, z2) contain energy from the previous coefficient set. Instantaneously changing coefficients creates a discontinuity in the output. Implementing coefficient interpolation or double-buffered filter instances with cross-fading eliminates the artifact.
- **Filter response does not match the design curve** — Q15 coefficient quantization shifts the center frequency and Q of narrow-band filters (high Q). Measuring the actual frequency response on the target hardware with a swept sine confirms whether quantization is the source of the deviation.
