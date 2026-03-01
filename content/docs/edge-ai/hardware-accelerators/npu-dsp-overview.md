---
title: "NPUs, DSPs & Accelerator Architectures"
weight: 10
---

# NPUs, DSPs & Accelerator Architectures

Neural network inference is dominated by a small set of compute-intensive operations — matrix multiplications, convolutions, and element-wise activations. A single layer of a modest convolutional network may require tens of millions of multiply-accumulate (MAC) operations. Running these on a general-purpose CPU means cycling through scalar or narrow SIMD instructions, burning power on instruction fetch, decode, and branch prediction that contributes nothing to the actual math. Dedicated hardware accelerators exist to collapse these operations into massively parallel, energy-efficient execution — but each accelerator architecture makes different trade-offs in flexibility, model constraints, and power efficiency.

## Why Inference Is Compute-Bound

The core operation in most neural network layers is a dot product: multiply two vectors element-wise, then sum the results. A fully connected layer computes one dot product per output neuron. A convolutional layer slides a kernel across a feature map, computing a dot product at every spatial position across every input-output channel pair. A single 3×3 convolution on a 128-channel input producing 256 output channels at 28×28 spatial resolution requires:

> 3 × 3 × 128 × 256 × 28 × 28 = 231 million MACs — for one layer.

A model with dozens of such layers requires billions of MACs per inference. This is why inference hardware is measured in MAC throughput, and why general-purpose CPUs — even fast ones — cannot keep up at low power budgets.

## MAC Arrays: The Fundamental Building Block

A MAC (Multiply-Accumulate) unit performs `a × b + c` in a single cycle. NPUs pack hundreds or thousands of these units into dense arrays that operate in parallel. The key insight is that matrix multiplications are inherently parallelizable: every output element is independent, so more MAC units directly translate to higher throughput — as long as data can be fed to them fast enough.

A 256-MAC array running at 500 MHz delivers 128 GMAC/s (giga MAC operations per second). For INT8 operations, each MAC involves two 8-bit multiplies and a 32-bit accumulation, so 128 GMAC/s corresponds to 256 GOPS (giga operations per second, counting multiply and add separately) — or 0.256 TOPS.

## NPU Architecture

Neural Processing Units are fixed-function or semi-programmable accelerators built specifically for tensor operations. The dominant architectural pattern is the **systolic array**: a 2D grid of MAC units where data flows through the array in a wave-like pattern, with each unit performing one multiply-accumulate and passing results to its neighbor.

### Dataflow Strategies

How weights, activations, and partial sums move through the array determines efficiency:

- **Weight-stationary** — Each MAC unit holds a fixed weight for the duration of a layer computation. Input activations stream through the array. This minimizes weight memory reads but requires activation data to be broadcast efficiently. Common in smaller NPUs where weight reuse is the priority.
- **Output-stationary** — Each MAC unit accumulates a single output element. Weights and activations both stream through. This minimizes partial-sum writes but requires both inputs to flow. Common in larger arrays.
- **Row-stationary** — A hybrid approach that maps entire rows of a convolution to rows of the systolic array, reusing all three data types (weights, activations, partial sums) within a row. Used in architectures like MIT's Eyeriss.

The dataflow choice is invisible to model developers but directly affects which layer shapes achieve high utilization. A weight-stationary NPU may underperform on depthwise convolutions (few weights, many activations), while an output-stationary design may struggle with layers that have small spatial dimensions.

### Arm Ethos-U55 and Ethos-U65

Arm's Ethos-U family targets microcontroller-class and application-processor-class deployment:

**Ethos-U55** is designed to pair with the Cortex-M55 (Armv8.1-M with Helium MVE). It is available in 128-MAC and 256-MAC configurations, runs at up to 500 MHz, and operates entirely from on-chip SRAM (no external DRAM interface). Peak throughput for the 256-MAC variant is 0.5 TOPS (INT8). The Ethos-U55 handles a defined set of operators (Conv2D, DepthwiseConv2D, FullyConnected, pooling, element-wise, etc.) while unsupported operators fall back to the Cortex-M55's Helium vector unit. The Vela compiler translates TFLite models into an optimized command stream for the NPU.

**Ethos-U65** targets Cortex-A class systems and is available in 256-MAC and 512-MAC configurations. It supports external AXI memory interfaces for larger models that exceed on-chip SRAM. Peak throughput reaches 1 TOPS (INT8) in the 512-MAC configuration. The Ethos-U65 has broader operator support and can handle more complex topologies, but the compilation constraints still apply — unsupported operators fall back to the CPU.

Both Ethos NPUs require INT8 (or INT16) quantized models. Float models must be quantized before compilation. The Vela compiler reports exactly which operators mapped to the NPU and which fell back to CPU, making it straightforward to identify bottlenecks.

### Qualcomm Hexagon DSP

Qualcomm's Hexagon DSP is a programmable digital signal processor found in Snapdragon SoCs. Unlike fixed-function NPUs, Hexagon is a general-purpose DSP with specialized extensions for ML workloads:

- **HVX (Hexagon Vector eXtensions)** — 1024-bit vector units that process 128 bytes per cycle. HVX handles 8-bit and 16-bit integer operations efficiently, making it well-suited for quantized inference.
- **Hexagon Tensor Processor (HTP)** — Later generations (Snapdragon 8 Gen 1 and newer) integrate a dedicated tensor accelerator alongside the HVX units, combining DSP flexibility with NPU-like throughput.
- **Hexagon Neural Network (HNN) library** — Qualcomm's optimized operator library maps common NN operations to HVX instructions. The Qualcomm AI Engine Direct SDK provides the compilation and runtime interface.

The Hexagon DSP's advantage over a pure NPU is flexibility: it can run arbitrary DSP code alongside ML inference, making it useful for audio preprocessing, sensor fusion, and other signal processing tasks that feed into or run alongside neural networks. The disadvantage is lower peak throughput-per-watt compared to a fixed-function NPU of similar die area.

## Accelerator Memory Hierarchies

The performance of any accelerator depends not just on its MAC throughput but on how fast data reaches the compute units. Every accelerator has a memory hierarchy, and understanding it explains why identical TOPS ratings can produce wildly different real-world performance.

### On-Chip SRAM

NPUs and DSPs include on-chip SRAM (typically 1–16 MB) that serves as a scratchpad for weights and activations during inference. When a model's working set fits entirely in SRAM, the MAC array operates at or near peak throughput. When it does not, the accelerator must stream data from external DRAM, which is 10–50× slower per access than SRAM.

The Ethos-U55 operates exclusively from on-chip SRAM shared with the Cortex-M55 — there is no external DRAM interface. This means the model's weights and activations must fit within the MCU's available SRAM (typically 512 KB to 4 MB depending on the SoC). The Ethos-U65, by contrast, has an AXI port to external DRAM, enabling larger models at the cost of memory bandwidth becoming a potential bottleneck.

The Google Coral Edge TPU has 8 MB of on-chip SRAM for parameter caching. Models with INT8 weights under 8 MB (like MobileNet-v2 at ~3.4 MB) run entirely from this cache. Larger models require repeated weight loads from host memory over USB or PCIe.

### External Memory Bandwidth

For accelerators attached to external DRAM, memory bandwidth directly limits inference throughput on large models. The Jetson Orin Nano provides 68 GB/s of LPDDR5 bandwidth, shared between CPU and GPU. The Hailo-8L receives data over a PCIe Gen 2 x1 link (~500 MB/s effective), which can constrain throughput when streaming large activation tensors.

A useful heuristic: if the total data movement per inference (input tensor + intermediate activations + output tensor) exceeds what the memory interface can deliver within the target latency, the workload is bandwidth-bound regardless of available TOPS.

### Weight Compression and Sparsity

Some accelerators support hardware-level weight decompression or sparsity exploitation to reduce memory bandwidth requirements:

- The Hailo-8L's dataflow architecture processes compressed weight representations internally
- NVIDIA's Ampere Tensor Cores support 2:4 structured sparsity, which doubles effective throughput for pruned models
- The Ethos-U55/U65 Vela compiler applies weight compression during model compilation

These features can shift a model from bandwidth-bound to compute-bound, effectively increasing the accelerator's real-world throughput without changing the peak TOPS rating.

## GPU Compute for ML

GPUs achieve parallelism through thousands of simple cores executing the same instruction on different data (SIMT — Single Instruction, Multiple Threads). For ML inference, this maps well to the parallel nature of matrix operations.

**NVIDIA Jetson (CUDA cores)** — Jetson modules contain Ampere or Orin-class GPUs with hundreds to thousands of CUDA cores plus dedicated Tensor Cores that accelerate INT8 and FP16 matrix operations. TensorRT optimizes models into fused GPU kernels. The Jetson Orin Nano, for example, has 1024 CUDA cores and 32 Tensor Cores delivering up to 40 TOPS (INT8, combining GPU and DLA).

**Arm Mali GPUs** — Found on Raspberry Pi, many Android SBCs, and application processors. Mali GPUs support OpenCL and Vulkan compute, and the Arm NN SDK can offload inference to them. However, Mali GPUs lack dedicated tensor units, so throughput for INT8 inference is significantly lower per watt than a dedicated NPU. A Mali-G76 GPU might achieve 1–3 TOPS depending on the SoC configuration.

## NPU vs DSP vs GPU Comparison

| Attribute | NPU | DSP (e.g., Hexagon) | GPU |
|-----------|-----|---------------------|-----|
| **Throughput/watt** | Highest for supported ops | Moderate | Lower (but high absolute throughput) |
| **Flexibility** | Low — fixed operator set | High — programmable | High — general compute |
| **Quantization** | INT8 required (usually) | INT8/INT16 preferred | FP16/FP32/INT8 |
| **Model constraints** | Strict topology/op limits | Moderate | Minimal |
| **Power draw** | 0.5–2W typical | 1–3W typical | 5–30W typical |
| **Typical TOPS** | 1–26 TOPS | 5–15 TOPS | 10–275 TOPS |
| **Best for** | High-volume, fixed models | Signal processing + ML | Large/complex models, multi-task |

## TOPS as a Metric

TOPS (Tera Operations Per Second) is the standard throughput metric for ML accelerators. One TOPS equals 10¹² integer operations per second. The number is derived from the MAC array size, clock speed, and operation width:

> TOPS = (MAC units) × (clock speed in GHz) × 2

The factor of 2 counts each MAC as two operations (one multiply, one add).

TOPS ratings are **peak theoretical** numbers calculated from the hardware's maximum parallelism at maximum clock speed. Sustained throughput on real models is always lower — often significantly lower — because:

- Not all layers map efficiently to the array (depthwise convolutions, small fully connected layers)
- Memory bandwidth limits how fast data reaches the MAC units
- Operator fallback to CPU stalls the accelerator pipeline
- Batch size 1 (common in real-time inference) leaves parts of the array idle

A 13 TOPS NPU running a real YOLOv8n model might sustain 3–5 TOPS effective throughput. This does not mean the hardware is defective — it means TOPS measures potential, not performance on a specific model.

## Choosing an Accelerator

The selection between NPU, DSP, and GPU depends on the deployment constraints:

- **Fixed model, high volume, ultra-low power** → NPU. If the model is known at design time, fits within the NPU's operator set, and the product ships in thousands or millions, an NPU delivers the best throughput per watt. Examples: always-on keyword detection, fixed object detection in a smart camera.
- **Mixed signal processing and ML** → DSP. If the system already uses a DSP for audio, radar, or sensor preprocessing, running ML inference on the same DSP avoids adding another chip. The Hexagon DSP in Snapdragon SoCs handles both audio processing and ML inference without data leaving the DSP subsystem.
- **Complex or evolving models, prototyping, multi-task** → GPU. If the model architecture is experimental, changes frequently, or the system runs multiple different models, a GPU's flexibility avoids the compilation constraints of NPUs. The Jetson platform supports any ONNX-exportable model without operator restrictions.
- **Hybrid approaches** are common in production SoCs. The Snapdragon 8 Gen series includes a Hexagon DSP, an Adreno GPU, and a dedicated NPU — the Qualcomm AI Engine routes each model to the most efficient accelerator based on the operator profile.

## Tips

- **Match model precision to accelerator strengths.** INT8 quantized models are mandatory for NPUs like the Ethos-U55 and Coral Edge TPU. FP16 is the sweet spot for GPU-based inference on Jetson. Running FP32 on a Tensor Core–equipped GPU wastes half the potential throughput.
- **Check operator support before model design.** Each NPU has a published list of supported operators. Designing a model around operators that the target NPU cannot execute results in CPU fallback and order-of-magnitude slowdowns. The Vela compiler (for Ethos), Edge TPU Compiler (for Coral), and Hailo DFC all report which operators mapped to hardware and which did not.
- **Use vendor profiling tools early.** Arm Ethos-U55 has the Vela compiler's performance estimator. NVIDIA provides `trtexec` for TensorRT profiling. Hailo provides the Hailo Profiler. These tools reveal bottlenecks before deployment hardware is even available.
- **Consider memory bandwidth alongside TOPS.** An accelerator with 10 TOPS but limited memory bandwidth (e.g., single-channel LPDDR4) may be bottlenecked on data movement for large activation tensors. Bandwidth-limited models include those with large spatial resolutions or high channel counts in early layers.

## Caveats

- **TOPS is not throughput.** Two accelerators with identical TOPS ratings can differ by 5× on the same model due to differences in operator support, memory bandwidth, dataflow architecture, and compiler optimization quality. Never compare accelerators solely on TOPS.
- **NPUs have strict operator and topology constraints.** A model that runs on one NPU may not compile for another. Even within the same NPU family, different compiler versions may support different operator sets. A single unsupported operator in the middle of a model can force the entire subsequent subgraph back to CPU.
- **Memory bandwidth often bottlenecks before compute.** NPUs and DSPs are designed to be compute-dense, but the SRAM or DRAM feeding them may not keep up. This is especially visible on models with large intermediate activations or on NPUs that rely on external DRAM (like the Ethos-U65 vs the SRAM-only Ethos-U55).
- **Depthwise convolutions are NPU-unfriendly.** MobileNet-style depthwise separable convolutions reduce total MACs but map poorly to systolic arrays because each filter operates on a single channel. NPU utilization on depthwise layers can drop below 10%, even though the operation is technically supported.
- **INT8 quantization is lossy.** Converting a float model to INT8 for NPU deployment can reduce accuracy, especially for models not designed with quantization in mind. Quantization-aware training (QAT) mitigates this but adds training complexity.

## In Practice

- **NPU utilization below 50% usually points to operator fallback.** The compiler mapped some layers to the NPU but unsupported operators forced other layers to run on the CPU. The NPU sits idle during CPU execution, dragging down average utilization. Compiler logs identify exactly which operators fell back.

- **A high TOPS rating paired with slow inference on a specific model commonly indicates a memory-bandwidth bottleneck or unsupported operators.** If the profiler shows the MAC array is idle waiting for data, bandwidth is the constraint. If the profiler shows CPU execution interspersed with NPU execution, operator fallback is the cause.

- **Inference latency that varies significantly between models of similar TOPS requirements often reflects dataflow mismatches.** A model with many small fully connected layers may underperform on a weight-stationary NPU compared to a model with fewer, larger convolutional layers — even though the total MAC count is similar.

- **Power consumption that exceeds the NPU's rated TDP during inference typically means the CPU is doing significant work.** If a 0.5W NPU is on a system drawing 3W during inference, the CPU is handling fallback operators, memory management, or pre/post-processing. Profiling the CPU alongside the NPU reveals where the power is going.

- **Sustained throughput declining over time on a passively cooled NPU often shows up as thermal throttling.** The NPU or surrounding SoC reduces clock speed to stay within thermal limits. Active cooling or duty-cycling the inference workload addresses this.
