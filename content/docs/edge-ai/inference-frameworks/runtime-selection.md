---
title: "Edge Runtime Selection Guide"
weight: 40
---

# Edge Runtime Selection Guide

Selecting an inference runtime for edge deployment is a multi-dimensional decision that involves the target hardware, model format, operator coverage, memory budget, and the training framework that produced the model. There is no single "best" runtime — the choice is constrained by the intersection of what the hardware supports, what the model requires, and what the deployment environment allows. A model that runs perfectly on [TensorFlow Lite for Linux]({{< relref "tflite-linux" >}}) with the XNNPACK delegate on a Raspberry Pi 4 cannot run on a Cortex-M4 microcontroller, where [TensorFlow Lite Micro]({{< relref "tflite-micro" >}}) is the only viable option. Conversely, a PyTorch model that exports cleanly to [ONNX Runtime]({{< relref "onnx-runtime" >}}) may have no path to TFLite without an intermediate conversion step that risks operator compatibility issues.

The decision is best approached by eliminating incompatible options first — hardware constraints narrow the runtime candidates, memory budget eliminates more, and operator coverage provides the final filter.

## Decision Tree by Hardware Class

### Bare-Metal Microcontrollers (No OS)

**Platforms**: Cortex-M0+ through Cortex-M55, ESP32 (all variants), nRF52/53 series, RP2040/RP2350

**Runtime**: TensorFlow Lite Micro is the only production-ready option. There is no ONNX Runtime variant for bare-metal, and no other inference framework has equivalent operator coverage and community support on bare-metal ARM and Xtensa targets.

- Models must be `.tflite` FlatBuffer format, typically int8 quantized.
- All memory comes from a static tensor arena — no heap allocation.
- Operator registration is explicit via `MicroMutableOpResolver`.
- Optimized kernels via CMSIS-NN (Cortex-M) or ESP-NN (ESP32).

For Cortex-M55 with Ethos-U55/U65, Arm's Vela compiler produces optimized command streams that TFLM's Ethos-U delegate executes on the NPU. This is the only current path to NPU acceleration on bare-metal ARM.

### Linux Single-Board Computers (CPU Only)

**Platforms**: Raspberry Pi 3/4/5, BeagleBone AI-64, Orange Pi, Radxa Rock, any ARM or x86 SBC running Linux

**Runtimes**: TensorFlow Lite for Linux or ONNX Runtime, both with CPU optimization.

- TFLite with XNNPACK is the standard for TensorFlow-trained models. Well-documented, widely deployed, smallest runtime footprint.
- ONNX Runtime with default CPU EP (which uses XNNPACK internally on ARM) is the standard for PyTorch-trained models.
- Both runtimes achieve comparable CPU inference performance on ARM Cortex-A platforms. The difference is typically <10% for equivalent models.

The choice between them is driven by the training framework. A TensorFlow/Keras training pipeline produces `.tflite` models directly; a PyTorch pipeline produces `.onnx` models directly. Cross-conversion (PyTorch to TFLite via ONNX-to-TFLite, or TensorFlow to ONNX via tf2onnx) is possible but adds a fragile step.

### Linux SBCs with NPU/Accelerator

**Platforms**: Raspberry Pi 5 with AI HAT+ (Hailo-8L), BeagleBone AI-64 (C7x DSP + MMA), Qualcomm RB3/RB5 (Hexagon DSP + HTA)

**Runtimes**: TFLite or ONNX Runtime with hardware-specific delegates/EPs.

- **Hailo (Pi AI HAT+)**: TFLite with the Hailo external delegate, or the native HailoRT API. Models must be compiled to HEF format using the Hailo Dataflow Compiler. The TFLite delegate provides a familiar API but adds a layer of indirection; the native HailoRT API gives full control over scheduling and multi-model pipeline configuration.
- **Qualcomm**: ONNX Runtime with the QNN execution provider, or TFLite with the NNAPI or Hexagon delegate. QNN is Qualcomm's unified AI runtime covering CPU, GPU, HTA, and Hexagon DSP.
- **Texas Instruments (BeagleBone AI-64)**: TFLite with the TI delegate for C7x+MMA offload, or ONNX Runtime with the TI TIDL EP.

In this category, the accelerator vendor's supported runtime often dictates the choice. Hailo's toolchain works with both TFLite and ONNX models at the compilation stage, but the runtime integration is better documented for TFLite. Qualcomm's QNN EP works with ONNX Runtime natively.

### NVIDIA Jetson

**Platforms**: Jetson Nano, Jetson Orin Nano, Jetson Orin NX, Jetson AGX Orin

**Runtimes**: TensorRT (native), ONNX Runtime with TensorRT EP, or TFLite with TensorRT delegate. In practice, native TensorRT is the standard choice.

- TensorRT consumes ONNX models directly (`trtexec --onnx=model.onnx`) or TensorFlow models via TF-TRT integration.
- Building a TensorRT engine is an offline step that produces a hardware-specific optimized binary. Engines are not portable between Jetson generations (a Nano engine does not run on Orin).
- ONNX Runtime with the TensorRT EP provides a higher-level API that handles engine building automatically but with less control over optimization parameters.
- TFLite with the TensorRT delegate is functional but adds two layers of abstraction (TFLite → delegate → TensorRT) with measurable overhead.

For Jetson-only deployments, the typical path is: train in PyTorch → export to ONNX → build TensorRT engine → deploy with TensorRT C++ or Python API.

### Google Coral

**Platforms**: Coral USB Accelerator, Coral Dev Board, Coral SoM, PCIe Accelerator

**Runtime**: TFLite with the Edge TPU delegate (libedgetpu). This is the only supported inference path.

- Models must be `.tflite` format, fully int8 quantized (all operators, including input and output).
- The Edge TPU compiler (`edgetpu_compiler`) maps operations to the Edge TPU. Unsupported operations fall back to CPU.
- The Edge TPU supports a limited operator set — primarily standard CNN operators (Conv2D, DepthwiseConv2D, FullyConnected, Pooling, Reshape). Transformer architectures with attention mechanisms have limited or no Edge TPU support.

## Decision by Memory Budget

Memory is the hardest constraint on edge devices. The tensor arena (TFLM) or runtime heap (TFLite/ORT) must fit within available RAM alongside the rest of the firmware or application.

| Available RAM | Viable Runtimes | Typical Models |
|--------------|----------------|----------------|
| **<64 KB** | TFLM only, highly constrained | Keyword spotting (DS-CNN ~20 KB arena), simple anomaly detection |
| **64–256 KB** | TFLM with careful arena sizing | Person detection (MobileNet 0.25, ~100 KB arena), gesture recognition |
| **256 KB–1 MB** | TFLM (comfortable), TFLite Linux marginal | Larger MCU models, small Linux models with minimal runtime overhead |
| **1–64 MB** | TFLite Linux, ONNX Runtime Mobile | MobileNetV2, EfficientNet-Lite, small YOLO variants |
| **64 MB–1 GB** | TFLite Linux, ONNX Runtime (full), TensorRT | Full MobileNet/EfficientNet, YOLOv5s/v8s, small transformers |
| **>1 GB** | Any runtime | Large object detection, segmentation, transformer models |

These ranges include the runtime overhead itself. TFLM adds 20–50 KB of code. TFLite for Linux's runtime uses approximately 2–5 MB of heap beyond the model and tensor memory. ONNX Runtime's full build uses 10–30 MB of baseline heap. ORT Mobile reduces this to 2–5 MB.

## Model Format Compatibility

The model format determines which runtimes can load the model without conversion:

| Format | Native Runtimes | Conversion Path |
|--------|----------------|-----------------|
| `.tflite` (FlatBuffer) | TFLite, TFLM | → ONNX via `tflite2onnx` (limited) |
| `.onnx` (Protocol Buffers) | ONNX Runtime | → TFLite via `onnx-tf` + `tf.lite.TFLiteConverter` (fragile) |
| `.engine` / `.plan` (TensorRT) | TensorRT only | Not portable; must rebuild from ONNX or TF |
| `.hef` (Hailo) | HailoRT, Hailo TFLite delegate | Not portable; must recompile from ONNX or TFLite |
| SavedModel (TensorFlow) | TF Serving, TF-TRT | → TFLite via converter, → ONNX via `tf2onnx` |
| TorchScript (`.pt`) | PyTorch, Torch-TensorRT | → ONNX via `torch.onnx.export()` |

Cross-format conversion is a common source of deployment failures. Each conversion step can introduce operator mismatches, shape inference errors, or quantization drift. The most reliable pipelines minimize conversion steps: TensorFlow → TFLite, or PyTorch → ONNX → TensorRT.

## Operator Coverage

Operator coverage is the final and often decisive filter. A runtime may support the target hardware and fit the memory budget, but if the model uses an operator that the runtime (or its hardware delegate/EP) does not implement, the model either fails to load or silently falls back to slow CPU execution.

### Checking Operator Support

- **TFLM**: The list of supported operators is in the TFLM source code (`tensorflow/lite/micro/all_ops_resolver.cc`). Each operator has version constraints — a Conv2D at version 5 may be supported while version 6 is not.
- **TFLite delegates**: Each delegate documents its supported operators. The `benchmark_model` tool with `--enable_op_profiling=true` shows which operators ran on the delegate versus CPU.
- **ONNX Runtime EPs**: Each EP's documentation lists supported operators. At session creation with verbose logging, ORT reports which operators were placed on which EP.
- **TensorRT**: The TensorRT support matrix documents which ONNX operators map to TensorRT layers. Unsupported operators require custom plugins or model restructuring.

### Common Operator Gaps

| Operator / Pattern | TFLM | TFLite Linux | ORT CPU | ORT TensorRT | Coral Edge TPU |
|-------------------|------|-------------|---------|--------------|----------------|
| Conv2D (standard) | Yes | Yes | Yes | Yes | Yes |
| Attention (multi-head) | No | Partial | Yes | Yes (fused) | No |
| Dynamic reshape | No | Yes | Yes | Limited | No |
| GatherND | No | Yes | Yes | Yes | No |
| Non-max suppression | No | Custom op | Yes | Plugin needed | No |
| LayerNorm | No | Yes | Yes | Yes (fused) | No |
| GELU activation | No | Yes | Yes | Yes | No |

Transformer-based models (BERT, ViT, Whisper) run well on ONNX Runtime and TFLite Linux with XNNPACK, but have limited or no support on TFLM, Coral Edge TPU, and some NPU delegates. This is a fundamental architectural limitation — these accelerators are optimized for CNN-style operators, not attention mechanisms.

## Framework Lock-In

The choice of training framework creates a dependency chain:

```
Training Framework → Export Format → Inference Runtime → Hardware Target
```

- **TensorFlow/Keras → `.tflite` → TFLite (all variants)** — The most vertically integrated path. TFLite's converter understands TensorFlow ops natively, quantization is well-supported, and the operator mapping is maintained by the same team.
- **PyTorch → `.onnx` → ONNX Runtime** — The natural path for PyTorch models. `torch.onnx.export()` is actively maintained, and ORT's operator coverage for PyTorch-exported models is extensive.
- **PyTorch → `.onnx` → TensorRT** — The standard path for NVIDIA platforms. TensorRT consumes ONNX directly and applies aggressive GPU-specific optimizations.
- **PyTorch → `.onnx` → `onnx-tf` → `.tflite`** — A fragile path that works for standard CNN architectures but frequently fails on models with custom ops, dynamic shapes, or uncommon operators. Each conversion step adds risk.

Switching training frameworks mid-project (e.g., moving from TensorFlow to PyTorch after discovering that ONNX Runtime has better EP support for the target hardware) is costly. The model architecture may port directly, but training infrastructure (data pipelines, augmentation, hyperparameter schedules) does not. Evaluating the full training-to-deployment pipeline early, including runtime compatibility on the target device, avoids expensive late-stage pivots.

## Runtime Comparison Summary

| Dimension | TFLM | TFLite Linux | ONNX Runtime | TensorRT |
|-----------|------|-------------|-------------|----------|
| **Target** | Bare-metal MCU | Linux SBC/embedded | Linux/Windows/macOS | NVIDIA GPU |
| **Min RAM** | ~20 KB | ~5 MB | ~10 MB (full), ~3 MB (mobile) | ~100 MB |
| **Model format** | `.tflite` | `.tflite` | `.onnx`, `.ort` | `.onnx` → `.engine` |
| **Source frameworks** | TensorFlow | TensorFlow | PyTorch, TF, others | PyTorch, TF (via ONNX) |
| **HW acceleration** | CMSIS-NN, ESP-NN, Ethos-U | Delegates (GPU, NPU, TPU) | EPs (CUDA, TRT, QNN, CoreML) | Native GPU optimization |
| **Quantization** | int8 (PTQ, QAT) | int8, float16 | int8 (QDQ), float16 | int8, float16 (calibration) |
| **Dynamic shapes** | No | Yes | Yes (EP-dependent) | Yes (with shape profiles) |
| **Operator count** | ~80–90 | ~130 | ~190 | ~100 (ONNX subset) |
| **Startup time** | <10 ms | 50–500 ms | 100 ms–5 s | 10–60 s (engine build) |

## Tips

- Prototype on a desktop or high-powered SBC first, using the same runtime planned for production. Running the model through TFLite or ORT on a desktop with the CPU EP validates operator compatibility and provides a baseline accuracy number before hardware-specific issues are introduced.
- Validate operator support on the target hardware early in the project — ideally during model architecture selection, not after training is complete. A model that trains for 48 GPU-hours but uses an operator unsupported by the target delegate requires architecture changes and retraining.
- Keep model export reproducible by pinning framework versions, opset versions, and export parameters in a build script or CI pipeline. A `requirements.txt` or `pyproject.toml` that locks `torch==2.2.0`, `onnx==1.15.0`, and `onnxruntime==1.17.0` prevents version skew between training and deployment.
- For multi-platform deployments (same model on both Pi and Jetson), maintain a single canonical model format (`.tflite` or `.onnx`) and use platform-specific delegates/EPs rather than converting to platform-native formats. This keeps the model artifact consistent across platforms.
- When memory is tight, measure actual runtime memory usage with `valgrind --tool=massif` (Linux) or the platform's memory profiler, not just the model file size. The runtime overhead (interpreter state, EP internal buffers, scratch memory) can exceed the model's weight and activation memory.
- For TensorRT deployments, serialize the built engine to disk and load it on subsequent runs. Engine building is the dominant startup cost (10–60 seconds), and the built engine is deterministic for a given model and hardware target.

## Caveats

- **Desktop benchmarks do not predict edge performance.** A model that runs in 10 ms on an x86 laptop with AVX-512 may run in 200 ms on a Cortex-A72 (Pi 4) and 1500 ms on a Cortex-M7. The difference comes from memory bandwidth (laptop: 50 GB/s; Pi 4: 4 GB/s; MCU: internal SRAM only), SIMD width (512-bit vs 128-bit vs 32-bit), and cache hierarchy. Always benchmark on the actual target hardware.
- **Runtime version skew between training and deployment causes subtle failures.** A model exported with TensorFlow 2.15 targeting TFLite opset 5 for Conv2D may behave differently on a TFLite runtime built from TensorFlow 2.12 source, where Conv2D opset 3 has different quantization parameter handling. Pinning the runtime version to match the training framework version is essential.
- **Delegate and EP availability changes between OS releases and SDK versions.** A Hailo delegate that works on Raspberry Pi OS Bookworm with HailoRT 4.17 may not be available on Bullseye. The Coral Edge TPU runtime has specific kernel version requirements. Hardware accelerator support is tied to specific software stack versions, and upgrading the OS can break the inference pipeline.
- **Multi-model deployments on shared accelerators introduce contention.** Running two models simultaneously on the same NPU (e.g., object detection and pose estimation on Hailo-8L) requires explicit scheduling. Without it, the models compete for accelerator resources, and both run slower than either would alone. The accelerator's multi-context or pipeline scheduling API must be used — the TFLite or ORT delegate abstraction typically does not expose this.
- **Quantization accuracy loss compounds through the pipeline.** A model quantized to int8 for TFLite may lose 1% accuracy. Converting that TFLite model's weights to HEF format for the Hailo delegate applies a second round of quantization mapping, potentially losing another 1–2%. Testing end-to-end accuracy on the final target hardware, not just in the training framework's quantization simulation, is the only way to catch cumulative accuracy drift.

## In Practice

- **A model that works correctly in Python (TFLite or ORT) on a desktop produces incorrect results on the target edge device.** The most common cause is a preprocessing mismatch: the desktop pipeline uses a different image resizing algorithm, normalization range, or color channel order than the edge pipeline. Python's PIL and OpenCV produce different pixel values for the same resize operation, and swapping between RGB and BGR channel order silently inverts model predictions on color-sensitive models. Comparing raw input tensor values (not just images) between desktop and edge isolates the divergence.
- **Inference accuracy degrades after switching from float32 to int8 quantized deployment.** This is expected behavior — int8 quantization introduces quantization noise that reduces accuracy by 1–5% depending on the model and calibration quality. The fix is quantization-aware training (QAT), which models the quantization noise during training and typically recovers most of the lost accuracy. Post-training quantization (PTQ) without calibration data produces the worst results; PTQ with a representative calibration dataset is better; QAT is best.
- **A model runs on the CPU but the hardware delegate rejects it entirely.** This typically indicates that the model's primary operators fall outside the delegate's supported set. Transformer-based models on CNN-optimized NPUs (Coral Edge TPU, Hailo-8L) commonly encounter this — the attention mechanism, layer normalization, and GELU activation are not supported. The fallback is CPU-only inference, which may still be fast enough on a capable SBC (Pi 5 with XNNPACK), or the model architecture must be changed to CNN-based alternatives.
- **The same `.tflite` model runs 3x faster on a Pi 5 than a Pi 4, but only 1.5x faster was expected based on clock speed.** The Cortex-A76 cores in the Pi 5 have wider NEON units, better branch prediction, and a larger L2 cache (512 KB vs 1 MB per cluster) compared to the Cortex-A72 in the Pi 4. XNNPACK-optimized kernels benefit disproportionately from wider SIMD execution and larger caches. Clock speed alone does not predict inference performance — microarchitecture differences dominate.
- **Adding a hardware accelerator (AI HAT+, Coral USB) does not improve latency for a specific model.** This commonly appears when the model is too small for the accelerator's overhead to be amortized. A keyword-spotting model that runs in 2 ms on the Pi 5 CPU takes 5 ms through the Hailo delegate due to PCIe transfer latency and delegate invocation overhead. Hardware accelerators provide the largest benefit for large models (>10 ms CPU inference) where compute time dominates over data transfer time.
- **Inference throughput plateaus despite the accelerator being underutilized.** In a camera pipeline, the bottleneck is often not inference but preprocessing (image decode, resize, color conversion) or postprocessing (NMS, tracking). Profiling the full pipeline — not just the `invoke()` or `session.run()` call — reveals whether the accelerator is waiting for data. Pipelining preprocessing, inference, and postprocessing across separate threads or processes eliminates this serialization bottleneck.
