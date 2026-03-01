---
title: "Keyword Spotting & Wake Words"
weight: 20
---

# Keyword Spotting & Wake Words

Keyword spotting (KWS) is the task of continuously monitoring an audio stream for a small set of target words — typically 1 to 10 commands — while rejecting all other speech, noise, and silence. It is the foundation of voice-activated systems: the always-on listener that decides whether a full [speech recognition]({{< relref "speech-recognition" >}}) pipeline should activate. The engineering challenge is not classification accuracy in isolation — it is achieving high accuracy while running continuously at microwatt-level power for months on a coin cell or years on a small battery.

The dominant architecture for on-device keyword spotting is the Depthwise Separable CNN (DS-CNN), operating on mel spectrogram features extracted from a rolling window of audio. The model is small (50–100 KB), fast (~20 ms inference on Cortex-M4), and well-suited to the fixed-vocabulary, always-on constraint. Dedicated neural processors like the Syntiant NDP push power consumption even lower, running continuous keyword spotting at ~140 microwatts — two orders of magnitude below a general-purpose MCU.

## DS-CNN Architecture

The DS-CNN (Depthwise Separable Convolutional Neural Network) is the standard architecture for keyword spotting on microcontrollers. It was popularized by Google's work on the Speech Commands dataset and has become the reference model for TinyML audio applications.

### Input Representation

The model input is a mel spectrogram, typically:

- **49 frames** (approximately 1 second of audio at 10 ms hop size, with edge framing)
- **40 mel bins** (covering 0–8000 Hz for 16 kHz sample rate)
- Total input size: 49 x 40 = 1,960 values (1,960 bytes for int8 quantized)

This input representation is produced by the [audio feature extraction]({{< relref "audio-feature-extraction" >}}) pipeline: raw PCM from the microphone is windowed, FFT'd, passed through a mel filterbank, and log-compressed. The spectrogram is treated as a single-channel 2D "image" and processed by convolutional layers.

### Network Structure

A typical DS-CNN for 12-class keyword spotting (10 keywords + silence + unknown):

| Layer | Type | Output Shape | Parameters |
|-------|------|-------------|------------|
| Input | — | 49 x 40 x 1 | — |
| Conv2D | 3x3, 64 filters | 49 x 40 x 64 | 640 |
| BatchNorm + ReLU | — | 49 x 40 x 64 | 256 |
| DepthwiseConv2D | 3x3 | 49 x 40 x 64 | 640 |
| BatchNorm + ReLU | — | 49 x 40 x 64 | 256 |
| Conv2D (pointwise) | 1x1, 64 filters | 49 x 40 x 64 | 4,160 |
| BatchNorm + ReLU | — | 49 x 40 x 64 | 256 |
| (repeat depthwise separable block 3x) | — | — | ~15,000 |
| AveragePool2D | global | 1 x 1 x 64 | — |
| FullyConnected | 64 → 12 | 12 | 780 |
| Softmax | — | 12 | — |

Total parameters: approximately 25,000 (25 KB int8 quantized). Total model size including metadata: approximately 50–80 KB as a TFLite FlatBuffer.

The key insight of depthwise separable convolutions is factoring a standard convolution into a depthwise convolution (one filter per input channel) followed by a pointwise 1x1 convolution (mixing channels). This reduces computation by a factor of roughly 8–9x compared to a standard Conv2D with the same filter count, at a modest accuracy cost (typically 1–2% on Speech Commands).

### Performance

On a Cortex-M4 at 80 MHz with CMSIS-NN optimized kernels (int8 quantized):

- **Inference time:** ~20 ms
- **Model flash:** ~50 KB
- **Tensor arena RAM:** ~22 KB
- **Accuracy on Speech Commands v2 (12-class):** 93–95%

On an ESP32-S3 at 240 MHz with ESP-NN:

- **Inference time:** ~8 ms
- **Model flash:** ~50 KB
- **Accuracy:** same (model-dependent, not hardware-dependent)

## Google Speech Commands Dataset

The Speech Commands dataset is the standard benchmark for keyword spotting research and development:

- **Version 2 (v0.02):** 105,829 one-second utterances of 35 words, recorded by 2,618 speakers.
- **Target words (12-class subset):** "yes", "no", "up", "down", "left", "right", "on", "off", "stop", "go", plus "silence" and "unknown" (all other words).
- **Audio format:** 16 kHz, 16-bit mono WAV files.
- **Train/validation/test split:** approximately 80/10/10%.

The "unknown" class is critical — it represents all speech that is not a target keyword. Without it, the model has no exposure to non-target words and produces high-confidence false triggers on arbitrary speech.

## Always-On Firmware Pattern

The firmware architecture for continuous keyword spotting follows a producer-consumer pattern built around a ring buffer:

### Ring Buffer Design

```
┌──────────────────────────────────────────────────┐
│                   Ring Buffer                     │
│  [sample][sample][sample]...[sample][sample]     │
│       ↑ read pointer              ↑ write pointer │
│       (feature extraction)        (DMA from mic) │
└──────────────────────────────────────────────────┘
```

The ring buffer holds raw PCM samples. DMA from the I2S or PDM microphone peripheral fills the buffer continuously. The buffer size must accommodate the full spectrogram window plus headroom:

```
buffer_size = window_size + hop_size * (num_frames - 1)
            = 400 + 160 * 48
            = 8,080 samples
            = 16,160 bytes (16-bit PCM)
```

In practice, allocating 2x this size provides margin for DMA latency and processing jitter. A 32 KB ring buffer is typical.

### Processing Pipeline

The always-on detection loop operates as follows:

1. **DMA interrupt fires** every hop_size samples (160 samples = 10 ms at 16 kHz).
2. **Feature extraction** computes one mel spectrogram frame from the most recent window_size samples in the ring buffer. This takes approximately 0.3–0.5 ms on a Cortex-M4 (FFT + mel filterbank + log).
3. **Spectrogram buffer update** — the new frame replaces the oldest frame in a circular spectrogram buffer (49 frames x 40 mel bins).
4. **Inference trigger** — every N hops (e.g., every 5 hops = 50 ms), the full spectrogram is passed to the model for inference. Running inference on every hop (10 ms) is unnecessary and wastes power.
5. **Post-processing** — if the model's confidence for a target keyword exceeds a threshold (typically 0.85–0.95), and a smoothing filter confirms detection (e.g., 2 consecutive detections within 500 ms), a keyword detection event is raised.

### Duty Cycle Management

Running inference every 10 ms is wasteful. A typical duty cycle:

- Feature extraction: every 10 ms (must keep up with audio stream)
- Inference: every 50–100 ms (5–10x less frequent)
- Between inference windows, the MCU can enter light sleep (WFI) or reduce clock speed

At 50 ms inference interval with 20 ms inference time, the MCU is active for 20 ms and idle for 30 ms — 40% duty cycle on the inference task alone. Adding feature extraction (0.5 ms every 10 ms = 5% duty cycle) gives a total active duty cycle of approximately 45%.

## Power-Aware Deployment

### Microphone Power

The microphone dominates always-on power in many designs:

| Microphone Type | Typical Current | Notes |
|----------------|----------------|-------|
| Analog MEMS | 100–200 µA | Requires ADC, analog amplifier |
| PDM MEMS | 50–150 µA | Digital output, simple interface |
| I2S MEMS | 500–1000 µA | Higher quality, higher power |

PDM MEMS microphones (e.g., Knowles SPH0645, InvenSense ICS-43434) are the standard choice for always-on KWS. The PDM clock can be as low as 256 kHz for 16 kHz output, keeping dynamic power low.

### System Power Budget

A representative always-on keyword spotting system:

| Component | Current @ 3.3V | Power |
|-----------|----------------|-------|
| PDM MEMS mic | 100 µA | 0.33 mW |
| Cortex-M4 (active, 80 MHz, 45% duty) | ~2 mA average | 6.6 mW |
| Cortex-M4 (sleep, 55% duty) | ~10 µA average | 0.03 mW |
| SRAM retention | ~5 µA | 0.02 mW |
| **Total** | **~2.1 mA** | **~7 mW** |

On a 300 mAh coin cell (CR2032), this gives approximately 6 days of continuous operation. On a 1000 mAh lithium cell, approximately 20 days. These numbers make clear why hardware VAD and dedicated neural processors are attractive — reducing system power by 10–50x extends battery life from days to months.

### Hardware VAD (Voice Activity Detection)

Some microphones and audio codecs include hardware-level voice activity detection:

- **Digital MEMS with integrated VAD** (e.g., Vesper VM3011) — the microphone detects sound energy above a programmable threshold and asserts an interrupt pin. The MCU remains in deep sleep until the VAD triggers. VAD power is ~10 µA.
- **Audio codec with VAD** (e.g., MAX9860, TLV320AIC3204) — on-chip comparator monitors audio energy and generates an interrupt. Useful when the codec is already in the signal path.

The hardware VAD acts as a first-stage gate: it wakes the MCU only when sound is present, reducing average system power to microphone-VAD power (~10–50 µA) plus occasional MCU wake-ups. The false wake rate depends on the environment — quiet rooms are efficient, noisy environments reduce the benefit.

## Syntiant NDP101 and NDP120

Syntiant's Neural Decision Processors are dedicated accelerators designed specifically for always-on audio neural networks. They represent a fundamentally different approach from software KWS on a general-purpose MCU.

### NDP101

- **Architecture:** fixed-function neural network accelerator with a small, tightly coupled DSP core.
- **Power:** ~140 µW during continuous keyword spotting — approximately 50x lower than Cortex-M4 software KWS.
- **Model capacity:** up to ~800 KB model parameters. Supports convolutional and fully connected layers with INT8 or ternary (-1, 0, +1) weights.
- **Interface:** I2S microphone input, SPI host interface. The NDP101 runs the audio front-end (feature extraction) and neural network internally, asserting a wake pin when a keyword is detected.
- **Limitation:** the model architecture is constrained to the NDP101's supported layer types. Not all TFLite models can be compiled for it — the Syntiant TDK (TinyML Development Kit) handles compilation and reports unsupported operators.

### NDP120

- **Architecture:** more flexible than NDP101, with a programmable DSP core alongside the neural accelerator.
- **Power:** 500 µW–1 mW depending on model complexity.
- **Model capacity:** larger models (up to several MB), support for more layer types.
- **Interface:** I2S input, SPI/I2C host interface, supports up to 4 microphones (beamforming capable).
- **Use case:** multi-keyword detection, speaker identification, audio scene classification — applications more complex than simple wake word detection.

### Comparison with Software KWS

| Attribute | Cortex-M4 (Software KWS) | Syntiant NDP101 |
|-----------|--------------------------|-----------------|
| Power (always-on KWS) | 5–10 mW | 0.14 mW |
| Inference latency | 20 ms | <1 ms |
| Model flexibility | High (any TFLite model) | Limited (supported layers only) |
| Development toolchain | Standard TFLite/CMSIS-NN | Syntiant TDK (proprietary) |
| Unit cost | $2–5 MCU | $3–7 NDP + host MCU |
| Battery life (300 mAh) | ~6 days | ~90 days |

The NDP approach requires a separate host MCU (even a simple Cortex-M0+) to handle post-detection logic — networking, display, actuator control. The NDP handles only the always-on listening task. This two-chip architecture is common in production voice-activated devices.

## Training Custom Wake Words

### Data Requirements

Training a reliable wake word detector requires:

- **Positive examples:** 200+ recordings of the target wake word per speaker demographic. For a consumer product, this means 500–2000 total positive examples covering male, female, child, elderly, and accented speech.
- **Negative examples:** thousands of non-target speech clips (other words, sentences, babble noise) and non-speech audio (environmental sounds, music, silence).
- **Noise augmentation:** the single most impactful technique. Every clean recording should be augmented with additive noise (SNR 0–20 dB), room reverberation (convolution with room impulse responses), speed perturbation (0.9–1.1x), and pitch shifting.

### False Accept vs False Reject Trade-off

- **False Reject Rate (FRR):** the fraction of true wake word utterances that the model misses. Target: <5%.
- **False Accept Rate (FAR):** the rate of spurious activations on non-target audio. Target: <1 false accept per hour of continuous operation (for a consumer device).

These metrics trade off against each other via the detection threshold. Lowering the threshold reduces FRR (catches more true positives) but increases FAR (more false triggers). The operating point is typically chosen empirically by sweeping the threshold on a held-out test set and plotting a DET (Detection Error Trade-off) curve.

### Wake Word Design

The choice of wake word significantly affects detection accuracy:

- **Two-syllable words** (e.g., "Hey Snap", "OK Go") outperform one-syllable words (e.g., "Go", "Play") by 2–5x in FAR because they have more phonetic structure for the model to match.
- **Three-syllable words** (e.g., "Alexa", "Computer") are even more distinctive but slower to say.
- **Avoid words phonetically similar to common English words.** A wake word of "Hey Sear" will false-trigger on "hey, so", "hey, sir", and similar phrases.
- **Avoid words that start with common phonemes.** Wake words beginning with "the", "a", or "hey" match more background speech.

## Tips

- Aim for <5% false reject rate at <1 false accept per hour in realistic noise conditions. Test with TV audio, conversation, and ambient noise — not just quiet-room recordings.
- Use data augmentation heavily during training: additive noise (babble, traffic, music at 0–20 dB SNR), reverberation (room impulse responses from the AIR database or simulated), speed perturbation (0.9x–1.1x), and SpecAugment (time and frequency masking on spectrograms).
- One-second windows at 16 kHz are the standard for single-word keyword spotting. Longer windows (1.5–2 seconds) are needed for multi-word wake phrases.
- Overlapping inference windows (running inference every 50 ms with a 1-second spectrogram) improve detection latency at the cost of more inference cycles. Without overlap, a keyword spoken across a window boundary may be split and missed.
- Post-processing with a smoothing filter (e.g., require 2 out of 3 consecutive windows to exceed threshold) dramatically reduces false accepts with minimal impact on false reject rate.
- When collecting custom wake word data, record with the exact microphone and acoustic conditions of the target deployment environment. A model trained on close-talking studio recordings degrades significantly at 2-meter distance in a reverberant room.

## Caveats

- **Real-world noise environments differ dramatically from training data.** A model trained on clean speech plus synthetic noise may fail in a kitchen, car, or factory. In-situ noise recordings from the deployment environment are essential for robust performance.
- **False accept rate increases with continuous operation.** A 0.1% per-inference false accept rate sounds low, but at 20 inferences per second, that is 7.2 false accepts per hour. The per-hour FAR — not the per-inference FAR — is the operationally meaningful metric.
- **Custom wake words need hundreds of positive examples per speaker demographic.** A model trained on 50 recordings from one male speaker will fail on female and child speakers. Speaker diversity in training data is not optional.
- **Two-syllable wake words outperform one-syllable ones significantly.** The phonetic distinctiveness of a two-syllable word provides more discriminative features than a single syllable. Selecting a one-syllable wake word often requires accepting 2–5x higher FAR.
- **The Syntiant NDP toolchain is proprietary and model-constrained.** Not all layer types are supported, and debugging model compilation failures requires Syntiant-specific tooling. The power savings are substantial, but the development flexibility is limited compared to open-source TFLM on a Cortex-M.

## In Practice

- **Keyword detection works in a quiet room but fails in noisy environments.** This commonly appears when training data lacks sufficient noise augmentation. The model learned spectral patterns that are masked by background noise. Retraining with aggressive noise augmentation (SNR as low as 0 dB) and real-world noise recordings from the target environment typically resolves this.
- **Frequent false triggers on specific non-target words.** This shows up as the model confusing phonetically similar words — "four" triggering "forward", or "play" triggering "hey". Adding these confusing words as explicit hard negatives in the training set teaches the model to distinguish them. The smoothing filter (requiring multiple consecutive detections) also helps if the false trigger is a transient event.
- **Detection latency is 1–2 seconds.** This often traces to the inference stride being too large. If inference runs only once per second (every 100 hops), a keyword spoken immediately after the last inference window must wait nearly a full second to be processed. Reducing the stride to 50 ms (every 5 hops) halves the worst-case latency. Alternatively, if inference itself takes >200 ms, the model may be too large for the target MCU — profiling per-operator latency identifies the bottleneck.
- **Battery drains faster than expected.** A common cause is the inference loop running at full rate without duty cycling. If the firmware runs inference on every 10 ms hop (100 inferences/second) instead of every 50–100 ms, the MCU never enters sleep, and power consumption is 3–5x higher than budgeted. Profiling average current draw with a current meter (e.g., PPK2) over 60 seconds reveals whether the MCU is sleeping between inference windows.
- **The NDP101 detects keywords reliably but the host MCU misses the wake interrupt.** This appears when the NDP's interrupt output is too short for the host MCU to catch during deep sleep wake-up. Configuring the NDP interrupt as level-triggered (held until acknowledged) rather than edge-triggered resolves this. The NDP101 datasheet specifies minimum interrupt pulse width and host acknowledgment timing.
