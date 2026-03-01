---
title: "Object Detection"
weight: 20
---

# Object Detection

Object detection localizes and classifies multiple objects within a single image, producing a set of bounding boxes, each with a class label and confidence score. Unlike [image classification]({{< relref "image-classification" >}}), which assigns one label to the entire frame, detection answers both "what" and "where" for every object of interest. This makes it the foundation for camera-based counting, tracking, safety monitoring, and autonomous navigation on edge platforms. The computational cost is substantially higher than classification — a detection model must evaluate spatial features at multiple scales and apply post-processing to filter and deduplicate predictions — making model selection and pipeline optimization critical for real-time performance on constrained hardware.

## Single-Shot vs Two-Stage Detectors

Detection architectures fall into two families:

- **Two-stage detectors** (Faster R-CNN, Mask R-CNN) first generate region proposals — candidate bounding boxes likely to contain objects — then classify and refine each proposal independently. This two-pass approach achieves high accuracy but requires substantial compute and memory. Faster R-CNN with a ResNet-50 backbone requires ~60 GFLOPs per frame, making it impractical for all but the most capable edge hardware (high-end Jetson modules at reduced frame rates).

- **Single-shot detectors** (SSD, YOLO, EfficientDet) predict bounding boxes and class probabilities in a single forward pass through the network. This eliminates the proposal generation stage and yields much lower latency at the cost of some accuracy, particularly on small objects. Single-shot detectors are the practical choice for edge deployment.

## SSD-MobileNet

SSD (Single Shot MultiBox Detector) with a MobileNet backbone is the most widely supported edge detection model. It appears in TensorFlow's model zoo, runs on TFLite, TFLM, Hailo, and TensorRT, and has extensive deployment documentation.

### Architecture

SSD attaches detection heads to multiple feature maps at different spatial resolutions extracted from the backbone network. A typical SSD-MobileNet-v2 uses feature maps at 19x19, 10x10, 5x5, 3x3, 2x2, and 1x1 spatial resolutions. Each feature map location predicts bounding boxes relative to a set of predefined **anchor boxes** (also called default boxes or priors) of various aspect ratios.

At each feature map location, the detection head predicts:
- **Box offsets** — 4 values (center-x, center-y, width, height) as deltas from the anchor box.
- **Class scores** — One score per class plus a background class.

For a model with 6 anchor boxes per location across all feature map scales, the total number of candidate predictions is roughly: (19x19x6) + (10x10x6) + (5x5x6) + (3x3x6) + (2x2x6) + (1x1x6) = 2166 + 600 + 150 + 54 + 24 + 6 = 2994 candidate boxes. Most of these will have low confidence and are filtered during post-processing.

### Output Tensor Format

SSD-MobileNet models exported from the TensorFlow Object Detection API produce four output tensors:

| Tensor | Shape | Content |
|--------|-------|---------|
| `detection_boxes` | [1, N, 4] | Bounding boxes as [ymin, xmin, ymax, xmax] in normalized [0,1] coordinates |
| `detection_classes` | [1, N] | Class indices (1-indexed, where 1 is the first class) |
| `detection_scores` | [1, N] | Confidence scores per detection |
| `num_detections` | [1] | Number of valid detections (remaining entries are padding) |

N is typically 10, 25, or 100 depending on the model export configuration. The detections are sorted by confidence score in descending order, and NMS is already applied — the output is ready for rendering.

The coordinate format is a critical detail: TF SSD models use [ymin, xmin, ymax, xmax] in normalized [0,1] coordinates, not pixel coordinates and not [xmin, ymin, xmax, ymax]. Swapping x and y produces bounding boxes that are transposed across the diagonal of the image.

### Multi-Scale Feature Maps

The multi-scale detection heads are what allow SSD to detect objects at different sizes. The 19x19 feature map (with its small receptive field per cell) detects small objects; the 1x1 feature map (with a receptive field covering the entire image) detects very large objects. The anchor boxes at each scale are sized proportionally:

- 19x19 feature map: anchor boxes sized at ~10-20% of the image
- 5x5 feature map: anchor boxes sized at ~40-60% of the image
- 1x1 feature map: anchor boxes sized at ~80-100% of the image

Objects whose size falls between anchor scales — or objects significantly smaller than the smallest anchors — are likely to be missed. This is the primary accuracy limitation of SSD on small object detection.

## YOLO for Edge

YOLO (You Only Look Once) takes a different approach to single-shot detection. Rather than attaching detection heads to multiple feature maps from a backbone, YOLO processes the entire image through a feature pyramid network (FPN) and makes predictions on a grid overlaid on the image at multiple scales.

### YOLOv5 Nano

YOLOv5n (nano) from Ultralytics is a compact YOLO variant with ~1.9M parameters. It uses a CSPNet backbone, PANet neck for feature aggregation, and three detection heads at scales of 80x80, 40x40, and 20x20 (for 640x640 input). The model outputs anchor-based predictions, where each grid cell predicts bounding boxes relative to predefined anchor shapes.

YOLOv5n achieves approximately 28% mAP@0.5:0.95 on COCO — lower than SSD-MobileNet-v2 (~22% mAP@0.5:0.95) by some benchmarks, though direct comparison depends heavily on input resolution and quantization. The key advantage is the architecture's efficiency on GPU-accelerated platforms.

### YOLOv8 Nano

YOLOv8n replaces anchor-based prediction with **anchor-free** detection. Instead of predicting offsets from predefined anchor boxes, each grid cell directly predicts the distance from the cell center to the four edges of the bounding box. This eliminates the anchor box hyperparameter and the associated tuning.

YOLOv8n has ~3.2M parameters and achieves ~37% mAP@0.5:0.95 on COCO at 640x640 — a significant improvement over YOLOv5n. The architecture uses a C2f (Cross Stage Partial with 2 convolutions, fused) module in the backbone, which provides better gradient flow than YOLOv5's C3 module.

### YOLO Output Format

YOLO models output a tensor of shape [1, N, 5+C] (YOLOv5) or [1, 5+C, N] (YOLOv8) where N is the total number of grid predictions across all scales and C is the number of classes. For YOLOv8n at 640x640 with 80 COCO classes:

- Grid predictions: (80x80 + 40x40 + 20x20) = 8400 predictions
- Each prediction: [x_center, y_center, width, height, class_0_score, class_1_score, ..., class_79_score]
- Total output shape: [1, 84, 8400] — note the transposed layout compared to YOLOv5

The output requires decoding: extracting x, y, w, h, computing the class with the highest score, filtering by confidence threshold, and applying NMS. This decoding step is **not** included in the model — it must be implemented in the application code.

This is a key difference from SSD-MobileNet TFLite models, where NMS is baked into the model graph and the output is ready to use.

## Non-Maximum Suppression (NMS)

Detection models produce many overlapping candidate boxes for each object. NMS filters these down to one box per object.

### Algorithm

1. Sort all detections by confidence score (descending).
2. Select the highest-scoring detection and add it to the output list.
3. Compute the Intersection over Union (IoU) between the selected detection and every remaining detection.
4. Remove all detections with IoU above the NMS threshold (typically 0.45–0.5).
5. Repeat from step 2 with the remaining detections until none are left.

### IoU (Intersection over Union)

IoU measures the overlap between two bounding boxes:

```
IoU = Area of Intersection / Area of Union
```

An IoU of 0.0 means no overlap. An IoU of 1.0 means the boxes are identical. The NMS IoU threshold controls how much overlap is tolerated before a detection is suppressed — a threshold of 0.5 suppresses any detection that overlaps more than 50% with a higher-scoring detection.

### Class-Aware vs Class-Agnostic NMS

- **Class-aware NMS** — NMS is applied independently per class. Two overlapping boxes of different classes (e.g., "car" and "truck") are both kept because they are processed in separate NMS passes.
- **Class-agnostic NMS** — All detections compete in a single NMS pass regardless of class. An overlapping "car" and "truck" detection would suppress the lower-scoring one.

Class-aware NMS is the standard approach. Class-agnostic NMS is appropriate when overlapping objects of different classes are unlikely (single-class detection) or when reducing total detection count is more important than class-level accuracy.

### NMS as a Bottleneck

On microcontrollers, NMS can dominate the post-processing time. The sorting step is O(N log N) and the pairwise IoU computation is O(N²) in the worst case, where N is the number of candidate detections. SSD-MobileNet with ~3000 candidates keeps this manageable, but YOLO with 8400 grid predictions requires filtering by confidence threshold first (reducing N to a few hundred) before NMS becomes tractable on a Cortex-M class processor.

A common optimization is to apply a hard confidence threshold (e.g., 0.25) before NMS to discard the vast majority of low-scoring candidates. On YOLOv8 with 8400 predictions, typically fewer than 100 exceed a 0.25 confidence threshold, reducing the NMS input to a manageable size.

## mAP (Mean Average Precision)

mAP is the standard metric for evaluating detection models. Understanding what the numbers mean — and what they do not mean — is essential for selecting and comparing models.

### How mAP Is Computed

1. For each class, sort all detections across all test images by confidence score.
2. Match each detection to a ground truth box using an IoU threshold. A detection is a true positive if it matches an unmatched ground truth box with IoU above the threshold.
3. Compute precision and recall at each confidence threshold, forming a precision-recall curve.
4. Compute Average Precision (AP) as the area under the precision-recall curve (using 101-point interpolation for COCO).
5. mAP is the mean of AP across all classes.

### mAP Variants

- **mAP@0.5** (PASCAL VOC metric) — Uses IoU threshold 0.5. A predicted box that overlaps at least 50% with the ground truth counts as correct. This is a lenient metric; bounding boxes can be noticeably offset and still count.
- **mAP@0.5:0.95** (COCO primary metric) — Averages mAP across IoU thresholds from 0.5 to 0.95 in steps of 0.05. This penalizes imprecise localization much more heavily and is typically 15–25 percentage points lower than mAP@0.5 for the same model.

A model reporting 45% mAP@0.5 and 28% mAP@0.5:0.95 is not "bad at detection" — the gap between these numbers is normal and reflects the stringency of the COCO metric.

### Practical Interpretation

mAP numbers from model zoos are computed on COCO (80 classes, 118K training images, highly diverse). Custom datasets with fewer classes, more uniform backgrounds, or larger objects typically yield higher mAP than COCO. Conversely, custom datasets with unusual object sizes, heavy occlusion, or classes not well-represented in COCO pretraining may yield lower mAP.

Direct comparison between mAP numbers is valid only when models are evaluated on the same dataset, with the same IoU threshold, and the same evaluation protocol. A "42% mAP" model evaluated on a custom 5-class dataset is not comparable to a "38% mAP" model evaluated on COCO.

## End-to-End Pipeline: Raspberry Pi 5 + AI HAT+

The Raspberry Pi AI HAT+ (Hailo-8L, 13 TOPS) integrates with the `rpicam-apps` camera framework through a post-processing pipeline:

### Pipeline Architecture

```
Camera (IMX219/IMX708)
  → rpicam-apps (frame capture, ISP processing)
    → Hailo runtime (model inference on NPU)
      → Post-process plugin (NMS, bounding box decode)
        → Overlay renderer (draw boxes on frame)
          → Display / RTSP / file output
```

### Configuration

The pipeline is configured through a JSON file that specifies the model (HEF format compiled for Hailo-8L), the post-processing library, and display parameters:

```json
{
    "detection": {
        "model": "ssd_mobilenet_v2.hef",
        "postprocess": "libnms.so",
        "confidence_threshold": 0.5,
        "iou_threshold": 0.45,
        "labels": "coco_labels.txt",
        "overlay": {
            "box_color": [0, 255, 0],
            "thickness": 2,
            "font_scale": 0.6
        }
    }
}
```

### Typical Performance

| Model | Input Resolution | FPS (Hailo-8L) | Notes |
|-------|-----------------|----------------|-------|
| SSD-MobileNet-v2 | 300x300 | 25–30 | NMS on ARM CPU, ~2 ms overhead |
| YOLOv5n | 640x640 | 18–22 | Requires Hailo Model Zoo HEF |
| YOLOv8n | 640x640 | 15–20 | Post-process decode more complex |

The bottleneck at high frame rates shifts from inference (handled by the NPU) to the CPU-side post-processing and overlay rendering. Disabling the overlay display and running headless can increase throughput by 20–30%.

## End-to-End Pipeline: Jetson Orin Nano

The Jetson Orin Nano (40 TOPS GPU) uses NVIDIA's DeepStream SDK or direct GStreamer pipelines with the `nvinfer` plugin for detection:

### DeepStream Pipeline

```
v4l2src (USB camera) or nvarguscamerasrc (CSI camera)
  → nvvideoconvert (color space, scaling)
    → nvinfer (TensorRT inference)
      → nvtracker (optional multi-object tracking)
        → nvosd (on-screen display, bounding boxes)
          → nv3dsink (display) or filesink (recording)
```

### nvinfer Configuration

The `nvinfer` plugin is configured through a text config file:

```ini
[property]
gpu-id=0
net-scale-factor=0.00784313725  # 1/127.5 for [-1,1] normalization
model-engine-file=ssd_mobilenet_v2.engine
labelfile-path=coco_labels.txt
batch-size=1
network-mode=1  # 0=FP32, 1=FP16, 2=INT8
num-detected-classes=91
interval=0  # Infer on every frame

[class-attrs-all]
nms-iou-threshold=0.45
pre-cluster-threshold=0.4
```

### TensorRT Engine Generation

TensorRT engines are hardware-specific optimized representations of the model. The engine is generated once on the target device:

```bash
trtexec --onnx=ssd_mobilenet_v2.onnx \
        --saveEngine=ssd_mobilenet_v2.engine \
        --fp16 \
        --workspace=1024
```

Engine generation takes 1–10 minutes depending on model complexity. The resulting `.engine` file is not portable between different Jetson hardware variants or JetPack versions.

### Multi-Stream Capability

The Jetson Orin Nano can process multiple camera streams simultaneously. A 4-stream detection pipeline with SSD-MobileNet-v2 at FP16 typically achieves:

- 4 streams x 30 FPS each = 120 inferences/sec total
- GPU utilization ~60–70%
- Power consumption ~10–12W

This multi-stream capability is a primary advantage over single-stream NPU solutions like the Hailo-8L.

### Typical Performance

| Model | Input Resolution | FPS (single stream) | Precision |
|-------|-----------------|---------------------|-----------|
| SSD-MobileNet-v2 | 300x300 | 120+ | FP16 |
| YOLOv5n | 640x640 | 80–100 | FP16 |
| YOLOv8n | 640x640 | 60–80 | FP16 |
| YOLOv8s | 640x640 | 30–45 | FP16 |

## Anchor Box Tuning

Anchor boxes (or default boxes/priors) define the set of candidate bounding box shapes that the model can predict offsets from. Standard models ship with anchors tuned for the COCO dataset, where objects span a wide range of sizes and aspect ratios.

### When Anchors Need Tuning

If the target objects have a significantly different size distribution than COCO — for example, detecting small screws on a conveyor belt (objects covering <1% of the image) or detecting building facades in aerial imagery (objects covering 30–80% of the image) — the COCO anchors will be a poor fit. The model will struggle to detect objects whose sizes do not match any anchor closely.

### K-Means Clustering for Custom Anchors

The standard approach for custom anchor generation:

1. Collect bounding box annotations for the target dataset.
2. Extract all box widths and heights (normalized to [0,1] relative to image dimensions).
3. Run k-means clustering with k equal to the desired number of anchors (typically 6 or 9 for YOLO, varies by SSD configuration).
4. Use the cluster centroids as the new anchor shapes.
5. Retrain (or fine-tune) the model with the new anchors.

The distance metric for k-means should be `1 - IoU` rather than Euclidean distance, since IoU better captures the overlap relationship that anchors are meant to approximate.

## Output Tensor Parsing

The differences in output tensor format between SSD and YOLO are a frequent source of integration bugs:

### SSD Output (TFLite)

```python
# TFLite SSD output — NMS already applied
boxes = interpreter.get_tensor(output_details[0]['index'])    # [1, N, 4] — [ymin, xmin, ymax, xmax]
classes = interpreter.get_tensor(output_details[1]['index'])   # [1, N] — class index (1-indexed)
scores = interpreter.get_tensor(output_details[2]['index'])    # [1, N] — confidence
count = interpreter.get_tensor(output_details[3]['index'])     # [1] — number of valid detections
```

### YOLO Output (ONNX/TFLite)

```python
# YOLOv8 raw output — requires decoding and NMS
output = session.run(None, {"images": input_tensor})[0]  # [1, 84, 8400] for 80-class COCO
output = output[0].T  # Transpose to [8400, 84]

boxes = output[:, :4]        # [x_center, y_center, width, height]
class_scores = output[:, 4:] # [8400, 80] — one score per class

# Per-prediction: max class score and class index
confidences = class_scores.max(axis=1)
class_ids = class_scores.argmax(axis=1)

# Filter by confidence
mask = confidences > 0.25
filtered_boxes = boxes[mask]
filtered_scores = confidences[mask]
filtered_classes = class_ids[mask]

# Convert x_center, y_center, w, h → x1, y1, x2, y2
# Then apply NMS
```

The output tensor ordering is **not standardized** across YOLO versions. YOLOv5 outputs [1, 25200, 85] (predictions x attributes), while YOLOv8 outputs [1, 84, 8400] (attributes x predictions). Using the wrong parsing code for the YOLO version produces garbled detections without any obvious error.

## Tips

- Start with SSD-MobileNet-v2 for maximum compatibility across inference runtimes. It runs on TFLite (MCU and Linux), TensorRT, Hailo, and ONNX Runtime with minimal configuration. Switch to YOLOv8n when the runtime supports it and better accuracy is needed.
- An NMS confidence threshold of 0.5 is a reasonable starting default. Lower to 0.3 for applications where missed detections are costly (safety monitoring). Raise to 0.7 for applications where false positives are more disruptive (autonomous navigation).
- Always verify output tensor ordering by running a known test image and checking that the first detection matches expected coordinates. A transposed or reordered tensor produces detections that look spatially wrong in a distinctive way.
- For YOLO deployment, apply a confidence pre-filter before NMS to reduce the candidate count from thousands to hundreds. On embedded Linux platforms, this reduces NMS latency from tens of milliseconds to under a millisecond.
- When evaluating models, test on images from the actual deployment camera at the actual deployment resolution and lighting. COCO mAP numbers provide a relative ranking but do not predict absolute performance on a custom use case.
- On Jetson, always generate TensorRT engines on the target device with the target JetPack version. Engines are not portable between Orin Nano and Xavier NX, or between JetPack 5.x and 6.x.
- For Pi 5 + AI HAT+ deployments, use the Hailo Model Zoo HEF files as starting points. Compiling custom models through the Hailo Dataflow Compiler requires attention to supported layer types and quantization parameters.

## Caveats

- **YOLO output decoding differs between major versions (v5, v7, v8, v9) in non-trivial ways.** The tensor layout, anchor handling (anchor-based vs anchor-free), and score format (objectness x class score vs direct class score) all change. Parsing code written for YOLOv5 will silently produce garbage when applied to a YOLOv8 model.
- **NMS on microcontrollers can take longer than inference itself.** YOLO models produce thousands of candidate predictions, and the O(N²) pairwise IoU computation becomes dominant on Cortex-M processors without SIMD-accelerated NMS implementations. SSD models with built-in NMS avoid this problem but reduce flexibility.
- **mAP numbers from model zoos are evaluated on COCO.** A model achieving 37% mAP@0.5:0.95 on COCO may achieve 75% on a well-curated custom dataset with 5 classes and controlled lighting, or 15% on a difficult dataset with heavy occlusion and small objects. COCO mAP is a relative ranking metric, not an absolute performance predictor.
- **Anchor boxes tuned for COCO may not match custom object sizes.** COCO objects span a wide size range; a custom dataset with objects clustered in a narrow size range (e.g., all objects are 20x30 pixels) leaves most anchors unused, reducing effective detection capacity.
- **TensorRT engines are not portable.** An engine generated on a Jetson Orin Nano does not run on an Orin NX, a different JetPack version, or even the same hardware with a different CUDA driver. Engine files must be generated on the exact deployment hardware.
- **DeepStream pipeline configuration is sensitive to tensor dimension ordering.** An incorrect `network-mode`, `num-detected-classes`, or `net-scale-factor` value causes detection failures that range from no detections to spatially offset boxes, with no error message indicating the root cause.

## In Practice

- **Detections that are consistently offset from actual objects** — bounding boxes shifted right or down relative to the real object position — commonly appear when anchor box dimensions do not match the model's expected input resolution. This also occurs when the coordinate decoding step applies the wrong scale factor, such as normalizing to the input tensor resolution instead of the original image resolution.
- **Many overlapping bounding boxes on the same object** indicate that NMS is either not running or is configured with too high an IoU threshold (e.g., 0.9 instead of 0.5). In YOLO deployments where NMS is implemented in application code, a missing NMS step produces the raw grid predictions as output — hundreds of overlapping boxes on a single prominent object.
- **Good mAP on the evaluation dataset but frequent missed detections at a specific object size** reveals an anchor scale gap. If the smallest anchor covers 10% of the image but the objects of interest cover 3%, those objects fall below the detection floor. K-means anchor clustering on the target dataset and retraining resolves this.
- **FPS drops significantly when many objects appear in the frame** is a symptom of NMS cost scaling with detection count. Each additional above-threshold detection increases the pairwise IoU computation. In worst-case scenarios (dense crowd scenes, stockpile counting), NMS can consume more time than inference. Limiting the maximum detection count or using a faster NMS variant (e.g., batched NMS on GPU) addresses the bottleneck.
- **A detection model that produces reasonable results on a desktop GPU but fails entirely on the edge device** — either no detections or all detections at the image origin — typically reflects a mismatch in the export/conversion pipeline. Common causes include: output tensor reordering during ONNX export, incorrect quantization of the detection head, or a preprocessing difference (the edge runtime applies a different resize or padding strategy than the training framework).
- **Bounding boxes that are correct in x but mirrored in y (or vice versa)** result from a coordinate convention mismatch. The model outputs [ymin, xmin, ymax, xmax] (TF convention) but the rendering code expects [xmin, ymin, xmax, ymax]. This produces boxes that are reflected across the diagonal of the image.
- **Detection confidence scores that are uniformly low after quantization** (all detections below 0.3 even for clearly visible objects) suggest that the quantization calibration did not capture the score distribution correctly. The sigmoid or softmax output layer is particularly sensitive to quantization range errors. Recalibrating with a representative dataset that includes frames with and without objects improves score distribution accuracy.
