---
title: "TFT Color Displays"
weight: 30
bookCollapseSection: true
---

# TFT Color Displays

When you need color, more pixels, or a display large enough to build a real UI on. TFT modules driven by controllers like the ILI9341 and ST7789 are the workhorses of embedded color graphics — they're fast enough for responsive interfaces, cheap enough for hobby projects, and well-supported by the major graphics libraries. The complexity jumps compared to monochrome OLEDs: SPI configuration becomes critical, color format encoding matters, and pushing enough pixels for smooth updates often requires DMA.

## What This Section Covers

- **[Common TFT Controllers]({{< relref "tft-controllers-overview" >}})** — ILI9341, ST7789, ST7735, and ILI9488: resolution, interface, and color depth compared, plus how to identify what controller your module actually uses.
- **[SPI Configuration & Wiring]({{< relref "spi-configuration" >}})** — SPI mode, clock speed tuning, the DC pin that makes TFT SPI different from normal SPI, level shifting, backlight control, and reset pin handling.
- **[Color Formats & Pixel Packing]({{< relref "color-formats" >}})** — RGB565 vs RGB666 vs RGB888: bit layout, byte ordering, endianness gotchas between MCU and display, and converting from 24-bit color.
- **[DMA & Throughput Optimization]({{< relref "dma-and-performance" >}})** — Why CPU-driven SPI is slow for large displays, DMA transfer basics, double buffering, partial refresh, and the practical priority order for optimization.
