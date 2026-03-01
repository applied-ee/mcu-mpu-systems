---
title: "Pruning & Knowledge Distillation"
weight: 20
---

# Pruning & Knowledge Distillation

Quantization reduces the precision of every weight in a model. Pruning and knowledge distillation take a different approach: they reduce the **number** of computations the model performs — pruning by removing redundant weights or structures, and distillation by training a smaller model to approximate a larger one. Both techniques require some form of retraining, which makes them more involved than post-training [quantization]({{< relref "quantization" >}}), but they address cases where quantization alone cannot meet the latency or size target.

The two techniques are complementary. Pruning shrinks an existing model; distillation trains a new smaller model that inherits the knowledge of a larger one. In practice, the strongest compression pipelines combine all three: distill a large teacher into a compact student, prune the student to remove remaining redundancy, then quantize the pruned student to int8 for deployment.

## Unstructured Pruning

Unstructured pruning sets individual weights to zero based on a criterion — typically magnitude. The reasoning is that weights close to zero contribute little to the output, so removing them should have minimal accuracy impact.

After pruning, the weight tensors contain a mix of zero and non-zero values (a **sparse** representation). With 80% sparsity, 80% of the weights are zero and only 20% carry information. If the sparse tensors are stored in a compressed sparse format (CSR, CSC, or similar), the model file shrinks proportionally.

```python
import torch.nn.utils.prune as prune

# Prune 60% of weights in a linear layer by L1 magnitude
prune.l1_unstructured(model.fc1, name='weight', amount=0.6)

# Check sparsity
sparsity = 100.0 * float(torch.sum(model.fc1.weight == 0)) / float(model.fc1.weight.nelement())
# sparsity ≈ 60.0%
```

The fundamental limitation of unstructured pruning is that the resulting sparse matrices still have the same shape as the originals. On hardware that performs dense matrix multiplication — which includes virtually all edge accelerators, CMSIS-NN kernels, Edge TPU, and standard GPU GEMM implementations — the zeros are multiplied just like any other value. The computation cost is unchanged. Speedup requires a **sparse execution runtime** (e.g., Arm Cortex-M55 with sparse MVE instructions, NVIDIA Ampere sparse tensor cores at 2:4 structured sparsity, or dedicated sparse inference engines), which are rare on edge hardware as of 2025.

## Structured Pruning

Structured pruning removes entire **structures** from the model — complete convolutional filters, entire channels, attention heads in transformers, or full layers. The result is a smaller dense model with fewer parameters and fewer operations, not a same-size sparse model.

Removing a convolutional filter with shape `[H, W, C_in]` from a layer with `C_out` filters reduces `C_out` by one. This propagates: the next layer's input channel count decreases by one as well. After pruning, the model has genuinely fewer multiply-accumulate operations.

```python
import torch.nn.utils.prune as prune

# Prune 40% of filters in a Conv2d by L2 norm (structured)
prune.ln_structured(model.conv1, name='weight', amount=0.4, n=2, dim=0)

# After making pruning permanent and rebuilding the model,
# the Conv2d has 40% fewer output filters
```

Because structured pruning produces a smaller dense model, it provides speedup on **all** hardware — no sparse runtime support is needed. The pruned model is a standard dense model that can be further optimized with quantization, exported to TFLite/ONNX/TensorRT, and executed on any edge device.

### Filter Importance Criteria

Deciding which filters to prune is a critical design choice:

- **L1/L2 norm**: Filters with the smallest weight norms are pruned first. Simple and effective for convolutional layers. The assumption is that small-norm filters produce small activations that contribute little to downstream layers.
- **Taylor expansion**: Estimates the effect of removing a filter on the loss function using first-order Taylor approximation. More accurate than norm-based criteria but requires a backward pass through the training data to compute gradients.
- **Activation-based**: Measures the average activation magnitude of each filter across a calibration dataset. Filters that consistently produce near-zero activations are pruned. This accounts for input-dependent behavior that weight norms alone miss.
- **Geometric median**: Identifies and prunes filters whose weights are closest to the geometric median of all filters in a layer, under the assumption that these are the most redundant (most similar to other filters).

## Sparsity Schedules

The schedule for increasing sparsity during training significantly affects the final accuracy of the pruned model.

### Gradual Pruning

Start with a dense model (0% sparsity) and increase sparsity incrementally over many training epochs until the target sparsity is reached. Between pruning steps, the remaining weights are fine-tuned to compensate for the removed weights.

The TensorFlow Model Optimization Toolkit implements this via `PolynomialDecay`:

```python
import tensorflow_model_optimization as tfmot

pruning_params = {
    'pruning_schedule': tfmot.sparsity.keras.PolynomialDecay(
        initial_sparsity=0.0,
        final_sparsity=0.75,
        begin_step=1000,
        end_step=10000,
        frequency=100  # Re-evaluate and prune every 100 steps
    )
}

pruned_model = tfmot.sparsity.keras.prune_low_magnitude(model, **pruning_params)
pruned_model.compile(optimizer='adam', loss='sparse_categorical_crossentropy', metrics=['accuracy'])

callbacks = [tfmot.sparsity.keras.UpdatePruningStep()]
pruned_model.fit(train_data, epochs=20, callbacks=callbacks)
```

Gradual pruning consistently outperforms one-shot pruning because the model has the opportunity to adapt its remaining weights at each pruning step. The polynomial decay schedule (which prunes aggressively early and more slowly near the target) tends to outperform linear schedules.

### Lottery Ticket Hypothesis

The lottery ticket hypothesis (Frankle & Carlin, 2019) posits that dense networks contain sparse subnetworks ("winning tickets") that, when trained in isolation from the same initial weights, can match the accuracy of the full model. The procedure:

1. Train the dense model to completion.
2. Prune to the target sparsity.
3. Rewind the surviving weights to their values at initialization (or at an early training epoch).
4. Retrain the sparse model from those initial weights.

This approach can produce sparse models that match or exceed the accuracy of gradual pruning, but it requires multiple full training cycles, making it computationally expensive. For edge deployment, lottery ticket pruning is typically used in research rather than production pipelines.

### One-Shot Pruning

Prune the fully trained model in a single step, then fine-tune the sparse model for a few epochs. This is the simplest schedule and works adequately for modest sparsity targets (30–50%). At high sparsity (>70%), one-shot pruning almost always underperforms gradual pruning because removing many weights simultaneously causes too large a perturbation for fine-tuning to recover.

## Knowledge Distillation

Knowledge distillation transfers the learned behavior of a large, accurate **teacher** model into a smaller **student** model. The student is trained not just on the ground-truth labels (hard labels) but also on the teacher's output distribution (soft labels). Soft labels carry more information than hard labels because they encode the teacher's learned similarities between classes — for example, the teacher might assign 80% probability to "cat" and 15% to "dog" for a cat image, and the 15% "dog" probability tells the student that cats and dogs share visual features.

### Temperature Scaling

The softmax output of the teacher is sharpened or softened using a **temperature** parameter `T`:

```
softmax_i = exp(z_i / T) / sum(exp(z_j / T))
```

At `T = 1` (standard softmax), the output is typically peaked at one class, providing little information about inter-class relationships. At `T = 3–5`, the distribution is smoother, making the relative probabilities more informative for the student. During training, the same temperature is applied to both teacher and student outputs when computing the distillation loss.

### Distillation Loss

The training loss for the student combines two components:

```
L = alpha * KL_div(softmax(z_student/T), softmax(z_teacher/T)) * T^2
  + (1 - alpha) * CE(y_true, softmax(z_student))
```

- **KL divergence on soft labels**: Measures how well the student matches the teacher's output distribution at temperature `T`. The `T^2` scaling compensates for the reduced gradient magnitude at higher temperatures.
- **Cross-entropy on hard labels**: Standard supervised loss on the ground-truth labels, ensuring the student does not drift too far from the correct answers.

The `alpha` parameter (typically 0.5–0.9) balances the two losses. Higher alpha gives more weight to the teacher's knowledge; lower alpha keeps the student closer to the ground truth.

```python
import torch
import torch.nn.functional as F

def distillation_loss(student_logits, teacher_logits, labels, T=4.0, alpha=0.7):
    soft_loss = F.kl_div(
        F.log_softmax(student_logits / T, dim=1),
        F.softmax(teacher_logits / T, dim=1),
        reduction='batchmean'
    ) * (T * T)

    hard_loss = F.cross_entropy(student_logits, labels)

    return alpha * soft_loss + (1 - alpha) * hard_loss
```

### Distillation for Edge Deployment

A common pattern for edge computer vision: train a large ResNet-50 or EfficientNet-B4 teacher on the full dataset, then distill into a MobileNetV2 or MobileNetV3-Small student. The distilled student typically achieves 2–5% higher accuracy than the same student architecture trained from scratch on hard labels alone, because the teacher's soft labels regularize training and transfer learned feature relationships.

For keyword spotting on microcontrollers, distilling from a large TC-ResNet teacher into a tiny DS-CNN student (25K parameters) can close the accuracy gap between the small architecture and the large one by 30–60% of the original difference.

### Feature-Level Distillation

Beyond output-level distillation, intermediate feature maps from the teacher can also guide the student. The student learns to match the teacher's internal representations at selected layers, not just the final output. This is particularly useful when the teacher and student architectures are very different (e.g., a transformer teacher and a CNN student), where output distributions alone may not transfer enough structural information.

Feature distillation requires adding projection layers in the student to match the teacher's feature dimensions and adds computational overhead during training.

## Combining Techniques: The Compression Pipeline

The standard compression pipeline for maximum model reduction:

1. **Distill** — Train a compact student architecture from a large teacher.
2. **Prune** — Apply structured pruning to the student (30–50% filter removal with gradual schedule).
3. **Quantize** — Apply int8 [quantization]({{< relref "quantization" >}}) (PTQ or QAT) to the pruned student.

Each step compounds: a MobileNetV2 student (3.4M params) distilled from ResNet-50 → structurally pruned by 40% (2.0M params) → quantized to int8 (2.0 MB model) achieves compression ratios of 50–100x compared to the original float32 ResNet-50 (25.6M params, 98 MB) while retaining 90–95% of the teacher's accuracy.

The order matters. Distillation should happen first because it defines the student architecture. Pruning should happen before quantization because quantization is sensitive to the weight distribution, and pruning changes it. Quantizing a model and then pruning it would require re-calibration of the quantization parameters.

## Tips

- Structured pruning is more practical for edge deployment than unstructured pruning because it always provides speedup on dense runtimes. Unstructured pruning is useful only when the target runtime supports sparse execution — currently limited to a small number of hardware platforms.
- Start with 50% structured sparsity and increase in increments of 10%. The accuracy-vs-sparsity curve is typically flat up to a point and then drops sharply — finding this knee requires iterative experiments.
- A distillation temperature of 3–5 works well for most classification tasks. Higher temperatures (8–10) can help for tasks with many similar classes (fine-grained classification) but may hurt on tasks with well-separated classes.
- Distill before pruning and quantize last. The distilled student has learned smooth weight distributions from the teacher, which makes it more amenable to both pruning and quantization.
- When pruning convolutional networks, skip the first and last layers. The first layer has few filters (typically 16–32) and removing any causes significant feature loss. The last layer directly determines the output and is rarely redundant.
- For distillation, the teacher does not need to be the same architecture family as the student. A Vision Transformer teacher can effectively distill into a CNN student, and vice versa.

## Caveats

- Unstructured pruning provides no inference speedup on most edge hardware. Dense matrix multiplication kernels (CMSIS-NN, Edge TPU, TFLite CPU) process every element regardless of whether it is zero. The model file can be compressed for storage, but runtime memory and compute are unchanged.
- High sparsity (>90%) causes sharp accuracy cliffs on most models. The relationship between sparsity and accuracy is not linear — a model that retains 95% accuracy at 80% sparsity may drop to 70% accuracy at 90% sparsity. The critical transition point varies by model and task.
- Knowledge distillation requires running the teacher model during training to generate soft labels for every batch. For large teachers (e.g., a 300M-parameter EfficientNet-B7), this doubles the GPU memory requirement and significantly increases training time. Pre-computing teacher outputs for the entire dataset and storing them on disk avoids the runtime cost but requires substantial storage.
- Both pruning and distillation require retraining — unlike [post-training quantization]({{< relref "quantization" >}}), which operates on a frozen model. This means access to the training data, the training pipeline, and sufficient compute resources. For models trained on proprietary or restricted datasets, retraining may not be feasible.
- Structured pruning changes the model architecture (fewer channels, fewer filters). This means the pruned model requires a new operator resolver configuration on TFLM, a new TensorRT engine build, and re-validation of all downstream integration code that assumes specific tensor shapes.
- Distillation effectiveness depends on the capacity gap between teacher and student. If the student is too small, it cannot absorb the teacher's knowledge regardless of temperature or training duration. If the student is nearly as large as the teacher, distillation provides little benefit over direct training.

## In Practice

- **Pruned model runs at the same speed as the original.** This almost always means unstructured pruning was applied and the runtime performs dense computation. The fix is to switch to structured pruning, which produces a genuinely smaller dense model, or to use a sparse execution runtime if one is available for the target hardware.
- **Distilled student accuracy plateaus well below the teacher.** The student model's capacity is too small to represent the teacher's learned function. Increasing student width (more channels/units) is more effective than increasing depth for closing the gap. Alternatively, reducing the temperature (e.g., from 5 to 3) can sharpen the soft targets and give the student a more focused learning signal.
- **Pruning causes accuracy collapse at 70% sparsity.** Critical filters are being removed. Switching from one-shot to gradual pruning with a longer schedule (more fine-tuning epochs between pruning steps) allows the model to adapt. Also, using Taylor-expansion-based importance scores instead of simple magnitude pruning avoids removing filters that have small weights but large gradient contributions.
- **Distillation loss decreases but hard-label accuracy does not improve.** The student is matching the teacher's output distribution but not learning the correct class boundaries. Increasing the weight on the hard-label cross-entropy term (lowering alpha from 0.9 to 0.5) forces the student to pay more attention to ground-truth labels.
- **Pruned and quantized model has lower accuracy than expected from each technique applied independently.** Pruning and quantization interact: pruning removes weights, changing the remaining weight distribution, which can make the model more sensitive to quantization error. Applying QAT after pruning — where the fake quantization nodes are inserted into the already-pruned model — typically recovers the lost accuracy because the model learns to compensate for both perturbations simultaneously.
- **Structured pruning removes channels but model size barely decreases.** This occurs when the pruned channels are in layers that contribute little to total parameter count (e.g., early layers with few channels). Profiling per-layer parameter counts before pruning identifies which layers have the most parameters — targeting those layers yields the largest size and compute reduction.
