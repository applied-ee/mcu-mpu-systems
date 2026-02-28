---
title: "Audio & Acoustic Sensors"
weight: 50
bookCollapseSection: true
---

# Audio & Acoustic Sensors

Sound capture in embedded systems ranges from simple envelope detection for wake-word triggers to high-fidelity audio streaming for recording or real-time processing. The sensor is typically a MEMS microphone (digital PDM or analog output) or a traditional electret capsule with a preamp circuit. The interface complexity depends on the application: a single analog microphone fed into an ADC channel is straightforward, while a PDM microphone array routed through an I2S peripheral with DMA requires careful clock configuration and buffer management. Ultrasonic transducers share many of the same analog front-end concerns but operate above the audible range for distance measurement and object detection.

This subsection covers microphone selection and interfacing, the digital audio bus protocols used to stream audio data, analog front-end design for electret microphones, and ultrasonic transducer integration.

## Pages

- **[MEMS Microphone Selection & Interfacing]({{< relref "mems-microphone-interfacing" >}})** — Analog vs digital MEMS microphones, sensitivity and SNR specifications, PDM output basics, and breakout board integration patterns.
- **[PDM & I2S Audio Interfaces]({{< relref "pdm-and-i2s-audio-interfaces" >}})** — PDM clock and data timing, I2S peripheral configuration, DMA buffer management, and sample rate considerations for audio streaming.
- **[Analog Microphone Front-Ends]({{< relref "analog-microphone-front-ends" >}})** — Electret capsule biasing, preamp circuits, automatic gain control, and ADC sampling strategies for analog audio capture.
- **[Ultrasonic Transducers & Ranging]({{< relref "ultrasonic-transducers" >}})** — Piezoelectric transducer drive circuits, transmit/receive switching, envelope detection, and time-of-flight calculation for ultrasonic ranging.
