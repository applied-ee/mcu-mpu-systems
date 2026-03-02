---
title: "Fixed-Point Audio Arithmetic"
weight: 10
---

# Fixed-Point Audio Arithmetic

Most MCUs used for audio — Cortex-M4, Cortex-M7, ESP32 — have hardware integer multipliers but no floating-point unit fast enough for real-time audio DSP (Cortex-M4F has single-precision FPU, but Q15/Q31 fixed-point on the DSP extensions is still faster for multiply-accumulate-heavy workloads). Fixed-point arithmetic represents fractional values as scaled integers, trading dynamic range for deterministic execution time and efficient use of the DSP instruction set. A 16-bit audio sample is already a fixed-point number — Q15 format, where the full-scale range [-1.0, +1.0) maps to [-32768, +32767]. Understanding Q-format arithmetic is not optional for embedded audio DSP; it is the foundation every filter, mixer, and dynamics processor is built on.

## Q-Format Conventions

Q-format notation QM.N describes a fixed-point number with M integer bits and N fractional bits, stored in a (M+N+1)-bit signed integer (the +1 is the sign bit). In audio DSP, the most common formats omit the integer bits:

| Format | Storage | Range | Resolution | Typical Use |
|---|---|---|---|---|
| Q15 | int16_t | [-1.0, +0.999969] | 1/32768 ≈ 30.5 µ | Audio samples, filter coefficients |
| Q31 | int32_t | [-1.0, +0.9999999995] | 1/2^31 ≈ 0.47 n | Accumulator, high-precision coefficients |
| Q1.15 | int16_t | [-2.0, +1.999969] | 1/16384 | Gain values > 1.0 |
| Q1.31 | int32_t | [-2.0, +1.9999999995] | 1/2^30 | Extended-range accumulator |

The convention in CMSIS-DSP and most embedded audio libraries is to use Q15 for 16-bit audio and Q31 for 32-bit audio or intermediate accumulators. The implicit decimal point sits immediately after the sign bit — so the integer value 0x7FFF in Q15 represents +0.999969, and 0x8000 represents -1.0.

## Conversion Between Formats

```c
/* Float to Q15 */
static inline int16_t float_to_q15(float x)
{
    if (x >= 1.0f) return 0x7FFF;
    if (x < -1.0f) return 0x8000;
    return (int16_t)(x * 32768.0f);
}

/* Q15 to float */
static inline float q15_to_float(int16_t x)
{
    return (float)x / 32768.0f;
}

/* Q15 to Q31 (left-shift by 16) */
static inline int32_t q15_to_q31(int16_t x)
{
    return (int32_t)x << 16;
}

/* Q31 to Q15 (right-shift by 16 with rounding) */
static inline int16_t q31_to_q15(int32_t x)
{
    return (int16_t)((x + (1 << 15)) >> 16);
}
```

## Multiplication

Multiplying two Q15 values produces a Q30 result in a 32-bit integer (15 + 15 = 30 fractional bits, with the product fitting in 31 bits plus sign). To convert back to Q15, shift right by 15:

```c
/* Q15 × Q15 → Q15 */
static inline int16_t q15_mul(int16_t a, int16_t b)
{
    int32_t product = (int32_t)a * (int32_t)b;
    return (int16_t)(product >> 15);
}
```

The Cortex-M4 DSP extension provides `SSAT` (signed saturate) and the `__SSAT` intrinsic, plus dual 16×16 multiply instructions (`SMULBB`, `SMLAD`) that perform two Q15 multiplications in a single cycle. CMSIS-DSP wraps these in portable functions:

```c
#include "arm_math.h"

q15_t a = 0x6000;   /* ~0.75 */
q15_t b = 0x4000;   /* ~0.50 */
q15_t result;
arm_mult_q15(&a, &b, &result, 1);  /* result ≈ 0.375 → 0x3000 */
```

## Saturation Arithmetic

Fixed-point audio requires saturation — clamping results to the maximum representable value instead of wrapping around. Without saturation, adding two Q15 values near full scale wraps to a large negative value, producing a harsh click or distortion artifact. With saturation, the result clips to +0.999969 or -1.0, which distorts but does not wrap.

```c
/* Saturating Q15 addition */
static inline int16_t q15_add_sat(int16_t a, int16_t b)
{
    int32_t sum = (int32_t)a + (int32_t)b;
    if (sum > 0x7FFF) return 0x7FFF;
    if (sum < -0x8000) return (int16_t)0x8000;
    return (int16_t)sum;
}
```

Cortex-M4/M7 provides hardware saturating add/subtract instructions (`QADD16`, `QSUB16`) that execute in a single cycle. CMSIS-DSP functions use these automatically.

## Accumulator Width

A common pattern in audio DSP is the multiply-accumulate (MAC) loop — summing products of samples and coefficients, as in FIR filtering. If each product is Q30 (from Q15 × Q15) and 128 products are summed, the accumulator must hold values up to 128 × 2^30 — requiring at least 37 bits. A 32-bit accumulator overflows after approximately 4 products at full scale.

The solution is a 64-bit accumulator:

```c
/* FIR filter with 64-bit accumulator */
int16_t fir_filter(const int16_t *coeffs, const int16_t *samples, int taps)
{
    int64_t acc = 0;
    for (int i = 0; i < taps; i++) {
        acc += (int64_t)coeffs[i] * samples[i];
    }
    /* Convert Q30 accumulator to Q15 output */
    int32_t result = (int32_t)(acc >> 15);
    /* Saturate to Q15 range */
    if (result > 0x7FFF) result = 0x7FFF;
    if (result < -0x8000) result = -0x8000;
    return (int16_t)result;
}
```

Cortex-M4 DSP instructions include `SMLALD` (signed multiply-accumulate long dual), which accumulates two 16×16 products into a 64-bit accumulator in a single cycle — specifically designed for this pattern.

## Gain and Level Control

Applying a gain factor in Q15 is a multiplication. A gain of 0.5 (-6 dB) is represented as 0x4000. A gain of 1.0 (0 dB) is 0x7FFF (not exactly 1.0 — the maximum Q15 value is 0.999969). For gains above 1.0, Q1.15 format extends the range to [-2.0, +2.0) by interpreting bit 15 as an integer bit:

```c
/* Apply gain in Q1.15 format (range -2.0 to +1.999969) */
static inline int16_t apply_gain_q1_15(int16_t sample, int16_t gain)
{
    int32_t result = ((int32_t)sample * gain) >> 14;  /* Q15 × Q1.15 → shift by 14 */
    if (result > 0x7FFF) return 0x7FFF;
    if (result < -0x8000) return (int16_t)0x8000;
    return (int16_t)result;
}
```

## Mixing Multiple Channels

Mixing N audio channels is a sum of N scaled samples. To prevent clipping when mixing, either attenuate each channel by 1/N before summing, or mix into a wider accumulator and apply a limiter afterward:

```c
/* Mix 4 channels into one, with per-channel gain (Q15) */
int16_t mix_4ch(const int16_t *ch0, const int16_t *ch1,
                const int16_t *ch2, const int16_t *ch3,
                const int16_t *gains, int index)
{
    int32_t acc = 0;
    acc += ((int32_t)ch0[index] * gains[0]) >> 15;
    acc += ((int32_t)ch1[index] * gains[1]) >> 15;
    acc += ((int32_t)ch2[index] * gains[2]) >> 15;
    acc += ((int32_t)ch3[index] * gains[3]) >> 15;

    if (acc > 0x7FFF) return 0x7FFF;
    if (acc < -0x8000) return (int16_t)0x8000;
    return (int16_t)acc;
}
```

## CMSIS-DSP Fixed-Point Functions

CMSIS-DSP provides optimized Q15 and Q31 functions for common audio operations:

| Function | Operation | Notes |
|---|---|---|
| `arm_add_q15` | Vector addition (saturating) | Uses `QADD16` on M4/M7 |
| `arm_mult_q15` | Element-wise multiplication | Q15 × Q15 → Q15 |
| `arm_scale_q15` | Multiply vector by scalar | With bit shift for range control |
| `arm_dot_prod_q15` | Dot product | 64-bit accumulator, Q34.30 result |
| `arm_fir_q15` | FIR filter | Optimized MAC loop |
| `arm_biquad_cascade_df1_q15` | IIR biquad filter | Direct Form I, Q15 |
| `arm_shift_q15` | Arithmetic shift | Positive = left, negative = right |

## Tips

- Use Q31 for intermediate calculations and convert to Q15 only at the final output stage — this preserves precision through multi-stage processing chains.
- When designing filter coefficients, verify that the sum of absolute coefficient values does not exceed the accumulator range. CMSIS-DSP functions handle this internally with 64-bit accumulators, but custom implementations may not.
- Profile fixed-point vs floating-point on the target hardware before committing to a format. On Cortex-M4F, single-precision float may be competitive with Q15 for simple operations due to the hardware FPU, but Q15 wins for MAC-heavy loops where DSP SIMD instructions process two samples per cycle.

## Caveats

- Q15 multiplication of -1.0 × -1.0 (0x8000 × 0x8000) produces +1.0, which is not representable in Q15. The result saturates to 0x7FFF. This edge case is rare in practice but can cause subtle asymmetric distortion at full scale.
- Right-shifting a negative number is implementation-defined in C. On ARM (and most architectures used for audio), arithmetic right shift is used (sign bit is replicated), but strictly portable code should use explicit saturation or compiler-specific intrinsics.
- Mixing Q15 and Q31 values without proper conversion produces garbage. A Q15 value of 0x4000 (+0.5) interpreted as Q31 is 0x00004000 (+0.0000076) — a 65536x attenuation error.

## In Practice

- **Harsh digital clipping on loud signals** — often indicates non-saturating arithmetic. The signal wraps from positive full-scale to negative full-scale, producing a sharp discontinuity that sounds distinctly different from soft clipping or analog distortion.
- **Gradual loss of low-level detail through a processing chain** — Q15 truncation accumulates across multiple stages. Each Q15 multiplication discards 15 bits of the product, introducing a quantization noise floor of approximately -90 dBFS. Multi-stage processing (filter → gain → filter → mix) compounds this, raising the effective noise floor by 3–6 dB per stage.
- **Asymmetric distortion on signals near full scale** — the Q15 range is asymmetric: -1.0 is representable but +1.0 is not. Operations that produce positive full-scale saturate to 0x7FFF (+0.999969), while negative full-scale maps exactly to 0x8000 (-1.0). This asymmetry is measurable on a spectrum analyzer as even-order harmonic distortion.
