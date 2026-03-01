---
title: "Pose Estimation"
weight: 40
---

# Pose Estimation

Pose estimation localizes body keypoints — joints, facial landmarks, or extremities — within an image, producing a skeleton that describes a person's body configuration. Unlike [object detection]({{< relref "object-detection" >}}), which outputs a bounding box around the whole person, or [semantic segmentation]({{< relref "semantic-segmentation" >}}), which labels every pixel as "person" or "not person," pose estimation outputs the spatial coordinates of anatomically meaningful points: shoulders, elbows, wrists, hips, knees, ankles, and others. This enables applications that depend on understanding body posture — fitness form analysis, gesture control interfaces, fall detection in elder care, and sign language recognition.

## Keypoint Sets

Different models define different sets of keypoints:

### COCO 17-Keypoint Format

The COCO dataset defines 17 body keypoints used by most general-purpose pose models:

| Index | Keypoint | Index | Keypoint |
|-------|----------|-------|----------|
| 0 | Nose | 9 | Left wrist |
| 1 | Left eye | 10 | Right hip |
| 2 | Right eye | 11 | Left hip |
| 3 | Left ear | 12 | Right knee |
| 4 | Right ear | 13 | Left knee |
| 5 | Left shoulder | 14 | Right ankle |
| 6 | Right shoulder | 15 | Left ankle |
| 7 | Left elbow | 16 | — |
| 8 | Right elbow | | |

The skeleton connectivity (which keypoints to connect with lines) is defined by a set of pairs: (5,6) for shoulders, (5,7) and (7,9) for left arm, (6,8) and (8,10) for right arm, (11,12) for hips, (11,13) and (13,15) for left leg, (12,14) and (14,16) for right leg, and (0,1), (0,2), (1,3), (2,4) for the face.

Note the left/right convention: "left" refers to the person's left (which appears on the right side of the image when facing the camera). Misinterpreting this convention produces skeletons that are mirrored left-to-right.

### BlazePose 33-Keypoint Format

BlazePose extends the COCO keypoints with hand, foot, and body landmarks — 33 keypoints total. The additional keypoints include: index fingertips, pinky fingertips, wrists with orientation, heels, and toe tips. This extended set enables hand gesture recognition and foot placement analysis without requiring separate hand/foot detection models.

## Two Approaches: Heatmap vs Regression

### Heatmap-Based

The model outputs a tensor of shape [H, W, K] where K is the number of keypoints. Each HxW slice is a heatmap (spatial probability map) for one keypoint, with the peak value indicating the most likely keypoint location. Decoding extracts the (x, y) position from each heatmap via argmax or weighted average around the peak.

Heatmaps provide a natural confidence measure (the peak value) and spatially smooth predictions, but the output tensor is large: 17 keypoints at 64x64 resolution = 69,632 float32 values (~272 KB). Higher heatmap resolution improves localization precision but increases memory proportionally.

Sub-pixel accuracy can be extracted by fitting a 2D Gaussian around the peak rather than using raw argmax. This improves keypoint localization by 1–2 pixels at the cost of additional post-processing compute.

### Regression-Based

The model directly outputs a vector of keypoint coordinates [x0, y0, conf0, x1, y1, conf1, ..., xK, yK, confK]. For 17 keypoints, this is a 51-element vector — trivial memory compared to heatmaps.

Regression is faster to decode and uses far less memory, but training regression models to high accuracy is more difficult. The loss function must balance coordinate precision across keypoints at very different spatial scales, and small errors in the regression output have no spatial smoothing to absorb them.

Most modern edge pose models use regression for efficiency, sometimes with a lightweight heatmap stage during training that is distilled into a regression output for deployment.

## MoveNet

MoveNet is Google's lightweight pose estimation model designed specifically for edge deployment. It operates directly on camera frames without requiring a separate person detector (for the single-pose variant).

### MoveNet Lightning

MoveNet Lightning is the speed-optimized variant:

- **Input**: 192x192 RGB image
- **Output**: 17 COCO keypoints, each with (y, x, confidence) — 51 values total
- **Architecture**: Modified MobileNet-v2 backbone with a feature pyramid, followed by a CenterNet-style keypoint prediction head
- **Inference time**: ~6 ms on Google Coral Edge TPU, ~12 ms on Raspberry Pi 5 CPU (XNNPACK), ~30 ms on Pixel 6 CPU
- **Model size**: ~7 MB (float32), ~2 MB (INT8 quantized TFLite)

The output coordinates are normalized to [0, 1] relative to the input image dimensions. Confidence scores range from 0 to 1, with scores below 0.2 indicating that the keypoint is likely not visible (occluded or out of frame).

### MoveNet Thunder

MoveNet Thunder is the accuracy-optimized variant:

- **Input**: 256x256 RGB image
- **Output**: Same 17 COCO keypoints
- **Inference time**: ~11 ms on Coral Edge TPU, ~30 ms on Raspberry Pi 5 CPU
- **Model size**: ~13 MB (float32), ~4 MB (INT8)

Thunder provides noticeably better keypoint localization, especially for the extremities (wrists, ankles) where precision matters for gesture and fitness applications.

### MoveNet Multipose

The multipose variant detects up to 6 people simultaneously:

- **Input**: Variable resolution (recommended 256x256)
- **Output**: Up to 6 sets of 17 keypoints + per-person bounding box + person confidence score
- **Inference time**: ~25 ms on Coral Edge TPU, ~70 ms on Raspberry Pi 5 CPU
- **Architecture**: Bottom-up approach — detects all keypoints in the image, then groups them by person using learned association

The multipose model is significantly heavier than the single-pose variants and introduces the grouping challenge: when keypoints from different people are spatially close (a crowd, people overlapping in the camera view), the grouping can assign keypoints to the wrong person.

### Cropping Pipeline for Tracking

For single-person tracking across frames, MoveNet uses a cropping pipeline:

1. On the first frame, the full image is processed (or a person detector provides the initial crop region).
2. The model's keypoint predictions define a bounding region around the detected person.
3. On subsequent frames, this region (expanded by a padding factor of 1.25x) is used as the crop for the next inference.
4. The crop region tracks the person as they move through the frame.

This cropping approach is critical for stable single-person tracking. Without it, the model processes the full frame and may "jump" to a different person if multiple people are present.

## BlazePose

BlazePose is MediaPipe's pose estimation pipeline, designed for mobile GPU deployment. It uses a two-stage architecture:

### Stage 1: Person Detector

A lightweight SSD-style detector identifies person bounding boxes in the full frame. This runs only on the first frame or when the tracker loses the person. On subsequent frames, the tracker predicts the person's position from the previous frame's landmarks.

### Stage 2: Landmark Model

The detected person crop is fed to the landmark model, which predicts 33 keypoints. The model uses an encoder-decoder architecture with attention mechanisms, producing both the keypoint coordinates and a segmentation mask of the person.

BlazePose achieves higher accuracy than MoveNet on the extended keypoint set (hands and feet) but is optimized for mobile GPU inference (via MediaPipe's GPU delegate) rather than CPU or NPU inference. On platforms without GPU acceleration, BlazePose may be slower than MoveNet despite similar model sizes.

### BlazePose Output

Each of the 33 keypoints includes:

- **(x, y)** — 2D image coordinates (normalized or pixel)
- **z** — Depth estimate relative to the hip midpoint (not absolute depth, but relative)
- **visibility** — Probability that the keypoint is visible (not occluded)
- **presence** — Probability that the keypoint exists within the frame

The z-coordinate enables approximate 3D pose reconstruction from a single camera — useful for fitness applications where the depth of arm extension or knee bend angle matters, though the absolute depth accuracy is limited.

## Skeleton Overlay Rendering

Visualizing the pose as a skeleton overlay involves drawing keypoints and their connections on the original image:

```python
# Skeleton connections for COCO 17-keypoint format
SKELETON = [
    (0, 1), (0, 2), (1, 3), (2, 4),           # Face
    (5, 6),                                      # Shoulders
    (5, 7), (7, 9),                              # Left arm
    (6, 8), (8, 10),                             # Right arm
    (5, 11), (6, 12),                            # Torso
    (11, 12),                                     # Hips
    (11, 13), (13, 15),                          # Left leg
    (12, 14), (14, 16),                          # Right leg
]

CONFIDENCE_THRESHOLD = 0.3

def draw_skeleton(image, keypoints, threshold=CONFIDENCE_THRESHOLD):
    h, w = image.shape[:2]

    # Draw connections first (behind keypoints)
    for (i, j) in SKELETON:
        if keypoints[i][2] > threshold and keypoints[j][2] > threshold:
            pt1 = (int(keypoints[i][1] * w), int(keypoints[i][0] * h))
            pt2 = (int(keypoints[j][1] * w), int(keypoints[j][0] * h))
            cv2.line(image, pt1, pt2, (0, 255, 0), 2)

    # Draw keypoints
    for kp in keypoints:
        if kp[2] > threshold:
            pt = (int(kp[1] * w), int(kp[0] * h))
            cv2.circle(image, pt, 4, (0, 0, 255), -1)
```

The confidence threshold controls which keypoints and connections are rendered. A threshold of 0.3 filters out most spurious keypoints while preserving partially occluded but still detectable joints. Setting the threshold too low (e.g., 0.1) produces jittery phantom keypoints; too high (e.g., 0.7) hides valid keypoints that are slightly uncertain.

## Multi-Person Pose Estimation

Two architectural approaches exist for multi-person scenarios:

### Top-Down

1. Run a person detector (e.g., SSD-MobileNet) to get bounding boxes for all people in the frame.
2. Crop each person and run the single-person pose model on each crop.
3. Map keypoint coordinates from crop space back to full image space.

Advantages: uses well-optimized single-person models, handles occlusion within each crop independently. Disadvantage: inference cost scales linearly with the number of people — 10 people means 10 pose model inferences per frame. At 15 ms per inference, 10 people takes 150 ms for pose alone, excluding detection time.

### Bottom-Up

1. Run a model that detects all keypoints from all people simultaneously.
2. Group keypoints into individual skeletons using part affinity fields (PAFs) or learned association embeddings.

Advantages: constant inference time regardless of the number of people. Disadvantage: grouping is error-prone when people overlap, and bottom-up models tend to be larger and slower than single-person models.

MoveNet Multipose uses a bottom-up approach. OpenPose (the original real-time multi-person pose system) also uses bottom-up with part affinity fields but is too heavy for most edge platforms (~25 GFLOPs).

## Applications

### Gesture Control Interfaces

Pose estimation enables touchless control of devices and interfaces. The typical pipeline:

1. Detect keypoints for one person (single-pose model).
2. Extract geometric features: joint angles (elbow angle, shoulder raise), relative positions (hand above shoulder), distances between keypoints.
3. Classify the gesture from these features using a lightweight classifier (decision tree, small fully connected network, or rule-based thresholds).

For example, a "wave" gesture can be detected by tracking the wrist keypoint's y-position over time and identifying oscillation above the shoulder. A "point right" gesture checks that the right wrist is extended beyond the right shoulder with the elbow approximately straight (angle > 150 degrees).

Rule-based gesture detection is more robust than training a gesture classifier when the gesture vocabulary is small (under 10 gestures) and gestures have clear geometric definitions.

### Fitness Form Analysis

Joint angles computed from keypoint positions enable automated exercise form feedback:

- **Squat depth**: Angle at the knee joint (hip-knee-ankle) below 90 degrees indicates full depth.
- **Deadlift back angle**: Angle between shoulders, hips, and vertical indicates spinal flexion.
- **Overhead press lockout**: Angle at the elbow exceeding 170 degrees confirms full extension.

The challenge is accuracy: a 5-degree error in the knee angle measurement can be the difference between "correct form" and "needs adjustment." MoveNet Lightning's keypoint localization accuracy (~6 pixels at 192x192 input) translates to approximately 3–5 degrees of angular uncertainty for typical camera distances (2–3 meters from the subject). MoveNet Thunder reduces this to 2–4 degrees at the cost of higher latency.

### Fall Detection

Fall detection uses pose keypoint trajectory analysis:

- Sudden decrease in the hip keypoint's y-coordinate (hip drops rapidly)
- Person's vertical extent (head-to-ankle distance) decreasing below a threshold
- Combined with loss of expected keypoint confidence (keypoints becoming occluded as the person falls)

A pose-based fall detector outperforms accelerometer-based systems for camera-monitored environments because it detects falls without requiring a wearable device. The failure mode is false positives from sitting down quickly or bending over — temporal analysis (rate of descent, final posture duration) reduces these.

### Sign Language Recognition

Pose estimation provides a skeleton-based representation of sign language gestures. The 33-keypoint BlazePose model (with hand keypoints) captures the hand shapes and arm positions needed to distinguish many signs. The sequence of poses over time encodes the dynamic component of signing.

A common architecture is pose estimation followed by a temporal model (LSTM, Transformer, or temporal convolutional network) that classifies sign sequences. This two-stage approach is more computationally feasible on edge devices than end-to-end video classification models.

## Tips

- MoveNet Lightning is the default choice for real-time single-person tracking on edge platforms. It has the best latency-to-accuracy ratio among publicly available pose models and runs efficiently on CPU (XNNPACK), Edge TPU, and NPU platforms.
- Use a confidence threshold of 0.3–0.5 to filter unreliable keypoints. Below 0.3, spurious keypoints appear at random positions. Above 0.5, partially visible but correctly localized keypoints are discarded.
- Enable the cropping pipeline for single-person tracking to maintain stable keypoint predictions across frames. Without cropping, the model processes the full frame and may switch between people in multi-person scenes.
- BlazePose is the appropriate choice when hand and foot keypoints are needed (fitness, sign language). For applications that only need the major body joints, MoveNet's 17-keypoint output is sufficient and simpler.
- Apply temporal smoothing (exponential moving average with alpha=0.5–0.7) to keypoint coordinates to reduce frame-to-frame jitter. This adds one frame of latency but produces visually smoother skeleton rendering and more stable angle measurements.
- For multi-person scenarios with fewer than 5 people, the top-down approach (detector + single-person pose per crop) often outperforms bottom-up models in accuracy and is easier to debug. The cost of N pose inferences is acceptable when N is small.
- When computing joint angles for fitness or gesture applications, use the confidence scores to weight the angle calculation. Low-confidence keypoints should contribute less to the angle estimate rather than being used at face value.

## Caveats

- **Pose estimation accuracy degrades sharply with partial occlusion.** When half the body is behind a table or another person, the model must hallucinate occluded keypoint positions. The confidence scores for occluded keypoints drop, but the predicted coordinates may be far from the actual joint position. Applications that depend on occluded keypoint positions (e.g., lower body pose during seated exercises) require models specifically trained on occluded poses.
- **Multi-person pose models are significantly heavier than single-person models.** MoveNet Multipose (~12 MB) is 6x the size of Lightning (~2 MB) and ~3x slower. For applications where multi-person support is needed only occasionally, switching between single-pose and multi-pose models at runtime based on a person count from the detector may be more efficient than always running the multipose model.
- **Heatmap-based outputs require large memory for high-resolution output.** A 33-keypoint heatmap at 128x128 resolution is 33 x 128 x 128 x 4 bytes = 2.2 MB. At 256x256, this quadruples to 8.7 MB. This constrains heatmap-based models to lower output resolutions on memory-limited platforms, which in turn limits localization precision.
- **Keypoint confidence does not indicate pose correctness.** A model may predict all keypoints with high confidence while placing them in anatomically impossible positions (e.g., an elbow bending the wrong way). Confidence reflects how certain the model is about its prediction, not whether the prediction is physically plausible. Post-processing constraints (bone length ratios, joint angle limits) can catch some of these errors but add complexity.
- **Camera viewpoint affects accuracy non-uniformly.** Frontal views produce the best results because most training data is front-facing. Side views, overhead views, and oblique angles degrade accuracy — particularly for self-occluding keypoints (e.g., the far-side shoulder and hip in a side view). Deployment cameras should be positioned at approximately the same angle as the training data for consistent results.

## In Practice

- **Keypoints that jitter between frames** — moving 5–15 pixels between consecutive frames even when the person is stationary — is the most common visual artifact in pose estimation deployment. The model makes independent predictions per frame with no temporal consistency constraint. Applying an exponential moving average (`position_t = alpha * prediction_t + (1 - alpha) * position_t-1` with alpha between 0.5 and 0.7) eliminates most visible jitter at the cost of 1–2 frames of latency in fast movements.
- **A skeleton that appears correct but is flipped left-right** — the left arm follows the person's right arm and vice versa — results from a keypoint index mismatch between the model's output convention and the rendering code. MoveNet uses the COCO convention where "left" is the person's left (viewer's right). If the rendering code assumes "left" is the viewer's left, the skeleton is mirrored. This is particularly visible when the person raises one arm.
- **Pose detection that works well for standing and walking poses but fails for sitting, lying down, or crouching** reveals training data bias. Most pose datasets are dominated by upright, fully visible people. Models trained primarily on such data produce low-confidence or anatomically incorrect predictions for non-standard poses. Fine-tuning on application-specific pose data (seated exercises, bed-bound patients) is typically necessary.
- **MoveNet tracking the wrong person in a multi-person scene** — the skeleton suddenly jumping from one person to another — occurs when the cropping region drifts from the tracked person to an adjacent person. This happens when two people are close together and the tracked person moves out of the crop while the other person moves in. Detecting this requires monitoring the person's bounding box for sudden jumps in position or size and re-initializing the tracker when a jump exceeds a threshold.
- **Joint angles that oscillate by 10–20 degrees despite the person holding a steady pose** amplify the keypoint jitter problem through the geometry of angle computation. Small absolute errors in keypoint position translate to large angular errors when the bone segments are short (e.g., wrist-elbow distance at a far camera distance). Temporal smoothing of the keypoint coordinates before computing angles, combined with a minimum bone length threshold below which angle computation is skipped, reduces the oscillation.
