---
title: "DMA Channel & Stream Architecture"
weight: 10
---

# DMA Channel & Stream Architecture

DMA controllers move data between peripherals and memory without CPU involvement, but the internal routing between a peripheral request and the DMA hardware that services it varies significantly across MCU families. Getting the mapping right is a prerequisite — configuring the wrong stream or channel produces no transfer and no error flag, just silence on the bus.

## STM32F4: Streams, Channels, and Fixed Mapping

The STM32F4 has two DMA controllers (DMA1 and DMA2), each with 8 streams (0–7). Each stream has a channel multiplexer that selects one of 8 channel inputs (0–7). The combination of controller, stream, and channel determines which peripheral request is serviced. These mappings are fixed in silicon and listed in the reference manual (RM0090, Table 42/43).

Some common mappings on STM32F407:

| Peripheral   | DMA Controller | Stream | Channel |
|-------------|----------------|--------|---------|
| SPI1_RX     | DMA2           | 0      | 3       |
| SPI1_TX     | DMA2           | 3      | 3       |
| USART2_RX   | DMA1           | 5      | 4       |
| ADC1        | DMA2           | 0      | 0       |
| I2C1_TX     | DMA1           | 6      | 1       |
| TIM2_CH1    | DMA1           | 5      | 3       |

A typical DMA handle configuration for SPI1 RX on STM32F4:

```c
DMA_HandleTypeDef hdma_spi1_rx;

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
```

The `__HAL_LINKDMA` macro connects the DMA handle to the peripheral handle so that `HAL_SPI_Receive_DMA()` knows which stream to start.

## Priority Arbitration

Each stream has a software-configurable priority level: Low, Medium, High, or Very High. When two streams request the bus simultaneously, the arbiter grants access to the higher-priority stream. If priorities match, the lower-numbered stream wins (stream 0 beats stream 7). This means stream numbering acts as a secondary priority — placing latency-sensitive peripherals on lower-numbered streams provides a deterministic tiebreak.

The priority field in `DMA_InitTypeDef`:

```c
hdma.Init.Priority = DMA_PRIORITY_VERY_HIGH;  /* 0x03 in CR register bits [17:16] */
```

## FIFO vs Direct Mode

Each STM32F4 DMA stream has a 4-word (16-byte) FIFO. In **direct mode** (`DMA_FIFOMODE_DISABLE`), each peripheral request triggers an immediate single transfer — the FIFO is bypassed. In **FIFO mode** (`DMA_FIFOMODE_ENABLE`), data accumulates in the FIFO and transfers to memory in bursts when a configurable threshold is reached:

```c
hdma.Init.FIFOMode      = DMA_FIFOMODE_ENABLE;
hdma.Init.FIFOThreshold = DMA_FIFO_THRESHOLD_HALFFULL;  /* 8 bytes */
hdma.Init.MemBurst      = DMA_MBURST_INC4;
hdma.Init.PeriphBurst   = DMA_PBURST_SINGLE;
```

FIFO mode enables data packing (e.g., collecting four byte-wide peripheral reads into a single word-wide memory write) and burst transfers that improve bus efficiency. Direct mode is simpler but requires source and destination data widths to match.

## Stream Conflicts

A stream can service only one channel at a time. If two peripherals are mapped to the same stream (e.g., ADC1 and SPI1_RX both map to DMA2_Stream0), only one can be active. The workaround is to use an alternate stream — many peripherals have two possible stream assignments. ADC1 can use DMA2_Stream0/Channel0 or DMA2_Stream4/Channel0. Checking the alternate mapping table in the reference manual resolves most conflicts.

When CubeMX reports a DMA conflict, it means two enabled peripherals need the same stream with no alternate available. Resolving this sometimes requires moving a peripheral to a different DMA controller or using interrupt-driven transfer for the lower-bandwidth peripheral.

## STM32G4/L4/U5: DMAMUX — Flexible Request Routing

The STM32G4, L4+, and U5 families replace the fixed stream/channel mapping with a DMAMUX (DMA Request Multiplexer). Any DMA request source can be routed to any DMA channel through the mux, eliminating stream conflicts entirely.

```c
DMA_HandleTypeDef hdma_adc1;

hdma_adc1.Instance                 = DMA1_Channel1;
hdma_adc1.Init.Request             = DMA_REQUEST_ADC1;  /* DMAMUX routes this */
hdma_adc1.Init.Direction           = DMA_PERIPH_TO_MEMORY;
hdma_adc1.Init.PeriphInc           = DMA_PINC_DISABLE;
hdma_adc1.Init.MemInc              = DMA_MINC_ENABLE;
hdma_adc1.Init.PeriphDataAlignment = DMA_PDATAALIGN_HALFWORD;
hdma_adc1.Init.MemDataAlignment    = DMA_MDATAALIGN_HALFWORD;
hdma_adc1.Init.Mode                = DMA_CIRCULAR;
hdma_adc1.Init.Priority            = DMA_PRIORITY_HIGH;

HAL_DMA_Init(&hdma_adc1);
__HAL_LINKDMA(&hadc1, DMA_Handle, hdma_adc1);
```

The key difference: `Init.Request` replaces `Init.Channel`. The DMAMUX handles the routing internally, and no fixed table lookup is needed. DMAMUX also supports synchronization and request generators for triggering DMA from timers or external events without CPU involvement.

## RP2040: 12 Channels, Full Flexibility

The RP2040 DMA subsystem has 12 independent channels with no fixed peripheral mapping. Each channel selects a DREQ (data request) signal to pace transfers. The DREQ table includes PIO state machines, SPI, UART, ADC, and others — a total of about 40 request sources.

```c
int dma_chan = dma_claim_unused_channel(true);
dma_channel_config cfg = dma_channel_get_default_config(dma_chan);

channel_config_set_transfer_data_size(&cfg, DMA_SIZE_8);
channel_config_set_read_increment(&cfg, false);
channel_config_set_write_increment(&cfg, true);
channel_config_set_dreq(&cfg, spi_get_dreq(spi0, false));  /* SPI0 RX DREQ */

dma_channel_configure(dma_chan, &cfg,
    rx_buffer,              /* write address */
    &spi_get_hw(spi0)->dr,  /* read address  */
    BUFFER_SIZE,            /* transfer count */
    true                    /* start immediately */
);
```

RP2040 DMA also supports channel chaining — one channel can trigger another on completion, enabling scatter-gather patterns without CPU intervention.

## ESP32: GDMA (General DMA)

The ESP32-S3 and ESP32-C3 use a GDMA controller with multiple channels (3–5 depending on the variant). Each channel has independent TX (memory-to-peripheral) and RX (peripheral-to-memory) paths. Peripheral assignment is flexible — any GDMA channel can service any supported peripheral.

In ESP-IDF, DMA is typically configured implicitly through the peripheral driver rather than as a standalone resource:

```c
spi_bus_config_t bus_cfg = {
    .mosi_io_num = GPIO_NUM_23,
    .miso_io_num = GPIO_NUM_19,
    .sclk_io_num = GPIO_NUM_18,
    .max_transfer_sz = 4096,
};
/* DMA channel allocated automatically */
spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO);
```

`SPI_DMA_CH_AUTO` lets the driver pick an available GDMA channel. On the original ESP32 (not S3/C3), DMA channels are limited to 2 and must be manually assigned, creating potential conflicts in complex designs.

## Tips

- Always verify stream/channel mappings against the reference manual for the specific part number — STM32F405 and STM32F407 share most mappings, but some peripheral variants differ.
- On STM32F4, prefer direct mode for simple byte-at-a-time peripherals (UART, I2C) and FIFO mode for high-throughput bulk transfers (SPI, ADC multi-channel scan).
- Assign DMA_PRIORITY_VERY_HIGH to the most latency-sensitive peripheral (typically audio or ADC continuous conversion) and leave others at Medium or Low — overusing Very High on every stream defeats the purpose of the arbiter.
- On DMAMUX-equipped parts (STM32G4, L4+, U5), there is no reason to consult a mapping table — any request routes to any channel, making peripheral selection independent of DMA channel assignment.
- On RP2040, call `dma_claim_unused_channel(true)` instead of hardcoding channel numbers — this prevents collisions when libraries or PIO programs also claim channels.

## Caveats

- **Selecting the wrong channel number on STM32F4 produces no error flag** — the DMA stream simply never receives a request, and the transfer count stays at its initial value indefinitely; checking NDTR after a timeout is the only way to detect this.
- **DMA1 on STM32F4 cannot access AHB peripherals** — only DMA2 can service ADC, SDIO, and DCMI; configuring DMA1 for these peripherals compiles without warning but transfers zero bytes.
- **Stream conflicts are not reported at runtime** — if two HAL drivers try to initialize the same stream, the second `HAL_DMA_Init()` overwrites the first without returning an error, silently breaking the first peripheral.
- **FIFO mode with mismatched data widths can trigger a FIFO error interrupt** — if the peripheral writes bytes but the FIFO threshold is set to full (16 bytes) and the transfer count is not a multiple of 16, a FIFO overrun occurs on the last transfer.
- **RP2040 DMA has no built-in priority arbiter** — all channels have equal priority with round-robin scheduling; latency-sensitive channels cannot preempt bulk transfers, which may cause audio underruns if many channels are active simultaneously.

## In Practice

- A peripheral that works in polling mode but produces no data with DMA often traces to a wrong channel selection — the transfer counter (NDTR/CNDTR) remaining at its initial value after a peripheral transaction confirms that no DMA requests reached the stream.
- An STM32F4 system where SPI works but ADC DMA does not, despite correct channel configuration, commonly appears when ADC DMA is accidentally assigned to DMA1 — the transfer appears to start (no init error) but completes with all zeros in the buffer.
- A FIFO error flag (FEIF) appearing intermittently in FIFO mode typically shows up when the total transfer size is not aligned to the FIFO threshold — switching to direct mode or adjusting the transfer count to a multiple of the threshold eliminates the flag.
- On RP2040, a DMA transfer that never completes despite correct DREQ assignment sometimes results from a channel number collision with a PIO library that claimed the same channel — `dma_channel_is_claimed()` can verify ownership at runtime.
- Two peripherals that work independently but fail when enabled simultaneously often point to a stream conflict — both peripherals were mapped to the same DMA stream, and the second initialization overwrote the first.
