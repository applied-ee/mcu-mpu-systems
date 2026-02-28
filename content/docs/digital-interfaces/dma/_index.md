---
title: "DMA Transfer Patterns"
weight: 60
bookCollapseSection: true
---

# DMA Transfer Patterns

DMA (Direct Memory Access) moves data between memory and peripherals without CPU intervention — the processor sets up the transfer and then continues executing code while the DMA controller handles the data movement in the background. On an STM32F4, the two DMA controllers provide 16 streams with configurable channels, priorities, and burst sizes. DMA is essential for high-throughput peripherals (SPI at 20+ MHz, UART at 1 Mbps, ADC continuous conversion) where polled or interrupt-per-byte approaches would consume the CPU entirely.

This section covers DMA from the firmware configuration perspective: channel and stream architecture, transfer direction setup, circular and double-buffer modes for continuous streaming, and the cache coherency challenges that emerge on Cortex-M7 devices with data caches.

## Pages

- **[DMA Channel & Stream Architecture]({{< relref "dma-channel-architecture" >}})** — How DMA controllers map streams to peripherals, request routing, priority arbitration, and the differences between STM32F4 stream/channel and STM32G4 request models.
- **[Memory-to-Peripheral & Peripheral-to-Memory]({{< relref "dma-transfer-directions" >}})** — Configuring source, destination, data widths, and increment modes for the two primary DMA transfer patterns.
- **[Circular & Double-Buffer Modes]({{< relref "dma-circular-double-buffer" >}})** — Continuous streaming with circular DMA, ping-pong buffering with double-buffer mode, and half-transfer interrupts for real-time processing.
- **[Cache Coherency & DMA on Cortex-M7]({{< relref "dma-cache-coherency" >}})** — D-cache invalidation, clean operations, MPU region configuration, and the buffer alignment rules that prevent sporadic data corruption.
