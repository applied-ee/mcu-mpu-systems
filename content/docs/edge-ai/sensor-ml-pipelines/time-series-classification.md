---
title: "Time-Series Classification"
weight: 10
---

# Time-Series Classification

Time-series classification maps a fixed-length window of sensor data to a discrete class label — a gesture type, an activity state, a machine operating condition. The input is a sequence of sensor readings sampled at a known rate, and the output is a categorical decision: swipe left, swipe right, walking, running, bearing fault, normal operation. Unlike image classification where spatial structure is the dominant signal, time-series classification depends on temporal patterns — the shape, frequency content, and evolution of the signal over the window duration.

The fundamental pipeline is: collect a window of N samples from one or more sensor channels, preprocess (normalize, optionally extract features), run inference on the window, produce a class label, advance the window by stride S, repeat. Every design decision — window length, stride, input representation, model architecture — trades off between classification accuracy, latency, and compute budget.

## Sliding Window Approach

The sliding window is the standard mechanism for converting a continuous sensor stream into discrete classification inputs. A window of N samples is collected from the sensor at a fixed sampling rate, and the model classifies that window. The window then advances by stride S samples, and the next classification runs on the new window.

Key parameters:

- **Window length (N)**: The number of samples in each classification input. At a sampling rate of 100 Hz, a window of 128 samples captures 1.28 seconds of data.
- **Stride (S)**: The number of new samples between consecutive windows. Stride determines the classification update rate: at 100 Hz with stride 64, a new classification is produced every 640 ms.
- **Overlap**: N - S samples are shared between consecutive windows. Overlap of 50% (S = N/2) is a common default.

The window length must capture the full duration of the event being classified. For gesture recognition from wrist-mounted IMUs, typical gesture durations range from 0.5 to 2 seconds, so a window of 1.5 to 3 seconds is standard. For human activity recognition (HAR), activities like walking and running have periodic patterns with cycle times of 0.5 to 1.5 seconds, and a window of 2 to 4 seconds captures multiple cycles for reliable classification. For vibration classification on rotating machinery, a window of 0.1 to 1 second at high sampling rates (1 kHz to 25.6 kHz) captures the relevant mechanical frequencies.

The stride controls the trade-off between responsiveness and compute load. A shorter stride produces more frequent classifications (lower latency to detect a new gesture) but requires more inference cycles per second. On a Cortex-M4 running a small 1D-CNN with 5 ms inference time, a stride of 10 ms is feasible. On a resource-constrained system where inference takes 100 ms, the stride must be at least 100 ms to keep up with real-time data.

## Input Tensor Format

The input tensor for a time-series classifier is typically shaped as `(window_length, num_channels)`. For a 3-axis accelerometer sampled at 100 Hz with a window of 128 samples, the input tensor is `(128, 3)` — 128 time steps, each with three values (x, y, z acceleration). For a 6-axis IMU (3-axis accelerometer + 3-axis gyroscope), the tensor is `(128, 6)`.

Multi-sensor fusion extends the channel dimension. A system with a 3-axis accelerometer and a 3-axis magnetometer at the same sampling rate produces a `(128, 6)` tensor. If the sensors have different sampling rates, the higher-rate sensor must be downsampled or the lower-rate sensor interpolated before concatenation.

The data layout in memory matters for inference performance. TensorFlow Lite Micro expects NHWC layout by default. For 1D convolutions, the effective layout is `(1, window_length, num_channels)` — batch size 1, time steps as the "height" dimension, channels as the last dimension. CMSIS-NN kernels in Arm's library expect a specific memory layout for optimal SIMD utilization on Cortex-M processors — mismatched layouts cause silent performance degradation (correct results, but slower than expected).

## 1D-CNN Architecture

One-dimensional convolutional neural networks apply convolution kernels along the time axis, capturing local temporal patterns. A kernel of size 3 applied to accelerometer data learns patterns spanning three consecutive time steps — roughly 30 ms at 100 Hz. Stacking multiple convolutional layers with pooling between them builds a hierarchy of temporal features: the first layer captures short-duration patterns (individual peaks, zero-crossings), deeper layers capture longer-duration patterns (the overall shape of a gesture or gait cycle).

A typical 1D-CNN architecture for MCU deployment:

```
Input: (128, 6)                    # 128 samples, 6 channels (accel + gyro)
Conv1D(16 filters, kernel=7) → BatchNorm → ReLU → MaxPool(2)   # → (64, 16)
Conv1D(32 filters, kernel=5) → BatchNorm → ReLU → MaxPool(2)   # → (32, 32)
Conv1D(64 filters, kernel=3) → BatchNorm → ReLU → MaxPool(2)   # → (16, 64)
GlobalAveragePooling1D                                           # → (64,)
Dense(num_classes) → Softmax                                     # → (num_classes,)
```

This architecture has approximately 30,000–50,000 parameters depending on the number of classes. At int8 quantization, the model size is 30–50 KB — well within the flash budget of a Cortex-M4 with 256 KB or more of flash.

The convolutional layers are the compute bottleneck. On a Cortex-M4 at 80 MHz using CMSIS-NN int8 kernels, the first Conv1D layer (128 time steps × 6 input channels × 16 output filters × kernel 7) requires approximately 860,000 multiply-accumulate (MAC) operations. The full network requires roughly 2–4 million MACs total, completing inference in 3–8 ms depending on clock speed and memory configuration.

## Small 1D-CNN Variants for MCU

For the smallest MCUs (Cortex-M0+, 64 KB flash, 16 KB RAM), the full 1D-CNN above may not fit. Reduced architectures that work in this space:

- **2-layer CNN**: Conv1D(8, kernel=5) → MaxPool(4) → Conv1D(16, kernel=3) → GlobalAvgPool → Dense. Approximately 5,000 parameters, 5 KB int8. Sufficient for 3–5 class problems with clean sensor data.
- **Depthwise separable 1D-CNN**: Replace standard Conv1D with DepthwiseConv1D + PointwiseConv1D. Reduces MACs by a factor of roughly equal to the number of input channels. A depthwise separable variant of the architecture above uses approximately 500,000 MACs instead of 3 million.

On the other end, for SBC-class devices (Raspberry Pi, ESP32-S3 with PSRAM), larger 1D-CNNs with 100,000–500,000 parameters and float32 inference remain practical. These devices have the memory and compute to run models that would not fit on a Cortex-M.

## Alternative Architectures

**Temporal Convolutional Networks (TCN):** Dilated causal convolutions that capture long-range dependencies without pooling. A TCN with dilation factors [1, 2, 4, 8] and kernel size 3 has an effective receptive field of 30 time steps — equivalent to a standard CNN with much deeper stacking. TCNs are parameter-efficient but the dilated convolution operation is not always well-optimized in MCU inference libraries.

**Recurrent Networks (LSTM, GRU):** Process the time series sequentially, maintaining hidden state across time steps. LSTMs capture long-term dependencies naturally, but each time step requires a full matrix multiplication on the hidden state, making inference on MCUs expensive. A single-layer LSTM with 64 hidden units processing 128 time steps requires 128 sequential matrix multiplications — approximately 4 million MACs with no parallelism. For MCU deployment, LSTMs are generally avoided in favor of CNNs.

**Classical ML on Hand-Crafted Features:** Extract statistical features from each window (mean, standard deviation, RMS, peak-to-peak, zero-crossing rate, dominant FFT frequency, spectral entropy) and feed them to a decision tree, random forest, or support vector machine. This approach requires far less compute at inference time (feature extraction + tree traversal vs. millions of MACs for a CNN) and can be deployed on the smallest MCUs. The trade-off is lower accuracy on complex patterns and the engineering effort of manual feature selection.

A random forest with 50 trees and 20 features takes approximately 10 KB of flash and classifies in under 1 ms on a Cortex-M0+ at 48 MHz. For vibration classification where the frequency-domain features are well-understood (bearing defect frequencies, harmonics), classical ML on FFT features often matches or exceeds CNN accuracy while using 10–50x less compute.

## IMU Gesture Recognition

Gesture recognition from inertial measurement units (accelerometer + gyroscope) is one of the most common time-series classification tasks on MCUs. The typical setup: a 6-axis IMU (e.g., LSM6DSO, BMI270, ICM-42688-P) samples at 100–200 Hz, and a 1D-CNN classifies gestures such as swipe left, swipe right, double tap, wrist rotation, and shake.

Design considerations specific to gesture recognition:

- **Trigger detection:** Running continuous inference at every stride is wasteful when the device is idle most of the time. A common approach is a lightweight trigger detector (threshold on accelerometer magnitude or variance) that activates the full classifier only when motion is detected.
- **Window alignment:** The gesture may not start at the beginning of a window. Training with random offsets (data augmentation) makes the model robust to window-gesture alignment mismatch.
- **Rejection class:** Including a "no gesture" or "other" class is essential. Without it, the model is forced to classify every window as one of the gesture classes, producing false positives during non-gesture motion (walking, adjusting the device).

The IMU sampling rate and window length for gesture recognition are typically 100 Hz and 128–256 samples (1.28–2.56 seconds). The gyroscope channels add rotational information that significantly improves discrimination between gestures that have similar acceleration profiles but different rotational components — for example, distinguishing a wrist flick (high gyroscope Z) from a forward push (low gyroscope Z, high accelerometer Y).

## Activity Recognition (HAR)

Human Activity Recognition classifies activities — walking, running, standing, sitting, climbing stairs, cycling — from body-worn or pocket-mounted IMU data. HAR is a well-studied benchmark in the sensor ML community, with public datasets including UCI-HAR, WISDM, and PAMAP2.

The challenge in HAR is the variability across subjects. Walking speed, arm swing amplitude, and sensor placement vary substantially between individuals. Models trained on a single subject achieve 95–99% accuracy on that subject but 70–85% accuracy on unseen subjects. Training on data from 10 or more subjects with diverse body types and movement patterns is the standard approach to building a generalizable HAR model.

Sensor placement affects both the features available and the classification difficulty. Wrist-mounted sensors capture arm swing well (useful for walking vs. running) but poorly capture leg-specific activities (climbing stairs vs. walking on flat ground). Pocket-mounted sensors (hip or thigh) provide better gait information but require the user to consistently carry the device in the same pocket.

A practical HAR system on a wrist-worn device using a Cortex-M4 (e.g., nRF52840):

- IMU: BMI270 at 50 Hz (sufficient for activity recognition; higher rates are unnecessary)
- Window: 256 samples = 5.12 seconds at 50 Hz
- Stride: 128 samples = 2.56 seconds (50% overlap)
- Model: 3-layer 1D-CNN, int8 quantized, ~25 KB
- Inference time: ~4 ms per window
- Power: IMU at 50 Hz draws ~0.5 mA, MCU wakes every 2.56 seconds for ~10 ms of inference

## Vibration Classification

Vibration classification on rotating machinery uses accelerometer data at much higher sampling rates than IMU-based gesture or activity recognition. Mechanical defects produce vibration signatures at characteristic frequencies related to shaft speed, bearing geometry, and gear mesh — these frequencies range from tens of Hz to several kHz, requiring sampling rates of 1 kHz to 25.6 kHz or higher.

Common vibration classification targets:

- **Normal operation**: Baseline vibration signature at shaft and bearing frequencies
- **Imbalance**: Elevated 1x shaft speed frequency (1x RPM)
- **Misalignment**: Elevated 2x and 3x shaft speed harmonics
- **Bearing fault**: Energy at bearing defect frequencies — BPFO (Ball Pass Frequency Outer race), BPFI (Ball Pass Frequency Inner race), BSF (Ball Spin Frequency), FTF (Fundamental Train Frequency)
- **Looseness**: Broadband vibration increase with sub-harmonics (0.5x shaft speed)

For vibration classification, FFT-based features are often more effective than raw time-domain input. The standard approach: compute an FFT over the window, extract spectral features (energy in frequency bands around the characteristic defect frequencies, total RMS, crest factor, kurtosis), and classify using either a small neural network or a random forest.

An ADXL356 (high-g MEMS accelerometer with ±40 g range and bandwidth to 1.5 kHz) or an ADXL1002 (wide-bandwidth accelerometer, ±50 g, bandwidth to 11 kHz) connected to an MCU's ADC via SPI provides the raw vibration data. The ADC sampling rate must be at least 2.5x the highest frequency of interest. For bearing analysis on a machine with a shaft speed of 3000 RPM (50 Hz), bearing defect frequencies can reach 500 Hz, and harmonics of interest extend to 2–3 kHz, requiring a sampling rate of at least 6.4 kHz. A sampling rate of 12.8 kHz or 25.6 kHz provides margin for anti-aliasing and captures higher harmonics.

## Feature Engineering Alternative

For resource-constrained MCUs where even a small 1D-CNN is too large, or where interpretability is important, hand-crafted features fed to a classical classifier are a viable and often superior approach.

Features commonly extracted from each window:

| Feature | Domain | Description |
|---------|--------|-------------|
| Mean | Time | DC offset of the signal |
| Standard deviation | Time | Signal spread |
| RMS | Time | Root mean square — signal energy |
| Peak-to-peak | Time | Maximum minus minimum value |
| Crest factor | Time | Peak / RMS — peakiness of signal |
| Kurtosis | Time | Tailedness of amplitude distribution — sensitive to impulsive events |
| Zero-crossing rate | Time | Frequency estimate from time domain |
| Dominant FFT frequency | Frequency | Highest-energy frequency component |
| Spectral centroid | Frequency | Center of mass of the spectrum |
| Band energy ratios | Frequency | Energy in specific frequency bands / total energy |

These features reduce a window of (128, 6) = 768 values to perhaps 20–40 scalar features. A random forest with 30 trees and max depth 10 operating on 30 features occupies approximately 15–30 KB of flash and completes inference in well under 1 ms on a Cortex-M0+.

The feature engineering approach also enables model interpretability: if the classifier flags a bearing fault, inspection of the input features reveals which frequency band contributed most to the decision — information that a 1D-CNN provides only through post-hoc attribution methods like Grad-CAM adapted for 1D signals.

## Training Pipeline

The training workflow for a time-series classifier follows a standard path:

1. **Data collection**: Record sensor data with labeled activities/gestures/states. Label granularity matters — per-sample labeling is ideal but labeling at the recording level (entire 30-second recording is "walking") is more practical and works with the sliding window approach.
2. **Windowing**: Segment continuous recordings into fixed-length windows with the chosen overlap. Each window inherits the label of its recording.
3. **Train/validation/test split**: Split by recording session or subject, not by window. Splitting by window causes data leakage — overlapping windows from the same recording appear in both train and test sets, inflating accuracy metrics.
4. **Data augmentation**: Random time shifts (varying window alignment), additive Gaussian noise, scaling (simulating different sensor sensitivity), rotation (simulating different mounting orientations). For IMU data, rotation augmentation is particularly important to build orientation invariance.
5. **Training**: Standard supervised learning with cross-entropy loss. Adam optimizer, learning rate 1e-3 to 1e-4, batch size 32–128, 50–200 epochs.
6. **Quantization**: Post-training quantization to int8 using TFLite converter or [quantization-aware training]({{< relref "quantization" >}}) for sensitive models.
7. **Deployment**: Convert to TFLite Micro flatbuffer, integrate with [TFLite Micro runtime]({{< relref "tflite-micro" >}}), verify on-device accuracy against desktop Python pipeline.

## Tips

- Window length should be 1.5–2x the longest event duration to ensure the event is fully captured regardless of window-event alignment. For gesture recognition with gestures up to 1.5 seconds, a window of 2.5–3 seconds provides margin.
- A stride of 50% of the window length (50% overlap) is a good default. Shorter strides increase compute cost without proportional accuracy gains. Longer strides reduce responsiveness and may miss short events.
- Normalize input to zero mean and unit variance using the training set statistics. Compute the per-channel mean and standard deviation across the entire training dataset and store these as constants in firmware. Do not compute statistics from the inference window — this changes the normalization per window and invalidates the model's learned representations.
- For vibration classification, FFT features often outperform raw time-domain input when the relevant physics is well-understood (bearing defect frequencies, gear mesh frequencies). Combine FFT features with a random forest before investing in a 1D-CNN — the simpler approach may be sufficient and uses 10–50x less compute.
- Include a "null" or "other" class in gesture recognition to handle non-gesture motion. Without it, any movement is forced into one of the gesture categories.
- Use [per-operator profiling]({{< relref "profiling-benchmarking" >}}) to identify the compute bottleneck. In most 1D-CNNs, the first convolutional layer dominates inference time because it operates on the full window length before any pooling reduces the temporal dimension.

## Caveats

- Sensor orientation relative to the training data affects accuracy significantly. A model trained with an IMU mounted on the top of the wrist fails when the device is worn on the inside of the wrist — the accelerometer and gyroscope axes are effectively inverted. Building orientation invariance requires either rotation augmentation during training or an orientation-independent feature representation (e.g., acceleration magnitude instead of per-axis values, at the cost of losing directional information).
- Sampling rate mismatch between training and deployment causes silent accuracy degradation. A model trained on 100 Hz data and deployed with a sensor running at 104 Hz (due to oscillator tolerance) sees a window that represents a slightly different time duration, shifting all frequency-domain features. The typical approach is to verify the actual sensor output rate on the deployed hardware and, if necessary, resample to match the training rate.
- Sliding window boundaries can split an event across two consecutive windows, causing misclassification of both windows. Overlapping windows mitigate this but do not eliminate it. Post-processing — requiring N consecutive windows to agree before outputting a label — smooths boundary artifacts at the cost of increased latency.
- Class imbalance biases the model toward the dominant class. In activity recognition, the "idle" or "standing" class often constitutes 60–80% of the training data. The model achieves high overall accuracy by predicting "idle" for everything. Mitigation: class-weighted loss function, oversampling of minority classes, or stratified batching during training.
- Inter-subject variability is the dominant source of accuracy degradation in HAR systems. A model that achieves 98% accuracy on the training subjects may drop to 80% on a new user. Leave-one-subject-out cross-validation during development provides a realistic estimate of generalization performance.

## In Practice

- **Classifier works well in the lab but fails in the field.** The most common cause is sensor mounting orientation mismatch between the training data collection setup and the deployed device. Capturing training data with the sensor in the exact mounting configuration used in deployment eliminates this issue.
- **All predictions are the same class regardless of input.** The model has collapsed to the majority class during training. This indicates severe class imbalance or a learning rate that is too high (the model converges to the trivial solution of always predicting the most common class). A common sanity check is to verify that the training loss actually decreases and that per-class accuracy is reported separately.
- **Accuracy drops when a new user wears the device.** Inter-subject variability is expected. Training on data from 10–20 subjects with diverse body types and movement styles typically brings cross-subject accuracy within 5–10% of within-subject accuracy. On-device personalization (fine-tuning the last dense layer on a few examples from the new user) can close the remaining gap on SBC-class devices.
- **Vibration classifier triggers spuriously during machine startup.** The startup transient produces vibration patterns not seen in the training data (which was collected during steady-state operation). The standard fix is to either add a "startup" class to the training data or suppress classification for the first 10–30 seconds after machine power-on.
- **Classification output oscillates rapidly between two classes.** The window boundary is splitting an event, or the event duration is close to the window length, causing successive windows to capture different portions of the same event. Increasing window length or adding a temporal smoothing filter (majority vote over the last 3–5 predictions) stabilizes the output.
