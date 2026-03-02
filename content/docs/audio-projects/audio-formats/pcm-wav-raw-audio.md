---
title: "PCM, WAV & Raw Audio"
weight: 10
---

# PCM, WAV & Raw Audio

PCM (Pulse Code Modulation) is the standard representation of uncompressed digital audio — a sequence of numeric samples, each representing the instantaneous amplitude of the audio waveform at a regular time interval. Every other audio format either is PCM (WAV, AIFF) or compresses PCM (MP3, Opus, ADPCM). On an MCU, PCM is the native format: I2S peripherals produce and consume PCM, DMA buffers hold PCM, and DSP functions operate on PCM. Understanding PCM encoding conventions — signedness, endianness, bit depth, and channel interleaving — prevents the class of bugs where audio plays but sounds like static, plays at the wrong pitch, or has swapped channels.

## PCM Encoding Conventions

### Signedness

| Format | Range | Zero Point | Common Use |
|---|---|---|---|
| Signed 16-bit | -32768 to +32767 | 0 | I2S, WAV (16-bit), CMSIS-DSP |
| Unsigned 8-bit | 0 to 255 | 128 | WAV (8-bit), some ADC outputs |
| Signed 24-bit (in 32-bit) | -8388608 to +8388607 | 0 | Professional audio, 24-bit I2S |
| Signed 32-bit | -2^31 to +2^31-1 | 0 | Q31 processing |

Signed 16-bit is the most common format in embedded audio. The zero point (silence) is 0 for signed formats and 128 (8-bit) or 32768 (16-bit) for unsigned formats. Misinterpreting signedness produces a loud buzz at the sample rate frequency (the waveform is offset by half its range).

### Endianness

PCM samples larger than 8 bits have a byte order:
- **Little-endian**: LSB first. Standard for WAV files, x86, ARM (default), ESP32.
- **Big-endian**: MSB first. Standard for AIFF files, some network protocols, and some I2S peripherals.

ARM Cortex-M processors operate in little-endian mode by default. I2S peripherals transmit MSB-first on the wire (per the I2S specification), but the DMA buffer in memory is little-endian. The peripheral handles the conversion transparently — the firmware works with little-endian data in memory regardless of the I2S wire format.

### Bit Depth and Dynamic Range

| Bit Depth | Dynamic Range | Noise Floor | Storage per Sample | Use Case |
|---|---|---|---|---|
| 8-bit | 48 dB | -48 dBFS | 1 byte | Telephone, retro sound effects |
| 16-bit | 96 dB | -96 dBFS | 2 bytes | CD quality, general embedded audio |
| 24-bit | 144 dB | -144 dBFS | 3 bytes (or 4 padded) | Professional recording |
| 32-bit float | ~1528 dB | — | 4 bytes | DAW internal processing |

16-bit is the standard for embedded audio — it matches I2S hardware, fits naturally in Q15 fixed-point, and provides sufficient dynamic range for all but professional recording applications.

### Channel Interleaving

Multi-channel PCM data is stored with channels interleaved sample-by-sample:

```
Stereo (L/R): [L0][R0][L1][R1][L2][R2]...
4-channel:    [Ch0][Ch1][Ch2][Ch3][Ch0][Ch1][Ch2][Ch3]...
```

Each sample group (one sample per channel) is called a **frame**. The frame rate equals the sample rate. A stereo 16-bit frame is 4 bytes; at 44.1 kHz, the data rate is 176,400 bytes/second.

## WAV File Format

WAV is the standard container for PCM audio on embedded systems — it is simple to parse, widely supported, and adds only 44 bytes of overhead to raw PCM data. The format uses the RIFF (Resource Interchange File Format) container with a "WAVE" type identifier.

### WAV Header Structure (44 bytes for standard PCM)

```c
typedef struct __attribute__((packed)) {
    /* RIFF chunk */
    char     riff_id[4];       /* "RIFF" */
    uint32_t file_size;        /* File size - 8 (total file size minus RIFF header) */
    char     wave_id[4];       /* "WAVE" */

    /* fmt sub-chunk */
    char     fmt_id[4];        /* "fmt " (note trailing space) */
    uint32_t fmt_size;         /* 16 for PCM */
    uint16_t audio_format;     /* 1 = PCM, 3 = IEEE float */
    uint16_t num_channels;     /* 1 = mono, 2 = stereo */
    uint32_t sample_rate;      /* e.g., 44100, 48000 */
    uint32_t byte_rate;        /* sample_rate × num_channels × bits_per_sample / 8 */
    uint16_t block_align;      /* num_channels × bits_per_sample / 8 */
    uint16_t bits_per_sample;  /* 8, 16, 24, or 32 */

    /* data sub-chunk */
    char     data_id[4];       /* "data" */
    uint32_t data_size;        /* Number of bytes of PCM data */
} wav_header_t;
```

### Creating a WAV Header

```c
wav_header_t create_wav_header(uint32_t sample_rate, uint16_t channels,
                                uint16_t bits, uint32_t data_bytes)
{
    wav_header_t h = {
        .riff_id        = {'R','I','F','F'},
        .file_size      = data_bytes + 36,
        .wave_id        = {'W','A','V','E'},
        .fmt_id         = {'f','m','t',' '},
        .fmt_size       = 16,
        .audio_format   = 1,  /* PCM */
        .num_channels   = channels,
        .sample_rate    = sample_rate,
        .byte_rate      = sample_rate * channels * bits / 8,
        .block_align    = channels * bits / 8,
        .bits_per_sample = bits,
        .data_id        = {'d','a','t','a'},
        .data_size      = data_bytes,
    };
    return h;
}
```

### Parsing a WAV File

```c
/* Minimal WAV parser — reads header and returns pointer to PCM data */
bool parse_wav(const uint8_t *file_data, size_t file_size,
               wav_header_t *header, const int16_t **pcm_data)
{
    if (file_size < sizeof(wav_header_t)) return false;

    memcpy(header, file_data, sizeof(wav_header_t));

    if (memcmp(header->riff_id, "RIFF", 4) != 0) return false;
    if (memcmp(header->wave_id, "WAVE", 4) != 0) return false;
    if (header->audio_format != 1) return false;  /* Only PCM */

    *pcm_data = (const int16_t *)(file_data + sizeof(wav_header_t));
    return true;
}
```

## SD Card Streaming

For audio files too large to fit in flash or RAM, streaming from an SD card (via SPI or SDIO) is the standard approach. The challenge is maintaining continuous data flow — an SD card read stall of even 10 ms causes an audible dropout at 48 kHz.

### Double-Buffer Streaming Pattern

```c
#define STREAM_BUF_SIZE  4096  /* Bytes per buffer half */

static int16_t stream_buf[STREAM_BUF_SIZE / sizeof(int16_t) * 2];
static FIL wav_file;
static volatile bool buf_half_ready = false;

/* Called from DMA/timer ISR when first half consumed */
void audio_buffer_half_callback(void)
{
    buf_half_ready = true;  /* Signal streaming task */
}

/* RTOS task — reads next block from SD card */
void sd_streaming_task(void *param)
{
    UINT bytes_read;
    for (;;) {
        while (!buf_half_ready) vTaskDelay(1);
        buf_half_ready = false;

        f_read(&wav_file, &stream_buf[0], STREAM_BUF_SIZE, &bytes_read);
        if (bytes_read < STREAM_BUF_SIZE) {
            /* End of file — loop or stop */
            f_lseek(&wav_file, sizeof(wav_header_t));  /* Loop to start */
        }
    }
}
```

### File Size Estimation

| Sample Rate | Channels | Bits | Duration | File Size |
|---|---|---|---|---|
| 8 kHz | 1 (mono) | 16 | 1 min | 960 KB |
| 16 kHz | 1 (mono) | 16 | 1 min | 1.88 MB |
| 44.1 kHz | 2 (stereo) | 16 | 1 min | 10.6 MB |
| 48 kHz | 2 (stereo) | 16 | 1 min | 11.5 MB |
| 48 kHz | 2 (stereo) | 24 | 1 min | 17.3 MB |

Formula: `size (bytes) = sample_rate × channels × (bits / 8) × duration_seconds`

## Storing Audio in Flash

For short audio clips (alerts, prompts, sound effects), storing PCM data directly in flash avoids the complexity of SD card filesystem access:

```c
/* Audio clip stored in flash as a const array */
const int16_t alert_sound[] = {
    #include "alert_48k_mono.h"  /* Generated from WAV with a conversion script */
};
const size_t alert_sound_samples = sizeof(alert_sound) / sizeof(int16_t);
```

The conversion from WAV to C header is typically done with a script:

```python
# Convert WAV to C header
import wave, struct
with wave.open('alert.wav', 'rb') as w:
    frames = w.readframes(w.getnframes())
    samples = struct.unpack(f'<{w.getnframes()}h', frames)
    with open('alert_48k_mono.h', 'w') as f:
        for i, s in enumerate(samples):
            f.write(f'{s},')
            if (i + 1) % 16 == 0: f.write('\n')
```

## Tips

- When recording WAV files on an MCU, write the header with a placeholder `data_size` of 0xFFFFFFFF. After recording completes, seek back to offset 40 and write the actual data size. This handles unexpected power loss gracefully — most players will read to end-of-file if the size is 0xFFFFFFFF.
- Use 16-bit PCM for all embedded audio unless there is a specific reason for 24-bit. The additional 8 bits require 50% more storage and bandwidth, and the dynamic range improvement is irrelevant if the DAC is 12-bit.
- For SD card streaming, pre-read the first buffer before starting playback. Starting the DMA/I2S output and the SD card read simultaneously causes an underrun on the first buffer.

## Caveats

- WAV files may contain extra chunks (LIST, INFO, metadata) between the fmt and data chunks. A parser that assumes the data chunk starts at byte 44 will fail on these files. A robust parser scans for the "data" chunk ID by iterating through chunks using each chunk's size field.
- 24-bit WAV samples are packed as 3 bytes per sample (no padding). Reading them into 32-bit integers requires explicit unpacking with sign extension — a direct `memcpy` into an `int32_t` array produces garbled audio because the alignment is wrong.
- SD card write latency is non-deterministic — occasionally, a write takes 50–200 ms due to internal wear-leveling or block erasure. For recording applications, a triple-buffer strategy (or larger buffer) absorbs these spikes without losing audio data.

## In Practice

- **WAV file plays as loud static or noise** — the PCM format does not match the playback assumption. Common causes: playing unsigned 8-bit data through a signed 16-bit pipeline, wrong endianness, or the parser is reading from the wrong offset (skipping into the middle of the data or including header bytes as audio).
- **Audio plays at the wrong pitch (too fast or too slow)** — the playback sample rate does not match the file's sample rate. A 22,050 Hz file played at 44,100 Hz sounds one octave too high and plays in half the expected time.
- **Stereo audio has channels swapped or one channel is a mix of both** — the channel interleaving does not match the playback expectation. If the player expects L-R-L-R but the data is R-L-R-L, channels are swapped. If the player reads mono but the data is stereo, every other sample is from the wrong channel, producing garbled output.
