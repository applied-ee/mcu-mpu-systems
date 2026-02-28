---
title: "Circular & Double-Buffer Modes"
weight: 30
---

# Circular & Double-Buffer Modes

Single-shot DMA transfers work for one-time operations like sending a command over SPI, but continuous data streams — ADC sampling, audio I/O, sensor logging — require the DMA controller to keep running indefinitely. Circular mode and double-buffer mode solve this by automatically reloading the transfer and providing mechanisms to process completed data without stopping the stream.

## Circular Mode

In circular mode, the DMA stream automatically reloads the transfer count (NDTR) and resets the memory pointer to the buffer base address when the current transfer completes. The stream never stops — it wraps around to the beginning of the buffer and continues filling.

On STM32F4, circular mode is enabled by setting `Init.Mode = DMA_CIRCULAR`:

```c
#define BUF_LEN 512
uint16_t adc_buf[BUF_LEN];

DMA_HandleTypeDef hdma_adc1;
hdma_adc1.Instance                 = DMA2_Stream0;
hdma_adc1.Init.Channel             = DMA_CHANNEL_0;
hdma_adc1.Init.Direction           = DMA_PERIPH_TO_MEMORY;
hdma_adc1.Init.PeriphInc           = DMA_PINC_DISABLE;
hdma_adc1.Init.MemInc              = DMA_MINC_ENABLE;
hdma_adc1.Init.PeriphDataAlignment = DMA_PDATAALIGN_HALFWORD;
hdma_adc1.Init.MemDataAlignment    = DMA_MDATAALIGN_HALFWORD;
hdma_adc1.Init.Mode                = DMA_CIRCULAR;
hdma_adc1.Init.Priority            = DMA_PRIORITY_HIGH;
hdma_adc1.Init.FIFOMode            = DMA_FIFOMODE_DISABLE;
HAL_DMA_Init(&hdma_adc1);
__HAL_LINKDMA(&hadc1, DMA_Handle, hdma_adc1);
```

Once `HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buf, BUF_LEN)` is called, the DMA fills `adc_buf[0]` through `adc_buf[511]`, then wraps back to `adc_buf[0]` and overwrites the oldest data. Without interrupts, old data is silently overwritten — the firmware must consume data faster than it arrives.

## Half-Transfer and Transfer-Complete Interrupts

Circular mode generates two key interrupts per cycle:

| Interrupt | Fires When | Buffer Region Ready |
|-----------|-----------|-------------------|
| Half-Transfer (HT) | NDTR reaches BUF_LEN / 2 | First half: `buf[0]` to `buf[BUF_LEN/2 - 1]` |
| Transfer-Complete (TC) | NDTR reaches 0 (wraps) | Second half: `buf[BUF_LEN/2]` to `buf[BUF_LEN - 1]` |

This creates a natural ping-pong pattern within a single buffer: while the DMA fills the second half, firmware processes the first half, and vice versa.

The STM32 HAL provides callbacks for both events:

```c
void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* First half of adc_buf is complete and stable.
       DMA is currently writing to second half.
       Safe to process adc_buf[0 .. BUF_LEN/2 - 1] */
    process_adc_data(&adc_buf[0], BUF_LEN / 2);
}

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Second half of adc_buf is complete and stable.
       DMA is currently writing to first half.
       Safe to process adc_buf[BUF_LEN/2 .. BUF_LEN - 1] */
    process_adc_data(&adc_buf[BUF_LEN / 2], BUF_LEN / 2);
}
```

The processing function must complete before the DMA wraps around and begins overwriting the region being read. For a 1 kHz ADC sampling 512 halfwords, each half represents 256 samples — giving 256 ms of processing time per callback at that rate. Higher sample rates shrink this window proportionally.

## Sizing the Circular Buffer

Buffer size is a tradeoff between latency and processing headroom:

| Buffer Size | Half-Buffer | Processing Window (at 10 kSps ADC) | Interrupt Rate |
|-------------|-------------|--------------------------------------|----------------|
| 64 samples  | 32 samples  | 3.2 ms | 312 Hz |
| 256 samples | 128 samples | 12.8 ms | 78 Hz |
| 1024 samples | 512 samples | 51.2 ms | 19.5 Hz |

Smaller buffers reduce latency (data is available sooner) but increase interrupt frequency and leave less time for processing. Larger buffers give more headroom but introduce pipeline delay. Audio applications typically use 256–1024 sample buffers; control loops that need fast response use 16–64 samples.

## Double-Buffer Mode

Double-buffer mode (available on STM32F4/F7/H7) uses two separate memory buffers with hardware-managed pointer switching. Instead of splitting one buffer into halves, the DMA controller alternates between two independent buffers on each transfer-complete event.

Configuration uses the HAL multi-buffer start function:

```c
#define AUDIO_BLOCK 256
int16_t audio_buf0[AUDIO_BLOCK];
int16_t audio_buf1[AUDIO_BLOCK];

/* Configure DMA for I2S RX (audio input) */
DMA_HandleTypeDef hdma_i2s_rx;
hdma_i2s_rx.Instance                 = DMA1_Stream3;
hdma_i2s_rx.Init.Channel             = DMA_CHANNEL_0;
hdma_i2s_rx.Init.Direction           = DMA_PERIPH_TO_MEMORY;
hdma_i2s_rx.Init.PeriphInc           = DMA_PINC_DISABLE;
hdma_i2s_rx.Init.MemInc              = DMA_MINC_ENABLE;
hdma_i2s_rx.Init.PeriphDataAlignment = DMA_PDATAALIGN_HALFWORD;
hdma_i2s_rx.Init.MemDataAlignment    = DMA_MDATAALIGN_HALFWORD;
hdma_i2s_rx.Init.Mode                = DMA_CIRCULAR;
hdma_i2s_rx.Init.Priority            = DMA_PRIORITY_VERY_HIGH;
hdma_i2s_rx.Init.FIFOMode            = DMA_FIFOMODE_DISABLE;
HAL_DMA_Init(&hdma_i2s_rx);

/* Start double-buffer DMA */
HAL_DMAEx_MultiBufferStart_IT(&hdma_i2s_rx,
    (uint32_t)&SPI2->DR,          /* peripheral address (I2S uses SPI) */
    (uint32_t)audio_buf0,         /* memory 0 */
    (uint32_t)audio_buf1,         /* memory 1 */
    AUDIO_BLOCK);
```

The DMA hardware manages the `M0AR` and `M1AR` registers (Memory 0 Address and Memory 1 Address). The `CT` (Current Target) bit in `DMA_SxCR` indicates which buffer the DMA is currently writing to. In the transfer-complete ISR, reading `CT` reveals the *active* buffer — the *other* buffer is safe to process:

```c
void DMA1_Stream3_IRQHandler(void)
{
    if (__HAL_DMA_GET_FLAG(&hdma_i2s_rx, DMA_FLAG_TCIF3_7)) {
        __HAL_DMA_CLEAR_FLAG(&hdma_i2s_rx, DMA_FLAG_TCIF3_7);

        /* Check which buffer DMA is currently targeting */
        if (hdma_i2s_rx.Instance->CR & DMA_SxCR_CT) {
            /* DMA writing to buf1 → buf0 is ready */
            process_audio(audio_buf0, AUDIO_BLOCK);
        } else {
            /* DMA writing to buf0 → buf1 is ready */
            process_audio(audio_buf1, AUDIO_BLOCK);
        }
    }
}
```

## Circular Mode vs Double-Buffer Mode

| Aspect | Circular + HT/TC | Double-Buffer |
|--------|------------------|---------------|
| Buffers | 1 (split in halves) | 2 (independent) |
| Hardware support | All STM32 with DMA | STM32F4/F7/H7 |
| Pointer management | Implicit (buffer offset math) | Hardware (CT bit) |
| Buffer alignment | Both halves share alignment of parent | Each buffer independently aligned |
| Flexibility | Fixed half-split | Buffers can be in different RAM regions |

Double-buffer mode is particularly useful on Cortex-M7 devices where one buffer can be placed in DTCM (for fast CPU access) while the other sits in AXI SRAM (for DMA access), though this requires careful attention to the bus architecture.

## RP2040 Continuous DMA with Channel Chaining

The RP2040 lacks a built-in double-buffer mode, but achieves the same result through DMA channel chaining. Two channels are configured to trigger each other on completion:

```c
int chan_a = dma_claim_unused_channel(true);
int chan_b = dma_claim_unused_channel(true);

dma_channel_config cfg_a = dma_channel_get_default_config(chan_a);
channel_config_set_transfer_data_size(&cfg_a, DMA_SIZE_16);
channel_config_set_read_increment(&cfg_a, false);
channel_config_set_write_increment(&cfg_a, true);
channel_config_set_dreq(&cfg_a, DREQ_ADC);
channel_config_set_chain_to(&cfg_a, chan_b);  /* Trigger chan_b on completion */

dma_channel_config cfg_b = dma_channel_get_default_config(chan_b);
channel_config_set_transfer_data_size(&cfg_b, DMA_SIZE_16);
channel_config_set_read_increment(&cfg_b, false);
channel_config_set_write_increment(&cfg_b, true);
channel_config_set_dreq(&cfg_b, DREQ_ADC);
channel_config_set_chain_to(&cfg_b, chan_a);  /* Trigger chan_a on completion */

dma_channel_configure(chan_a, &cfg_a, buf_a, &adc_hw->fifo, BUF_LEN, false);
dma_channel_configure(chan_b, &cfg_b, buf_b, &adc_hw->fifo, BUF_LEN, false);

/* Start channel A */
dma_channel_start(chan_a);
```

When channel A completes, it triggers channel B, and vice versa — creating an indefinite ping-pong pattern. An interrupt on each channel's completion signals when the corresponding buffer is ready for processing.

## Tips

- Use buffer sizes that are powers of two — this simplifies index wrapping arithmetic and aligns well with cache line boundaries on Cortex-M7 (32-byte cache lines).
- Always register both the half-transfer and transfer-complete callbacks when using circular mode — skipping the half-transfer callback wastes half the processing window and forces the firmware to wait for a full buffer cycle before accessing data.
- Keep processing time well under the half-buffer fill time — if processing takes 80% of the available window, any interrupt latency jitter causes occasional overruns that are difficult to reproduce.
- On RP2040, set up the transfer-complete interrupt on both chained channels to signal a semaphore or set a flag — avoid processing directly in the ISR to keep interrupt latency predictable.
- For audio applications at 48 kHz / 16-bit stereo, a 256-sample buffer gives 2.67 ms per half — sufficient for moderate DSP processing on a Cortex-M4 at 168 MHz but tight for complex filter chains.

## Caveats

- **Circular mode overwrites data silently if the firmware falls behind** — there is no overflow flag; the DMA simply wraps and starts overwriting the oldest samples, producing corrupted data blocks with no error indication.
- **The half-transfer interrupt fires at exactly NDTR = BUF_LEN/2, not at a configurable midpoint** — the split is always 50/50; applications needing asymmetric processing windows must use double-buffer mode or software ring buffers.
- **Double-buffer mode requires circular mode to also be enabled** — setting `DMA_CIRCULAR` in the mode field is mandatory; attempting double-buffer with normal mode silently falls back to single-buffer behavior.
- **Reading the CT bit and processing the buffer is not atomic** — on a heavily loaded system, an interrupt preempting the CT read can cause the firmware to process the wrong buffer if the DMA wraps between the CT read and the data access; keeping the processing ISR at high priority mitigates this.
- **The RP2040 chain-to mechanism has a one-cycle gap between channels** — for peripherals with very tight timing (e.g., high-speed PIO), a single sample may be lost during the handoff; the PIO FIFO depth (4–8 entries) typically absorbs this, but direct ADC capture at maximum rate (500 kSps) can drop one sample per buffer swap.

## In Practice

- An audio stream that plays cleanly for several seconds then develops periodic clicks or pops often shows up when the processing callback takes longer than the half-buffer window — the DMA overtakes the processing, and a few samples are read while being overwritten, producing brief glitches at regular intervals.
- ADC data that looks correct in the first half of the buffer but shows duplicated or stale values in the second half commonly appears when only the transfer-complete callback is implemented — the half-transfer interrupt is not handled, so the firmware processes both halves at the TC event, but the first half has already been partially overwritten by the next DMA cycle.
- A double-buffer DMA setup that works on STM32F4 but fails silently on STM32L4 often traces to the absence of hardware double-buffer support on that family — the `HAL_DMAEx_MultiBufferStart_IT()` function may not exist or may return an error, and the fallback behavior varies by HAL version.
- A continuous DMA stream that runs for exactly one buffer length then stops typically results from setting `DMA_NORMAL` instead of `DMA_CIRCULAR` — the stream completes one pass and disables itself, even though the peripheral continues generating DMA requests.
- On RP2040, a ping-pong DMA that works initially but stops after several thousand buffers sometimes traces to a missed interrupt acknowledgment — if the ISR does not clear the interrupt flag for one channel, the chain continues running but the notification is lost, causing the processing to desynchronize from the DMA position.
