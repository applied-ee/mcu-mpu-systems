---
title: "Audio Feature Extraction for ML"
weight: 10
---

# Audio Feature Extraction for ML

Raw PCM audio is a poor direct input to machine learning models. A single second of 16 kHz mono audio produces 16,000 samples — a 16,000-dimensional input vector that contains temporal structure the model cannot easily exploit. Adjacent samples are highly correlated, frequency information is implicit rather than explicit, and the sheer dimensionality demands unnecessarily large models. The standard approach is to transform raw audio into a compact frequency-domain representation — typically a mel spectrogram or a set of MFCCs — that captures the perceptually relevant information in far fewer dimensions.

This preprocessing pipeline is not optional. Every deployed audio ML system — from a 50 KB keyword-spotting model on a Cortex-M4 to a Whisper transformer on a Jetson — relies on some form of spectral feature extraction. Getting the pipeline right, and matching it exactly between training and deployment, is the single most important factor in on-device audio ML accuracy.

## The Standard Audio ML Preprocessing Pipeline

The full pipeline from raw audio to model-ready features follows a well-established sequence:

```
Raw PCM → Pre-emphasis → Windowing → FFT → Power Spectrum →
Mel Filterbank → Log → (Optional DCT for MFCCs)
```

Each stage serves a specific purpose, and skipping or misconfiguring any one of them produces features that the model cannot interpret correctly.

### Pre-emphasis

A first-order high-pass filter applied to the raw signal before windowing:

```
y[n] = x[n] - α * x[n-1]
```

The pre-emphasis coefficient α is typically 0.97. This boosts high-frequency energy relative to low-frequency energy, compensating for the natural spectral tilt of speech (which rolls off at approximately 6 dB/octave). Pre-emphasis improves the signal-to-noise ratio of higher formant frequencies that carry phonetic information.

On microcontrollers, pre-emphasis is a single multiply-subtract per sample — negligible cost. The critical detail is that it must be applied identically during training and inference. Many Python training pipelines apply pre-emphasis implicitly in their feature extraction libraries, and it is easy to forget when reimplementing the pipeline in C.

### Windowing

Audio is processed in short, overlapping frames. Each frame is multiplied by a window function before the FFT to reduce spectral leakage — the artifact that appears when a non-periodic signal is truncated at frame boundaries.

**Window size** determines the time-frequency trade-off:

- **25–30 ms** is the standard for speech processing (400–480 samples at 16 kHz). This duration is short enough that the vocal tract configuration is approximately stationary within a frame, but long enough to capture several pitch periods for accurate spectral estimation.
- **Shorter windows** (10–15 ms) provide better time resolution but worse frequency resolution. Used in some music analysis tasks.
- **Longer windows** (50+ ms) provide better frequency resolution but smear rapid temporal changes. Rarely used for speech.

**Hop size** (stride) is the distance between consecutive frames:

- **10 ms** (160 samples at 16 kHz) is the standard for speech, giving 62.5% overlap with a 25 ms window.
- Larger hop sizes reduce computation but miss rapid temporal changes.
- The number of output frames per second of audio = 1000 / hop_size_ms. At 10 ms hop, one second produces 100 frames.

**Window functions** shape the spectral leakage characteristics:

- **Hann window** — the default for speech ML. Smooth roll-off, good frequency resolution, well-understood behavior. Defined as `w[n] = 0.5 * (1 - cos(2π * n / (N-1)))`.
- **Hamming window** — similar to Hann but with a nonzero floor (0.08 at the edges), producing a slightly narrower main lobe. Used in some legacy MFCC implementations.
- **Rectangular window** (no windowing) — produces severe spectral leakage. Almost never appropriate for ML feature extraction.

CMSIS-DSP provides `arm_hanning_f32()` and `arm_hamming_f32()` for generating window coefficients. The window is typically precomputed once and stored in flash or RAM, then applied as an element-wise multiply on each frame.

### FFT

The windowed frame is transformed to the frequency domain using a real-valued FFT. The output is a complex-valued spectrum of N/2+1 frequency bins, where N is the FFT size.

**FFT size** is typically a power of 2 equal to or larger than the window size:

- **512-point FFT** — the most common choice for 25 ms windows at 16 kHz (400 samples, zero-padded to 512). Frequency resolution = 16000 / 512 = 31.25 Hz per bin. Produces 257 frequency bins.
- **256-point FFT** — used for smaller windows or when computation is tightly constrained. Frequency resolution = 62.5 Hz per bin.
- **1024-point FFT** — finer frequency resolution (15.6 Hz per bin) but more computation. Sometimes used for music or environmental sound classification.

When the window size is smaller than the FFT size, the remaining samples are zero-padded. This interpolates the spectrum (smoother appearance) without adding new frequency information.

**CMSIS-DSP FFT functions:**

- `arm_rfft_fast_f32()` — real-valued FFT for float32 data. Requires an `arm_rfft_fast_instance_f32` structure initialized for the specific FFT size. Performance on Cortex-M4 at 168 MHz: approximately 0.15 ms for a 512-point FFT.
- `arm_rfft_q15()` — fixed-point FFT for Q15 (signed 16-bit fractional) data. Approximately 3–5x faster than the float version on Cortex-M4 without FPU. Requires careful scaling to avoid overflow — each butterfly stage can double the magnitude.
- `arm_rfft_q31()` — fixed-point FFT for Q31 data. Better dynamic range than Q15 but slower.

**ESP-DSP FFT functions:**

- `dsps_fft2r_fc32()` — float32 radix-2 FFT. On ESP32-S3 at 240 MHz, a 512-point FFT takes approximately 0.2 ms.
- `dsps_fft2r_sc16()` — signed 16-bit fixed-point FFT. Faster than float on the original ESP32 (no FPU for single-precision on Xtensa LX6).

### Power Spectrum

The magnitude-squared of each FFT bin:

```
P[k] = Re[X[k]]² + Im[X[k]]²
```

This discards phase information, which is irrelevant for most audio classification tasks. The power spectrum has N/2+1 bins (257 for a 512-point FFT).

Some implementations use the magnitude spectrum (square root of power) or the log-power spectrum directly. The mel filterbank operates on either, but training and inference must match.

### Mel Filterbank

The mel scale maps linear frequency to a perceptually uniform scale. Humans perceive pitch differences logarithmically — the interval between 200 Hz and 400 Hz sounds the same as between 2000 Hz and 4000 Hz. The mel filterbank applies this warping by grouping FFT bins into overlapping triangular filters spaced uniformly on the mel scale.

**Mel scale conversion:**

```
mel(f) = 2595 * log10(1 + f/700)    (HTK formula)
```

The number of mel bins controls the frequency resolution of the output:

- **40 mel bins** — standard for keyword spotting and command recognition. Produces compact features suitable for small models.
- **64 mel bins** — used by YAMNet and some speech recognition models. Better frequency detail.
- **80 mel bins** — used by Whisper and some larger ASR models.
- **128 mel bins** — used in some music analysis applications. Overkill for most speech tasks.

The filterbank is a matrix of shape (num_mel_bins, num_fft_bins). Applying it is a matrix-vector multiply: `mel_energies = filterbank @ power_spectrum`. On MCUs, this operation is often the second most expensive after the FFT itself.

**Implementation detail:** librosa and TensorFlow compute mel filterbanks with slightly different normalization and edge handling. librosa uses the Slaney normalization by default (area normalization of triangular filters), while TensorFlow's `tf.signal.linear_to_mel_weight_matrix` does not. This difference is subtle — typically 1–3 dB variation in specific bins — but enough to degrade model accuracy if the deployment code uses one convention while training used the other.

### Log Compression

The log of mel energies compresses the dynamic range:

```
log_mel = log(mel_energies + epsilon)
```

The epsilon (typically 1e-6 or 1e-10) prevents taking the log of zero. Natural log (ln) and log10 are both used in practice; the choice must match training. Some implementations use `log(1 + mel_energies)` (log1p), which behaves differently near zero.

The output is a **mel spectrogram** — a 2D array of shape (num_frames, num_mel_bins). For one second of audio at 16 kHz with 25 ms windows, 10 ms hop, and 40 mel bins, the mel spectrogram has shape (98, 40) — 3,920 values. This is over 4x more compact than the raw 16,000 PCM samples, while encoding the perceptually relevant frequency content.

### MFCCs (Mel-Frequency Cepstral Coefficients)

Applying a Discrete Cosine Transform (DCT) to the log mel spectrum produces MFCCs:

```
mfcc = DCT(log_mel_energies)
```

The DCT decorrelates the mel bins, concentrating most of the information into the first few coefficients. Typically 13 coefficients are retained (discarding the 0th, which represents overall energy, in some implementations). The result is an even more compact representation — 13 values per frame instead of 40–80 mel bins.

**Delta and delta-delta features** extend MFCCs with temporal dynamics:

- **Delta (velocity):** difference between adjacent frames' coefficients. Captures how the spectrum is changing.
- **Delta-delta (acceleration):** difference between adjacent delta values. Captures the rate of spectral change.
- Appending delta and delta-delta to 13 MFCCs produces 39 features per frame.

MFCCs were the dominant feature representation for speech processing for decades. Modern deep learning models generally prefer mel spectrograms directly — the model learns its own optimal decorrelation. MFCCs remain relevant for small models on constrained MCUs where the 3x dimensionality reduction (40 mel bins to 13 MFCCs) meaningfully reduces model size and inference cost.

## Streaming vs Block-Based Processing

### Block-Based

The simpler approach: collect an entire utterance (e.g., 1 second of audio), compute the full spectrogram, run inference once. Appropriate for:

- Command classification triggered by a button press or VAD
- Audio event classification on recorded clips
- Any application where latency of 1+ seconds is acceptable

### Streaming

For always-on applications like [keyword spotting]({{< relref "keyword-spotting" >}}), features must be computed incrementally from a ring buffer of incoming audio. The firmware maintains a sliding window and computes one frame of features each time the ring buffer advances by one hop:

1. DMA fills a ring buffer with PCM samples from I2S/PDM microphone.
2. When hop_size new samples arrive, extract a window_size chunk from the ring buffer.
3. Apply pre-emphasis, windowing, FFT, mel filterbank, and log.
4. Append the new feature frame to a spectrogram buffer (circular, overwriting the oldest frame).
5. When a complete spectrogram (e.g., 49 frames) is available, run inference.

The ring buffer must hold at least `window_size + hop_size * (num_frames - 1)` samples. For a 49-frame spectrogram with 400-sample windows and 160-sample hops: 400 + 160 * 48 = 8,080 samples = 16,160 bytes at 16-bit PCM.

Streaming introduces overlap management: each new inference shares most of its spectrogram with the previous inference. Only the newest frames are freshly computed. This is the fundamental reason keyword spotting can run continuously — feature extraction cost per inference is one frame, not 49 frames.

## Fixed-Point Implementations

MCUs without a floating-point unit (Cortex-M0, M0+, M3, original ESP32 for double-precision) pay a heavy penalty for float arithmetic. Fixed-point feature extraction uses integer math throughout:

- **Q15 FFT** — 16-bit signed fractional format. Each butterfly stage in the FFT can overflow, so CMSIS-DSP applies a right-shift (scaling) at each stage. The total scaling factor must be tracked and applied to the final output. A 512-point Q15 FFT on Cortex-M4 without FPU runs in approximately 0.03–0.05 ms — 3–5x faster than the float equivalent.
- **Q31 FFT** — 32-bit signed fractional. More headroom for accumulation, less risk of overflow, but slower than Q15.
- **Integer mel filterbank** — the filterbank coefficients and mel energies are kept in Q15 or Q31 format. The matrix multiply uses saturating MAC instructions.
- **Log approximation** — `log()` on fixed-point requires a lookup table or polynomial approximation. CMSIS-DSP does not provide a direct Q15 log function; common approaches use a 256-entry LUT with linear interpolation, accurate to approximately 0.1%.

The accuracy trade-off is real but manageable. A Q15 feature extraction pipeline typically introduces 0.5–1.0 dB of error in mel bin values compared to float32. For keyword spotting and command recognition, this rarely affects classification accuracy if the model was trained on features computed with the same fixed-point pipeline (or with matching quantization noise injected during training).

## Tips

- Match window size, hop size, FFT size, number of mel bins, pre-emphasis coefficient, and log base exactly between training and deployment. Any mismatch — even using ln vs log10 — degrades accuracy.
- Use power-of-2 FFT sizes (256, 512, 1024). Non-power-of-2 FFTs are available in CMSIS-DSP via the mixed-radix `arm_cfft_f32()` but run significantly slower and use more RAM for twiddle factors.
- CMSIS-DSP Q15 FFT is 3–5x faster than float on Cortex-M4 without FPU. On Cortex-M4 with FPU, the advantage narrows to 1.5–2x. On Cortex-M7, float FFT is often faster than Q15 due to the double-precision FPU pipeline and cache effects.
- 40 mel bins is a good default for keyword spotting and command recognition. The model size saving from using fewer bins (20–30) rarely justifies the accuracy loss.
- Pre-compute the mel filterbank matrix and the window function at startup (or store in flash as `const` arrays). Recomputing them per frame wastes cycles.
- For streaming, allocate the spectrogram buffer as a circular 2D array and track the write index. Avoid copying the entire spectrogram on each inference — just update the new column in place.
- When porting a Python training pipeline to C, extract and save intermediate values (windowed frame, FFT output, mel energies, log mel) for a known test input. Compare these numerically against the C implementation at each stage to isolate mismatches.

## Caveats

- **Feature extraction parameter mismatch between training and deployment is the most common cause of poor on-device accuracy.** The model learned to recognize patterns in spectrograms computed with specific parameters. Changing any parameter — even subtly — produces spectrograms the model has never seen.
- **Different libraries compute mel filterbanks differently.** librosa uses Slaney normalization by default; TensorFlow does not. The difference is a per-bin scaling factor that changes the relative magnitude of low-frequency vs high-frequency mel bins. A model trained with librosa features and deployed with TensorFlow-style features will show systematically degraded accuracy on certain sound classes.
- **Pre-emphasis is sometimes applied in training but forgotten in deployment.** Without pre-emphasis, high-frequency mel bins have lower energy than the model expects, making fricative consonants ("s", "f", "sh") harder to distinguish.
- **Q15 fixed-point FFT overflow is silent.** If the input signal exceeds the Q15 dynamic range, saturation produces clipped spectral bins with no error flag. The resulting features look plausible but are wrong. A common safeguard is to right-shift the input signal by 2–4 bits before the FFT.
- **Zero-padding changes the apparent spectral shape.** A 400-sample window zero-padded to 512 produces a slightly different power spectrum than a 512-sample window applied to 512 samples of audio. If training used one convention and deployment uses the other, accuracy suffers.

## In Practice

- **Model works in Python but fails on device.** This almost always traces to a feature extraction mismatch. The diagnostic approach is to save the on-device spectrogram (log mel output) and compare it visually and numerically against the Python spectrogram for the same audio clip. Systematic differences across all mel bins point to a missing pre-emphasis or wrong log base. Differences concentrated in specific mel bins point to filterbank normalization mismatch.
- **FFT output contains unexpected spikes.** This commonly appears when the window function is not applied or is applied with the wrong length. Without windowing, the abrupt frame boundaries create spectral leakage that manifests as broadband energy spread — but with a periodic input, it can produce sharp spectral artifacts at unexpected frequencies. Verifying that the windowed signal tapers smoothly to near-zero at both ends confirms correct windowing.
- **Keyword spotting accuracy degrades over time.** A frequent cause is DC offset drift in the ADC. The microphone's DC bias drifts with temperature, and without pre-emphasis or explicit DC removal, the lowest mel bins accumulate energy that was not present during training. Applying a simple high-pass filter (pre-emphasis or a dedicated DC-blocking filter) before feature extraction prevents this.
- **Feature extraction takes longer than expected on Cortex-M4.** If the FFT alone takes over 1 ms for a 512-point transform, the CMSIS-DSP library may not be using the optimized assembly kernels. Verifying that the build defines the correct `ARM_MATH_CM4` preprocessor symbol and that the FPU is enabled in compiler flags (if using float) resolves this. Without these flags, CMSIS-DSP falls back to portable C implementations that run 3–5x slower.
- **Mel spectrogram shows horizontal bands of constant value.** This often indicates that the log operation is clamping to the epsilon floor — the mel filterbank output for those bins is zero or near-zero. The cause is typically a mel bin range that extends above the Nyquist frequency (8 kHz for 16 kHz audio) or a filterbank configured for the wrong sample rate. Bins above Nyquist receive no FFT energy and produce log(epsilon) for every frame.
