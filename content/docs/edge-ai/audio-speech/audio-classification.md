---
title: "Audio Event Classification"
weight: 40
---

# Audio Event Classification

Audio event classification identifies environmental sounds — not speech — from an audio stream: glass breaking, dog barking, siren wailing, machine operating normally versus abnormally. The task differs from [speech recognition]({{< relref "speech-recognition" >}}) in several important ways: events are often short and non-stationary, multiple events can overlap in time, and the "vocabulary" of sounds is defined by the physical environment rather than a language. The dominant approach is a convolutional neural network operating on mel spectrograms, either trained from scratch for a narrow domain or fine-tuned from a pre-trained model like YAMNet.

Audio event classification has practical applications in security (gunshot detection, glass break detection), industrial monitoring (pump cavitation, bearing wear, compressor fault), smart home (baby crying, doorbell, smoke alarm), and wildlife monitoring (bird species identification, poaching detection). The deployment target ranges from a Cortex-M7 running a small custom model to a Linux SBC running a full YAMNet-based classifier.

## YAMNet

YAMNet (Yet Another Mobile Network) is Google's pre-trained audio event classifier. It uses a MobileNet-v1 backbone operating on mel spectrograms to classify audio into 521 classes from the AudioSet ontology.

### Architecture

- **Input:** log mel spectrogram with 64 mel bins, 25 ms window, 10 ms hop, covering 0.96-second patches (96 frames x 64 mel bins).
- **Backbone:** MobileNet-v1 (depthwise separable convolutions), producing a 1024-dimensional embedding per patch.
- **Classifier head:** fully connected layer mapping 1024 embeddings to 521 AudioSet classes with sigmoid activations (multi-label, not softmax — multiple classes can be active simultaneously).
- **Model size:** approximately 4 MB as a TFLite FlatBuffer (float32). INT8 quantized: approximately 1 MB.

YAMNet processes audio in 0.96-second non-overlapping patches. For a 10-second clip, it produces ~10 independent predictions. The predictions are typically averaged or max-pooled across patches to produce a single label set for the clip.

### Running YAMNet

On a Raspberry Pi 4 (Cortex-A72, 1.8 GHz):

- **Inference latency:** ~30 ms per 0.96-second patch (float32 TFLite), ~15 ms per patch (INT8 quantized)
- **RAM:** ~20 MB for model loading + inference buffer
- **Throughput:** easily real-time (processes audio ~30x faster than real-time)

On a Jetson Orin Nano:

- **Inference latency:** ~5 ms per patch (TensorRT, FP16)
- **Throughput:** ~200x real-time

YAMNet is too large for most microcontrollers in its full form. However, the MobileNet-v1 backbone can be width-multiplied (alpha = 0.25 or 0.5) and retrained for a specific task, producing models small enough for a Cortex-M7 or ESP32-S3. A 0.25-width MobileNet-v1 audio classifier is approximately 100–200 KB (int8) and runs in ~50 ms on an ESP32-S3.

## AudioSet

AudioSet is Google's large-scale audio dataset, serving as the foundation for most audio event classification research:

- **632 classes** organized in a hierarchical ontology (e.g., "Music" → "Musical instrument" → "Guitar" → "Electric guitar")
- **2.1 million 10-second clips** sourced from YouTube, with human-verified labels for a 20,000-clip evaluation set
- **Multi-label:** each clip can have multiple active labels (e.g., "Speech" + "Music" + "Crowd noise")
- **Class imbalance:** common sounds (speech, music) have orders of magnitude more examples than rare sounds (gunshot, glass break)

AudioSet is not a clean, balanced dataset. Label noise is estimated at 10–20% for some classes — human annotators disagree on ambiguous sounds, and some clips are mislabeled. Despite this, pre-training on AudioSet provides strong feature representations that transfer well to domain-specific tasks.

## Transfer Learning from YAMNet

The most effective approach for custom audio classification tasks is transfer learning from YAMNet rather than training from scratch:

### Procedure

1. **Load pre-trained YAMNet** and extract the embedding layer (1024-dimensional output before the final classifier head).
2. **Freeze the backbone** — do not update MobileNet-v1 weights during fine-tuning.
3. **Add a custom classifier head** — a single dense layer with the target number of classes (e.g., 5 classes for "normal operation", "cavitation", "bearing wear", "misalignment", "electrical fault").
4. **Fine-tune** on domain-specific data. Only the classifier head weights are updated.
5. **Optionally unfreeze** the last few convolutional layers of the backbone and fine-tune at a low learning rate (1e-5 to 1e-4) for further accuracy gains.

### Data Requirements

Transfer learning from YAMNet is remarkably data-efficient:

- **50 examples per class** is often sufficient for 90%+ accuracy on clearly distinct sound classes.
- **200+ examples per class** is recommended for sounds that are acoustically similar (e.g., different types of mechanical faults).
- **Data augmentation** extends the effective dataset size: time-shifting, pitch-shifting, additive noise, and SpecAugment (masking random time and frequency bands in the spectrogram) are standard.

### Export for Edge Deployment

After fine-tuning, the model (backbone + custom head) is exported as a TFLite FlatBuffer:

- **Float32 TFLite:** ~4 MB, runs on Pi 4 / Jetson.
- **INT8 quantized TFLite:** ~1 MB, runs on Pi 4 / Jetson with ~2x speed improvement.
- **Reduced-width backbone (alpha=0.25, INT8):** ~100–200 KB, runs on ESP32-S3 or Cortex-M7.

The reduced-width variant sacrifices some accuracy (typically 3–8% drop compared to the full model) but enables microcontroller deployment for applications like always-on anomaly detection.

## Audio Anomaly Detection

Anomaly detection is a distinct paradigm from classification: instead of learning to identify specific fault types, the system learns the "normal" sound profile and flags anything that deviates from it. This approach is valuable when fault examples are rare, expensive, or dangerous to collect.

### Autoencoder Approach

The standard method for audio anomaly detection on embedded systems:

1. **Train an autoencoder** (encoder + decoder) on mel spectrograms of normal operating sound. The autoencoder learns to reconstruct normal spectrograms with low error.
2. **At inference time,** feed the current audio spectrogram to the autoencoder and compute the reconstruction error (mean squared error between input and reconstructed spectrogram).
3. **Threshold the reconstruction error:** normal sounds produce low error; anomalous sounds (which the autoencoder has never seen) produce high error.

The autoencoder architecture for MCU deployment is typically small:

- **Encoder:** 3–4 convolutional layers, reducing spatial dimensions and channel count.
- **Bottleneck:** 16–64 dimensional latent vector.
- **Decoder:** 3–4 transposed convolutional layers, reconstructing the spectrogram.
- **Total model size:** 50–200 KB (int8 quantized). Fits on Cortex-M7 or ESP32-S3.

### Anomaly Score Calibration

The reconstruction error threshold must be calibrated per installation:

- **Collect 30–60 minutes of normal operating audio** at the specific installation site.
- **Compute reconstruction error statistics:** mean and standard deviation over the normal dataset.
- **Set threshold** at mean + 3 to 5 standard deviations (depending on desired sensitivity).
- **Validate** by playing known anomalous sounds (if available) or by introducing controlled faults.

The threshold is not universal — a pump in a quiet room has different background noise characteristics than the same pump model in a noisy factory. Each installation requires its own threshold calibration.

### Alternative: One-Class SVM on Embeddings

Instead of an autoencoder, extract YAMNet embeddings for normal audio and train a One-Class SVM (or Isolation Forest) to define the normal region in embedding space. Anomalies are points that fall outside this region. This approach leverages YAMNet's powerful feature representations without needing to train a full model on domain data. The One-Class SVM itself is tiny (~10 KB) and runs in <1 ms on any platform.

## Industrial Monitoring Applications

Audio-based monitoring detects mechanical and electrical faults through their acoustic signatures:

### Pump Cavitation

Cavitation occurs when vapor bubbles form and collapse in a pump, producing a distinctive crackling or rattling sound. The spectral signature is broadband noise with energy concentrated in the 1–10 kHz range, distinct from the tonal harmonics of normal pump operation. An audio classifier trained on normal vs cavitation can detect onset before vibration sensors register the fault.

### Bearing Wear

Worn bearings produce periodic impulses at characteristic frequencies determined by bearing geometry (BPFO, BPFI, BSF). In the audio domain, these appear as evenly spaced clicks or a grinding tone. A mel spectrogram shows periodic energy bursts at the bearing defect frequency and its harmonics. Models trained to detect these patterns can identify early-stage bearing wear that is not yet audible to a human operator.

### Compressor Fault

Reciprocating and scroll compressors produce characteristic tonal patterns during normal operation. Valve leaks, piston ring wear, and lubrication failures alter the harmonic structure of the sound. Anomaly detection is particularly effective here because normal compressor sound is highly repetitive and predictable — any deviation is suspicious.

### Electrical Arc Detection

Electrical arcs produce broadband noise with a distinctive "buzzing" or "crackling" quality, concentrated in the 2–20 kHz range. Arc detection by audio classification can supplement traditional arc-fault circuit interrupters (AFCIs) in industrial settings where electrical enclosures make direct sensing difficult.

## Preprocessing for Audio Classification

The [audio feature extraction]({{< relref "audio-feature-extraction" >}}) pipeline for audio classification is the same mel spectrogram pipeline used for speech, but parameter choices often differ:

| Parameter | Keyword Spotting | Audio Classification (YAMNet) |
|-----------|-----------------|------------------------------|
| Sample rate | 16 kHz | 16 kHz |
| Window size | 25 ms | 25 ms |
| Hop size | 10 ms | 10 ms |
| Mel bins | 40 | 64 |
| Frequency range | 0–8 kHz | 125–7500 Hz |
| Patch duration | 1 second | 0.96 seconds |
| Log base | ln or log10 | log (natural) |

The higher mel bin count (64 vs 40) provides finer frequency resolution, which helps distinguish sounds with similar spectral envelopes but different harmonic structures (e.g., different machine types). The restricted frequency range (125–7500 Hz) excludes very low-frequency rumble and high-frequency noise that are rarely informative for classification.

## Multi-Label Classification

Many real-world audio scenes contain multiple simultaneous sound events. A factory floor might have a pump, compressor, and ventilation fan all operating at once. A residential scene might have speech, TV audio, and a dog barking simultaneously.

### Sigmoid vs Softmax Output

- **Softmax** (mutually exclusive classes): outputs sum to 1.0. Appropriate when exactly one class is active at a time (e.g., command recognition: the utterance is "left" or "right", never both).
- **Sigmoid** (independent classes): each output is independently between 0.0 and 1.0. Appropriate when multiple classes can be active simultaneously (e.g., "speech" and "music" and "traffic" all present in one clip).

YAMNet uses sigmoid outputs because AudioSet is multi-label. Custom models for industrial monitoring often use softmax (one machine state at a time) or sigmoid (multiple concurrent conditions).

### Per-Class Thresholds

With sigmoid outputs, each class needs its own detection threshold:

- **High-confidence classes** (distinctive sounds like glass breaking) can use a low threshold (0.3–0.5) because the model is rarely uncertain.
- **Low-confidence classes** (ambiguous sounds like "machine noise") may need a higher threshold (0.7–0.9) to avoid false positives.
- Thresholds are tuned on a validation set per class to achieve the desired precision-recall trade-off.

## Deployment Targets

| Platform | Model | Latency (per patch) | RAM | Use Case |
|----------|-------|-------------------|-----|----------|
| Cortex-M7 @ 480 MHz | Custom CNN (100 KB, int8) | 30–60 ms | 50–100 KB arena | Always-on anomaly detection |
| ESP32-S3 @ 240 MHz | MobileNet-v1 0.25x (150 KB, int8) | 40–80 ms | 80–120 KB arena | Industrial monitoring node |
| Raspberry Pi 4 | YAMNet (4 MB, float32) | 30 ms | 20 MB | Multi-class audio classifier |
| Jetson Orin Nano | YAMNet (TensorRT, FP16) | 5 ms | 100 MB | Real-time multi-stream monitoring |

For always-on deployment on MCUs, the duty cycle approach from [keyword spotting]({{< relref "keyword-spotting" >}}) applies: classify a patch every 1 second, sleep between patches. Average power consumption on a Cortex-M7 drops from ~50 mW (continuous) to ~5 mW (10% duty cycle).

## Tips

- YAMNet transfer learning is highly effective with as few as 50 examples per class. Start with transfer learning before considering training from scratch — the pre-trained features capture acoustic patterns that would require thousands of examples to learn independently.
- Mel spectrogram with 64 mel bins and 25 ms windows is YAMNet's default and should be used when fine-tuning from YAMNet. Changing these parameters invalidates the pre-trained weights because the convolutional filters were learned for this specific input format.
- Record training data with the same microphone used in deployment. Different microphones have different frequency responses — a consumer MEMS microphone (e.g., SPH0645) rolls off above 10 kHz and has a resonance peak around 15 kHz, while a measurement-grade condenser microphone has flat response to 20 kHz. Models trained on condenser mic recordings may underperform on MEMS microphone input, especially for sounds with significant high-frequency content.
- For anomaly detection, collect only normal data — the entire point is that fault examples are unnecessary. The autoencoder learns the normal distribution and flags anything outside it. Attempting to collect examples of every possible fault is impractical and defeats the purpose of anomaly detection.
- Use time-domain augmentation (time-shifting, speed perturbation) in addition to spectrogram-domain augmentation (SpecAugment, frequency masking). Time-domain augmentation affects the raw audio before feature extraction, producing more natural-sounding variations.
- When deploying multi-label classification, log the raw sigmoid outputs (not just the thresholded labels) to persistent storage for the first weeks of deployment. This data enables threshold tuning and reveals which classes the model is uncertain about.

## Caveats

- **AudioSet contains label noise.** Approximately 10–20% of labels in the unverified training set are incorrect or incomplete. Transfer learning from YAMNet inherits whatever biases and errors exist in the pre-training data. For safety-critical applications (gunshot detection, smoke alarm detection), validation on a clean, carefully labeled test set is essential.
- **Audio classification accuracy depends heavily on recording conditions.** Microphone type, placement distance, background noise, and room acoustics all affect the mel spectrogram. A model trained in a lab with a condenser microphone 10 cm from the sound source will degrade significantly when deployed with a MEMS microphone 3 meters away in a reverberant room. The acoustic channel between source and microphone is effectively part of the classification problem.
- **Anomaly thresholds need per-installation calibration.** A threshold set at the factory will produce excessive false alarms or missed detections at a different site with different background noise, different room acoustics, or even a different unit of the same equipment model. Each deployment site requires its own baseline recording and threshold calibration.
- **Environmental changes shift the normal baseline.** Seasonal temperature changes alter mechanical resonances and acoustic absorption. Traffic patterns change between day and night. HVAC systems cycle on and off. An anomaly detector calibrated in winter may false-alarm in summer because the background sound profile has shifted. Periodic recalibration (e.g., monthly) or adaptive baseline tracking mitigates this.
- **Multi-label classification is harder to evaluate than single-label.** Standard accuracy metrics (top-1 accuracy) do not apply when multiple labels can be correct. Mean Average Precision (mAP) is the standard metric for multi-label evaluation, but it is less intuitive and requires careful threshold selection per class.

## In Practice

- **Audio classifier works in the lab but fails in deployment.** This commonly appears when the background noise profile at the deployment site differs from the training data. The mel spectrogram shows energy in frequency bands that were quiet during training, confusing the classifier. The fix is recording 1–2 hours of audio at the deployment site, adding it to the training set (labeled as the appropriate background class or "normal"), and retraining. Even 30 minutes of in-situ recordings can dramatically improve deployed accuracy.
- **Anomaly detector triggers constantly after installation.** This often traces to the reconstruction error threshold being set too tight (calibrated on a small, unrepresentative sample of normal operation) or the baseline recording being made during an unrepresentative condition (e.g., baseline recorded at night when the factory is quiet, but the system operates during the day with more background noise). Recording a new baseline during representative operating conditions and recalculating the threshold resolves this.
- **Classification confidence is always low across all classes.** This commonly indicates a microphone frequency response mismatch between training and deployment. If training data was captured with a condenser microphone (flat response to 20 kHz) and deployment uses a MEMS microphone (significant roll-off above 10 kHz, resonance peak near 15 kHz), the mel spectrogram shape differs systematically from what the model expects. Retraining with data from the deployment microphone, or applying a frequency response correction filter, addresses this.
- **Anomaly detector misses a known fault type.** If the fault produces a sound that the autoencoder can reconstruct well (i.e., the fault sound is similar to normal sound in mel spectrogram space), the reconstruction error remains low and the anomaly goes undetected. This is a fundamental limitation of reconstruction-based anomaly detection. The solution is to augment the system with a supervised classifier trained specifically on the missed fault type, or to use a different feature representation (e.g., higher frequency resolution, different mel bin count) that separates the fault from normal in feature space.
- **Multi-label classifier reports too many simultaneous classes.** This appears when per-class thresholds are set too low, or when the model's sigmoid outputs are poorly calibrated (raw sigmoid values do not represent true probabilities). Temperature scaling — dividing logits by a learned temperature parameter before the sigmoid — improves calibration. Alternatively, raising per-class thresholds based on validation set precision targets reduces false positives at the cost of some missed detections.
