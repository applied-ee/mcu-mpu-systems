---
title: "DMA-Driven UART with Idle Line Detection"
weight: 30
---

# DMA-Driven UART with Idle Line Detection

Interrupt-driven UART reception works, but at high baud rates the per-byte ISR overhead becomes significant. At 1 Mbaud, a byte arrives every 10 us — an ISR that takes 1 us to execute consumes 10% of the CPU. DMA eliminates this overhead entirely by transferring received bytes directly from the USART data register into memory with zero CPU involvement. The challenge is that DMA requires a fixed transfer length, but most UART protocols send variable-length packets. Combining DMA circular mode with the IDLE line interrupt solves this: DMA handles the byte-level transfers, and IDLE signals when a packet has ended, regardless of its length. This is the gold-standard pattern for production UART reception.

## Architecture Overview

The setup uses three components working together:

1. **DMA in circular mode** — continuously writes received bytes into a fixed-size buffer, wrapping around to the beginning when full
2. **IDLE line interrupt** — fires when the RX line goes idle after receiving data, indicating a packet boundary
3. **Half-Transfer (HT) and Transfer-Complete (TC) interrupts** — fire at the midpoint and end of the DMA buffer, enabling processing before data is overwritten

The DMA buffer acts as a circular window into the incoming byte stream. The firmware tracks how many bytes have arrived by reading the DMA NDTR (Number of Data To Transfer) register, which counts down from the buffer size with each received byte.

## Complete STM32F4 Implementation

### DMA and USART Initialization

```c
#define DMA_RX_BUF_SIZE 256

static uint8_t dma_rx_buf[DMA_RX_BUF_SIZE];
static volatile uint32_t last_dma_pos = 0;

void uart_dma_init(void) {
    /* Enable clocks */
    __HAL_RCC_USART2_CLK_ENABLE();
    __HAL_RCC_DMA1_CLK_ENABLE();

    /* Configure USART2: 115200, 8N1 */
    USART2->BRR = 0x16C9;  /* 42 MHz / 115200 */
    USART2->CR1 = USART_CR1_RE       /* Receiver enable */
                | USART_CR1_UE       /* USART enable */
                | USART_CR1_IDLEIE;  /* IDLE interrupt enable */
    USART2->CR3 = USART_CR3_DMAR;    /* DMA enable for reception */

    /* Configure DMA1 Stream 5 Channel 4 (USART2_RX on F4) */
    DMA1_Stream5->CR = 0;  /* Disable stream for configuration */
    while (DMA1_Stream5->CR & DMA_SxCR_EN);  /* Wait until disabled */

    DMA1_Stream5->PAR  = (uint32_t)&USART2->DR;
    DMA1_Stream5->M0AR = (uint32_t)dma_rx_buf;
    DMA1_Stream5->NDTR = DMA_RX_BUF_SIZE;
    DMA1_Stream5->CR   = DMA_SxCR_CHSEL_2       /* Channel 4 */
                        | DMA_SxCR_MINC          /* Memory increment */
                        | DMA_SxCR_CIRC          /* Circular mode */
                        | DMA_SxCR_TCIE          /* Transfer complete IRQ */
                        | DMA_SxCR_HTIE;         /* Half transfer IRQ */

    /* Clear any pending DMA flags */
    DMA1->HIFCR = DMA_HIFCR_CTCIF5 | DMA_HIFCR_CHTIF5;

    /* Enable DMA stream */
    DMA1_Stream5->CR |= DMA_SxCR_EN;

    /* Enable interrupts */
    NVIC_SetPriority(DMA1_Stream5_IRQn, 5);
    NVIC_EnableIRQ(DMA1_Stream5_IRQn);
    NVIC_SetPriority(USART2_IRQn, 5);
    NVIC_EnableIRQ(USART2_IRQn);

    last_dma_pos = 0;
}
```

### Calculating Received Bytes from NDTR

NDTR counts down from the buffer size. The current write position in the buffer is:

```c
static inline uint32_t dma_write_pos(void) {
    return DMA_RX_BUF_SIZE - DMA1_Stream5->NDTR;
}
```

The number of new bytes since the last check, accounting for circular wrap:

```c
static void process_rx_data(void) {
    uint32_t pos = dma_write_pos();

    if (pos == last_dma_pos) return;  /* No new data */

    if (pos > last_dma_pos) {
        /* Linear region — no wrap */
        handle_data(&dma_rx_buf[last_dma_pos], pos - last_dma_pos);
    } else {
        /* Wrapped — two segments */
        handle_data(&dma_rx_buf[last_dma_pos],
                    DMA_RX_BUF_SIZE - last_dma_pos);
        handle_data(&dma_rx_buf[0], pos);
    }

    last_dma_pos = pos;
}
```

### IDLE and DMA Interrupt Handlers

```c
void USART2_IRQHandler(void) {
    if (USART2->SR & USART_SR_IDLE) {
        /* Clear IDLE: read SR then DR */
        volatile uint32_t tmp = USART2->SR;
        tmp = USART2->DR;
        (void)tmp;

        /* Process all bytes received up to this point */
        process_rx_data();
    }
}

void DMA1_Stream5_IRQHandler(void) {
    if (DMA1->HISR & DMA_HISR_HTIF5) {
        DMA1->HIFCR = DMA_HIFCR_CHTIF5;
        process_rx_data();  /* Process first half */
    }
    if (DMA1->HISR & DMA_HISR_TCIF5) {
        DMA1->HIFCR = DMA_HIFCR_CTCIF5;
        process_rx_data();  /* Process second half */
    }
}
```

## Why HT and TC Interrupts Matter

Without HT/TC interrupts, the only trigger to process data is the IDLE interrupt. If data arrives continuously without gaps (e.g., streaming sensor data), IDLE never fires. The DMA buffer fills, wraps around, and overwrites unprocessed data. HT and TC provide periodic processing points at the buffer midpoint and end, ensuring data is consumed before it wraps.

The pattern creates a double-buffer effect: while DMA writes to the second half, firmware processes the first half (triggered by HT), and vice versa (triggered by TC). The buffer must be sized so that the firmware can process half the buffer before DMA wraps past it.

## HAL-Based Implementation

For projects using the STM32 HAL, the equivalent setup uses `HAL_UARTEx_ReceiveToIdle_DMA()`, available on newer HAL versions (STM32CubeF4 1.26+, STM32CubeH7 1.10+):

```c
#define DMA_RX_BUF_SIZE 256
static uint8_t dma_rx_buf[DMA_RX_BUF_SIZE];

/* Start reception — called once at init */
HAL_UARTEx_ReceiveToIdle_DMA(&huart2, dma_rx_buf, DMA_RX_BUF_SIZE);

/* Disable HT interrupt if only IDLE + TC are needed */
__HAL_DMA_DISABLE_IT(huart2.hdmarx, DMA_IT_HT);

/* Callback fired on IDLE or DMA TC */
void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart,
                                 uint16_t Size) {
    if (huart == &huart2) {
        /* Size = number of bytes received in this event */
        handle_data(dma_rx_buf, Size);

        /* Re-arm reception */
        HAL_UARTEx_ReceiveToIdle_DMA(&huart2, dma_rx_buf,
                                      DMA_RX_BUF_SIZE);
    }
}
```

This HAL approach is simpler but has a caveat: calling `HAL_UARTEx_ReceiveToIdle_DMA()` again in the callback stops and restarts the DMA stream, creating a brief window where bytes can be lost. The register-level circular-mode approach avoids this gap entirely.

## ESP-IDF UART with Pattern Detection

ESP-IDF provides built-in UART DMA (via its UHCI peripheral) and an event-based reception model that serves a similar purpose:

```c
#define BUF_SIZE 1024

uart_config_t uart_config = {
    .baud_rate = 115200,
    .data_bits = UART_DATA_8_BITS,
    .parity    = UART_PARITY_DISABLE,
    .stop_bits = UART_STOP_BITS_1,
    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
};
uart_driver_install(UART_NUM_1, BUF_SIZE * 2, 0, 20, &uart_queue, 0);
uart_param_config(UART_NUM_1, &uart_config);

/* Event loop handles UART_DATA events (analogous to IDLE) */
uart_event_t event;
while (xQueueReceive(uart_queue, &event, portMAX_DELAY)) {
    if (event.type == UART_DATA) {
        int len = uart_read_bytes(UART_NUM_1, buf, event.size,
                                  pdMS_TO_TICKS(100));
        handle_data(buf, len);
    }
}
```

The ESP-IDF UART driver internally manages DMA and fires `UART_DATA` events when an idle timeout occurs, providing equivalent functionality to the STM32 DMA+IDLE pattern without manual DMA configuration.

## Buffer Sizing for DMA

DMA buffer sizing follows a different logic than ring buffer sizing for ISR-driven reception. The DMA buffer must be large enough that the firmware can process data from one half before DMA overwrites it. The worst case is:

```
half_buffer_time = (DMA_RX_BUF_SIZE / 2) / (baud_rate / 10)
```

This must exceed the maximum processing latency. At 115200 baud with a 256-byte buffer:

```
128 bytes / 11,520 bytes_per_sec = 11.1 ms
```

The firmware has 11.1 ms to process 128 bytes before DMA wraps past them — comfortable for most applications. At 1 Mbaud with the same buffer, the window shrinks to 1.28 ms, which may require a larger buffer or faster processing.

## Tips

- Use the register-level circular DMA approach for any UART running at 115200 baud or above in production — the zero-CPU-overhead reception and continuous operation without re-arming are worth the initial setup complexity
- Always enable both HT and TC interrupts alongside IDLE — relying on IDLE alone fails for continuous streams where the line never goes idle
- Size the DMA buffer so that half-buffer time exceeds the worst-case main-loop iteration by at least 2x — this provides margin for occasional processing spikes
- Place the DMA buffer in non-cached SRAM on STM32H7 (D2 SRAM, address 0x30000000) or use cache maintenance operations — the H7's D-cache causes DMA coherency issues that produce stale or corrupted data
- On RP2040, use the PIO-based UART with DMA for similar zero-overhead reception — the RP2040 hardware UART has only a 32-byte FIFO and no IDLE interrupt, making PIO+DMA the preferred high-throughput approach

## Caveats

- **NDTR is read-volatile on STM32** — The NDTR register updates asynchronously as DMA transfers occur. Reading it twice in the same function may yield different values. Capture it once into a local variable and use that for all calculations
- **STM32H7 D-cache invalidation is mandatory** — On Cortex-M7 parts, the DMA writes to physical memory while the CPU reads from cache. Without `SCB_InvalidateDCache_by_Addr()` before processing the buffer, the CPU sees stale data. This is the most common DMA bug on H7 and produces data that looks randomly corrupted
- **Re-arming HAL DMA reception has a gap** — The HAL `ReceiveToIdle_DMA` function stops the DMA stream before restarting it. At high baud rates, bytes arriving during this 2-5 us window are lost. The register-level circular approach has no such gap
- **DMA circular mode and IDLE race condition** — If a packet ends exactly at the DMA buffer boundary, both the TC interrupt and the IDLE interrupt fire. The processing function must be idempotent — calling it twice with no new data between calls should be harmless
- **Misaligned DMA buffer on Cortex-M7 can fault** — The DMA buffer must be aligned to the cache line size (32 bytes on STM32H7) for cache maintenance operations to work correctly. Using `__attribute__((aligned(32)))` prevents hard faults during invalidation

## In Practice

- UART data that arrives correctly most of the time but contains occasional corrupted bursts — where a block of bytes appears to be from an earlier transmission — almost always indicates a D-cache coherency issue on STM32H7. The DMA wrote new data to SRAM, but the CPU's cache still holds a stale copy. Adding `SCB_InvalidateDCache_by_Addr()` before processing the buffer resolves the corruption.

- A DMA+IDLE setup that works perfectly at 115200 but drops data at 921600 typically has a buffer sizing problem. At 921600, the half-buffer time is 8x shorter. If the main loop has a periodic stall (e.g., flash write, LCD update), DMA overwrites unprocessed data. Increasing the buffer size or reducing main-loop worst-case latency eliminates the drops.

- Reception that works for continuous streams but loses the last few bytes of each packet — where those bytes appear at the start of the next packet — suggests IDLE detection is not triggering or not being handled. Without IDLE, only HT and TC fire, and any partial buffer content between the last HT/TC and the end of the packet waits until the next HT/TC to be processed. Enabling and properly clearing the IDLE flag resolves this.

- On STM32H7, a DMA setup that hard-faults during `SCB_InvalidateDCache_by_Addr()` indicates the buffer is not cache-line aligned. The cache maintenance functions require 32-byte alignment; operating on a misaligned address corrupts adjacent memory or faults. Declaring the buffer with `__attribute__((aligned(32)))` and ensuring its size is a multiple of 32 bytes prevents this.
