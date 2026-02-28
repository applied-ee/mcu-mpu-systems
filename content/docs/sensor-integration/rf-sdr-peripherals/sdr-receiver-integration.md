---
title: "SDR Receiver Integration"
weight: 30
---

# SDR Receiver Integration

Software-defined radio (SDR) replaces fixed analog signal processing stages with software — tuning, filtering, decimation, and demodulation happen in code rather than in hardware. For embedded systems, SDR integration ranges from connecting a USB dongle to a Linux SBC (the RTL-SDR approach) to driving a small SPI/I2C receiver IC from an MCU (Si4732, RDA5807). The dividing line is processing power: demodulating wideband signals requires sustained DSP throughput that MCUs cannot deliver, while narrowband applications (FM broadcast, weather stations, simple ASK/FSK decoding) fit comfortably on a microcontroller with a dedicated receiver front-end.

## RTL-SDR (RTL2832U + R820T2)

The RTL-SDR is a USB dongle originally designed for DVB-T television reception, repurposed as a general-purpose SDR receiver. The RTL2832U provides USB interfacing and a basic ADC, while the R820T2 tuner covers 24-1766 MHz. The combination delivers 8-bit I/Q samples at up to 2.56 MSPS (megasamples per second) via USB bulk transfers.

### Key Specifications

| Parameter | Value |
|---|---|
| Frequency range | 24 MHz - 1766 MHz |
| Sample rate | 225.001 kHz - 2.56 MSPS (3.2 MSPS possible but with sample drops) |
| ADC resolution | 8-bit I, 8-bit Q |
| Interface | USB 2.0 bulk transfer |
| Current draw | ~300 mA at 5V |
| Frequency stability | +/- 50 ppm (uncorrected), +/- 1 ppm with TCXO mod |
| Noise figure | ~3.5 dB (with R820T2) |
| Cost | $8-25 USD |

The 8-bit resolution limits dynamic range to approximately 48 dB — adequate for strong signals but insufficient for applications requiring simultaneous reception of weak and strong signals in the same bandwidth.

### RTL-SDR on a Linux SBC (Raspberry Pi)

The most common embedded SDR integration pattern connects an RTL-SDR dongle to a Raspberry Pi or similar Linux SBC. The `librtlsdr` library provides the low-level USB interface, and higher-level tools handle demodulation.

```bash
# Install RTL-SDR tools on Raspberry Pi (Debian/Ubuntu)
sudo apt-get update
sudo apt-get install rtl-sdr librtlsdr-dev

# Blacklist the DVB-T kernel module (conflicts with SDR use)
echo 'blacklist dvb_usb_rtl28xxu' | sudo tee /etc/modprobe.d/blacklist-rtlsdr.conf
sudo modprobe -r dvb_usb_rtl28xxu

# Verify the dongle is detected
rtl_test -t
# Expected output: "Found 1 device(s):" followed by device info

# Capture raw I/Q samples at 2.048 MSPS centered on 433.92 MHz
rtl_sdr -f 433920000 -s 2048000 -g 40 capture.bin

# FM broadcast demodulation (mono, 88.5 MHz)
rtl_fm -f 88500000 -M fm -s 200000 -r 48000 | aplay -r 48000 -f S16_LE -t raw

# ADS-B aircraft tracking (1090 MHz)
sudo apt-get install dump1090-mutability
dump1090-mutability --interactive
```

For continuous operation (e.g., an ADS-B feeder or weather satellite receiver), the RTL-SDR USB connection must handle sustained data rates. At 2.048 MSPS with 2 bytes per sample (I+Q), the data rate is approximately 4 MB/s — well within USB 2.0 bandwidth but requiring the SBC's CPU to keep up with processing. On a Raspberry Pi 4, this is comfortable. On a Pi Zero, sample drops occur above 1 MSPS unless processing is minimal.

### MCU Limitations for RTL-SDR

Connecting an RTL-SDR to a microcontroller is impractical for several reasons:

- USB host mode is required — most MCUs have USB device, not host
- Bulk transfer bandwidth exceeds typical MCU USB host throughput
- 2 MSPS of 8-bit I/Q data requires ~4 MB/s sustained memory bandwidth
- Demodulation algorithms (FFT, FIR filtering, FM discriminator) demand floating-point throughput that 100 MHz Cortex-M4F cores cannot sustain at these sample rates

The RTL-SDR is fundamentally an SBC peripheral, not an MCU peripheral.

## SPI/I2C SDR Front-Ends for MCU Integration

For MCU-based projects, dedicated receiver ICs with integrated tuners, ADCs, and demodulators provide a practical alternative. These devices handle the RF front-end and demodulation in hardware, presenting demodulated audio or digital data to the MCU over a simple bus interface.

### Si4732 (Silicon Labs)

The Si4732 is a multiband receiver IC supporting AM (520-1710 kHz), FM (64-108 MHz), and SW (2.3-26.1 MHz) reception. It integrates a complete receiver chain including LNA, mixer, IF filter, and demodulator. The MCU interface is selectable between I2C and SPI.

| Parameter | Value |
|---|---|
| Frequency coverage | AM: 520-1710 kHz, FM: 64-108 MHz, SW: 2.3-26.1 MHz |
| Interface | I2C (up to 400 kHz) or SPI |
| Supply voltage | 2.7 - 5.5V |
| FM sensitivity | 1.5 uV (12 dB SINAD) |
| Audio output | Analog (headphone-level) or digital (I2S) |
| RDS/RBDS | Hardware decoder built in |
| Current draw | ~15 mA (FM receive) |

The Si4732 is controlled through a command/response protocol over I2C or SPI. Each command sends an opcode followed by argument bytes, then the host polls for a response.

```c
#include "stm32f4xx_hal.h"

#define SI4732_I2C_ADDR  (0x11 << 1)  /* A0 pin low; 0x63 << 1 if high */

static I2C_HandleTypeDef hi2c1;

/* Si4732 command opcodes */
#define SI_CMD_POWER_UP    0x01
#define SI_CMD_FM_TUNE     0x20
#define SI_CMD_FM_STATUS   0x22
#define SI_CMD_SET_PROPERTY 0x12
#define SI_CMD_GET_REV     0x10

static void si4732_send_cmd(const uint8_t *cmd, uint8_t len) {
    HAL_I2C_Master_Transmit(&hi2c1, SI4732_I2C_ADDR, (uint8_t *)cmd, len, 100);
    HAL_Delay(1);  /* Allow command processing */
}

static void si4732_read_response(uint8_t *buf, uint8_t len) {
    /* Poll status byte until CTS (bit 7) is set */
    uint8_t status;
    uint32_t start = HAL_GetTick();
    do {
        HAL_I2C_Master_Receive(&hi2c1, SI4732_I2C_ADDR, &status, 1, 100);
        if (HAL_GetTick() - start > 500) return;  /* Timeout */
    } while (!(status & 0x80));

    /* Read full response */
    HAL_I2C_Master_Receive(&hi2c1, SI4732_I2C_ADDR, buf, len, 100);
}

void si4732_power_up_fm(void) {
    /* POWER_UP: FM receive mode, analog audio output */
    uint8_t cmd[] = { SI_CMD_POWER_UP, 0x00, 0x05 };
    /*   arg1: 0x00 = FM receive                     */
    /*   arg2: 0x05 = analog audio output             */
    si4732_send_cmd(cmd, sizeof(cmd));

    uint8_t resp[1];
    si4732_read_response(resp, 1);  /* Wait for CTS */
}

void si4732_tune_fm(uint16_t freq_10khz) {
    /* FM_TUNE_FREQ: frequency in 10 kHz units (e.g., 8850 = 88.5 MHz) */
    uint8_t cmd[] = {
        SI_CMD_FM_TUNE,
        0x00,                          /* No fast tune */
        (uint8_t)(freq_10khz >> 8),    /* Freq high byte */
        (uint8_t)(freq_10khz & 0xFF),  /* Freq low byte */
        0x00                           /* Antenna tuning cap = auto */
    };
    si4732_send_cmd(cmd, sizeof(cmd));

    /* Wait for STC (Seek/Tune Complete) */
    uint8_t status[1];
    uint32_t start = HAL_GetTick();
    do {
        si4732_read_response(status, 1);
        if (HAL_GetTick() - start > 1000) return;
    } while (!(status[0] & 0x01));  /* STC bit */
}

void si4732_set_volume(uint8_t vol) {
    /* SET_PROPERTY: RX_VOLUME (property 0x4000) */
    uint8_t cmd[] = {
        SI_CMD_SET_PROPERTY,
        0x00,
        0x40, 0x00,          /* Property ID: RX_VOLUME */
        0x00, vol             /* Volume 0-63 */
    };
    si4732_send_cmd(cmd, sizeof(cmd));
}
```

The Si4732 requires a 32.768 kHz crystal or external clock reference. The analog audio output can drive headphones directly or feed into an MCU ADC for further processing (e.g., DTMF decoding, signal level monitoring).

### RDA5807M

The RDA5807M is a low-cost single-chip FM receiver covering 50-115 MHz. It communicates over I2C and provides stereo audio output. At $0.30-0.80 in quantity, it is the most economical FM receiver option.

| Parameter | Value |
|---|---|
| Frequency range | 50 - 115 MHz |
| Interface | I2C (sequential or random access) |
| Supply voltage | 2.7 - 3.3V |
| Sensitivity | 1.5 uV (FM, mono) |
| SNR | 55 dB (stereo) |
| Audio output | Analog stereo |
| Current draw | ~20 mA |
| RDS/RBDS | Supported |

The RDA5807M uses a register-based I2C interface. Sequential writes starting at register 0x02 configure the device; sequential reads starting at register 0x0A return status.

## I/Q Sampling Fundamentals

All SDR receivers — from the RTL-SDR to high-end spectrum analyzers — produce I/Q (in-phase/quadrature) sample pairs. Understanding this representation is essential for interpreting SDR data at any level.

A single real-valued sample (as from a standard ADC) captures amplitude but discards phase information. I/Q sampling uses two ADCs clocked 90 degrees apart (or a digital down-converter that achieves the same result), producing a complex-valued signal that preserves both amplitude and phase:

```
Signal at time t:
  I[t] = A(t) * cos(phase(t))
  Q[t] = A(t) * sin(phase(t))

Amplitude = sqrt(I^2 + Q^2)
Phase     = atan2(Q, I)
Frequency = d(phase)/dt
```

For FM demodulation, the instantaneous frequency is the quantity of interest — computed as the derivative of the phase angle between successive I/Q samples. This is why FM demodulation in software reduces to a simple arctangent and differentiation operation.

The RTL-SDR produces 8-bit unsigned I/Q samples (0-255, centered at 128). Converting to signed floating-point for processing:

```c
/* Convert RTL-SDR raw bytes to normalized I/Q floats */
void rtlsdr_convert_iq(const uint8_t *raw, float *i_out, float *q_out,
                       uint32_t num_samples) {
    for (uint32_t n = 0; n < num_samples; n++) {
        i_out[n] = (raw[2 * n]     - 127.5f) / 127.5f;  /* -1.0 to +1.0 */
        q_out[n] = (raw[2 * n + 1] - 127.5f) / 127.5f;
    }
}
```

## SDR Signal Processing Pipeline

A typical SDR receive chain, whether on an SBC or a powerful MCU, follows this sequence:

1. **Tuning** — The RF front-end (R820T2, Si4732, etc.) mixes the desired frequency band down to baseband or a low IF
2. **Sampling** — The ADC digitizes the baseband signal into I/Q samples
3. **Decimation** — A low-pass filter followed by sample rate reduction narrows the bandwidth to the signal of interest (e.g., reducing 2.048 MSPS to 200 kSPS for a single FM channel)
4. **Demodulation** — Extracts the information signal (FM discriminator, AM envelope detector, FSK bit slicer, etc.)
5. **Post-processing** — Audio filtering, squelch, data framing, error correction

For MCU-based SDR (e.g., direct sampling with a fast ADC), steps 1-2 are replaced by direct analog-to-digital conversion at RF frequencies, and all processing happens in firmware. This approach is feasible only for low-frequency signals (HF band, below ~30 MHz) where sample rates remain within MCU ADC capabilities.

## MCU-Based SDR Approaches

Direct-sampling SDR on an MCU eliminates the external tuner IC entirely. The antenna signal feeds directly into a fast ADC, and all frequency selection and demodulation happens in software.

### Requirements and Constraints

| Parameter | Minimum for HF SDR (3-30 MHz) | Typical MCU Capability |
|---|---|---|
| ADC sample rate | 60 MSPS (Nyquist for 30 MHz) | 1-5 MSPS (STM32, ESP32) |
| ADC resolution | 10+ bits | 12 bits typical |
| Processing throughput | ~50 MIPS for basic demod | 100-200 MIPS (Cortex-M4F) |
| RAM for buffers | 8-32 KB | 64-256 KB available |

Standard MCU ADCs (1-5 MSPS) limit direct-sampling SDR to frequencies below approximately 2.5 MHz — sufficient for LF/MF reception (AM broadcast, NDB beacons) but not HF or VHF. Some STM32H7 devices offer 3.6 MSPS ADCs that push this boundary slightly higher.

For higher frequencies, an external high-speed ADC (e.g., AD9226 at 65 MSPS) can feed samples to an FPGA or fast MCU, but this moves well beyond typical MCU integration patterns.

### Software Mixing (Digital Down-Conversion)

When the ADC sample rate is high enough to capture the signal but the MCU cannot process the full-bandwidth stream in real time, digital down-conversion reduces the data rate:

```c
/* Simple digital down-converter for MCU-based SDR */
/* Mixes signal to baseband and decimates by factor R */

#define DECIMATE_FACTOR  16
#define BUFFER_SIZE      1024

/* NCO (numerically controlled oscillator) phase accumulator */
static uint32_t nco_phase = 0;
static uint32_t nco_step;  /* phase increment per sample */

/* Sine/cosine lookup table (256 entries, Q15 format) */
extern const int16_t sin_table[256];
extern const int16_t cos_table[256];

void ddc_init(uint32_t center_freq_hz, uint32_t sample_rate_hz) {
    /* Phase step = (freq / sample_rate) * 2^32 */
    nco_step = (uint32_t)(((uint64_t)center_freq_hz << 32) / sample_rate_hz);
}

void ddc_process(const int16_t *adc_samples, int16_t *i_out, int16_t *q_out,
                 uint32_t num_samples) {
    int32_t i_acc = 0, q_acc = 0;
    uint32_t out_idx = 0;
    uint32_t dec_count = 0;

    for (uint32_t n = 0; n < num_samples; n++) {
        /* Get NCO phase index (top 8 bits of 32-bit accumulator) */
        uint8_t phase_idx = (uint8_t)(nco_phase >> 24);

        /* Mix: multiply input by local oscillator */
        i_acc += ((int32_t)adc_samples[n] * cos_table[phase_idx]) >> 15;
        q_acc += ((int32_t)adc_samples[n] * sin_table[phase_idx]) >> 15;

        nco_phase += nco_step;
        dec_count++;

        if (dec_count >= DECIMATE_FACTOR) {
            i_out[out_idx] = (int16_t)(i_acc / DECIMATE_FACTOR);
            q_out[out_idx] = (int16_t)(q_acc / DECIMATE_FACTOR);
            out_idx++;
            i_acc = 0;
            q_acc = 0;
            dec_count = 0;
        }
    }
}
```

This integrate-and-dump decimator is the simplest approach. A proper CIC (Cascaded Integrator-Comb) filter provides better frequency response without multiplication, making it more efficient on MCUs without hardware multipliers.

## Practical Applications

### ADS-B Reception (1090 MHz)

Aircraft transponders broadcast position and identity on 1090 MHz using pulse-position modulation at 1 Mbps. An RTL-SDR on a Raspberry Pi running `dump1090` can decode these signals with a simple quarter-wave antenna (69 mm wire). Typical reception range is 100-200 km with a clear horizon and a proper ground plane antenna.

### Weather Satellite Imagery (137 MHz)

NOAA weather satellites (NOAA-15, 18, 19) transmit APT (Automatic Picture Transmission) images on 137 MHz as they pass overhead. An RTL-SDR tuned to the satellite's downlink frequency captures the FM-modulated signal, and software (e.g., `noaa-apt`, `WXtoImg`) decodes the image. A V-dipole antenna built from two ~53 cm elements at 120 degrees provides adequate gain for overhead passes.

### 433 MHz ISM Band Monitoring

Many consumer devices — weather stations, tire pressure sensors, remote thermometers, garage door openers — transmit on 433.92 MHz using ASK or FSK modulation. An RTL-SDR with `rtl_433` software decodes hundreds of device protocols automatically, making it useful for reverse engineering or integrating legacy wireless sensors into a modern system.

## SDR Receiver Comparison

| Parameter | RTL-SDR (R820T2) | Si4732 | RDA5807M | Airspy Mini |
|---|---|---|---|---|
| Frequency range | 24-1766 MHz | AM/FM/SW bands | 50-115 MHz | 24-1700 MHz |
| Bandwidth | Up to 2.56 MHz | N/A (channelized) | N/A (single channel) | Up to 6 MHz |
| ADC resolution | 8-bit | Internal (not exposed) | Internal (not exposed) | 12-bit |
| Interface | USB 2.0 | I2C or SPI | I2C | USB 2.0 |
| Host requirement | Linux SBC (Pi 3+) | Any MCU | Any MCU | Linux SBC or PC |
| Output format | Raw I/Q samples | Demodulated audio | Demodulated audio | Raw I/Q samples |
| MCU compatible | No | Yes | Yes | No |
| Power consumption | ~1.5W (5V, 300 mA) | ~50 mW | ~60 mW | ~1.5W |
| Dynamic range | ~48 dB | ~60 dB (estimated) | ~55 dB | ~72 dB |
| Cost | $8-25 | $2-5 | $0.30-0.80 | $99 |
| Best for | Wideband monitoring, ADS-B, NOAA | MCU FM/AM/SW receiver | Low-cost FM reception | High-quality wideband SDR |

The Airspy Mini uses a 12-bit ADC that provides approximately 24 dB more dynamic range than the RTL-SDR — this matters for environments with strong nearby transmitters that would overload the RTL-SDR's 8-bit ADC.

## Tips

- Before purchasing an RTL-SDR for a specific application, verify that the target frequency falls within the R820T2 tuner's range (24-1766 MHz) — the RTL2832U alone has a direct sampling mode that extends down to ~500 kHz, but sensitivity is significantly worse without the R820T2 front-end
- For MCU-based FM reception, the Si4732 or RDA5807M eliminates all DSP complexity — the MCU simply sends tuning commands and reads status; attempting to implement FM demodulation in firmware on a Cortex-M4 is possible but consumes most of the available processing budget
- When using `rtl_sdr` for raw captures, set the gain manually (`-g 40` for ~40 dB) rather than using automatic gain — the AGC reacts slowly and can clip strong signals or fail to amplify weak ones during transient events
- For ADS-B reception, a filtered low-noise amplifier (LNA) at the antenna improves range by 30-50% — the RTL-SDR's noise figure is approximately 3.5 dB, and a 0.5 dB NF LNA with a 1090 MHz bandpass filter placed at the antenna mast reduces the system noise figure to approximately 0.7 dB
- The Si4732 requires a specific power-up sequence (RESET pin low for >10 us, then high, then POWER_UP command within 300 ms) — deviating from this sequence results in the device not responding on I2C

## Caveats

- **RTL-SDR sample drops are silent** — At sample rates above 2.048 MSPS on a Raspberry Pi, the USB subsystem may drop samples without any error indication in the data stream; the resulting gaps produce clicks in audio and corrupt digital demodulation, with no programmatic way to detect the loss
- **The R820T2 tuner has a gap at approximately 1100-1250 MHz** — Sensitivity degrades significantly in this range due to the tuner architecture; applications targeting L-band (GPS at 1575 MHz, Iridium at 1626 MHz) work, but signals in the gap may be unusable
- **MCU direct-sampling SDR at HF frequencies requires careful analog front-end design** — The ADC input must be bandpass-filtered to prevent aliasing, and anti-alias filter design at 30 MHz demands RF-grade components (not generic ceramic capacitors); a poorly filtered front-end aliases strong broadcast stations into the passband
- **The RDA5807M has undocumented I2C address behavior** — Some variants respond at 0x10, others at 0x11, and the sequential access mode (used by most Arduino libraries) behaves differently from random access mode; verifying the I2C address with a bus scanner before writing driver code avoids hours of debugging
- **RTL-SDR dongles vary significantly between manufacturers** — Claimed specifications (frequency range, noise figure, crystal accuracy) differ from measured performance; some units have 50+ ppm frequency error that makes narrowband signal reception unreliable without software frequency correction

## In Practice

- **An RTL-SDR that produces a strong signal at a single frequency regardless of antenna connection** usually indicates the R820T2 tuner oscillator leaking into the signal path — this self-generated spur appears around 28.8 MHz intervals and is a known artifact, not a real signal
- **FM audio from an Si4732 that sounds distorted or clipped at high volume** commonly results from the analog output being overdriven into a low-impedance load — the Si4732's audio output is designed for 16-ohm headphones; connecting it directly to a line-level input or MCU ADC without a resistive divider causes clipping at the output stage
- **RTL-SDR captures that show a DC spike (a strong signal at exactly the center frequency)** are a normal artifact of I/Q imbalance in the RTL2832U — the I and Q paths have slightly different gain and phase, producing a residual carrier at DC; most SDR software suppresses this, but raw captures always show it
- **A weather satellite pass captured by RTL-SDR that produces a clear image on one half but static on the other** usually indicates the antenna has a null in the direction the satellite moved to — APT passes traverse the full sky in ~15 minutes, and a fixed antenna with a narrow elevation pattern loses the signal below approximately 20 degrees elevation
- **MCU-based direct-sampling SDR that receives strong AM broadcast stations but nothing else** typically reveals insufficient ADC resolution for weak signals — strong AM stations near 1 MHz produce signals tens of millivolts at the antenna, while weak signals may be only microvolts, requiring >60 dB of dynamic range that 8-bit or even 10-bit ADCs cannot provide
