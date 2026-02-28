---
title: "DMA & Throughput Optimization"
weight: 40
---

# DMA & Throughput Optimization

A 240x320 display at RGB565 is 153,600 bytes per frame. At 10MHz SPI, that's about 123ms per full-screen update — barely 8fps, and that's assuming your MCU does nothing but push pixels. For smooth UI or any kind of animation, you need to either reduce how much you send or send it faster. DMA (Direct Memory Access) is the key enabler, but there are several other strategies worth understanding.

## Why CPU-Driven SPI Is Slow

In the simplest SPI driver, the CPU writes one byte (or one 16-bit word) to the SPI data register, waits for the transmission to complete, then writes the next. The "wait for completion" part is the killer — the CPU sits idle during each byte's transmission time. Even with a FIFO, the CPU is in a tight polling loop. This means your MCU can't do anything else while updating the display, and you're limited by the CPU overhead per byte, not just the SPI clock rate.

## DMA Basics

DMA lets a hardware peripheral transfer data from memory to the SPI data register without CPU involvement. You set up the source address (your framebuffer), the destination (SPI data register), the transfer length, and trigger it. The DMA controller feeds bytes to SPI at the maximum rate the SPI clock allows while the CPU is free to compute the next frame, read sensors, or handle other tasks.

The setup varies by MCU family — STM32 has a flexible DMA controller that pairs with SPI channels, ESP32 uses its SPI DMA mode, RP2040 has a dedicated DMA engine, and nRF52 has EasyDMA. The concepts are the same; the register-level configuration differs. Most mature display libraries (TFT_eSPI, LovyanGFX, LVGL drivers) handle DMA configuration for popular MCU platforms.

## Double Buffering with DMA

The simplest DMA approach sends the whole framebuffer and waits for completion. But if you're rendering the next frame into the same buffer, you need to wait for the DMA transfer to finish before you start drawing. Double buffering solves this: maintain two framebuffers, draw into one while the DMA sends the other. When the transfer completes, swap buffers. This hides the transfer latency behind render time and can roughly double your effective frame rate — at the cost of doubling your RAM usage (300KB for two 240x320 RGB565 buffers, which is only feasible on MCUs with plenty of RAM).

## Partial Refresh

Often the most effective optimization is simply sending less data. If only a small region of the screen changed (a number updating, a progress bar advancing), use the controller's column and row address window commands to update just that rectangle. Most TFT controllers support setting an arbitrary rectangular window for pixel data. Updating a 100x20 pixel region instead of the full 240x320 screen sends 4,000 bytes instead of 153,600 — a 38x reduction.

LVGL is particularly good at this: it tracks dirty regions automatically and only flushes the changed areas. For custom code, tracking dirty rectangles manually is straightforward and well worth the effort.

## SPI Clock Speed

Before reaching for DMA, make sure you're actually running SPI as fast as your hardware allows. Many people leave the SPI clock at a conservative default. The ILI9341 can typically handle 40-80MHz write clocks with short connections. Going from 10MHz to 40MHz is an instant 4x throughput improvement with zero code complexity. Test incrementally — start at a known-good speed and increase until you see pixel corruption, then back off.

## Practical Priorities

When optimizing display throughput, I'd suggest this order:

1. **Maximize SPI clock** — free performance, no code changes
2. **Partial refresh** — send only what changed, biggest bang for effort
3. **DMA transfers** — free up CPU during transfers
4. **Double buffering** — only if you have RAM and need sustained high fps
