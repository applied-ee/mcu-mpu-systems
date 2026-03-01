---
title: "Quantization"
weight: 10
---

# Quantization

Quantization reduces the numerical precision of a neural network's weights and activations from the default float32 representation to a lower-precision format — typically int8, float16, or int4. A float32 model stores each parameter as a 32-bit IEEE 754 floating-point number. Converting those parameters to int8 reduces model size by 4x (from 4 bytes per weight to 1 byte), decreases memory bandwidth during inference by the same factor, and enables hardware-accelerated integer arithmetic on devices with int8 support — including Arm Cortex-M with CMSIS-NN, dedicated NPUs (Ethos-U55/U65, Hailo-8), Edge TPU, and GPU int8 tensor cores on Jetson platforms.

The core trade-off is straightforward: lower precision means less representational capacity per value, which introduces quantization error. The engineering task is to minimize that error so the quantized model's accuracy remains acceptable for the deployment use case.

## The Quantization Formula

All linear quantization schemes map between real (floating-point) values and integer values using two parameters — a **scale** (floating-point) and a **zero_point** (integer):

```
real_value = (quantized_value - zero_point) * scale
```

The scale defines the step size between adjacent quantized values. The zero_point defines which integer maps to the real value 0.0 — this is important for operations like zero-padding where the padded value must be representable exactly.

For unsigned int8 quantization, quantized values range from 0 to 255. For signed int8 (the more common scheme in modern frameworks), values range from -128 to 127. The scale and zero_point are chosen to map the observed range of real values onto this integer range with minimum clipping:

```
scale = (real_max - real_min) / (quant_max - quant_min)
zero_point = round(quant_min - real_min / scale)
```

For a weight tensor with values in [-0.5, 0.5] mapped to signed int8 [-128, 127]:

```
scale = (0.5 - (-0.5)) / (127 - (-128)) = 1.0 / 255 ≈ 0.00392
zero_point = round(-128 - (-0.5) / 0.00392) = 0
```

This symmetric case (zero_point = 0) is common for weight tensors and simplifies the integer arithmetic during inference.

## Per-Tensor vs Per-Channel Quantization

**Per-tensor quantization** uses a single scale and zero_point for an entire weight tensor. This is the simplest scheme and is widely supported, but it forces all values in the tensor to share the same quantization range. If one output channel has weights in [-0.1, 0.1] and another has weights in [-2.0, 2.0], the narrow-range channel suffers disproportionate quantization error because the scale is set by the wide-range channel.

**Per-channel quantization** assigns a separate scale and zero_point to each output channel (filter) of a convolution or each output unit of a fully connected layer. This accommodates per-channel variation in weight distributions and consistently produces better accuracy than per-tensor quantization. The cost is additional metadata storage (one scale + one zero_point per channel) and slightly more complex kernel implementations.

TFLite uses per-channel quantization by default for convolution weights. ONNX Runtime and TensorRT both support per-channel (also called per-axis) quantization. For activations, per-tensor quantization is standard because per-channel activation quantization would require dynamic range tracking per channel at runtime.

## Post-Training Quantization (PTQ)

Post-training quantization takes a pre-trained float32 model and converts it to a quantized representation without any retraining. Three variants exist, offering different trade-offs between simplicity, speed, and accuracy.

### Dynamic Range Quantization

The simplest form. Weights are quantized to int8 at conversion time and stored in the model file. Activations remain in float32 during inference but are quantized dynamically (on the fly) to int8 before each operation, then dequantized back to float32 for the output. This provides model size reduction (4x) but limited inference speed improvement because the dynamic quantization/dequantization adds overhead.

In TFLite:

```python
converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_dir)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()
```

This is the default behavior when `optimizations` is set but no representative dataset is provided.

### Full Integer Quantization

Both weights and activations are quantized to int8 statically. The activation ranges are determined during conversion using a **calibration dataset** — a set of representative input samples that the converter runs through the float model to observe the actual activation ranges at each layer. These observed ranges determine the scale and zero_point for each activation tensor.

```python
def representative_dataset():
    for i in range(200):
        sample = calibration_data[i]
        yield [sample.astype(np.float32)]

converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_dir)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.representative_dataset = representative_dataset
converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8
tflite_model = converter.convert()
```

Full integer quantization produces the fastest inference on hardware with int8 acceleration. It is **required** for deployment on Edge TPU and most dedicated NPUs — these accelerators do not support float operations at all.

### Float16 Quantization

Weights are stored as 16-bit IEEE 754 half-precision floats. Model size is reduced by 2x (compared to 4x for int8). On hardware with native float16 support (GPUs, Apple Neural Engine, some DSPs), compute also benefits. On hardware without float16 support, the runtime upcasts to float32 at load time, providing size reduction for storage/transfer but no inference speedup.

```python
converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_dir)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
converter.target_spec.supported_types = [tf.float16]
tflite_model = converter.convert()
```

Float16 quantization has near-zero accuracy loss on most models because half-precision provides sufficient dynamic range for typical weight and activation distributions.

## Calibration Datasets

The quality of the calibration dataset directly determines the accuracy of a fully integer-quantized model. The calibration samples are used to measure the activation range at each layer — if the calibration data does not exercise the same activation patterns as real deployment data, the scale and zero_point will be set incorrectly, and activations during real inference will be clipped or under-utilized.

Guidelines for calibration datasets:

- **Size**: 100–500 representative samples is sufficient for most models. Beyond 500, the observed ranges stabilize and additional samples provide diminishing returns. For TFLite, the `representative_dataset` generator typically yields 200 samples.
- **Representativeness**: The samples should cover the distribution of real deployment data, including edge cases. A face detection model calibrated only on well-lit frontal faces will have poor quantized accuracy on dark or angled faces because those inputs produce different activation ranges.
- **Source**: Use a held-out subset of the validation or test set — not the training set. Training set samples may include augmented or synthetic data that does not reflect deployment conditions.
- **Ordering**: Calibration is order-independent; the converter accumulates min/max statistics across all samples regardless of presentation order.

## Quantization-Aware Training (QAT)

Quantization-aware training inserts **fake quantization nodes** into the training graph that simulate the effects of int8 quantization (rounding and clamping) during the forward pass while maintaining float32 values for gradient computation in the backward pass. The model learns to produce weights and activations that are robust to quantization noise because the noise is present during training.

QAT consistently produces higher accuracy than PTQ, especially for:

- Small models (fewer parameters means less redundancy to absorb quantization error)
- Models with depth-wise separable convolutions (which have narrow per-channel weight distributions)
- Models targeting int8 where PTQ causes >1% accuracy drop

In TensorFlow:

```python
import tensorflow_model_optimization as tfmot

quantize_model = tfmot.quantization.keras.quantize_model
q_aware_model = quantize_model(float_model)
q_aware_model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])
q_aware_model.fit(train_data, epochs=5)  # Fine-tune for 3-10 epochs

converter = tf.lite.TFLiteConverter.from_keras_model(q_aware_model)
converter.optimizations = [tf.lite.Optimize.DEFAULT]
tflite_model = converter.convert()
```

In PyTorch:

```python
import torch.quantization

model.qconfig = torch.quantization.get_default_qat_qconfig('fbgemm')
model_prepared = torch.quantization.prepare_qat(model.train())
# Train for several epochs
model_quantized = torch.quantization.convert(model_prepared.eval())
```

QAT typically requires 3–10 fine-tuning epochs on the original training data. The computational cost is roughly equivalent to normal training for those epochs — not a full training run from scratch.

## ONNX Runtime Quantization

The `onnxruntime.quantization` module provides both static and dynamic quantization for ONNX models:

```python
from onnxruntime.quantization import quantize_static, quantize_dynamic, CalibrationDataReader

# Dynamic quantization (no calibration dataset needed)
quantize_dynamic("model.onnx", "model_quant.onnx", weight_type=QuantType.QInt8)

# Static quantization (requires calibration)
class MyCalibrationReader(CalibrationDataReader):
    def __init__(self, data):
        self.data = iter(data)
    def get_next(self):
        try:
            return {"input": next(self.data)}
        except StopIteration:
            return None

quantize_static("model.onnx", "model_quant.onnx",
                calibration_data_reader=MyCalibrationReader(calibration_samples),
                quant_format=QuantFormat.QDQ,
                per_channel=True)
```

The `QDQ` (QuantizeLinear/DequantizeLinear) format inserts explicit quantization and dequantization nodes in the graph, making it compatible with downstream converters (including TensorRT, which recognizes QDQ patterns and fuses them into int8 kernels).

## TensorRT Quantization

TensorRT performs int8 quantization during engine building. The calibrator processes calibration data to determine per-tensor activation ranges, then selects int8 kernels for layers where int8 execution is faster than float without exceeding an accuracy threshold:

```bash
trtexec --onnx=model.onnx \
        --saveEngine=model_int8.trt \
        --int8 \
        --calib=calibration_cache.bin \
        --workspace=4096
```

TensorRT supports two calibration strategies:

- **Entropy calibration** (default): Minimizes KL divergence between the float32 and int8 activation distributions. Generally produces the best accuracy.
- **Percentile calibration**: Sets the range to exclude a small percentage of outlier activations (e.g., 99.99th percentile). Faster but may clip more values.

TensorRT can also accept pre-computed quantization parameters from QAT models exported in ONNX QDQ format, skipping the calibration step entirely.

## Accuracy Trade-Offs

Typical accuracy impacts of int8 quantization across common model architectures:

| Model | Task | Float32 Accuracy | INT8 PTQ Accuracy | INT8 QAT Accuracy |
|-------|------|-------------------|--------------------|--------------------|
| MobileNetV2 | ImageNet classification | 71.8% top-1 | 71.1% top-1 | 71.6% top-1 |
| ResNet-50 | ImageNet classification | 76.1% top-1 | 75.8% top-1 | 76.0% top-1 |
| SSD MobileNetV2 | COCO detection | 22.1 mAP | 21.3 mAP | 21.9 mAP |
| EfficientNet-Lite0 | ImageNet classification | 75.1% top-1 | 74.4% top-1 | 74.9% top-1 |
| DS-CNN | Keyword spotting | 95.4% | 95.1% | 95.3% |

Classification tasks are generally robust to int8 quantization, losing less than 1% accuracy with well-calibrated PTQ. Detection tasks — especially small-object detection — are more sensitive because bounding box regression operates on continuous coordinates where quantization error translates directly to localization error.

For models where int8 PTQ causes unacceptable accuracy loss (>1–2%), the typical recovery path is: try per-channel quantization (if not already enabled) → try larger/more representative calibration dataset → try QAT → try mixed precision (sensitive layers in float16, rest in int8).

## Tips

- Always use per-channel quantization when the target runtime supports it. Per-channel is strictly better than per-tensor for accuracy and is the default in TFLite and ONNX Runtime.
- 200–500 calibration samples is sufficient for most models. A common sanity check is to run calibration with 200 samples, then 500 samples, and verify that the quantized accuracy does not change — if it does, the 200-sample set was not representative enough.
- Compare quantized vs float accuracy on the **full validation set** before deploying, not just a quick spot check. Quantization errors can be class-specific and invisible in aggregate metrics until tested across the full distribution.
- Float16 quantization is the safest first optimization step. The accuracy loss is negligible on virtually all architectures, and the 2x size reduction is immediately useful for storage and transfer.
- Full integer quantization (int8) is required for Edge TPU, Ethos-U, and most dedicated NPUs. These accelerators have no float execution path — if any layer is not quantized, it falls back to CPU.
- When quantizing detection models, evaluate not just mAP but also per-class AP and localization metrics. A model that maintains aggregate mAP may have degraded severely on the smallest or rarest object class.

## Caveats

- Post-training quantization can cause significant accuracy drops on models with wide activation ranges — depth-wise separable convolutions are particularly vulnerable because each channel has an independent weight distribution that per-tensor quantization cannot capture. Per-channel quantization mitigates this, but not all accelerators support per-channel activation quantization.
- The calibration dataset must be representative of **deployment** data, not training data. A model calibrated on clean studio images will have incorrect activation ranges when deployed on noisy camera feeds with motion blur and variable lighting. The quantized model may pass validation on the clean test set and fail in production.
- Quantized models may perform well on aggregate accuracy metrics but fail on specific edge cases. A classification model with 95% overall int8 accuracy may have 70% accuracy on the least-represented class because that class's features fall in the activation range most distorted by quantization.
- Mixing quantization schemes across layers — some layers in int8, some in float16, some in float32 — adds data format conversion overhead at each boundary. On accelerator-based systems, this means transfers between the NPU (int8) and CPU (float32) for every un-quantized layer, which can negate the speedup from acceleration.
- The quantized `.tflite` or `.onnx` file includes the scale and zero_point metadata for every tensor. Modifying or re-exporting the model without preserving these parameters invalidates the quantization.

## In Practice

- **Accuracy drops only on certain classes after quantization.** Those classes typically have activations at the extreme ends of the observed range that get clipped during int8 mapping. The calibration dataset likely underrepresented those classes. Recovery approaches: add more calibration samples from the affected classes, switch to QAT, or selectively keep the sensitive layers in higher precision.
- **Model passes accuracy check on the validation set but fails on real deployment data.** The calibration dataset was drawn from the same distribution as validation, but deployment data has a different distribution (different lighting, different sensor, different noise characteristics). Collecting calibration samples from the actual deployment environment — even 50–100 samples — typically resolves the mismatch.
- **Int8 model is not faster than the float32 model on the target hardware.** The hardware lacks int8 acceleration (e.g., Cortex-A53 without dot-product instructions), or specific operators fall back to the float path because the quantized variant is not implemented. The [per-operator profiling]({{< relref "profiling-benchmarking" >}}) output shows which operators run in int8 vs float — any float fallback on an otherwise int8 model is a performance bottleneck.
- **Quantized model output has systematic bias compared to float model.** This appears as a consistent offset in regression outputs or shifted confidence scores. The zero_point of the output tensor may be miscalibrated. Re-running calibration with a larger or more diverse dataset, or switching to QAT, typically corrects the bias.
- **TFLite int8 model runs on CPU but Edge TPU compiler rejects it.** Some operators in the model are quantized but not supported by the Edge TPU. The Edge TPU compiler logs show which operators partition to the device vs CPU. Replacing unsupported operators with supported alternatives (e.g., replacing `RESIZE_BILINEAR` with `RESIZE_NEAREST_NEIGHBOR`) or restructuring the model to avoid them is the standard fix.
