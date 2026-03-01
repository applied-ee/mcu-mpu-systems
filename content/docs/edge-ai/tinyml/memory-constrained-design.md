---
title: "Designing for Memory Constraints"
weight: 40
---

# Designing for Memory Constraints

On microcontrollers, memory is the first constraint and the last. A model that achieves 95% accuracy on a desktop means nothing if it requires 200 KB of SRAM on a device with 128 KB. Unlike cloud or even mobile ML, where memory is abundant and dynamically allocated, MCU inference demands that every byte be accounted for at compile time. There is no virtual memory, no swap space, no fallback. The model weights must fit in flash, the tensor arena must fit in SRAM, and both must coexist with the firmware, peripheral drivers, communication stacks, and application logic. A design process that starts with the memory budget and works backward to the model architecture avoids the costly iteration of training a model that cannot deploy.

## Arena Anatomy

The tensor arena is a single, contiguous, statically allocated byte array in SRAM. Everything the inference runtime needs at runtime comes from this buffer — there is no secondary allocation, no heap, and no overflow region. Understanding what occupies the arena is essential for optimizing its size.

### Arena Contents

| Component | Description | Typical Size |
|-----------|-------------|-------------|
| **Input tensor buffer** | Raw input data in quantized format (e.g., 96x96x1 int8 image = 9,216 bytes) | Hundreds of bytes to tens of KB |
| **Output tensor buffer** | Model prediction (e.g., 10-class int8 softmax = 10 bytes) | Tens to hundreds of bytes |
| **Intermediate activation buffers** | The largest consumer — activations between layers. A 48x48x64 int8 activation map = 147,456 bytes | Tens to hundreds of KB |
| **Operator scratch buffers** | Temporary workspace for specific operators (im2col for convolution, accumulator buffers) | KB to tens of KB |
| **Quantization metadata** | Scale and zero-point arrays for each quantized tensor | Hundreds of bytes |
| **Tensor metadata** | TFLM's internal bookkeeping for tensor shapes, types, and allocation offsets | ~1 KB |

The input and output buffers are typically small. The intermediate activation buffers dominate. A single convolution layer with 64 output channels at 48x48 spatial resolution produces a 147 KB activation tensor — more than the total SRAM on many Cortex-M4 devices.

### What the Arena Does Not Contain

- **Model weights** — Weights remain in flash (read-only, accessed via pointer). A model with 500 KB of weights and 80 KB of peak activation data needs only ~80 KB of arena, not 580 KB.
- **Application stack** — The main stack and RTOS task stacks are separate SRAM allocations.
- **Peripheral buffers** — UART, SPI, I2C, and DMA buffers are allocated independently.

## Peak Memory: The Layer That Matters

Arena size is determined by **peak** memory usage, not average or total. The peak occurs at the layer whose execution requires the largest combined allocation of input activation, output activation, and scratch buffer — while also keeping alive any tensors that are needed by later layers (e.g., skip connections).

### Why Peak Is Non-Obvious

Consider a simple sequential CNN:

```
Layer 1: Conv2D 96x96x3 → 48x48x16    (output: 36,864 bytes)
Layer 2: Conv2D 48x48x16 → 24x24x32   (output: 18,432 bytes)
Layer 3: Conv2D 24x24x32 → 12x12x64   (output: 9,216 bytes)
Layer 4: Dense  9,216 → 128           (output: 128 bytes)
Layer 5: Dense  128 → 10              (output: 10 bytes)
```

At Layer 1, the arena must hold: input (96x96x3 = 27,648 bytes) + output (36,864 bytes) + scratch (~4 KB for im2col). Peak at Layer 1: ~69 KB.

At Layer 2: input (36,864 bytes) + output (18,432 bytes) + scratch (~2 KB). Peak at Layer 2: ~57 KB.

Layer 1 determines the peak, even though Layer 3 has more output channels. The spatial dimensions at Layer 1 dominate. This is why **reducing input resolution is the most effective way to reduce arena size** — it reduces the spatial dimensions at every subsequent layer.

Now consider a model with a skip connection:

```
Layer 1: Conv2D 48x48x16 → 48x48x16   (output: 36,864 bytes)
Layer 2: Conv2D 48x48x16 → 48x48x16   (output: 36,864 bytes)
Layer 3: Add(Layer1, Layer2)           (output: 36,864 bytes)
```

At Layer 2, the arena must hold: Layer 1's output (kept alive for the Add in Layer 3) + Layer 2's input (same as Layer 1's output, can be shared) + Layer 2's output. That is 36,864 + 36,864 = 73,728 bytes for activations alone — the skip connection doubles the activation memory at this point because Layer 1's tensor cannot be freed until Layer 3 consumes it.

### The Implication

A model with one wide layer can require more arena than a larger model with uniformly narrow layers. Model size (parameter count) is a poor predictor of arena size. The only reliable way to determine arena requirements is to measure them.

## Arena Sizing Workflow

The practical approach to determining the correct arena size:

### Step 1: Start Large

Allocate the maximum SRAM available as the arena. On an STM32F4 with 128 KB SRAM, this might be 100 KB (leaving 28 KB for stack, peripherals, and globals):

```cpp
alignas(16) uint8_t tensor_arena[100 * 1024];
```

### Step 2: Allocate and Run

Call `interpreter.AllocateTensors()` and then `interpreter.Invoke()` with a test input. Both must succeed. If `AllocateTensors()` fails, the model genuinely does not fit — the arena is too small for even the allocation plan.

### Step 3: Query Actual Usage

```cpp
size_t used = interpreter.arena_used_bytes();
Serial.print("Arena used: ");
Serial.println(used);
```

This reports the high-water mark — the maximum number of bytes the interpreter allocated within the arena across all operations during `AllocateTensors()` and `Invoke()`.

### Step 4: Shrink with Margin

Set the arena to the reported value plus 10–15% headroom:

```cpp
// If arena_used_bytes() reported 62,400:
constexpr int kTensorArenaSize = 72 * 1024;  // 62,400 + ~15% margin
alignas(16) uint8_t tensor_arena[kTensorArenaSize];
```

The margin accounts for:

- Alignment padding that varies with arena base address.
- TFLM version-to-version variation in allocation strategy (a TFLM update can shift usage by a few hundred bytes).
- Platform-specific alignment requirements (CMSIS-NN on Cortex-M requires 16-byte alignment; ESP-NN may have different requirements).

### Step 5: Verify

Rebuild and confirm that `AllocateTensors()` and `Invoke()` still succeed. Run multiple inference passes with different inputs to ensure no input-dependent allocation occurs (there should not be, but verification is free).

## Operator Subsetting with MicroMutableOpResolver

The TFLM interpreter uses an operator resolver to map operator codes in the model to implementation functions. Two resolvers are available:

### AllOpsResolver: The Prototyping Default

```cpp
tflite::AllOpsResolver resolver;
```

This registers every operator TFLM supports — approximately 80+ operators. All operator implementations are linked into the binary, regardless of whether the model uses them. The flash cost is 50–200 KB of additional code, which on a 256 KB device can consume over half the available flash.

### MicroMutableOpResolver: The Production Choice

```cpp
tflite::MicroMutableOpResolver<8> resolver;
resolver.AddConv2D();
resolver.AddDepthwiseConv2D();
resolver.AddFullyConnected();
resolver.AddSoftmax();
resolver.AddReshape();
resolver.AddMaxPool2D();
resolver.AddAveragePool2D();
resolver.AddQuantize();
```

Only the listed operators are compiled into the binary. The linker strips all unused operator implementations, recovering 50–150 KB of flash. The template parameter (`<8>`) specifies the maximum number of operators to register.

### Determining Required Operators

The model's operator list must be extracted from the `.tflite` file. A Python script or the `flatc` tool with the TFLite schema can enumerate all operators. Missing an operator causes `AllocateTensors()` to fail with a generic `kTfLiteError` — older TFLM versions do not report which operator is missing.

A practical approach: start with `AllOpsResolver`, confirm the model works, then switch to `MicroMutableOpResolver` and add operators one at a time until `AllocateTensors()` succeeds. The resulting list is the minimum operator set.

## Model Architecture for RAM Targets

The most effective optimization for memory-constrained deployment happens at the model architecture level, before training. Post-training techniques (quantization, pruning) help, but they cannot compensate for an architecture whose activation memory fundamentally exceeds the target's SRAM.

### Reduce Input Resolution

The single most impactful change. Input resolution propagates through every layer of the network, scaling activation memory quadratically (for 2D inputs):

| Input Resolution | Layer 1 Output (16 channels) | Reduction vs. 224x224 |
|------------------|------------------------------|----------------------|
| 224 x 224 | 802,816 bytes | — |
| 160 x 160 | 409,600 bytes | 49% |
| 96 x 96 | 147,456 bytes | 82% |
| 48 x 48 | 36,864 bytes | 95% |

Going from 224x224 to 96x96 reduces activation memory by approximately 5x. Going to 48x48 reduces it by approximately 20x. The accuracy cost depends on the task — keyword spotting with MFCC features (49x10 input) requires far less spatial resolution than fine-grained image classification.

### Use Depthwise Separable Convolutions

Standard convolutions produce large intermediate activation maps. A 3x3 standard convolution with 64 input and 64 output channels at 48x48 spatial size produces a 48x48x64 output (147 KB) and requires a 3x3x64x64 kernel (36,864 parameters).

A depthwise separable convolution splits this into:

1. **Depthwise**: 3x3 convolution per channel, producing 48x48x64 (147 KB output, 576 parameters).
2. **Pointwise**: 1x1 convolution across channels, producing 48x48x64 (147 KB output, 4,096 parameters).

The activation memory is similar, but the parameter count drops by 8x. More importantly, TFLM's tensor allocation planner can reuse the depthwise output buffer for the pointwise input (in-place operation), reducing peak activation memory compared to the standard convolution which must hold both input and output simultaneously.

### Prefer Narrow-Wide-Narrow Bottleneck Patterns

The inverted residual block (used in MobileNetV2) follows an expansion-depthwise-projection pattern:

```
Input: 24x24x16  (9,216 bytes)
  → Expand 1x1: 24x24x96  (55,296 bytes)   ← wide
  → Depthwise 3x3: 24x24x96  (55,296 bytes) ← wide
  → Project 1x1: 24x24x16  (9,216 bytes)     ← narrow
```

The peak activation within the block is 55,296 bytes (the expanded representation). The input and output are 9,216 bytes (the narrow representation). The narrow input/output means that the tensor kept alive for the skip connection (if present) is small, reducing cross-layer memory pressure.

### Avoid Skip Connections That Keep Large Tensors Alive

A skip connection from Layer A to Layer C means Layer A's output cannot be freed until Layer C executes. If Layer A's output is large and Layers A through C span many intermediate layers, the arena must hold Layer A's output plus all intermediate activations simultaneously.

Design strategies:

- Keep skip connections short (span 2–3 layers, not 10).
- Place skip connections at points where spatial dimensions are small (after pooling).
- Use narrow channels at skip connection points (the bottleneck pattern above).

### Pool Early

Adding a pooling or strided convolution layer early in the network reduces spatial dimensions before the expensive middle layers:

```
Input: 96x96x3
  → Conv2D stride 2: 48x48x16    (36 KB activation)
  → Conv2D stride 2: 24x24x32    (18 KB activation)
  → Conv2D: 24x24x32             (18 KB activation)
  ... remaining layers at 24x24 or smaller
```

Without the stride-2 layers:

```
Input: 96x96x3
  → Conv2D: 96x96x16             (147 KB activation)  ← exceeds many MCU SRAM budgets
  → Conv2D: 96x96x32             (294 KB activation)   ← far exceeds
```

Early pooling trades spatial resolution (and potentially accuracy) for dramatic activation memory reduction.

## Neural Architecture Search for MCUs

Manual architecture design guided by the principles above works for many projects. For applications that need to push the accuracy/memory trade-off to its limit, automated neural architecture search (NAS) methods specifically target MCU constraints.

### MCUNet

MCUNet (from MIT Han Lab) jointly optimizes the model architecture and the inference schedule for a specific target device's RAM and flash budget:

1. **TinyNAS**: Searches for a model architecture that maximizes accuracy while staying within the target's memory constraints. The search space includes input resolution, channel widths, kernel sizes, and number of blocks.
2. **TinyEngine**: A custom inference engine that optimizes the tensor allocation plan for the found architecture. TinyEngine uses in-place depthwise convolution and patch-based execution to reduce peak memory below what TFLM achieves for the same model.

MCUNet achieves state-of-the-art accuracy on ImageNet for given memory budgets. For example, on a 320 KB SRAM target, MCUNet achieves 70.7% top-1 ImageNet accuracy — higher than manually designed architectures under the same constraint.

### Practical Use

MCUNet and similar NAS methods produce model architectures and inference code for specific targets. The output is a trained model and a corresponding inference engine (C code). Integrating this into a product firmware requires adapting the generated code to the project's build system, peripheral drivers, and application logic. The approach is most valuable when the accuracy/memory trade-off is the critical design constraint and manual architecture iteration has stalled.

## Tensor Allocation Planning

TFLM's interpreter plans tensor allocation during `AllocateTensors()` by analyzing the model graph's tensor lifetimes. Understanding this planning process reveals why seemingly unrelated model changes can affect peak memory usage.

### Lifetime Analysis

The interpreter determines, for each tensor, the range of operators during which the tensor must be live (allocated in the arena). A tensor is live from the operator that produces it to the last operator that consumes it.

### Buffer Sharing

Tensors with non-overlapping lifetimes can share the same arena memory. For example, if Layer 3 produces tensor T3 and Layer 5 is the last consumer, T3's arena memory can be reused by tensors produced at Layer 6 or later. The allocation planner computes a memory map that minimizes peak usage by maximizing sharing.

### In-Place Operators

Some operators can write their output to the same buffer as their input, eliminating the need for a separate output allocation. ReLU is the canonical example — it modifies values in place. Pooling with certain configurations can also operate in place. TFLM detects these cases and assigns the same arena offset to the input and output tensor.

### Non-Obvious Interactions

Changing one layer's dimensions can alter the lifetime overlap of tensors elsewhere in the graph, changing which tensors can share memory and potentially increasing peak usage at a layer that was not modified. This is why arena sizing must be re-measured after any model architecture change, even changes that appear unrelated to the peak-memory layer.

## OTA Model Updates

Over-the-air model updates allow the ML model to be updated without reflashing the entire firmware. This is valuable for deployed devices where model improvements, retraining with new data, or fixing accuracy regressions must be delivered remotely.

### Architecture

The typical OTA model update architecture:

```
Flash memory map:
├── Firmware partition (Slot A):  Application code, TFLM runtime, drivers
├── Model partition (Active):     Currently running TFLite model
├── Model partition (Staging):    Downloaded new model (A/B scheme)
└── Metadata partition:           Model version, CRC, rollback flag
```

The firmware loads the model from the active model partition at boot. During an OTA update, the new model is downloaded to the staging partition. After download completes:

1. **Integrity check** — CRC32 or SHA-256 hash of the downloaded model is compared against the expected value provided by the update server.
2. **Version check** — The model version metadata is compared against the firmware's expected version range. A model version that the firmware does not know how to preprocess is rejected.
3. **Swap** — The active and staging partitions are swapped (or the boot pointer is updated to reference the new partition).
4. **Validation** — On the next inference, the firmware runs a known test input and compares the output against an expected reference. If validation fails, the firmware reverts to the previous model (rollback).

### Update Size and Time

Model file size determines update bandwidth and time:

| Model Size | BLE (100 KB/s) | Wi-Fi (1 MB/s) | LTE-M (50 KB/s) |
|------------|-----------------|-----------------|-------------------|
| 10 KB | 0.1 s | 0.01 s | 0.2 s |
| 100 KB | 1 s | 0.1 s | 2 s |
| 500 KB | 5 s | 0.5 s | 10 s |
| 2 MB | 20 s | 2 s | 40 s |

Power cost matters more than wall-clock time for battery-operated devices. A 500 KB model update over LTE-M at 50 KB/s keeps the radio active for 10 seconds, consuming approximately 50–100 mJ at typical LTE-M TX power. Over BLE at 100 KB/s, the same update takes 5 seconds but consumes only 5–10 mJ due to BLE's lower TX power.

### A/B Model Partitions

The A/B partition scheme provides safe rollback:

- **Partition A**: The known-good model currently in production.
- **Partition B**: The staging area for the new model.
- After successful validation of the new model, Partition B becomes the active model and Partition A becomes the staging area for the next update.
- If validation fails, the device continues using Partition A with no downtime.

This scheme requires twice the flash space for models but eliminates the risk of a bricked device due to a corrupt or incompatible model update.

### Partial Model Updates

Instead of replacing the entire model, delta-based updates transmit only the changed weights. This reduces update size for minor retraining passes (e.g., fine-tuning the last layer with new data). However, partial updates are complex:

- The update format must encode which weight tensors changed and their byte offsets within the FlatBuffer.
- The device must patch the model in place or reassemble it from the delta and the existing model.
- Any change to the model architecture (adding/removing layers, changing tensor shapes) requires a full model update.
- Partial updates are fragile — a byte-level error in the delta corrupts the model silently without changing its overall structure, making validation essential.

In practice, full model updates with A/B partitions are simpler, more robust, and sufficient for most update cadences (monthly or quarterly model refreshes).

## Scratch Buffer Optimization

Certain operators require temporary workspace beyond their input and output tensors:

- **Convolution (im2col)**: The im2col transform rearranges input data into columns for efficient matrix multiplication. The scratch buffer size is proportional to kernel size, input channels, and output spatial dimensions. A 3x3 convolution with 64 input channels at 24x24 output size needs 3x3x64x24 = 41,472 bytes of scratch.
- **Transposed convolution**: Needs both im2col and output accumulation buffers, often larger than standard convolution scratch.
- **Softmax**: Requires a temporary exponential accumulator buffer, typically small (output size x sizeof(int32)).

### Operator Fusion

Some optimizing compilers and inference engines (including STM32Cube.AI and the Edge Impulse EON Compiler) fuse consecutive operators to eliminate intermediate buffers:

- **Conv2D + ReLU fusion**: Instead of writing the convolution output, then reading it for ReLU, then writing the ReLU output, the fused operator applies the clamp within the convolution inner loop. This eliminates one full activation buffer write/read cycle.
- **Conv2D + BatchNorm fusion**: BatchNorm parameters are folded into the convolution weights during conversion, eliminating the BatchNorm operator and its scratch buffer entirely. This is a model conversion optimization, not a runtime optimization.
- **Depthwise + Pointwise fusion**: The depthwise and pointwise stages of a separable convolution can be fused to share a single output buffer, reducing peak memory when both stages would otherwise have separate output allocations.

## Tips

- Profile peak arena usage per layer, not just total. TFLM's `arena_used_bytes()` reports the overall high-water mark, but it does not indicate which layer caused the peak. STM32Cube.AI's memory analyzer provides per-layer breakdown. For TFLM, adding `MicroProfiler` logging around each operator invocation (or modifying the interpreter loop to report arena state per operator) reveals the bottleneck layer.
- Reduce input resolution before reducing model depth. Halving the input resolution from 96x96 to 48x48 cuts activation memory by 4x. Removing one convolutional layer saves one layer's activation buffer but does not affect the spatial dimensions of the remaining layers. Resolution reduction is a more efficient lever.
- Use `MicroMutableOpResolver` to save flash. The flash savings from excluding unused operators (50–150 KB) can be reallocated to a larger model or more firmware features. This is a low-effort optimization with no accuracy impact.
- Design the model architecture to the target memory first. Training a large model and attempting to shrink it via pruning and quantization rarely achieves the same accuracy/memory ratio as training a correctly-sized model from scratch. The architecture should be designed with the target's SRAM budget as a hard constraint, and training should proceed within those bounds.
- Use A/B flash partitions for OTA model updates. The additional flash cost (one extra model partition) is trivial compared to the risk of a bricked device from a failed single-partition update. The rollback mechanism ensures that a corrupt or incompatible model never becomes the active model.
- When targeting multiple MCU variants, profile arena usage on each target separately. CMSIS-NN and ESP-NN may use different scratch buffer sizes for the same operator, causing different arena requirements on different hardware even for the same model.

## Caveats

- **`arena_used_bytes()` returns the high-water mark, which may include unused gaps.** The TFLM allocation planner aligns tensors and may leave padding between allocations. The reported usage is the furthest byte offset written, not the sum of all tensor sizes. The actual memory utilization efficiency is typically 85–95%, meaning 5–15% of the reported arena usage is alignment padding or fragmentation within the planner's allocation map.
- **Changing one layer's dimensions can increase peak usage of a different layer.** This occurs because the tensor allocation planner recomputes all tensor lifetimes and sharing opportunities when the model changes. A layer that previously shared memory with a now-differently-sized tensor may need its own allocation, increasing peak usage at a point in the graph that was not modified. The interaction is non-obvious and can only be detected by re-measuring arena usage after any change.
- **MicroMutableOpResolver requires listing operators manually.** Missing a single operator causes `AllocateTensors()` to fail with a generic error. In older TFLM versions, the error message does not name the missing operator. The safest workflow is to start with `AllOpsResolver`, confirm correctness, then extract the operator list from the model file and build the resolver from that list.
- **OTA model updates require identical preprocessing parameters.** The firmware's preprocessing code (feature extraction, normalization, input quantization) must match the model's expected input format. If a new model version was trained with a different FFT window size, different normalization range, or different quantization scale, the firmware's preprocessing produces incompatible input data. The model update succeeds (the FlatBuffer is valid), inference runs (no runtime error), but accuracy drops because the model receives data in a format it was not trained on. Model version metadata should include preprocessing parameters, and the firmware should validate compatibility before activating the new model.
- **Pruning does not reduce arena size.** Weight pruning (setting weights to zero) reduces the number of non-zero parameters and can reduce flash size (with sparse storage) but does not change activation tensor shapes. The arena must still hold the same activation buffers regardless of how many weights are zero. Pruning is a flash optimization, not an SRAM optimization.
- **Int4 and sub-byte quantization reduce flash but not necessarily arena.** Activations are typically stored as int8 even when weights are int4, because the MAC hardware operates on int8 data. The arena holds activations, so int4 weight quantization reduces flash (weight storage) without reducing arena (activation storage).

## In Practice

- **Model fits in flash but crashes at runtime.** The model weights fit in flash, but the tensor arena requires more SRAM than available. This is the most common deployment failure. Flash capacity and SRAM capacity are independent constraints, and SRAM is almost always the binding one. Checking `arena_used_bytes()` against the available SRAM budget (total SRAM minus stack, peripherals, and globals) identifies the gap. If the gap is small (less than 10%), reducing the arena margin or freeing SRAM from other allocations may suffice. If the gap is large, the model architecture must be reduced.
- **Adding one layer causes a hard fault.** The new layer's activation tensor pushes peak arena usage over the allocated arena size. The hard fault occurs during `Invoke()`, not during `AllocateTensors()`, because the allocation plan succeeds (the planner computed that the tensors would fit) but the actual write exceeds the buffer. This discrepancy can occur when the planner's alignment assumptions differ from the runtime's actual alignment. Increasing the arena by the new layer's output tensor size plus scratch buffer (and re-measuring with `arena_used_bytes()`) resolves the fault.
- **OTA model update succeeds but accuracy drops.** The new model was trained with different preprocessing parameters than the firmware expects. Common mismatches include: different input normalization range (the model expects `[-1, 1]` but firmware provides `[0, 255]`), different FFT window size (the model was trained with 512-sample windows but firmware uses 256), or different quantization parameters (the model's input tensor has a different scale/zero-point than the firmware applies). Including preprocessing parameter metadata in the model file and validating at load time catches these mismatches before activation.
- **Inference works after flashing but fails after OTA.** The model partition boundaries in the flash memory map do not align with flash sector boundaries. The OTA write completes, but the last few bytes of the model are in a sector that was not fully written or was partially erased. The FlatBuffer parser reads corrupt data and either crashes or produces silent errors. Ensuring that model partitions start and end on flash sector boundaries (typically 4 KB or 64 KB aligned, depending on the flash chip) prevents this. A CRC check on the model data after OTA write, before activation, catches the corruption.
- **Arena size increases after updating TFLM version.** TFLM's allocation planner evolves between versions. A new version may change alignment requirements, scratch buffer sizes, or tensor sharing heuristics. These changes are typically small (1–5% of arena usage) but can push a tightly-sized arena over the limit. The 10–15% arena margin recommended during initial sizing absorbs these variations. If the margin was not included, re-measuring and adjusting the arena size after TFLM updates is necessary.
- **Model runs on STM32H7 (1 MB SRAM) but not on STM32F4 (128 KB SRAM).** The model was designed and tested on the larger device without considering the SRAM constraint of the target device. Redesigning the architecture for the smaller target — reducing input resolution, using fewer channels, pooling earlier — is typically more effective than attempting to compress the existing model. MCUNet-style NAS tools can automate this architecture search for the specific target's memory budget, producing models that exactly fit the constraint with maximum accuracy.
