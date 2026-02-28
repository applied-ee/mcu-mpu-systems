---
title: "Cache Coherency & DMA on Cortex-M7"
weight: 40
---

# Cache Coherency & DMA on Cortex-M7

Cortex-M7 processors (STM32F7, STM32H7) include separate instruction and data caches — typically 16 KB I-cache and 16 KB D-cache — that dramatically improve execution speed by reducing access latency to main SRAM. But DMA controllers operate on the physical bus, bypassing the CPU cache entirely. When DMA writes data to SRAM, the CPU cache may still hold stale values at those addresses. When the CPU writes data that DMA will read, the cache may hold updated values that have not been flushed to SRAM. This coherency problem is the single most common source of intermittent, hard-to-diagnose data corruption on Cortex-M7 systems.

## The Coherency Problem

Consider a peripheral-to-memory DMA transfer (e.g., ADC results arriving into a RAM buffer):

1. DMA writes fresh ADC data to SRAM address `0x20020000`.
2. CPU reads from `0x20020000` — but the D-cache has a cached copy from before the DMA transfer.
3. The CPU reads stale data from cache, not the new DMA data.

The reverse problem occurs with memory-to-peripheral transfers:

1. CPU writes TX data to buffer at `0x20020100` — the write may stay in D-cache and not reach SRAM.
2. DMA reads from `0x20020100` in SRAM — it sees the old contents, not the CPU's recent write.
3. The peripheral transmits stale or uninitialized data.

Neither scenario produces a fault or error flag. The data simply appears wrong, and the corruption may be intermittent because cache eviction is nondeterministic.

## Cache Line Fundamentals

The Cortex-M7 D-cache operates on 32-byte cache lines. Every cache operation — fill, clean, invalidate — works on entire 32-byte aligned blocks, not individual bytes. This has direct consequences for DMA buffer layout:

- A 10-byte DMA buffer that shares a cache line with an unrelated variable can cause the invalidation of that variable's cached value.
- A buffer starting at a non-32-byte-aligned address spans an extra cache line, and invalidating that line may discard adjacent valid cached data.

## Cache Maintenance Operations

The CMSIS-Core library provides three operations for D-cache management:

| Function | Effect | Use Before |
|----------|--------|-----------|
| `SCB_InvalidateDCache_by_Addr(addr, size)` | Discards cached data, forcing next read from SRAM | Reading DMA RX buffer |
| `SCB_CleanDCache_by_Addr(addr, size)` | Writes dirty cache lines back to SRAM | Starting DMA TX transfer |
| `SCB_CleanInvalidateDCache_by_Addr(addr, size)` | Clean + Invalidate combined | Bidirectional DMA buffers |

### Peripheral-to-Memory (DMA RX): Invalidate Before Reading

After DMA deposits data into a buffer, invalidate the cache for that region before the CPU reads it:

```c
#define ADC_BUF_SIZE 256
/* Align buffer to 32-byte cache line boundary */
__attribute__((aligned(32)))
static uint16_t adc_buf[ADC_BUF_SIZE];

void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Invalidate cache for the DMA buffer region.
       Size parameter is in bytes. */
    SCB_InvalidateDCache_by_Addr((uint32_t *)adc_buf,
                                 ADC_BUF_SIZE * sizeof(uint16_t));

    /* Now safe to read adc_buf — CPU fetches fresh data from SRAM */
    process_adc_data(adc_buf, ADC_BUF_SIZE);
}
```

The `SCB_InvalidateDCache_by_Addr` function takes a pointer (cast to `uint32_t *`) and a size in bytes. It invalidates every cache line that overlaps the specified address range.

### Memory-to-Peripheral (DMA TX): Clean Before Transfer

Before starting a DMA transfer that reads from a CPU-written buffer, clean the cache to ensure all writes have reached SRAM:

```c
__attribute__((aligned(32)))
static uint8_t tx_buf[128];

void start_spi_tx(void)
{
    /* Fill the transmit buffer */
    prepare_tx_data(tx_buf, 128);

    /* Flush dirty cache lines to SRAM so DMA reads correct data */
    SCB_CleanDCache_by_Addr((uint32_t *)tx_buf, 128);

    /* Start DMA — reads from SRAM, which now matches CPU's writes */
    HAL_SPI_Transmit_DMA(&hspi1, tx_buf, 128);
}
```

## Buffer Alignment Requirements

DMA buffers on Cortex-M7 must be aligned to 32-byte boundaries and sized in multiples of 32 bytes. This prevents cache maintenance operations from affecting adjacent variables.

```c
/* Correct: 32-byte aligned, size padded to cache line multiple */
__attribute__((aligned(32)))
static uint8_t dma_rx_buf[256];  /* 256 bytes = 8 cache lines, no partial overlap */

/* Dangerous: unaligned buffer shares cache lines with neighbors */
static uint8_t dma_rx_buf[100];  /* May start mid-cache-line */
```

For buffers whose logical size is not a multiple of 32, pad the allocation:

```c
#define DMA_BUF_SIZE     200
#define DMA_BUF_ALIGNED  (((DMA_BUF_SIZE) + 31U) & ~31U)  /* Rounds up to 224 */

__attribute__((aligned(32)))
static uint8_t rx_buf[DMA_BUF_ALIGNED];
```

The alignment macro rounds up to the next 32-byte boundary. Without this padding, invalidating the buffer's last partial cache line could discard a neighboring variable's cached value, producing corruption in completely unrelated data.

## MPU Configuration for Non-Cacheable Regions

An alternative to per-transfer cache maintenance is configuring the Memory Protection Unit (MPU) to mark DMA buffer regions as non-cacheable. This eliminates the coherency problem entirely for those regions at the cost of slower CPU access (every read/write goes through the bus to SRAM).

```c
void mpu_configure_dma_region(void)
{
    HAL_MPU_Disable();

    MPU_Region_InitTypeDef mpu_init = {0};
    mpu_init.Enable           = MPU_REGION_ENABLE;
    mpu_init.Number           = MPU_REGION_NUMBER0;
    mpu_init.BaseAddress      = 0x20020000;          /* Start of DMA buffer region */
    mpu_init.Size             = MPU_REGION_SIZE_4KB;  /* 4 KB non-cacheable region */
    mpu_init.AccessPermission = MPU_REGION_FULL_ACCESS;
    mpu_init.IsBufferable     = MPU_ACCESS_NOT_BUFFERABLE;
    mpu_init.IsCacheable      = MPU_ACCESS_NOT_CACHEABLE;
    mpu_init.IsShareable      = MPU_ACCESS_SHAREABLE;
    mpu_init.TypeExtField     = MPU_TEX_LEVEL1;
    mpu_init.SubRegionDisable = 0x00;
    mpu_init.DisableExec      = MPU_INSTRUCTION_ACCESS_DISABLE;

    HAL_MPU_ConfigRegion(&mpu_init);
    HAL_MPU_Enable(MPU_PRIVILEGED_DEFAULT);
}
```

The MPU region must be a power-of-two size (32 B, 64 B, ..., 4 KB, etc.) and aligned to its own size. The TEX/C/B bits control cacheability:

| TEX | C | B | Memory Type | Caching |
|-----|---|---|-------------|---------|
| 0   | 0 | 0 | Strongly Ordered | None, all accesses go to bus |
| 0   | 0 | 1 | Device | None, preserves order |
| 1   | 0 | 0 | Normal | Non-cacheable, no write buffer |
| 1   | 1 | 1 | Normal | Write-back, write-allocate (default SRAM) |

For DMA buffers, TEX=1, C=0, B=0 (Normal, non-cacheable) provides the best combination: normal memory ordering semantics (allowing unaligned access and compiler optimization) without caching.

## Linker Script: Placing Buffers in Non-Cacheable RAM

Rather than configuring MPU regions at runtime, the linker script can define a dedicated non-cacheable RAM section. All DMA buffers are then placed in this section using a GCC attribute:

In the linker script (`.ld` file), add a section in a specific SRAM region:

```ld
/* Define a non-cacheable RAM region for DMA buffers */
.dma_buffers (NOLOAD) :
{
    . = ALIGN(32);
    *(.dma_buffer)
    *(.dma_buffer.*)
    . = ALIGN(32);
} >RAM_D2   /* AXI SRAM on STM32H7, or a specific SRAM region */
```

In C code, place buffers in that section:

```c
__attribute__((section(".dma_buffer"), aligned(32)))
static uint16_t adc_buf[512];

__attribute__((section(".dma_buffer"), aligned(32)))
static uint8_t spi_rx_buf[256];
```

The MPU is then configured once at startup to mark the entire `RAM_D2` region (or whatever region `.dma_buffer` maps to) as non-cacheable. This approach scales well when many buffers are involved — no per-buffer cache maintenance calls are needed.

## STM32H7 Memory Map and DTCM

The STM32H7 has a complex multi-domain memory architecture:

| Region | Address | Size (H743) | Cache | DMA Access |
|--------|---------|-------------|-------|------------|
| ITCM   | 0x00000000 | 64 KB  | No (tightly coupled) | No — MDMA only |
| DTCM   | 0x20000000 | 128 KB | No (tightly coupled) | No — MDMA only |
| AXI SRAM | 0x24000000 | 512 KB | Yes (D-cache) | Yes — DMA1, DMA2 |
| SRAM1  | 0x30000000 | 128 KB | No (D2 domain) | Yes — DMA1, DMA2 |
| SRAM2  | 0x30020000 | 128 KB | No (D2 domain) | Yes — DMA1, DMA2 |
| SRAM3  | 0x30040000 | 32 KB  | No (D2 domain) | Yes — DMA1, DMA2 |
| SRAM4  | 0x38000000 | 64 KB  | No (D3 domain) | Yes — BDMA |

DTCM (Data Tightly Coupled Memory) is directly connected to the Cortex-M7 core with zero wait states and no cache — but DMA1 and DMA2 cannot access it. Placing a DMA buffer in DTCM results in a bus fault or silent transfer failure. Only MDMA (Master DMA), a separate controller that can access all memory regions, can transfer to/from DTCM.

The D2-domain SRAM regions (SRAM1, SRAM2, SRAM3) at `0x30000000` are the natural home for DMA buffers on STM32H7: they are accessible by DMA1/DMA2 and are not cached by default (they are outside the D-cache address range), eliminating coherency issues entirely.

```c
/* Place DMA buffer in D2 SRAM — no cache, DMA-accessible */
__attribute__((section(".sram1_bss"), aligned(32)))
static uint16_t adc_dma_buf[1024];
```

## Tips

- Default to placing DMA buffers in D2 SRAM (SRAM1/SRAM2) on STM32H7 — this sidesteps all cache coherency issues and requires no runtime cache maintenance.
- Always apply `__attribute__((aligned(32)))` to every DMA buffer on Cortex-M7, even if using non-cacheable memory — alignment ensures predictable behavior if the buffer region or MPU configuration changes later.
- When cache maintenance calls are unavoidable (buffers in AXI SRAM), invalidate *after* DMA completion (in the callback) and clean *before* starting the DMA transfer — reversing this order causes the exact corruption it intends to prevent.
- Use `SCB_CleanInvalidateDCache_by_Addr()` for bidirectional buffers (e.g., SPI full-duplex with TX and RX in the same buffer) — this handles both directions in a single operation.
- Enable D-cache and I-cache early in `SystemInit()` or `main()` — leaving cache disabled during development avoids coherency bugs but masks the performance impact, leading to designs that cannot meet timing deadlines once cache is enabled in production.

## Caveats

- **`SCB_InvalidateDCache_by_Addr` on a dirty cache line discards CPU writes that have not reached SRAM** — if the CPU modified any data within the same 32-byte cache line as the DMA buffer, those writes are lost; this is why alignment and padding are not optional but essential.
- **Placing DMA buffers in DTCM on STM32H7 compiles and links without error but produces zero-filled transfers** — DMA1/DMA2 cannot reach DTCM; the bus access fails silently, and the destination buffer retains its initialization value (typically zero).
- **The MPU region size must be a power of two** — configuring a 300-byte non-cacheable region is not possible; the smallest enclosing power-of-two region (512 bytes) must be used, potentially exposing more memory as non-cacheable than intended.
- **Disabling D-cache globally "solves" coherency but introduces 3-10x performance penalties on memory-intensive code** — applications that were meeting real-time deadlines with cache enabled will miss them with cache disabled; this is a debugging tool, not a production solution.
- **Cache maintenance functions have non-trivial execution time** — `SCB_InvalidateDCache_by_Addr` for a 4 KB buffer takes approximately 2-5 microseconds on STM32H7 at 480 MHz; in tight ISRs or high-frequency DMA callbacks, this overhead accumulates.

## In Practice

- ADC readings that are mostly correct but occasionally show stale values from a previous conversion cycle are the classic symptom of missing cache invalidation — the DMA wrote new data to SRAM, but the CPU served the read from D-cache, which still held the old sample.
- SPI transmissions where the first transfer after boot is correct but subsequent transfers send stale data commonly appear when `SCB_CleanDCache_by_Addr` is called only during initialization — each new TX buffer fill requires a fresh clean before the DMA transfer starts.
- A variable adjacent to a DMA buffer that mysteriously changes value — despite no code writing to it — often traces to a cache invalidation that spans an extra cache line due to buffer misalignment; the invalidation discards the neighbor's dirty cache entry, reverting it to an older SRAM value.
- An STM32H7 project that works with the default linker script (stack and heap in DTCM) but fails when DMA buffers are added without modifying the linker script typically results from DMA buffers being placed in DTCM by the default allocator — moving them to a `.dma_buffer` section in SRAM1/SRAM2 resolves the issue.
- Intermittent data corruption that disappears when single-stepping in the debugger often points to a cache coherency issue — the debugger's memory reads trigger cache line fills that happen to mask the stale-data problem, making the bug vanish under observation.
