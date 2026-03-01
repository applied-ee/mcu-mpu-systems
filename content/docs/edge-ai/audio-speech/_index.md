---
title: "Audio & Speech at the Edge"
weight: 40
bookCollapseSection: true
---

# Audio & Speech at the Edge

Audio and speech processing on edge devices spans an enormous range of complexity — from a 50 KB keyword-spotting model running on a Cortex-M4 microcontroller to a full Whisper speech recognition model requiring gigabytes of RAM and GPU acceleration on a Jetson platform. What unites these applications is the signal processing pipeline that sits between the microphone and the model: raw PCM audio must be windowed, transformed into frequency-domain representations (typically mel spectrograms or MFCCs), and formatted as fixed-size tensors before inference can begin.

The always-on constraint shapes everything in audio edge AI. A wake-word detector must run continuously at microwatt-level power, rejecting background noise and non-target speech thousands of times per second, while catching the target phrase with high reliability. A speech recognition system, by contrast, activates only when triggered and can afford to spend hundreds of milliseconds and significant power on a single utterance. Designing the right pipeline — what runs always-on, what activates on demand, and where the boundary between local and cloud processing falls — determines whether an audio application is practical for battery-powered or thermally constrained hardware.

## What This Section Covers

- **[Audio Feature Extraction for ML]({{< relref "audio-feature-extraction" >}})** — MFCCs, mel spectrograms, windowing and FFT, CMSIS-DSP and ESP-DSP libraries, and streaming vs block-based processing.
- **[Keyword Spotting & Wake Words]({{< relref "keyword-spotting" >}})** — DS-CNN architectures, always-on detection patterns, ring buffer firmware design, power-aware deployment, and Syntiant NDP comparison.
- **[Speech Recognition]({{< relref "speech-recognition" >}})** — Command recognition on MCU vs Whisper on Jetson, CTC and attention decoders, vocabulary and latency trade-offs, and hybrid local-VAD plus cloud-ASR architectures.
- **[Audio Event Classification]({{< relref "audio-classification" >}})** — YAMNet, AudioSet transfer learning, anomaly detection by sound, and industrial monitoring applications.
