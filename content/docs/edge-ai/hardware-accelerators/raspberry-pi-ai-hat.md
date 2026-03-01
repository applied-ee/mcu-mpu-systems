---
title: "Raspberry Pi AI HAT+"
weight: 20
---

# Raspberry Pi AI HAT+

The Raspberry Pi AI HAT+ adds a Hailo-8L NPU to the Raspberry Pi 5, delivering 13 TOPS of INT8 inference throughput in an M.2 form factor mounted on a HAT+ (Hardware Attached on Top) board. The NPU connects over PCIe Gen 2 x1 — the first Pi to expose a PCIe lane for add-on hardware. This combination transforms the Pi 5 from a platform that struggles with real-time neural network inference into one that runs YOLOv8n object detection at 30+ FPS while the Arm CPU handles camera capture, display, and application logic.

## Hardware Overview

The AI HAT+ consists of two key components:

- **Hailo-8L NPU** — A dedicated neural network inference accelerator containing a dataflow architecture optimized for INT8 operations. The "L" (Lite) variant delivers 13 TOPS peak INT8 throughput, compared to 26 TOPS for the full Hailo-8. The chip is packaged in an M.2 2242 (Key B+M) module soldered to the HAT+ board.
- **HAT+ board** — Provides the M.2 socket, PCIe Gen 2 x1 edge connector that mates with the Pi 5's PCIe FPC (Flexible Printed Circuit) connector, and power regulation. The board sits above the Pi 5 using the standard 40-pin GPIO header standoffs, though it communicates via PCIe, not GPIO.

The PCIe Gen 2 x1 link provides up to 5 GT/s (roughly 500 MB/s effective throughput), which is sufficient for streaming model inputs and collecting outputs but can become a bottleneck for very large activation tensors or high-resolution input pipelines.

### Pi 5 as the Host Platform

The Raspberry Pi 5 uses a Broadcom BCM2712 SoC with a quad-core Arm Cortex-A76 at 2.4 GHz and a dedicated RP1 southbridge chip. The PCIe lane is exposed through an FPC connector on the board. Earlier Pi models (Pi 4, Pi 3, Pi Zero) lack PCIe entirely, making the AI HAT+ a Pi 5-only accessory.

Key Pi 5 specs relevant to AI HAT+ operation:

| Parameter | Value |
|-----------|-------|
| CPU | Cortex-A76 × 4 @ 2.4 GHz |
| RAM | 4 GB or 8 GB LPDDR4X |
| PCIe | Gen 2 x1 via FPC connector |
| Camera | 2× 4-lane MIPI CSI-2 |
| USB | 2× USB 3.0, 2× USB 2.0 |
| Power input | USB-C PD, 5V/5A recommended |

## Physical Setup and Configuration

### Hardware Installation

The AI HAT+ installs above the Pi 5 board. The process involves:

1. Attach the PCIe FPC ribbon cable between the Pi 5's PCIe connector and the HAT+ board's edge connector. The cable has a specific orientation — the contact side must face the correct direction on both ends.
2. Mount the HAT+ using standoffs through the GPIO header mounting holes.
3. Attach an active cooler to the Pi 5. The Hailo-8L generates heat under sustained inference, and the Pi 5 SoC also needs cooling. The official Pi 5 Active Cooler or a third-party solution with a fan is strongly recommended.

### Firmware and Config Requirements

PCIe must be explicitly enabled in the Pi 5's boot configuration:

```ini
# /boot/firmware/config.txt

# Enable PCIe external connector
dtparam=pciex1

# Optional: force Gen 2 speed (Gen 3 is experimental on Pi 5)
dtparam=pciex1_gen=2
```

After adding these lines and rebooting, the Hailo-8L should appear as a PCIe device:

```bash
lspci
# Expected output includes:
# 0000:01:00.0 Co-processor: Hailo Technologies Ltd. Hailo-8 AI Processor (rev 01)
```

The firmware on the Pi 5 must be up to date. Running `sudo rpi-update` or ensuring the latest Raspberry Pi OS release is installed covers this. Older firmware may not properly initialize the PCIe link.

### Software Installation

The Hailo software stack is available through the Raspberry Pi OS package repository on recent releases:

```bash
sudo apt update
sudo apt install hailo-all
```

This meta-package installs:

- **HailoRT** — The runtime library that communicates with the Hailo-8L over PCIe
- **hailortcli** — Command-line tool for device scanning, firmware queries, and benchmarking
- **rpicam-apps Hailo integration** — Post-processing stages for camera pipelines

Verify the device is recognized and operational:

```bash
hailortcli scan
# Expected: one device listed with firmware version and status

hailortcli fw-control identify
# Shows firmware version, serial number, and device state
```

## Hailo Software Stack

### HailoRT Runtime

HailoRT is the runtime library that manages communication between the host CPU and the Hailo-8L NPU. It handles:

- Device discovery and initialization over PCIe
- Model loading (HEF files) onto the NPU
- Input/output buffer management and DMA transfers
- Inference scheduling and completion notification
- Power management and device monitoring

The runtime exposes both C/C++ and Python APIs. For most Pi-based applications, the Python API or the rpicam-apps integration is sufficient.

### Hailo Model Zoo

Hailo maintains a Model Zoo with pre-compiled HEF files for common architectures:

- **Detection**: YOLOv5s/m/n, YOLOv8n/s, SSD-MobileNet
- **Classification**: ResNet-50, MobileNet-v2, EfficientNet-Lite
- **Segmentation**: DeepLabV3, YOLOv5-seg, YOLOv8n-seg
- **Pose estimation**: YOLOv8n-pose

These pre-compiled models are the fastest path to a working demo. Each HEF file is compiled specifically for the Hailo-8L (or Hailo-8) and includes all quantization, optimization, and scheduling decisions baked in.

### Hailo Dataflow Compiler (DFC)

The DFC is Hailo's model compilation toolchain that converts trained neural networks into HEF (Hailo Executable Format) files. This is the tool for deploying custom models. The DFC runs on an **x86 Linux host** — not on the Pi 5 itself. The compilation process is compute-intensive and benefits from a workstation-class machine.

## HEF Model Compilation Pipeline

The compilation pipeline transforms a trained model into an optimized binary for the Hailo-8L:

```
ONNX (or TF/TFLite) → Hailo Model Parser → HAR (Hailo Archive) → Optimization → HEF
```

### Step 1: Model Parsing

The DFC ingests models in ONNX format (preferred) or TensorFlow/TFLite format. The parser maps the model's computational graph to Hailo's internal representation:

```bash
hailo parser onnx yolov8n.onnx --hw-arch hailo8l
# Produces: yolov8n.har
```

The `--hw-arch hailo8l` flag targets the Hailo-8L specifically. Models compiled for the full Hailo-8 are not compatible with the Hailo-8L and vice versa.

### Step 2: Optimization and Quantization

The HAR file is then optimized. This step includes:

- **Quantization calibration** — The DFC requires a representative calibration dataset (typically 100–1000 input images) to determine optimal INT8 quantization parameters for each layer. Activations are profiled to find per-channel scale and zero-point values.
- **Layer fusion** — Adjacent operations (Conv + BatchNorm + ReLU) are fused into single hardware operations.
- **Memory allocation** — The compiler schedules intermediate buffer usage to fit within the NPU's on-chip SRAM.
- **Operator mapping** — Each layer is either mapped to the NPU's dataflow engine or flagged for CPU fallback.

```python
from hailo_sdk_client import ClientRunner

runner = ClientRunner(har="yolov8n.har", hw_arch="hailo8l")

# Load calibration dataset
calib_dataset = load_calibration_images("calib_images/", count=500)
runner.optimize(calib_dataset)

# Compile to HEF
runner.compile()
runner.save_har("yolov8n_quantized.har")

hef = runner.get_hw_representation()
with open("yolov8n.hef", "wb") as f:
    f.write(hef)
```

### Step 3: Validation

After compilation, the HEF model should be validated against the original float model to check for accuracy degradation from quantization:

```bash
hailo profiler yolov8n.hef
# Shows per-layer latency, NPU utilization, memory usage, and estimated FPS
```

The profiler output reveals which layers mapped to the NPU and which (if any) require CPU fallback. A fully mapped model shows 100% of layers on the NPU. Partial mapping is common with custom architectures.

### Operator Support

The Hailo-8L supports a defined set of operations. Commonly supported operators include:

- Conv2D, DepthwiseConv2D, TransposeConv2D
- FullyConnected (Dense)
- MaxPool2D, AveragePool2D, GlobalAveragePool2D
- Add, Multiply, Concatenate
- ReLU, ReLU6, LeakyReLU, Sigmoid, Softmax
- Reshape, Transpose, Resize

Operations **not** supported (examples that cause CPU fallback):

- Custom activation functions
- Dynamic shapes or control flow
- Some attention mechanisms (depending on version)
- Certain exotic normalization layers

The DFC documentation maintains the authoritative supported-operator list, which expands with compiler updates.

## rpicam-apps Integration

The Raspberry Pi camera stack (`rpicam-apps`) includes native Hailo integration through a post-processing framework. This is the simplest path to real-time inference on camera feeds.

### Pipeline Configuration

A JSON configuration file defines the post-processing pipeline:

```json
{
    "detection": {
        "hef_path": "/usr/share/hailo-models/yolov8n.hef",
        "labels_path": "/usr/share/hailo-models/coco.txt",
        "score_threshold": 0.5,
        "nms_threshold": 0.45,
        "output_order": "NCHW"
    }
}
```

Running the pipeline:

```bash
rpicam-hello --post-process-file detection.json -t 0
```

This launches the camera preview with real-time object detection overlays. The pipeline flow is:

1. Camera captures frames via MIPI CSI-2
2. Frames are scaled and color-converted for the model input
3. The preprocessed tensor is sent to the Hailo-8L over PCIe
4. NPU executes inference and returns output tensors
5. Post-processing (NMS, bounding box decoding) runs on the CPU
6. Detection overlays are drawn on the preview

### Detection Demo: YOLOv8n

YOLOv8n (nano) is the standard benchmark model for the AI HAT+. Expected performance characteristics:

| Parameter | Value |
|-----------|-------|
| Model | YOLOv8n (COCO 80 classes) |
| Input resolution | 640×640 |
| Inference time (NPU) | ~15–20 ms |
| End-to-end FPS | 30–40 FPS |
| Detection accuracy | mAP ~37% (COCO val) |

The end-to-end FPS includes camera capture, preprocessing, NPU inference, NMS post-processing, and display rendering. The NPU inference alone is faster than the end-to-end pipeline because preprocessing and post-processing run on the CPU.

Larger models like YOLOv8s achieve higher accuracy (~45% mAP) but drop to 15–20 FPS. YOLOv5n offers similar FPS to YOLOv8n with slightly lower accuracy.

### Segmentation Demo

Semantic segmentation models produce per-pixel class labels instead of bounding boxes. The rpicam-apps segmentation stage overlays color-coded masks on the camera preview:

```json
{
    "segmentation": {
        "hef_path": "/usr/share/hailo-models/yolov8n_seg.hef",
        "labels_path": "/usr/share/hailo-models/coco.txt",
        "score_threshold": 0.5
    }
}
```

Segmentation models are more compute-intensive than detection. YOLOv8n-seg runs at approximately 15–20 FPS on the Hailo-8L, compared to 30+ FPS for pure detection. The per-pixel output also requires more post-processing on the CPU.

### Pose Estimation

Pose estimation models detect human body keypoints (joints). YOLOv8n-pose runs at 25–30 FPS on the Hailo-8L, producing 17 COCO keypoints per detected person. The rpicam-apps framework includes a pose overlay stage that draws skeleton connections on the preview.

## Power and Thermal Characteristics

### Power Draw

The total system power draw under various conditions:

| State | Pi 5 + AI HAT+ Power |
|-------|----------------------|
| Idle (no inference) | ~5–6 W |
| Inference (YOLOv8n, 30 FPS) | ~12–15 W |
| Peak (burst inference + CPU post-processing) | ~16–18 W |

The Hailo-8L itself draws approximately 2–3 W under sustained inference load. The majority of the system power goes to the Pi 5's Cortex-A76 cores (camera pipeline, preprocessing, display) and LPDDR4X memory.

A 5V/5A (25W) USB-C power supply is recommended. The official Pi 5 power supply meets this requirement. Under-powered supplies (5V/3A) can cause voltage droop under inference load, leading to the Pi 5 throttling or displaying the low-voltage warning icon.

### Thermal Management

Without active cooling, the Pi 5 SoC reaches its thermal throttle point (85°C) within 5–10 minutes of sustained inference. The Hailo-8L also generates heat, though it has its own thermal management — reducing clock speed when the die temperature exceeds its internal threshold.

The practical requirement is an active cooler (fan + heatsink) on the Pi 5 SoC. The official Raspberry Pi Active Cooler mounts between the Pi 5 board and the HAT+, keeping SoC temperatures below 60°C under sustained inference load.

Passive heatsink-only configurations work for intermittent inference (a few seconds at a time with cooldown periods) but are not viable for continuous operation.

### Thermal Throttling Behavior

When thermal throttling occurs, it manifests as periodic FPS drops. The pattern is characteristic: inference runs at full speed for several minutes, then FPS drops by 30–50% for 10–30 seconds as the clock speed reduces, then recovers as the die cools. This cycle repeats indefinitely. Monitoring the CPU temperature during operation confirms whether throttling is the cause:

```bash
vcgencmd measure_temp
# Reports SoC temperature in degrees C
```

## Performance Comparison: NPU vs CPU-Only Inference

Running the same YOLOv8n model on the Pi 5's CPU using XNNPACK (TFLite's optimized CPU delegate) highlights the NPU's advantage:

| Metric | Hailo-8L (NPU) | Cortex-A76 (CPU, XNNPACK) |
|--------|----------------|---------------------------|
| Inference latency | ~15–20 ms | ~200–400 ms |
| End-to-end FPS | 30–40 | 2–5 |
| CPU utilization during inference | 20–30% | 100% (all 4 cores) |
| Power during inference | 12–15 W (total system) | 8–10 W (total system) |
| Throughput improvement | — | 10–20× slower |

The NPU delivers 10–20× higher throughput while leaving the CPU largely free for other tasks. CPU-only inference pins all four Cortex-A76 cores at 100%, leaving no headroom for camera capture, display rendering, or application logic.

This comparison illustrates why NPUs exist: the same math running on dedicated hardware achieves dramatically better throughput-per-watt than a general-purpose CPU.

## Tips

- **Start with pre-compiled HEF models from the Hailo Model Zoo.** These models are tested and optimized for the Hailo-8L. Custom model compilation introduces quantization, operator-support, and optimization variables that can delay initial bring-up.
- **Ensure PCIe is enabled in config.txt before first boot with the HAT+.** Without the `dtparam=pciex1` line, the Pi 5 does not initialize the PCIe link and the Hailo-8L is invisible to the system. Running `lspci` immediately after installation confirms whether the device is detected.
- **Active cooling is essential for sustained workloads.** A fan-equipped heatsink is not optional for continuous inference. Passive cooling leads to thermal throttling within minutes, producing inconsistent FPS and potential system instability.
- **Use batch size 1 for lowest latency.** The Hailo-8L processes single frames efficiently. Batching multiple frames increases throughput marginally but adds latency proportional to the batch size, which is undesirable for real-time camera applications.
- **Monitor with `hailortcli` during development.** The `hailortcli fw-control identify` command confirms the device is alive. The `hailortcli benchmark` command runs a synthetic throughput test that verifies the PCIe link and NPU are performing at expected levels.
- **Use 8 GB Pi 5 models for inference pipelines.** The 4 GB model works for simple single-model pipelines but leaves little headroom for camera buffers, display compositing, and application logic. Complex pipelines with multiple models or high-resolution inputs benefit from the extra memory.

## Caveats

- **Not all model architectures compile to HEF successfully.** Models with unsupported operators, dynamic shapes, or exotic layer types may partially compile (with CPU fallback for unsupported sections) or fail compilation entirely. Testing compilation early in the model design process avoids late-stage surprises.
- **Custom operators are generally not supported.** The Hailo DFC supports a defined set of standard neural network operators. Custom CUDA kernels, unusual activation functions, or framework-specific operations do not have Hailo equivalents.
- **Pi 4 and earlier models lack PCIe.** The AI HAT+ is physically and electrically incompatible with any Pi model before the Pi 5. There is no adapter or workaround.
- **The Hailo DFC requires an x86 Linux host for compilation.** HEF compilation cannot be done on the Pi 5 itself (Arm architecture). A separate x86_64 Linux workstation or VM is needed for the compilation step. Only the compiled HEF file is deployed to the Pi.
- **HEF models are hardware-specific.** A model compiled for the Hailo-8L (`--hw-arch hailo8l`) does not run on the full Hailo-8, and vice versa. The wrong HEF variant fails to load at runtime with a hardware mismatch error.
- **Quantization calibration dataset quality affects accuracy.** If the calibration images are not representative of the deployment domain (e.g., calibrating with ImageNet images for a medical imaging model), the INT8 quantization parameters may be suboptimal, degrading accuracy beyond what the quantization precision alone would cause.
- **PCIe link instability can occur with some third-party cases.** Cases that put mechanical stress on the FPC ribbon cable or that block airflow around the HAT+ can cause intermittent PCIe link drops, which appear as sudden inference failures or device-not-found errors.

## In Practice

- **rpicam-apps shows 0 FPS on the detection overlay** usually means the HEF model did not load onto the NPU. Running `hailortcli scan` confirms whether the device is detected. If the device is present but the model fails to load, the HEF file path in the JSON configuration may be incorrect, or the HEF was compiled for the wrong hardware variant.

- **Inference runs but detections are consistently wrong — misclassified objects, offset bounding boxes, or phantom detections** commonly appears when there is a preprocessing mismatch between the training pipeline and the HEF compilation. The most frequent cause is a normalization discrepancy: the model was trained with pixel values in [0, 1] or [-1, 1], but the HEF compilation assumed [0, 255] input range, or vice versa. The Hailo DFC allows specifying input normalization during compilation.

- **Thermal throttling appears as periodic FPS drops after 5–10 minutes of continuous inference.** The pattern is distinctive: steady 30+ FPS, then a drop to 15–20 FPS for 10–30 seconds, then recovery. This cycle repeats and is immediately resolved by adding active cooling. Checking `vcgencmd measure_temp` during a drop confirms SoC temperatures above 80°C.

- **Inference latency that is much higher than expected from the model's MAC count** often indicates partial CPU fallback. The Hailo profiler output shows which layers are mapped to the NPU and which run on the CPU. A single unsupported layer in the middle of the network forces data to transfer from NPU to CPU and back, adding PCIe transfer overhead on top of the CPU computation time.

- **The system crashes or becomes unresponsive during sustained inference with an undersized power supply.** The Pi 5 with AI HAT+ under full inference load draws 12–15 W. A 5V/3A (15W) supply has no margin, and voltage droop under transient load spikes causes the PMIC to trigger under-voltage protection. A lightning-bolt icon in the corner of the display is the Pi 5's under-voltage warning. Switching to the recommended 5V/5A supply eliminates this.

- **Detection overlay shows bounding boxes but no class labels** often results from a missing or incorrect labels file path in the JSON configuration. The detection post-processing stage needs a text file mapping class indices to human-readable names. The default COCO labels file is typically at `/usr/share/hailo-models/coco.txt`.

- **`hailortcli scan` reports no devices found** despite the HAT+ being physically installed points to a PCIe configuration issue. The most common cause is the missing `dtparam=pciex1` line in `/boot/firmware/config.txt`. After adding the line and rebooting, `lspci` should show the Hailo device. If `lspci` shows the device but `hailortcli scan` does not, the HailoRT driver may not be installed (`sudo apt install hailo-all` and reboot).
