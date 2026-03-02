---
title: "Dynamics Processing"
weight: 40
---

# Dynamics Processing

Dynamics processors — compressors, limiters, gates, and expanders — control the volume envelope of an audio signal in real time. A compressor reduces the level of loud passages to prevent clipping and even out volume. A limiter is a compressor with a very high ratio, acting as a hard ceiling. A gate silences signals below a threshold to suppress background noise. These are not exotic effects; they are essential building blocks for any audio system that must handle variable input levels, from a conference microphone that switches between soft and loud speakers to a music player that must not overdrive a small speaker amplifier.

On an MCU, dynamics processing adds modest CPU overhead (comparable to one or two biquad filter sections) but requires careful fixed-point implementation of the envelope detector and gain computation.

## Architecture

All dynamics processors share a common signal flow:

```
Input → Level Detection → Gain Computation → Gain Application → Output
         (envelope)        (transfer curve)      (multiply)
```

1. **Level detection** extracts the instantaneous amplitude envelope from the audio signal.
2. **Gain computation** maps the detected level to a gain value through a transfer function defined by threshold, ratio, and knee parameters.
3. **Gain application** multiplies the original audio by the computed gain.

The processing is typically sidechain-based — the gain is computed from the signal level but applied to the original (unmodified) signal. This preserves the waveform shape and only changes its amplitude.

## Envelope Detection

The envelope detector extracts a smooth estimate of signal level. The most common approach is peak detection with separate attack and release time constants:

```c
/* Peak envelope detector — Q15 */
typedef struct {
    q15_t envelope;
    q15_t attack_coeff;    /* Higher = faster attack */
    q15_t release_coeff;   /* Lower = faster release */
} envelope_t;

void envelope_init(envelope_t *env, float attack_ms, float release_ms, float fs)
{
    env->envelope = 0;
    env->attack_coeff  = (q15_t)(32767.0f * (1.0f - expf(-1.0f / (attack_ms * 0.001f * fs))));
    env->release_coeff = (q15_t)(32767.0f * (1.0f - expf(-1.0f / (release_ms * 0.001f * fs))));
}

q15_t envelope_process(envelope_t *env, q15_t sample)
{
    q15_t abs_sample = (sample < 0) ? -sample : sample;

    if (abs_sample > env->envelope) {
        /* Attack — envelope rises toward input level */
        q31_t diff = (q31_t)(abs_sample - env->envelope) * env->attack_coeff;
        env->envelope += (q15_t)(diff >> 15);
    } else {
        /* Release — envelope falls toward input level */
        q31_t diff = (q31_t)(env->envelope - abs_sample) * env->release_coeff;
        env->envelope -= (q15_t)(diff >> 15);
    }
    return env->envelope;
}
```

Typical attack times range from 0.1 ms (percussive limiter) to 30 ms (gentle compression). Release times range from 50 ms (fast) to 1000 ms (smooth, musical). Very fast attack times (<1 ms) can introduce distortion on low-frequency signals — the envelope detector tracks individual waveform cycles rather than the overall amplitude.

## RMS vs Peak Detection

Peak detection responds to instantaneous amplitude and is best for limiting (protecting against transients). RMS (root-mean-square) detection responds to average power and produces smoother, more musical compression. RMS detection requires a running window:

```c
/* Simple RMS approximation — exponential moving average of squared signal */
q31_t rms_squared = 0;  /* Q31 representation of RMS² */

q15_t rms_detect(q15_t sample)
{
    q31_t sq = (q31_t)sample * sample;  /* Q30 */
    q31_t alpha = 328;  /* ~0.01, smoothing coefficient in Q15 */
    rms_squared += ((sq - (rms_squared >> 1)) * alpha) >> 15;

    /* Approximate sqrt using fast integer sqrt or lookup table */
    return fast_sqrt_q15(rms_squared >> 16);
}
```

## Compressor Transfer Curve

The compressor maps input level to output level through a piecewise-linear (or smooth knee) function defined by threshold, ratio, and optional knee width:

```
For input level L (in dB):
  if L < threshold:
      output = L                        (no compression)
  else:
      output = threshold + (L - threshold) / ratio

Gain (in dB) = output - L
```

| Ratio | Effect | Use Case |
|---|---|---|
| 1:1 | No compression | Below threshold |
| 2:1 | Gentle compression | Vocal leveling, bus compression |
| 4:1 | Moderate compression | Drums, aggressive vocal |
| 10:1 | Heavy compression | Broadcast limiting |
| ∞:1 | Brick-wall limiter | Output protection |

### Fixed-Point Gain Computation

Computing the gain curve in dB requires logarithms and exponentials, which are expensive on MCUs. Practical approaches:

**Lookup table**: Pre-compute the gain for each possible envelope level (256 or 1024 entries) and interpolate. This costs one table lookup per sample but requires ROM/RAM for the table.

**Linear approximation in the amplitude domain**: For a compressor with threshold T and ratio R, the gain applied to a sample with envelope level E (all in linear amplitude) is:

```c
/* Compressor gain — linear domain, Q15 */
q15_t compressor_gain(q15_t envelope, q15_t threshold, q15_t inv_ratio)
{
    if (envelope <= threshold) return 0x7FFF;  /* Unity gain */

    /* gain = threshold / envelope^(1 - 1/R) — approximated */
    /* Simplified: gain = threshold + (envelope - threshold) * inv_ratio */
    q31_t excess = envelope - threshold;
    q31_t compressed = threshold + ((excess * inv_ratio) >> 15);
    q31_t gain = ((q31_t)compressed << 15) / envelope;

    return (q15_t)__SSAT(gain, 16);
}
```

## Limiter

A limiter is a compressor with an infinite (or very high) ratio and very fast attack. Its purpose is to prevent the output from ever exceeding the threshold. The key parameters are:

- **Threshold**: The maximum output level, typically set 1–3 dB below full scale to provide headroom.
- **Attack**: 0.1–1 ms for transient limiting.
- **Release**: 50–200 ms for transparent recovery.

A look-ahead limiter delays the audio signal by 1–5 ms and uses the envelope of the non-delayed signal to compute gain. This allows the limiter to begin gain reduction before the transient arrives, eliminating overshoot. The cost is the additional delay and a buffer to hold the delayed audio.

## Gate / Expander

A gate attenuates signals below a threshold — the inverse of a compressor. An expander is a gate with a gradual ratio rather than an on/off switch.

```c
/* Simple noise gate — Q15 */
q15_t gate_process(q15_t sample, q15_t envelope,
                   q15_t threshold, q15_t attenuation)
{
    if (envelope < threshold) {
        /* Below threshold — attenuate */
        return (q15_t)(((q31_t)sample * attenuation) >> 15);
    }
    return sample;  /* Above threshold — pass through */
}
```

Hysteresis prevents rapid switching when the signal hovers near the threshold — the gate opens at threshold + 3 dB and closes at threshold - 3 dB (or similar). Without hysteresis, background noise near the threshold causes the gate to chatter, producing a stuttering artifact.

## Tips

- Apply dynamics processing after filtering and before final output. Compressing a signal that contains DC offset or low-frequency rumble causes the compressor to respond to the unwanted content, modulating the desired audio.
- For voice applications, an attack time of 5–10 ms and release time of 100–300 ms with a 3:1 ratio provides natural-sounding level control without audible pumping.
- Test with both quiet speech and loud transients (hand claps, door slams). A compressor that sounds good on steady speech may distort on transients if the attack is too slow for the limiter to catch peaks.

## Caveats

- Very fast attack times (<0.5 ms) on a compressor cause intermodulation distortion on low-frequency signals. The envelope detector tracks individual cycles of a 100 Hz waveform (10 ms period), modulating the gain within a single cycle. This produces harmonics that are not present in the original signal.
- Fixed-point division (needed for gain computation) is slow on Cortex-M0/M3 (no hardware divide) and should be replaced with reciprocal multiplication using a lookup table or Newton-Raphson iteration.
- A compressor followed by a make-up gain stage can amplify the noise floor. If the input has a noise floor at -60 dBFS and the compressor applies 20 dB of compression, the make-up gain raises the noise floor to -40 dBFS.

## In Practice

- **Audio level pumps audibly on percussive material** — the release time is too fast, causing the compressor to recover quickly between hits and amplify the ambient noise between transients. Increasing release time to 200–500 ms smooths the effect.
- **Compressor seems to have no effect on loud signals** — the threshold may be set above the actual signal level, or the envelope detector is not tracking the signal correctly. Monitoring the envelope value (via debug output or a DAC pin) confirms whether the detector is responding.
- **Noise gate chatters on/off during quiet passages** — the signal level is hovering near the threshold. Adding hysteresis (different open and close thresholds) or a hold time (minimum time the gate stays open after triggering) eliminates the chatter.
