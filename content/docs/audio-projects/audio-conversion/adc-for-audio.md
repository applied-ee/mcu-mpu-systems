---
title: "ADC for Audio Capture"
weight: 10
---

# ADC for Audio Capture

Most Cortex-M microcontrollers include a successive-approximation (SAR) ADC capable of sampling at rates well above audio requirements — a 12-bit ADC running at 1 MSPS is far faster than the 8–48 kHz needed for audio. The question is not whether the ADC is fast enough, but whether it is clean enough. Audio demands sustained, evenly spaced conversions with minimal noise over thousands of consecutive samples, while most MCU ADC specifications are optimized for single-shot or burst measurements of slowly changing signals. The gap between "ADC can sample at 48 kHz" and "ADC produces usable audio at 48 kHz" is measured in ENOB, noise floor, and clock jitter.

For general ADC configuration, sampling theory, and calibration, see [ADC Configuration & Sampling]({{< relref "/docs/sensor-integration/analog-front-end/adc-configuration-and-sampling" >}}). For analog microphone front-end circuits, see [Analog Microphone Front Ends]({{< relref "/docs/sensor-integration/audio-and-acoustic/analog-microphone-front-ends" >}}).

## Timer-Triggered Conversion

Audio requires sample-accurate timing — each conversion must occur at exactly 1/Fs intervals. Software-triggered ADC conversions in a loop are not sufficient because RTOS task scheduling jitter introduces sample timing errors that appear as broadband noise.

The standard approach uses a hardware timer to trigger ADC conversions at a precise rate, with DMA transferring results to memory:

```c
/* STM32 HAL — Timer-triggered ADC with DMA for audio capture */
/* TIM3 configured to trigger at 48 kHz (timer period = SystemCoreClock / 48000) */

static uint16_t adc_buffer[ADC_BUFFER_SIZE * 2];  /* Double buffer */

void audio_adc_start(void)
{
    HAL_TIM_Base_Start(&htim3);
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buffer, ADC_BUFFER_SIZE * 2);
}

void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
    process_audio_input(adc_buffer, ADC_BUFFER_SIZE);
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    process_audio_input(&adc_buffer[ADC_BUFFER_SIZE], ADC_BUFFER_SIZE);
}
```

On ESP32, the ADC continuous mode driver (`adc_continuous`) provides timer-triggered conversion with DMA. The conversion frequency is configured directly:

```c
adc_continuous_handle_cfg_t adc_config = {
    .max_store_buf_size = 4096,
    .conv_frame_size = 256,
};
adc_continuous_config_t dig_cfg = {
    .sample_freq_hz = 48000,
    .conv_mode = ADC_CONV_SINGLE_UNIT_1,
    .format = ADC_DIGI_OUTPUT_FORMAT_TYPE2,
};
```

## ENOB at Audio Rates

The effective number of bits (ENOB) measures the actual resolution after accounting for all noise sources — quantization noise, thermal noise, reference noise, and aperture jitter. A 12-bit ADC with 10.5 ENOB delivers the same noise performance as a perfect 10.5-bit converter.

| MCU | ADC Bits | Typical ENOB (audio rates) | SNR | Dynamic Range |
|---|---|---|---|---|
| STM32F4 (12-bit SAR) | 12 | 10.0–10.5 | ~63 dB | Adequate for voice |
| STM32H7 (16-bit SAR) | 16 | 12.0–13.0 | ~78 dB | Good for general audio |
| ESP32 (12-bit SAR) | 12 | 9.0–9.5 | ~57 dB | Voice only, noisy |
| nRF52840 (12-bit SAADC) | 12 | 10.0–10.8 | ~65 dB | Adequate for voice |
| RP2040 (12-bit SAR) | 12 | ~9.5 | ~58 dB | Voice only |
| PCM1808 (external, 24-bit) | 24 | ~18 | ~108 dB | Studio quality |

For comparison, CD-quality audio uses 16 bits (96 dB dynamic range). A 12-bit internal ADC with 10 ENOB provides about 60 dB of dynamic range — sufficient for voice capture (telephone quality is 8-bit / 48 dB) but audibly noisy for music recording.

## Noise Floor Management

The ADC noise floor on an MCU is typically dominated by power supply noise, digital switching noise coupled through the substrate, and reference voltage noise — not the ADC's inherent quantization noise.

Techniques to minimize the noise floor:

- **Separate VDDA/VSSA** — Use the dedicated analog power pins with ferrite bead + capacitor filtering from the digital supply.
- **Low-noise voltage reference** — The ADC reference voltage noise directly translates to conversion noise. On STM32, using the internal reference with proper decoupling on the VREF+ pin is the baseline.
- **Oversample and decimate** — Sampling at 4x the target rate and averaging groups of 4 samples gains approximately 1 additional effective bit (6 dB SNR improvement). At 192 kHz sampling into 48 kHz output with 4x decimation, a 12-bit ADC approaches 13 ENOB.
- **ADC clock speed** — Running the ADC clock faster than necessary increases conversion noise on some architectures. On STM32, staying below the recommended maximum ADC clock (typically 36 MHz for 12-bit mode) ensures the specified ENOB.
- **Quiet digital activity** — Suspending SPI, UART, and PWM peripherals during ADC conversion reduces substrate noise. This is practical only in duty-cycled systems, not continuous audio capture.

## DMA Configuration

Continuous audio capture requires circular DMA mode with half-transfer and transfer-complete interrupts (identical pattern to I2S DMA). The ADC writes conversion results directly to memory without CPU involvement.

Key configuration details:

- **Data alignment** — 12-bit ADC results can be right-aligned (0x000–0xFFF) or left-aligned (0x0000–0xFFF0) in a 16-bit DMA transfer. Left alignment is preferred for audio because it maps naturally to Q15 format (the 12-bit value occupies the upper 12 bits of a 16-bit word).
- **DMA transfer width** — Must match the ADC result register width. 12-bit results use 16-bit (half-word) transfers.
- **Buffer alignment** — Same requirements as I2S DMA: half-word aligned for 16-bit transfers.

```c
/* STM32 — ADC left-aligned for Q15-compatible audio output */
hadc1.Init.Resolution = ADC_RESOLUTION_12B;
hadc1.Init.DataAlign = ADC_DATAALIGN_LEFT;  /* 0x0000–0xFFF0 */
```

## Internal ADC vs Dedicated Audio ADC

| Parameter | Internal SAR ADC | External Audio ADC (e.g., PCM1808) |
|---|---|---|
| Resolution | 12–16 bits | 24 bits |
| ENOB (48 kHz) | 9.5–13 | 17–20 |
| SNR | 57–78 dB | 100–110 dB |
| THD+N | -70 to -80 dB | -95 to -105 dB |
| Interface | Built-in (DMA) | I2S (additional wiring) |
| Additional cost | $0 | $2–8 |
| Board complexity | None | I2S routing + power filtering |
| Sample rates | Flexible (timer-driven) | Fixed multiples of MCLK |

For voice capture, environmental monitoring, and low-fidelity audio, the internal ADC is sufficient. For music recording, sound measurement, or any application requiring >70 dB dynamic range, a dedicated audio ADC is the practical choice.

## Tips

- Use left-aligned ADC data for audio — it avoids a shift operation in the processing pipeline and the unused lower 4 bits (on a 12-bit ADC) contribute only quantization noise at the LSBs.
- Enable oversampling hardware (available on STM32G4, STM32H7, ESP32-S3) before reaching for an external ADC. 16x hardware oversampling on a 12-bit ADC delivers ~14 effective bits with no CPU cost.
- Apply a high-pass filter (20–30 Hz cutoff) to the captured audio to remove DC offset. Internal ADCs often have a non-zero DC offset that varies with temperature, and audio processing assumes a zero-centered signal.

## Caveats

- ESP32's ADC has significant nonlinearity at the extremes of its input range (below 100 mV and above 3.0V on the 3.3V range). Audio signals should be biased to mid-range (~1.65V) with an amplitude that stays within the linear region — roughly 200 mV to 2.8V.
- Timer-triggered ADC on some STM32 families requires specific timer-to-ADC trigger connections defined in the datasheet. Not every timer can trigger every ADC instance — verify the trigger connection matrix in the reference manual.
- Simultaneous use of the ADC for audio capture and other analog measurements (battery voltage, temperature sensor) creates scheduling conflicts. Either use a second ADC instance for non-audio measurements, or time-multiplex by pausing audio capture during the measurement.

## In Practice

- **Captured audio has a steady whine or buzz** — often correlated with SPI flash access, WiFi TX bursts (on ESP32), or PWM frequency. Digital switching noise is coupling into the analog domain through the power supply or substrate. Adding ferrite beads on VDDA and ensuring a solid analog ground path typically attenuates the interference.
- **Audio level drifts slowly over time** — the ADC DC offset is changing with temperature. A DC-blocking high-pass filter with a very low cutoff (5–10 Hz) removes the drift without affecting audio content.
- **Periodic clicks in captured audio at a rate unrelated to audio content** — another peripheral's DMA is contending with the ADC DMA for bus bandwidth, causing occasional missed ADC triggers. Adjusting DMA priorities or reducing the contending peripheral's burst length resolves the conflict.
