---
title: "SPI in Real Systems"
weight: 30
bookCollapseSection: true
---

# SPI in Real Systems

SPI is the workhorse bus for high-speed peripheral communication — flash memory, ADCs, displays, and radio transceivers all speak SPI at clock rates from 1 MHz to over 50 MHz. The protocol is simple (clock, data in, data out, chip select), but the four mode/polarity combinations, the chip-select timing requirements, and the DMA integration complexity mean that SPI drivers are where many firmware projects first encounter serious peripheral bugs.

This section covers SPI from the firmware perspective: mode and polarity configuration that matches the device datasheet, chip-select management strategies for single and multi-device buses, DMA-driven transfers that free the CPU for other work, and the bus architecture decisions that determine whether multiple SPI devices can coexist reliably.

## Pages

- **[SPI Mode Configuration & Clock Polarity]({{< relref "spi-mode-configuration" >}})** — CPOL, CPHA, the four SPI modes, MSB/LSB ordering, and how to read a device datasheet timing diagram to select the correct mode.
- **[Chip-Select Management]({{< relref "spi-chip-select" >}})** — Hardware vs software CS, timing requirements between CS assertion and first clock edge, and multi-device select strategies.
- **[DMA-Driven SPI Transfers]({{< relref "spi-dma-transfers" >}})** — Configuring DMA for SPI TX/RX, handling the dummy-byte problem, and managing completion callbacks without race conditions.
- **[Multi-Device SPI Buses]({{< relref "spi-multi-device" >}})** — Shared-bus topologies, mixed-speed devices, per-device configuration switching, and when to use separate SPI peripherals instead.
