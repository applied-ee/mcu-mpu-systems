---
title: "I2S DMA Buffer Management"
weight: 10
---

# I2S DMA Buffer Management

DMA is what makes continuous audio possible on a microcontroller. Without it, the CPU would need to service an interrupt for every sample — at 48 kHz stereo, that means 96,000 interrupts per second, leaving almost no time for actual audio processing. DMA transfers blocks of samples between the I2S peripheral and memory autonomously, and the CPU only needs to act when an entire buffer (or half-buffer) is ready. The engineering challenge is choosing the right buffer structure, size, and alignment to guarantee glitch-free audio while keeping latency within application requirements.

## Double Buffering

The fundamental pattern for continuous audio is the ping-pong (double) buffer. DMA fills one buffer while the application processes the other. When DMA completes a buffer, the roles swap: DMA moves to the next buffer and the application gets the just-filled one.

On STM32, the HAL provides this directly through circular DMA mode with half-transfer and transfer-complete interrupts:

```c
/* STM32 HAL — I2S DMA double-buffer receive */
#define SAMPLES_PER_BLOCK  256
#define STEREO_FRAME_SIZE  2    /* left + right */
#define BUFFER_SIZE        (SAMPLES_PER_BLOCK * STEREO_FRAME_SIZE * 2)  /* x2 for ping-pong */

static int16_t rx_buffer[BUFFER_SIZE];

void start_i2s_capture(void)
{
    HAL_I2S_Receive_DMA(&hi2s2, (uint16_t *)rx_buffer, BUFFER_SIZE);
}

/* Half-transfer complete — first half ready for processing */
void HAL_I2S_RxHalfCpltCallback(I2S_HandleTypeDef *hi2s)
{
    process_audio(rx_buffer, SAMPLES_PER_BLOCK);
}

/* Transfer complete — second half ready for processing */
void HAL_I2S_RxCpltCallback(I2S_HandleTypeDef *hi2s)
{
    process_audio(&rx_buffer[SAMPLES_PER_BLOCK * STEREO_FRAME_SIZE],
                  SAMPLES_PER_BLOCK);
}
```

On ESP32 with ESP-IDF, the I2S driver manages a ring buffer of DMA descriptors internally. The application reads or writes through `i2s_channel_read()` / `i2s_channel_write()`, which block until a DMA buffer is available:

```c
/* ESP-IDF v5.x — I2S standard mode read */
size_t bytes_read = 0;
int16_t samples[256];
esp_err_t ret = i2s_channel_read(rx_handle, samples, sizeof(samples),
                                  &bytes_read, portMAX_DELAY);
```

## Triple Buffering

Double buffering works when the processing time is always less than one buffer period. If processing occasionally overruns — due to an RTOS task being preempted, flash writes, or variable-length DSP operations — a third buffer absorbs the jitter. With triple buffering, DMA cycles through three buffers, and the application always processes the most recently completed one. If the application falls behind by one buffer period, DMA continues filling the next buffer without an underrun.

The cost is one additional buffer worth of RAM and one buffer period of added latency. For a 256-sample buffer at 48 kHz, that is 512 bytes (16-bit stereo) and 5.3 ms of latency — often an acceptable trade-off for glitch-free operation under RTOS scheduling jitter.

## Buffer Sizing

Buffer size directly trades latency against robustness:

| Buffer Size (samples) | Period at 48 kHz | Latency (double-buffer) | RAM (16-bit stereo) | Use Case |
|---|---|---|---|---|
| 64 | 1.33 ms | 2.67 ms | 512 B | Low-latency effects, audio monitoring |
| 128 | 2.67 ms | 5.33 ms | 1 KB | General-purpose audio processing |
| 256 | 5.33 ms | 10.67 ms | 2 KB | DSP chains, codec pipelines |
| 512 | 10.67 ms | 21.33 ms | 4 KB | Network streaming, file playback |
| 1024 | 21.33 ms | 42.67 ms | 8 KB | High-latency-tolerant applications |

The minimum practical buffer size depends on how quickly the processing callback can be serviced. On bare-metal Cortex-M4 at 168 MHz, 64-sample buffers are feasible for simple processing. Under FreeRTOS with multiple tasks, 128 or 256 samples provides a safer margin against scheduling delays.

ESP-IDF's I2S driver defaults to 6 DMA descriptors of 240 bytes each (configurable through `i2s_chan_config_t`). Reducing descriptor count or size below the processing latency causes `i2s_channel_read()` to return partial data or timeout errors.

## Memory Alignment

DMA controllers on Cortex-M require buffers aligned to their transfer width. For 16-bit I2S data, buffers must be half-word aligned (2-byte boundary). For 32-bit I2S frames (24-bit audio packed in 32-bit words), word alignment (4-byte boundary) is required. On most compilers, `int16_t[]` and `int32_t[]` arrays are naturally aligned, but dynamically allocated buffers from a heap or memory pool may not be.

```c
/* GCC — force 4-byte alignment for a DMA buffer */
static int32_t __attribute__((aligned(4))) dma_buffer[512];

/* Or use CMSIS-compatible alignment macro */
ALIGN_32BYTES(static int32_t dma_buffer[512]);
```

## Cache Coherency on Cortex-M7 and A-Class

Cortex-M7 devices (STM32H7, i.MX RT) have data caches (D-cache) that create coherency issues with DMA. When DMA writes audio data to a cached memory region, the CPU may read stale data from cache instead of the fresh DMA data. Conversely, when the CPU prepares a transmit buffer, DMA may read stale data from main memory if the cache has not been flushed.

Three approaches handle this:

**1. Place DMA buffers in non-cacheable memory.** STM32H7 provides SRAM regions (D2 SRAM on H743/H750, AXI SRAM on H723) that can be configured as non-cacheable through the MPU. This is the simplest approach and eliminates coherency concerns entirely at the cost of slower CPU access to those buffers.

```c
/* STM32H7 — place buffer in D2 SRAM (non-cacheable via MPU config) */
__attribute__((section(".d2_sram"))) static int16_t audio_buf[1024];
```

**2. Invalidate D-cache before reading DMA-filled buffers.** After DMA completes a transfer, invalidate the cache lines covering the buffer before the CPU reads the data. This keeps the buffer in cacheable memory (faster CPU processing) but requires explicit cache maintenance.

```c
void HAL_I2S_RxCpltCallback(I2S_HandleTypeDef *hi2s)
{
    SCB_InvalidateDCache_by_Addr((uint32_t *)rx_buffer, sizeof(rx_buffer));
    process_audio(rx_buffer, SAMPLES_PER_BLOCK);
}
```

**3. Clean D-cache before DMA reads transmit buffers.** Before starting a DMA transmit, flush (clean) the cache lines covering the buffer so that main memory contains the CPU's most recent writes.

```c
void start_playback(int16_t *tx_buffer, size_t size)
{
    SCB_CleanDCache_by_Addr((uint32_t *)tx_buffer, size);
    HAL_I2S_Transmit_DMA(&hi2s3, (uint16_t *)tx_buffer, size / sizeof(int16_t));
}
```

Cache maintenance functions operate on 32-byte cache lines. Buffers should be aligned to 32-byte boundaries and sized in multiples of 32 bytes to avoid accidentally invalidating adjacent data.

## Interrupt vs RTOS Task Processing

Audio processing can run directly in the DMA complete ISR or be deferred to an RTOS task via a semaphore or queue notification.

**ISR processing** offers the lowest latency — the processing begins immediately when the buffer is ready. This works well for simple operations (gain, mixing, copying) but has drawbacks: long ISR execution blocks other interrupts, and calling blocking APIs (mutex, queue send with timeout) from an ISR requires the `FromISR` variants on FreeRTOS.

**Task-based processing** uses the ISR only to signal a waiting task:

```c
/* ISR — signal the audio task */
void HAL_I2S_RxHalfCpltCallback(I2S_HandleTypeDef *hi2s)
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;
    vTaskNotifyGiveFromISR(audio_task_handle, &xHigherPriorityTaskWoken);
    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}

/* Audio task — runs at high priority */
void audio_task(void *param)
{
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        process_audio(current_buffer(), SAMPLES_PER_BLOCK);
    }
}
```

The task approach adds one context-switch worth of latency (typically 1–5 us on Cortex-M4) but allows the processing function to use blocking calls, longer computation, and lower interrupt-disable time. For any DSP chain beyond trivial operations, task-based processing is the standard pattern.

## Tips

- Size buffers in powers of two when FFT processing is downstream — avoids a copy into a separate FFT input buffer.
- On ESP32, set `dma_desc_num` and `dma_frame_num` in the I2S channel config to match the desired buffer structure rather than relying on defaults.
- Use `configASSERT()` or equivalent to verify buffer alignment at initialization rather than debugging silent DMA failures later.
- On STM32, enable the DMA transfer error interrupt (`HAL_DMA_RegisterCallback` with `HAL_DMA_XFER_ERROR_CB_ID`) — silent DMA errors appear as periodic clicks or silence.

## Caveats

- Double-buffer underruns on STM32 are silent by default — DMA wraps around and overwrites old data without any error flag. A missed processing deadline does not trigger a DMA error; it produces a glitch that only shows up in the audio output.
- On Cortex-M7, forgetting cache invalidation after DMA receive produces audio that sounds correct most of the time but contains intermittent artifacts — the cache occasionally holds stale data from a previous buffer cycle. This is one of the hardest audio bugs to reproduce.
- ESP-IDF's `i2s_channel_read()` with a short timeout can return partial buffers. Always check `bytes_read` against the expected size.
- Allocating DMA buffers on the stack (local variables in a function) causes immediate failure or corruption — DMA continues writing to deallocated stack memory after the function returns.

## In Practice

- **Periodic clicks at regular intervals** — often indicate a buffer underrun where the processing callback did not complete before the next DMA half-transfer. The click period matches the buffer period. Increasing buffer size or moving processing to a higher-priority task typically resolves it.
- **Audio that plays correctly for a few seconds then becomes garbled** — commonly appears on Cortex-M7 when D-cache invalidation is missing. The cache serves correct data initially (because it was cold), then returns stale entries once the cache lines are populated.
- **One channel silent, the other doubled** — a frequent symptom of buffer size miscalculation in stereo mode. If the buffer size is specified in bytes when the API expects sample counts (or vice versa), the DMA reads half the intended data and the stereo interleaving is misaligned.
- **Intermittent hard faults during audio playback** — often caused by DMA buffers placed in memory regions not accessible by the DMA controller. On STM32H7, the DMA1/DMA2 controllers cannot access DTCM RAM; buffers must reside in AXI SRAM, D1/D2/D3 SRAM, or external memory.
