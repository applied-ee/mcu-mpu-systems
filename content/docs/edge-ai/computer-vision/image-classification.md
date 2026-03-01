---
title: "Image Classification"
weight: 10
---

# Image Classification

Image classification assigns a single label to an entire image from a fixed set of classes, producing top-K predictions with associated confidence scores. A model trained on ImageNet outputs a 1000-element probability vector; the highest-scoring entry is the predicted class. On edge devices, the challenge is achieving useful accuracy within severe compute, memory, and power budgets — which has driven the development of model families specifically architected for efficient inference on ARM cores and neural accelerators.

## MobileNet Family

The MobileNet series from Google represents the most widely deployed classification architecture on edge hardware. Each generation introduces architectural refinements that improve the accuracy-per-FLOP ratio.

### MobileNet-v1

MobileNet-v1 replaces standard convolutions with **depthwise separable convolutions**, which factor a standard convolution into a depthwise convolution (one filter per input channel) followed by a 1x1 pointwise convolution that mixes channels. For a 3x3 convolution on a feature map with 256 input channels and 256 output channels, the standard convolution requires 3x3x256x256 = 589,824 multiply-accumulate operations per spatial position. The depthwise separable variant requires 3x3x256 + 256x256 = 67,840 — roughly 8-9x fewer operations.

Two hyperparameters control the size/accuracy trade-off:

- **Width multiplier (alpha)** — Scales the number of channels in each layer. Alpha=1.0 uses the full architecture; alpha=0.75 uses 75% of the channels, reducing compute and model size roughly quadratically. Alpha=0.25 produces a model under 500 KB but with significantly degraded accuracy.
- **Input resolution** — The model accepts square inputs at 128, 160, 192, or 224 pixels. Reducing resolution from 224 to 128 cuts compute by ~3x at a substantial accuracy cost.

### MobileNet-v2

MobileNet-v2 introduces **inverted residual blocks** with **linear bottlenecks**. Unlike ResNet, where bottleneck blocks narrow channels in the middle, MobileNet-v2 expands channels with a 1x1 convolution, applies the depthwise convolution in the expanded space, then projects back to a narrow output with a linear (no ReLU) 1x1 convolution. The expansion factor is typically 6x. Skip connections link the narrow input directly to the narrow output, preserving information through the residual path.

The linear bottleneck is critical: applying ReLU to low-dimensional representations destroys information. By keeping the bottleneck output linear, v2 preserves more representational capacity in the narrow layers where the skip connections operate.

MobileNet-v2 alpha=1.0 at 224x224 achieves ~72% top-1 accuracy on ImageNet with 3.4M parameters, a model size of ~14 MB (float32), and ~300M multiply-accumulate operations per inference.

### MobileNet-v3

MobileNet-v3 combines architecture search (NAS) with two manual refinements:

- **Squeeze-and-excite (SE) blocks** — A channel attention mechanism that learns per-channel scaling factors. An SE block adds ~2% accuracy at modest compute cost.
- **h-swish activation** — A piecewise-linear approximation to the swish function (x * sigmoid(x)) that is faster to compute on integer hardware. h-swish replaces ReLU in the later layers of the network.

MobileNet-v3-Large achieves ~75.2% top-1 accuracy on ImageNet. MobileNet-v3-Small targets extremely constrained devices and achieves ~67.4% top-1 at roughly half the compute of v3-Large.

## EfficientNet-Lite

EfficientNet uses **compound scaling** to simultaneously scale network width, depth, and input resolution using a single compound coefficient. Rather than scaling one dimension at a time (as with MobileNet's alpha multiplier), compound scaling balances all three for a more efficient accuracy/compute trade-off.

The EfficientNet-Lite family adapts EfficientNet for edge deployment by removing squeeze-and-excite blocks (which have poor hardware utilization on many accelerators) and replacing swish activations with ReLU6:

| Variant | Input Resolution | Parameters | ImageNet Top-1 (float) | INT8 Top-1 |
|---------|-----------------|------------|----------------------|------------|
| Lite0 | 224 | 4.7M | 75.1% | 74.4% |
| Lite1 | 240 | 5.4M | 76.7% | 75.9% |
| Lite2 | 260 | 6.1M | 77.6% | 76.8% |
| Lite3 | 280 | 8.2M | 79.8% | 79.0% |
| Lite4 | 300 | 13.0M | 81.5% | 80.6% |

EfficientNet-Lite0 through Lite2 are practical for real-time classification on accelerated edge platforms. Lite3 and Lite4 push into territory where inference time may exceed frame-rate requirements on all but the fastest edge hardware.

The INT8 quantized accuracy column shows that EfficientNet-Lite models lose less than 1% accuracy from quantization — a direct benefit of the ReLU6 activations, which bound the activation range and make quantization more predictable.

## Input Preprocessing Pipeline

Every classification model expects input tensors in a specific format. The preprocessing pipeline transforms raw camera frames into that format:

1. **Resize** — Scale the image so the shorter side matches the model's input dimension. Bilinear interpolation is the standard resizing method; nearest-neighbor interpolation introduces aliasing artifacts that can affect model accuracy, particularly on images with fine textures.
2. **Center crop** — Crop the center square at the target resolution (e.g., 224x224). This discards content at the edges of non-square images. For applications where edge content matters (objects near the frame boundary), resizing with letterboxing (padding to square with gray or black borders) preserves all content at the cost of reduced effective resolution.
3. **Color space conversion** — Ensure the image is in RGB order. Many cameras and capture APIs produce BGR (OpenCV default) or YUV (V4L2 default). On embedded Linux platforms using `libcamera` or `rpicam-apps`, the ISP typically outputs RGB or YUV420. The conversion from YUV to RGB is non-trivial on MCU-class devices — a 224x224 frame requires ~150K pixel operations.
4. **Normalization** — Scale pixel values to the range expected by the model. This step must exactly match the normalization applied during training.

Normalization is model-specific and is the single most common source of incorrect predictions on device:

| Model Family | Normalization | Value Range |
|-------------|---------------|-------------|
| MobileNet (TFLite, uint8) | No normalization | [0, 255] as uint8 |
| MobileNet (TFLite, float32) | (pixel - 127.5) / 127.5 | [-1.0, 1.0] |
| EfficientNet-Lite (float32) | pixel / 255.0 | [0.0, 1.0] |
| ImageNet-pretrained PyTorch models | (pixel / 255.0 - mean) / std | mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225] |

Using the wrong normalization produces a model that runs without errors but outputs meaningless predictions. There is no runtime warning — the model happily classifies garbage inputs.

### Preprocessing on MCU vs Linux

On Linux SBCs, OpenCV or PIL handles the entire preprocessing pipeline in a few lines of Python or C++. On microcontrollers, preprocessing must be implemented manually — often in bare C — with careful attention to fixed-point arithmetic for normalization. CMSIS-NN provides optimized functions for some preprocessing steps on Cortex-M, but the resize and color conversion steps typically must be custom-implemented.

The preprocessing latency can be significant relative to inference on fast accelerators. On a Pi 5 with Hailo-8L, the MobileNet-v2 inference takes ~1–2 ms, but resizing a 1920x1080 camera frame to 224x224, converting BGR to RGB, and normalizing takes ~3–5 ms on the CPU — the preprocessing becomes the pipeline bottleneck.

## Cross-Platform Benchmarks

Approximate inference times for MobileNet-v2 alpha=1.0 at 224x224 (INT8 quantized unless noted):

| Platform | Runtime | Inference Time | Notes |
|----------|---------|---------------|-------|
| STM32H7 (Cortex-M7, 480 MHz) | TensorFlow Lite Micro | ~300–500 ms | Fits in 1 MB RAM with careful arena sizing |
| Raspberry Pi 5 CPU | TFLite + XNNPACK | ~8–12 ms | 4-core Cortex-A76, XNNPACK uses NEON SIMD |
| Raspberry Pi 5 + AI HAT+ | Hailo-8L | ~1–2 ms | 13 TOPS NPU, model compiled with Hailo Dataflow Compiler |
| Jetson Orin Nano | TensorRT | ~0.5–1 ms | 40 TOPS GPU, FP16 or INT8 |

The 100-500x speed difference between a Cortex-M7 and an NPU-equipped Linux SBC illustrates why classification on microcontrollers is typically limited to low-frame-rate or trigger-based applications (e.g., classify one image per second when a motion sensor fires), while SBC-class platforms support continuous real-time classification.

### Model Size and Memory Requirements

| Model | Float32 Size | INT8 Size | Peak Activation RAM | Min. Platform |
|-------|-------------|-----------|--------------------| --------------|
| MobileNet-v1 alpha=0.25 128x128 | 1.9 MB | 0.5 MB | ~200 KB | Cortex-M4 (256 KB RAM) |
| MobileNet-v2 alpha=1.0 224x224 | 14 MB | 3.4 MB | ~1.2 MB | Cortex-M7 (1 MB+ RAM) |
| MobileNet-v3-Small 224x224 | 10 MB | 2.6 MB | ~1.0 MB | Cortex-M7 (1 MB+ RAM) |
| EfficientNet-Lite0 224x224 | 18.6 MB | 4.7 MB | ~2.5 MB | Linux SBC (512 MB+ RAM) |
| EfficientNet-Lite2 260x260 | 24 MB | 6.1 MB | ~4.0 MB | Linux SBC (512 MB+ RAM) |

Peak activation RAM is the memory needed for intermediate tensors during inference — this is often the binding constraint, not the model file size. A model that fits in flash may still exceed available RAM if the activation arena is too small.

## Transfer Learning

ImageNet-pretrained models serve as feature extractors for custom classification tasks. The standard transfer learning workflow:

1. **Load a pretrained base model** (e.g., MobileNet-v2 with ImageNet weights) and freeze all layers.
2. **Replace the classification head** — Remove the final dense layer (1000-class output) and add a new head matching the target number of classes.
3. **Train the head** — Train only the new classification layers on the custom dataset for 10–20 epochs. This adapts the frozen feature extractor to the new classes.
4. **Fine-tune (optional)** — Unfreeze the last few layers of the base model and train at a reduced learning rate (1/10th to 1/100th of the head training rate) for 5–10 additional epochs. Fine-tuning the deeper layers adapts the feature representations but risks overfitting on small datasets.
5. **Export** — Convert to TFLite (with quantization) or ONNX for deployment.

For quantization-aware training (QAT), the fine-tuning step includes fake quantization nodes that simulate INT8 precision during training. QAT typically recovers 0.5–1% of accuracy lost by post-training quantization, at the cost of a more complex training pipeline.

A representative dataset for post-training quantization calibration should include 200–500 images that reflect the distribution of real deployment data — lighting conditions, backgrounds, angles, and object sizes that the model will encounter in production.

### Practical Dataset Sizes

Transfer learning is effective with surprisingly small datasets when the target domain is visually similar to ImageNet:

- **100–500 images per class** — Sufficient for domains close to ImageNet (consumer products, animals, vehicles). Accuracy within 2–5% of models trained on thousands of images.
- **500–2000 images per class** — Recommended for domains that differ from ImageNet (medical images, microscopy, aerial imagery, industrial defects). Fine-tuning the last few backbone layers becomes necessary.
- **Under 100 images per class** — Risky. The model is likely to overfit and perform poorly on deployment data that differs from the training set. Data augmentation (rotation, flipping, brightness/contrast jitter, random cropping) can partially compensate but does not replace genuinely diverse training images.

Data augmentation during transfer learning should match the variations expected in deployment. For a camera mounted at a fixed angle on a conveyor belt, rotation augmentation beyond +/-5 degrees adds noise rather than useful diversity. For a handheld device, rotation up to +/-30 degrees and perspective warps are appropriate.

## Tips

- Start with MobileNet-v2 alpha=1.0 at 224x224 as the baseline model. It has the broadest runtime support (TFLite, ONNX, TensorRT, Hailo, TFLM), extensive documentation, and known-good performance characteristics across platforms. Switch to EfficientNet-Lite or MobileNet-v3 only after confirming the baseline meets latency requirements.
- Always verify that the preprocessing pipeline on the target device matches the preprocessing used during training. A quick validation is to run the same test image through both the training framework (Python) and the on-device pipeline, then compare the raw input tensor values byte-by-byte.
- Use a representative dataset of 200–500 real deployment images for quantization calibration. Images pulled from the internet or synthetic data often have different brightness, contrast, and color distributions than live camera frames.
- For transfer learning on small datasets (under 1000 images per class), freeze the entire base model and train only the head. Fine-tuning with insufficient data leads to overfitting that manifests as perfect training accuracy but poor deployment performance.
- When exporting to TFLite, explicitly set the input and output tensor types (uint8 or float32) and verify them on device. A mismatch between the expected and actual tensor type causes silent misinterpretation of the input buffer.

## Caveats

- **MobileNet alpha multipliers below 0.5 degrade accuracy disproportionately.** The relationship between alpha and accuracy is not linear — below 0.5, the channel count in bottleneck layers becomes so narrow that representational capacity collapses. Alpha=0.25 models may appear to fit in memory but classify poorly on anything beyond trivial datasets.
- **ImageNet-pretrained models assume RGB input.** OpenCV's `imread()` and many camera APIs (including V4L2 defaults) provide BGR. Feeding BGR data to an RGB-trained model does not cause an error — the model runs and produces confident but wrong predictions. This is particularly insidious because some classes are not affected (grayscale-dominated objects still classify correctly).
- **Quantization calibration with a non-representative dataset causes systematic bias.** If the calibration images are all brightly lit indoor scenes but deployment is in overcast outdoor conditions, the quantization ranges will be wrong for the deployment distribution. This manifests as accuracy drops on specific classes or conditions rather than uniform degradation.
- **EfficientNet-Lite models above Lite2 often exceed the latency budget for real-time classification on platforms without dedicated accelerators.** The compound scaling increases all three dimensions (width, depth, resolution), and the depth increase has a particularly strong impact on inference time because it is not parallelizable.
- **Float32 and uint8 TFLite models have different input preprocessing requirements even for the same architecture.** A float32 MobileNet-v2 expects [-1, 1] normalization, while the uint8 quantized version expects raw [0, 255] byte values. Swapping the model file without updating the preprocessing code is a common deployment error.

## In Practice

- **A model that classifies every image as the same class** (or nearly the same class) almost always indicates a preprocessing mismatch. The most frequent cause is incorrect normalization — applying [-1, 1] normalization to a model that expects [0, 1] effectively halves and shifts the dynamic range, collapsing all inputs into a region of feature space that maps to a single class. A secondary cause is a color channel swap (RGB vs BGR).
- **Accuracy that drops significantly after quantization, but only for certain classes**, commonly appears when the quantization calibration dataset does not include sufficient examples of those classes. The quantization ranges for intermediate activations are calibrated to the distribution of the calibration data; classes that activate different feature map patterns than the calibration set see clipped or poorly resolved activations.
- **A classification model that produces correct labels but consistently low confidence scores** (e.g., top-1 probability never exceeds 0.4) often reflects a softmax temperature mismatch or an undertrained classification head. In transfer learning, this appears when the head is trained for too few epochs or with too high a learning rate — the logits never reach the magnitude needed for confident softmax outputs.
- **Inference time on a Cortex-M7 that exceeds the expected benchmark by 2-3x** typically indicates that the TFLM arena is too small, causing the interpreter to use a less efficient memory layout, or that the model contains operations not covered by optimized kernels (falling back to reference implementations). Checking the operator resolver output reveals which operations are using reference kernels.
- **A model that works correctly with test images loaded from files but fails on live camera frames** points to a difference in the image pipeline — the file loader applies automatic color correction, EXIF rotation, or gamma adjustment that the camera capture path does not. Comparing raw pixel values between the two paths isolates the divergence.
