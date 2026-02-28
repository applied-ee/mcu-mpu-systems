---
title: "MEMS Microphone Selection & Interfacing"
weight: 10
---

# MEMS Microphone Selection & Interfacing

MEMS microphones have largely replaced electret condenser microphones (ECMs) in embedded systems. The key advantage is integration: a MEMS microphone contains the acoustic transducer, a charge amplifier, and — in digital variants — a sigma-delta ADC and digital interface, all in a single surface-mount package typically 3.5 x 2.65 x 1 mm. The result is a microphone that solders directly to a PCB with no external biasing components, no analog signal routing concerns, and consistent part-to-part sensitivity. Understanding the output format (analog, PDM, or I2S), the critical specifications, and the power supply requirements determines whether a given MEMS microphone will deliver clean audio or an unusable noise floor.

## Analog vs Digital MEMS Microphones

MEMS microphones come in two broad categories:

**Analog output** microphones (e.g., SPH8878LR5H-1, ICS-40300) produce a voltage signal centered at a DC bias point (typically VDD/2) that feeds directly into an MCU's ADC channel. The analog output requires the same anti-alias filtering and ADC sampling considerations as any analog signal path. Routing the trace from microphone output to ADC input requires care — long traces pick up noise from switching regulators, digital clocks, and GPIO toggling.

**Digital output** microphones produce either a PDM bitstream or an I2S-formatted PCM signal. PDM (Pulse Density Modulation) microphones like the MP34DT05-A output a 1-bit sigma-delta bitstream on a single data line, clocked by the MCU at 1-3 MHz. The MCU or a dedicated peripheral must decimate this bitstream into usable PCM samples. I2S microphones like the INMP441 and SPH0645LM4H contain an on-chip decimation filter and output multi-bit PCM samples in standard I2S format — ready for direct processing without additional filtering.

The tradeoff is clear: analog microphones are simpler to connect (one wire to an ADC pin) but inherit all the noise and routing problems of analog signals. Digital microphones cost slightly more but eliminate analog noise pickup entirely — the signal is digital from the microphone package to the MCU peripheral.

## Key Specifications

Three specifications dominate MEMS microphone selection for embedded audio:

### Sensitivity

Sensitivity defines the output level for a standard 1 Pa (94 dB SPL) acoustic input. Analog microphones specify sensitivity in dBV/Pa — a typical value is -38 dBV/Pa, meaning 1 Pa produces about 12.6 mV RMS at the output. Digital microphones specify sensitivity in dBFS — a typical value is -26 dBFS, meaning the 1 Pa reference produces a digital signal 26 dB below full-scale output.

Higher sensitivity (closer to 0 dBFS for digital, closer to 0 dBV for analog) means a louder output for a given sound level. For voice capture at normal speaking distances (30-100 cm), -26 dBFS is a reasonable sensitivity — speech at 1 meter produces roughly 60-70 dB SPL, which translates to -50 to -40 dBFS at the microphone output, leaving plenty of headroom before clipping.

### Signal-to-Noise Ratio (SNR)

SNR measures the difference between the output at 1 Pa (94 dB SPL) and the self-noise floor of the microphone, expressed in dB. A microphone with 65 dB SNR has a noise floor at approximately 29 dB SPL — about the level of a quiet bedroom. Budget MEMS microphones achieve 58-62 dB SNR. Mid-range parts (INMP441, SPH0645) hit 65 dB. Premium parts like the ICS-43434 reach 70 dB SNR, which matters for far-field voice capture or applications where the microphone is distant from the sound source.

### Acoustic Overload Point (AOP)

AOP is the maximum SPL the microphone can handle before the output distortion exceeds 10% THD. Typical values range from 116 dB AOP (budget parts) to 135 dB AOP (high-AOP variants designed for close-mic or industrial environments). For general voice capture, 120 dB AOP is sufficient — normal speech at 5 cm produces about 90-100 dB SPL. Applications near loud machinery, musical instruments, or engines require higher AOP.

The dynamic range of the microphone is approximately AOP minus the equivalent input noise level. A microphone with 65 dB SNR and 120 dB AOP has a dynamic range of about 91 dB — adequate for most embedded audio applications.

## Popular MEMS Microphones for Embedded Projects

| Part Number | Output | Sensitivity | SNR | AOP | Supply | Package | Notes |
|---|---|---|---|---|---|---|---|
| INMP441 | I2S (24-bit) | -26 dBFS | 61 dB | 120 dB | 1.8-3.3 V | 4.72 x 3.76 mm | Widely available on breakout boards, popular with ESP32 |
| SPH0645LM4H | I2S (18-bit) | -26 dBFS | 65 dB | 120 dB | 1.6-3.6 V | 3.50 x 2.65 mm | Better SNR than INMP441, Adafruit breakout |
| ICS-43434 | I2S (24-bit) | -26 dBFS | 70 dB | 116 dB | 1.62-3.6 V | 3.50 x 2.65 mm | High SNR, good for far-field voice |
| MP34DT05-A | PDM | -26 dBFS | 64 dB | 122.5 dB | 1.6-3.6 V | 3.76 x 2.95 mm | ST's PDM mic, pairs well with STM32 SAI |
| ICS-40300 | Analog | -38 dBV/Pa | 63 dB | 124 dB | 1.5-3.6 V | 3.50 x 2.65 mm | Analog output, single-wire to ADC |
| MSM261S4030H0R | PDM | -26 dBFS | 57 dB | 120 dB | 1.6-3.6 V | 3.50 x 2.65 mm | Low cost, common on budget breakout boards |

## PDM Output Principle

PDM microphones contain a sigma-delta modulator that converts the analog transducer signal into a 1-bit data stream. The clock signal (CLK) is provided by the MCU, typically at 1.024 MHz to 3.072 MHz. On each clock edge, the microphone outputs a single bit on the data line (DAT). The density of 1s in the bitstream represents the instantaneous amplitude of the audio signal — a loud positive peak produces runs of 1s, silence produces approximately equal numbers of 0s and 1s, and a loud negative peak produces runs of 0s.

Converting this bitstream to usable PCM audio requires a decimation filter — typically a cascaded integrator-comb (CIC) filter followed by a compensation FIR. The decimation ratio determines the output sample rate: a 3.072 MHz PDM clock decimated by 64 produces 48 kHz PCM; decimated by 128, it produces 24 kHz. Some STM32 families include a hardware DFSDM (Digital Filter for Sigma-Delta Modulators) peripheral that performs this decimation automatically.

Stereo operation with PDM microphones uses a single CLK line and a single DAT line shared between two microphones. One microphone is configured (via a select pin) to output data on the rising clock edge, the other on the falling edge. The MCU peripheral de-interleaves the two channels.

## Breakout Board Integration

Most hobbyist and prototyping work with MEMS microphones uses breakout boards rather than bare ICs. The breakout board provides the necessary decoupling capacitor (100 nF, placed within 1 mm of the VDD pin), level-matched pull-up/pull-down resistors for channel selection, and 0.1" header pins for breadboard connection.

Common breakout boards:

- **INMP441 breakout** — Widely available from multiple vendors, provides I2S output (SCK, WS, SD), L/R channel select via solder jumper or pull-down resistor, 3.3V operation
- **Adafruit SPH0645 breakout (product 3421)** — I2S output, includes voltage regulator for 3.3-5V input, channel select pin exposed
- **Adafruit MP34DT01 PDM breakout (product 3492)** — PDM output (CLK and DAT), requires MCU-side decimation

When connecting a breakout board, the wiring for I2S microphones is straightforward:

| Breakout Pin | ESP32 GPIO (example) | Function |
|---|---|---|
| SCK (BCLK) | GPIO 14 | Bit clock — provided by MCU |
| WS (LRCLK) | GPIO 15 | Word select / left-right clock |
| SD (DOUT) | GPIO 32 | Serial data output from mic |
| VDD | 3.3V | Power supply |
| GND | GND | Ground |
| L/R | GND or VDD | Channel select (GND = left, VDD = right) |

## I2S Read Setup — INMP441 on ESP32

The following ESP-IDF code configures the I2S peripheral to read audio from an INMP441 microphone at 16 kHz sample rate, 16-bit samples, mono:

```c
#include "driver/i2s_std.h"
#include "esp_log.h"

#define I2S_SAMPLE_RATE     16000
#define I2S_BUFFER_SIZE     1024

static const char *TAG = "mems_mic";
static i2s_chan_handle_t rx_handle = NULL;

void mems_mic_init(void)
{
    /* Channel configuration */
    i2s_chan_config_t chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(
        I2S_NUM_0, I2S_ROLE_MASTER);
    chan_cfg.dma_desc_num = 4;
    chan_cfg.dma_frame_num = I2S_BUFFER_SIZE;

    ESP_ERROR_CHECK(i2s_new_channel(&chan_cfg, NULL, &rx_handle));

    /* Standard mode configuration for INMP441 */
    i2s_std_config_t std_cfg = {
        .clk_cfg  = I2S_STD_CLK_DEFAULT_CONFIG(I2S_SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(
            I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = GPIO_NUM_14,
            .ws   = GPIO_NUM_15,
            .dout = I2S_GPIO_UNUSED,
            .din  = GPIO_NUM_32,
            .invert_flags = {
                .mclk_inv = false,
                .bclk_inv = false,
                .ws_inv   = false,
            },
        },
    };

    ESP_ERROR_CHECK(i2s_channel_init_std_mode(rx_handle, &std_cfg));
    ESP_ERROR_CHECK(i2s_channel_enable(rx_handle));

    ESP_LOGI(TAG, "INMP441 I2S initialized: %d Hz, 16-bit mono",
             I2S_SAMPLE_RATE);
}

void mems_mic_read(int16_t *buffer, size_t sample_count)
{
    size_t bytes_read = 0;
    size_t bytes_requested = sample_count * sizeof(int16_t);

    esp_err_t ret = i2s_channel_read(rx_handle, buffer,
                                      bytes_requested,
                                      &bytes_read,
                                      portMAX_DELAY);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2S read error: %s", esp_err_to_name(ret));
    }
}
```

The INMP441 outputs 24-bit samples left-justified in a 32-bit I2S frame. When configured for 16-bit mode, the ESP-IDF I2S driver truncates the lower bits, which is acceptable for voice applications. For higher fidelity, configuring 32-bit mode and right-shifting by 8 bits preserves the full 24-bit dynamic range.

## Power Supply Filtering

MEMS microphones are remarkably sensitive to power supply noise. The internal charge amplifier and ADC operate at very small signal levels — the noise floor of a 65 dB SNR microphone corresponds to about 4.5 uV RMS referred to input. Any supply noise that couples into the signal path degrades SNR and introduces audible artifacts.

The recommended supply filtering for MEMS microphones:

1. **Bulk capacitor**: 10 uF ceramic (X5R or X7R) on the supply rail feeding the microphone
2. **Local decoupling**: 100 nF ceramic placed within 1 mm of the VDD pin — most breakout boards include this
3. **Series ferrite bead**: A small ferrite bead (e.g., 600 ohm at 100 MHz, rated for the microphone's current draw of ~250 uA) in series with the VDD line isolates the microphone from high-frequency noise on the main supply rail
4. **Separate supply trace**: Route the microphone VDD from the regulator output, not from a shared trace that also feeds digital logic or LED drivers

On a board where the MEMS microphone shares a 3.3V rail with an ESP32 (which draws 80-240 mA with sharp current transients during Wi-Fi TX bursts), audible buzzing or clicking in the audio output is a near-certainty unless the supply is filtered. The ferrite bead + 10 uF + 100 nF combination attenuates the transients before they reach the microphone.

## Clock Considerations

I2S microphones require the MCU to generate a bit clock (BCLK) at a specific frequency: BCLK = sample_rate x bits_per_sample x num_channels. For 16 kHz, 16-bit, stereo, this is 512 kHz. For 48 kHz, 32-bit, stereo: 3.072 MHz.

PDM microphones require a clock in the 1-3 MHz range. The exact frequency determines the output sample rate after decimation. A common approach is to use a 3.072 MHz PDM clock with a decimation ratio of 64, yielding 48 kHz PCM output.

The clock quality matters more than might be expected. Jitter on the bit clock translates directly to jitter in the sample timing, which manifests as noise in the digitized audio. Using a dedicated I2S peripheral (not bit-banging) ensures clean clock generation from the MCU's PLL-derived clock tree.

## Tips

- Start with a known-good breakout board (INMP441 or SPH0645) before designing a custom PCB — this isolates firmware issues from hardware layout problems
- Verify the L/R select pin configuration matches the I2S slot expected in firmware — a mismatch produces all-zero samples because the microphone outputs on the opposite clock phase
- Use 32-bit I2S mode when reading 24-bit microphones, then right-shift the raw samples to extract the actual data — the padding bits are at the LSB end
- Keep the PDM or I2S clock lines short and away from noisy signals (SPI, PWM, switching regulator outputs) — clock integrity directly affects audio quality
- For battery-powered applications, check the microphone's low-power or sleep mode — many MEMS microphones draw only 5-10 uA in standby, waking in under 1 ms when the clock resumes

## Caveats

- **INMP441 modules from different vendors are not identical** — Some use different pull-up/pull-down resistors on the L/R select pin, causing the microphone to appear on the right channel instead of the expected left. Always verify the channel assignment by reading raw samples and checking which half-frames contain data
- **PDM microphones require MCU-side decimation** — Without a hardware DFSDM peripheral or a software CIC filter, the raw PDM bitstream is unusable. Budget MCUs without PDM decimation support should use I2S microphones instead
- **Acoustic port orientation matters** — MEMS microphones are either top-port (sound enters through a hole in the package lid) or bottom-port (sound enters through a hole in the PCB). Mounting a bottom-port microphone without a corresponding PCB hole produces severely attenuated audio
- **Supply noise is the most common cause of poor audio quality** — Before blaming the microphone or firmware, probe the VDD pin with an oscilloscope. Ripple above 10 mV peak-to-peak at audio frequencies will be audible
- **Clock frequency tolerance** — MEMS microphones specify a valid clock frequency range (e.g., 1.024-4.096 MHz for PDM). Operating outside this range may cause the internal sigma-delta modulator to behave unpredictably, producing distorted output or excessive noise

## In Practice

- An INMP441 breakout connected to an ESP32 producing all-zero samples almost always indicates a wrong WS (word select) polarity or L/R select mismatch — swapping the L/R pin state or inverting the WS signal in software resolves it
- Audio that sounds clean at moderate volumes but clips harshly during loud sounds suggests the signal is exceeding the AOP — this is rare with typical 120 dB AOP parts unless the microphone is positioned within a few centimeters of a loudspeaker
- A 50/60 Hz hum in the captured audio points to ground loop issues or insufficient supply filtering rather than a microphone problem — the hum is coupling through the power supply or through capacitive coupling on long analog signal traces
- Capturing audio from two INMP441 modules on the same I2S bus (one set to left, one to right) produces stereo output only if both modules receive identical BCLK and WS signals — even a few centimeters of trace length difference can cause intermittent bit errors at high sample rates
- Tapping the PCB near a MEMS microphone produces a sharp spike in the audio output — this is mechanical vibration coupling through the package, and is normal behavior; acoustic isolation gaskets reduce this effect in product designs
