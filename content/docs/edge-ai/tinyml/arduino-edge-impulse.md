---
title: "Arduino & Edge Impulse"
weight: 30
---

# Arduino & Edge Impulse

Edge Impulse is an end-to-end development platform for embedded machine learning. It provides a web-based Studio interface that covers the entire pipeline: data collection from physical sensors, signal processing configuration, neural network training, model validation, and deployment as a compiled library for Arduino, ESP32, STM32, Nordic nRF, and other microcontroller targets. The platform abstracts much of the complexity of quantization, memory fitting, and operator optimization, making it possible to go from raw sensor data to a running inference on an Arduino Nano 33 BLE Sense or an ESP32-S3 DevKit without writing any training code or manually configuring TensorFlow Lite.

The trade-off is control. Edge Impulse makes decisions about preprocessing, model architecture, quantization, and memory layout that a manual TFLM pipeline (see [TensorFlow Lite Micro]({{< relref "tflite-micro" >}})) leaves to the developer. For rapid prototyping, classroom projects, and applications where time-to-deployment matters more than extracting every last byte of performance, Edge Impulse is highly effective. For production firmware where every kilobyte of flash and every millisecond of latency must be controlled, the manual pipeline offers more flexibility.

## End-to-End Workflow

The Edge Impulse workflow is a sequential pipeline of six stages. Each stage's output feeds the next, and the Studio interface provides visualization and validation tools at each step.

### Stage 1: Data Collection

Data collection is the foundation of the pipeline. Edge Impulse provides multiple paths for getting sensor data into the platform:

- **Device firmware**: Flash the Edge Impulse data collection firmware onto a supported device (Arduino Nano 33 BLE Sense, ESP-EYE, ST IoT Discovery Kit, etc.). The firmware streams sensor data (accelerometer, microphone, light sensor, camera) directly to the Studio over USB or Wi-Fi.
- **Phone**: The Studio generates a QR code that opens a web-based data collection tool in a smartphone browser. The phone's accelerometer, microphone, and camera can record samples and upload them to the project. This is useful for quick data collection without dedicated hardware.
- **CSV/WAV upload**: Existing datasets can be uploaded as CSV files (for time-series data like accelerometer or temperature) or WAV files (for audio). The Studio parses the format and segments the data into samples.
- **API ingestion**: A REST API accepts data programmatically, enabling batch upload from existing data pipelines or automated collection scripts.

Each sample is labeled with a class name (e.g., "wave", "idle", "circle" for gesture recognition, or "yes", "no", "noise" for keyword spotting). The Studio displays per-class sample counts, total duration, and sensor statistics to help identify imbalanced datasets early.

A common guideline for audio classification: at least 3 minutes of data per class, with samples collected in the environments where the model will be deployed. For accelerometer-based gesture recognition: at least 50 samples per class, each 1–2 seconds long, collected at the same orientation and mounting position as the deployment device.

### Stage 2: Impulse Design

An "impulse" in Edge Impulse terminology is the combination of a processing block and a learning block. The impulse defines how raw sensor data is transformed into features and how those features are classified.

#### Processing Blocks

Processing blocks transform raw time-series or image data into feature vectors:

| Block | Input | Output | Typical Use |
|-------|-------|--------|-------------|
| **Spectral Analysis** | Audio waveform | FFT power spectrum per window | Keyword spotting, sound classification |
| **MFE (Mel Filterbank Energies)** | Audio waveform | Mel-scale filterbank energies | Speech-related tasks, environmental sound |
| **Spectrogram** | Audio waveform | Full spectrogram image | Audio tasks requiring fine frequency resolution |
| **Image** | Camera frame | Resized + cropped RGB/grayscale | Image classification, object detection |
| **Raw** | Any time-series | Passthrough (no transformation) | Accelerometer, temperature, custom sensors |

Each processing block exposes configurable parameters. For audio spectral analysis: FFT length (256, 512, 1024), window stride, number of filterbanks, frequency range. For image: target width and height, color depth (RGB or grayscale), crop or resize strategy. These parameters determine the feature vector dimensions and directly affect model input size, which in turn determines SRAM usage on the target device.

#### Learning Blocks

Learning blocks define the model architecture:

| Block | Architecture | Output | Typical Use |
|-------|-------------|--------|-------------|
| **Classification** | Dense (FC) or CNN | Class probabilities | General-purpose classification |
| **Transfer Learning** | MobileNetV1/V2-based | Class probabilities | Image classification with limited data |
| **Object Detection (FOMO)** | Grid-based CNN | Centroid heatmap | Lightweight object detection on MCUs |
| **Object Detection (SSD-MobileNet)** | SSD architecture | Bounding boxes | Object detection on more capable targets |
| **Anomaly Detection** | K-means or GMM | Anomaly score | Unsupervised anomaly detection |
| **Regression** | Dense (FC) | Continuous value | Sensor fusion, prediction |

### Stage 3: Feature Extraction

After configuring the processing block parameters, the Studio processes all training data through the DSP pipeline and generates the feature set. The feature explorer visualization plots all feature vectors in 2D or 3D (using UMAP or t-SNE dimensionality reduction), colored by class label. This visualization immediately reveals:

- **Class separability**: Well-separated clusters indicate the model should achieve high accuracy. Overlapping clusters suggest the processing block parameters need adjustment or more data is needed.
- **Outliers**: Mislabeled samples appear as points in the wrong cluster. These can be identified and corrected before training.
- **Feature scale**: If certain features dominate the scale (visible as elongated clusters along one axis), normalization or feature selection may improve results.

The DSP parameters directly control the feature space. For audio, increasing the number of mel filterbanks from 20 to 40 produces higher-resolution features but doubles the feature vector size and increases both model input size and inference time. The feature explorer provides immediate feedback on whether the additional resolution improves class separability.

### Stage 4: Training

The training stage configures and runs the neural network. Edge Impulse provides two paths:

- **Pre-built architectures**: The Studio recommends an architecture based on the impulse type (1D CNN for audio, 2D CNN for images, dense network for raw features). The architecture, layer sizes, and hyperparameters can be adjusted through the Studio interface.
- **Custom Keras**: An expert mode allows uploading a custom Keras model definition. The model must accept the feature vector shape produced by the processing block and output the correct number of classes. This enables architectures not available in the pre-built options.

Training parameters are configured in the Studio:

- **Number of epochs**: Default is 30–100 depending on the task. Audio keyword spotting typically converges in 50 epochs; image classification may need 100+.
- **Learning rate**: Default 0.005 with decay. Adjustable for custom architectures.
- **Data augmentation**: Built-in options include noise addition (for audio), time shifting, frequency masking (SpecAugment-style), and image transformations (rotation, flip, brightness). Augmentation is applied on-the-fly during training and does not permanently modify the dataset.
- **Validation split**: Automatically splits training data (default 80/20 train/validation) for monitoring overfitting during training.

The training view shows live accuracy and loss curves per epoch. After training, a confusion matrix and per-class precision/recall metrics summarize model performance on the validation set.

### Stage 5: Testing

The testing stage evaluates the trained model on a hold-out test set (data not used during training). The Studio displays:

- **Overall accuracy**: Percentage of correctly classified test samples.
- **Confusion matrix**: Per-class correct and incorrect predictions, identifying which classes are confused.
- **Per-sample results**: Each test sample's predicted class and confidence score, allowing identification of specific failure cases.
- **Uncertainty estimation**: Samples where the model's confidence is low (e.g., below 60%) are flagged for review.

The test set should be collected separately from the training set — ideally at different times, locations, or by different people — to avoid data leakage. Edge Impulse's auto-split feature distributes uploaded data into training and test sets, but the split is random and does not guarantee temporal or environmental separation.

### Stage 6: Deployment

Deployment converts the trained model and DSP pipeline into deployable code for the target platform. Several output formats are available:

- **Arduino library (.zip)**: A complete Arduino library containing the model, inference engine, and DSP code. Install via Arduino IDE's library manager (Sketch → Include Library → Add .ZIP Library).
- **C++ library**: Platform-independent C++ code for integration into custom build systems.
- **Optimized binary**: Pre-compiled binary for specific hardware (e.g., STM32, nRF, ESP32) with hardware-specific optimizations.
- **WebAssembly**: For running the model in a browser (testing and demo purposes).

## FOMO: Faster Objects, More Objects

FOMO is Edge Impulse's lightweight object detection architecture, designed specifically for microcontroller deployment. Unlike SSD-MobileNet or YOLO, which output bounding boxes, FOMO outputs centroid coordinates on a grid.

### Architecture

FOMO uses a MobileNetV2 backbone (0.1 or 0.35 alpha) followed by a 1x1 convolution that produces a spatial grid of class probabilities. For a 96x96 input image with an 8x downsampling factor, the output grid is 12x12. Each grid cell contains a probability distribution over the classes (including background). Object centroids are extracted by finding grid cells with above-threshold probability.

### Performance Characteristics

| Metric | FOMO (96x96, 0.1 alpha) | SSD-MobileNetV2 (320x320) |
|--------|--------------------------|---------------------------|
| Flash usage | ~60 KB | ~1.2 MB |
| RAM usage | ~50 KB | ~350 KB |
| Inference (Cortex-M4) | ~100 ms | Not feasible |
| Inference (Cortex-M7) | ~40 ms | ~800 ms |
| Output | Centroids | Bounding boxes |
| Max objects | Grid cells | Architecture-dependent |

FOMO does not produce bounding boxes, object sizes, or orientation information. It indicates *where* objects are and *what class* they belong to, but not *how large* they are. For counting applications (people counting, product counting on a conveyor) or simple position tracking, this is sufficient. For applications requiring size or shape information, SSD-MobileNet or a more capable target is needed.

## EON Compiler

The EON Compiler is Edge Impulse's optimized inference engine, an alternative to the standard TFLM-based deployment. It generates C++ code with several advantages:

- **Reduced memory usage**: EON applies operator fusion, buffer sharing, and dead-code elimination to reduce both flash and RAM usage compared to TFLM. Typical savings are 25–50% RAM and 10–30% flash.
- **Exact memory reporting**: The compiler reports the exact RAM and flash usage of the generated code, down to the byte. There is no uncertainty about whether the model fits the target.
- **Operator-specific code generation**: Instead of a generic interpreter loop, EON generates direct function calls for each layer. This eliminates interpreter overhead and enables the compiler to optimize across operator boundaries.

The trade-off: EON-generated code is not portable. It depends on the Edge Impulse SDK and does not produce standard TFLM-compatible models. Moving away from Edge Impulse to a manual TFLM pipeline requires re-exporting the model, not reusing the EON-generated code.

### EON vs. TFLM Comparison

| Metric | TFLM Deployment | EON Deployment |
|--------|-----------------|----------------|
| RAM (keyword spotting model) | 22 KB | 15 KB |
| Flash (keyword spotting model) | 85 KB | 62 KB |
| Inference time | Baseline | 5–15% faster |
| Portability | Standard TFLM | Edge Impulse SDK only |
| Operator coverage | Full TFLM set | EON-supported subset |

## Arduino Library Deployment

The Arduino library deployment is the most common path for Edge Impulse projects targeting Arduino-compatible boards (Nano 33 BLE Sense, Portenta H7, ESP32-based boards with Arduino core).

### Installation

1. In the Edge Impulse Studio, navigate to Deployment.
2. Select "Arduino library."
3. Choose quantization (int8 recommended for MCU targets).
4. Enable EON Compiler if desired.
5. Download the `.zip` file.
6. In Arduino IDE: Sketch → Include Library → Add .ZIP Library → select the downloaded file.

The library contains:

- `src/edge-impulse-sdk/` — The inference runtime (TFLM or EON).
- `src/tflite-model/` — The quantized model as a C array.
- `src/edge-impulse-sdk/dsp/` — The DSP pipeline (FFT, MFE, image preprocessing) matching the Studio configuration.
- `src/model-parameters/` — Configuration files specifying input dimensions, window size, class labels, and DSP parameters.

### Inference API

The core inference call:

```cpp
#include <my_project_inferencing.h>

// For raw features (accelerometer, raw sensor data):
float features[EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE];
// Fill features[] with sensor data...

signal_t signal;
numpy::signal_from_buffer(features, EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE, &signal);

ei_impulse_result_t result;
EI_IMPULSE_ERROR err = run_classifier(&signal, &result, false);

if (err == EI_IMPULSE_OK) {
    for (size_t i = 0; i < EI_CLASSIFIER_LABEL_COUNT; i++) {
        Serial.print(result.classification[i].label);
        Serial.print(": ");
        Serial.println(result.classification[i].value);
    }
}
```

The `run_classifier()` function executes the complete pipeline: DSP preprocessing, model inference, and postprocessing. The `result` struct contains per-class probabilities, timing information (`result.timing.dsp`, `result.timing.classification`, `result.timing.anomaly`), and for object detection models, bounding box or centroid coordinates.

### Continuous Inference

For streaming applications (audio keyword spotting, continuous gesture detection), the library provides a continuous inference mode:

- **Audio**: A ring buffer captures microphone data via I2S or analog input. The inference runs on overlapping windows (e.g., 1-second windows with 250 ms stride). The library provides `microphone_inference_start()` and `microphone_inference_record()` functions for this pattern.
- **Accelerometer**: A circular buffer captures accelerometer samples at the configured rate (e.g., 62.5 Hz). When enough samples accumulate for one window, inference runs. The `ei_classifier_smooth_t` utility applies temporal smoothing across consecutive inference results to reduce flickering.
- **Camera**: Frame capture triggers inference. On devices with limited RAM, the library captures one frame, runs inference, and discards the frame before capturing the next.

## Data Augmentation

Edge Impulse provides built-in data augmentation applied during training:

- **Noise addition**: Adds random noise to audio samples at configurable SNR. Helps the model generalize to noisy deployment environments.
- **Time shifting**: Shifts audio or time-series samples by a random offset. Prevents the model from learning time-position-dependent features.
- **Frequency masking (SpecAugment)**: Masks random frequency bands in the spectrogram. Forces the model to use multiple frequency ranges for classification rather than relying on a single band.
- **Image augmentation**: Rotation (configurable range), horizontal/vertical flip, brightness/contrast adjustment, zoom. Applied randomly to each training sample per epoch.

Augmentation does not modify the stored dataset — it is applied on-the-fly during training. The training logs show the effective number of augmented samples per epoch.

## Versioning and Iteration

Edge Impulse projects support iterative development:

- **Project versions**: Snapshots of the entire project state (data, impulse configuration, trained model) can be saved and restored. This enables experimentation without losing a known-good configuration.
- **Model version metadata**: Each trained model has a version identifier. The deployed library includes this version, enabling firmware to log which model version is running.
- **A/B testing**: Multiple model versions can be deployed to different devices and compared on real-world performance metrics, supporting data-driven model selection.

## Tips

- Collect data on the target device, not just a phone or laptop. Sensor characteristics differ significantly between devices — a phone's accelerometer has different noise, range, and mounting orientation than an Arduino Nano 33 BLE Sense. A model trained on phone data may perform poorly on the target device simply because the sensor outputs differ. Even microphones have different frequency responses and noise floors.
- Use the EON Compiler for Arduino deployment. The memory savings (25–50% RAM, 10–30% flash) frequently make the difference between a model that fits on an Arduino Nano 33 BLE Sense (256 KB SRAM, 1 MB flash) and one that does not. The EON Compiler is enabled with a single checkbox in the deployment configuration.
- Test with the built-in phone data collection before investing in a full dataset. Recording a few samples per class via the phone tool, training a quick model, and checking the feature explorer for class separability takes minutes. This rapid iteration identifies whether the chosen processing block and sensor modality can distinguish the target classes before committing to a full data collection effort.
- Collect at least 3 minutes of data per class for audio classification. Audio models trained on less data tend to overfit to the specific recording conditions (room acoustics, background noise level, speaker identity). More data with environmental diversity is more valuable than longer recordings in a single environment.
- Use the timing output from `run_classifier()` to identify the bottleneck. The `result.timing` struct reports DSP time, classification time, and anomaly detection time separately. If DSP time dominates, reducing FFT length or input window size may help more than reducing model complexity.

## Caveats

- **Edge Impulse free tier limits dataset size and compute time.** The free tier caps projects at 4 hours of training compute and limits data storage. For larger datasets and longer training runs, a paid plan or the self-hosted Enterprise edition is needed. The free tier is sufficient for prototyping and small projects.
- **EON Compiler produces non-portable code tied to the Edge Impulse SDK.** The generated inference code depends on Edge Impulse header files and data structures. Migrating to a standalone TFLM deployment requires re-exporting the model as a `.tflite` file and rebuilding the inference pipeline from scratch. The EON-generated code cannot be extracted and used independently.
- **Custom Keras layers may not be supported by the deployment pipeline.** The Studio accepts custom Keras model definitions, but the deployment step (whether TFLM or EON) only supports operators that have corresponding implementations in the target runtime. Custom layers, lambda layers, or uncommon activation functions cause deployment failures. The Studio validates this before generating the library but does not always provide clear guidance on which alternative operator to use.
- **Data collected in controlled environments often underperforms in deployment.** A keyword-spotting model trained on recordings made in a quiet office with a single speaker may achieve 95% accuracy in the Studio but drop to 70% when deployed in a factory with machine noise and multiple speakers. The Studio's test accuracy reflects the test data distribution, not the deployment environment. Collecting data in realistic conditions is essential.
- **The Arduino library can be large.** A full Edge Impulse Arduino library with the inference SDK, DSP pipeline, and model data can exceed 200 KB of compiled flash. On Arduino boards with limited flash (e.g., Arduino Uno with 32 KB), the library simply does not fit. The Nano 33 BLE Sense (1 MB flash) and ESP32-based boards (4+ MB flash) are the practical minimum targets.
- **Processing block parameters are baked into the deployed library.** If the DSP parameters (FFT size, window length, mel bin count) are changed in the Studio after deployment, the new model is incompatible with the deployed library's preprocessing code. A new library must be generated and flashed. There is no mechanism for OTA parameter updates within the Edge Impulse library.

## In Practice

- **Model shows 95% accuracy in Studio but 70% on device.** The test data in the Studio is too similar to the training data — same environment, same sensor, same conditions. Collecting additional test data in the deployment environment (different room, background noise, temperature) reveals the true deployment accuracy. Adding environment-diverse data to the training set and retraining typically closes the gap.
- **Arduino sketch compiles but inference returns garbage values.** The preprocessing block in the deployed library does not match the current Studio configuration. This happens when the processing block parameters (FFT length, window size, number of features) were changed in the Studio after the library was exported. Re-exporting the library with the current Studio configuration resolves the mismatch. Checking `EI_CLASSIFIER_DSP_INPUT_FRAME_SIZE` in the library against the Studio's expected input size confirms the discrepancy.
- **Memory overflow on Arduino Nano 33 BLE Sense.** The model plus inference runtime exceeds the board's 256 KB SRAM. The first step is to enable the EON Compiler, which typically reduces RAM usage by 25–50%. If the model still does not fit, reducing the input resolution (e.g., 48x48 instead of 96x96 for images, or 16 mel bins instead of 40 for audio) is the most effective architectural change. Reducing the number of CNN filters or dense layer width has a smaller effect on RAM because the activation memory (determined by spatial dimensions) typically dominates.
- **Accelerometer classification triggers randomly even when the device is stationary.** The model was trained with the device in a specific orientation, and the deployed device is mounted differently. Accelerometer data includes a gravity component that shifts the baseline reading based on orientation. Training data should include samples at multiple orientations, or the preprocessing pipeline should include gravity compensation (high-pass filter or orientation-independent features like magnitude). Edge Impulse's spectral analysis block can be configured to extract frequency-domain features that are less orientation-dependent than raw accelerometer values.
- **Audio classification works in the Studio simulator but not on the device.** The Studio simulator uses the audio data as-is, but the device's microphone has a different frequency response, sensitivity, and noise floor. A MEMS microphone on the Nano 33 BLE Sense has a different spectral characteristic than a laptop microphone used for data collection. Recording training data with the target device's microphone, or applying frequency compensation in the processing block, aligns the training and deployment audio characteristics.
- **Inference timing is inconsistent on ESP32-based Arduino boards.** The Arduino-ESP32 core runs FreeRTOS underneath, and Wi-Fi/BLE tasks compete with the inference loop for CPU time. The Edge Impulse library does not pin tasks to cores. Adding `xTaskCreatePinnedToCore()` for the inference loop (pinned to Core 1) and leaving the Arduino `loop()` function for non-inference tasks stabilizes timing. Alternatively, disabling Wi-Fi during inference with `WiFi.mode(WIFI_OFF)` eliminates the contention entirely for applications that do not need continuous connectivity.
