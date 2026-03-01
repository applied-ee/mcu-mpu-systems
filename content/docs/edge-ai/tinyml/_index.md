---
title: "TinyML on Microcontrollers"
weight: 60
bookCollapseSection: true
---

# TinyML on Microcontrollers

TinyML is machine learning inference on microcontrollers — devices with kilobytes of RAM, no operating system, and power budgets measured in milliwatts. A Cortex-M4 with 256 KB of SRAM and 1 MB of flash can run a keyword-spotting model, a gesture classifier, or a simple anomaly detector. A Cortex-M7 with 512 KB of SRAM pushes the boundary to small image classifiers and more complex audio models. The Cortex-M55, with its Helium vector extension, and the Ethos-U55 NPU companion close the gap further, enabling inference workloads that would have required an application processor just a few years ago.

The constraints are absolute. There is no virtual memory, no swap, and no dynamic allocation in most TinyML deployments. The model weights must fit in flash, the activation tensors must fit in SRAM, and both must coexist with the rest of the firmware — peripheral drivers, communication stacks, and application logic. Every kilobyte matters. Frameworks like TensorFlow Lite Micro, CMSIS-NN, and ESP-NN exist specifically for this environment, providing optimized operator implementations that use the SIMD and DSP instructions available on each target architecture. Choosing the right model architecture, quantization strategy, and memory layout is not optional — it is the difference between a model that deploys and one that does not fit.

## What This Section Covers

- **[Inference on Cortex-M]({{< relref "cortex-m-inference" >}})** — CMSIS-NN optimized operators, M4/M7/M55 comparison, flash vs SRAM layout, STM32Cube.AI, and Ethos-U integration on Cortex-M55.
- **[Inference on ESP32]({{< relref "esp32-inference" >}})** — ESP-NN, ESP32-S3 vector extensions, PSRAM usage, dual-core partitioning, and ESP-DL framework.
- **[Arduino & Edge Impulse]({{< relref "arduino-edge-impulse" >}})** — Edge Impulse Studio end-to-end workflow, EON Compiler, and Arduino library deployment for rapid prototyping.
- **[Designing for Memory Constraints]({{< relref "memory-constrained-design" >}})** — Arena optimization, operator subsetting, model architecture search for RAM targets, and OTA model updates.
