---
title: "Model Optimization & Deployment"
weight: 50
bookCollapseSection: true
---

# Model Optimization & Deployment

A model trained on a GPU cluster with float32 precision, gigabytes of RAM, and no latency constraints rarely runs directly on edge hardware. The path from trained model to deployed firmware involves quantization (reducing numerical precision from float32 to int8 or float16), pruning (removing redundant weights), conversion between framework formats (PyTorch to ONNX to TFLite to TensorRT), and profiling to verify that the optimized model meets latency, memory, and accuracy targets on the actual deployment hardware.

Each optimization technique introduces trade-offs. Quantization from float32 to int8 reduces model size by 4x and can double inference speed on hardware with int8 acceleration, but poorly calibrated quantization causes accuracy degradation that may not appear in aggregate metrics — it shows up on specific edge cases or underrepresented classes. Pruning can reduce compute by 50–90% if the target runtime supports sparse execution, but dense runtimes ignore sparsity entirely and see no speedup. Model conversion between formats can silently drop unsupported operators, replace them with CPU fallbacks, or change numerical behavior. Profiling on the target device — not on a development workstation — is the only reliable way to validate that optimization achieved its goals.

## What This Section Covers

- **[Quantization]({{< relref "quantization" >}})** — Post-training quantization vs quantization-aware training, int8 and float16 precision, per-tensor vs per-channel schemes, calibration datasets, and accuracy trade-offs.
- **[Pruning & Knowledge Distillation]({{< relref "pruning-distillation" >}})** — Structured vs unstructured pruning, sparsity schedules, and teacher-student training for model compression.
- **[Model Conversion Pipelines]({{< relref "model-conversion" >}})** — PyTorch to ONNX to TFLite, Keras to TFLite, ONNX to TensorRT, operator compatibility matrices, and validation techniques.
- **[Profiling & Benchmarking Inference]({{< relref "profiling-benchmarking" >}})** — benchmark_model tool, per-operator profiling, memory peak analysis, power measurement, and P50/P95/P99 latency reporting.
