---
title: "Model Conversion Pipelines"
weight: 30
---

# Model Conversion Pipelines

Training frameworks produce models in their native format — PyTorch saves `.pt` or `.pth` files with Python-pickled state dictionaries, TensorFlow saves SavedModel directories or `.keras` files, and ONNX stores models as protobuf `.onnx` files. None of these formats run directly on edge inference runtimes. TFLite Micro expects `.tflite` FlatBuffers. TensorRT requires serialized `.trt` engine files built for the specific GPU architecture. Hailo's Dataflow Compiler produces `.hef` files for the Hailo-8/8L NPU. The conversion pipeline bridges this gap — transforming a trained model from its source format into the target runtime's format while preserving numerical correctness.

Conversion is not a trivial file format translation. Each target format supports a different subset of operations, has different numerical behavior, and may impose constraints on tensor shapes, data types, or graph structure. A model that converts without errors is not necessarily equivalent to the original — silent operator semantic differences, floating-point reordering, and precision changes can produce subtly different outputs that only appear when tested on specific inputs.

## Common Conversion Paths

The most frequently used conversion pipelines for edge deployment:

```
Keras / TF SavedModel ──→ TFLite (.tflite)
                           ├── TFLite Micro (MCUs)
                           ├── TFLite Runtime (Linux SBCs)
                           └── Edge TPU Compiler → Edge TPU (.tflite)

PyTorch (.pt) ──→ ONNX (.onnx) ──→ TensorRT (.trt)     [Jetson, NVIDIA GPUs]
                       │          ──→ TFLite (.tflite)   [via onnx-tf or ai-edge-torch]
                       │          ──→ HEF (.hef)         [Hailo-8 via Dataflow Compiler]
                       │          ──→ OpenVINO IR (.xml)  [Intel NPUs]
                       └──────────→ ONNX Runtime (.onnx) [direct execution]

PyTorch (.pt) ──→ TorchScript (.pt) ──→ limited edge options
PyTorch (.pt) ──→ ai-edge-torch ──→ TFLite (.tflite)    [direct, experimental]
```

ONNX serves as the primary interchange format. Converting first to ONNX, then to the target runtime format, is the most portable approach because it decouples the training framework from the deployment target. However, each conversion hop introduces opportunities for operator incompatibility and numerical divergence.

## Keras / TF SavedModel to TFLite

This is the most direct conversion path, supported natively by TensorFlow:

```python
import tensorflow as tf

# From SavedModel directory
converter = tf.lite.TFLiteConverter.from_saved_model("saved_model_dir")
tflite_model = converter.convert()
with open("model.tflite", "wb") as f:
    f.write(tflite_model)

# From Keras model in memory
converter = tf.lite.TFLiteConverter.from_keras_model(keras_model)
tflite_model = converter.convert()
```

### Optimization Flags

The converter accepts optimization flags that control [quantization]({{< relref "quantization" >}}) during conversion:

```python
converter.optimizations = [tf.lite.Optimize.DEFAULT]

# For full integer quantization, provide a representative dataset
def representative_dataset():
    for sample in calibration_data[:200]:
        yield [sample.astype(np.float32)]

converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8
```

### Supported Ops Sets

TFLite defines three operator support tiers:

- **`TFLITE_BUILTINS`** — The core TFLite operator set (~130 operators). These have optimized implementations for CPU, GPU delegate, and accelerator delegates. This is the target for production edge deployment.
- **`SELECT_TF_OPS`** — Fallback to full TensorFlow operator implementations for ops not in the builtin set. Pulls in a significant portion of the TF runtime (~10–20 MB additional binary size). Useful for prototyping but impractical for most edge devices.
- **Custom ops** — User-defined operators registered at runtime. Required for non-standard operations not covered by either builtin or TF ops.

```python
converter.target_spec.supported_ops = [
    tf.lite.OpsSet.TFLITE_BUILTINS,  # Default, use builtin ops
    # tf.lite.OpsSet.SELECT_TF_OPS,  # Uncomment to allow TF fallback
]
```

A model that requires `SELECT_TF_OPS` for conversion should be treated as a red flag for edge deployment — the TF ops fallback path is slow, memory-heavy, and incompatible with most accelerator delegates.

## PyTorch to ONNX

PyTorch exports to ONNX via tracing or scripting. Tracing runs a sample input through the model and records the operations performed; scripting analyzes the Python source code to build a graph. Tracing is more reliable for most architectures:

```python
import torch

model = MyModel()
model.eval()
dummy_input = torch.randn(1, 3, 224, 224)

torch.onnx.export(
    model,
    dummy_input,
    "model.onnx",
    opset_version=17,
    input_names=["input"],
    output_names=["output"],
    dynamic_axes={
        "input": {0: "batch_size"},
        "output": {0: "batch_size"}
    }
)
```

### Opset Version Selection

Each ONNX opset version defines a set of available operators and their semantics. Key considerations:

| Opset | Notable additions |
|-------|-------------------|
| 11 | Resize, TopK with dynamic K, ScatterND |
| 13 | Squeeze/Unsqueeze with axes as input (required for many modern architectures) |
| 14 | Reshape with allowzero, Add with broadcasting fixes |
| 15 | BatchNormalization training mode |
| 17 | LayerNormalization, GroupNormalization as native ops |
| 18 | Pad with axes parameter, improved reduce ops |

The general guidance: use opset 13 or higher for broad compatibility. Opset 17+ is recommended for transformer-based models that use LayerNorm. Exporting at a higher opset version ensures newer operators are available, but downstream converters (TensorRT, TFLite) may not support the latest opset.

### Tracing vs Scripting

**Tracing** (`torch.onnx.export` default) executes the model with the provided input and records the sequence of operations. Limitations:

- Data-dependent control flow (if/else based on tensor values) follows only the path taken by the trace input. The exported model is fixed to that path.
- Dynamic loop counts are unrolled to the count observed during tracing.
- In-place operations and side effects may not export correctly.

**Scripting** (`torch.jit.script`) parses the Python source and compiles it to TorchScript IR, preserving control flow. However, scripting imposes strict type annotation requirements and does not support all Python constructs (list comprehensions, certain standard library calls).

For most edge deployment models (CNNs, standard transformers with fixed sequence length), tracing is sufficient and more reliable.

## ONNX to TensorRT

TensorRT converts an ONNX model into an optimized inference engine by:

1. Parsing the ONNX graph and mapping operators to TensorRT layers.
2. Applying graph optimizations (layer fusion, kernel selection, precision calibration).
3. Serializing the optimized engine to a file.

```bash
trtexec --onnx=model.onnx \
        --saveEngine=model.engine \
        --fp16 \
        --workspace=4096 \
        --minShapes=input:1x3x224x224 \
        --optShapes=input:1x3x224x224 \
        --maxShapes=input:4x3x224x224
```

Key flags:

- `--fp16` — Enable float16 precision for layers where it is faster without significant accuracy loss. Typically 1.5–2x speedup over float32 on Jetson Orin.
- `--int8` — Enable int8 precision with calibration. Requires calibration data or pre-quantized ONNX model with QDQ nodes.
- `--workspace` — Maximum GPU workspace memory in MB for kernel selection. Larger workspace allows TensorRT to consider more kernel implementations.
- `--minShapes` / `--optShapes` / `--maxShapes` — Required for models with dynamic input dimensions. TensorRT builds kernels optimized for `optShapes` and ensures compatibility with the min/max range.

### Engine Portability

TensorRT engines are **not portable** across GPU architectures. An engine built on Jetson Orin (Ampere, SM 8.7) does not run on Jetson Nano (Maxwell, SM 5.3). An engine built for one TensorRT version may not load on a different version. In practice, this means engines must be built on the deployment target or on identical hardware. For fleets with mixed hardware, maintain one ONNX model and build engines per target.

## ONNX to TFLite

Converting from ONNX to TFLite is common for PyTorch models targeting TFLite Micro, Edge TPU, or the TFLite GPU delegate. Two primary tools exist:

### onnx-tf (ONNX to TensorFlow to TFLite)

```bash
# ONNX → TF SavedModel
onnx-tf convert -i model.onnx -o saved_model_dir

# TF SavedModel → TFLite
python -c "
import tensorflow as tf
converter = tf.lite.TFLiteConverter.from_saved_model('saved_model_dir')
tflite_model = converter.convert()
with open('model.tflite', 'wb') as f:
    f.write(tflite_model)
"
```

This two-step pipeline introduces two conversion hops (ONNX → TF → TFLite), each of which can introduce operator compatibility issues. The intermediate TF SavedModel can be inspected to verify correctness before the TFLite conversion.

### ai-edge-torch (Direct PyTorch to TFLite)

Google's `ai-edge-torch` library exports PyTorch models directly to TFLite without going through ONNX:

```python
import ai_edge_torch
import torch

model = MyModel().eval()
sample_input = (torch.randn(1, 3, 224, 224),)
edge_model = ai_edge_torch.convert(model, sample_input)
edge_model.export("model.tflite")
```

This path is newer (introduced 2024) and supports a growing subset of PyTorch operators. For standard vision architectures (MobileNet, EfficientNet, ResNet), it works reliably and avoids the ONNX intermediate step.

## ONNX to Hailo HEF

Hailo's Dataflow Compiler converts ONNX or TFLite models into `.hef` files for the Hailo-8 and Hailo-8L NPUs:

```python
from hailo_sdk_client import ClientRunner

runner = ClientRunner(hw_arch="hailo8")
hn, npz = runner.translate_onnx_model(
    "model.onnx",
    "model_name",
    start_node_names=["input"],
    end_node_names=["output"],
    net_input_shapes={"input": [1, 3, 224, 224]}
)

# Optimize (quantize, compile)
runner.optimize(calib_dataset)  # Calibration for int8 quantization
hef = runner.compile()

with open("model.hef", "wb") as f:
    f.write(hef)
```

The Dataflow Compiler performs quantization, layer fusion, and memory scheduling specifically for the Hailo architecture. Not all ONNX operators are supported — the compiler maintains a list of supported layers and will reject models containing unsupported operations.

## Operator Compatibility

Operator compatibility is the primary source of conversion failures. Each format and runtime supports a different subset of operations:

| Operation | TFLite Builtins | ONNX (opset 17) | TensorRT 8.x | Hailo DFC |
|-----------|-----------------|-------------------|---------------|-----------|
| Conv2D | Yes | Yes | Yes | Yes |
| DepthwiseConv2D | Yes | Yes (as grouped conv) | Yes | Yes |
| BatchNorm | Fused into Conv | Yes | Yes (fused) | Fused |
| LayerNorm | Yes (TF 2.14+) | Yes (opset 17+) | Yes (TRT 8.6+) | Limited |
| GELU | Yes (TF 2.12+) | Yes (opset 20) | Yes | Approximated |
| Resize (bilinear) | Yes | Yes | Yes | Yes |
| GatherND | Yes | Yes | Yes | No |
| Dynamic shapes | No (fixed) | Yes | Yes (with profiles) | No (fixed) |

When an operator is not supported by the target format:

1. **Conversion failure** — The converter raises an error naming the unsupported operator. This is the best outcome because the problem is visible.
2. **CPU fallback** — The converter succeeds but marks the unsupported operator for CPU execution. The model appears to work but performance suffers due to accelerator↔CPU data transfers at each fallback boundary.
3. **Silent substitution** — Some converters replace unsupported operations with approximations (e.g., replacing `HardSwish` with a `Relu6`-based approximation). This may change model accuracy without any warning.

## Validation

Model conversion must be validated by comparing the outputs of the original and converted models on identical inputs. A successful conversion (no errors) does not guarantee numerical equivalence.

### Output Comparison Protocol

```python
import numpy as np
import onnxruntime as ort

# Run original PyTorch model
model.eval()
with torch.no_grad():
    pt_output = model(torch.tensor(test_input)).numpy()

# Run converted ONNX model
session = ort.InferenceSession("model.onnx")
onnx_output = session.run(None, {"input": test_input})[0]

# Compare
max_diff = np.max(np.abs(pt_output - onnx_output))
mean_diff = np.mean(np.abs(pt_output - onnx_output))
print(f"Max absolute difference: {max_diff:.8f}")
print(f"Mean absolute difference: {mean_diff:.8f}")

# Thresholds
assert max_diff < 1e-5, f"Float32 conversion: max diff {max_diff} exceeds tolerance"
```

Acceptable tolerances:

- **Float32 → Float32**: Max absolute difference < 1e-5. Differences arise from floating-point operation reordering (associativity of addition).
- **Float32 → Float16**: Max absolute difference < 1e-2. Half-precision has limited mantissa bits.
- **Float32 → Int8**: Task-dependent. Compare accuracy metrics (top-1, mAP) rather than raw output values, since quantization intentionally alters values.

### Graph Inspection with Netron

[Netron](https://netron.app) is a browser-based tool for visually inspecting model graphs. Loading a `.tflite`, `.onnx`, or `.pb` file shows the operator graph, tensor shapes, data types, and quantization parameters. This is invaluable for:

- Verifying that batch normalization was fused into convolution.
- Checking which operators are present after conversion.
- Inspecting quantization parameters (scale, zero_point) on each tensor.
- Identifying unexpected operators inserted by the converter.

## Tips

- Pin the ONNX opset version explicitly in `torch.onnx.export()`. Relying on the default opset risks inconsistency when the PyTorch version changes, which changes the default opset.
- Always validate the converted model against the original on at least 10 representative inputs. A single test input can miss operator-specific numerical divergences that only appear with certain value ranges.
- Use Netron to visually inspect the converted model graph. Operators that appear in the graph but not in the original architecture (e.g., unexpected `Cast`, `Transpose`, or `Reshape` nodes) indicate conversion artifacts that may impact performance.
- Separate conversion and [quantization]({{< relref "quantization" >}}) into distinct steps. Converting a float32 model to TFLite, validating it, and then quantizing the validated TFLite model is easier to debug than converting and quantizing simultaneously.
- For TensorRT, always specify `--minShapes`, `--optShapes`, and `--maxShapes` even for fixed-size models. This makes the engine configuration explicit and avoids implicit assumptions.
- When converting PyTorch models with custom operators, implement them as standard ops compositions first. Custom ops rarely survive the ONNX export without manual intervention.
- Keep a conversion test suite — a set of inputs and expected outputs that runs automatically after every model conversion. This catches regressions when frameworks or tools are updated.

## Caveats

- Conversion success does not guarantee numerical equivalence. Floating-point operation reordering (e.g., fusing Conv + BatchNorm changes the multiplication order) produces slightly different results. For float32, this is typically negligible (< 1e-5). For int8, the differences are larger and must be evaluated through accuracy metrics.
- PyTorch models with dynamic control flow — `if` statements conditioned on tensor values, variable-length loops, recursive modules — do not export reliably to ONNX via tracing. The traced model captures only the execution path observed with the trace input. Scripting handles some control flow but imposes strict requirements on the Python code structure.
- TensorRT engines are architecture-specific and version-specific. An engine built on Jetson Orin with TensorRT 8.6 does not load on Jetson Orin with TensorRT 10.0, nor on any other GPU architecture. Engine files are not portable — the ONNX source model is the portable artifact.
- Some TFLite operators have subtly different numerical behavior than their TensorFlow counterparts. Quantized `RESIZE_BILINEAR` in TFLite uses a different interpolation formula than `tf.image.resize` with `method='bilinear'`, producing output differences of up to 1 quantization level on boundary pixels.
- The `SELECT_TF_OPS` compatibility layer in TFLite pulls in a substantial portion of the TensorFlow runtime. A model that requires even one TF-fallback operator incurs 10–20 MB of additional binary size, making it incompatible with MCU deployment and impractical for many SBC deployments.
- ONNX model size can increase significantly during export if the exporter unfolds high-level operations into primitive ops. A single `MultiHeadAttention` layer in PyTorch may export as dozens of ONNX nodes (MatMul, Reshape, Transpose, Softmax, etc.), increasing graph complexity and conversion time.

## In Practice

- **Conversion succeeds but inference produces incorrect results.** An operator semantic difference between the source and target framework is the most common cause. Comparing intermediate layer outputs (not just the final output) isolates which operator introduces the divergence. In TFLite, the `SignatureRunner` API allows extracting intermediate tensors. In ONNX, adding intermediate nodes to the output list enables the same.
- **ONNX export fails with "unsupported op" error.** The operation is not supported at the chosen opset version. Increasing the opset version (e.g., from 13 to 17) often adds support. If the operation is genuinely unsupported in any opset (e.g., a custom CUDA kernel), restructuring the model to use equivalent standard operations is necessary.
- **TensorRT engine builds successfully but accuracy is lower than expected.** FP16 precision is losing accuracy on layers with large dynamic range (common in attention mechanisms). Using `trtexec --verbose` shows per-layer precision. TensorRT's layer-precision API (`builder_config.set_flag(trt.BuilderFlag.OBEY_PRECISION_CONSTRAINTS)`) combined with per-layer precision annotations forces specific layers to remain in float32.
- **Converted TFLite model is much larger than expected.** The `SELECT_TF_OPS` path was triggered, pulling the TF runtime into the model. Checking the converter output for "Some ops are not supported by the native TFLite runtime" confirms this. Restructuring the model to use only builtin ops — or replacing the unsupported op with a supported alternative — eliminates the dependency.
- **Model converts to ONNX but the downstream TFLite or TensorRT converter rejects it.** The ONNX model contains operators that the downstream converter does not support. Running `onnx.checker.check_model()` validates ONNX conformance but does not check target compatibility. The target converter's documentation lists supported ONNX operators — cross-referencing the model's operator list against this list identifies the incompatible operators before attempting conversion.
- **Converted model latency is much worse than expected despite correct operator support.** The converted graph may contain unnecessary `Transpose` or `Cast` operations inserted during conversion to handle layout differences (NCHW vs NHWC). Inspecting the graph in Netron reveals these, and pre-converting the model to the target layout before export eliminates them. For TFLite (NHWC), converting a PyTorch model (NCHW) through ONNX can insert layout transposes at every layer boundary.
