---
title: "PDM & I2S Audio Interfaces"
weight: 20
---

# PDM & I2S Audio Interfaces

Streaming audio data from a digital microphone to an MCU requires a well-defined serial protocol. Two dominate embedded audio: PDM (Pulse Density Modulation), which carries a 1-bit sigma-delta bitstream at megahertz clock rates, and I2S (Inter-IC Sound), which carries multi-bit PCM samples in a synchronous frame format. The choice between them affects peripheral selection, CPU load, memory bandwidth, and firmware complexity. PDM is simpler in hardware (two wires) but requires decimation filtering that consumes either a dedicated hardware peripheral or significant CPU cycles. I2S delivers ready-to-use PCM samples but requires three signal lines and a more complex peripheral configuration.

## PDM Protocol

### Signal Lines

PDM uses exactly two signals:

| Signal | Direction | Description |
|---|---|---|
| CLK | MCU to microphone | Clock signal, typically 1.024-3.072 MHz |
| DAT | Microphone to MCU | 1-bit data output, synchronized to CLK |

The microphone samples its internal sigma-delta modulator on each clock edge and drives the DAT line high or low. The density of high bits over any given window is proportional to the instantaneous audio amplitude — hence "pulse density modulation."

### Stereo on a Single Data Line

Two PDM microphones share one CLK and one DAT line. Channel selection is set by a hardware pin (typically labeled SEL or L/R) on each microphone:

- **Left channel microphone** (SEL tied low): outputs data on the **falling** edge of CLK
- **Right channel microphone** (SEL tied high): outputs data on the **rising** edge of CLK

The MCU peripheral captures both edges and de-interleaves the two channels. This means the effective per-channel data rate is half the clock frequency. With a 3.072 MHz clock, each channel receives 1.536 Mbit/s of PDM data.

### Clock Rate and Output Sample Rate

The PDM clock frequency and decimation ratio together determine the final PCM sample rate:

| PDM Clock (MHz) | Decimation Ratio | PCM Sample Rate (kHz) | Typical Use |
|---|---|---|---|
| 1.024 | 64 | 16 | Voice capture, keyword detection |
| 1.536 | 64 | 24 | Wideband voice |
| 2.048 | 64 | 32 | Enhanced voice quality |
| 3.072 | 64 | 48 | Music-quality audio |
| 2.048 | 128 | 16 | Higher oversampling, better SNR |
| 3.072 | 128 | 24 | High-quality voice |

Higher oversampling ratios (128x vs 64x) improve noise shaping performance at the cost of more computation in the decimation filter.

## PDM-to-PCM Decimation

The raw PDM bitstream cannot be used directly for audio processing. Conversion to PCM requires a decimation filter — a multi-stage digital filter that low-pass filters the bitstream and downsamples it to the target sample rate.

### CIC Filter (Cascaded Integrator-Comb)

The workhorse of PDM decimation is the CIC filter, specifically a sinc³ (third-order) variant. A CIC filter requires no multiplications — only additions and subtractions — making it efficient for hardware implementation and suitable for resource-constrained MCUs.

A sinc³ CIC filter with decimation ratio R consists of three integrator stages operating at the PDM clock rate, a rate reduction by factor R, and three comb stages operating at the output rate. The frequency response has nulls at multiples of the output sample rate, which suppresses the shaped quantization noise from the sigma-delta modulator.

The passband of a sinc³ filter is not flat — it droops by approximately 3.4 dB at the Nyquist frequency of the output rate. A compensation FIR filter (typically 16-32 taps) applied after the CIC stage corrects this droop and provides a sharper transition band.

### Hardware Decimation: STM32 DFSDM

STM32 families with a DFSDM (Digital Filter for Sigma-Delta Modulators) peripheral handle PDM decimation in hardware. The DFSDM includes:

- A serial input that accepts the PDM bitstream directly
- A configurable sinc filter (sinc1 through sinc5, with selectable order and decimation ratio)
- DMA output of filtered PCM samples to memory

```c
/* STM32 HAL — DFSDM channel and filter configuration for MP34DT05 PDM mic */
#include "stm32l4xx_hal.h"

DFSDM_Channel_HandleTypeDef hdfsdm_ch;
DFSDM_Filter_HandleTypeDef  hdfsdm_flt;

static int32_t pcm_buffer[PCM_BUFFER_SIZE];

void dfsdm_pdm_init(void)
{
    /* Channel configuration — PDM input on DATIN0 */
    hdfsdm_ch.Instance                      = DFSDM1_Channel0;
    hdfsdm_ch.Init.OutputClock.Activation    = ENABLE;
    hdfsdm_ch.Init.OutputClock.Selection     = DFSDM_CHANNEL_OUTPUT_CLOCK_SYSTEM;
    hdfsdm_ch.Init.OutputClock.Divider       = 24;  /* 80 MHz / 24 = 3.33 MHz PDM clock */
    hdfsdm_ch.Init.Input.Multiplexer         = DFSDM_CHANNEL_EXTERNAL_INPUTS;
    hdfsdm_ch.Init.Input.DataPacking         = DFSDM_CHANNEL_STANDARD_MODE;
    hdfsdm_ch.Init.Input.Pins                = DFSDM_CHANNEL_SAME_CHANNEL_PINS;
    hdfsdm_ch.Init.SerialInterface.Type      = DFSDM_CHANNEL_SPI_RISING;
    hdfsdm_ch.Init.SerialInterface.SpiClock  = DFSDM_CHANNEL_SPI_CLOCK_INTERNAL;
    hdfsdm_ch.Init.Awd.FilterOrder           = DFSDM_CHANNEL_SINC1_ORDER;
    hdfsdm_ch.Init.Awd.Oversampling          = 1;
    hdfsdm_ch.Init.Offset                    = 0;
    hdfsdm_ch.Init.RightBitShift             = 2;
    HAL_DFSDM_ChannelInit(&hdfsdm_ch);

    /* Filter configuration — sinc3, decimation 64 */
    hdfsdm_flt.Instance                     = DFSDM1_Filter0;
    hdfsdm_flt.Init.RegularParam.Trigger    = DFSDM_FILTER_SW_TRIGGER;
    hdfsdm_flt.Init.RegularParam.FastMode   = ENABLE;
    hdfsdm_flt.Init.RegularParam.DmaMode    = ENABLE;
    hdfsdm_flt.Init.FilterParam.SincOrder   = DFSDM_FILTER_SINC3_ORDER;
    hdfsdm_flt.Init.FilterParam.Oversampling = 64;
    hdfsdm_flt.Init.FilterParam.IntOversampling = 1;
    HAL_DFSDM_FilterInit(&hdfsdm_flt);

    /* Associate channel with filter */
    HAL_DFSDM_FilterConfigRegChannel(&hdfsdm_flt,
        DFSDM_CHANNEL_0, DFSDM_CONTINUOUS_CONV_ON);
}

void dfsdm_start_capture(void)
{
    /* Start DMA-driven continuous conversion */
    HAL_DFSDM_FilterRegularStart_DMA(&hdfsdm_flt,
        pcm_buffer, PCM_BUFFER_SIZE);
}

/* DMA half-complete and complete callbacks for double-buffering */
void HAL_DFSDM_FilterRegConvHalfCpltCallback(
    DFSDM_Filter_HandleTypeDef *hdfsdm_filter)
{
    /* Process first half of pcm_buffer */
}

void HAL_DFSDM_FilterRegConvCpltCallback(
    DFSDM_Filter_HandleTypeDef *hdfsdm_filter)
{
    /* Process second half of pcm_buffer */
}
```

## I2S Protocol

### Signal Lines

I2S (Inter-IC Sound, also written I²S) uses three signals for basic operation:

| Signal | Alias | Direction | Description |
|---|---|---|---|
| SCK | BCLK | MCU generates | Serial clock / bit clock |
| WS | LRCLK | MCU generates | Word select — low = left channel, high = right channel |
| SD | DOUT/DIN | Data source to sink | Serial data, MSB first |

An optional fourth signal, MCLK (master clock), runs at 256x or 384x the sample rate and provides a reference for audio codec PLLs. MEMS microphones typically do not require MCLK — they derive their internal timing from BCLK.

### Timing and Frame Format

The I2S Philips standard defines the following timing:

1. WS transitions one BCLK cycle **before** the first bit of each channel's data
2. Data is transmitted MSB first
3. Each channel occupies one half of the WS period (left when WS is low, right when WS is high)
4. Data bits are valid on the **rising** edge of BCLK (for standard Philips mode)

The bit clock frequency is: `BCLK = sample_rate × bits_per_slot × 2` (the factor of 2 accounts for left and right channels).

| Sample Rate | Bit Depth | BCLK Frequency |
|---|---|---|
| 8 kHz | 16-bit | 256 kHz |
| 16 kHz | 16-bit | 512 kHz |
| 16 kHz | 32-bit | 1.024 MHz |
| 44.1 kHz | 16-bit | 1.411 MHz |
| 48 kHz | 16-bit | 1.536 MHz |
| 48 kHz | 32-bit | 3.072 MHz |

### I2S Modes

Several variants of the I2S frame format exist:

| Mode | WS Transition | Data Alignment | Common Use |
|---|---|---|---|
| Philips (standard) | 1 BCLK before MSB | Left-justified in slot | Most MEMS microphones, codec defaults |
| Left-justified (MSB) | Aligned with MSB | Left-justified, WS high = left | Japanese audio ICs, some older codecs |
| Right-justified (LSB) | N/A — data at end of slot | Right-justified in slot | Rare, legacy DACs |
| TDM | Multiple slots per frame | Slot-addressed | Multi-channel audio, codec arrays |

Most I2S MEMS microphones use Philips standard. Configuring the MCU peripheral for the wrong mode produces garbled audio — the bits are read at incorrect positions within the frame, resulting in either very quiet output (bits shifted down) or clipped/distorted output (bits shifted up).

## I2S Configuration on STM32 (SAI Peripheral)

STM32F4 and later families provide the SAI (Serial Audio Interface) peripheral, which is more flexible than the basic SPI/I2S peripheral. The SAI supports I2S Philips, left-justified, right-justified, TDM, and PDM modes.

```c
/* STM32 HAL — SAI configured as I2S master receiver, 16 kHz, 16-bit */
#include "stm32f4xx_hal.h"

SAI_HandleTypeDef hsai;
static int16_t audio_dma_buf[DMA_BUF_SIZE];

void sai_i2s_init(void)
{
    hsai.Instance = SAI1_Block_A;

    hsai.Init.AudioMode      = SAI_MODEMASTER_RX;
    hsai.Init.Synchro        = SAI_ASYNCHRONOUS;
    hsai.Init.OutputDrive    = SAI_OUTPUTDRIVE_DISABLE;
    hsai.Init.NoDivider      = SAI_MASTERDIVIDER_ENABLE;
    hsai.Init.FIFOThreshold  = SAI_FIFOTHRESHOLD_1QF;
    hsai.Init.AudioFrequency = SAI_AUDIO_FREQUENCY_16K;
    hsai.Init.SynchroExt     = SAI_SYNCEXT_DISABLE;
    hsai.Init.MonoStereoMode = SAI_STEREOMODE;
    hsai.Init.CompandingMode = SAI_NOCOMPANDING;

    /* Frame configuration — Philips I2S */
    hsai.FrameInit.FrameLength       = 32;  /* 16 bits per channel x 2 */
    hsai.FrameInit.ActiveFrameLength = 16;
    hsai.FrameInit.FSDefinition      = SAI_FS_CHANNEL_IDENTIFICATION;
    hsai.FrameInit.FSPolarity        = SAI_FS_ACTIVE_LOW;
    hsai.FrameInit.FSOffset          = SAI_FS_BEFOREFIRSTBIT;

    /* Slot configuration */
    hsai.SlotInit.FirstBitOffset = 0;
    hsai.SlotInit.SlotSize       = SAI_SLOTSIZE_16B;
    hsai.SlotInit.SlotNumber     = 2;
    hsai.SlotInit.SlotActive     = SAI_SLOTACTIVE_0 | SAI_SLOTACTIVE_1;

    HAL_SAI_Init(&hsai);
}

void sai_start_dma_capture(void)
{
    HAL_SAI_Receive_DMA(&hsai, (uint8_t *)audio_dma_buf, DMA_BUF_SIZE);
}

void HAL_SAI_RxHalfCpltCallback(SAI_HandleTypeDef *hsai_ptr)
{
    /* Process first half of audio_dma_buf */
}

void HAL_SAI_RxCpltCallback(SAI_HandleTypeDef *hsai_ptr)
{
    /* Process second half of audio_dma_buf */
}
```

## I2S Configuration on ESP32 (ESP-IDF)

The ESP32's I2S peripheral supports both standard I2S and PDM modes. The newer ESP-IDF v5.x driver uses a channel-based API:

```c
#include "driver/i2s_std.h"

#define SAMPLE_RATE    48000
#define DMA_BUF_LEN    512

static i2s_chan_handle_t rx_chan = NULL;

void esp32_i2s_init(void)
{
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(
        I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num  = 6;
    chan_cfg.dma_frame_num = DMA_BUF_LEN;

    i2s_new_channel(&chan_cfg, NULL, &rx_chan);

    i2s_std_config_t std_cfg = {
        .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = GPIO_NUM_26,
            .ws   = GPIO_NUM_25,
            .dout = I2S_GPIO_UNUSED,
            .din  = GPIO_NUM_34,
            .invert_flags = { false, false, false },
        },
    };

    i2s_channel_init_std_mode(rx_chan, &std_cfg);
    i2s_channel_enable(rx_chan);
}
```

## DMA Double-Buffer for Continuous Audio Streaming

Audio streaming requires uninterrupted data flow. A single DMA buffer causes gaps — while the CPU processes a filled buffer, no DMA target is available, and incoming samples are lost. The standard solution is a **double-buffer** (also called ping-pong buffer) scheme:

1. DMA fills buffer A while the CPU processes buffer B
2. When buffer A is full, DMA switches to buffer B and signals the CPU (half-complete interrupt)
3. The CPU processes buffer A while DMA fills buffer B
4. The cycle repeats indefinitely

Both the STM32 HAL and ESP-IDF I2S drivers support this natively. The STM32 HAL uses a single large buffer with half-complete and complete callbacks — the first half is one "ping" buffer and the second half is the "pong" buffer. The ESP-IDF driver manages multiple DMA descriptors internally.

The critical constraint is that processing must complete within one buffer period. For a 512-sample buffer at 16 kHz, the buffer period is 32 ms. Any processing that takes longer causes the DMA to overwrite data before it is consumed, producing audio glitches (clicks, pops, or gaps).

| Buffer Size (samples) | Sample Rate | Buffer Period | Latency |
|---|---|---|---|
| 128 | 16 kHz | 8 ms | 16 ms (double-buffered) |
| 256 | 16 kHz | 16 ms | 32 ms |
| 512 | 48 kHz | 10.7 ms | 21.3 ms |
| 1024 | 48 kHz | 21.3 ms | 42.7 ms |

Smaller buffers reduce latency but increase the interrupt rate and leave less time for processing per buffer. Larger buffers provide more processing headroom but add latency — relevant for real-time applications like voice effects or echo cancellation.

## Sample Rates and Bit Depth

### Common Sample Rates

| Sample Rate | Bandwidth | Typical Application |
|---|---|---|
| 8 kHz | 4 kHz | Telephone-quality voice, wake-word detection |
| 16 kHz | 8 kHz | Wideband voice, speech recognition |
| 22.05 kHz | 11 kHz | AM radio quality |
| 44.1 kHz | 22.05 kHz | CD audio, music playback |
| 48 kHz | 24 kHz | Professional audio, video soundtracks |

For embedded voice applications (keyword spotting, voice command), 16 kHz is the standard — it captures the full speech bandwidth (300 Hz to 8 kHz) with margin. Music applications require 44.1 or 48 kHz to capture the full audible spectrum.

### Bit Depth

| Bit Depth | Dynamic Range | Notes |
|---|---|---|
| 16-bit | 96 dB | Sufficient for most embedded audio; CD quality |
| 24-bit | 144 dB | Exceeds any microphone's dynamic range; used for processing headroom |
| 32-bit | 192 dB | Typically 24-bit data padded to 32-bit alignment for DMA efficiency |

Most I2S MEMS microphones output 24-bit data in a 32-bit frame. The lower 8 bits are padding (zeros or noise). Processing pipelines that operate on 32-bit integers should account for this — the valid data occupies bits [31:8] of each word, with bit 31 as the sign bit.

## Tips

- Always verify the I2S mode (Philips vs left-justified) in both the microphone datasheet and the MCU peripheral configuration — a mode mismatch is the most common cause of garbled or silent audio
- Use DMA for all audio streaming — polling the I2S data register in a loop cannot sustain the required throughput at 48 kHz and introduces jitter that corrupts the sample stream
- Size DMA buffers to match the processing block size of downstream algorithms (e.g., 512 samples for a 512-point FFT) to avoid unnecessary copying between buffers
- When using PDM microphones on STM32, prefer the DFSDM peripheral over software decimation — hardware filtering runs at zero CPU cost and produces consistent timing
- For debugging audio issues, capture raw DMA buffer contents to a log or SD card and inspect them in a tool like Audacity — this reveals whether the problem is in the capture path or the processing path

## Caveats

- **Clock accuracy affects audio pitch** — An I2S bit clock derived from an imprecise internal RC oscillator shifts the effective sample rate, causing audio to play back slightly fast or slow. For audio-critical applications, derive the I2S clock from a crystal-referenced PLL
- **MCLK requirements vary by device** — Some audio codecs require MCLK at exactly 256x the sample rate. MEMS microphones generally do not need MCLK, but connecting one to a codec on the same I2S bus may require generating it
- **DMA buffer alignment** — On ARM Cortex-M, DMA buffers must be aligned to the data width (4-byte alignment for 32-bit transfers). Misaligned buffers cause hard faults or silently corrupt adjacent memory
- **I2S peripheral clock tree limitations** — Not all sample rates are achievable with integer division from the MCU's PLL. 44.1 kHz is notoriously difficult on STM32 — the achievable rate may be 44.117 kHz or 44.089 kHz, introducing a small pitch error. 48 kHz divides cleanly from most PLL configurations
- **PDM clock must be continuous** — Stopping the PDM clock and restarting it causes the microphone's sigma-delta modulator to lose its operating point, producing a burst of noise (settling transient) that lasts 1-10 ms depending on the part

## In Practice

- An I2S capture that produces audio at half the expected pitch and double the duration indicates the MCU is configured for stereo but the microphone is mono — the driver interleaves zero-valued samples for the empty channel, effectively halving the apparent sample rate when played back as mono
- Audio that sounds correct but contains periodic clicks at a regular interval (e.g., every 32 ms) points to a DMA buffer underrun — the processing callback is not completing before the next buffer is ready, causing a brief gap or repeated segment in the audio stream
- A PDM microphone that produces usable audio at 16 kHz but excessive noise at 48 kHz suggests the decimation filter order is too low for the higher output rate — the quantization noise that the sigma-delta modulator pushes above the audio band is not being sufficiently attenuated at the wider bandwidth
- Raw I2S data from an INMP441 that appears as very small values (near zero) when interpreted as 16-bit integers is almost always a bit-width mismatch — the 24-bit data is left-justified in a 32-bit frame, and reading it as 16-bit captures only the MSBs, which for quiet signals are all zeros or sign-extension bits
- Connecting a logic analyzer to the I2S bus and verifying that WS transitions occur exactly one BCLK before the first data bit is the definitive way to diagnose mode configuration issues — many hours of firmware debugging can be saved by a five-minute logic analyzer capture
