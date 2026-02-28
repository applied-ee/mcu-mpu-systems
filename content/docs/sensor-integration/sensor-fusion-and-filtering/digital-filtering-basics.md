---
title: "Digital Filtering Basics (Moving Average, IIR, FIR)"
weight: 10
---

# Digital Filtering Basics (Moving Average, IIR, FIR)

Raw sensor readings from ADCs, accelerometers, temperature sensors, and other peripherals contain noise — thermal noise from the sensor element, quantization noise from the ADC, electrical interference from switching regulators, and mechanical vibration coupling through the PCB. Digital filtering removes or attenuates this noise in firmware before the data reaches higher-level algorithms like sensor fusion or control loops. The choice of filter type determines the tradeoff between noise rejection, latency, memory usage, and computational cost — all of which matter on resource-constrained microcontrollers.

## Moving Average Filter

The moving average is the simplest digital filter: sum the last N samples and divide by N. It is a special case of the FIR filter where all coefficients are equal (1/N). Despite its simplicity, the moving average is optimal for reducing random white noise while preserving a sharp step response — making it a strong default choice for sensor smoothing.

The latency introduced is N/2 samples. For a 100 Hz sample rate with N=16, this is 80 ms of group delay — acceptable for display updates but potentially problematic for control loops.

A ring buffer implementation avoids recomputing the entire sum each iteration:

```c
#define MA_WINDOW_SIZE 16

typedef struct {
    int32_t buffer[MA_WINDOW_SIZE];
    int32_t sum;
    uint16_t index;
    uint16_t count;
} MovingAverage;

void ma_init(MovingAverage *ma) {
    memset(ma->buffer, 0, sizeof(ma->buffer));
    ma->sum = 0;
    ma->index = 0;
    ma->count = 0;
}

int32_t ma_update(MovingAverage *ma, int32_t new_sample) {
    /* Subtract the oldest sample from the running sum */
    ma->sum -= ma->buffer[ma->index];
    /* Insert the new sample */
    ma->buffer[ma->index] = new_sample;
    ma->sum += new_sample;
    /* Advance the ring buffer index */
    ma->index = (ma->index + 1) % MA_WINDOW_SIZE;
    if (ma->count < MA_WINDOW_SIZE) {
        ma->count++;
    }
    return ma->sum / (int32_t)ma->count;
}
```

The division by `count` rather than `MA_WINDOW_SIZE` during the initial fill phase prevents the output from starting at a fraction of the true value. On Cortex-M0 parts without a hardware divider, choosing a power-of-two window size (8, 16, 32) turns the division into a right shift.

## Exponential Moving Average (First-Order IIR)

The exponential moving average (EMA) is the simplest infinite impulse response filter. It requires only one multiply and one add per sample, stores a single state variable, and provides tunable smoothing through a single parameter alpha:

```
y[n] = alpha * x[n] + (1 - alpha) * y[n-1]
```

Alpha ranges from 0 to 1. A small alpha (0.01-0.05) produces heavy smoothing with slow response. A large alpha (0.3-0.5) tracks the input closely but filters less noise. The equivalent time constant in samples is tau = 1/alpha, so alpha = 0.02 at a 100 Hz sample rate gives a time constant of 50 samples = 0.5 seconds.

Fixed-point implementation using Q16 format avoids floating-point on Cortex-M0/M3:

```c
typedef struct {
    int32_t state;       /* Q16 fixed-point filtered value */
    int32_t alpha_q16;   /* Q16 alpha (0 to 65536) */
} EMA_Filter;

void ema_init(EMA_Filter *f, int32_t alpha_q16, int32_t initial_value) {
    f->alpha_q16 = alpha_q16;
    f->state = initial_value << 16;  /* Convert to Q16 */
}

int32_t ema_update(EMA_Filter *f, int32_t new_sample) {
    /* y = alpha * x + (1-alpha) * y  in Q16 */
    int32_t sample_q16 = new_sample << 16;
    f->state = (int32_t)(((int64_t)f->alpha_q16 * sample_q16 +
                (int64_t)(65536 - f->alpha_q16) * f->state) >> 16);
    return f->state >> 16;  /* Return integer result */
}
```

With `alpha_q16 = 1311` (approximately 0.02), this produces a smooth output suitable for temperature or pressure readings sampled at 10-100 Hz.

## IIR Biquad Filter

For more precise frequency-domain control — a specific cutoff frequency, sharper rolloff, or bandpass/notch behavior — the biquad (second-order IIR section) is the workhorse filter on embedded systems. A single biquad implements a second-order transfer function with 5 coefficients:

```
y[n] = b0*x[n] + b1*x[n-1] + b2*x[n-2] - a1*y[n-1] - a2*y[n-2]
```

The Direct Form II Transposed structure is preferred for fixed-point because it minimizes intermediate value range:

```c
typedef struct {
    /* Q31 coefficients */
    int32_t b0, b1, b2;
    int32_t a1, a2;
    /* State variables (delay elements) */
    int32_t d1, d2;
    /* Post-shift for coefficient scaling */
    int8_t postShift;
} Biquad_State;

int32_t biquad_update(Biquad_State *bq, int32_t x) {
    int64_t acc;
    acc  = (int64_t)bq->b0 * x;
    acc += (int64_t)bq->b1 * bq->d1;  /* actually stores x[n-1] in DF2T */
    acc += (int64_t)bq->b2 * bq->d2;
    acc -= (int64_t)bq->a1 * bq->d1;
    acc -= (int64_t)bq->a2 * bq->d2;
    int32_t y = (int32_t)(acc >> (31 - bq->postShift));
    /* Update state */
    bq->d2 = bq->d1;
    bq->d1 = x;
    return y;
}
```

Designing biquad coefficients by hand is impractical. The typical workflow is to use a tool like the Iowa Hills filter designer, MATLAB's `butter()` or `cheby1()`, or Python's `scipy.signal.iirfilter()` to compute floating-point coefficients, then quantize them to Q31 or Q15 format for the target MCU. A 20 Hz low-pass Butterworth biquad at a 1 kHz sample rate is a common starting point for accelerometer noise rejection.

## FIR Filters

FIR (Finite Impulse Response) filters are non-recursive — the output depends only on the current and past inputs, never on past outputs. This makes them inherently stable and, when designed with symmetric coefficients, they exhibit exactly linear phase (constant group delay across all frequencies). These properties come at a cost: achieving the same stopband attenuation as an IIR filter requires significantly more taps. A 50 Hz low-pass FIR at 1 kHz sample rate with -60 dB stopband attenuation typically needs 80-120 taps, versus 4-6 for a comparable IIR cascade.

For most embedded sensor applications, the IIR biquad offers a better size/performance tradeoff. FIR filters become the preferred choice when linear phase is critical — for example, when time-aligning multiple sensor channels before fusion, or when implementing symmetric differentiating filters for edge detection.

The CMSIS-DSP library provides optimized FIR functions:

```c
#include "arm_math.h"

#define NUM_TAPS 32
#define BLOCK_SIZE 16

static arm_fir_instance_q15 fir_instance;
static q15_t fir_state[NUM_TAPS + BLOCK_SIZE - 1];
static q15_t fir_coeffs[NUM_TAPS];  /* Precomputed coefficients in Q15 */

void fir_filter_init(void) {
    arm_fir_init_q15(&fir_instance, NUM_TAPS, fir_coeffs,
                     fir_state, BLOCK_SIZE);
}

void fir_filter_process(q15_t *input, q15_t *output) {
    arm_fir_q15(&fir_instance, input, output, BLOCK_SIZE);
}
```

The CMSIS-DSP FIR leverages the Cortex-M4/M7 SIMD instructions (dual 16-bit MAC) to process two coefficients per cycle, making a 32-tap FIR practical at sample rates up to several hundred kHz on a 168 MHz Cortex-M4.

## CMSIS-DSP Filter Functions

The CMSIS-DSP library (included with STM32CubeF4/H7 and available standalone) provides production-quality filter implementations in Q15, Q31, and float32 formats:

| Function | Description | Formats |
|----------|-------------|---------|
| `arm_fir_*` | General FIR filter | Q15, Q31, f32 |
| `arm_biquad_cascade_df1_*` | Cascaded biquad IIR (DF1) | Q15, Q31, f32 |
| `arm_biquad_cascade_df2T_*` | Cascaded biquad IIR (DF2T) | f32, f64 |
| `arm_fir_decimate_*` | FIR with decimation | Q15, Q31, f32 |
| `arm_fir_interpolate_*` | FIR with interpolation | Q15, Q31, f32 |

These functions process data in blocks rather than sample-by-sample, which amortizes function call overhead and enables SIMD utilization. A block size of 16-64 samples is typical.

## Fixed-Point Representation

Cortex-M0 and M3 lack a floating-point unit, and even on Cortex-M4F the FPU is single-precision only. Fixed-point arithmetic is essential for filters on these platforms.

| Format | Range | Resolution | Multiply Result |
|--------|-------|------------|-----------------|
| Q15 | -1.0 to +0.999969 | 3.05e-5 | Q30 (32-bit) |
| Q31 | -1.0 to +0.9999999995 | 4.66e-10 | Q62 (64-bit) |
| Q1.15 | -2.0 to +1.999969 | 6.10e-5 | Needs care |

Conversion between integer ADC readings and Q15: a 12-bit ADC produces values 0-4095. Centering at 2048 and shifting left by 3 places gives a Q15 representation: `q15_value = (adc_raw - 2048) << 3`. This maps the ADC range to approximately -1.0 to +1.0 in Q15.

The critical pitfall with fixed-point filters is overflow in the accumulator. A 32-tap FIR with Q15 coefficients and Q15 data produces partial products in Q30, and the sum of 32 such products can overflow a 32-bit accumulator. The CMSIS-DSP functions use a 64-bit accumulator internally to avoid this.

## Filter Type Comparison

| Property | Moving Average | EMA (1st-order IIR) | Biquad IIR | FIR |
|----------|---------------|---------------------|------------|-----|
| **Latency** | N/2 samples | ~1/alpha samples (exponential decay) | Low (2 samples state) | (N-1)/2 samples |
| **Memory** | N + 2 words | 2 words | 5 coefficients + 4 state | N coefficients + N state |
| **Computation** | 1 add + 1 subtract + 1 divide | 1 multiply + 1 add | 5 multiplies + 4 adds | N multiplies + N adds |
| **Phase distortion** | Linear phase (none) | Nonlinear | Nonlinear | Linear (symmetric coeffs) |
| **Stability** | Always stable | Always stable (0 < alpha < 1) | Can be unstable if poles outside unit circle | Always stable |
| **Frequency selectivity** | Poor (sinc response) | Poor (first-order rolloff, -20 dB/dec) | Good (tunable cutoff, rolloff) | Excellent (arbitrary response) |
| **Best use case** | White noise on slow signals | Quick smoothing, minimal RAM | Precise cutoff needed | Linear phase critical |

## Tips

- Start with a moving average or EMA before reaching for more complex filters — for many sensor applications (temperature, pressure, humidity), the simple filters are sufficient and easier to tune at the bench.
- Choose power-of-two window sizes for the moving average on parts without a hardware divider — the compiler will replace the division with a right shift.
- When using CMSIS-DSP biquad functions, cascading two second-order sections (forming a fourth-order filter) provides -80 dB/decade rolloff, which is enough for most sensor noise rejection needs.
- Design filter coefficients offline in Python or MATLAB, then export as C arrays — avoid computing coefficients at runtime on the MCU.
- Always validate filter behavior by logging raw and filtered data simultaneously and plotting both — the effect of the filter should be visually obvious. If no difference is visible, the cutoff frequency is likely too high.

## Caveats

- The EMA has a long tail: after a step input, it takes approximately 5*tau samples to settle within 1% of the final value. At alpha = 0.02 and 100 Hz, this is 2.5 seconds — a surprisingly long transient for what appears to be a simple filter.
- Fixed-point biquad filters with high Q (narrow bandwidth) are susceptible to coefficient quantization effects. A Q31 biquad with a notch filter at 50 Hz and a Q of 30 may shift the notch center frequency by several Hz due to quantization of a1 and a2. Double-precision or float32 coefficients are sometimes necessary for narrow-band filters.
- Integer overflow in moving average accumulators is silent and catastrophic. A 32-sample window with 16-bit ADC values (0-65535) produces a maximum sum of 2,097,120 — safe in a 32-bit integer. But if the input is already scaled or 24-bit, the sum overflows without warning. Always verify the maximum possible accumulator value against the integer width.
- Cascading multiple EMA stages (using the output of one as the input of the next) does increase filter order, but the resulting frequency response is not equivalent to a properly designed higher-order filter. The cutoff frequency shifts and the passband droops unpredictably.

## In Practice

- **A filtered signal that still shows periodic spikes** often indicates that the noise source is not random but synchronous — typically switching regulator noise at 100 kHz-2 MHz or 50/60 Hz mains pickup. A low-pass filter attenuates these only if the cutoff is well below the interference frequency. When the interference frequency is close to the signal bandwidth, a notch filter (biquad with high Q centered on the interference frequency) is the correct tool.

- **Filtered output that tracks a step input with visible exponential approach** is the signature of first-order IIR / EMA behavior. The time constant is directly measurable: apply a known step and measure the time to reach 63.2% of the final value. If the measured time constant does not match the design intent, the sample rate assumption used to compute alpha is likely incorrect.

- **Moving average output that shows a staircase pattern** with flat segments of N samples each usually means the filter window size equals or exceeds the rate of change of the underlying signal. The filter is effectively decimating the signal. Reducing N or increasing the sample rate restores smooth output.

- **A biquad filter that oscillates or produces growing output** indicates instability from poles outside the unit circle. This happens when coefficients designed for one sample rate are used at a different rate, or when quantization pushes pole locations outside the stable region. Logging the filter output and observing exponential growth or bounded oscillation confirms the diagnosis — the coefficients need to be redesigned for the actual sample rate.
