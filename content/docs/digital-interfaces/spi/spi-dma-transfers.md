---
title: "DMA-Driven SPI Transfers"
weight: 30
---

# DMA-Driven SPI Transfers

Polled and interrupt-driven SPI transfers consume CPU cycles for every byte moved. For bulk operations — reading a 4 KB page from flash, streaming pixel data to a display, or capturing 1000 samples from an ADC — DMA (Direct Memory Access) offloads the byte-shuffling to dedicated hardware, freeing the CPU to run application code or sleep. On STM32F4, a DMA-driven SPI transfer at 10.5 MHz can move 4096 bytes in approximately 3.1 ms with near-zero CPU involvement after the initial setup.

## DMA Stream Assignment on STM32F4

Each SPI peripheral maps to specific DMA streams and channels. The assignments are fixed in hardware and documented in the reference manual (RM0090 for STM32F407, Table 42). The critical mappings for SPI1:

| DMA    | Stream | Channel | Function |
|--------|--------|---------|----------|
| DMA2   | Stream 3 | Channel 3 | SPI1_TX |
| DMA2   | Stream 0 | Channel 3 | SPI1_RX |
| DMA2   | Stream 2 | Channel 3 | SPI1_RX (alternate) |

SPI2 and SPI3 use DMA1 streams. A common mistake is attempting to use a DMA1 stream for SPI1 — this silently fails because SPI1 is on the APB2 bus and only DMA2 can access APB2 peripherals.

## Configuring DMA for SPI TX and RX

A complete DMA SPI configuration requires setting up both the TX and RX DMA streams. The SPI peripheral connects to DMA through its data register (`SPI_DR`), and DMA transfers data between `SPI_DR` and memory buffers.

```c
/* DMA handle declarations — typically global or static */
DMA_HandleTypeDef hdma_spi1_tx;
DMA_HandleTypeDef hdma_spi1_rx;

void spi1_dma_init(void) {
    __HAL_RCC_DMA2_CLK_ENABLE();

    /* SPI1 TX: DMA2 Stream 3, Channel 3 */
    hdma_spi1_tx.Instance                 = DMA2_Stream3;
    hdma_spi1_tx.Init.Channel             = DMA_CHANNEL_3;
    hdma_spi1_tx.Init.Direction           = DMA_MEMORY_TO_PERIPH;
    hdma_spi1_tx.Init.PeriphInc           = DMA_PINC_DISABLE;
    hdma_spi1_tx.Init.MemInc              = DMA_MINC_ENABLE;
    hdma_spi1_tx.Init.PeriphDataAlignment = DMA_PDATAALIGN_BYTE;
    hdma_spi1_tx.Init.MemDataAlignment    = DMA_MDATAALIGN_BYTE;
    hdma_spi1_tx.Init.Mode                = DMA_NORMAL;
    hdma_spi1_tx.Init.Priority            = DMA_PRIORITY_MEDIUM;
    hdma_spi1_tx.Init.FIFOMode            = DMA_FIFOMODE_DISABLE;
    HAL_DMA_Init(&hdma_spi1_tx);
    __HAL_LINKDMA(&hspi1, hdmatx, hdma_spi1_tx);

    /* SPI1 RX: DMA2 Stream 0, Channel 3 */
    hdma_spi1_rx.Instance                 = DMA2_Stream0;
    hdma_spi1_rx.Init.Channel             = DMA_CHANNEL_3;
    hdma_spi1_rx.Init.Direction           = DMA_PERIPH_TO_MEMORY;
    hdma_spi1_rx.Init.PeriphInc           = DMA_PINC_DISABLE;
    hdma_spi1_rx.Init.MemInc              = DMA_MINC_ENABLE;
    hdma_spi1_rx.Init.PeriphDataAlignment = DMA_PDATAALIGN_BYTE;
    hdma_spi1_rx.Init.MemDataAlignment    = DMA_MDATAALIGN_BYTE;
    hdma_spi1_rx.Init.Mode                = DMA_NORMAL;
    hdma_spi1_rx.Init.Priority            = DMA_PRIORITY_HIGH;
    hdma_spi1_rx.Init.FIFOMode            = DMA_FIFOMODE_DISABLE;
    HAL_DMA_Init(&hdma_spi1_rx);
    __HAL_LINKDMA(&hspi1, hdmarx, hdma_spi1_rx);

    /* Enable DMA interrupts */
    HAL_NVIC_SetPriority(DMA2_Stream3_IRQn, 5, 0);
    HAL_NVIC_EnableIRQ(DMA2_Stream3_IRQn);
    HAL_NVIC_SetPriority(DMA2_Stream0_IRQn, 5, 0);
    HAL_NVIC_EnableIRQ(DMA2_Stream0_IRQn);
}
```

Key configuration details: `PeriphInc` is disabled because every byte reads from or writes to the same `SPI_DR` register. `MemInc` is enabled so the DMA controller advances through the buffer. `FIFOMode` disabled (direct mode) is the safe default — FIFO mode can improve throughput in burst scenarios but adds complexity around threshold configuration and alignment requirements.

## The Dummy-Byte Problem

SPI is inherently full-duplex: the master must transmit a byte to receive a byte. When reading data from a device, the master needs to clock out bytes on MOSI to generate SCK edges that shift data in on MISO. The transmitted bytes are irrelevant to the slave — they are "dummy bytes," typically 0x00 or 0xFF.

In polled mode, `HAL_SPI_Receive()` handles this internally by transmitting dummy bytes. In DMA mode, the situation requires explicit attention. `HAL_SPI_TransmitReceive_DMA()` needs both a TX buffer and an RX buffer. For a receive-only operation, the TX buffer must contain dummy bytes:

```c
/* Reading 256 bytes from a flash chip after sending a read command */
static uint8_t dummy_tx[256];  /* Zero-initialized — serves as dummy bytes */
static uint8_t rx_buf[256];

void flash_read_dma(SPI_HandleTypeDef *hspi, uint32_t addr, uint16_t len) {
    uint8_t cmd[4] = {
        0x03,
        (addr >> 16) & 0xFF,
        (addr >> 8) & 0xFF,
        addr & 0xFF
    };

    flash_cs_assert();

    /* Send command bytes (polled — only 4 bytes) */
    HAL_SPI_Transmit(hspi, cmd, 4, HAL_MAX_DELAY);

    /* Read data via DMA — must transmit dummy bytes simultaneously */
    HAL_SPI_TransmitReceive_DMA(hspi, dummy_tx, rx_buf, len);
    /* CS deassertion happens in the DMA complete callback */
}
```

An alternative is `HAL_SPI_Receive_DMA()`, which configures only the RX DMA stream and relies on the SPI peripheral to generate clock edges without explicit TX DMA. On STM32F4, this works but has a subtle limitation: the SPI peripheral transmits whatever is in the TX buffer (often stale data from a previous transfer). For devices that ignore MOSI during read phases, this is harmless. For devices that interpret MOSI content during reads, `HAL_SPI_TransmitReceive_DMA()` with an explicit zero-filled TX buffer is the safe choice.

## Transmit-Only DMA

For write-only operations — pushing pixel data to an ILI9341 display, for example — only the TX DMA stream is needed. `HAL_SPI_Transmit_DMA()` configures the TX stream and discards incoming MISO data:

```c
/* Stream framebuffer data to a display */
void display_send_pixels_dma(SPI_HandleTypeDef *hspi,
                             const uint8_t *pixels, uint16_t len) {
    display_cs_assert();
    display_dc_data();  /* D/C pin high = data mode on ILI9341 */
    HAL_SPI_Transmit_DMA(hspi, (uint8_t *)pixels, len);
}
```

The RX FIFO still fills during a transmit-only DMA transfer. On STM32F4, the HAL handles draining the RX FIFO, but on bare-metal implementations, failing to read `SPI_DR` after a transmit-only transfer leaves the overrun flag (`OVR`) set, which can block subsequent receive operations.

## DMA Completion and CS Deassertion

The DMA transfer complete interrupt fires when the last byte has been moved from the DMA FIFO to `SPI_DR` — but this does not mean the last byte has finished shifting out on the bus. The SPI shift register may still be clocking out the final byte. Deasserting CS in the DMA complete callback without checking the BSY flag can truncate the last byte.

The correct pattern in the HAL callback:

```c
void HAL_SPI_TxRxCpltCallback(SPI_HandleTypeDef *hspi) {
    if (hspi->Instance == SPI1) {
        /* Wait for the SPI peripheral to finish the last byte */
        while (hspi->Instance->SR & SPI_SR_BSY)
            ;
        flash_cs_deassert();

        /* Signal application code that transfer is complete */
        transfer_complete_flag = 1;
    }
}

void HAL_SPI_TxCpltCallback(SPI_HandleTypeDef *hspi) {
    if (hspi->Instance == SPI1) {
        while (hspi->Instance->SR & SPI_SR_BSY)
            ;
        display_cs_deassert();
    }
}
```

The BSY flag poll in an interrupt context is safe because the SPI peripheral finishes the last byte within a few clock cycles — the loop executes at most once or twice. However, if the SPI clock is very slow (e.g., 100 kHz) relative to the CPU clock (168 MHz), the loop can spin for up to ~1680 CPU cycles for one SPI byte period, which may be unacceptable in a latency-sensitive ISR.

## DMA Buffer Placement and Cache Coherency

On Cortex-M7 devices (STM32H7), the data cache (D-cache) complicates DMA. DMA reads from and writes to physical memory, bypassing the cache. A TX buffer modified by the CPU may not have been flushed from cache to RAM when DMA reads it, producing stale data on the wire. An RX buffer filled by DMA may still show old data when the CPU reads from cached memory.

Two approaches:

1. **Place DMA buffers in non-cacheable memory** — The STM32H7 linker script typically defines a `RAM_D2` region (SRAM1/SRAM2 at 0x30000000) that can be configured as non-cacheable via the MPU. Buffers declared with `__attribute__((section(".sram2")))` bypass the cache entirely.

2. **Explicit cache maintenance** — Call `SCB_CleanDCache_by_Addr()` before a TX DMA transfer (flush CPU writes to RAM) and `SCB_InvalidateDCache_by_Addr()` after an RX DMA transfer completes (discard stale cache lines). Buffers must be aligned to 32-byte cache line boundaries.

```c
/* STM32H7: DMA buffer in non-cacheable SRAM2 */
__attribute__((section(".sram2")))
static uint8_t dma_rx_buf[4096];

__attribute__((section(".sram2")))
static uint8_t dma_tx_buf[4096];
```

On STM32F4 (Cortex-M4, no D-cache), this issue does not exist, and DMA buffers can reside anywhere in SRAM.

## Tips

- Use polled SPI for short transactions (command bytes, register reads under 8 bytes) and DMA for bulk transfers (flash page reads, display updates, ADC sample bursts) — the DMA setup overhead is not worth it for a few bytes.
- Keep a static zero-filled buffer for dummy TX bytes during receive-only DMA transfers — allocating dummy bytes on the stack risks them going out of scope if the function returns before DMA completes.
- Set the RX DMA stream priority higher than TX — the RX FIFO is smaller (or nonexistent on STM32F4 in direct mode), and RX overrun discards data irrecoverably, while TX underrun simply inserts a brief gap.
- On STM32H7, default to placing all DMA buffers in non-cacheable SRAM2 rather than using manual cache maintenance — explicit flush/invalidate calls are easy to forget and produce intermittent corruption that is extremely hard to diagnose.
- Enable the DMA transfer complete interrupt, not the SPI transfer complete interrupt — the DMA TC fires at the right time for buffer management, while the SPI TC may fire before DMA has finished writing to memory.

## Caveats

- **DMA complete does not mean SPI complete** — The DMA transfer complete interrupt fires when the last byte enters the SPI TX FIFO, not when it finishes clocking out. Deasserting CS in the DMA callback without checking BSY truncates the final byte.
- **`HAL_SPI_Receive_DMA()` transmits stale data on MOSI** — The SPI peripheral clocks out whatever was last in the TX data register. Devices that interpret MOSI during read phases may behave unpredictably. Use `HAL_SPI_TransmitReceive_DMA()` with an explicit dummy buffer for deterministic behavior.
- **DMA1 cannot access APB2 peripherals on STM32F4** — SPI1 sits on APB2 and requires DMA2. Configuring a DMA1 stream for SPI1 compiles without error and produces zero data movement at runtime with no fault or error flag.
- **STM32H7 D-cache causes silent DMA data corruption** — TX buffers not flushed to RAM before DMA start transmit stale data. RX buffers read from cache after DMA complete return previous values. This corruption is intermittent and data-pattern-dependent, making it exceptionally difficult to reproduce and diagnose.
- **The SPI overrun flag (OVR) blocks subsequent receives** — A transmit-only DMA transfer fills the RX FIFO unread, setting OVR. Clearing OVR requires reading `SPI_DR` then `SPI_SR` in that order. The HAL handles this internally, but bare-metal code must clear it explicitly before starting the next receive.

## In Practice

- A DMA SPI transfer that sends correct data for the first few bytes but transmits zeros or repeated values for the rest commonly indicates that `MemInc` is disabled on the TX DMA stream — the DMA controller reads the same memory address for every byte instead of advancing through the buffer.
- Flash reads that return correct data on the first call but corrupt data on subsequent calls, especially on STM32H7, typically trace to D-cache coherency — the first read populates the cache from fresh DMA data, but subsequent DMA transfers overwrite RAM without invalidating the cache, so the CPU reads stale cached values.
- An SPI bus that transfers data correctly at 1 MHz but produces bit errors at 21 MHz with DMA often has a FIFO overrun — the DMA controller cannot service the RX stream fast enough at high SPI clock rates, and the SPI peripheral discards bytes when the DR register is not read in time. Increasing DMA priority or enabling FIFO mode resolves this.
- A display that shows the first frame correctly via DMA but corrupts subsequent frames commonly has a CS timing issue in the DMA complete callback — CS is deasserted before the last byte finishes shifting out, and the display misinterprets the truncated final byte as a protocol error.
- An SPI DMA transfer that appears to hang (the callback never fires) often indicates that the DMA stream interrupt is not enabled in NVIC — the DMA transfer completes in hardware, but the CPU never receives the notification.
