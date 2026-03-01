---
title: "NVIDIA Jetson Orin Nano"
weight: 30
---

# NVIDIA Jetson Orin Nano

The Jetson Orin Nano is NVIDIA's entry-level module in the Orin family, delivering up to 40 TOPS of AI inference throughput from an Ampere-architecture GPU combined with a Deep Learning Accelerator (DLA). Unlike NPU-based platforms that restrict models to INT8 quantized operators from a fixed set, the Jetson's GPU-centric architecture runs arbitrary CUDA workloads — meaning virtually any model that can be expressed as a computational graph can execute on this hardware, with TensorRT providing the optimization layer between framework models and GPU execution.

## Hardware Overview

The Jetson Orin Nano module packs a complete AI inference system into a compact SO-DIMM–style form factor:

| Parameter | Jetson Orin Nano (8GB) |
|-----------|----------------------|
| GPU | Ampere, 1024 CUDA cores, 32 Tensor Cores |
| CPU | 6× Arm Cortex-A78AE @ 1.5 GHz |
| Memory | 8 GB LPDDR5, 68 GB/s bandwidth |
| AI Performance | 40 TOPS (INT8, GPU + DLA combined) |
| DLA | 1× NVDLA v2.0 |
| Video Encode | 1× 1080p60 H.265 |
| Video Decode | 1× 4K60 H.265 |
| PCIe | Gen 4 x4 + Gen 4 x1 |
| CSI | Up to 4 MIPI CSI-2 lanes |
| Power | 7W – 15W configurable |
| Storage | M.2 NVMe (Key M) |

The 40 TOPS figure combines GPU Tensor Core throughput and the DLA's INT8 performance. The GPU alone (1024 CUDA cores + 32 Tensor Cores) delivers the majority of this throughput for most models. The DLA provides additional inference capacity for models that can be fully mapped to its supported operator set.

### Jetson Orin Nano vs Orin NX

The Orin NX is the step-up module in the same family:

| Parameter | Orin Nano (8GB) | Orin NX (8GB) | Orin NX (16GB) |
|-----------|----------------|---------------|----------------|
| CUDA Cores | 1024 | 1024 | 1024 |
| Tensor Cores | 32 | 32 | 32 |
| DLA | 1× NVDLA | 1× NVDLA | 2× NVDLA |
| Memory | 8 GB LPDDR5 | 8 GB LPDDR5 | 16 GB LPDDR5 |
| Memory BW | 68 GB/s | 102 GB/s | 102 GB/s |
| AI TOPS | 40 | 70 | 100 |
| CPU Cores | 6× A78AE | 6× A78AE | 8× A78AE |
| Power | 7–15W | 10–25W | 10–25W |

The Orin NX's higher TOPS comes primarily from its additional DLA (the 16GB variant has two DLAs), higher memory bandwidth, and ability to clock the GPU higher within its larger power envelope. For workloads that are GPU-only (no DLA), the Orin Nano and Orin NX 8GB perform similarly. The 16 GB Orin NX's doubled memory is critical for larger models or multi-model pipelines.

## JetPack 6 Setup

JetPack is NVIDIA's BSP (Board Support Package) for Jetson, bundling the Linux kernel, drivers, and AI software stack. JetPack 6 is based on Ubuntu 22.04 and L4T (Linux for Tegra) R36.x.

### What JetPack 6 Includes

- **L4T (Linux for Tegra)** — NVIDIA's customized Ubuntu with Jetson-specific kernel drivers, device trees, and firmware
- **CUDA 12.x** — GPU compute toolkit
- **cuDNN 8.x** — Deep learning primitives library (convolution, pooling, normalization, RNN)
- **TensorRT 8.6+** — High-performance inference optimizer and runtime
- **OpenCV 4.x** — Built with CUDA support
- **VPI (Vision Programming Interface)** — Hardware-accelerated computer vision primitives
- **Multimedia API** — Hardware video encode/decode (NVENC/NVDEC)
- **DeepStream SDK** — GStreamer-based video analytics framework

### Installation

The Orin Nano developer kit boots from an NVMe SSD or SD card. The standard setup process:

1. Download the JetPack 6 SD card image from NVIDIA's developer site
2. Flash the image to an NVMe SSD (preferred for performance) or microSD card using `dd`, Balena Etcher, or NVIDIA's SDK Manager
3. Boot the Orin Nano developer kit and complete Ubuntu initial setup
4. Run `sudo apt update && sudo apt upgrade` to pull the latest JetPack component updates

Alternatively, NVIDIA's SDK Manager (running on an x86 Ubuntu host) can flash the module over USB in recovery mode, which provides more control over partition layout and component selection.

Verifying the installation:

```bash
# Check JetPack version
cat /etc/nv_tegra_release

# Verify CUDA
nvcc --version

# Verify TensorRT
dpkg -l | grep tensorrt

# Check GPU status
nvidia-smi  # Note: not available on Jetson; use tegrastats instead
tegrastats
```

The `tegrastats` utility is the Jetson equivalent of `nvidia-smi`, reporting GPU utilization, CPU utilization, memory usage, power draw, and temperatures in real time.

## TensorRT Engine Building

TensorRT is the critical performance layer on Jetson. It takes a trained model (typically in ONNX format) and produces an optimized **engine** — a binary that maps the model's computation graph to GPU-specific kernel implementations with layer fusion, precision calibration, and memory optimization.

### The Optimization Pipeline

```
Trained Model (PyTorch/TF) → ONNX Export → TensorRT Engine Builder → Serialized Engine (.engine)
```

### Using trtexec

`trtexec` is TensorRT's command-line engine builder and benchmarking tool:

```bash
# Build FP16 engine from ONNX model
trtexec --onnx=yolov8n.onnx \
        --saveEngine=yolov8n_fp16.engine \
        --fp16 \
        --workspace=1024 \
        --verbose

# Build INT8 engine with calibration
trtexec --onnx=yolov8n.onnx \
        --saveEngine=yolov8n_int8.engine \
        --int8 \
        --calib=calibration_cache.txt \
        --workspace=1024

# Benchmark an existing engine
trtexec --loadEngine=yolov8n_fp16.engine \
        --batch=1 \
        --iterations=1000
```

Engine building can take 5–30 minutes depending on model complexity and optimization level. The builder tries thousands of kernel configurations (autotuning) to find the fastest implementation for each layer on the specific GPU hardware.

### Precision Modes

| Mode | Accuracy | Throughput | Use Case |
|------|----------|------------|----------|
| FP32 | Baseline | 1× | Debugging, accuracy validation |
| FP16 | ~0.1% accuracy loss | 2–3× vs FP32 | Default for most deployments |
| INT8 | 0.5–2% accuracy loss | 3–5× vs FP32 | Maximum throughput, requires calibration |

**FP16** is the recommended default on Jetson Orin Nano. The Tensor Cores natively accelerate FP16 matrix operations, delivering roughly 2–3× the throughput of FP32 with negligible accuracy loss for most models.

**INT8** provides the highest throughput but requires a calibration step. During calibration, representative input data is fed through the FP32 model to determine the dynamic range of each tensor. These ranges are used to compute INT8 quantization parameters (scale and zero-point). Poor calibration data leads to accuracy degradation.

### Layer Fusion

TensorRT's optimizer fuses adjacent layers into single GPU kernels to reduce memory bandwidth and kernel launch overhead:

- Conv + BatchNorm + ReLU → single fused kernel
- Conv + Add (residual) + ReLU → single fused kernel
- Fully Connected + activation → single fused kernel

Layer fusion is automatic and transparent. The engine builder's verbose output logs which fusions were applied, which is useful for diagnosing performance issues.

### Engine Portability

TensorRT engines are **not portable** between different GPU architectures or even different TensorRT versions. An engine built on the Jetson Orin Nano (Ampere SM 8.7) does not run on a Jetson Nano (Maxwell), an x86 desktop GPU (different SM version), or even the same Orin Nano with a different TensorRT version. Engines must be built on the deployment target hardware.

This is a deliberate design choice: engines are optimized for the specific GPU's instruction set, register file size, shared memory configuration, and kernel implementations. Portability would sacrifice performance.

### Python and C++ APIs

TensorRT provides both Python and C++ inference APIs. A minimal Python inference example:

```python
import tensorrt as trt
import pycuda.driver as cuda
import pycuda.autoinit
import numpy as np

# Load serialized engine
runtime = trt.Runtime(trt.Logger(trt.Logger.WARNING))
with open("yolov8n_fp16.engine", "rb") as f:
    engine = runtime.deserialize_cuda_engine(f.read())

context = engine.create_execution_context()

# Allocate GPU memory for input and output
input_shape = (1, 3, 640, 640)
input_size = int(np.prod(input_shape) * np.float16().itemsize)
d_input = cuda.mem_alloc(input_size)

output_shape = engine.get_binding_shape(1)
output_size = int(np.prod(output_shape) * np.float16().itemsize)
d_output = cuda.mem_alloc(output_size)

# Transfer input, execute, transfer output
input_data = np.random.randn(*input_shape).astype(np.float16)
cuda.memcpy_htod(d_input, input_data)
context.execute_v2([int(d_input), int(d_output)])
output_data = np.empty(output_shape, dtype=np.float16)
cuda.memcpy_dtoh(output_data, d_output)
```

The C++ API follows the same pattern but avoids Python overhead, which matters for latency-critical applications. The C++ path typically achieves 10–20% lower latency than Python for small models where host-side overhead is a significant fraction of total time.

## DeepStream SDK

DeepStream is NVIDIA's GStreamer-based framework for building multi-stream video analytics pipelines. It provides hardware-accelerated video decode, inference, tracking, and metadata handling — all connected through GStreamer's pipeline model.

### Pipeline Architecture

A typical DeepStream pipeline:

```
Input Source → Decode (NVDEC) → Preprocessing → Inference (nvinfer) → Tracker → Analytics → Output
```

Each stage is a GStreamer plugin:

- **nvv4l2decoder** — Hardware video decode using NVDEC
- **nvstreammux** — Batches frames from multiple input sources
- **nvinfer** — TensorRT inference plugin (loads .engine files)
- **nvtracker** — Object tracking (IOU, DeepSORT, NvDCF)
- **nvdsosd** — On-Screen Display for bounding boxes and labels
- **nvmsgconv + nvmsgbroker** — Metadata output to Kafka, MQTT, etc.

### Multi-Stream Processing

DeepStream's primary advantage is efficient multi-stream processing. A single Orin Nano pipeline can process 4–8 simultaneous 1080p streams at reduced FPS, or 1–2 streams at full frame rate, depending on model complexity.

```
# Example: 4-stream detection pipeline in DeepStream config
[source0]
enable=1
type=3
uri=rtsp://camera1:554/stream

[source1]
enable=1
type=3
uri=rtsp://camera2:554/stream

[primary-gie]
enable=1
model-engine-file=yolov8n_fp16.engine
batch-size=4
```

The `nvstreammux` plugin batches frames from all sources into a single tensor batch, so the GPU processes all streams in one inference call — far more efficient than running separate inference instances per stream.

### Metadata Pipeline

DeepStream attaches structured metadata to each frame as it flows through the pipeline. Each inference result, tracked object, and classification label is stored in a metadata tree accessible from any downstream plugin or application callback. This metadata can be serialized to JSON and published to message brokers (Kafka, AMQP, MQTT) for cloud analytics without extracting or re-encoding video frames.

## Power Modes

The Jetson Orin Nano supports two primary power modes controlled by `nvpmodel`:

| Mode | Power Limit | GPU Clock | CPU Cores | Use Case |
|------|------------|-----------|-----------|----------|
| 15W (Mode 0) | 15 W | Max | All 6 | Maximum performance |
| 7W (Mode 1) | 7 W | Reduced | 4 of 6 | Battery/thermal-constrained |

```bash
# Check current power mode
sudo nvpmodel -q

# Set maximum performance mode
sudo nvpmodel -m 0

# Set low-power mode
sudo nvpmodel -m 1

# Maximize clocks within current power mode
sudo jetson_clocks
```

Performance scaling between 7W and 15W mode is roughly 1.5–2×. A model running at 30 FPS in 15W mode typically achieves 15–20 FPS in 7W mode. The `jetson_clocks` command locks all clocks at their maximum for the selected power mode, preventing dynamic frequency scaling from introducing latency variation.

### Power Monitoring

Real-time power monitoring through `tegrastats`:

```bash
tegrastats --interval 1000
# Output includes: GPU%, CPU%, memory, temperatures, and power rail readings
# Example line:
# RAM 3200/7620MB ... GR3D_FREQ 76% ... VDD_CPU_GPU_CV 8500mW VDD_SOC 2100mW
```

The `VDD_CPU_GPU_CV` rail reports combined CPU+GPU power. Under inference load, this reading shows how much of the power budget is consumed and whether the system is near its limit.

## CUDA and GPU Inference

### When to Use Raw CUDA vs TensorRT

TensorRT is the right choice for deploying trained models — it handles the optimization and kernel selection automatically. Raw CUDA is appropriate for:

- Custom pre/post-processing that is not expressible as standard NN operations
- Non-ML GPU compute (image processing, signal processing, physics simulation)
- Prototyping custom operators before integrating them into a TensorRT plugin
- Workloads that combine ML inference with other GPU compute tasks

On the Orin Nano, CUDA 12.x supports the full Ampere instruction set. The 32 Tensor Cores accelerate matrix operations in FP16, BF16, INT8, and INT4 formats through CUDA's `wmma` (Warp Matrix Multiply-Accumulate) API or through cuBLAS/cuDNN which use Tensor Cores automatically.

## Isaac ROS

Isaac ROS is NVIDIA's collection of hardware-accelerated ROS 2 packages for robotics applications on Jetson. These packages leverage the GPU, DLA, and VPI to accelerate common robotics perception tasks:

- **Isaac ROS AprilTag** — GPU-accelerated AprilTag detection for fiducial markers, achieving 5–10× the throughput of the CPU-based AprilTag3 library
- **Isaac ROS Stereo Depth** — Hardware-accelerated stereo disparity computation using the GPU or VPI
- **Isaac ROS Visual SLAM** — GPU-accelerated visual-inertial odometry for robot localization
- **Isaac ROS Object Detection** — TensorRT-based detection integrated with ROS 2 message types
- **Isaac ROS DNN Inference** — Generic TensorRT and Triton inference nodes for ROS 2

Isaac ROS packages are distributed as pre-built Docker containers or Debian packages. They integrate with standard ROS 2 Humble message types and topic conventions, so they drop into existing ROS 2 graphs.

## Camera Integration

### CSI Cameras

The Orin Nano developer kit supports MIPI CSI-2 cameras through its onboard CSI connector. Common options:

- **Raspberry Pi Camera Module v2** (IMX219, 8MP) — Widely supported, basic quality
- **Raspberry Pi Camera Module v3** (IMX708, 12MP) — Autofocus, wider dynamic range
- **IMX477-based modules** (12MP) — Higher quality sensor, commonly used in industrial applications
- **e-con Systems and Leopard Imaging modules** — Multi-camera kits for stereo and surround-view applications

CSI cameras are captured through GStreamer's `nvarguscamerasrc` plugin, which handles ISP (Image Signal Processing) on the Jetson's hardware ISP:

```bash
# GStreamer pipeline for CSI camera capture at 1080p30
gst-launch-1.0 nvarguscamerasrc ! \
    'video/x-raw(memory:NVMM), width=1920, height=1080, framerate=30/1' ! \
    nvvidconv ! videoconvert ! autovideosink
```

### USB Cameras

USB cameras (webcams, industrial USB3 cameras) are captured through V4L2:

```bash
gst-launch-1.0 v4l2src device=/dev/video0 ! \
    video/x-raw, width=1920, height=1080, framerate=30/1 ! \
    videoconvert ! nvvidconv ! \
    'video/x-raw(memory:NVMM)' ! autovideosink
```

The `nvvidconv` element transfers frames from CPU memory to GPU memory (NVMM), which is required for downstream GPU-accelerated processing. Without this conversion, frames remain in CPU memory and GPU-based inference requires an additional copy step.

## Comparison with Raspberry Pi AI HAT+

| Attribute | Jetson Orin Nano | Pi 5 + AI HAT+ |
|-----------|-----------------|-----------------|
| AI Throughput | 40 TOPS | 13 TOPS |
| Accelerator Type | GPU (CUDA + Tensor Cores) + DLA | NPU (Hailo-8L) |
| Precision | FP32/FP16/INT8 | INT8 only |
| Model Flexibility | Any ONNX-exportable model | Hailo-supported operators only |
| Model Format | TensorRT engine (.engine) | HEF (.hef) |
| Power Draw | 7–15 W (module only) | 12–15 W (total system) |
| RAM | 8 GB LPDDR5 (shared CPU/GPU) | 4/8 GB LPDDR4X (CPU only) |
| Price | ~$250 (dev kit) | ~$70 (Pi 5) + ~$70 (HAT+) |
| Multi-stream | DeepStream, 4–8 streams | Single stream typical |
| Ecosystem | CUDA, TensorRT, DeepStream, Isaac ROS | rpicam-apps, Hailo Model Zoo |
| Compilation Host | On-device (build engine on Jetson) | x86 Linux (Hailo DFC) |

The Jetson Orin Nano is the more powerful and flexible platform but at a higher price and power budget. The Pi AI HAT+ is the better choice for single-stream, single-model deployments where INT8 quantization is acceptable and the model fits within the Hailo operator set. The Jetson excels when model flexibility (FP16, complex architectures), multi-stream processing, or GPU compute beyond inference is required.

## Tips

- **Always build TensorRT engines on the deployment device.** Engines are hardware-specific and not portable. Building on an x86 workstation with a desktop GPU produces an engine that fails to load on Jetson. The engine build step must run on the actual Orin Nano (or an identical module).
- **Use FP16 as the default precision.** FP16 delivers 2–3× the throughput of FP32 with negligible accuracy loss on nearly all models. Start with FP16 and only move to INT8 if additional throughput is needed and calibration data is available.
- **Set `nvpmodel -m 0` and run `sudo jetson_clocks` during development.** This ensures maximum and consistent GPU performance, eliminating dynamic frequency scaling as a variable during profiling and benchmarking.
- **Use DeepStream for multi-stream applications.** Running separate inference processes per camera stream wastes GPU resources on kernel launch overhead and memory duplication. DeepStream's batched inference processes all streams in a single GPU call.
- **Profile with `trtexec` before integrating into application code.** The `trtexec` benchmarking mode reports per-layer latency, GPU utilization, and memory usage. This isolates model performance from application overhead.
- **Use NVMe storage for model loading.** Large TensorRT engines (100+ MB) load noticeably faster from NVMe than from SD card. Engine deserialization time is I/O-bound for large models.
- **Monitor with `tegrastats` during inference.** Real-time visibility into GPU utilization, memory usage, temperatures, and power draw reveals whether the system is compute-bound, memory-bound, or thermally limited.

## Caveats

- **TensorRT engines are not portable between Jetson models.** An engine built on the Orin Nano does not run on the Orin NX, Xavier NX, or any other Jetson variant. Each deployment target requires its own engine build. This also applies across TensorRT versions on the same hardware.
- **INT8 calibration requires a representative dataset.** The calibration dataset must reflect the actual deployment data distribution. Calibrating an object detection model with ImageNet classification images produces poor quantization parameters and accuracy degradation.
- **JetPack major versions are not in-place upgradeable.** Moving from JetPack 5 to JetPack 6 requires a full reflash. The kernel, drivers, and CUDA stack are tightly integrated, and partial upgrades lead to version mismatches and runtime failures.
- **8 GB RAM limits concurrent model size.** GPU memory is shared with the CPU. A large TensorRT engine (e.g., YOLOv8x at FP16) plus camera buffers plus display buffers can exceed available memory. The system falls back to swap, which destroys inference performance. Multiple simultaneous models require careful memory budgeting.
- **The DLA has a more restricted operator set than the GPU.** Not all TensorRT layers can be offloaded to the DLA. Unsupported layers fall back to the GPU, and the data transfer between DLA and GPU adds latency. DLA is most beneficial for simple, fully-supported models running alongside GPU inference of a different model.
- **Power supply requirements are strict.** The Orin Nano developer kit requires a USB-C PD supply or barrel jack providing the full power budget. Undersized supplies cause brownouts under load, which may corrupt the filesystem on NVMe or SD card.

## In Practice

- **A TensorRT engine built on an x86 workstation fails to load on Jetson** with a deserialization error. This is the most common deployment mistake. Engines encode GPU-specific kernel selections and memory layouts. The solution is always to build the engine on the target Jetson device, even though it takes longer.

- **Inference latency that spikes periodically during sustained operation** commonly indicates thermal throttling. The `tegrastats` output shows GPU and CPU temperatures alongside clock speeds. When the die temperature exceeds the thermal limit (typically ~95°C for the module), `nvpmodel` reduces clocks until the temperature drops. Active cooling (the developer kit's fan or a custom heatsink solution) eliminates this. The `jetson_clocks --show` command reveals whether clocks are at their configured maximum.

- **DeepStream pipeline drops frames from one or more input streams** while other streams process normally. This typically appears when downstream processing (inference, tracking, or analytics) cannot keep up with the input frame rate. The GStreamer queue elements between pipeline stages fill up and start dropping frames. Reducing the input frame rate, simplifying the model, or reducing the number of streams resolves the issue. The `gst-debug` log level reveals where in the pipeline the bottleneck occurs.

- **A model that runs well in PyTorch produces incorrect results after TensorRT conversion** often traces to dynamic shape handling or unsupported operations. TensorRT replaces unsupported ops with plugins or removes them, which can silently change model behavior. Comparing TensorRT engine output against PyTorch output on identical inputs, layer by layer, isolates the problematic operation. The `--verbose` flag during engine building logs which layers were fused, replaced, or removed.

- **GPU utilization shown by `tegrastats` stays below 30% during inference** despite latency being higher than expected. This pattern usually indicates that the bottleneck is outside the GPU — CPU-side preprocessing, data transfer, or Python overhead. Profiling with NVIDIA's Nsight Systems reveals the timeline of CPU and GPU activity, showing idle gaps where the GPU waits for data.

- **Memory usage steadily increases during extended operation** and eventually causes an out-of-memory crash. This is typically a GPU memory leak in application code — allocated CUDA buffers not being freed, or TensorRT contexts being created without being destroyed. The `tegrastats` memory readings track this over time. Python applications using PyCUDA or the TensorRT Python API are especially prone to this if buffer management is not explicit.
