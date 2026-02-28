---
title: "Analog Microphone Front-Ends"
weight: 30
---

# Analog Microphone Front-Ends

Electret condenser microphones (ECMs) remain relevant in embedded systems despite the rise of MEMS alternatives. ECMs are inexpensive ($0.10-0.50), available in a wide range of form factors (6 mm capsules through large-diaphragm studio types), and produce an analog signal that can be read by any MCU with an ADC channel. The challenge is that the raw output from an ECM is tiny — typically 5-50 mV peak for normal speech — and rides on a DC bias that must be stripped before amplification. A proper analog front-end includes biasing, coupling, preamplification, DC offset for single-supply operation, and anti-alias filtering before the ADC. Each stage has concrete design choices that determine whether the captured audio is clean or buried in noise.

## Electret Condenser Microphone Basics

An ECM capsule contains a permanently charged (electret) diaphragm and a backplate forming a variable capacitor. Sound pressure moves the diaphragm, changing the capacitance and producing a voltage variation. This signal is buffered by a JFET (junction field-effect transistor) integrated inside the capsule, which provides a low-impedance output capable of driving a short cable or PCB trace.

The JFET inside the ECM requires a DC current path to operate. The standard biasing circuit:

```
VCC (3.3V or 5V)
    |
   [R_bias]   2.2 kΩ typical
    |
    +--------- Audio output (AC coupled)
    |
  [ECM capsule]
    |
   GND
```

The bias resistor (R_bias) provides DC current through the JFET drain. The audio signal appears as a small AC voltage variation at the junction of R_bias and the capsule. Typical JFET operating current is 0.2-0.5 mA, making 2.2 kohm appropriate for 3.3V supply (producing approximately 0.7-1.1V DC drop across the resistor and biasing the output at approximately 2.2-2.6V DC).

### Bias Resistor Selection

| VCC | R_bias | Approx DC Bias Point | Notes |
|---|---|---|---|
| 3.3V | 2.2 kohm | ~2.2V | Standard for 3.3V MCU systems |
| 5.0V | 4.7 kohm | ~3.0V | Higher headroom, more common in Arduino circuits |
| 3.3V | 1.0 kohm | ~2.8V | Higher current, lower noise, but reduced headroom |
| 5.0V | 10 kohm | ~2.5V | Lower current, adequate for low-noise capsules |

The exact DC bias voltage depends on the specific capsule's JFET characteristics and varies part-to-part. The goal is to center the output within the linear range of the subsequent amplifier or ADC input.

## Coupling Capacitor

The ECM output contains both a DC bias component (1-3V) and the small AC audio signal (millivolts). A coupling capacitor blocks the DC component and passes only the AC audio signal to the preamp:

```
ECM output ----||---- Preamp input
              C_couple
              (100 nF - 1 uF)
```

The coupling capacitor and the input impedance of the next stage form a high-pass filter with a -3 dB frequency of:

```
f_hp = 1 / (2 * pi * C_couple * R_in)
```

For speech capture (useful bandwidth above 100 Hz), with a preamp input impedance of 100 kohm:

- C_couple = 100 nF: f_hp = 16 Hz (adequate, passes all audio)
- C_couple = 10 nF: f_hp = 160 Hz (cuts low bass, acceptable for voice)
- C_couple = 1 uF: f_hp = 1.6 Hz (unnecessary for audio, slow settling)

A 100 nF ceramic capacitor is the standard choice — small, inexpensive, and provides a cutoff well below the audio band.

## Op-Amp Preamplifier Design

### The Need for Amplification

An ECM capsule produces roughly 5-50 mV peak-to-peak for normal conversational speech at 30-50 cm distance. A 3.3V ADC with 12-bit resolution has an LSB size of approximately 0.8 mV (3.3V / 4096). Without amplification, quiet speech might span only 10-20 ADC codes — barely above the noise floor of the ADC itself. Amplifying the signal to span a significant portion of the ADC range (e.g., 0.5-2.0V peak-to-peak) makes full use of the ADC's dynamic range.

### Non-Inverting Amplifier

The standard audio preamp topology is a non-inverting op-amp amplifier:

```
                    R_f (100 kohm)
                 +---[===]---+
                 |            |
ECM ---||---+--- |-\          |
     C_couple|   |  >---+----+--- Output
             |   |+/    |
             |   |      |
             +---+      |
             |          |
            [R_bias_vg] [R_g]
             |          |
            VCC/2      GND
```

**Gain calculation:**

```
Gain = 1 + (R_f / R_g)
```

| R_f | R_g | Gain | Gain (dB) | Use Case |
|---|---|---|---|---|
| 100 kohm | 10 kohm | 11 | 20.8 dB | Close-mic (< 10 cm) |
| 100 kohm | 4.7 kohm | 22.3 | 26.9 dB | Moderate distance (30-50 cm) |
| 100 kohm | 2.2 kohm | 46.4 | 33.3 dB | Far-field (1-2 m) |
| 100 kohm | 1.0 kohm | 101 | 40.1 dB | Very quiet sources |

For general-purpose voice capture at 30-50 cm, a gain of 20-50 (26-34 dB) is typical. This amplifies a 20 mV peak signal to 0.4-1.0V peak — a comfortable range for a 3.3V ADC.

### DC Biasing for Single-Supply Operation

Op-amps in embedded systems typically operate from a single 3.3V or 5V supply rather than a split +/-supply. The audio signal is AC (swings both positive and negative around zero), but a single-supply op-amp can only output voltages between GND and VCC. The solution is to bias the non-inverting input at VCC/2 (a "virtual ground"), allowing the output to swing symmetrically around VCC/2.

The virtual ground is created with a resistive divider:

```
VCC ----[R1 10 kohm]----+----[R2 10 kohm]---- GND
                         |
                        [C_bypass 10 uF]
                         |
                        GND

Virtual ground = VCC/2 = 1.65V (for 3.3V supply)
```

The bypass capacitor (10 uF) on the virtual ground node is critical — it provides a low-impedance AC ground at audio frequencies, preventing the divider's output impedance (5 kohm) from introducing noise or reducing gain at low frequencies.

### Op-Amp Selection

For audio preamp duty, the op-amp should have:

- Rail-to-rail output (to maximize usable swing on single supply)
- Low input noise voltage (< 15 nV/sqrt(Hz) for decent audio quality)
- Sufficient gain-bandwidth product (GBW > 1 MHz for audio gains up to 100)
- Single-supply operation (down to 2.7V for 3.3V systems)

| Part | GBW | Noise | Supply | Package | Notes |
|---|---|---|---|---|---|
| MCP6001 | 1 MHz | 28 nV/rt(Hz) | 1.8-6.0V | SOT-23-5 | Low cost, widely available |
| OPA344 | 1 MHz | 25 nV/rt(Hz) | 2.5-5.5V | SOT-23-5 | Rail-to-rail, TI |
| OPA2350 | 38 MHz | 5 nV/rt(Hz) | 2.7-5.5V | SOIC-8 | Low noise, dual |
| MAX9814 | N/A | N/A | 2.7-5.5V | TQFN-14 | Complete AGC preamp IC |

For quick prototyping, the Adafruit MAX9814 breakout provides a complete ECM preamp with automatic gain control in a single module — no external component selection required.

## Automatic Gain Control (AGC)

Fixed-gain preamps clip on loud sounds and produce low-level output for quiet sounds. An AGC circuit dynamically adjusts gain to maintain a consistent output level:

1. **Peak detector**: A rectifier (diode + capacitor) tracks the peak amplitude of the preamp output
2. **Comparator / control loop**: Compares the peak level to a reference voltage
3. **Variable gain element**: Adjusts the preamp gain — typically by switching gain resistors or using a voltage-controlled amplifier (VCA)

A simple software-based AGC is often more practical in embedded systems:

```c
#define AGC_TARGET      2048    /* Target level: mid-range of 12-bit ADC */
#define AGC_ATTACK_SHIFT   3   /* Fast attack: divide by 8 */
#define AGC_DECAY_SHIFT    8   /* Slow decay: divide by 256 */

static int32_t agc_gain = 1024;  /* Fixed-point gain, 1.0 = 1024 */

int16_t agc_process(int16_t sample)
{
    /* Apply current gain (fixed-point multiply) */
    int32_t amplified = ((int32_t)sample * agc_gain) >> 10;

    /* Clamp to ADC range */
    if (amplified > 2047)  amplified = 2047;
    if (amplified < -2048) amplified = -2048;

    /* Update gain based on peak level */
    int32_t abs_sample = amplified < 0 ? -amplified : amplified;

    if (abs_sample > AGC_TARGET) {
        /* Signal too loud — reduce gain quickly (attack) */
        int32_t error = abs_sample - AGC_TARGET;
        agc_gain -= error >> AGC_ATTACK_SHIFT;
        if (agc_gain < 64) agc_gain = 64;  /* Minimum gain: ~0.06x */
    } else {
        /* Signal too quiet — increase gain slowly (decay) */
        int32_t error = AGC_TARGET - abs_sample;
        agc_gain += error >> AGC_DECAY_SHIFT;
        if (agc_gain > 16384) agc_gain = 16384;  /* Maximum gain: 16x */
    }

    return (int16_t)amplified;
}
```

The asymmetric attack/decay timing (fast attack, slow decay) prevents clipping on sudden loud sounds while maintaining stable gain during normal speech. Typical attack times are 1-5 ms; decay times are 50-500 ms.

## Anti-Alias Filter Before ADC

Before sampling the amplified audio signal with an ADC, an analog low-pass filter must attenuate frequencies above the Nyquist frequency (half the sample rate). Without this filter, high-frequency noise and signals fold back into the audio band as aliasing artifacts.

### First-Order RC Filter

The simplest anti-alias filter is a single RC low-pass:

```
Preamp output ----[R_aa]----+---- ADC input
                             |
                           [C_aa]
                             |
                            GND
```

For a 16 kHz sample rate (Nyquist at 8 kHz), a reasonable cutoff of 7 kHz:

```
R_aa = 2.2 kohm, C_aa = 10 nF
f_c = 1 / (2 * pi * 2200 * 10e-9) = 7.2 kHz
```

A first-order filter provides only 20 dB/decade rolloff — at 16 kHz (one octave above cutoff), attenuation is only about 6 dB. For basic voice applications, this is often acceptable because the ECM's own frequency response rolls off above 10-15 kHz.

### Second-Order Sallen-Key Filter

For cleaner alias rejection, a second-order Sallen-Key low-pass filter using the same op-amp as the preamp (if a dual op-amp like OPA2350 is used) provides 40 dB/decade rolloff:

```
         R1 (2.2 kohm)    R2 (2.2 kohm)
Input ---[===]--------+---[===]---+--- Output (to ADC)
                      |           |
                    [C1]         |-\
                    22 nF        |  >---+
                      |          |+/    |
                     GND         |    [C2]
                                 |    4.7 nF
                                 |      |
                                GND    GND
```

This provides approximately 7 kHz cutoff with a Butterworth (maximally flat) response using standard component values. At 16 kHz, attenuation is approximately 12 dB — a meaningful improvement over the first-order filter.

## ADC Sampling for Audio

### Sample Rate Selection

The Nyquist theorem requires sampling at more than twice the highest frequency of interest. For audio:

| Application | Bandwidth | Minimum Sample Rate | Recommended Sample Rate |
|---|---|---|---|
| Voice command / keyword | 300-4000 Hz | 8 kHz | 16 kHz |
| Wideband voice | 100-8000 Hz | 16 kHz | 16-22 kHz |
| Music / full audio | 20-20000 Hz | 40 kHz | 44.1-48 kHz |
| Ultrasonic detection | Up to 80 kHz | 160 kHz | 192 kHz+ |

### Timer-Triggered ADC Conversion

For consistent sample timing, the ADC should be triggered by a hardware timer rather than polled in a software loop. Jitter in sample timing introduces noise — even 1 us of jitter at 16 kHz sampling produces measurable distortion.

```c
/* STM32 HAL — Timer-triggered ADC for audio sampling at 16 kHz */
#include "stm32f4xx_hal.h"

extern ADC_HandleTypeDef hadc1;
extern TIM_HandleTypeDef htim3;
extern DMA_HandleTypeDef hdma_adc1;

static uint16_t adc_buffer[ADC_BUF_SIZE];  /* DMA destination */

void audio_adc_init(void)
{
    /* Timer 3 configured for 16 kHz trigger rate */
    /* Assuming 84 MHz APB1 timer clock:          */
    /* Prescaler = 0, Period = (84e6 / 16000) - 1 = 5249 */
    htim3.Instance = TIM3;
    htim3.Init.Prescaler = 0;
    htim3.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim3.Init.Period = 5249;
    htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    HAL_TIM_Base_Init(&htim3);

    /* Configure timer TRGO to trigger ADC */
    TIM_MasterConfigTypeDef master_cfg = {0};
    master_cfg.MasterOutputTrigger = TIM_TRGO_UPDATE;
    master_cfg.MasterSlaveMode = TIM_MASTERSLAVEMODE_DISABLE;
    HAL_TIMEx_MasterConfigSynchronization(&htim3, &master_cfg);

    /* ADC configured for external trigger from TIM3 TRGO */
    ADC_ChannelConfTypeDef adc_ch_cfg = {0};
    adc_ch_cfg.Channel = ADC_CHANNEL_0;
    adc_ch_cfg.Rank = 1;
    adc_ch_cfg.SamplingTime = ADC_SAMPLETIME_15CYCLES;
    HAL_ADC_ConfigChannel(&hadc1, &adc_ch_cfg);
}

void audio_adc_start(void)
{
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buffer, ADC_BUF_SIZE);
    HAL_TIM_Base_Start(&htim3);
}

void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Process first half of adc_buffer */
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Process second half of adc_buffer */
}
```

### ADC Resolution and Dynamic Range

A 12-bit ADC provides 72 dB of theoretical dynamic range (6.02 dB per bit). With the preamp gain set to map normal speech to ~50% of the ADC range, the effective dynamic range for audio is approximately 60-65 dB — adequate for voice capture but marginal for music. Using an MCU with a 16-bit ADC (e.g., STM32L4 series) increases the theoretical dynamic range to 96 dB.

The ADC's own noise floor also matters. Many MCU ADCs achieve only 10-11 effective number of bits (ENOB) despite being marketed as 12-bit. Measuring ENOB by sampling a known signal and computing the SINAD (signal-to-noise-and-distortion ratio) reveals the actual usable resolution.

## Tips

- Use a dual op-amp package (e.g., OPA2350, MCP6002) — one half for the preamp, the other for the anti-alias filter — to minimize component count and PCB area
- Place the coupling capacitor and preamp as close to the ECM capsule as possible to minimize the length of the low-level analog signal trace
- For quick prototyping, a MAX9814 breakout provides a complete ECM front-end with AGC — connect output directly to ADC and focus on firmware development
- Add a series resistor (100-470 ohm) between the preamp output and the ADC input pin to limit current during ESD events and to help isolate the ADC's internal sample-and-hold capacitor from the op-amp output
- Always measure the actual DC bias point at the ADC input with a multimeter before enabling the ADC — an unexpected bias voltage (too close to GND or VCC) indicates a wiring or component error that will clip the audio signal

## Caveats

- **VCC/2 bias settling time** — The virtual ground circuit (resistive divider + bypass capacitor) takes several RC time constants to settle after power-on. With 10 kohm divider resistors and a 10 uF bypass capacitor, settling time is approximately 150-300 ms. Audio captured during this period contains a decaying DC transient
- **Op-amp output cannot reach the rails** — Even "rail-to-rail" op-amps lose 50-100 mV at each rail. On a 3.3V supply, the usable output swing is approximately 0.1V to 3.2V. Setting the gain too high causes clipping well before the signal reaches the theoretical limits
- **Electrolytic coupling capacitors introduce distortion** — Aluminum electrolytic capacitors have voltage-dependent capacitance that produces harmonic distortion at audio frequencies. Ceramic (MLCC) or film capacitors are strongly preferred for coupling and filtering in the audio signal path
- **Ground loops between microphone and MCU** — If the ECM ground return path is different from the ADC ground reference, the voltage difference between the two ground points appears as noise in the captured audio. A star-ground topology or a ground plane eliminates this
- **ADC input impedance interacts with the anti-alias filter** — The internal sample-and-hold capacitor of the ADC (typically 5-15 pF) draws current spikes during sampling. If the anti-alias filter's output impedance is too high (> 10 kohm), the capacitor charging distorts the sampled voltage. Keeping the filter output impedance below 1 kohm avoids this issue

## In Practice

- An ECM preamp that works cleanly on the bench but produces buzzing when installed in an enclosure with a switching regulator points to supply noise coupling — adding a ferrite bead and 10 uF capacitor between the regulator output and the preamp VCC pin typically resolves it
- Audio that clips on the positive rail but not the negative (or vice versa) indicates the DC bias point is not centered at VCC/2 — the preamp output swings asymmetrically, hitting one rail before the other. Measuring the DC voltage at the ADC input pin with no audio present should read within 100 mV of VCC/2
- A subtle 50/60 Hz hum in captured audio that disappears when the board is battery-powered (disconnected from a USB supply) is almost always a ground loop between the USB host and the audio circuit — powering the board from a wall adapter or adding a USB isolator eliminates the path
- Replacing a ceramic coupling capacitor with an electrolytic of the same value and observing increased harmonic distortion (visible as extra peaks in an FFT) demonstrates the nonlinear capacitance effect — the ceramic capacitor should be restored
- Tapping or vibrating the PCB near the ECM capsule and observing large spikes in the ADC output confirms that mechanical vibration is coupling into the microphone — mounting the capsule on a foam or silicone gasket reduces this microphonic sensitivity
