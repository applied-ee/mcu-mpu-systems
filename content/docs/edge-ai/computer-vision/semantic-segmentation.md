---
title: "Semantic Segmentation"
weight: 30
---

# Semantic Segmentation

Semantic segmentation assigns a class label to every pixel in an image, producing a dense class map rather than sparse bounding boxes. Where [object detection]({{< relref "object-detection" >}}) answers "what objects are present and roughly where," segmentation answers "which class does this exact pixel belong to." This pixel-level precision is essential for tasks like autonomous navigation (identifying drivable surface vs obstacle at the boundary), agricultural robotics (distinguishing crop from weed at the stem level), and industrial inspection (measuring defect area in square millimeters rather than bounding box approximations).

The cost of this precision is substantial: segmentation models produce output tensors orders of magnitude larger than classification or detection models, and intermediate feature maps consume proportionally more memory. Real-time segmentation on a microcontroller is rarely feasible — the minimum practical platform is a Linux SBC with enough RAM for the model and its activations.

## DeepLab-v3 with MobileNet Backbone

DeepLab-v3 is the most widely deployed segmentation architecture on edge platforms. It combines a lightweight backbone (MobileNet-v2) with specialized modules for capturing multi-scale context without increasing the number of parameters.

### Atrous (Dilated) Convolutions

Standard convolutions have a fixed receptive field determined by the kernel size. A 3x3 convolution sees a 3x3 region of the input. Atrous convolutions insert gaps (holes) between kernel elements, expanding the receptive field without increasing the number of parameters or compute:

- **Rate 1** (standard): 3x3 kernel, 3x3 receptive field
- **Rate 6**: 3x3 kernel, 13x13 receptive field
- **Rate 12**: 3x3 kernel, 25x25 receptive field
- **Rate 18**: 3x3 kernel, 37x37 receptive field

This is critical for segmentation because pixels near the center of a large object need context from the object's edges (and beyond) to be classified correctly. Without atrous convolutions, achieving the same receptive field would require either deeper networks (more parameters, more compute) or larger kernels (quadratically more parameters).

### ASPP (Atrous Spatial Pyramid Pooling)

The ASPP module applies atrous convolutions at multiple rates in parallel and concatenates the results. A typical DeepLab-v3 ASPP uses rates of 6, 12, and 18, plus a 1x1 convolution and a global average pooling branch. The concatenated features capture context at multiple spatial scales, allowing the model to simultaneously reason about local texture (rate 1) and global scene layout (global pooling).

### Output Stride

The **output stride** is the ratio of input resolution to feature map resolution. DeepLab-v3 supports two configurations:

- **Output stride 16** — The backbone downsamples the input by 16x (e.g., 512x512 input produces 32x32 feature maps). Faster inference, lower memory, but coarser spatial resolution in the output.
- **Output stride 8** — The backbone downsamples by only 8x (64x64 feature maps for 512x512 input). Finer boundaries at ~2x the compute and memory cost.

The output, regardless of stride, is bilinearly upsampled to the input resolution during post-processing. Output stride 16 with bilinear upsampling is the standard starting configuration for edge deployment — the upsampling is nearly free compared to the inference cost of output stride 8.

## Lightweight U-Net Variants

U-Net uses an encoder-decoder architecture with skip connections. The encoder progressively downsamples and extracts features (like a classification backbone). The decoder progressively upsamples, and **skip connections** from the encoder inject high-resolution spatial detail at each decoder stage. This combination of deep semantic features (from the bottleneck) and shallow spatial features (from the skip connections) produces segmentation masks with sharp boundaries.

For edge deployment, lightweight U-Net variants replace the standard encoder with a MobileNet or EfficientNet backbone and reduce the decoder channel count. A U-Net with a MobileNet-v2 encoder and a decoder with 64-128 channels per stage achieves reasonable segmentation quality in under 5M parameters.

The U-Net architecture is particularly effective for binary or few-class segmentation tasks (defect/no-defect, crop/weed, road/not-road) where the spatial precision of skip connections matters more than the multi-scale context modeling of ASPP.

On microcontroller-class devices, sub-megabyte U-Net variants with 3–5 encoder stages and heavily reduced channel counts (16–32 channels) have been demonstrated on Cortex-M7, though at input resolutions below 96x96 and with very limited class counts (2–4 classes).

## Output Format and Decoding

A segmentation model outputs a tensor of shape [1, H, W, C] (TFLite convention) or [1, C, H, W] (PyTorch/ONNX convention), where H and W are the output spatial dimensions and C is the number of classes.

Each spatial position (h, w) contains C values — one logit (or probability, if softmax is applied) per class. The predicted class for each pixel is the argmax across the C dimension:

```python
# TFLite output: [1, H, W, C]
output = interpreter.get_tensor(output_details[0]['index'])
class_map = np.argmax(output[0], axis=-1)  # [H, W] — class index per pixel
```

For DeepLab-v3 trained on PASCAL VOC (21 classes: background + 20 object classes) with a 257x257 input, the output tensor is [1, 257, 257, 21] in float32 — approximately 5.5 MB. In uint8, this drops to ~1.4 MB. This is the memory floor for storing a single segmentation output.

## Memory Challenges

Segmentation models have the largest memory footprint of common vision tasks because both the output tensor and intermediate feature maps scale with spatial resolution:

| Component | Classification (224x224, 1000 classes) | Detection (300x300, 90 classes) | Segmentation (256x256, 21 classes) |
|-----------|---------------------------------------|--------------------------------|-----------------------------------|
| Output tensor | 4 KB (1x1000 float32) | ~40 KB (100 boxes x 4+1+1) | 5.5 MB (256x256x21 float32) |
| Peak activation memory | ~2–4 MB | ~4–8 MB | ~8–20 MB |

The peak activation memory is the critical constraint. During inference, intermediate feature maps at multiple resolutions must be held simultaneously. A DeepLab-v3 MobileNet-v2 with output stride 8 at 512x512 input requires ~18 MB of activation memory — this exceeds the total RAM of most microcontrollers and limits deployment to Linux SBCs with at least 256 MB of available system memory.

### Memory Reduction Strategies

- **Reduce input resolution** — Halving the input from 512x512 to 256x256 reduces activation memory by ~4x. The trade-off is coarser boundaries.
- **Use output stride 16 instead of 8** — Reduces feature map size by 4x at each spatial dimension with ~2x total memory savings.
- **Use uint8 output** — Quantized models produce uint8 output tensors directly, reducing output memory 4x vs float32.
- **Tile-based inference** — Process the image in overlapping tiles and stitch the segmentation maps. This bounds peak memory at the cost of increased total compute (due to overlap) and potential stitching artifacts at tile boundaries.

## Post-Processing

### Argmax and Class Mapping

The raw output is a per-pixel class index (0 to C-1). Mapping this to a human-interpretable visualization requires a color lookup table:

```python
# PASCAL VOC 21-class color map (simplified)
COLOR_MAP = {
    0: (0, 0, 0),       # background — black
    1: (128, 0, 0),     # aeroplane — dark red
    7: (0, 128, 128),   # car — teal
    15: (128, 128, 0),  # person — olive
    # ...
}

colored_mask = np.zeros((*class_map.shape, 3), dtype=np.uint8)
for class_id, color in COLOR_MAP.items():
    colored_mask[class_map == class_id] = color
```

### Overlay Blending

Overlaying the colored segmentation mask on the original image uses alpha blending:

```python
alpha = 0.4  # Mask transparency
overlay = cv2.addWeighted(original_image, 1 - alpha, colored_mask, alpha, 0)
```

### Connected Component Analysis

For applications that need individual object instances (rather than just per-pixel class labels), connected component analysis on the binary mask of each class identifies spatially separate regions. OpenCV's `cv2.connectedComponentsWithStats()` returns the area, centroid, and bounding box of each component. This provides a rough instance segmentation from a semantic segmentation model — useful for counting objects (e.g., number of separate weed patches) without the complexity of a true instance segmentation model.

## Applications

### Autonomous Navigation

Segmentation models trained to classify pixels as "drivable surface," "obstacle," "lane marking," and "off-road" provide more precise navigation boundaries than bounding box detection. A detection model identifies a "pedestrian" with a bounding box that includes empty space; a segmentation model traces the exact silhouette, enabling tighter path planning.

On platforms like the Jetson Orin Nano, a lightweight segmentation model (DeepLab-v3 MobileNet at 256x256) runs at 30–60 FPS alongside a detection model, providing complementary spatial information.

### Agricultural Robotics

Crop-vs-weed segmentation at the pixel level enables precision spraying systems that apply herbicide only to weed pixels, reducing chemical usage by 70–90% compared to broadcast spraying. The segmentation must be accurate at the boundary between crop and weed, which grow in close proximity — a task where bounding box detection fundamentally lacks the spatial resolution needed.

### Industrial Inspection

Defect segmentation produces a pixel-accurate defect mask that can be measured in physical units (given known camera geometry). Rather than "defect detected" (classification) or "defect bounding box" (detection), segmentation outputs "defect area is 2.3 mm² with an irregular boundary." This level of quantification supports automated pass/fail decisions based on defect size thresholds.

## Tips

- Start with output stride 16 for edge deployment. Output stride 8 doubles the feature map area, which approximately doubles both the inference time and the activation memory. The boundary improvement from output stride 8 is often not visible at deployment input resolutions below 512x512.
- Use bilinear upsampling in post-processing rather than in the model. Upsampling a 32x32 class map to 512x512 with bilinear interpolation on the CPU takes under 1 ms and avoids embedding the upsampling in the model graph (where it consumes accelerator resources).
- Reduce input resolution before reducing model complexity. A DeepLab-v3 MobileNet at 256x256 outperforms a heavily pruned model at 512x512 because the backbone's feature extraction capacity is preserved.
- For binary segmentation tasks (2 classes), the output tensor is [H, W, 2] or equivalently just [H, W, 1] with a sigmoid output. This reduces output memory by 10x compared to a 21-class model and enables deployment on more constrained platforms.
- Quantize the model to uint8 to reduce output tensor memory by 4x. A 256x256x21 uint8 output is 1.4 MB vs 5.5 MB in float32 — the difference between fitting in L2 cache and triggering main memory access on some platforms.

## Caveats

- **Segmentation models have the largest memory footprint of common vision tasks.** The combination of spatially large output tensors and multi-scale intermediate feature maps means that a segmentation model that fits in flash (model weights) may still exceed available RAM (activation memory). Always check activation memory requirements, not just model file size.
- **Real-time segmentation on microcontrollers is rarely feasible.** Even a minimal U-Net at 96x96 with 4 classes runs at 1–3 FPS on a Cortex-M7 at 480 MHz. For practical segmentation applications, a Linux SBC with at least 512 MB RAM is the minimum platform.
- **Boundary accuracy suffers disproportionately at low input resolution.** A 128x128 segmentation model produces a class map where each pixel represents a 4x4 or larger region of the original image (depending on camera resolution). Fine boundaries — the exact edge of a road, the outline of a person — become blocky and unreliable. This is acceptable for coarse spatial reasoning but insufficient for precision applications.
- **Class imbalance in training data causes dominant-class bias.** If 80% of training pixels are "background," the model learns that predicting "background" everywhere achieves 80% pixel accuracy. Proper training requires weighted loss functions (inverse class frequency weighting) or oversampling of minority-class images.
- **The NHWC vs NCHW tensor layout convention differs between TFLite and ONNX.** A TFLite model outputs [1, H, W, C] while an ONNX model outputs [1, C, H, W]. Applying `argmax(axis=-1)` to an NCHW tensor takes the argmax across the width dimension instead of the class dimension, producing a spatially meaningless result.

## In Practice

- **A segmentation mask that appears blocky or coarse, with staircase-like boundaries**, commonly appears when the output stride is too high (16 or 32) without sufficient post-processing upsampling, or when the input resolution is too low for the scene complexity. Increasing the input resolution from 128x128 to 256x256 often improves boundary quality more than switching from output stride 16 to 8.
- **One class dominating the entire image** — every pixel predicted as "background" or "road" regardless of actual content — often reflects class imbalance in the training data. The model learns that the dominant class is the safest prediction everywhere. This also appears when the softmax temperature is miscalibrated, causing the model to produce near-uniform probabilities that happen to favor the majority class by a tiny margin at every pixel.
- **Segmentation that works on test images but fails on live camera frames** typically indicates a color space or normalization mismatch between the training data pipeline and the live camera pipeline. Training data preprocessed with PIL (RGB, [0, 255]) and live frames captured with OpenCV (BGR, [0, 255]) produce different channel orderings. The model runs without error but the feature activations are systematically wrong, leading to incorrect segmentation.
- **A segmentation model that produces reasonable results on most of the image but fails at the boundaries between large objects** suggests insufficient receptive field in the decoder. The model correctly classifies pixels deep inside each region but lacks the spatial context to resolve ambiguous boundary pixels. This is more pronounced with U-Net variants that use small decoder kernels and at lower input resolutions.
- **Inference time that varies significantly between frames** — some frames taking 2x longer than others — often appears when the model includes data-dependent operations (conditional branches, dynamic shapes) or when the platform's memory system introduces variable latency due to cache thrashing. Segmentation models are more susceptible to cache effects than classification models because their activation tensors are larger and access patterns are less predictable.
