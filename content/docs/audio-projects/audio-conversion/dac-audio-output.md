---
title: "DAC Audio Output"
weight: 20
---

# DAC Audio Output

An on-chip DAC converts digital audio samples back into an analog voltage waveform — the final step before an amplifier drives a speaker or headphone. Many Cortex-M MCUs include one or two 12-bit DAC channels (STM32F4, STM32H7, ESP32, RP2350), which can produce audio output without any external converter IC. The quality ceiling is set by the DAC resolution and output characteristics: a 12-bit DAC provides ~72 dB of theoretical dynamic range (10–11 ENOB in practice), sufficient for voice, notification sounds, and casual audio playback, but noticeably below CD quality for critical listening.

## DMA-Driven Audio Playback

Continuous audio output follows the same pattern as ADC capture: a hardware timer triggers DAC conversions at the sample rate, and DMA feeds sample values from a buffer to the DAC data register. The CPU only needs to fill the next buffer before DMA reaches it.

```c
/* STM32 HAL — DAC with timer trigger and DMA */
/* TIM6 configured for 48 kHz trigger rate */

static uint16_t dac_buffer[DAC_BUFFER_SIZE * 2];  /* Ping-pong buffer */

void audio_dac_start(void)
{
    HAL_TIM_Base_Start(&htim6);
    HAL_DAC_Start_DMA(&hdac, DAC_CHANNEL_1,
                      (uint32_t *)dac_buffer,
                      DAC_BUFFER_SIZE * 2,
                      DAC_ALIGN_12B_L);  /* Left-aligned for easy Q15 conversion */
}

/* Half-transfer callback — fill first half with next audio block */
void HAL_DAC_ConvHalfCpltCallbackCh1(DAC_HandleTypeDef *hdac)
{
    fill_audio_buffer(dac_buffer, DAC_BUFFER_SIZE);
}

/* Transfer complete — fill second half */
void HAL_DAC_ConvCpltCallbackCh1(DAC_HandleTypeDef *hdac)
{
    fill_audio_buffer(&dac_buffer[DAC_BUFFER_SIZE], DAC_BUFFER_SIZE);
}
```

On ESP32, the DAC is accessed through the `dac_continuous` driver in ESP-IDF v5.x:

```c
dac_continuous_config_t dac_cfg = {
    .chan_mask = DAC_CHANNEL_MASK_CH0,
    .desc_num = 4,
    .buf_size = 2048,
    .freq_hz = 48000,
    .clk_src = DAC_DIGI_CLK_SRC_APLL,  /* Audio PLL for precise timing */
};
dac_continuous_handle_t dac_handle;
dac_continuous_new_channels(&dac_cfg, &dac_handle);
dac_continuous_enable(dac_handle);
```

## Output Characteristics

The internal DAC output is a voltage step function — each sample holds a constant voltage for one sample period (1/Fs), then steps to the next value. This zero-order hold (ZOH) behavior introduces two characteristics that affect audio quality:

**Staircase waveform** — The output is not smooth; it contains frequency components at multiples of the sample rate. A reconstruction filter (low-pass) is needed to smooth the output into a continuous waveform.

**Sinc roll-off** — The ZOH frequency response follows a sinc(πf/Fs) shape, attenuating high frequencies. At Fs/2 (Nyquist), the attenuation is -3.92 dB. For voice applications this is negligible; for music, a digital sinc compensation filter before the DAC corrects the droop.

### DAC Output Specifications

| MCU | DAC Bits | Channels | Output Range | Output Impedance | Buffer Amp |
|---|---|---|---|---|---|
| STM32F4 | 12 | 2 | 0 – VREF (typ. 3.3V) | ~15 kΩ (unbuffered) | Optional |
| STM32H7 | 12 | 2 | 0 – VREF | ~1 kΩ (buffered) | Yes |
| ESP32 | 8 | 2 | 0 – 3.3V | ~50 kΩ | No |
| RP2350 | 12 | 1 | 0 – VREF | ~2 kΩ | Yes |

The ESP32's DAC is only 8-bit, limiting dynamic range to ~48 dB. The STM32 12-bit DAC provides ~72 dB theoretical, approximately 66 dB in practice after accounting for noise.

## Output Buffering

The DAC output impedance determines how much current the output can source without voltage droop. An unbuffered STM32F4 DAC output (~15 kΩ impedance) drops significantly when driving even a modest load. Solutions:

- **Enable the internal output buffer** — STM32 DACs include an optional output buffer amplifier that reduces output impedance to ~1 kΩ (F4) or lower (H7). Enabled via `DAC_OutputBuffer = DAC_OUTPUTBUFFER_ENABLE`.
- **External op-amp buffer** — A rail-to-rail op-amp in voltage follower configuration provides low output impedance and can drive headphones directly (32 Ω load draws ~100 mA peak at 3.3V, requiring an op-amp that can supply that current).
- **AC coupling** — A series capacitor (10–100 µF) blocks the DC offset and allows the audio signal to swing symmetrically around ground. This is standard for headphone and line-level output connections.

## Reconstruction Filtering

The DAC output must be low-pass filtered to remove aliases (spectral images at multiples of Fs) and smooth the staircase waveform. A simple first-order RC filter provides 20 dB/decade rolloff:

```
         DAC_OUT
           │
           ├── R (1 kΩ) ──┬── OUTPUT
           │               │
           │              C (3.3 nF)
           │               │
           GND            GND

Cutoff: fc = 1 / (2π × R × C) ≈ 48 kHz
```

A first-order filter provides ~20 dB attenuation at the first alias (Fs, 48 kHz above the audio band). For higher-quality output, a second-order Sallen-Key filter provides 40 dB/decade rolloff. Professional audio DACs include oversampling (8x) and digital reconstruction filters internally, pushing the aliases far above the audio band where a simple analog filter suffices.

## Amplifier ICs

For driving speakers, an amplifier between the DAC and speaker is required. Common choices for embedded audio:

| IC | Type | Output Power | Supply | Interface | Notes |
|---|---|---|---|---|---|
| PAM8403 | Class-D stereo | 2 × 3W (4Ω) | 5V | Analog input | Cheapest, widely available |
| MAX98357A | Class-D mono | 3.2W (4Ω) | 3.3–5V | I2S input | No DAC needed — direct I2S |
| TPA2012 | Class-D stereo | 2 × 2.1W (4Ω) | 2.5–5.5V | Analog input | Low quiescent current |
| LM386 | Class-AB mono | 325 mW (8Ω) | 4–12V | Analog input | Legacy, high THD |
| TDA7297 | Class-AB stereo | 2 × 15W (8Ω) | 6.5–18V | Analog input | Higher power applications |

Class-D amplifiers are strongly preferred for embedded: higher efficiency (85–90% vs 50% for class-AB), lower heat, and smaller form factor. The PWM switching noise from class-D amplifiers is ultrasonic (typically 250–400 kHz) and inaudible, though it can interfere with nearby ADC conversions if not properly filtered.

## Tips

- Use left-aligned DAC data format when working with Q15 audio — the upper 12 bits of the 16-bit value map directly to the DAC, and the lower 4 bits are ignored. This avoids a shift operation per sample.
- Add a DC bias of VREF/2 to the DAC output when driving AC-coupled loads. The DAC output range is 0 to VREF, but audio requires a symmetric swing. Biasing to VREF/2 centers the waveform, and the AC coupling capacitor removes the DC offset.
- For stereo output on STM32, both DAC channels can share the same timer trigger and run from separate DMA streams, ensuring sample-accurate synchronization between left and right.

## Caveats

- The internal output buffer on STM32F4 DAC has limited drive capability and can oscillate with capacitive loads above ~100 pF. If the output connects to a long cable or high-capacitance input, adding a series resistor (100–470 Ω) between the buffer output and the load stabilizes it.
- ESP32's 8-bit DAC introduces audible quantization noise on music content. The 256-level step size (13 mV per step at 3.3V) is coarse enough to be heard as a grainy texture on quiet passages. For ESP32 audio output, I2S with an external DAC (MAX98357A, PCM5102A) is the standard approach.
- Switching the DAC output buffer on or off while audio is playing produces a loud pop. Configure the buffer state during initialization, before starting DMA output.

## In Practice

- **Audio output has a high-pitched whine** — the reconstruction filter cutoff is too high (or missing entirely), allowing the sample-rate alias to reach the amplifier. A 48 kHz audio stream without filtering contains energy at 48 kHz, 96 kHz, and harmonics. While inaudible directly, intermodulation with the amplifier's nonlinearity can fold these down into the audio band.
- **Audio sounds muffled or bass-heavy** — the reconstruction filter cutoff is too low, attenuating upper audio frequencies. A first-order RC filter with a 10 kHz cutoff (appropriate for voice but not music) rolls off audible content above 10 kHz.
- **Loud pop at startup and shutdown** — the DAC output swings from its idle state (often 0V or mid-rail, depending on configuration) to the first audio sample. A software ramp from the idle voltage to the first sample value over 10–50 ms, and an equivalent ramp at shutdown, eliminates the transient.
