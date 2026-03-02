---
title: "Audio Codec Integration"
weight: 20
---

# Audio Codec Integration

An external audio codec IC combines an ADC, DAC, headphone/speaker amplifiers, microphone preamplifiers, and analog mixing — all controlled through a digital register interface. The MCU connects to the codec over two separate buses: I2S (or TDM) for audio data, and I2C (sometimes SPI) for configuration and control. Getting both buses configured correctly, with the right clock relationships and power-up sequence, is the core integration challenge. The audio data path is straightforward once the codec is properly initialized; most integration failures trace back to clock misconfiguration or incorrect register settings during startup.

## Common Codec ICs

| Codec | ADC | DAC | Amp Output | I2C Addr | Typical Application |
|---|---|---|---|---|---|
| WM8960 | 24-bit stereo | 24-bit stereo | Headphone + speaker (1W) | 0x1A | Dev boards (Teensy Audio, many ESP32 boards) |
| SGTL5000 | 24-bit stereo | 24-bit stereo | Headphone (62 mW) | 0x0A | Teensy Audio Shield, portable audio |
| ES8388 | 24-bit stereo | 24-bit stereo | Headphone (40 mW) | 0x10 | ESP32 audio boards (ESP32-LyraT, AI-Thinker) |
| MAX98357A | None | I2S input only | Speaker (3.2W class-D) | None (no I2C) | Simple I2S-to-speaker, no control bus |
| PCM5102A | None | 32-bit stereo | Line-level output | None (no I2C) | High-quality DAC, zero-config I2S input |
| TLV320AIC3104 | 24-bit stereo | 24-bit stereo | Headphone (31 mW) | 0x18 | Professional/industrial audio, BeagleBone |

Codecs without I2C (MAX98357A, PCM5102A) are the simplest to integrate — they accept I2S data and produce analog output with no configuration required. The trade-off is no runtime control over volume, EQ, or input selection.

## Clock Architecture

Audio codecs require a master clock (MCLK) in addition to the I2S bit clock (BCLK) and word select (WS/LRCK). The MCLK drives the codec's internal sigma-delta converters and must be a precise multiple of the audio sample rate:

| Sample Rate | MCLK (256x) | MCLK (384x) | BCLK (stereo 16-bit) | BCLK (stereo 32-bit) |
|---|---|---|---|---|
| 8 kHz | 2.048 MHz | 3.072 MHz | 256 kHz | 512 kHz |
| 16 kHz | 4.096 MHz | 6.144 MHz | 512 kHz | 1.024 MHz |
| 44.1 kHz | 11.2896 MHz | 16.9344 MHz | 1.4112 MHz | 2.8224 MHz |
| 48 kHz | 12.288 MHz | 18.432 MHz | 1.536 MHz | 3.072 MHz |

The 256x MCLK ratio is the most common default. The 44.1 kHz and 48 kHz sample rate families require different base clocks (multiples of 11.2896 MHz vs 12.288 MHz), which is why many codec boards include a dedicated crystal oscillator.

### MCLK Generation Options

**MCU clock output pin** — STM32 MCO pins, ESP32 I2S MCLK output, and nRF52 PWM/timer outputs can generate MCLK. The challenge is generating exact audio frequencies from the MCU's PLL, which typically derives from a non-audio crystal (8 MHz, 16 MHz, 25 MHz). STM32 SAI peripherals include a dedicated PLL (PLLSAI1/PLLSAI2) that can produce exact 11.2896 MHz or 12.288 MHz clocks. ESP-IDF v5.x I2S driver generates MCLK from the APLL (Audio PLL), which can synthesize exact audio clocks.

**Codec internal PLL** — Most codecs (WM8960, ES8388, TLV320AIC3104) include an internal PLL that can derive MCLK from BCLK or an external reference. This simplifies the MCU side — only BCLK and WS need to be generated — but adds jitter from the PLL. For the WM8960, the PLL is enabled by setting register R4 (Clocking 1) and configured through registers R52–R54.

**External oscillator** — A dedicated 12.288 MHz or 11.2896 MHz crystal oscillator on the codec board eliminates clock generation concerns entirely. Many codec breakout boards include this, making MCLK a non-issue at the cost of being locked to one sample rate family.

## I2C Register Configuration

Codec initialization involves writing a sequence of register values over I2C. The exact sequence is codec-specific and often poorly documented — the datasheet provides register descriptions but rarely a complete initialization example. Working configurations are typically derived from reference drivers, evaluation board code, or community examples.

### WM8960 Initialization Example

```c
/* WM8960 — minimal stereo playback initialization */
typedef struct {
    uint8_t reg;
    uint16_t val;
} codec_reg_t;

static const codec_reg_t wm8960_init[] = {
    {0x0F, 0x000},  /* Reset — write any value to register 0x0F */
    {0x19, 0x0C8},  /* Power 1: VMID=50k divider, VREF on */
    {0x1A, 0x1F8},  /* Power 2: DACL, DACR, LOUT1, ROUT1, speaker on */
    {0x2F, 0x00C},  /* Power 3: LMIC, RMIC on (if recording) */
    {0x04, 0x000},  /* Clocking 1: MCLK input, divider=1 */
    {0x07, 0x002},  /* Audio Interface: I2S format, 16-bit, slave mode */
    {0x0A, 0x0FF},  /* Left DAC volume: 0 dB */
    {0x0B, 0x1FF},  /* Right DAC volume: 0 dB, update both */
    {0x02, 0x079},  /* LOUT1 volume: 0 dB */
    {0x03, 0x179},  /* ROUT1 volume: 0 dB, update both */
    {0x22, 0x100},  /* DAC left to left mixer */
    {0x25, 0x100},  /* DAC right to right mixer */
};

void wm8960_init_playback(i2c_port_t i2c_num)
{
    for (int i = 0; i < sizeof(wm8960_init) / sizeof(wm8960_init[0]); i++) {
        uint8_t data[2];
        data[0] = (wm8960_init[i].reg << 1) | ((wm8960_init[i].val >> 8) & 0x01);
        data[1] = wm8960_init[i].val & 0xFF;
        i2c_master_write_to_device(i2c_num, 0x1A, data, 2, pdMS_TO_TICKS(100));
    }
}
```

The WM8960 uses a 7-bit register address and 9-bit data value packed into two bytes — the register address occupies bits [15:9] and the data occupies bits [8:0]. This non-standard I2C register format is a common source of errors when porting between codec families.

## Power-Up Sequencing

Audio codecs contain sensitive analog circuits (charge pumps, reference voltages, amplifier bias) that must be enabled in a specific order to avoid audible pops and to protect the output stage. The general pattern:

1. **Apply power supply voltages** — AVDD, DVDD, and DBVDD must be stable before any I2C communication.
2. **Hold reset** — Many codecs have a hardware reset pin. Hold it low for at least 1 ms after power rails stabilize.
3. **Release reset and wait** — The codec initializes internal registers. Wait 10–50 ms (codec-specific).
4. **Configure via I2C** — Write all register values while outputs are muted.
5. **Enable VMID / reference voltage** — This charges the VMID decoupling capacitor. The WM8960 datasheet specifies waiting for the VMID voltage to settle (10–100 ms depending on capacitor size).
6. **Enable DAC, mixer, and output stages** — In sequence, with brief delays between stages.
7. **Unmute** — Remove the soft-mute on DAC and output amplifiers as the final step.

Skipping or reordering these steps produces pops, clicks, or in some cases damaged output drivers (driving a speaker amplifier before the reference voltage is stable can rail the output).

## Master vs Slave Mode

In **slave mode** (most common), the MCU generates BCLK, WS, and MCLK. The codec receives these clocks and synchronizes its converters to them. This gives the MCU full control over timing but requires the MCU to generate precise audio clocks.

In **master mode**, the codec generates BCLK and WS from its MCLK input (or internal PLL). The MCU's I2S peripheral runs as a slave, locking to the codec's clocks. This is useful when the MCU cannot generate sufficiently accurate audio clocks — the codec's crystal-locked oscillator produces lower-jitter clocks than a software PLL.

The mode is selected through both the codec's I2C registers and the MCU's I2S peripheral configuration. A mismatch (both configured as master, or both as slave) results in either silence or noise.

## Tips

- Start with the codec vendor's evaluation board software or reference driver — deriving a working register sequence from the datasheet alone is time-consuming and error-prone.
- Verify I2C communication works before debugging audio — read a known register (device ID or reset-default value) as a sanity check.
- Use a logic analyzer on MCLK, BCLK, WS, and SD simultaneously to verify clock relationships. A BCLK that is not an exact integer multiple of WS frequency indicates a misconfigured clock divider.
- When using the codec's internal PLL, check the lock status register (if available) before enabling audio output.

## Caveats

- The WM8960's 9-bit register format means standard I2C register read-back does not work — reading a register returns the current value in a codec-specific format that differs from the write format. Some drivers maintain a shadow register array to track the current state.
- ES8388 and SGTL5000 have different default states after reset — the ES8388 powers up with most blocks disabled, while the SGTL5000 enables the charge pump by default. A working init sequence for one codec will not transfer to another.
- Codecs with class-D speaker outputs (WM8960 speaker mode) require specific output filter components. Connecting a speaker without the recommended LC filter produces audible high-frequency switching noise.
- MCLK jitter directly translates to audio jitter (increased noise floor). Generating MCLK from a general-purpose timer or PWM output typically produces more jitter than using a dedicated audio PLL or external oscillator.

## In Practice

- **No audio output despite correct I2S data** — commonly caused by the codec still being in reset (hardware reset pin held low), the output mixer not being routed (DAC output not connected to the headphone or speaker amplifier in the mixer registers), or the output being muted by default.
- **Audio plays but with a loud pop on startup** — indicates the power-up sequence is not following the codec's recommended order. The VMID charge-up step is most commonly skipped or given insufficient settling time.
- **Audio at the wrong pitch (too fast or too slow)** — the MCLK-to-sample-rate ratio is incorrect. If the codec expects 256x MCLK and receives 384x (or vice versa), the sample rate shifts proportionally. This also occurs when the codec's internal PLL multiplier does not match the actual MCLK frequency.
- **Buzzing or whining noise on the audio output** — frequently traced to inadequate power supply decoupling on AVDD. Audio codecs are sensitive to power supply noise; the analog supply requires dedicated filtering (ferrite bead + 10 uF ceramic + 100 nF ceramic close to the pin).
