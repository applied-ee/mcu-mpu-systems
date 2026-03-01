---
title: "Inference on ESP32"
weight: 20
---

# Inference on ESP32

The ESP32 family from Espressif offers a different trade-off from the Cortex-M ecosystem: built-in Wi-Fi and Bluetooth, dual-core processors, external PSRAM support, and a FreeRTOS-based runtime — all at a price point under $5. These features make the ESP32 a natural platform for ML inference applications that need to collect data, run a model, and transmit results over a wireless link without additional networking hardware. The cost is a less deterministic execution environment than bare-metal Cortex-M: FreeRTOS scheduling, Wi-Fi stack interrupts, and shared-bus memory access all introduce latency variability that must be managed through careful task partitioning.

## ESP32 Variants for ML

Not all ESP32 devices are equally capable for inference workloads. The variant selection has a larger impact on ML performance than on most other embedded applications, because vector instruction support and internal SRAM size directly determine what models can run and at what speed.

### ESP32 (Original)

- **CPU**: Dual Xtensa LX6 cores at 240 MHz.
- **SRAM**: 520 KB total (approximately 320 KB usable for application after FreeRTOS and Wi-Fi stack allocations).
- **External memory**: Up to 4 MB PSRAM via SPI.
- **Vector extensions**: None. All MAC operations use scalar instructions.
- **ML capability**: Basic keyword spotting and simple classifiers. Inference is 3–5x slower than the ESP32-S3 for equivalent models due to the absence of vector instructions.

The original ESP32 remains widely deployed and inexpensive, but it is not the right choice for new ML projects. The lack of vector instructions means every multiply-accumulate in a convolution layer takes multiple clock cycles, and CMSIS-NN-style SIMD optimizations are not available.

### ESP32-S3

- **CPU**: Dual Xtensa LX7 cores at 240 MHz.
- **SRAM**: 512 KB internal SRAM (approximately 328 KB usable after system allocations).
- **External memory**: Up to 8 MB PSRAM via OSPI (octal SPI) — significantly faster than the original ESP32's SPI PSRAM.
- **Vector extensions**: 128-bit SIMD instructions for multiply-accumulate operations on 8-bit and 16-bit data. This is the critical differentiator — these instructions allow ESP-NN to process sixteen int8 multiply-accumulates per vector instruction.
- **ML capability**: The best ESP32 variant for inference. Keyword spotting at 30 ms, person detection at 200 ms, anomaly detection at sub-millisecond.

The ESP32-S3 is the recommended starting point for any ESP32-based ML project. The vector extensions provide a 3–5x speedup over the original ESP32 on int8 quantized models, and the OSPI PSRAM interface reduces the memory bandwidth bottleneck when model weights are stored in external RAM.

### ESP32-C3 and ESP32-C6

- **CPU**: Single-core RISC-V at 160 MHz (C3) or 160 MHz (C6).
- **SRAM**: 400 KB (C3), 512 KB (C6).
- **External memory**: No PSRAM support on C3; limited on C6.
- **Vector extensions**: None.
- **ML capability**: Not practical for inference beyond trivial models (small fully-connected classifiers with under 5K parameters). The single-core RISC-V architecture lacks the multiply-accumulate throughput needed for convolution-based models, and running Wi-Fi on the same core leaves minimal CPU time for inference.

### Variant Comparison for ML

| Feature | ESP32 | ESP32-S3 | ESP32-C3 |
|---------|-------|----------|----------|
| Cores | 2x LX6 | 2x LX7 | 1x RISC-V |
| Clock | 240 MHz | 240 MHz | 160 MHz |
| Internal SRAM | 520 KB | 512 KB | 400 KB |
| PSRAM | 4 MB SPI | 8 MB OSPI | None |
| Vector SIMD | No | Yes (128-bit) | No |
| Wi-Fi | 802.11 b/g/n | 802.11 b/g/n | 802.11 b/g/n |
| BLE | 4.2 | 5.0 | 5.0 |
| ML suitability | Basic | Best | Not practical |

## ESP-NN: Optimized Neural Network Kernels

ESP-NN is Espressif's equivalent of Arm's CMSIS-NN — a library of hand-optimized assembly kernels for neural network operators, tuned for the Xtensa instruction set and (on the S3) the vector extensions. ESP-NN integrates with TensorFlow Lite Micro as an alternative kernel backend, replacing the reference C implementations with architecture-specific optimized code.

### Supported Operators

- **Convolution 2D** (`esp_nn_conv2d_s8`) — Standard 2D convolution for int8 data. Uses S3 vector instructions when available.
- **Depthwise convolution** (`esp_nn_depthwise_conv2d_s8`) — Critical for MobileNet-style architectures. The S3 vector path provides the largest speedup for this operator.
- **Fully connected** (`esp_nn_fully_connected_s8`) — Dense matrix-vector multiply with int8 quantization.
- **Average pooling** (`esp_nn_avg_pool_s8`) — Spatial averaging with int8 input/output.
- **Max pooling** (`esp_nn_max_pool_s8`) — Spatial max reduction.
- **ReLU** (`esp_nn_relu_s8`) — Activation function, elementwise clamp.
- **Add** (`esp_nn_add_s8`) — Elementwise addition for residual connections.

### Performance Impact

| Model | ESP32 (Reference) | ESP32 (ESP-NN) | ESP32-S3 (ESP-NN) |
|-------|--------------------|-----------------|--------------------|
| DS-CNN keyword spotting | 150 ms | 80 ms | 30 ms |
| MobileNetV1 0.25 (96x96) | 800 ms | 450 ms | 150 ms |
| Person detection (96x96) | 1200 ms | 650 ms | 200 ms |
| Anomaly detection (FC) | 5 ms | 2 ms | 0.8 ms |

The ESP-NN kernels on the original ESP32 provide a 1.5–2x improvement over reference kernels through better loop structure and Xtensa-specific instruction scheduling. On the ESP32-S3, the vector extension path adds another 2–3x on top of that, for a total of 4–6x improvement over reference kernels on the original ESP32.

## PSRAM Considerations

The availability of 4–8 MB of external PSRAM is one of the ESP32 family's distinguishing features compared to Cortex-M devices, where all RAM is typically internal. However, PSRAM is not equivalent to internal SRAM for inference workloads.

### Access Latency

- **Internal SRAM**: Single-cycle access at CPU clock speed (240 MHz). No bus contention.
- **SPI PSRAM (ESP32 original)**: Accessed via SPI bus at 80 MHz (quad SPI). Effective throughput is limited by the SPI clock and bus protocol overhead. Random access latency is 3–5x higher than internal SRAM.
- **OSPI PSRAM (ESP32-S3)**: Accessed via octal SPI at 80–120 MHz. Approximately 2x faster than quad SPI PSRAM, but still 2–3x slower than internal SRAM for random access patterns.

### PSRAM and the Flash Bus

A critical architectural detail: on all ESP32 variants, the PSRAM and the external SPI flash share the same SPI bus (or, on the S3, compete for bus bandwidth through a shared cache). This means:

- When firmware code executes from external flash (XIP — execute in place), flash reads compete with PSRAM reads for bus bandwidth.
- Inference workloads that access model weights in PSRAM while executing TFLM code from flash experience bus contention, reducing effective throughput.
- The cache (up to 32 KB on the S3) mitigates this for code that fits in cache, but large inference loops can thrash the cache.

### Memory Layout Strategy

The optimal memory placement strategy for ESP32 ML applications:

```
Internal SRAM (~320 KB usable):
├── Tensor arena:           ~200 KB  (activations — latency-critical)
├── FreeRTOS heap:          ~40 KB   (task stacks, queues)
├── Wi-Fi/BLE buffers:      ~40 KB   (allocated by ESP-IDF internally)
├── Application buffers:    ~20 KB   (sensor, UART, display)
└── Stack:                  ~8 KB

PSRAM (4–8 MB):
├── Model weights:          ~500 KB–2 MB  (read-only during inference, sequential access)
├── Audio/image buffers:    ~100 KB–1 MB  (input capture before preprocessing)
├── Display framebuffer:    ~100 KB       (if driving a display)
└── Application data:       remaining
```

The key principle: keep the tensor arena in internal SRAM. Placing the arena in PSRAM adds 3–5x latency on every activation read/write, which accumulates across every layer of the network. A model that runs in 200 ms with an internal SRAM arena may take 600–1000 ms with a PSRAM arena.

Model weights can tolerate PSRAM placement better because weight access is sequential (streaming through a convolution kernel) rather than random, and the cache can prefetch weight data effectively. However, internal flash placement (via `const` arrays compiled into the firmware) is still faster when the model fits.

## Dual-Core Partitioning

The ESP32 and ESP32-S3 have two CPU cores, and proper task-to-core assignment is essential for ML applications that also maintain wireless connectivity.

### Core Assignment Strategy

- **Core 0**: Wi-Fi and BLE protocol stacks. The ESP-IDF Wi-Fi driver and TCP/IP stack are pinned to Core 0 by default. These include interrupt handlers, timer callbacks, and background tasks that must run with low latency to maintain wireless connectivity.
- **Core 1**: Inference task. The ML inference loop should be pinned to Core 1 using `xTaskCreatePinnedToCore()`. This prevents Wi-Fi interrupts from preempting inference mid-computation.

```c
xTaskCreatePinnedToCore(
    inference_task,       // Task function
    "inference",          // Name
    8192,                 // Stack size (bytes)
    NULL,                 // Parameters
    5,                    // Priority (higher than default Wi-Fi tasks)
    &inference_handle,    // Task handle
    1                     // Core 1
);
```

### Priority Considerations

FreeRTOS priority inversion can cause unexpected behavior when inference and communication tasks interact:

- The Wi-Fi task on Core 0 runs at priority 23 (ESP-IDF default). Application tasks default to priority 5.
- If an inference task on Core 1 needs to send results via Wi-Fi (e.g., by writing to a shared queue), it may block waiting for the Wi-Fi task to consume the data. If the Wi-Fi task is blocked by a higher-priority system task, the inference task stalls.
- Using non-blocking queue writes (`xQueueSend` with zero timeout) and handling the queue-full case explicitly avoids this. The inference task drops or buffers results locally rather than blocking on the communication path.

### Interrupt Handling

Even with tasks pinned to separate cores, certain ESP-IDF interrupts can fire on either core. Timer interrupts, GPIO interrupts, and DMA completion interrupts may be routed to the core that is currently running the inference task. Configuring interrupt affinity (where supported) or minimizing interrupt-driven work during inference reduces jitter.

## ESP-DL: Higher-Level Framework

ESP-DL is Espressif's own deep learning framework, providing a higher-level API than raw TFLM. It includes:

- **Model loading**: Load quantized models from flash or PSRAM.
- **Layer-by-layer execution**: Execute individual layers with explicit control over buffer allocation.
- **Pre-built models**: Face detection (MTCNN-based), face recognition, human face landmark detection — available as pre-trained models optimized for ESP32-S3.
- **Image preprocessing**: Built-in resize, crop, and color space conversion operations optimized for the ESP32 DMA engine.

ESP-DL is useful for applications that align with its pre-built capabilities (primarily face detection and recognition). For custom models, TFLM with ESP-NN provides broader operator coverage and better compatibility with standard training pipelines.

## TFLM on ESP32

The standard deployment path for custom models on ESP32 uses the `esp-tflite-micro` component within the ESP-IDF build system.

### Setup

```bash
idf.py create-project my_ml_project
cd my_ml_project
idf.py add-dependency "espressif/esp-tflite-micro"
```

The component includes TFLM, ESP-NN (automatically selected based on the target chip), and the necessary build system integration. When the build target is `esp32s3`, ESP-NN S3 vector kernels are linked automatically. When the target is `esp32`, the non-vector ESP-NN kernels are used.

### Model Integration

The standard approach places the model as a binary blob in the firmware:

```c
extern const unsigned char model_tflite[];
extern const unsigned int model_tflite_len;

// In the component's CMakeLists.txt:
// target_add_binary_data(${COMPONENT_LIB} "model.tflite" BINARY)
```

ESP-IDF's `target_add_binary_data` embeds the file in flash and provides the symbols for access. The model is read directly from flash-mapped memory — no copy to RAM is needed.

### Inference Loop

```c
static const tflite::Model* model = tflite::GetModel(model_tflite);
static tflite::MicroMutableOpResolver<8> resolver;
resolver.AddConv2D();
resolver.AddDepthwiseConv2D();
resolver.AddFullyConnected();
resolver.AddSoftmax();
resolver.AddReshape();
resolver.AddMaxPool2D();
resolver.AddAveragePool2D();
resolver.AddQuantize();

alignas(16) static uint8_t tensor_arena[96 * 1024];
static tflite::MicroInterpreter interpreter(model, resolver, tensor_arena,
                                             sizeof(tensor_arena));
interpreter.AllocateTensors();

// Fill input tensor
TfLiteTensor* input = interpreter.input(0);
memcpy(input->data.int8, preprocessed_data, input->bytes);

// Run inference
interpreter.Invoke();

// Read output
TfLiteTensor* output = interpreter.output(0);
int8_t* results = output->data.int8;
```

### ESP-IDF Configuration

Several ESP-IDF `sdkconfig` options affect ML inference performance:

- `CONFIG_ESP32S3_DEFAULT_CPU_FREQ_240` — Set CPU to 240 MHz (default is sometimes 160 MHz).
- `CONFIG_SPIRAM_SPEED_80M` or `CONFIG_SPIRAM_SPEED_120M` — PSRAM clock speed. Higher is better for weight access from PSRAM.
- `CONFIG_SPIRAM_CACHE_WORKAROUND` — Required on original ESP32 for PSRAM stability, but adds overhead.
- `CONFIG_FREERTOS_UNICORE` — Disables Core 1 for FreeRTOS. Do **not** set this for dual-core ML deployments.

## Performance Benchmarks

Measured inference times on ESP32-S3 with ESP-NN enabled, 240 MHz, tensor arena in internal SRAM:

| Model | Parameters | Input | Inference Time |
|-------|-----------|-------|----------------|
| DS-CNN (keyword spotting) | 25K | 49x10 MFCC | 28 ms |
| MicroSpeech (TFLM example) | 18K | 49x40 spectrogram | 22 ms |
| MobileNetV1 0.25 (image) | 200K | 96x96x3 | 150 ms |
| Person detection | 300K | 96x96x1 | 200 ms |
| Anomaly detection (autoencoder) | 12K | 128 features | 0.6 ms |
| Gesture recognition (CNN) | 50K | 50x6 IMU window | 8 ms |

These times include only the inference call (`interpreter.Invoke()`), not preprocessing or postprocessing. Preprocessing (FFT for audio, resize for images) typically adds 5–50 ms depending on the operation and input size.

## Tips

- Use the ESP32-S3 for any serious ML workload. The 128-bit vector extensions make a 3–5x difference compared to the original ESP32 on int8 quantized models. The OSPI PSRAM interface is also significantly faster than the original ESP32's SPI PSRAM, reducing the latency penalty when model weights must reside in external memory.
- Pin the inference task to Core 1 and leave Core 0 for the Wi-Fi/BLE stack. This is the single most important configuration decision for inference latency stability. Without core pinning, FreeRTOS may schedule both the inference task and Wi-Fi callbacks on the same core, causing inference to be preempted mid-computation for tens of milliseconds.
- Keep the tensor arena in internal SRAM, even on devices with abundant PSRAM. The 3–5x latency penalty of PSRAM access accumulates across every layer of the network. A model that runs in 200 ms with an internal arena takes 600–1000 ms with a PSRAM arena. PSRAM is appropriate for model weights (sequential access, cacheable) and application buffers, but not for the arena.
- Use ESP-NN optimized kernels, not generic TFLM reference kernels. The `esp-tflite-micro` component selects ESP-NN automatically when building for ESP32 targets. If building TFLM manually, ensure the ESP-NN source is included and the build defines `ESP_NN` to enable the optimized dispatch path.
- Set the CPU frequency to 240 MHz in `sdkconfig` before benchmarking. The default on some ESP-IDF project templates is 160 MHz, which reduces inference speed by 33% compared to 240 MHz with no power savings during active computation.
- For audio ML applications, use ESP-IDF's I2S driver for microphone input with DMA. The DMA transfer runs independently of the CPU, filling the audio buffer while the inference task processes the previous window. This double-buffering pattern eliminates audio gaps during inference.

## Caveats

- **PSRAM bandwidth is shared with SPI flash.** On the original ESP32, PSRAM and flash share the same SPI bus. On the ESP32-S3, they use separate pins but share cache bandwidth. During inference, if the TFLM code executes from flash (XIP) while the tensor arena or weights are in PSRAM, bus contention reduces effective memory throughput. Placing performance-critical code in IRAM (`IRAM_ATTR`) mitigates this but consumes limited IRAM space.
- **Wi-Fi transmission causes inference latency spikes when both run on the same core.** The Wi-Fi stack on ESP-IDF uses high-priority interrupts and tasks that preempt application code. A Wi-Fi TX burst during inference can add 10–50 ms of latency. Core pinning (inference on Core 1, Wi-Fi on Core 0) eliminates this, but only if the inference task does not call any Wi-Fi API functions that block on Core 0 resources.
- **The original ESP32 without vector extensions is 3–5x slower than the S3 for the same model.** This performance gap is architectural and cannot be closed with software optimization. ESP-NN on the original ESP32 improves over reference kernels by 1.5–2x, but the S3's vector path adds another 2–3x. Prototyping on the original ESP32 and then discovering it cannot meet latency requirements wastes development time.
- **ESP-NN optimizations only cover common operators.** Custom TFLite operators, less-common activation functions, and operators with unusual configurations (e.g., dilated convolutions, transposed convolutions) fall back to the unoptimized TFLM reference implementation. The fallback is silent — there is no warning that a specific operator is using the slow path. Profiling per-operator latency (via TFLM's `MicroProfiler`) identifies these cases.
- **FreeRTOS task stack size for inference must account for TFLM's call depth.** The TFLM interpreter, operator dispatch, and ESP-NN kernels use significant stack space. A task stack of 4 KB may cause a stack overflow during inference for complex models. Starting with 8–16 KB of task stack and monitoring with `uxTaskGetStackHighWaterMark()` identifies the actual requirement.
- **ESP-IDF version and `esp-tflite-micro` component version must be compatible.** ESP-IDF major version updates (e.g., 4.x to 5.x) change API surfaces that `esp-tflite-micro` depends on. Using a component version built for ESP-IDF 4.4 on an ESP-IDF 5.1 project produces build errors or runtime crashes.

## In Practice

- **Inference latency spikes periodically.** The pattern is typically regular (every 100–200 ms) and correlates with Wi-Fi beacon intervals or keepalive transmissions. The Wi-Fi task preempts the inference task, even on a separate core, if the inference task calls any FreeRTOS synchronization primitive that the Wi-Fi task also uses. Pinning tasks to separate cores and using lock-free communication (e.g., `xQueueSend` with zero timeout, or atomic variables) between the inference and communication tasks eliminates the coupling.
- **Model runs on ESP32-S3 but not on the original ESP32.** The most common cause is SRAM overflow. The original ESP32 has nominally more total SRAM (520 KB vs 512 KB), but less usable SRAM after the Wi-Fi stack and FreeRTOS allocations. Additionally, the ESP-IDF memory allocator on the original ESP32 fragments SRAM across multiple non-contiguous banks, and the tensor arena requires a single contiguous allocation. Using `heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)` reveals the largest contiguous block available.
- **Keyword spotting works but Wi-Fi disconnects during inference.** Both tasks are on the same core, and inference (30–200 ms of continuous CPU usage) blocks the Wi-Fi stack from processing management frames within the timeout window. The access point disassociates the device. Pinning inference to Core 1 resolves this. Alternatively, yielding (`vTaskDelay(1)`) within the inference loop at layer boundaries allows Wi-Fi frames to be processed, but this adds latency and is fragile — it depends on the model's layer structure.
- **Accuracy is worse on device than in the simulator.** ESP-NN kernels use slightly different rounding behavior than the TFLM reference kernels for quantized arithmetic. For most models, the difference is within 1 LSB per operation, which accumulates to less than 0.5% accuracy difference across the full model. However, models with many sequential layers and tight quantization ranges can accumulate enough error to shift classification boundaries. Running the TFLM reference kernels on the device (by disabling ESP-NN) confirms whether the accuracy difference originates in the kernels or in preprocessing.
- **PSRAM allocation fails despite sufficient free PSRAM.** ESP-IDF's heap allocator distinguishes between internal SRAM and PSRAM via capability flags. Using `malloc()` or `new` allocates from internal SRAM by default. Allocating from PSRAM requires `heap_caps_malloc(size, MALLOC_CAP_SPIRAM)`. If the tensor arena is allocated with a plain `malloc` and the internal SRAM is insufficient, the allocation fails even though megabytes of PSRAM are available. Explicitly using `heap_caps_malloc` with `MALLOC_CAP_INTERNAL` for the arena (to ensure it lands in fast SRAM) is both safer and self-documenting.
- **Model inference produces correct results but power consumption is higher than expected.** The ESP32-S3 at 240 MHz draws approximately 80–100 mA during active inference. If the inference duty cycle is low (e.g., one inference per second taking 30 ms), the device should enter light sleep between inferences. Failing to enter sleep keeps the CPU at 240 MHz continuously, consuming 30–50 mA even when idle. Using `esp_sleep_enable_timer_wakeup()` and `esp_light_sleep_start()` between inference windows reduces average current to 5–10 mA for duty-cycled workloads.
