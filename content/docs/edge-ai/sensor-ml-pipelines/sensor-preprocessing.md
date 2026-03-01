---
title: "Sensor Preprocessing for ML"
weight: 40
---

# Sensor Preprocessing for ML

Sensor preprocessing is the bridge between raw sensor hardware and the ML model input tensor. The sensor produces a continuous stream of ADC samples or digital readings at a fixed rate. The model expects a specific fixed-size, normalized tensor at each inference cycle. Between these two endpoints lies a pipeline of buffering, windowing, normalization, and format conversion — and any mismatch between the preprocessing applied during training (in Python on a desktop) and the preprocessing applied during deployment (in C on an MCU) silently degrades model accuracy without producing any error message.

This silent failure mode is the defining challenge of sensor preprocessing for ML. The model runs, produces outputs, and the outputs look plausible — but accuracy is 60% instead of 95% because the normalization mean is slightly different, or the window stride is off by one sample, or the ADC-to-float conversion uses a different scale factor. There is no runtime check that can detect a preprocessing mismatch. The only defense is rigorous verification: capture raw sensor data from the device, run it through both the Python training pipeline and the on-device C pipeline, and compare the resulting tensors value by value.

## Ring Buffer (Circular Buffer)

The ring buffer is the fundamental data structure for streaming sensor data on embedded systems. A fixed-size array with a write pointer and a read pointer, the ring buffer allows a producer (DMA controller or ISR) to write new sensor samples continuously while a consumer (the inference code) reads windows of data for processing.

The basic structure in C:

```c
#define RING_BUF_SIZE 512  // Must be power of 2 for efficient modular arithmetic

typedef struct {
    int16_t data[RING_BUF_SIZE];
    volatile uint32_t write_idx;  // volatile: modified by DMA/ISR
    uint32_t read_idx;            // read by main loop only
} ring_buffer_t;

static inline void ring_buf_write(ring_buffer_t *rb, int16_t sample) {
    rb->data[rb->write_idx & (RING_BUF_SIZE - 1)] = sample;
    rb->write_idx++;
}

static inline int16_t ring_buf_read(ring_buffer_t *rb, uint32_t offset) {
    return rb->data[(rb->read_idx + offset) & (RING_BUF_SIZE - 1)];
}
```

The `& (RING_BUF_SIZE - 1)` operation replaces the modulo operation when the buffer size is a power of 2. Modulo requires a division instruction; bitwise AND is a single cycle. For a buffer accessed on every sample at 25.6 kHz, this difference matters.

The `volatile` qualifier on `write_idx` is essential when the write pointer is updated by a DMA interrupt or ISR while the main loop reads it. Without `volatile`, the compiler may cache `write_idx` in a register and never re-read the actual memory location, causing the main loop to see a stale write pointer.

### Ring Buffer Sizing

The ring buffer must hold at least one full window plus one stride of new data. If the window length is 128 samples and the stride is 64 samples, the buffer must hold at least 192 samples. In practice, sizing the buffer to 2–3x the window size provides margin for jitter in the inference timing — if inference occasionally takes longer than expected, the extra buffer space prevents data loss.

For multi-channel sensors (e.g., 3-axis accelerometer), the ring buffer can be structured as interleaved samples:

```c
// Interleaved: [x0, y0, z0, x1, y1, z1, x2, y2, z2, ...]
#define NUM_CHANNELS 3
#define RING_BUF_SAMPLES 512  // samples per channel
#define RING_BUF_SIZE (RING_BUF_SAMPLES * NUM_CHANNELS)
int16_t ring_buf[RING_BUF_SIZE];
```

Or as separate per-channel buffers:

```c
// Per-channel: separate arrays
int16_t ring_buf_x[512];
int16_t ring_buf_y[512];
int16_t ring_buf_z[512];
```

The interleaved layout matches how most multi-axis sensors output data (all axes in a single SPI transaction) and simplifies DMA configuration. The per-channel layout simplifies feature extraction when operations are per-channel (e.g., FFT of each axis independently).

## Sliding Window Management

The sliding window mechanism extracts fixed-size windows from the ring buffer for inference. The window start position advances by the stride after each inference cycle.

```c
#define WINDOW_SIZE 128
#define STRIDE 64
#define NUM_CHANNELS 6

static uint32_t window_start = 0;

void process_next_window(ring_buffer_t *rb, int8_t *input_tensor) {
    // Check if enough new data is available
    uint32_t available = rb->write_idx - window_start;
    if (available < WINDOW_SIZE) return;  // Not enough data yet

    // Copy window from ring buffer to input tensor (with preprocessing)
    for (int t = 0; t < WINDOW_SIZE; t++) {
        for (int ch = 0; ch < NUM_CHANNELS; ch++) {
            uint32_t idx = (window_start + t) * NUM_CHANNELS + ch;
            int16_t raw = rb->data[idx & (RING_BUF_SIZE - 1)];
            input_tensor[t * NUM_CHANNELS + ch] = normalize_to_q7(raw, ch);
        }
    }

    // Advance window by stride
    window_start += STRIDE;

    // Run inference on input_tensor...
}
```

The overlap between consecutive windows is `WINDOW_SIZE - STRIDE`. With a window of 128 and a stride of 64, 64 samples overlap — those samples are already in the ring buffer from the previous window and do not need to be re-acquired. The overlap means the model sees each event in the data from multiple window positions, reducing sensitivity to window-event alignment.

A common optimization for feature-based pipelines: compute features incrementally. For a feature like RMS over the window, the overlapping portion's contribution can be cached and only the new stride's samples need to be processed. This reduces the per-window feature computation from O(window_size) to O(stride), which is significant at high overlap ratios.

## Fixed-Point Normalization

MCUs without a hardware floating-point unit (Cortex-M0, Cortex-M0+, Cortex-M3, Cortex-M23, Cortex-M33 without FPU option) pay a heavy performance penalty for float arithmetic — a single float multiply takes 10–30 cycles in software emulation versus 1 cycle on an FPU-equipped core. For preprocessing pipelines on these devices, fixed-point arithmetic is essential.

The standard normalization in ML training is:

```python
x_normalized = (x - mean) / std
```

For int8 (Q7) quantized models, the model input expects values in the range [-128, 127] representing the normalized real values. The combined normalization and quantization can be expressed as:

```
q7_value = clamp(round((raw_value - mean) * scale), -128, 127)
```

where `scale = 127.0 / (N_sigma * std)` for an input range of N_sigma standard deviations (typically 3–4 sigma). This scale factor and mean are computed from the training dataset and stored as constants in firmware.

For fixed-point computation, the scale is converted to a Q15 or Q21 fixed-point value, and the multiplication becomes an integer multiply with a right-shift:

```c
// Precomputed from training data
static const int16_t channel_mean[6] = { 102, -53, 16384, 12, -8, 3 };
static const int16_t channel_scale_q15[6] = { 2048, 1843, 512, 4096, 3891, 4505 };

static inline int8_t normalize_to_q7(int16_t raw, int channel) {
    int32_t centered = (int32_t)raw - channel_mean[channel];
    int32_t scaled = (centered * channel_scale_q15[channel]) >> 15;
    // Clamp to Q7 range
    if (scaled > 127) scaled = 127;
    if (scaled < -128) scaled = -128;
    return (int8_t)scaled;
}
```

This entire normalization — subtraction, multiplication, shift, and clamp — executes in 5–8 cycles on a Cortex-M0+. For a window of 128 samples × 6 channels = 768 values, the total normalization takes approximately 5,000 cycles — well under 1 ms at any practical clock speed.

### Normalization Parameter Storage

The normalization parameters (mean and scale per channel) must match exactly between training and deployment. Any discrepancy is a silent accuracy killer. The recommended practice:

1. Compute mean and standard deviation per channel across the entire training dataset in Python
2. Export these values to a C header file or a binary blob that is embedded in firmware
3. The model conversion tool (TFLite converter, ONNX exporter) should produce these values alongside the model file
4. At build time, verify that the normalization parameters in firmware match the values used during training (checksum comparison or automated test)

Storing normalization parameters inside the model file metadata (TFLite flatbuffer custom metadata field) keeps them synchronized with the model. When the model is updated, the normalization parameters update automatically.

## DMA-to-Inference Pipeline

Direct Memory Access (DMA) transfers sensor data from a peripheral (SPI, I2C, ADC) to the ring buffer without CPU intervention. This frees the CPU to perform inference while the DMA controller handles data acquisition in the background.

The standard pipeline architecture on an STM32 or similar Cortex-M MCU:

```
Sensor → SPI/ADC → DMA → Ring Buffer → [DMA Callback] → Window Ready Flag
                                                              ↓
Main Loop: Check Flag → Copy Window → Normalize → Run Inference → Process Result
```

Step by step:

1. **DMA configuration:** Set up DMA to transfer N samples from the SPI or ADC peripheral to the ring buffer in circular mode. The DMA controller automatically wraps around when it reaches the end of the buffer.
2. **DMA callbacks:** The DMA controller generates a half-transfer interrupt when half the buffer is filled, and a transfer-complete interrupt when the full buffer is filled. These callbacks set a flag indicating that new data is available.
3. **Main loop:** Checks the flag, copies the current window from the ring buffer, runs preprocessing and normalization, invokes the inference engine ([TFLite Micro]({{< relref "tflite-micro" >}}) or [ONNX Runtime]({{< relref "onnx-runtime" >}})), and processes the result (update display, send MQTT message, trigger alert).

STM32 HAL example for DMA from SPI-connected IMU:

```c
// Start DMA in circular mode
HAL_SPI_Receive_DMA(&hspi1, (uint8_t *)ring_buffer, RING_BUF_SIZE * sizeof(int16_t));

// Half-transfer callback
void HAL_SPI_RxHalfCpltCallback(SPI_HandleTypeDef *hspi) {
    window_ready_flag = 1;
}

// Transfer-complete callback
void HAL_SPI_RxCpltCallback(SPI_HandleTypeDef *hspi) {
    window_ready_flag = 1;
}

// Main loop
while (1) {
    if (window_ready_flag) {
        window_ready_flag = 0;
        copy_and_normalize_window(ring_buffer, input_tensor);
        tflite_invoke(interpreter);
        process_output(output_tensor);
    }
    // Low-power sleep until next interrupt
    __WFI();
}
```

The key advantage: the CPU sleeps (via `__WFI` — Wait For Interrupt) between inference cycles, reducing power consumption. The DMA controller continues filling the ring buffer during CPU sleep.

## Double-Buffering

Double-buffering eliminates the copy step by alternating between two buffers — one being filled by DMA while the other is being read by the inference code. This reduces latency (no copy overhead) and prevents the race condition where DMA overwrites data that inference is currently reading.

```c
int16_t buffer_A[WINDOW_SIZE * NUM_CHANNELS];
int16_t buffer_B[WINDOW_SIZE * NUM_CHANNELS];

volatile int active_buffer = 0;  // 0 = DMA filling A, inference reads B
                                  // 1 = DMA filling B, inference reads A

void HAL_SPI_RxCpltCallback(SPI_HandleTypeDef *hspi) {
    // Swap buffers
    if (active_buffer == 0) {
        HAL_SPI_Receive_DMA(&hspi1, (uint8_t *)buffer_B, WINDOW_SIZE * NUM_CHANNELS * 2);
        active_buffer = 1;
        // buffer_A is now safe to read
    } else {
        HAL_SPI_Receive_DMA(&hspi1, (uint8_t *)buffer_A, WINDOW_SIZE * NUM_CHANNELS * 2);
        active_buffer = 0;
        // buffer_B is now safe to read
    }
    inference_ready_flag = 1;
}
```

Double-buffering requires 2x the buffer memory but provides deterministic timing — the inference code always has a complete, stable window to process while the next window is being filled. For systems where inference time is less than or equal to the window acquisition time, double-buffering achieves continuous operation with zero data loss.

The trade-off: double-buffering does not support overlapping windows (each buffer contains a non-overlapping segment of data). For overlapping window architectures, the ring buffer approach with explicit copy is necessary.

## Cache Coherency on Cortex-M7

Cortex-M7 processors include data caches (typically 16–64 KB D-cache) that create a coherency problem with DMA transfers. The DMA controller writes sensor data directly to main memory (SRAM), bypassing the CPU cache. When the CPU reads the ring buffer, it may read stale data from its cache rather than the fresh data written by DMA.

This is the single most common source of preprocessing bugs on Cortex-M7 platforms (STM32F7, STM32H7, i.MX RT series). The symptoms are subtle: the data appears mostly correct, with occasional corrupted samples or periodic artifacts that resemble sensor noise but are actually stale cache lines.

Solutions, in order of preference:

**1. Place DMA buffers in non-cacheable memory:** The linker script can map the DMA buffer to a non-cacheable MPU region. On STM32H7, the D2 SRAM (0x30000000) is commonly configured as non-cacheable for DMA buffers:

```c
// In linker script: place in non-cacheable SRAM region
__attribute__((section(".dma_buffer")))
static int16_t ring_buffer[RING_BUF_SIZE];
```

This is the cleanest solution — no runtime cache maintenance needed. The trade-off is that CPU access to non-cacheable memory is slower (every read goes to SRAM at its native latency), but for the copy-once-per-window access pattern, this is acceptable.

**2. Invalidate cache before reading DMA buffer:** If the buffer is in cacheable memory, invalidate the relevant cache lines before reading:

```c
// After DMA transfer complete callback, before reading buffer
SCB_InvalidateDCache_by_Addr((uint32_t *)ring_buffer, RING_BUF_SIZE * sizeof(int16_t));
```

This forces the CPU to discard its cached copy and re-read from SRAM. The `SCB_InvalidateDCache_by_Addr` function in CMSIS operates on cache-line-aligned addresses. If the buffer is not cache-line-aligned (32 bytes on M7), the function may invalidate adjacent data. Aligning the buffer to 32 bytes avoids this:

```c
__attribute__((aligned(32)))
static int16_t ring_buffer[RING_BUF_SIZE];
```

**3. Disable D-cache entirely:** The brute-force solution. Eliminates all cache coherency issues but reduces CPU performance by 2–5x for compute-intensive operations (including inference). Not recommended for production but useful as a diagnostic step — if disabling the cache fixes the data corruption, the problem is confirmed as cache coherency.

## Timestamp Alignment for Multi-Sensor Fusion

When multiple sensors operate at different sampling rates, their data must be time-aligned before fusion into a single input tensor. A 3-axis accelerometer at 100 Hz and a barometric pressure sensor at 25 Hz produce samples at different times — simply concatenating the most recent readings from each sensor produces a tensor where the samples are not temporally aligned.

Alignment strategies:

- **Nearest-neighbor:** For each accelerometer sample, use the most recent pressure sample. Simple and sufficient when the slow sensor's rate is much lower than the dynamics of interest. Introduces up to half the slow sensor's sample period of temporal error (20 ms for a 25 Hz sensor).
- **Linear interpolation:** Interpolate the slow sensor's value at the fast sensor's sample times. Reduces temporal error to nearly zero for slowly varying signals (pressure, temperature) but introduces smoothing artifacts for rapidly varying signals.
- **Common time base:** Resample both sensors to a common rate using an anti-aliasing filter before downsampling and an interpolation filter before upsampling. This is the most rigorous approach but requires more compute and memory.

For MCU implementation, nearest-neighbor is the standard approach. The main loop reads both sensors' ring buffers and pairs samples by timestamp or by index (knowing the relative sampling rates). The resulting fused tensor is shaped `(window_length, total_channels)` where total_channels is the sum of all sensor channels.

## Data Type Conversion

Sensor hardware produces raw integer values that must be converted to the format expected by the model. The conversion chain:

```
ADC raw value (unsigned 12-bit: 0–4095)
    → Physical units (voltage, acceleration, temperature)
    → Normalized value (zero mean, unit variance)
    → Quantized model input (Q7: -128 to 127, or Q15: -32768 to 32767)
```

Each step introduces potential for mismatch:

**ADC to physical units:** The ADC output maps to voltage via `V = raw * V_ref / ADC_max`. For a 12-bit ADC with 3.3V reference: `V = raw * 3.3 / 4095`. The voltage maps to a physical quantity via the sensor's transfer function — for an analog accelerometer with sensitivity of 300 mV/g and zero-g offset of 1.65 V: `accel_g = (V - 1.65) / 0.300`.

**Physical units to normalized:** Apply the training-set normalization: `normalized = (accel_g - mean_g) / std_g`. The mean and standard deviation are from the training dataset, stored as firmware constants.

**Normalized to quantized:** Map the normalized value to the model's expected integer range. For TFLite int8 models, the input quantization parameters (scale and zero_point) are embedded in the model file and can be read at runtime via the TFLite Micro interpreter API.

The entire chain can be collapsed into a single affine transformation from raw ADC value to quantized model input:

```c
// Precomputed combined scale and offset
// q7_value = raw_adc * combined_scale + combined_offset
static const float combined_scale = (V_ref / ADC_max / sensor_sensitivity) / std * 127.0 / N_sigma;
static const float combined_offset = ((-sensor_offset / sensor_sensitivity) - mean) / std * 127.0 / N_sigma;
```

For fixed-point MCUs, this combined transformation is implemented as an integer multiply-accumulate with a shift, executing in 3–5 cycles per sample.

## Debouncing and Outlier Filtering

Raw sensor data may contain spike artifacts from electrical noise, sensor settling after power-on, or communication errors (SPI bit flips). These spikes can cause the ML model to produce incorrect outputs, especially if the spike falls within a sensitive portion of the input window.

**Median filter:** Replace each sample with the median of the surrounding N samples (typically N = 3 or 5). A 3-point median filter removes isolated spikes with minimal distortion to the underlying signal. The computational cost is negligible — 3 comparisons and 2 swaps per sample.

```c
static inline int16_t median3(int16_t a, int16_t b, int16_t c) {
    if (a > b) { int16_t t = a; a = b; b = t; }
    if (b > c) { int16_t t = b; b = c; c = t; }
    if (a > b) { int16_t t = a; a = b; b = t; }
    return b;
}
```

**Threshold-based outlier rejection:** If a sample deviates from the previous sample by more than a physically plausible amount (e.g., more than 10 g in a single sample period for an accelerometer at 100 Hz), replace it with the previous sample or a linear interpolation. This requires knowledge of the sensor's physical limits and the maximum expected rate of change.

**Exponential smoothing:** Apply a low-pass filter `y[n] = alpha * x[n] + (1-alpha) * y[n-1]` before windowing. This attenuates high-frequency noise including spike artifacts. The smoothing factor alpha (0.1–0.5) must match any smoothing applied during training data preprocessing.

The critical requirement: any filtering applied during deployment must also be applied during training data preprocessing, or vice versa. A median filter applied only at deployment changes the signal characteristics that the model was trained on, potentially degrading accuracy. A common approach is to apply the median filter to both the training data and the deployment pipeline, ensuring consistency.

## Tips

- Implement the ring buffer with a power-of-2 size. Modular arithmetic for index wrapping becomes a single bitwise AND operation (`idx & (size - 1)`) instead of a division-based modulo. At high sampling rates (25.6 kHz), this micro-optimization accumulates over millions of samples per second.
- Verify preprocessing correctness by capturing raw sensor data from the device (via UART, SWD debug, or SD card logging), running it through the Python training pipeline, and comparing the resulting tensor against the on-device preprocessed tensor. Value-by-value comparison should show differences of at most 1 quantization level (±1 in Q7). Larger differences indicate a preprocessing mismatch.
- Use the DMA half-transfer interrupt to overlap DMA fill with inference. While DMA fills the second half of the buffer, the CPU processes the first half. This pipelining doubles the available time for inference without increasing the buffer size.
- Store normalization parameters in the model metadata file rather than hardcoding them in the firmware source. This ensures that when the model is retrained (potentially with different training data statistics), the normalization parameters are updated automatically. A model loading function that reads both the model weights and the normalization parameters from the same file prevents version mismatch.
- On Cortex-M7 platforms, allocate DMA buffers in non-cacheable memory from the start. Debugging cache coherency issues after the fact is time-consuming and the symptoms (intermittent data corruption that appears as sensor noise) are difficult to distinguish from genuine sensor problems.
- For multi-sensor fusion, validate timestamp alignment by logging raw timestamped data from all sensors and verifying alignment in post-processing before deploying the fused pipeline on-device.

## Caveats

- Cache coherency on Cortex-M7 is the most common source of preprocessing bugs with DMA. The DMA controller writes new sensor data to main memory, but the CPU reads stale data from its cache. The result is intermittent data corruption — some windows are correct, others contain stale samples. The symptom looks like sensor noise or periodic artifacts, making it difficult to diagnose without explicitly checking for the cache coherency issue. Adding `SCB_InvalidateDCache_by_Addr` before reading the DMA buffer, or placing the buffer in non-cacheable memory, resolves the issue.
- Normalization parameter mismatch between training and deployment is nearly impossible to detect at runtime. The model receives incorrectly normalized input, produces outputs, and those outputs look like valid class labels or anomaly scores — just with degraded accuracy. There is no checksum, assertion, or runtime validation that catches this. The only defense is process discipline: automated export of normalization parameters alongside the model, and end-to-end verification with known test vectors.
- Ring buffer overflow occurs when inference takes longer than expected and the DMA write pointer laps the read pointer. The overwritten data is silently lost — the inference code reads a mix of current and stale data from the buffer, producing incorrect results for one or more windows. Sizing the buffer to 3x the window size provides margin, and monitoring the distance between write and read pointers at runtime enables overflow detection (log a warning if the gap exceeds 80% of the buffer size).
- Fixed-point arithmetic accumulates rounding errors differently than floating-point. The quantized preprocessing pipeline on the MCU may produce values that differ by 1–2 quantization levels from the floating-point pipeline used during training. For most models, this difference is negligible. For models with high sensitivity to input precision (e.g., anomaly detection autoencoders where a small input difference changes the reconstruction error significantly), the rounding error can measurably affect accuracy. Testing with known inputs quantifies the impact.
- Sensor data rate jitter from interrupt latency or bus contention causes non-uniform sample spacing. A sensor configured for 100 Hz may actually sample at 99.7–100.3 Hz depending on clock tolerance and interrupt timing. Over a 128-sample window, the effective window duration varies by up to ±0.4%. For most classification tasks this is insignificant, but for frequency-domain features (FFT), sample rate jitter causes spectral leakage that broadens frequency peaks and reduces feature precision.

## In Practice

- **Model accuracy is 95% on the desktop but 60% on the device with the same test data.** This is the canonical preprocessing mismatch. The raw sensor data is identical, but the on-device preprocessing produces a different input tensor than the Python pipeline. The diagnostic procedure: capture raw data from the device, run through Python preprocessing, capture the on-device preprocessed tensor (via debug probe or UART dump), and compare element by element. The mismatch is typically in the normalization (wrong mean/scale), the data type conversion (wrong ADC-to-physical-unit formula), or the window indexing (wrong stride or overlap).
- **Inference results are correct for the first window but wrong for subsequent windows.** The ring buffer read pointer is not advancing correctly after each inference. If the read pointer does not advance by exactly the stride, the overlap accounting is wrong — the second window may be shifted by too few or too many samples, changing the effective window content. Adding a debug log of the read pointer position at each inference cycle reveals the error.
- **Sensor data contains periodic spikes at regular intervals.** On Cortex-M7, this is almost always a DMA/cache coherency issue. The spikes occur at cache-line boundaries — every 32 bytes (16 samples of int16_t). Disabling the D-cache temporarily eliminates the spikes, confirming the diagnosis. The fix is to invalidate the cache before reading (`SCB_InvalidateDCache_by_Addr`) or to place the DMA buffer in a non-cacheable memory region.
- **Classification output oscillates between two classes on every other window.** The window stride is shorter than the event duration, and consecutive windows contain similar data that spans a class boundary. Two adjacent windows, shifted by a small stride, may capture the same transition event — one window has slightly more of class A, the next has slightly more of class B. Increasing the stride (reducing overlap) or adding temporal smoothing (majority vote over 3–5 consecutive outputs) stabilizes the result.
- **Inference runs correctly for hours, then produces garbage output.** Ring buffer overflow — the inference occasionally takes longer than expected (due to interrupt contention, garbage collection on an RTOS, or variable-length model execution paths), the DMA write pointer laps the read pointer, and the inference code reads a mix of current and old data. Monitoring the write-read gap and increasing the buffer size resolves the issue.
