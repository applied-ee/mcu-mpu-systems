---
title: "Inference on Cortex-M"
weight: 10
---

# Inference on Cortex-M

The Arm Cortex-M family is the dominant target for TinyML inference. These processors have no operating system, no virtual memory, and no heap allocator in typical deployments. Execution is deterministic — a given model on a given input produces the same result in the same number of cycles every time, provided memory placement is controlled. All memory management is static: model weights reside in flash, the tensor arena occupies a fixed region of SRAM, and the application firmware shares both address spaces. The entire inference pipeline — from sensor input to classification output — runs in a single-threaded main loop or a pinned RTOS task with no context-switch overhead affecting latency.

This determinism is the reason Cortex-M targets dominate safety-critical and latency-sensitive edge inference applications. There are no garbage collection pauses, no page faults, and no TLB misses. The cost of that determinism is absolute: every byte of SRAM and flash must be accounted for at compile time, and a model that exceeds either limit simply does not deploy.

## Cortex-M4: The Baseline ML Target

The Cortex-M4 is the entry point for practical TinyML. Its key architectural features for inference:

- **Single-cycle MAC instruction** (`MLA`) — one multiply-accumulate per clock cycle for 32-bit integers.
- **DSP extensions** — SIMD instructions operating on packed 16-bit values (`SMLAD`, `SMLALD`). Two 16-bit multiply-accumulates execute per cycle, which CMSIS-NN exploits for int8 inference by packing two int8 values into a 16-bit lane.
- **Optional FPU** — Single-precision (float32) floating-point unit. Present on the M4F variant (e.g., STM32F4, nRF52840) but not on all M4 devices. Without the FPU, any float operation falls back to a software implementation that is 10–50x slower.
- **Typical memory**: 256 KB–1 MB flash, 128–320 KB SRAM.

Representative devices:

| Device | Flash | SRAM | FPU | Clock |
|--------|-------|------|-----|-------|
| STM32F446RE | 512 KB | 128 KB | Yes (SP) | 180 MHz |
| STM32F407VG | 1 MB | 192 KB | Yes (SP) | 168 MHz |
| nRF52840 | 1 MB | 256 KB | Yes (SP) | 64 MHz |
| STM32L476RG | 1 MB | 128 KB | Yes (SP) | 80 MHz |

On a Cortex-M4 at 168 MHz, a keyword-spotting DS-CNN model (25K parameters, int8 quantized) runs in approximately 30–50 ms per inference with CMSIS-NN. A MobileNetV1 0.25 image classifier at 96x96 input resolution takes approximately 500 ms — usable for periodic classification but not real-time video.

## Cortex-M7: More Headroom

The Cortex-M7 adds architectural improvements that directly benefit inference throughput:

- **Dual-issue pipeline** — Two instructions can issue per clock cycle in favorable conditions, improving instruction throughput by 30–60% over the M4 for compute-bound loops.
- **Double-precision FPU** — Both float32 and float64 hardware support. Rarely relevant for inference (which targets int8) but useful for preprocessing stages that involve floating-point math.
- **Instruction and data caches** — Typically 16 KB I-cache and 16 KB D-cache. These accelerate access to external memory (QSPI flash, SDRAM) but introduce variability if the arena or model data is in cacheable regions.
- **Tightly-coupled memory (TCM)** — DTCM (data TCM) and ITCM (instruction TCM) provide zero-wait-state access, bypassing the cache hierarchy. Placing the tensor arena in DTCM ensures deterministic inference timing.
- **Typical memory**: 1–2 MB flash, 512 KB–1 MB SRAM (split across DTCM, SRAM1, SRAM2, etc.).

Representative devices:

| Device | Flash | SRAM | TCM | Clock |
|--------|-------|------|-----|-------|
| STM32H743ZI | 2 MB | 1 MB | 128 KB DTCM + 64 KB ITCM | 480 MHz |
| STM32F767ZI | 2 MB | 512 KB | 128 KB DTCM + 16 KB ITCM | 216 MHz |
| i.MX RT1060 | — (ext.) | 1 MB | 512 KB DTCM + 512 KB ITCM | 600 MHz |
| STM32H750VB | 128 KB | 1 MB | 128 KB DTCM + 64 KB ITCM | 480 MHz |

The same MobileNetV1 0.25 at 96x96 that takes ~500 ms on a Cortex-M4 completes in approximately 200 ms on a Cortex-M7 at 480 MHz. The dual-issue pipeline and higher clock rate account for most of the improvement, with caches providing additional benefit when weights are accessed from internal flash.

## Cortex-M33: Security-Partitioned ML

The Cortex-M33 introduces TrustZone for Cortex-M — hardware-enforced security partitioning between secure and non-secure worlds. For ML inference, this enables:

- **Secure model storage** — Model weights and inference code run in the secure partition, inaccessible to non-secure application code. This protects proprietary models from extraction via firmware dumps.
- **Secure sensor data** — Sensor inputs can be routed through the secure world, ensuring raw data (e.g., audio, accelerometer) is processed by the ML model before any non-secure code can access it.
- **DSP extensions** — The M33 provides the same DSP/SIMD instructions as the M4 (packed 16-bit MAC operations). Inference performance is comparable to the M4 at equivalent clock speeds.

Devices like the STM32L552 (512 KB flash, 256 KB SRAM, 110 MHz) and the nRF5340 (1 MB flash, 512 KB SRAM, 128 MHz application core + 256 KB network core) target applications where model confidentiality or data privacy is a requirement.

## Cortex-M55: Vector Extensions and the Helium Path

The Cortex-M55 represents a generational leap for ML inference on microcontrollers. Its key addition is Helium, also called the M-Profile Vector Extension (MVE):

- **128-bit SIMD** — Helium provides 128-bit vector registers and instructions that operate on 8-bit, 16-bit, and 32-bit data types natively. Sixteen int8 multiply-accumulate operations execute per vector instruction, compared to two on the M4's DSP extensions.
- **Predication** — Helium uses tail-predicated loops that handle non-multiple-of-vector-width data without scalar cleanup code, simplifying compiler output and reducing code size.
- **Throughput** — On ML workloads, the M55 achieves 4–8x higher throughput than the M4 at equivalent clock speeds. A convolution layer that takes 10 ms on an M4 at 168 MHz completes in approximately 1.5–2.5 ms on an M55 at 200 MHz.

The Cortex-M55 is often paired with the Ethos-U55 or Ethos-U65 NPU in reference designs like the Arm Corstone-300 and Corstone-310. The M55 handles control flow, preprocessing, and operators that the NPU does not support, while the Ethos-U accelerates the supported operators (primarily convolutions, depthwise convolutions, pooling, and element-wise operations).

## CMSIS-NN: Optimized Kernels for Every Cortex-M

CMSIS-NN is Arm's library of neural network operator kernels, hand-optimized in assembly for each Cortex-M variant. It integrates directly with TensorFlow Lite Micro (TFLM) and provides the performance-critical inner loops for inference.

### Key Operators

| Function | Operation | Notes |
|----------|-----------|-------|
| `arm_convolve_s8` | 2D convolution, int8 | Uses SIMD on M4/M7, Helium on M55 |
| `arm_depthwise_conv_s8` | Depthwise convolution, int8 | Core of MobileNet-style architectures |
| `arm_fully_connected_s8` | Fully connected / dense, int8 | Matrix-vector multiply with quantized output |
| `arm_softmax_s8` | Softmax, int8 | Fixed-point approximation, no FPU needed |
| `arm_avgpool_s8` | Average pooling, int8 | Spatial reduction |
| `arm_max_pool_s8` | Max pooling, int8 | Spatial reduction |
| `arm_elementwise_add_s8` | Element-wise addition, int8 | For residual connections |
| `arm_relu_s8` | ReLU activation, int8 | Clamp-to-zero, extremely fast |

CMSIS-NN operators require specific tensor layouts. All convolution and pooling operators expect **NHWC** format (batch, height, width, channels). Models trained in frameworks that default to NCHW (e.g., PyTorch) must be transposed during conversion to TFLite format — the TFLite converter handles this automatically for standard architectures, but custom operations may require manual layout adjustment.

### Performance Impact

The difference between CMSIS-NN and the TFLM reference kernels is dramatic:

| Model | Input | M4 (Reference) | M4 (CMSIS-NN) | Speedup |
|-------|-------|-----------------|----------------|---------|
| DS-CNN (keyword spotting) | 49x10 MFCC | 220 ms | 35 ms | 6.3x |
| MobileNetV1 0.25 (image) | 96x96x3 | 2800 ms | 500 ms | 5.6x |
| Anomaly detection (FC) | 128 features | 3 ms | 0.5 ms | 6x |

The reference kernels are plain C implementations with no architecture-specific optimization. They exist for portability and correctness verification. Shipping a product with reference kernels instead of CMSIS-NN is one of the most common causes of unexpectedly slow inference — and there is no warning or error when the fallback occurs.

## Flash vs. SRAM Layout

Understanding the memory map is essential for deploying models on Cortex-M. The two primary memory regions serve different roles:

### Flash (Read-Only, Code-Mapped)

- **Model weights** — The TFLite FlatBuffer containing all trained parameters. Accessed directly via pointer (zero-copy). On STM32, internal flash is typically at `0x0800_0000`.
- **Application firmware** — The compiled code (text segment), including the TFLM interpreter, CMSIS-NN kernels, peripheral drivers, and application logic.
- **Constant data** — Lookup tables, calibration data, configuration parameters.

### SRAM (Read-Write)

- **Tensor arena** — The pre-allocated buffer for all inference-time data (activations, scratch buffers, input/output tensors).
- **Stack** — Typically 4–16 KB depending on call depth and local variable usage.
- **Heap** — Often zero or minimal in bare-metal ML firmware.
- **Global variables** — Peripheral driver state, application buffers, communication buffers.

### Memory Budget Example

Consider the STM32F446RE (512 KB flash, 128 KB SRAM):

```
Flash (512 KB total):
├── Firmware (text + rodata):  ~100 KB
├── Model weights (FlatBuffer): ~350 KB  (leaving ~60 KB margin)
└── Available:                   ~62 KB

SRAM (128 KB total):
├── Tensor arena:               ~80 KB
├── Stack:                       ~8 KB
├── Peripheral buffers:         ~16 KB
├── Global variables:           ~8 KB
└── Available:                  ~16 KB
```

The critical insight: SRAM is almost always the binding constraint, not flash. A model with 400 KB of weights (fitting comfortably in 512 KB flash) might need 120 KB of tensor arena — exceeding the 128 KB SRAM entirely before accounting for stack, peripherals, and application state.

## STM32Cube.AI

STM32Cube.AI is ST Microelectronics' model deployment tool, integrated into the STM32CubeIDE and also available as a command-line tool. It imports models from multiple frameworks and generates optimized C code for STM32 targets.

### Supported Input Formats

- TensorFlow Lite (`.tflite`) — int8 quantized and float32
- ONNX (`.onnx`) — exported from PyTorch, scikit-learn, and other frameworks
- Keras (`.h5` / SavedModel) — direct import from TensorFlow/Keras

### Key Features

- **Memory footprint analyzer** — Reports exact flash and SRAM usage before generating code. Breaks down usage by layer, showing which layers dominate the activation memory budget.
- **Validation mode** — Runs the generated C model against the reference Python model on the same input, comparing outputs. Catches quantization errors, preprocessing mismatches, and operator implementation differences.
- **Operator library** — ST's own optimized kernels, independent of CMSIS-NN. In some cases, these achieve better performance than CMSIS-NN on STM32-specific hardware features (e.g., ART accelerator cache behavior on STM32F7/H7).
- **Compression** — Supports weight compression (4-bit, pruning-aware) to reduce flash footprint beyond standard int8 quantization.

### Workflow

1. Open STM32CubeMX, enable the X-CUBE-AI middleware pack.
2. Import the model (`.tflite`, `.onnx`, or `.h5`).
3. Run the analyzer — view per-layer flash and SRAM usage, total footprint.
4. Validate against reference — provide a test input, compare output numerically.
5. Generate code — produces `network.c`, `network.h`, and `network_data.h` containing the model and inference functions.
6. Integrate into application — call `ai_network_run()` with input buffer, read output buffer.

The analyzer step is particularly valuable during model architecture exploration. Checking whether a candidate model fits the target's memory constraints before training saves significant iteration time.

## Ethos-U55 on Cortex-M55

The Ethos-U55 is Arm's microNPU, designed as a companion accelerator for Cortex-M55 (and M85) processors. It is not a standalone processor — it operates as a bus-mastering peripheral that the M55 CPU configures and triggers.

### Architecture

- **MAC units**: 128 or 256, configurable at silicon design time. The 256-MAC variant doubles peak throughput.
- **Supported operators**: Convolution (standard, depthwise, transposed), pooling (average, max), element-wise operations (add, multiply), fully connected, softmax, reshape, concatenate. Approximately 50 operator types.
- **Unsupported operators**: Custom operations, certain activation functions, and operators with non-standard configurations fall back to the Cortex-M55 CPU. The Vela compiler reports which operators are placed on the NPU vs. CPU.
- **Data types**: int8 and int16 activations and weights.

### Vela Compiler

The Vela compiler is the tool that optimizes a TFLite model for the Ethos-U hardware:

```bash
vela model.tflite --accelerator-config ethos-u55-256 \
    --optimise Performance \
    --memory-mode Shared_Sram
```

Vela produces an optimized `.tflite` file where NPU-compatible operators are fused into custom Ethos-U operators. The TFLM runtime loads this optimized model and dispatches Ethos-U operators to the NPU via the Ethos-U driver, while remaining operators execute on the M55 CPU.

### Performance Comparison

Approximate inference times for MobileNetV2 (0.35 alpha, 96x96x3 input, int8 quantized):

| Target | Clock | Inference Time |
|--------|-------|----------------|
| Cortex-M4 (STM32F4, 168 MHz) | 168 MHz | ~500 ms |
| Cortex-M7 (STM32H7, 480 MHz) | 480 MHz | ~200 ms |
| Cortex-M55 (Helium, 250 MHz) | 250 MHz | ~50 ms |
| Cortex-M55 + Ethos-U55 (256 MAC) | 250 MHz + 250 MHz | ~5 ms |

The Ethos-U55 achieves a 10x speedup over the M55 alone because the convolution and depthwise convolution layers — which dominate MobileNet inference time — run entirely on the NPU's dedicated MAC array. The M55 CPU is free to perform preprocessing for the next frame while the NPU completes inference on the current frame.

## Tips

- Use CMSIS-NN with TFLM instead of the reference kernels. The performance difference is 5–10x on identical hardware. On Cortex-M4 and M7, the reference kernels produce correct results but at speeds that are unusable for real-time applications. There is no compile-time or runtime warning when reference kernels are used instead of CMSIS-NN.
- Target int8 quantization for all Cortex-M inference. The DSP SIMD instructions on M4/M7 operate on packed 16-bit data, and CMSIS-NN packs two int8 values into each 16-bit lane for maximum throughput. Float32 models bypass these fast paths entirely and require the FPU, which is scalar and much slower for the matrix-multiply patterns in neural networks.
- Keep the tensor arena in internal SRAM, not external memory. On STM32H7 devices with external SDRAM or QSPI-mapped PSRAM, placing the arena in external memory introduces access latency that can double inference time. DTCM on M7 provides zero-wait-state access and is the optimal location for the arena.
- Profile with STM32Cube.AI's analyzer before committing to a model architecture. The analyzer reveals per-layer memory usage, making it possible to identify which layers dominate the SRAM budget and whether architectural changes (reducing channel count, adding early pooling) can bring the model within the target's constraints.
- On Cortex-M7, place the tensor arena in DTCM (address `0x2000_0000` on most STM32H7 devices) to avoid cache-related timing variability. D-cache hits and misses create run-to-run latency variation that can exceed 30% on arena data placed in cacheable SRAM regions.
- When using Ethos-U55, run the Vela compiler with `--verbose-performance` to get a per-operator breakdown of NPU vs. CPU placement. Operators that fall back to the CPU can become unexpected bottlenecks.

## Caveats

- **SRAM is the binding constraint, not flash.** A model with 400 KB of weights fits comfortably in 512 KB flash, but if that model requires a 150 KB tensor arena, it will not run on a device with 128 KB SRAM. The arena contains all intermediate activations, and a single layer with large spatial dimensions and many channels can push the arena requirement beyond the SRAM budget. Always check arena size before flash size.
- **CMSIS-NN operators require NHWC tensor layout.** Models exported from PyTorch in NCHW format must be transposed during conversion. The TFLite converter handles this for standard architectures, but custom models or manually constructed graphs may retain NCHW layout, causing CMSIS-NN to produce incorrect results without raising an error.
- **Cortex-M4 without FPU falls back to software floating-point.** On M4 variants without the `F` suffix (e.g., some STM32L4 parts), any floating-point operation invokes a software emulation library that is 20–50x slower than hardware float. A float32 model that runs in 200 ms on an M4F device may take 5+ seconds on an M4 without FPU. Int8 quantized models avoid this entirely by using integer arithmetic only.
- **Ethos-U55 accelerates a subset of operators.** The Vela compiler report shows which operators target the NPU and which fall back to the M55 CPU. Unsupported operators — including some activation functions, certain reshape patterns, and custom operations — execute on the CPU at M55 speed. A model with 95% of compute in NPU-supported ops and 5% in unsupported ops can still see 20–30% of wall-clock time spent on the CPU fallback.
- **STM32Cube.AI and TFLM use different operator implementations.** Models validated in STM32Cube.AI may produce slightly different numerical outputs than the same model running on TFLM with CMSIS-NN. The differences are typically within int8 quantization noise (1 LSB) but can accumulate across deep networks, occasionally changing classification outcomes on borderline inputs.
- **The M7 data cache can cause non-deterministic inference timing.** If the tensor arena is placed in a cacheable SRAM region, the first inference after boot (cold cache) may take 30–50% longer than subsequent runs. Background DMA activity from peripherals can also evict cache lines mid-inference, causing sporadic latency spikes.

## In Practice

- **Model deploys but inference takes several seconds on Cortex-M4.** The most likely cause is that CMSIS-NN is not linked — the build is using TFLM's reference C kernels instead. Checking the build log for `cmsis_nn` or `CMSIS_NN` symbols confirms whether the optimized kernels are included. Switching from reference to CMSIS-NN typically improves inference time by 5–10x with no model changes.
- **Hard fault during inference.** This almost always indicates a tensor arena overflow. The `AllocateTensors()` call succeeded because the arena appeared large enough, but a specific operator's scratch buffer allocation exceeds the remaining space during `Invoke()`. The fix is to increase the arena size. On devices where SRAM is fully committed, the model architecture must be reduced (fewer channels, smaller input resolution, or early pooling to shrink activations).
- **Model accuracy is correct on PC but wrong on MCU.** Two primary causes: first, int8 quantization was not properly calibrated — the representative dataset used for post-training quantization did not cover the input distribution, causing clipping or resolution loss in certain value ranges. Second, preprocessing mismatch — the PC pipeline normalizes inputs to `[0, 1]` float, but the MCU code feeds raw `[0, 255]` uint8 values without applying the quantization scale and zero-point. Checking `input->params.scale` and `input->params.zero_point` against the preprocessing code reveals the discrepancy.
- **Inference time varies between runs on Cortex-M7.** This is a cache effect. When the tensor arena resides in a cacheable SRAM bank (e.g., SRAM1 at `0x3000_0000` on STM32H7), D-cache hits and misses create timing variability. Placing the arena in DTCM (`0x2000_0000`) provides zero-wait-state access with no caching, eliminating the variability entirely. Alternatively, locking the relevant cache lines (via MPU region configuration) prevents eviction but reduces available cache for other firmware activity.
- **Ethos-U55 inference is slower than expected.** The Vela compiler report (`--verbose-performance`) shows operator placement. If a significant number of operators fall back to the CPU, the M55 becomes the bottleneck. Common causes include unsupported activation functions (e.g., Swish or GELU not mapped to NPU), tensor shapes that violate NPU alignment requirements, or operator configurations (e.g., large dilations) that the NPU does not support. Restructuring the model to use NPU-friendly operators (ReLU6, standard convolutions, supported pooling modes) improves NPU utilization.
- **STM32Cube.AI validation passes but on-device results differ from Python.** This occurs when the validation input in STM32Cube.AI is preprocessed differently than the real-time sensor pipeline on the MCU. The validation step uses data already in the correct format, but the live firmware may apply different normalization, different sampling rates, or different windowing. Logging the raw input tensor values on the MCU and comparing byte-for-byte with the validation input isolates the preprocessing stage where divergence occurs.
