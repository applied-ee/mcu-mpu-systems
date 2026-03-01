---
title: "Computer Vision at the Edge"
weight: 30
bookCollapseSection: true
---

# Computer Vision at the Edge

Computer vision on edge hardware requires models specifically designed — or heavily optimized — for the constraints of embedded deployment. A standard ResNet-50 image classifier needs over 90 MB of weights and billions of multiply-accumulate operations per frame; a MobileNet-v2 achieves comparable accuracy in under 15 MB with a fraction of the compute, using depthwise separable convolutions that trade a small accuracy penalty for dramatically lower latency and memory use. The same architectural trade-off applies across every vision task: detection, segmentation, and pose estimation all have lightweight variants built for edge deployment.

The camera-to-inference pipeline introduces its own challenges. Raw camera frames must be resized, color-converted, and normalized before the model can process them. Post-processing — non-maximum suppression for detection, argmax decoding for segmentation, heatmap parsing for pose estimation — adds latency after inference completes. On accelerator-equipped platforms like the Pi AI HAT+ or Jetson, the inference step itself may take only a few milliseconds, but an inefficient preprocessing pipeline running on the CPU can easily become the bottleneck. End-to-end optimization, from frame capture through post-processing, determines real-world throughput.

## What This Section Covers

- **[Image Classification]({{< relref "image-classification" >}})** — MobileNet, EfficientNet-Lite, input preprocessing pipelines, cross-platform benchmarks, and transfer learning for custom classes.
- **[Object Detection]({{< relref "object-detection" >}})** — SSD-MobileNet, YOLO nano variants, non-maximum suppression, mAP evaluation, and end-to-end camera pipelines on Pi 5 and Jetson.
- **[Semantic Segmentation]({{< relref "semantic-segmentation" >}})** — DeepLab-v3 MobileNet, lightweight U-Net, per-pixel output decoding, memory constraints, and practical applications.
- **[Pose Estimation]({{< relref "pose-estimation" >}})** — MoveNet, BlazePose, heatmap vs regression approaches, skeleton overlay rendering, and gesture control applications.
