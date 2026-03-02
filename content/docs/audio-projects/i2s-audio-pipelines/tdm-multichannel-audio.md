---
title: "TDM & Multi-Channel Audio"
weight: 30
---

# TDM & Multi-Channel Audio

Standard I2S carries two channels (left and right) in a single frame. TDM (Time-Division Multiplexing) extends this by packing multiple channels into the same frame — 4, 8, or even 16 slots on a single data line, each carrying one channel of audio. This is the standard approach for microphone arrays, multi-channel mixers, and any application that needs more than two channels without adding physical I2S buses. The I2S peripheral on many MCUs (STM32 SAI, ESP32 I2S, nRF52 I2S) supports TDM natively, though the configuration differs substantially between platforms.

## TDM Frame Structure

A TDM frame divides one word-select (WS/LRCK) cycle into multiple time slots. Each slot carries one channel's sample at the configured bit depth.

```
Standard I2S (2 slots):
WS:   ____--------____--------
BCLK: _-_-_-_-_-_-_-_-_-_-_-_-
SD:   [  L 16-bit  ][  R 16-bit  ]

TDM 4-slot (16-bit per slot):
WS:   ____________________________--------...
BCLK: _-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-_-...
SD:   [ Slot 0 ][ Slot 1 ][ Slot 2 ][ Slot 3 ]
```

The total BCLK frequency for TDM equals: `sample_rate × slots × bits_per_slot`. A 4-slot TDM frame with 32-bit slots at 48 kHz requires a BCLK of 6.144 MHz. An 8-slot configuration doubles that to 12.288 MHz — approaching the maximum BCLK rate of some MCU I2S peripherals.

| Slots | Bits/Slot | Sample Rate | BCLK Required | Typical Use |
|---|---|---|---|---|
| 2 | 16 | 48 kHz | 1.536 MHz | Standard stereo |
| 2 | 32 | 48 kHz | 3.072 MHz | 24-bit audio in 32-bit frames |
| 4 | 32 | 48 kHz | 6.144 MHz | Quad mic array |
| 8 | 32 | 16 kHz | 4.096 MHz | 8-mic array for beamforming |
| 8 | 32 | 48 kHz | 12.288 MHz | 8-ch recording / mixing |

## STM32 SAI TDM Configuration

The STM32 SAI (Serial Audio Interface) peripheral supports TDM with fine-grained slot control. Unlike the basic I2S peripheral (SPI/I2S), the SAI allows selecting which slots are active and routing them independently through DMA.

```c
/* STM32 HAL — SAI TDM 4-slot configuration */
hsai.Instance            = SAI1_Block_A;
hsai.Init.AudioMode      = SAI_MODEMASTER_RX;
hsai.Init.Synchro        = SAI_ASYNCHRONOUS;
hsai.Init.Protocol       = SAI_FREE_PROTOCOL;  /* TDM requires free protocol */
hsai.Init.DataSize       = SAI_DATASIZE_32;
hsai.Init.FirstBit       = SAI_FIRSTBIT_MSB;
hsai.Init.ClockStrobing  = SAI_CLOCKSTROBING_FALLINGEDGE;
hsai.Init.FrameLength    = 128;      /* 4 slots × 32 bits */
hsai.Init.ActiveFrameLength = 32;    /* WS pulse width */
hsai.Init.FIFOThreshold  = SAI_FIFOTHRESHOLD_1QF;
hsai.Init.NbSlot         = 4;
hsai.Init.SlotSize       = SAI_SLOTSIZE_32B;
hsai.Init.SlotActive     = SAI_SLOTACTIVE_0 | SAI_SLOTACTIVE_1 |
                           SAI_SLOTACTIVE_2 | SAI_SLOTACTIVE_3;
```

The `SlotActive` bitmask controls which slots DMA transfers to/from memory. Inactive slots are ignored — their bit periods still occur on the bus, but the DMA does not transfer data for them. This is useful for receiving only channels 0 and 1 from an 8-slot TDM bus, reducing DMA bandwidth and memory usage.

## ESP32 TDM Mode

ESP32 (original and S3) I2S peripherals support TDM through the standard I2S driver in ESP-IDF v5.x. The `i2s_tdm_config_t` structure configures slot count and active mask:

```c
/* ESP-IDF v5.x — I2S TDM 4-channel receive */
i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
chan_cfg.dma_desc_num = 8;
chan_cfg.dma_frame_num = 256;

i2s_tdm_config_t tdm_cfg = {
    .clk_cfg  = I2S_TDM_CLK_DEFAULT_CONFIG(48000),
    .slot_cfg = I2S_TDM_MSB_SLOT_DEFAULT_CONFIG(
                    I2S_DATA_BIT_WIDTH_32BIT,
                    I2S_SLOT_MODE_STEREO,
                    I2S_TDM_SLOT0 | I2S_TDM_SLOT1 |
                    I2S_TDM_SLOT2 | I2S_TDM_SLOT3),
    .gpio_cfg = {
        .mclk = GPIO_NUM_0,
        .bclk = GPIO_NUM_4,
        .ws   = GPIO_NUM_5,
        .dout = I2S_GPIO_UNUSED,
        .din  = GPIO_NUM_6,
    },
};

i2s_channel_handle_t rx_handle;
i2s_new_channel(&chan_cfg, NULL, &rx_handle);
i2s_channel_init_tdm_mode(rx_handle, &tdm_cfg);
i2s_channel_enable(rx_handle);
```

## Microphone Arrays

TDM's primary embedded use case is connecting multiple digital microphones to a single I2S bus. MEMS microphones with I2S/TDM output (e.g., ICS-43434, SPH0645) typically support 2-slot I2S or multi-slot TDM. Microphones with PDM output can be connected through a PDM-to-TDM bridge IC (e.g., ADAU7002 for 2-channel), or through multiple PDM input channels on the MCU followed by software interleaving.

A 4-microphone array for beamforming on ESP32-S3:

```
             ┌──────────┐
  MIC 0 ────►│          │
  MIC 1 ────►│  ESP32   │──── I2S TDM (4 slots)
  MIC 2 ────►│   S3     │
  MIC 3 ────►│          │
             └──────────┘

TDM bus: BCLK ────► all 4 mics
         WS   ────► all 4 mics
         SD0  ◄──── MIC 0 (slot 0) + MIC 1 (slot 1)
         SD1  ◄──── MIC 2 (slot 2) + MIC 3 (slot 3)
```

Some microphones share a data line using slot selection (similar to PDM L/R channel selection). Others require separate data lines — in which case the MCU needs either multiple I2S data inputs or a TDM aggregator.

## DMA Layout for Multi-Channel Data

DMA transfers multi-channel TDM data as interleaved samples in memory. For a 4-channel, 32-bit TDM configuration, each DMA frame contains:

```
Memory layout (one TDM frame = one sample period):
[Ch0_sample0][Ch1_sample0][Ch2_sample0][Ch3_sample0]
[Ch0_sample1][Ch1_sample1][Ch2_sample1][Ch3_sample1]
...
```

Processing individual channels requires de-interleaving. For DSP operations that work on single channels (per-channel filtering, beamforming weight application), de-interleaving into separate channel buffers is typically more efficient than processing in-place with stride access, because stride access patterns defeat cache prefetch on M7-class cores and PSRAM-backed memory on ESP32.

```c
/* De-interleave 4-channel TDM data */
void deinterleave_4ch(const int32_t *interleaved, int32_t *ch0,
                      int32_t *ch1, int32_t *ch2, int32_t *ch3,
                      size_t frames)
{
    for (size_t i = 0; i < frames; i++) {
        ch0[i] = interleaved[i * 4 + 0];
        ch1[i] = interleaved[i * 4 + 1];
        ch2[i] = interleaved[i * 4 + 2];
        ch3[i] = interleaved[i * 4 + 3];
    }
}
```

## Tips

- Verify the TDM slot assignment of each microphone or codec channel with a logic analyzer before writing processing code — miswired or misconfigured slots are invisible in firmware until the wrong channel data appears.
- When only a subset of TDM slots are needed, use the SAI's slot-active mask (STM32) or equivalent to reduce DMA traffic. Transferring 8 slots when only 2 are used wastes DMA bandwidth and memory.
- For microphone arrays, ensure all microphones receive the same BCLK and WS signals with minimal skew. Long PCB traces or daisy-chained wiring add propagation delay that can cause inter-channel timing errors visible as a phase offset.

## Caveats

- Not all I2S peripherals support TDM. The basic SPI/I2S peripheral on STM32F4 is limited to 2-slot I2S — TDM requires the SAI peripheral found on STM32F4 (some models), STM32H7, and STM32L4+. Check the reference manual for "SAI" rather than "SPI/I2S."
- ESP32 (original) supports TDM but with limitations on slot count and BCLK frequency that do not apply to ESP32-S3. High slot counts at high sample rates may exceed the original ESP32's clock generation capability.
- TDM slot numbering conventions vary between codec ICs and MCU peripherals. A codec's "slot 0" may map to the MCU's "slot 1" depending on the WS polarity and edge configuration. The only reliable method is to verify with a logic analyzer.

## In Practice

- **One channel of a multi-mic array is silent or contains a copy of another channel** — typically a slot assignment mismatch. If two microphones are configured for the same slot, one overwrites the other. If a microphone is assigned to a slot the MCU is not receiving, its data is discarded.
- **Audio from a TDM microphone array has a phase offset between channels** — may indicate BCLK/WS routing with different trace lengths, or a TDM slot alignment error where channels are shifted by one slot. A known test (snapping fingers equidistant from all microphones) should produce simultaneous peaks on all channels.
- **Intermittent data corruption in higher-numbered TDM slots** — can appear when the BCLK frequency is marginal for the configured slot count. Setup and hold time violations on the data line become more likely at higher BCLK rates, particularly with long wires or breadboard connections.
