---
title: "DMA & Throughput Optimization"
weight: 40
---

# DMA & Throughput Optimization

A 240x320 display at RGB565 is 153,600 bytes per frame. At 10MHz SPI, that's about 123ms per full-screen update — barely 8fps, and that's assuming the MCU does nothing but push pixels. For smooth UI or any kind of animation, either reducing how much gets sent or sending it faster is required. DMA (Direct Memory Access) is the key enabler, but there are several other strategies worth understanding.

## Why CPU-Driven SPI Is Slow

In the simplest SPI driver, the CPU writes one byte (or one 16-bit word) to the SPI data register, waits for transmission to complete, then writes the next. The "wait for completion" part is the killer — the CPU sits idle during each byte's transmission time. Even with a FIFO, the CPU is in a tight polling loop. This means the MCU can't do anything else while updating the display, and throughput is limited by the CPU overhead per byte, not just the SPI clock rate.

## DMA Basics

DMA lets a hardware peripheral transfer data from memory to the SPI data register without CPU involvement. The source address (framebuffer), destination (SPI data register), and transfer length are configured, then the transfer is triggered. The DMA controller feeds bytes to SPI at the maximum rate the SPI clock allows while the CPU is free to compute the next frame, read sensors, or handle other tasks.

The setup varies by MCU family — STM32 has a flexible DMA controller that pairs with SPI channels, ESP32 uses its SPI DMA mode, RP2040 has a dedicated DMA engine, and nRF52 has EasyDMA. The concepts are the same; the register-level configuration differs. Most mature display libraries (TFT_eSPI, LovyanGFX, LVGL drivers) handle DMA configuration for popular MCU platforms.

## Double Buffering with DMA

The simplest DMA approach sends the whole framebuffer and waits for completion. But if the next frame is being rendered into the same buffer, the DMA transfer must finish before drawing begins. Double buffering solves this: maintain two framebuffers, draw into one while the DMA sends the other. When the transfer completes, swap buffers. This hides the transfer latency behind render time and can roughly double the effective frame rate — at the cost of doubling RAM usage (300KB for two 240x320 RGB565 buffers, which is only feasible on MCUs with plenty of RAM).

## Partial Refresh

Often the most effective optimization is simply sending less data. If only a small region of the screen changed (a number updating, a progress bar advancing), use the controller's column and row address window commands to update just that rectangle. Most TFT controllers support setting an arbitrary rectangular window for pixel data. Updating a 100x20 pixel region instead of the full 240x320 screen sends 4,000 bytes instead of 153,600 — a 38x reduction.

LVGL is particularly good at this: it tracks dirty regions automatically and only flushes the changed areas. For custom code, tracking dirty rectangles manually is straightforward and well worth the effort.

## SPI Clock Speed

Before reaching for DMA, it's worth confirming the SPI clock is actually running as fast as the hardware allows. Many setups leave the SPI clock at a conservative default. The ILI9341 can typically handle 40-80MHz write clocks with short connections. Going from 10MHz to 40MHz is an instant 4x throughput improvement with zero code complexity. Testing incrementally — starting at a known-good speed and increasing until pixel corruption appears, then backing off — is the standard approach.

## Tips

- Optimize in this order: maximize SPI clock (free), then partial refresh (biggest impact), then DMA (frees CPU), then double buffering (last resort)
- LVGL's built-in dirty-region tracking is preferable to a custom implementation — it handles partial refresh well across most display types
- When testing DMA, the transfer must complete before starting the next one — overlapping DMA transfers to the same SPI peripheral corrupt data

## Caveats

- **Double buffering for a 240x320 RGB565 display needs 300KB** — That's only feasible on MCUs with large RAM (ESP32-S3, STM32H7, etc.). Most Cortex-M4 parts lack sufficient RAM
- **DMA configuration is MCU-specific** — The concepts are universal, but register setup differs completely between STM32, ESP32, RP2040, and nRF52. Library support is the practical path for most projects
- **Partial refresh requires the display controller to support windowed addressing** — Most TFT controllers do, but the address setup commands add overhead. For very small update regions, the per-transfer overhead can dominate the actual pixel data

## In Practice

- A display that achieves good frame rates in benchmarks but stutters during normal use is likely CPU-bound during rendering — DMA frees the bus but doesn't help if the CPU can't prepare frames fast enough
- Pixel corruption at high SPI clocks usually appears as shifted colors, horizontal lines, or blocky artifacts — drop the clock speed before investigating other causes
- A display driven by DMA that occasionally shows torn frames is either missing a transfer-complete check or has a timing conflict between the DMA and CPU access to the framebuffer
