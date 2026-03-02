---
title: "Audio Effects & Mixing"
weight: 50
---

# Audio Effects & Mixing

Time-domain audio effects — delay, echo, reverb, chorus — all depend on storing audio samples and playing them back later, mixed with the current input. The fundamental data structure is the circular buffer (ring buffer), and the primary constraint is memory: a one-second delay at 48 kHz / 16-bit mono requires 96 KB of RAM. On Cortex-M4 devices with 128–256 KB of SRAM, this leaves little room for anything else. ESP32 and ESP32-S3 with external PSRAM (2–8 MB) open up long delays and reverb networks that are impractical on SRAM-only MCUs.

## Circular Buffer

The circular buffer stores N samples in a fixed-size array with a write pointer that wraps around to the beginning when it reaches the end. Reading from an offset behind the write pointer retrieves a delayed version of the signal.

```c
typedef struct {
    int16_t *buffer;
    uint32_t size;      /* Buffer length in samples */
    uint32_t write_idx; /* Current write position */
} delay_line_t;

void delay_write(delay_line_t *dl, int16_t sample)
{
    dl->buffer[dl->write_idx] = sample;
    dl->write_idx++;
    if (dl->write_idx >= dl->size) dl->write_idx = 0;
}

int16_t delay_read(delay_line_t *dl, uint32_t delay_samples)
{
    uint32_t read_idx = dl->write_idx >= delay_samples
                        ? dl->write_idx - delay_samples
                        : dl->size - (delay_samples - dl->write_idx);
    return dl->buffer[read_idx];
}
```

For power-of-two buffer sizes, the modulo operation can be replaced with a bitmask (`write_idx & (size - 1)`), which avoids the expensive division on Cortex-M0 that does not have a hardware divider.

## Delay and Echo

A simple delay effect adds a time-delayed copy of the input to the current output:

```
output[n] = input[n] + feedback × delayed[n - delay_samples]
```

```c
/* Simple feedback delay */
int16_t delay_process(delay_line_t *dl, int16_t input,
                      uint32_t delay_samples, q15_t feedback)
{
    int16_t delayed = delay_read(dl, delay_samples);
    int32_t output = (int32_t)input + (((int32_t)delayed * feedback) >> 15);

    /* Saturate to prevent runaway feedback */
    if (output > 32767) output = 32767;
    if (output < -32768) output = -32768;

    delay_write(dl, (int16_t)output);  /* Write output for feedback */
    return (int16_t)output;
}
```

| Effect | Delay Time | Feedback | Sound |
|---|---|---|---|
| Slapback | 50–150 ms | 0 (single repeat) | Rockabilly vocal doubling |
| Echo | 200–500 ms | 0.3–0.6 | Distinct repeats, fading |
| Infinite echo | Any | ~0.99 | Repeats do not decay (builds up) |
| Comb filter | <20 ms | 0.5–0.9 | Metallic, resonant coloring |

The delay time determines the memory requirement: 500 ms at 48 kHz = 24,000 samples = 48 KB (16-bit mono).

## Reverb

Reverb simulates the acoustic reflections of a room. The Schroeder reverb model — the standard approach for resource-constrained systems — uses a parallel bank of comb filters feeding a series of allpass filters:

```
Input → [Comb 1] ─┐
      → [Comb 2] ─┤
      → [Comb 3] ─┼──→ [Allpass 1] → [Allpass 2] → Output
      → [Comb 4] ─┘
```

### Comb Filter

A feedback comb filter creates a series of evenly spaced echoes:

```c
int16_t comb_process(delay_line_t *dl, int16_t input,
                     uint32_t delay, q15_t feedback)
{
    int16_t delayed = delay_read(dl, delay);
    int32_t output = (int32_t)input + (((int32_t)delayed * feedback) >> 15);
    output = __SSAT(output, 16);
    delay_write(dl, (int16_t)output);
    return (int16_t)output;
}
```

### Allpass Filter

An allpass filter passes all frequencies at equal magnitude but disperses them in time, adding diffusion to the reverb:

```c
int16_t allpass_process(delay_line_t *dl, int16_t input,
                        uint32_t delay, q15_t gain)
{
    int16_t delayed = delay_read(dl, delay);
    int32_t output = (int32_t)(-input)
                   + (int32_t)delayed
                   + (((int32_t)input * gain) >> 15);
    output = __SSAT(output, 16);
    int32_t write_val = (int32_t)input + (((int32_t)delayed * gain) >> 15);
    delay_write(dl, (int16_t)__SSAT(write_val, 16));
    return (int16_t)output;
}
```

### Schroeder Reverb Parameters

A basic Schroeder reverb with four comb filters and two allpass filters:

| Element | Delay (ms) | Delay (samples at 48 kHz) | Feedback/Gain | RAM (16-bit) |
|---|---|---|---|---|
| Comb 1 | 29.7 | 1426 | 0.805 | 2,852 B |
| Comb 2 | 37.1 | 1781 | 0.827 | 3,562 B |
| Comb 3 | 41.1 | 1973 | 0.783 | 3,946 B |
| Comb 4 | 43.7 | 2098 | 0.764 | 4,196 B |
| Allpass 1 | 5.0 | 240 | 0.7 | 480 B |
| Allpass 2 | 1.7 | 82 | 0.7 | 164 B |
| **Total** | | | | **~15 KB** |

The delay times should be mutually prime (no common factors) to avoid reinforcing specific frequencies. The feedback coefficients control the reverb decay time — higher feedback = longer reverb tail.

## Using PSRAM for Long Delays

ESP32 and ESP32-S3 with external PSRAM (accessed via SPI or OPI) provide 2–8 MB of additional memory, sufficient for long reverb tails, multi-second delays, and looper effects. The access latency is higher than SRAM (~80 ns for PSRAM vs ~10 ns for SRAM), but for audio buffer access patterns (sequential reads and writes), the latency is amortized by burst-mode transfers.

```c
/* ESP32 — allocate delay line in PSRAM */
delay_line_t reverb_comb;
reverb_comb.size = 96000;  /* 2 seconds at 48 kHz */
reverb_comb.buffer = (int16_t *)heap_caps_malloc(
    reverb_comb.size * sizeof(int16_t), MALLOC_CAP_SPIRAM);
reverb_comb.write_idx = 0;
memset(reverb_comb.buffer, 0, reverb_comb.size * sizeof(int16_t));
```

On ESP32-S3 with OPI PSRAM, sequential access is fast enough for real-time audio at 48 kHz. On the original ESP32 with SPI PSRAM, access is slower and may require DMA-assisted buffer management for high channel counts.

## Chorus

Chorus creates the perception of multiple voices by mixing the dry signal with a copy delayed by 10–30 ms, where the delay time is slowly modulated by an LFO (low-frequency oscillator):

```c
/* Simple chorus effect */
typedef struct {
    delay_line_t delay;
    float lfo_phase;       /* 0.0 to 1.0 */
    float lfo_rate_hz;     /* Typically 0.5–3 Hz */
    float depth_samples;   /* Modulation depth in samples (e.g., 200) */
    float center_delay;    /* Base delay in samples (e.g., 1000 = ~21 ms) */
    float sample_rate;
} chorus_t;

int16_t chorus_process(chorus_t *ch, int16_t input)
{
    /* LFO generates sinusoidal delay modulation */
    float lfo = sinf(2.0f * M_PI * ch->lfo_phase);
    ch->lfo_phase += ch->lfo_rate_hz / ch->sample_rate;
    if (ch->lfo_phase >= 1.0f) ch->lfo_phase -= 1.0f;

    float delay = ch->center_delay + lfo * ch->depth_samples;
    uint32_t delay_int = (uint32_t)delay;
    float frac = delay - delay_int;

    /* Linear interpolation for fractional delay */
    int16_t s0 = delay_read(&ch->delay, delay_int);
    int16_t s1 = delay_read(&ch->delay, delay_int + 1);
    int16_t delayed = (int16_t)((1.0f - frac) * s0 + frac * s1);

    delay_write(&ch->delay, input);

    /* Mix dry and wet */
    int32_t output = (int32_t)input + (int32_t)delayed;
    return (int16_t)__SSAT(output >> 1, 16);  /* Divide by 2 to prevent clipping */
}
```

The fractional delay (interpolation between adjacent samples) is essential for smooth LFO modulation — without it, the delay jumps in whole-sample steps, producing audible zipper noise.

## Stereo Panning and Mixing

Stereo panning distributes a mono source between left and right channels. The constant-power pan law maintains perceived loudness across the stereo field:

```c
/* Constant-power panning — pan ranges from 0.0 (full left) to 1.0 (full right) */
/* Pre-computed as Q15 lookup table, 128 entries */
typedef struct {
    q15_t left_gain;
    q15_t right_gain;
} pan_gains_t;

static pan_gains_t pan_table[128];

void init_pan_table(void)
{
    for (int i = 0; i < 128; i++) {
        float pan = (float)i / 127.0f;  /* 0.0 to 1.0 */
        float angle = pan * M_PI / 2.0f;
        pan_table[i].left_gain  = (q15_t)(cosf(angle) * 32767.0f);
        pan_table[i].right_gain = (q15_t)(sinf(angle) * 32767.0f);
    }
}

void apply_pan(int16_t mono_in, int16_t *left_out, int16_t *right_out,
               uint8_t pan_index)
{
    *left_out  = (int16_t)(((int32_t)mono_in * pan_table[pan_index].left_gain) >> 15);
    *right_out = (int16_t)(((int32_t)mono_in * pan_table[pan_index].right_gain) >> 15);
}
```

## Tips

- Choose delay line lengths that are mutually prime for reverb comb filters — this prevents resonances at common multiples and produces a smoother decay.
- For memory-constrained reverb, reduce the sample rate of the reverb processor to 16 kHz or 24 kHz. Reverb operates primarily on low-to-mid frequencies, and the reduced rate cuts memory by 2–3x with minimal audible impact.
- Pre-compute LFO waveforms as lookup tables (256 or 1024 entries) for chorus and modulation effects — `sinf()` calls per sample are expensive on MCUs without FPU.

## Caveats

- Feedback values at or above 1.0 cause the delay/reverb to grow without bound, eventually saturating and producing harsh distortion. Even values very close to 1.0 (e.g., 0.99) can build up over several seconds. Always clamp feedback below 1.0 in the user-facing parameter range.
- PSRAM on ESP32 is not accessible from ISR context (it requires the SPI bus, which may be in use or require an RTOS mutex). Audio effects using PSRAM buffers should run from an RTOS task, not from a DMA interrupt callback.
- Reverb on a mono source played back in mono collapses to a comb-filtered version of the original — the characteristic spaciousness of reverb only appears in stereo playback. A stereo reverb algorithm (or at least stereo output with decorrelated delay times for L and R) is needed for the effect to sound correct.

## In Practice

- **Reverb sounds metallic or ringing** — the comb filter delay times have a common factor, producing reinforced resonances at harmonic intervals. Adjusting delay times to be mutually prime eliminates the ringing.
- **Chorus effect has audible stepping or zipper noise** — the delay modulation is changing in whole-sample steps. Adding linear or cubic interpolation between samples in the delay line read function produces smooth modulation.
- **Long delay effect clips or distorts after several repeats** — feedback gain combined with input level exceeds full scale. Reducing feedback from 0.8 to 0.6, or inserting a soft limiter inside the feedback path, prevents accumulation.
- **Reverb tail has an audible noise floor** — Q15 quantization noise accumulates through the feedback paths of comb and allpass filters. For long reverb tails (>2 seconds), processing in Q31 or float (if available) produces a cleaner decay.
