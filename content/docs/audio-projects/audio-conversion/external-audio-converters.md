---
title: "External Audio ADCs & DACs"
weight: 40
---

# External Audio ADCs & DACs

When on-chip conversion is not enough — the noise floor is too high, the resolution is too coarse, or the application demands audiophile-grade specifications — a dedicated external audio converter IC bridges the gap. These devices are purpose-built for audio: 24-bit sigma-delta converters with 100+ dB SNR, integrated anti-aliasing and reconstruction filters, ultra-low jitter clock circuitry, and precisely matched analog front-ends. The trade-off is additional board complexity (I2S bus, clock routing, power supply filtering) and cost ($1–10 per IC).

## When to Use External Converters

| Scenario | Internal ADC/DAC | External Converter |
|---|---|---|
| Voice prompts, alarms, UI sounds | Sufficient (12-bit, ~60 dB SNR) | Unnecessary |
| Voice capture for recognition | Usually sufficient | Better if noise is an issue |
| Music playback (casual) | Marginal (audible noise floor) | Recommended |
| Music recording | Inadequate | Required |
| Sound level measurement | Marginal (limited dynamic range) | Required for calibrated measurement |
| Ultrasonic/bat detection | Internal ADC may suffice | Required for >16-bit dynamic range |
| Professional/studio audio | Not applicable | Required |

The threshold is roughly 70 dB SNR: applications requiring better than 70 dB dynamic range need external conversion. Below that, internal converters with careful analog design are adequate.

## Common External Audio ADC ICs

| IC | Bits | Channels | SNR | THD+N | Interface | Typical Price | Notes |
|---|---|---|---|---|---|---|---|
| PCM1808 | 24 | 2 (stereo) | 99 dB | -93 dB | I2S | ~$3 | Single-ended input, simple config |
| ICS-43434 | 24 | 1 (mono) | 65 dB | — | I2S/TDM | ~$1.50 | MEMS microphone with I2S output |
| INMP441 | 24 | 1 (mono) | 61 dB | — | I2S | ~$1 | Budget I2S MEMS microphone |
| CS5343 | 24 | 2 (stereo) | 100 dB | -93 dB | I2S | ~$4 | Low power (12 mA) |
| AK5720 | 24 | 2 (stereo) | 100 dB | -90 dB | I2S | ~$5 | Differential input option |
| ADAU7002 | — | 2 | — | — | PDM→I2S | ~$2 | PDM-to-I2S bridge, not a converter |

## Common External Audio DAC ICs

| IC | Bits | Channels | SNR | THD+N | Interface | Typical Price | Notes |
|---|---|---|---|---|---|---|---|
| PCM5102A | 32 | 2 (stereo) | 112 dB | -93 dB | I2S | ~$2 | No I2C control needed, line-level output |
| CS4344 | 24 | 2 (stereo) | 105 dB | -90 dB | I2S | ~$2 | Simple, no control register |
| MAX98357A | — | 1 (mono) | 92 dB | — | I2S | ~$2 | Integrated class-D amplifier |
| UDA1334A | 24 | 2 (stereo) | 100 dB | -85 dB | I2S | ~$2 | Adafruit breakout available |
| ES9023 | 24 | 2 (stereo) | 112 dB | -100 dB | I2S | ~$3 | High-quality line-level output |
| PCM5242 | 32 | 2 (stereo) | 112 dB | -94 dB | I2S + I2C | ~$5 | Hardware volume control, EQ |

## SNR and THD Comparison

Signal-to-Noise Ratio (SNR) and Total Harmonic Distortion plus Noise (THD+N) are the two primary quality metrics. Both are measured in dB relative to full scale:

```
Effective dynamic range ≈ min(SNR, -THD+N)
```

| Source | SNR | THD+N | Effective Quality |
|---|---|---|---|
| STM32F4 12-bit DAC | ~66 dB | -60 dB | Low-fi (voice adequate) |
| ESP32 8-bit DAC | ~48 dB | -45 dB | Very low (alarm tones only) |
| PCM5102A | 112 dB | -93 dB | High-fi (exceeds CD quality) |
| CS4344 | 105 dB | -90 dB | High-fi |
| CD audio (16-bit) | 96 dB | — | Reference for consumer audio |
| Bluetooth A2DP (SBC) | ~85 dB | — | Limited by SBC codec, not DAC |

The PCM5102A and similar DACs exceed 16-bit CD quality. In practice, the actual system SNR is limited by the power supply, board layout, and analog output stage rather than the DAC IC itself.

## I2S Connection

External audio converters connect to the MCU over I2S (or TDM for multi-channel). The minimum connection requires three signals for data and two for power:

```
MCU                 External DAC (PCM5102A)
────                ─────────────────────────
BCLK  ──────────►   BCK
WS    ──────────►   LRCK
SD    ──────────►   DIN
                    MCLK ← tied to GND or SCK (PCM5102A auto-detect)
                    VCC  ← 3.3V (with decoupling)
                    GND
```

Some DACs (PCM5102A, MAX98357A) do not require MCLK — they derive the internal clock from BCLK using an internal PLL or operate in a mode that accepts only BCLK and WS. This simplifies the MCU connection to three signal wires. Other DACs (CS4344, PCM5242) require MCLK as a separate signal, typically at 256× or 384× the sample rate.

## Power Supply Filtering

Audio converter ICs are highly sensitive to power supply noise. The datasheet-specified SNR assumes a clean power supply; real-world performance degrades significantly with noisy supplies.

Recommended power supply approach for external audio converters:

```
MCU 3.3V ── Ferrite bead ──┬── 10 µF ceramic ──┬── 100 nF ceramic ── DAC VCC
                           │                    │
                          GND                  GND
```

- **Ferrite bead**: Blocks high-frequency noise from the MCU digital supply. Choose a bead with high impedance at 100 MHz–1 GHz (e.g., BLM18PG121SN1, 120 Ω at 100 MHz).
- **Bulk capacitor**: 10 µF ceramic close to the ferrite bead absorbs low-frequency ripple.
- **Bypass capacitor**: 100 nF ceramic directly at the DAC VCC pin handles high-frequency transients.

For DACs with separate analog and digital power pins (AVDD, DVDD), each supply should have its own ferrite bead and decoupling network. Sharing the same ferrite for both allows digital switching noise to couple into the analog supply.

## PCM5102A Integration Example

The PCM5102A is one of the most common external DACs for ESP32 and STM32 projects. It accepts I2S data directly and produces line-level analog output with no I2C configuration required:

```c
/* ESP-IDF v5.x — I2S output to PCM5102A */
i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);

i2s_std_config_t std_cfg = {
    .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(44100),
    .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                                                     I2S_SLOT_MODE_STEREO),
    .gpio_cfg = {
        .mclk = I2S_GPIO_UNUSED,  /* PCM5102A derives clock from BCK */
        .bclk = GPIO_NUM_26,
        .ws   = GPIO_NUM_25,
        .dout = GPIO_NUM_22,
        .din  = I2S_GPIO_UNUSED,
    },
};

i2s_channel_handle_t tx_handle;
i2s_new_channel(&chan_cfg, &tx_handle, NULL);
i2s_channel_init_std_mode(tx_handle, &std_cfg);
i2s_channel_enable(tx_handle);

/* Write audio data */
size_t bytes_written;
i2s_channel_write(tx_handle, audio_data, data_size, &bytes_written, portMAX_DELAY);
```

The PCM5102A has three configuration pins (active low):
- **FMT** — I2S format select (tie low for standard I2S)
- **DEMP** — De-emphasis filter (tie low to disable)
- **XSMT** — Soft mute (tie high for normal operation, low to mute)

## Tips

- Start with DACs that require no I2C configuration (PCM5102A, MAX98357A, CS4344) to minimize integration complexity. Add I2C-controlled codecs only when runtime volume control, EQ, or input switching is needed.
- Verify I2S signal integrity with a logic analyzer before debugging audio quality — a marginal BCLK signal (slow edges, ringing) can cause bit errors that manifest as intermittent clicks or noise.
- For battery-powered projects, check the DAC's power consumption in both active and standby modes. The PCM5102A draws ~20 mA active; the CS4344 draws ~5 mA. Putting the DAC into standby or power-down mode during silent periods saves significant current.

## Caveats

- The PCM5102A's internal PLL for BCLK-only operation adds jitter compared to providing a dedicated MCLK. For the highest audio quality, providing a clean MCLK from the MCU's audio PLL is preferred — but the difference is measurable only in instrumented testing, not casual listening.
- I2S bit clock and word select signal integrity degrades with wire length. Breadboard connections longer than 10 cm introduce enough capacitance and crosstalk to cause intermittent bit errors at higher BCLK rates (>3 MHz). Use short, direct connections or a proper PCB for reliable operation.
- External DAC output is line-level (typically 1–2 Vrms). Driving headphones or speakers still requires an amplifier stage after the DAC. The PCM5102A cannot drive low-impedance loads directly without distortion.

## In Practice

- **Audio plays but with periodic ticking or crackling** — often caused by I2S timing errors. If BCLK is slightly out of specification (wrong frequency or jitter), the DAC misinterprets sample boundaries, producing regular artifacts. Verifying BCLK frequency and stability with a frequency counter or oscilloscope confirms the source.
- **One stereo channel is silent or plays the wrong content** — WS (LRCK) polarity is inverted relative to the DAC's expectation. Standard Philips I2S defines WS low = left channel, but some DACs or MCU drivers default to the opposite convention. Swapping WS polarity in the I2S configuration resolves it.
- **Audio output has a constant hiss even during silence** — power supply noise coupling into the DAC analog section. The hiss level correlates with MCU activity (WiFi, SPI flash access). Improving power supply filtering (adding or upgrading the ferrite bead) or providing a dedicated LDO for the DAC supply reduces the noise floor.
