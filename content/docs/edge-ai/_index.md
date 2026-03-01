---
title: "Edge AI"
weight: 11
bookCollapseSection: true
---

# Edge AI

Running machine learning models directly on microcontrollers, single-board computers, and embedded processors — without round-tripping to a cloud endpoint — introduces constraints that don't exist in datacenter ML. Memory budgets are measured in kilobytes on Cortex-M devices, inference latency must fit within real-time control loops, and power consumption determines whether a battery-powered sensor node lasts days or years. At the other end of the embedded spectrum, GPU-accelerated platforms like the Jetson Orin Nano bring desktop-class inference throughput to systems the size of a credit card, enabling multi-stream video analytics and real-time speech recognition at the edge.

The gap between a 256 KB microcontroller running a keyword-spotting model and a 40-TOPS Jetson module running a full object detection pipeline is enormous — but the engineering discipline is the same. In both cases, the model must be optimized for the target hardware, the inference runtime must be matched to the available compute, preprocessing must be efficient enough not to bottleneck the pipeline, and the entire system must operate within a fixed power envelope. Understanding where to deploy which class of model, and how to move between frameworks and hardware targets, is the core skill in edge AI.

## Sections

- **[Inference Frameworks & Runtimes]({{< relref "inference-frameworks" >}})** — TensorFlow Lite Micro, TFLite for Linux, ONNX Runtime, and the decision framework for selecting an inference runtime based on hardware target, model format, and memory budget.
- **[Hardware Accelerators & Platforms]({{< relref "hardware-accelerators" >}})** — NPU and DSP architectures, the Raspberry Pi AI HAT+ with Hailo-8L, NVIDIA Jetson Orin Nano, and Google Coral Edge TPU — silicon designed to accelerate matrix operations at the edge.
- **[Computer Vision at the Edge]({{< relref "computer-vision" >}})** — Image classification, object detection, semantic segmentation, and pose estimation — deploying visual perception models on resource-constrained hardware.
- **[Audio & Speech at the Edge]({{< relref "audio-speech" >}})** — Audio feature extraction, keyword spotting, speech recognition, and audio event classification — from always-on wake-word detection on microcontrollers to Whisper-class transcription on embedded Linux.
- **[Model Optimization & Deployment]({{< relref "model-optimization" >}})** — Quantization, pruning, knowledge distillation, model conversion pipelines, and profiling tools — the techniques that shrink datacenter models to fit edge hardware.
- **[TinyML on Microcontrollers]({{< relref "tinyml" >}})** — Inference on Cortex-M and ESP32 platforms, Edge Impulse workflows, and design patterns for models that must operate within kilobytes of RAM and milliwatts of power.
- **[Sensor-Driven ML Pipelines]({{< relref "sensor-ml-pipelines" >}})** — Time-series classification, anomaly detection, predictive maintenance, and sensor preprocessing — connecting raw sensor data to trained models in firmware.
