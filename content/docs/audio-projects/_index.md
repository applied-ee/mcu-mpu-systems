---
title: "Audio Projects"
weight: 9
bookCollapseSection: true
---

# Audio Projects

Audio on microcontrollers spans a wide range of complexity — from a PWM pin driving a piezo buzzer to multi-channel I2S pipelines feeding real-time DSP chains and streaming over Bluetooth. The common thread is moving audio samples through a system with tight latency constraints, limited memory, and fixed-point arithmetic. A 16-bit stereo stream at 44.1 kHz produces 176,400 bytes per second — fast enough that buffer management, DMA configuration, and interrupt timing dominate the firmware design in ways that lower-bandwidth sensor applications never encounter.

This section covers audio as the primary application: building playback and capture pipelines, processing audio signals in real time, converting between analog and digital domains, handling audio storage formats, and streaming audio over Bluetooth Classic. Protocol-level I2S and PDM coverage lives in [Sensor Integration — Audio & Acoustic]({{< relref "/docs/sensor-integration/audio-and-acoustic" >}}). ML-oriented audio feature extraction (MFCCs, spectrograms) lives in [Edge AI — Audio & Speech]({{< relref "/docs/edge-ai/audio-speech" >}}).

## Sections

- **[I2S Audio Pipelines]({{< relref "i2s-audio-pipelines" >}})** — Building complete audio data paths on MCUs: DMA buffer management, external codec integration, TDM multi-channel audio, and sample rate conversion.

- **[Audio DSP on MCUs]({{< relref "audio-dsp" >}})** — DSP building blocks for resource-constrained processors: fixed-point arithmetic, FIR/IIR filters, FFT spectral analysis, dynamics processing, and audio effects.

- **[Audio ADC & DAC]({{< relref "audio-conversion" >}})** — Analog-to-digital and digital-to-analog conversion through an audio lens: internal ADC/DAC for audio, PWM audio output, and dedicated external converter ICs.

- **[Audio Formats & Storage]({{< relref "audio-formats" >}})** — How audio data is represented, stored, and streamed in embedded systems: PCM/WAV fundamentals, compression codecs, and streaming protocols.

- **[Bluetooth Classic Audio]({{< relref "bluetooth-audio" >}})** — BR/EDR audio profiles for streaming and voice: A2DP, HFP, and AVRCP on ESP32 and similar dual-mode platforms.
