---
title: "Audio ADC & DAC"
weight: 30
bookCollapseSection: true
---

# Audio ADC & DAC

Converting between analog audio signals and digital samples is the boundary where microphone voltages become firmware data and where firmware data becomes speaker movement. The quality of this conversion — measured in SNR, THD, and effective number of bits — sets the ceiling for everything downstream. An internal 12-bit SAR ADC on a Cortex-M4 delivers roughly 10 ENOB at audio rates, adequate for voice but nowhere near the 16-bit dynamic range expected for music playback. Dedicated audio converter ICs push SNR past 90 dB but add I2S wiring, clock synchronization, and power supply filtering requirements.

These pages cover analog-to-digital and digital-to-analog conversion specifically for audio applications. General ADC configuration and sampling theory are covered in [Sensor Integration — ADC Configuration & Sampling]({{< relref "/docs/sensor-integration/analog-front-end/adc-configuration-and-sampling" >}}). Analog microphone circuit design is covered in [Analog Microphone Front Ends]({{< relref "/docs/sensor-integration/audio-and-acoustic/analog-microphone-front-ends" >}}).

## Pages

- **[ADC for Audio Capture]({{< relref "adc-for-audio" >}})** — Internal SAR ADC for audio: timer-triggered conversion, ENOB at audio rates, noise floor management, DMA configuration, and comparison with dedicated audio ADCs.

- **[DAC Audio Output]({{< relref "dac-audio-output" >}})** — Internal DAC for audio playback: DMA-driven waveform generation, output buffering, reconstruction filtering, and amplifier ICs.

- **[PWM Audio Output]({{< relref "pwm-audio-output" >}})** — Audio from MCUs without a DAC: PWM frequency selection, LC/RC reconstruction filters, and class-D amplifier basics.

- **[External Audio ADCs & DACs]({{< relref "external-audio-converters" >}})** — Dedicated converter ICs (PCM1808, PCM5102A, CS4344): when to use external vs on-chip, SNR/THD comparison, and power supply filtering.
