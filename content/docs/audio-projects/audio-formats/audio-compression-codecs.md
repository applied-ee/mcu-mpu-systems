---
title: "Audio Compression Codecs"
weight: 20
---

# Audio Compression Codecs

Uncompressed PCM audio consumes storage and bandwidth at a fixed, often inconvenient rate — 176 KB/s for CD-quality stereo, 32 KB/s for 16 kHz mono voice. Audio compression codecs reduce this by 4x to 20x, trading CPU cycles for smaller files and lower bitrates. On an MCU, the choice of codec is constrained by CPU budget, RAM availability, and licensing: decoding MP3 on a Cortex-M4 is practical, but encoding Opus in real time requires careful optimization and typically 80+ KB of RAM. The right codec depends on whether the MCU is encoding (recording), decoding (playback), or both, and on the acceptable quality loss.

## Codec Overview

| Codec | Type | Typical Bitrate | Compression Ratio | Decode CPU | Decode RAM | Encode CPU | License |
|---|---|---|---|---|---|---|---|
| ADPCM (IMA) | Lossy | 32 kbps (16 kHz mono) | 4:1 | Very low | ~1 KB | Very low | Free |
| G.711 (µ-law/A-law) | Lossy | 64 kbps (8 kHz mono) | 2:1 | Negligible | ~0 | Negligible | Free |
| SBC | Lossy | 198–345 kbps | 4:1–8:1 | Low | ~4 KB | Low | Free (BT A2DP) |
| MP3 | Lossy | 32–320 kbps | 4:1–12:1 | Moderate | 20–30 KB | High | Patent-free since 2017 |
| AAC-LC | Lossy | 64–256 kbps | 6:1–12:1 | Moderate | 30–50 KB | High | Licensed |
| Opus | Lossy | 6–510 kbps | 4:1–30:1 | Moderate-high | 30–80 KB | High | Free (BSD) |
| FLAC | Lossless | 400–1000 kbps | 1.5:1–3:1 | Moderate | 40–80 KB | Very high | Free |

## ADPCM (Adaptive Differential PCM)

ADPCM is the simplest practical audio compression — it encodes the difference between consecutive samples using an adaptive step size, packing each 16-bit sample into 4 bits (4:1 compression). The IMA ADPCM variant is the most common in embedded systems.

```c
/* IMA ADPCM decoder — single-channel */
static const int16_t step_table[89] = {
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130,
    143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411,
    1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026,
    4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442,
    11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623,
    27086, 29794, 32767
};

static const int8_t index_table[16] = {
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
};

typedef struct {
    int16_t prev_sample;
    int8_t  step_index;
} adpcm_state_t;

int16_t adpcm_decode_sample(adpcm_state_t *state, uint8_t nibble)
{
    int16_t step = step_table[state->step_index];
    int32_t diff = step >> 3;
    if (nibble & 1) diff += step >> 2;
    if (nibble & 2) diff += step >> 1;
    if (nibble & 4) diff += step;
    if (nibble & 8) diff = -diff;

    int32_t sample = state->prev_sample + diff;
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;

    state->prev_sample = (int16_t)sample;
    state->step_index += index_table[nibble];
    if (state->step_index < 0) state->step_index = 0;
    if (state->step_index > 88) state->step_index = 88;

    return (int16_t)sample;
}
```

ADPCM quality is poor by modern standards (~30 dB SNR) but adequate for voice prompts, game sound effects, and notification sounds. The decoder is small enough to run on any MCU, including 8-bit AVR.

## G.711 (µ-Law / A-Law)

G.711 compresses 16-bit linear PCM to 8 bits using a logarithmic companding curve. µ-law is used in North America and Japan; A-law is used in Europe and most of the world. Compression ratio is 2:1 — minimal, but the logarithmic encoding provides better perceptual quality than linear 8-bit PCM because it allocates more bits to quiet signals.

G.711 is the mandatory codec for telephone networks and VoIP. Encoding and decoding are table lookups — effectively zero CPU cost.

## MP3 Decoding

MP3 decoding on MCUs is well-established. The Helix MP3 decoder (originally from RealNetworks, now open source) is the standard choice for embedded:

- **RAM**: ~20 KB for decoder state + ~8 KB for output buffer
- **CPU**: ~15 MHz equivalent on Cortex-M4 for 128 kbps stereo (approximately 3–5 million cycles per second)
- **Flash**: ~30 KB code size
- **License**: All MP3 patents expired by 2017

```c
/* Helix MP3 decoder — basic usage */
#include "mp3dec.h"

HMP3Decoder decoder = MP3InitDecoder();
MP3FrameInfo frame_info;
int16_t pcm_buffer[2304];  /* Max frame: 1152 samples × 2 channels */

int offset = MP3FindSyncWord(mp3_data, mp3_data_len);
int err = MP3Decode(decoder, &mp3_data, &mp3_data_len, pcm_buffer, 0);
MP3GetLastFrameInfo(decoder, &frame_info);
/* frame_info.outputSamps contains the number of PCM samples decoded */
```

The **minimp3** library by Martin Fiedler is a single-header alternative (~80 KB compiled, ~20 KB RAM) with a simpler API and active maintenance.

## Opus

Opus is the modern open-source codec, excelling at both voice (6–32 kbps, replacing Speex) and music (64–256 kbps, rivaling AAC). It is mandatory in WebRTC and increasingly common in embedded VoIP and streaming applications.

Encoding Opus in real time on a Cortex-M4 at voice quality (16 kHz, 16 kbps) is feasible but tight — approximately 40–60 MHz equivalent CPU. Decoding is lighter (~15–25 MHz). RAM usage is 30–80 KB depending on configuration (narrowband voice vs wideband music).

The **libopus** reference implementation is the standard. Building for embedded requires:
- Disabling floating-point (`FIXED_POINT` define)
- Reducing maximum frame duration to save RAM
- Using the SILK-only mode for voice (lower CPU than CELT/hybrid)

## FLAC (Lossless)

FLAC compresses PCM audio losslessly — the decoded output is bit-identical to the original. Compression ratios are modest (typically 50–60% of original size) but the audio quality is perfect. FLAC decoding on a Cortex-M4 requires approximately 20–40 MHz equivalent CPU and 40–80 KB RAM, depending on the encoding parameters.

The **dr_flac** single-header library is well-suited for embedded FLAC decoding:

```c
#define DR_FLAC_IMPLEMENTATION
#include "dr_flac.h"

drflac *flac = drflac_open_file("music.flac", NULL);
int16_t pcm[4096];
drflac_uint64 frames_read = drflac_read_pcm_frames_s16(flac, 2048, pcm);
```

## Storage vs Bandwidth Trade-Offs

| Scenario | Recommended Codec | Bitrate | 1 Min Storage |
|---|---|---|---|
| Voice prompts in flash | ADPCM | 32 kbps | 240 KB |
| Voice recording to SD | Opus (voice) | 16 kbps | 120 KB |
| Music from SD card | MP3 / FLAC | 128–900 kbps | 1–7 MB |
| Streaming over WiFi | Opus | 64–128 kbps | N/A (streaming) |
| Bluetooth audio (A2DP) | SBC / AAC | 198–256 kbps | N/A (streaming) |
| Max quality, storage OK | FLAC or WAV | 400–1400 kbps | 3–10 MB |

## Tips

- For playback-only applications, pre-encode audio files on a PC using the best available encoder settings. The MCU only needs to decode, which is always cheaper than encoding.
- ADPCM can be decoded on-the-fly from flash at negligible CPU cost — a practical way to store 4x more audio prompts in a fixed flash budget.
- When streaming compressed audio from a network, buffer at least 2–3 compressed frames before starting playback. This absorbs network jitter without adding perceptible latency.

## Caveats

- MP3 encoding on an MCU is impractical for real-time audio — the LAME encoder requires 50–100+ MHz equivalent CPU and 100+ KB RAM. For recording, use ADPCM, Opus (voice mode), or raw PCM and compress offline.
- AAC-LC decoding requires licensing from Via Licensing or Dolby. Open-source decoders exist (FAAD2, FDK-AAC) but commercial products require a license. Opus is the patent-free alternative with comparable or better quality.
- FLAC encoding is computationally expensive — significantly more than decoding. Real-time FLAC encoding on a Cortex-M4 is not practical for stereo 44.1 kHz. Use raw PCM recording with offline FLAC compression.

## In Practice

- **MP3 playback has periodic gaps or stutters** — the decoder is not keeping up with the bitrate. Variable bitrate (VBR) MP3 files can spike to 320 kbps during complex passages, temporarily exceeding the decoder's throughput. Using constant bitrate (CBR) encoding at a lower rate, or increasing the decoder task priority, resolves the stutter.
- **ADPCM audio has a noticeable "bubbling" or warbling quality** — this is the inherent artifact of 4-bit ADPCM, especially on tonal content (music, sustained notes). ADPCM works best on speech and percussive sounds. For music playback, MP3 or Opus provides dramatically better quality.
- **Opus decoder runs out of RAM during initialization** — the default libopus configuration allocates buffers for the maximum supported configuration. Defining `OPUS_CUSTOM_MODES=0` and limiting the maximum frame size reduces RAM usage to 30–40 KB for voice-only applications.
