---
title: "Memory-to-Peripheral & Peripheral-to-Memory"
weight: 20
---

# Memory-to-Peripheral & Peripheral-to-Memory

Every DMA transfer has a source, a destination, and a set of rules governing how addresses advance and how data widths are matched. The three fundamental directions — peripheral-to-memory, memory-to-peripheral, and memory-to-memory — cover nearly every use case in embedded firmware. Getting the direction, increment mode, or data alignment wrong produces transfers that appear to work but deliver corrupted or shifted data.

## Transfer Directions

DMA direction is configured from the perspective of the DMA controller:

| Direction | Source | Destination | Typical Use |
|-----------|--------|-------------|-------------|
| `DMA_PERIPH_TO_MEMORY` | Peripheral DR | RAM buffer | ADC sampling, SPI RX, UART RX |
| `DMA_MEMORY_TO_PERIPH` | RAM buffer | Peripheral DR | SPI TX, DAC output, UART TX |
| `DMA_MEMORY_TO_MEMORY` | RAM address | RAM address | Fast memcpy, buffer initialization |

Memory-to-memory mode is only available on DMA2 (on STM32F4) and does not use peripheral request pacing — the DMA controller runs at maximum bus speed, completing the transfer as fast as arbitration allows.

## Address Increment Modes

Each side of the transfer (source and destination) has an independent increment setting:

- **Peripheral increment disabled** (`DMA_PINC_DISABLE`) — the peripheral address stays fixed, reading from or writing to the same data register repeatedly. This is the correct setting for virtually all peripheral transfers, since the data register (e.g., `SPI1->DR`, `ADC1->DR`) is a single fixed address.
- **Memory increment enabled** (`DMA_MINC_ENABLE`) — the memory address advances after each transfer by the configured data width. Without this, every peripheral read overwrites the same memory location.

For memory-to-memory transfers, both sides typically increment.

## Data Width and Alignment

The `PeriphDataAlignment` and `MemDataAlignment` fields control how many bytes move per transfer beat:

| Setting | Width | Typical Peripheral |
|---------|-------|--------------------|
| `DMA_PDATAALIGN_BYTE` | 8 bits | UART DR, SPI DR (8-bit mode) |
| `DMA_PDATAALIGN_HALFWORD` | 16 bits | ADC DR (12-bit result in 16-bit register), SPI DR (16-bit mode) |
| `DMA_PDATAALIGN_WORD` | 32 bits | DCMI DR, memory-to-memory |

In direct mode (FIFO disabled), the peripheral and memory data widths must match. In FIFO mode, the DMA controller can pack or unpack — for example, collecting four byte reads from a peripheral into one word write to memory. Mismatched widths in direct mode cause a transfer error flag.

## Peripheral-to-Memory: ADC with DMA

A common pattern is continuous ADC conversion with DMA transferring results to a buffer. On STM32F4 with ADC1 reading a single channel:

```c
#define ADC_BUF_LEN 256
uint16_t adc_buf[ADC_BUF_LEN];

/* ADC Configuration */
ADC_HandleTypeDef hadc1;
hadc1.Instance                   = ADC1;
hadc1.Init.Resolution            = ADC_RESOLUTION_12B;
hadc1.Init.ScanConvMode          = DISABLE;
hadc1.Init.ContinuousConvMode    = ENABLE;
hadc1.Init.DMAContinuousRequests = ENABLE;
hadc1.Init.EOCSelection          = ADC_EOC_SEQ_CONV;
HAL_ADC_Init(&hadc1);

/* DMA Configuration — DMA2 Stream0 Channel0 for ADC1 */
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

/* Start ADC with DMA */
HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buf, ADC_BUF_LEN);
```

Key details: the ADC data register is 16 bits wide (12-bit result, right-aligned in a halfword), so both peripheral and memory alignment are set to halfword. `DMA_PINC_DISABLE` keeps the DMA reading from `ADC1->DR` every conversion. `DMA_MINC_ENABLE` fills successive buffer positions. `DMA_CIRCULAR` reloads the transfer count automatically when it reaches zero, creating a continuous ring buffer.

## Memory-to-Peripheral: SPI TX with DMA

Transmitting a buffer over SPI uses memory-to-peripheral direction. The memory pointer increments through the TX buffer while the peripheral address stays fixed at `SPI1->DR`:

```c
uint8_t tx_data[128];
/* ... fill tx_data ... */

DMA_HandleTypeDef hdma_spi1_tx;
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

/* Transmit 128 bytes over SPI1 via DMA */
HAL_SPI_Transmit_DMA(&hspi1, tx_data, 128);
```

The transfer count (NDTR register) is loaded with 128. Each SPI TX-empty event triggers one DMA beat, reading the next byte from `tx_data` and writing it to `SPI1->DR`. When NDTR reaches zero, the DMA transfer-complete interrupt fires.

## Memory-to-Memory: DMA-Accelerated Copy

Memory-to-memory transfers bypass peripheral request pacing and run at bus speed. On STM32F4, only DMA2 supports this mode:

```c
DMA_HandleTypeDef hdma_memcpy;
hdma_memcpy.Instance                 = DMA2_Stream0;
hdma_memcpy.Init.Channel             = DMA_CHANNEL_0;
hdma_memcpy.Init.Direction           = DMA_MEMORY_TO_MEMORY;
hdma_memcpy.Init.PeriphInc           = DMA_PINC_ENABLE;   /* "Periph" = source in M2M */
hdma_memcpy.Init.MemInc              = DMA_MINC_ENABLE;
hdma_memcpy.Init.PeriphDataAlignment = DMA_PDATAALIGN_WORD;
hdma_memcpy.Init.MemDataAlignment    = DMA_MDATAALIGN_WORD;
hdma_memcpy.Init.Mode                = DMA_NORMAL;
hdma_memcpy.Init.Priority            = DMA_PRIORITY_LOW;
hdma_memcpy.Init.FIFOMode            = DMA_FIFOMODE_ENABLE;
hdma_memcpy.Init.FIFOThreshold       = DMA_FIFO_THRESHOLD_FULL;
hdma_memcpy.Init.MemBurst            = DMA_MBURST_INC4;
hdma_memcpy.Init.PeriphBurst         = DMA_PBURST_INC4;
HAL_DMA_Init(&hdma_memcpy);

/* Copy 1024 words (4096 bytes) */
HAL_DMA_Start(&hdma_memcpy, (uint32_t)src_buf, (uint32_t)dst_buf, 1024);
HAL_DMA_PollForTransfer(&hdma_memcpy, HAL_DMA_FULL_TRANSFER, 100);
```

In memory-to-memory mode, the "peripheral" address fields actually refer to the source address. Both increments are enabled. Using word-width transfers with FIFO burst mode maximizes throughput — a 4-beat burst at 32 bits moves 16 bytes per bus transaction.

## FIFO Threshold and Burst Configuration

When FIFO mode is enabled, the threshold determines when the FIFO flushes to the destination:

| Threshold | FIFO Fill Level | Bytes (with byte-width data) |
|-----------|----------------|------------------------------|
| `DMA_FIFO_THRESHOLD_1QUARTERFULL` | 1/4 | 4 bytes |
| `DMA_FIFO_THRESHOLD_HALFFULL` | 1/2 | 8 bytes |
| `DMA_FIFO_THRESHOLD_3QUARTERSFULL` | 3/4 | 12 bytes |
| `DMA_FIFO_THRESHOLD_FULL` | Full | 16 bytes |

Burst size (INCR4, INCR8, INCR16) must be compatible with the FIFO threshold. The product of burst size and data width cannot exceed the FIFO threshold level. For example, `DMA_MBURST_INC4` with word-width data = 16 bytes per burst, which requires `DMA_FIFO_THRESHOLD_FULL`. Violating this constraint sets the FIFO error flag and halts the transfer.

## The NDTR Register

The Number of Data To Transfer register (`DMA_SxNDTR` on STM32F4) holds the remaining transfer count. It decrements by one after each transfer beat (not each byte — if the data width is word, NDTR decrements once per 4-byte transfer). In normal mode, the stream disables itself when NDTR reaches zero. In circular mode, NDTR reloads automatically from its initial value.

Reading NDTR during an active transfer reveals how far the transfer has progressed:

```c
uint32_t remaining = __HAL_DMA_GET_COUNTER(&hdma_adc1);
uint32_t transferred = ADC_BUF_LEN - remaining;
```

This is useful for monitoring progress without waiting for the transfer-complete interrupt, though the value can change between the read and its use in calculations.

## Tips

- Always set `PeriphInc` to `DMA_PINC_DISABLE` for peripheral transfers — peripheral data registers are memory-mapped I/O at fixed addresses; incrementing the peripheral pointer reads from adjacent (unrelated) registers.
- Match data widths to the peripheral register size: halfword for ADC (16-bit DR), byte for UART (8-bit DR), and byte or halfword for SPI depending on the configured frame size.
- For SPI TX+RX simultaneously, configure two DMA streams — one memory-to-peripheral for TX and one peripheral-to-memory for RX — and use `HAL_SPI_TransmitReceive_DMA()` which manages both.
- When using memory-to-memory mode for large copies, enable FIFO with full threshold and burst mode — this reduces bus arbitration overhead and approaches the theoretical AHB bus bandwidth.
- Set `DMAContinuousRequests = ENABLE` in the ADC init when using circular DMA — without this, the ADC stops generating DMA requests after the first sequence, even though the DMA stream is in circular mode.

## Caveats

- **Mismatched data widths in direct mode produce a transfer error, not corrupted data** — the DMA controller sets the Transfer Error flag (TEIF) and halts; this is actually safer than FIFO mode, where width mismatches silently repack data in potentially unexpected ways.
- **Enabling peripheral increment on a peripheral transfer reads successive register addresses** — for example, incrementing from `SPI1->DR` (offset 0x0C) reads `SPI1->SR` (offset 0x08) on the next beat, producing garbage data with no error indication.
- **The NDTR register counts transfers, not bytes** — with halfword data alignment, NDTR = 256 means 512 bytes; passing a byte count to `HAL_ADC_Start_DMA()` when the function expects a transfer count (number of halfwords for ADC) results in reading twice the intended buffer size and corrupting adjacent memory.
- **Memory-to-memory transfers cannot use circular mode** — attempting to configure `DMA_MEMORY_TO_MEMORY` with `DMA_CIRCULAR` is rejected by `HAL_DMA_Init()`, which returns `HAL_ERROR`; this means M2M copies must be retriggered explicitly for repeated operations.
- **The STM32 HAL `HAL_SPI_Transmit_DMA()` function does not manage the chip select line** — CS must be driven manually before and after the DMA transfer, typically in the transfer-complete callback; releasing CS too early (before the last byte clocks out) truncates the transaction.

## In Practice

- An ADC DMA buffer that contains the correct first value repeated across every position typically shows up when `DMA_MINC_ENABLE` was accidentally left as `DMA_MINC_DISABLE` — every conversion overwrites the same memory address.
- SPI data that appears byte-swapped on the receiving device commonly appears when the SPI frame size is 16 bits but the DMA data width is set to byte — the DMA sends the buffer byte-by-byte, while the SPI peripheral packs them into 16-bit frames with reversed byte order.
- A DMA transfer that completes instantly with NDTR = 0 but the destination buffer is empty often results from swapping the source and destination addresses — the transfer ran but wrote the peripheral register contents into the source buffer (or vice versa) while the intended destination was never touched.
- A hard fault during DMA memory-to-memory operation on DMA1 traces to the hardware limitation: only DMA2 supports M2M on STM32F4; DMA1 ignores the direction field and may produce undefined behavior.
- An ADC that works for exactly one scan sequence then stops generating DMA requests, even with circular DMA, commonly appears when `DMAContinuousRequests` is left at `DISABLE` in the ADC configuration — the ADC stops issuing DMA requests after EOC, leaving the DMA stream idle.
