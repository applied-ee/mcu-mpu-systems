---
title: "ONNX Runtime & Edge Variants"
weight: 30
---

# ONNX Runtime & Edge Variants

ONNX (Open Neural Network Exchange) is an open model interchange format that allows models trained in one framework — PyTorch, TensorFlow, scikit-learn, XGBoost — to run on a shared inference runtime. The format defines a standard set of operators (organized into versioned "opsets"), a graph-based computation representation, and a serialization scheme using Protocol Buffers. ONNX Runtime (ORT) is Microsoft's high-performance inference engine for ONNX models, supporting execution on CPUs, GPUs, NPUs, and DSPs through a pluggable **execution provider** architecture.

Where [TensorFlow Lite]({{< relref "tflite-linux" >}}) is tightly coupled to the TensorFlow ecosystem — models originate from `tf.lite.TFLiteConverter` and target TFLite's specific operator set — ONNX Runtime is framework-agnostic. A PyTorch model exported via `torch.onnx.export()` and a TensorFlow model converted via `tf2onnx` can both run through the same ORT inference session, using the same execution providers. This flexibility makes ONNX Runtime the standard choice for projects that need to support models from multiple training frameworks or that target hardware with ONNX-native acceleration (Qualcomm QNN, Apple CoreML, NVIDIA TensorRT).

## The ONNX Format

An ONNX model file (`.onnx`) is a Protocol Buffers binary containing:

- **Model metadata** — IR version, opset version(s), producer name and version.
- **Graph definition** — A directed acyclic graph of nodes (operators), each with typed inputs, outputs, and attributes. Edges are tensors with defined shapes and data types.
- **Initializers** — Weight tensors stored inline in the model file. For large models, external data files can store weights separately.
- **Opset imports** — Which version of the ONNX operator set the model uses. The default domain covers standard neural network operators; custom domains can define additional ops.

### Opset Versions

ONNX operators are versioned through an opset system. Each opset version (e.g., opset 13, opset 17, opset 20) defines the semantics, input/output signatures, and behavior of every operator in the set. A model declares which opset it targets, and the runtime must support that opset version for every operator the model uses.

Opset versions are forward-compatible within a major version: an ORT build that supports opset 20 can run models targeting opset 13. However, features added in newer opsets (e.g., new operator attributes, new data types) are not available when targeting an older opset. The current ONNX specification (as of early 2025) defines opset 21.

Model export tools pin the opset version at export time:

```python
import torch
torch.onnx.export(
    model,
    dummy_input,
    "model.onnx",
    opset_version=17,
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {0: "batch"}}
)
```

Specifying `opset_version` explicitly is essential. Omitting it defaults to whatever version the installed PyTorch supports, which can change between PyTorch releases and break downstream compatibility.

## ONNX Runtime Architecture

An ORT inference session consists of three phases:

### 1. Session Creation and Graph Optimization

When `ort.InferenceSession("model.onnx")` is called, ORT loads the model, validates the graph, and applies a series of graph optimizations:

- **Constant folding** — Pre-computes subgraphs with constant inputs.
- **Operator fusion** — Merges sequences like Conv → BatchNorm → ReLU into a single fused kernel.
- **Layout transformation** — Converts tensor layouts (e.g., NCHW to NHWC) to match the execution provider's preferred format.

The optimization level is configurable:

```python
import onnxruntime as ort

session_options = ort.SessionOptions()
session_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
session = ort.InferenceSession("model.onnx", session_options)
```

`ORT_ENABLE_ALL` applies the full optimization pipeline. `ORT_ENABLE_BASIC` applies only safe, always-beneficial optimizations. For debugging, `ORT_DISABLE_ALL` runs the model as-is.

### 2. Execution Provider Selection

Execution providers (EPs) are ORT's equivalent of TFLite delegates. Each EP handles a subset of ONNX operators on a specific hardware backend:

| Execution Provider | Target | Typical Platform |
|-------------------|--------|-----------------|
| CPUExecutionProvider | CPU (default) | Any x86/ARM platform |
| CUDAExecutionProvider | NVIDIA GPU (CUDA) | Desktop/server GPU, Jetson |
| TensorrtExecutionProvider | NVIDIA GPU (TensorRT) | Jetson, server GPU |
| NnapiExecutionProvider | Android NPU/DSP | Android devices |
| CoreMLExecutionProvider | Apple Neural Engine | macOS, iOS |
| QNNExecutionProvider | Qualcomm AI Engine | Snapdragon SoCs |
| OpenVINOExecutionProvider | Intel CPU/GPU/VPU | Intel platforms |
| ACLExecutionProvider | ARM Compute Library | ARM Cortex-A |
| ArmNNExecutionProvider | ARM NN | ARM Cortex-A |

EPs are specified at session creation:

```python
session = ort.InferenceSession(
    "model.onnx",
    providers=["TensorrtExecutionProvider", "CUDAExecutionProvider", "CPUExecutionProvider"]
)
```

ORT evaluates providers in order. For each operator, it queries the first EP; if that EP does not support the operator, it queries the next, falling through to CPUExecutionProvider as the final fallback. This cascading behavior means the provider list order matters — placing TensorRT before CUDA ensures TensorRT-compatible operators use the optimized TensorRT path.

### 3. Inference Execution

```python
input_name = session.get_inputs()[0].name
output_name = session.get_outputs()[0].name
result = session.run([output_name], {input_name: input_data})
```

During `session.run()`, ORT dispatches each operator to the EP that claimed it during session creation. Data transfers between EPs (e.g., CPU to GPU) happen automatically at EP boundaries, with the same performance implications as TFLite delegate transitions — each boundary adds memory copy overhead.

## ONNX Runtime Mobile

ONNX Runtime Mobile is a reduced-size build of ORT targeting mobile and embedded Linux deployments. The full ORT package is approximately 30–50 MB (shared library); ORT Mobile reduces this to 1–5 MB by:

- **Pre-optimizing models** — The ORT optimization pipeline runs offline, producing an `.ort` format model with optimizations baked in. The mobile runtime skips the optimization phase entirely, reducing binary size and startup time.
- **Operator subsetting** — Only operators present in the pre-optimized model are compiled into the runtime. Similar to TFLM's `MicroMutableOpResolver`, unused operator code is excluded.
- **Reduced EP support** — ORT Mobile typically ships with only the CPU EP (via XNNPACK or ACL) and one hardware-specific EP.

The ORT format conversion:

```python
python -m onnxruntime.tools.convert_onnx_models_to_ort \
    model.onnx \
    --optimization_level all \
    --output_dir ./mobile_model
```

The resulting `.ort` file is typically 10–30% smaller than the original `.onnx` file due to optimization-driven graph simplification.

## Model Export Pathways

### From PyTorch

`torch.onnx.export()` traces the model with a dummy input and converts the traced operations into ONNX operators:

```python
import torch

model = MyModel()
model.eval()
dummy = torch.randn(1, 3, 224, 224)

torch.onnx.export(
    model, dummy, "model.onnx",
    opset_version=17,
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={"input": {0: "batch_size"}}
)
```

PyTorch's ONNX exporter has limitations: dynamic control flow (`if` statements that depend on tensor values), in-place operations, and certain custom autograd functions may not trace correctly. The `torch.onnx.verification` module compares PyTorch and ONNX outputs for numerical equivalence.

PyTorch 2.x introduces `torch.onnx.dynamo_export()`, which uses the TorchDynamo tracing system and handles a wider range of Python constructs than the legacy `torch.onnx.export()`. For models with complex control flow, dynamo export is more reliable.

### From TensorFlow

The `tf2onnx` tool converts TensorFlow SavedModel or frozen graph formats to ONNX:

```bash
python -m tf2onnx.convert \
    --saved-model ./saved_model_dir \
    --output model.onnx \
    --opset 17
```

`tf2onnx` handles the mapping between TensorFlow ops and ONNX ops, including layout conversion (TensorFlow uses NHWC by default; ONNX convention is NCHW). Most standard TensorFlow models convert cleanly, but custom ops or TensorFlow-specific constructs (tf.cond, tf.while_loop with data-dependent iteration counts) may fail or produce suboptimal ONNX graphs.

### Validating Exported Models

The `onnx` Python package provides structural validation:

```python
import onnx
model = onnx.load("model.onnx")
onnx.checker.check_model(model)
```

This validates the graph structure, tensor shapes, and opset compatibility. It does not validate numerical correctness — the model can be structurally valid but produce different outputs than the source framework due to operator semantic differences. Numerical validation requires running the same input through both the source framework and ORT and comparing outputs with a tolerance (typically `atol=1e-5` for float32, `atol=1` for int8).

## Comparison with TensorFlow Lite

| Dimension | ONNX Runtime | TensorFlow Lite |
|-----------|-------------|-----------------|
| **Source frameworks** | PyTorch, TensorFlow, scikit-learn, XGBoost | TensorFlow only |
| **Model format** | `.onnx` (Protocol Buffers) | `.tflite` (FlatBuffer) |
| **Bare-metal MCU support** | No (ORT requires OS) | Yes (TFLM) |
| **Desktop/server support** | Full-featured | Limited (edge-focused) |
| **Operator count** | ~190 operators (opset 20) | ~130 operators |
| **Quantization** | QDQ format (QuantizeLinear/DequantizeLinear nodes) | Built-in quantized operator variants |
| **Hardware acceleration** | Execution providers | Delegates |
| **Mobile binary size** | 1–5 MB (ORT Mobile) | 1–3 MB (tflite-runtime) |
| **Optimization pipeline** | Graph-level + EP-specific | Graph-level + delegate-specific |

The practical decision often comes down to the training framework. PyTorch-trained models flow naturally to ONNX Runtime; TensorFlow-trained models flow naturally to TFLite. Cross-framework conversion (TFLite model to ONNX, or vice versa) is possible but adds a conversion step with potential operator compatibility issues.

For projects that must support both PyTorch and TensorFlow models on the same inference pipeline, ONNX Runtime's framework agnosticism is a significant advantage. For projects targeting microcontrollers, TFLite Micro is the only option — ORT has no bare-metal equivalent.

## Tips

- Pin the opset version explicitly in every `torch.onnx.export()` or `tf2onnx` invocation. Defaulting to the latest opset ties the model artifact to the specific PyTorch or TensorFlow version installed at export time, creating fragile dependencies.
- Use the ORT format (`.ort`) for mobile and embedded Linux deployments. The pre-optimized format reduces startup time by 2–5x and binary size by eliminating the optimization pipeline from the runtime.
- Test execution provider operator coverage before committing to a deployment architecture. ORT's `InferenceSession` constructor logs which operators were assigned to which EP when the logging level is set to verbose (`session_options.log_severity_level = 0`). A model that falls back to CPU for 10% of operators may run 3–5x slower than expected.
- Run `onnx.checker.check_model()` on every exported model as part of the CI pipeline. Structural issues (shape mismatches, unsupported operator versions) caught at export time are far easier to debug than failures at deployment.
- When comparing ORT and TFLite for a specific model, benchmark both with `benchmark_model` (TFLite) and ORT's `onnxruntime_perf_test` on the actual target hardware. Desktop benchmarks do not predict edge performance because memory bandwidth, cache sizes, and SIMD width all differ.
- Use `onnxruntime.quantization` for post-training quantization when the target EP supports quantized operators. ORT's QDQ quantization format inserts explicit QuantizeLinear/DequantizeLinear nodes, which some EPs (TensorRT, QNN) can fuse into efficient quantized kernels.

## Caveats

- **Opset version mismatches break model loading.** An ORT build that supports up to opset 17 cannot load a model exported at opset 20. The error message ("No opset registered for domain 'ai.onnx' with version 20") is clear, but the fix requires either re-exporting the model at a lower opset or upgrading the ORT runtime — both of which may cascade into other compatibility issues.
- **Not all ONNX operators are supported on all execution providers.** The CUDA EP supports approximately 150 of 190 operators; the TensorRT EP supports fewer (it converts to TensorRT's native operator set). Operators without EP support silently fall back to CPU. This partial coverage is the single most common source of unexpected performance on accelerated hardware.
- **Dynamic shapes may not work on mobile or hardware-specific EPs.** A model exported with `dynamic_axes` for variable batch size works on the CPU EP but may fail on TensorRT (which compiles to a fixed shape) or QNN. For these EPs, models must be exported with fixed shapes matching the deployment input dimensions.
- **Operator semantic differences between frameworks cause silent accuracy drift.** A `Resize` operator in ONNX may use a different interpolation algorithm than `tf.image.resize` or `torch.nn.functional.interpolate`, even when configured with the same mode (bilinear, nearest). These differences are typically 1–2 pixel values but can shift quantized model outputs enough to change predictions near decision boundaries.
- **The full ORT package is large for embedded Linux.** The default `onnxruntime` pip package is 30–50 MB. On storage-constrained edge devices (eMMC-based SBCs with 4–8 GB storage), this footprint matters. ORT Mobile or a custom-built ORT with minimal EP support reduces the size but requires a more complex build pipeline.
- **`torch.onnx.export()` uses tracing, not scripting.** Data-dependent control flow (if/else based on tensor values, variable-length loops) is not captured by tracing. The exported ONNX model follows only the execution path taken by the dummy input. Models with branching logic require `torch.onnx.dynamo_export()` or manual restructuring to eliminate data-dependent control flow.

## In Practice

- **A model loads successfully but runs 5–10x slower than expected on GPU.** This commonly appears when the GPU execution provider claims most operators but falls back to CPU for a few critical ones in the middle of the graph. Each CPU fallback introduces GPU-to-CPU-to-GPU memory transfers. Setting `session_options.log_severity_level = 0` and inspecting the session creation logs reveals which operators were not claimed by the GPU EP.
- **ONNX export succeeds and `onnx.checker.check_model()` passes, but inference outputs differ from the source framework.** A frequent cause is operator semantic differences — particularly in resize/interpolation operations, padding behavior, and reduction operations (mean, sum) with different handling of edge cases. Running the same input through both the source framework and ORT with `numpy.allclose(rtol=1e-3, atol=1e-5)` on each intermediate tensor isolates the diverging operator.
- **A model that runs on the desktop CPU EP fails with "Unsupported operator" on the mobile EP.** ORT Mobile's reduced operator set covers common CNN and transformer operators but may lack less common operations (custom ops, certain reduction modes, specific activation variants). The `convert_onnx_models_to_ort` tool reports unsupported operators during conversion — running this conversion step early in the development cycle prevents late-stage deployment surprises.
- **Inference latency increases when adding more execution providers to the provider list.** This appears when multiple EPs each claim a small portion of the graph, creating many EP transitions with memory copy overhead. In some cases, using only the CPU EP with XNNPACK optimization outperforms a fragmented multi-EP execution. Benchmarking each EP individually and then in combination reveals whether multi-EP execution actually helps.
- **A PyTorch model with dynamic shapes exports to ONNX but fails on TensorRT EP.** TensorRT requires explicit shape profiles (min, optimal, max shapes) for dynamic dimensions. Without these profiles, the TensorRT EP either rejects the model or compiles it with a default profile that may not match the actual input dimensions. Configuring TensorRT optimization profiles through ORT's provider options resolves this.
- **Quantized model accuracy is significantly worse through ORT than in the source framework's quantization simulation.** This often indicates a mismatch between the quantization scheme used during training (e.g., PyTorch's fake quantization with per-channel symmetric weights) and the scheme applied during ONNX export (e.g., per-tensor asymmetric). Ensuring that the ORT quantization configuration matches the training-time quantization configuration — same granularity, same symmetry, same calibration method — closes the accuracy gap.
