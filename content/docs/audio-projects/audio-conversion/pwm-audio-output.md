---
title: "PWM Audio Output"
weight: 30
---

# PWM Audio Output

Not every MCU has a DAC, but nearly every MCU has a PWM-capable timer. A PWM signal whose duty cycle is modulated by audio sample values, followed by a low-pass filter to remove the carrier frequency, produces an analog audio output. This technique is widely used on Cortex-M0 (no DAC), ATtiny/ATmega, RP2040 (which has PWM but no DAC), and other low-cost MCUs. The quality ceiling is lower than a dedicated DAC — limited by PWM resolution, carrier frequency harmonics, and reconstruction filter design — but for voice prompts, alarms, notification sounds, and simple music playback, PWM audio is a practical zero-cost solution.

## Operating Principle

A PWM timer runs at a carrier frequency (Fc) much higher than the audio bandwidth. Each PWM period, the duty cycle is updated with the next audio sample value. The duty cycle is proportional to the audio amplitude: 50% duty = silence (mid-point), 0% = negative full scale, 100% = positive full scale.

```
Audio sample (Q15) → Scale to PWM range → Update duty cycle register
                                            ↓
                     PWM output pin ────→ Low-pass filter ────→ Speaker/Amp
```

The low-pass filter removes the PWM carrier frequency, leaving only the audio-rate modulation (the baseband audio signal).

## PWM Frequency Selection

The PWM carrier frequency must be high enough that the low-pass filter can separate the audio content from the carrier. The minimum practical carrier frequency depends on the desired audio bandwidth and filter order:

| Audio Bandwidth | Min Carrier (1st-order filter) | Min Carrier (2nd-order) | Recommended |
|---|---|---|---|
| 4 kHz (voice) | 40 kHz | 20 kHz | 62.5 kHz+ |
| 8 kHz (wideband voice) | 80 kHz | 40 kHz | 125 kHz+ |
| 20 kHz (full audio) | 200 kHz | 100 kHz | 250 kHz+ |

Higher carrier frequencies make filter design easier but reduce the PWM resolution — the number of discrete duty cycle levels equals the timer counter period, which is the system clock divided by the carrier frequency.

## PWM Resolution vs Carrier Frequency

This is the fundamental trade-off. For a given system clock, increasing the PWM frequency reduces the number of duty cycle steps:

```
PWM resolution (bits) = log2(system_clock / PWM_frequency)
```

| System Clock | PWM Frequency | Counter Period | Resolution | Effective Bits |
|---|---|---|---|---|
| 48 MHz | 46.875 kHz | 1024 | 10 bits | ~9 ENOB |
| 48 MHz | 187.5 kHz | 256 | 8 bits | ~7 ENOB |
| 168 MHz | 164 kHz | 1024 | 10 bits | ~9 ENOB |
| 168 MHz | 328 kHz | 512 | 9 bits | ~8 ENOB |
| 240 MHz | 234 kHz | 1024 | 10 bits | ~9 ENOB |
| 240 MHz | 937.5 kHz | 256 | 8 bits | ~7 ENOB |

At 48 MHz system clock (typical for Cortex-M0), achieving both 10-bit resolution and a carrier above 44 kHz is borderline. The RP2040 at 125 MHz or 133 MHz provides more headroom.

## Implementation on RP2040

The RP2040 has 8 PWM slices, each with 16-bit counters. For audio output:

```c
/* RP2040 — PWM audio output at ~122 kHz carrier, 10-bit resolution */
#include "hardware/pwm.h"
#include "hardware/dma.h"
#include "hardware/irq.h"

#define AUDIO_PIN       0
#define PWM_WRAP        1023    /* 10-bit resolution */
#define SAMPLE_RATE     48000

static uint16_t audio_buffer[AUDIO_BUFFER_SIZE * 2];
static uint pwm_slice;

void pwm_audio_init(void)
{
    gpio_set_function(AUDIO_PIN, GPIO_FUNC_PWM);
    pwm_slice = pwm_gpio_to_slice_num(AUDIO_PIN);

    pwm_config cfg = pwm_get_default_config();
    pwm_config_set_wrap(&cfg, PWM_WRAP);
    pwm_config_set_clkdiv(&cfg, 1.0f);  /* Full speed */
    pwm_init(pwm_slice, &cfg, true);

    /* Timer interrupt at sample rate to update duty cycle */
    /* ... (timer/DMA setup) */
}

void update_pwm_sample(uint16_t sample)
{
    /* Convert signed 16-bit audio to unsigned 10-bit PWM value */
    uint16_t pwm_val = (sample + 32768) >> 6;  /* Shift to 0–1023 range */
    pwm_set_gpio_level(AUDIO_PIN, pwm_val);
}
```

## Implementation on STM32 (No DAC Variants)

On STM32F0, STM32L0, and other variants without a DAC:

```c
/* STM32 — PWM audio using TIM1, DMA-driven duty cycle updates */
/* TIM1 CH1 as PWM output, TIM2 triggers DMA at sample rate */

/* TIM1 setup: PWM mode, period = 1023 (10-bit) */
htim1.Instance = TIM1;
htim1.Init.Prescaler = 0;
htim1.Init.Period = 1023;  /* 10-bit resolution */
htim1.Init.CounterMode = TIM_COUNTERMODE_UP;
HAL_TIM_PWM_Init(&htim1);

/* DMA transfers audio samples to TIM1->CCR1 at sample rate */
HAL_TIM_PWM_Start_DMA(&htim1, TIM_CHANNEL_1,
                       (uint32_t *)audio_buffer, BUFFER_SIZE);
```

The DMA transfers one value per sample period directly to the capture/compare register (CCRx), updating the duty cycle without CPU intervention.

## Reconstruction Filters

### RC Filter (First-Order)

The simplest reconstruction filter — a resistor and capacitor:

```
  PWM_PIN ── R ──┬── OUTPUT
                 │
                 C
                 │
                GND
```

For a 125 kHz carrier and 8 kHz audio bandwidth:

- R = 1 kΩ, C = 10 nF → fc ≈ 16 kHz (voice)
- R = 1 kΩ, C = 3.3 nF → fc ≈ 48 kHz (wider audio)

A first-order filter provides only 20 dB/decade rolloff, so the carrier frequency must be well above the audio band to achieve adequate suppression. At fc = 16 kHz, a 125 kHz carrier is attenuated by about 18 dB — still audible as a faint whine on sensitive equipment.

### LC Filter (Second-Order)

An inductor-capacitor filter provides 40 dB/decade rolloff with no power loss (unlike RC, which attenuates the signal):

```
  PWM_PIN ── L ──┬── OUTPUT
                 │
                 C
                 │
                GND
```

Typical values: L = 100 µH, C = 100 nF → fc ≈ 50 kHz. This configuration attenuates a 125 kHz carrier by ~16 dB (second-order rolloff), significantly cleaner than the RC filter.

The LC filter is essentially what a class-D amplifier uses on its output — the PWM audio technique is functionally identical to a class-D amplifier driven directly from an MCU pin.

## Class-D Amplifier Basics

A class-D amplifier is an amplified version of PWM audio output: a PWM modulator drives a pair of power MOSFETs in a half-bridge or full-bridge (H-bridge) configuration, followed by an LC output filter. Dedicated class-D amplifier ICs (PAM8403, MAX98357A, TPA3116) integrate the modulator, MOSFETs, and control circuitry — but understanding the MCU PWM-to-speaker path clarifies what these ICs do internally.

For driving small speakers (0.5–3W) directly from an MCU PWM pin, a full-bridge (H-bridge) configuration doubles the voltage swing across the speaker without requiring a bipolar supply:

```
  PWM_A ── R ──┬── Speaker (+)
               │
  PWM_B ── R ──┬── Speaker (-)
```

PWM_A and PWM_B are complementary: when A is high, B is low, and vice versa. The speaker sees a differential voltage that swings from +VCC to -VCC, doubling the effective output power compared to a single-ended connection.

## Tips

- Use the highest system clock available when generating PWM audio — it directly determines the resolution/frequency trade-off. Overclocking the RP2040 to 250 MHz (well within its capability) doubles the available PWM resolution at any given carrier frequency.
- For voice-only applications (4 kHz bandwidth), 8-bit resolution at a carrier above 40 kHz is adequate and imposes minimal CPU/timer load.
- Dithering — adding a small random value (±1 LSB) to each sample before PWM conversion — reduces the tonal quality of quantization noise, converting it to less-objectionable white noise. This is especially effective at 8-bit resolution.

## Caveats

- PWM output pins on most MCUs can source/sink 10–25 mA — not enough to drive a speaker directly. Either use a class-D amplifier IC, or drive the speaker through a MOSFET or transistor buffer.
- The PWM carrier frequency generates EMI. Long wires between the MCU and the reconstruction filter act as antennas. Keeping the filter components close to the MCU pin and using short, direct traces minimizes radiation.
- On MCUs with limited timer channels, using a timer for PWM audio may conflict with other timer-dependent peripherals (servo control, encoder input, other PWM outputs). Verify timer allocation before committing to PWM audio.

## In Practice

- **Audio output has a constant high-pitched whine overlaid on the audio** — the PWM carrier frequency is leaking through the reconstruction filter. Either the filter cutoff is too high, or the carrier frequency is too low (too close to the audio band). Increasing the carrier frequency or adding a second filter stage resolves it.
- **Audio sounds "crunchy" or coarsely quantized** — the PWM resolution is too low. At 8-bit resolution, quantization noise is audible on quiet passages. Increasing the system clock to allow more duty cycle steps, or applying dithering, improves perceived quality.
- **Volume is much quieter than expected from an RC-filtered output** — the RC filter attenuates the audio signal as well as the carrier. At a cutoff of 16 kHz, frequencies above 16 kHz are attenuated, but the overall signal level is also reduced by the resistive voltage divider formed by R and the load impedance. An LC filter or active filter avoids this signal loss.
