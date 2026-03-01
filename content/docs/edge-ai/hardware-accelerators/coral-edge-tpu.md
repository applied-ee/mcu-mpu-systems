---
title: "Google Coral Edge TPU"
weight: 40
---

# Google Coral Edge TPU

The Google Coral Edge TPU is a purpose-built ASIC for neural network inference, delivering 4 TOPS of INT8 throughput at just 2 W of power. It occupies the low-power, low-cost end of the hardware accelerator spectrum — simpler and more constrained than the Hailo-8L or Jetson Orin Nano, but extremely efficient for models that fit within its operator and quantization requirements. The key design philosophy is that the Edge TPU runs *fully quantized INT8 models* with *supported operations only* — anything outside those bounds falls back to the host CPU, often with dramatic performance consequences.

## Hardware Overview

The Edge TPU is a single-chip ASIC designed by Google. It contains a systolic array of MAC units optimized for 8-bit integer matrix operations, on-chip SRAM for caching weights and activations, and a host interface controller. Key specifications:

| Parameter | Value |
|-----------|-------|
| Peak Throughput | 4 TOPS (INT8) |
| Power Draw | 2 W (at peak inference) |
| On-chip SRAM | 8 MB (for parameter caching) |
| Host Interface | USB 3.0 or PCIe Gen 2 x1 |
| Supported Precision | INT8 only |
| Process Node | 28 nm |

The 8 MB of on-chip SRAM is a critical architectural constraint. Models whose parameters fit entirely in this SRAM achieve the highest throughput because weights are loaded once and reused across all inferences. Models that exceed 8 MB of parameter storage require repeated weight transfers from host memory over USB or PCIe, which significantly reduces sustained throughput.

## Form Factors

Google offers the Edge TPU in multiple form factors, each targeting different integration scenarios:

### USB Accelerator

The most accessible form factor — a USB dongle containing the Edge TPU chip. It connects to any host computer (Linux, macOS, or Windows with limited support) via USB 3.0.

- **Interface**: USB 3.0 (5 Gbps)
- **Power**: Bus-powered from USB
- **Use case**: Prototyping, laptop-based development, adding inference to existing systems
- **Limitation**: USB bandwidth (effectively ~300 MB/s) and host USB stack latency

The USB Accelerator works with Raspberry Pi (all models with USB ports), x86 Linux workstations, and single-board computers. It is the simplest way to add Edge TPU inference to an existing system.

### M.2 Accelerator

A compact M.2 module for embedded integration:

- **M.2 A+E key** — Fits in Wi-Fi card slots on many mini-ITX boards and laptops
- **M.2 B+M key** — Fits in NVMe/SATA slots on carrier boards

Both variants connect over PCIe Gen 2 x1 (2.5 GT/s, ~200 MB/s effective) or USB 2.0, depending on the host's M.2 implementation. The PCIe connection delivers lower latency and higher sustained throughput than USB.

- **Use case**: Permanent integration into embedded products, edge gateways, industrial systems
- **Advantage over USB**: Lower latency, no USB stack overhead, physically secure mounting

### Dev Board

A complete single-board computer built around the Edge TPU:

- **SoC**: NXP i.MX8M Quad (4× Cortex-A53 @ 1.5 GHz)
- **Memory**: 1 GB LPDDR4
- **Storage**: 8 GB eMMC
- **Edge TPU**: Connected via PCIe internally
- **Camera**: MIPI CSI-2 input
- **Connectivity**: Wi-Fi, Bluetooth, Gigabit Ethernet
- **GPIO**: 40-pin header (Pi-compatible layout)

The Dev Board runs Mendel Linux (Debian-based) and provides a complete development platform without needing a separate host computer. The i.MX8M SoC handles camera capture, networking, and application logic while the Edge TPU handles inference.

### Dev Board Mini

A smaller, lower-cost variant:

- **SoC**: MediaTek MT8167S (4× Cortex-A35 @ 1.3 GHz)
- **Memory**: 2 GB LPDDR3
- **Edge TPU**: Connected internally
- **Camera**: MIPI CSI-2
- **Use case**: Cost-optimized prototyping, compact form factor demos

The Dev Board Mini trades CPU performance and I/O for a smaller footprint and lower cost. The Cortex-A35 cores are significantly slower than the i.MX8M's Cortex-A53 cores, which affects preprocessing and post-processing throughput.

## Edge TPU Compiler

The Edge TPU Compiler transforms a TensorFlow Lite INT8 quantized model into an Edge TPU-optimized binary. This compilation step is mandatory — TFLite models do not run on the Edge TPU directly.

### Compilation Flow

```
Trained Model (TF/PyTorch) → TFLite Converter (full integer quantization) → Edge TPU Compiler → Edge TPU Model (.tflite, annotated)
```

The compiler takes a standard `.tflite` file as input and produces another `.tflite` file with Edge TPU-specific annotations. The output file retains the `.tflite` extension but contains compiled segments that the Edge TPU runtime recognizes and offloads to hardware.

```bash
edgetpu_compiler model_quant.tflite

# Output:
# model_quant_edgetpu.tflite
# Compilation log showing operator mapping
```

### Strict Constraints

The Edge TPU Compiler enforces several hard requirements:

1. **Full integer quantization** — Every tensor in the model must be INT8 quantized, including inputs and outputs. Models with float inputs, float outputs, or mixed-precision layers cannot be fully compiled. Post-training quantization with `representative_dataset` in TFLite achieves this:

```python
import tensorflow as tf

converter = tf.lite.TFLiteConverter.from_saved_model("saved_model/")
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_data_gen
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.uint8
converter.inference_output_type = tf.uint8
tflite_model = converter.convert()

with open("model_quant.tflite", "wb") as f:
    f.write(tflite_model)
```

2. **Supported operations only** — The Edge TPU supports a limited set of TFLite operations. Supported operations include:

| Operation | Notes |
|-----------|-------|
| Conv2D | Standard and dilated |
| DepthwiseConv2D | Standard depthwise separable |
| TransposeConv2D | Deconvolution |
| FullyConnected | Dense layers |
| AveragePool2D | — |
| MaxPool2D | — |
| Reshape | — |
| Concatenation | Along channel axis |
| Add | Element-wise |
| Mul | Element-wise |
| Logistic (Sigmoid) | — |
| Softmax | — |
| L2Normalization | — |
| ResizeBilinear | Limited parameter range |
| ResizeNearestNeighbor | Limited parameter range |

Operations **not** in this list run on the host CPU. Common unsupported operations include: custom activations, Swish/SiLU, GELU, layer normalization, multi-head attention, and many operations introduced after the Edge TPU's operator set was defined.

3. **Single-segment mapping** — The compiler maps a contiguous portion of the model graph to the Edge TPU. If an unsupported operation appears in the middle of the model, everything after it (in graph traversal order) also falls back to CPU. The optimal case is 100% of operations mapped to the TPU. The worst case is a single unsupported op early in the graph that forces most of the model to CPU.

### Compiler Output Analysis

The compiler prints a mapping summary:

```
Edge TPU Compiler version 16.0.384591198
Input: model_quant.tflite
Output: model_quant_edgetpu.tflite

Operator                       Count      Status
QUANTIZE                       1          Mapped to Edge TPU
CONV_2D                        15         Mapped to Edge TPU
DEPTHWISE_CONV_2D              13         Mapped to Edge TPU
AVERAGE_POOL_2D                1          Mapped to Edge TPU
FULLY_CONNECTED                1          Mapped to Edge TPU
RESHAPE                        1          Mapped to Edge TPU
SOFTMAX                        1          Mapped to Edge TPU

Number of operations that will run on Edge TPU: 33
Number of operations that will run on CPU: 0
```

A clean compilation shows 0 operations on CPU. Any operations listed as "will run on CPU" degrade performance — sometimes by orders of magnitude if they are in the critical path.

## PyCoral API

PyCoral is Google's high-level Python library for Edge TPU inference. It wraps the lower-level `libedgetpu` C++ runtime and provides task-specific helper functions.

### Classification

```python
from pycoral.adapters import classify
from pycoral.adapters import common
from pycoral.utils.edgetpu import make_interpreter
from PIL import Image

# Load compiled Edge TPU model
interpreter = make_interpreter("mobilenet_v2_quant_edgetpu.tflite")
interpreter.allocate_tensors()

# Prepare input
image = Image.open("test.jpg").resize(common.input_size(interpreter))
common.set_input(interpreter, image)

# Run inference
interpreter.invoke()

# Get classification results
classes = classify.get_classes(interpreter, top_k=5, score_threshold=0.3)
for c in classes:
    print(f"Class {c.id}: score={c.score:.3f}")
```

### Detection

```python
from pycoral.adapters import detect
from pycoral.adapters import common
from pycoral.utils.edgetpu import make_interpreter
from PIL import Image

interpreter = make_interpreter("ssd_mobilenet_v2_quant_edgetpu.tflite")
interpreter.allocate_tensors()

image = Image.open("test.jpg").resize(common.input_size(interpreter))
common.set_input(interpreter, image)
interpreter.invoke()

detections = detect.get_objects(interpreter, score_threshold=0.5)
for det in detections:
    print(f"ID={det.id} Score={det.score:.2f} BBox={det.bbox}")
```

### Pipeline API

For large models that exceed a single Edge TPU's capacity, PyCoral provides a pipeline API that splits the model across multiple Edge TPUs. Each TPU handles a segment of the model, passing intermediate activations to the next TPU in the chain. This requires multiple USB Accelerators or M.2 modules:

```python
from pycoral.pipeline import pipelined_model_runner
# Configure model segments across multiple Edge TPU devices
```

Model pipelining increases total throughput for large models but adds latency proportional to the number of pipeline stages. It is most effective for batch processing where throughput matters more than per-frame latency.

## libedgetpu Runtime

The `libedgetpu` library is the C++ runtime that communicates directly with the Edge TPU hardware. PyCoral and the TFLite Edge TPU delegate both use `libedgetpu` internally.

Three variants are available:

- **libedgetpu-max** — Maximum clock speed, highest throughput, highest power draw (~2W)
- **libedgetpu-throttled** — Reduced clock speed, lower power (~1W), reduced throughput
- **libedgetpu (default)** — Standard operating frequency

Switching between variants:

```bash
# Install max-frequency runtime
sudo apt install libedgetpu1-max

# Or install throttled (reduced power) runtime
sudo apt install libedgetpu1-std
```

Only one variant can be installed at a time. Switching requires reinstalling the package and restarting any running inference processes.

## Performance Benchmarks

The Edge TPU excels at small, fully-quantized models. Representative benchmarks:

| Model | Task | Inference Time | FPS |
|-------|------|---------------|-----|
| MobileNet-v2 (INT8) | Classification (224×224) | ~2 ms | ~500 |
| MobileNet-v1 SSD (INT8) | Detection (300×300) | ~6 ms | ~160 |
| EfficientNet-Lite0 (INT8) | Classification (224×224) | ~3 ms | ~330 |
| EfficientDet-Lite0 (INT8) | Detection (320×320) | ~12 ms | ~83 |
| DeepLab-v3 MobileNet-v2 | Segmentation (257×257) | ~15 ms | ~67 |

These numbers are for the Edge TPU inference time only, excluding preprocessing and post-processing on the host CPU. End-to-end FPS depends heavily on the host's CPU performance and the preprocessing pipeline.

### Comparison with Hailo-8L and Jetson Orin Nano

| Attribute | Edge TPU | Hailo-8L | Jetson Orin Nano |
|-----------|----------|----------|------------------|
| TOPS | 4 (INT8) | 13 (INT8) | 40 (INT8, GPU+DLA) |
| Power | ~2 W | ~2–3 W | 7–15 W |
| Precision | INT8 only | INT8 only | FP32/FP16/INT8 |
| Operator Set | Very limited | Moderate | Broad (CUDA) |
| Model Format | TFLite (compiled) | HEF | TensorRT engine |
| Compilation | Edge TPU Compiler | Hailo DFC (x86) | trtexec (on-device) |
| Price | ~$25–60 (USB) | ~$70 (HAT+) | ~$250 (dev kit) |
| Multi-model | Via pipelining | Single model typical | Multi-model on GPU |
| Best For | Simple, small models at ultra-low power | Mid-complexity models, Pi 5 integration | Complex models, multi-stream, flexibility |

The Edge TPU's advantage is power efficiency and cost for simple models. A MobileNet-v2 classification running at 500 FPS on 2 W is extremely efficient — roughly 250 inferences per milliwatt-second. The disadvantage is the strict compilation constraints that make deploying anything beyond standard MobileNet-family architectures challenging.

## Tips

- **Design models around the supported operator set from the start.** Retrofitting a model to avoid unsupported operations after training is time-consuming and may require architectural changes. Consulting the Edge TPU supported-ops list before model design prevents compilation surprises.
- **Use full integer quantization, not just weight quantization.** TFLite's "dynamic range quantization" only quantizes weights, leaving activations in float. The Edge TPU requires both weights and activations to be INT8. The `representative_dataset` calibration step in TFLite's converter is mandatory.
- **Test compilation before investing in large-scale training.** Compiling a small prototype model (same architecture, fewer layers) verifies that the model structure maps fully to the Edge TPU before spending hours or days on training.
- **USB 3.0 is required for full throughput on the USB Accelerator.** USB 2.0 ports (480 Mbps) limit data transfer bandwidth and add latency. A USB 2.0 connection can reduce effective inference throughput by 2–3× for models with large input tensors.
- **Use the `libedgetpu-max` variant for benchmarking and production.** The default runtime operates at a reduced clock to balance power and thermal. The max variant delivers the full 4 TOPS.
- **Prefer MobileNet-family architectures.** MobileNet-v1, MobileNet-v2, and EfficientNet-Lite are designed with depthwise separable convolutions and standard operations that map cleanly to the Edge TPU. These architectures consistently achieve near-100% TPU mapping.
- **Cache models in the Edge TPU's SRAM by keeping parameter count under 8 MB.** Models whose INT8 weights fit in the 8 MB on-chip SRAM avoid repeated parameter transfers from host memory. MobileNet-v2 (INT8) has approximately 3.4 MB of parameters, comfortably within this limit.

## Caveats

- **Float operations silently fall back to the CPU.** There is no runtime error or warning — the model runs, but any non-INT8 operations execute on the host CPU at orders-of-magnitude lower throughput. A model that appears to "work" may be running 90% on the CPU without any visible indication except slow inference speed.
- **Large models may not fully map to the Edge TPU.** The compiler maps a contiguous subgraph to the TPU. If the model exceeds the TPU's capacity or contains unsupported operations, the remaining operations run on the CPU. The compilation log is the only way to verify mapping completeness.
- **USB 2.0 bandwidth limits throughput.** Many single-board computers (including older Pi models) have USB 2.0 ports that are shared across a hub. Connecting the USB Accelerator to a USB 2.0 port or a congested USB 3.0 hub degrades throughput below what the Edge TPU can actually deliver.
- **No training on the Edge TPU.** The Edge TPU is inference-only. On-device learning, fine-tuning, or transfer learning is not supported in hardware. Any training must happen off-device, and the resulting model must go through the full quantization and compilation pipeline before deployment.
- **The Edge TPU Compiler is a separate install from the runtime.** The compiler runs on x86 Linux and produces the compiled `.tflite` file. The runtime (`libedgetpu`) runs on the deployment host (Arm or x86). These are separate packages and both must be the correct version.
- **Model pipelining across multiple Edge TPUs adds complexity.** Splitting a model requires careful segmentation, and the pipeline API adds latency from inter-TPU data transfer. For most embedded applications, designing a smaller model that fits on a single TPU is simpler and more reliable.
- **Thermal throttling on the USB form factor is common.** The USB Accelerator has no heatsink and relies on passive cooling through its plastic case. Under sustained inference, the chip heats up and reduces clock speed. This is especially noticeable in enclosed environments or when the ambient temperature is above 30°C.

## In Practice

- **A model compiles but only 20% of operations are mapped to the Edge TPU.** The compilation log shows which operations ran on TPU and which fell back to CPU. The usual cause is an unsupported operation early in the model graph that forces everything after it to CPU. Replacing or removing the unsupported operation and recompiling often increases TPU mapping dramatically — sometimes from 20% to 100%.

- **The USB Accelerator is slower than expected despite the model being fully mapped to the TPU.** Checking the USB bus speed with `lsusb -t` reveals whether the device is connected at USB 3.0 (5000M) or USB 2.0 (480M). A USB 2.0 connection bottlenecks data transfer to and from the TPU. Moving the dongle to a USB 3.0 port (blue connector, typically) resolves this.

- **Inference latency varies between runs on the USB Accelerator.** A pattern of fast inference (2 ms) followed by occasional slow inference (10–20 ms) typically indicates thermal throttling. The USB form factor has limited thermal dissipation. Adding a small heatsink to the dongle's case or providing airflow reduces the variation. Alternatively, switching to the `libedgetpu-std` (throttled) runtime reduces peak power and heat at the cost of consistent-but-lower throughput.

- **A model that works perfectly in TFLite on the CPU produces incorrect results on the Edge TPU.** This almost always traces to a quantization issue. The INT8 quantization parameters (scale and zero-point) may be poorly calibrated if the representative dataset does not match the deployment data distribution. Comparing the Edge TPU output against the TFLite CPU output on identical inputs reveals whether the discrepancy is in the quantization or the TPU execution. Rerunning quantization with a better representative dataset typically resolves accuracy issues.

- **The Edge TPU Compiler refuses to compile a model with the error "model not fully quantized."** This occurs when the TFLite model contains float tensors — typically the input or output tensors. The converter must be configured with `inference_input_type = tf.uint8` and `inference_output_type = tf.uint8` in addition to the `representative_dataset` calibration. Omitting either setting leaves those tensors in float, which the Edge TPU cannot process.

- **A model that runs at 500 FPS in isolation only achieves 30 FPS in an end-to-end application.** The Edge TPU inference time is often a small fraction of the total pipeline. Image capture, preprocessing (resize, normalization, color conversion), post-processing (NMS, bounding box decoding), and display rendering all run on the host CPU. On a Raspberry Pi 3 or similar low-power host, CPU-side processing dominates total latency. Profiling the full pipeline reveals where time is spent, and optimizing the host-side code (using NumPy vectorization, reducing input resolution, or skipping display rendering) closes the gap.

- **Two USB Accelerators on the same host both enumerate but only one processes inference.** The `libedgetpu` runtime assigns devices by index. Application code must explicitly specify which device to use for each model. The PyCoral `make_interpreter` function accepts a `device` parameter (`:0`, `:1`) to select between multiple Edge TPUs. Without explicit device assignment, both models may attempt to use the same device while the second sits idle.
