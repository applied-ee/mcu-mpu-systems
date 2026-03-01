---
title: "Inference Frameworks & Runtimes"
weight: 10
bookCollapseSection: true
---

# Inference Frameworks & Runtimes

An inference framework is the runtime that loads a trained model, allocates memory for intermediate tensors, and executes the sequence of operations — convolutions, matrix multiplies, activations — that transform an input into a prediction. On a datacenter GPU, the choice of framework is largely a matter of API preference. On edge hardware, it determines what models can run at all, because each framework supports a different subset of operators, targets different hardware accelerators, and makes fundamentally different trade-offs between flexibility and footprint.

TensorFlow Lite Micro runs on bare-metal Cortex-M microcontrollers with as little as 16 KB of RAM, but it requires statically registering every operator the model uses and provides no dynamic memory allocation. TensorFlow Lite for Linux supports GPU and NPU delegates that offload computation to hardware accelerators on platforms like Raspberry Pi and Jetson, but it requires a Linux userspace and megabytes of RAM. ONNX Runtime brings cross-framework model compatibility — a model trained in PyTorch can run through ONNX execution providers targeting CPUs, GPUs, or NPUs — but its edge variants have different operator coverage than the full desktop runtime. Choosing the wrong framework for a given hardware target leads to silent operator fallbacks, unexpected CPU-only execution, or outright deployment failure.

## What This Section Covers

- **[TensorFlow Lite Micro]({{< relref "tflite-micro" >}})** — Interpreter architecture, memory arena allocation, operator registration, and integration with Cortex-M and ESP32 targets.
- **[TensorFlow Lite for Linux]({{< relref "tflite-linux" >}})** — Delegate architecture for GPU and NPU offload, Python and C++ API usage, and deployment on Raspberry Pi and Jetson platforms.
- **[ONNX Runtime & Edge Variants]({{< relref "onnx-runtime" >}})** — The ONNX model format, execution providers, ONNX Runtime Mobile, and comparison with TensorFlow Lite.
- **[Edge Runtime Selection Guide]({{< relref "runtime-selection" >}})** — A decision framework organized by target hardware, model format, operator coverage, and memory budget.
