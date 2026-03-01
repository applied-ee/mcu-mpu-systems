---
title: "Hardware Accelerators & Platforms"
weight: 20
bookCollapseSection: true
---

# Hardware Accelerators & Platforms

General-purpose CPUs can run neural network inference, but dedicated hardware accelerators execute the same operations orders of magnitude more efficiently. An NPU (Neural Processing Unit) contains arrays of multiply-accumulate (MAC) units optimized for the matrix multiplications that dominate deep learning workloads. DSPs (Digital Signal Processors) bring SIMD parallelism and efficient fixed-point arithmetic. GPUs offer massive parallelism for larger models. The distinction matters because each accelerator type imposes different constraints on model format, quantization requirements, and maximum model complexity.

The practical landscape ranges from the Hailo-8L NPU on the Raspberry Pi AI HAT+ (13 TOPS in an M.2 form factor) to the NVIDIA Jetson Orin Nano (40 TOPS from an Ampere GPU with integrated DLA), to the Google Coral Edge TPU (4 TOPS of INT8 throughput with strict compilation constraints). Each platform has a different model compilation pipeline, different operator support, and different trade-offs between throughput, power consumption, and flexibility. Understanding these platforms at the hardware level — not just the API level — is necessary for choosing the right accelerator for a given workload and avoiding deployment surprises.

## What This Section Covers

- **[NPUs, DSPs & Accelerator Architectures]({{< relref "npu-dsp-overview" >}})** — MAC arrays, NPU vs DSP vs GPU trade-offs, Arm Ethos-U55/U65, and Qualcomm Hexagon DSP.
- **[Raspberry Pi AI HAT+]({{< relref "raspberry-pi-ai-hat" >}})** — Hailo-8L NPU at 13 TOPS, PCIe integration with Pi 5, HEF model compilation, rpicam-apps integration, and real-time detection and segmentation demos.
- **[NVIDIA Jetson Orin Nano]({{< relref "jetson-orin-nano" >}})** — 40 TOPS from Ampere GPU, JetPack 6 setup, TensorRT engine building, DeepStream pipelines, power modes, and Isaac ROS.
- **[Google Coral Edge TPU]({{< relref "coral-edge-tpu" >}})** — 4 TOPS INT8, Edge TPU Compiler constraints, PyCoral API, and USB vs M.2 vs Dev Board form factors.
