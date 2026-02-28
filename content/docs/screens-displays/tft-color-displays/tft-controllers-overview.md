---
title: "Common TFT Controllers"
weight: 10
---

# Common TFT Controllers

Once you outgrow monochrome OLEDs and need color, you land in TFT territory. The display modules aimed at hobbyists and embedded projects almost all use a handful of controller ICs, each with its own quirks. Knowing which controller you're dealing with is the first step — it determines your driver choice, SPI configuration, initialization sequence, and color format options.

## ILI9341

The ILI9341 is the workhorse of small color TFTs. It drives 240x320 displays (typically 2.2" or 2.4" modules) with 262K colors. SPI interface up to 10MHz for reads and higher for writes (many people push it to 40-80MHz successfully). It's well-documented, well-supported by every major graphics library, and the most "just works" option in this category. If you're picking your first color display, a 2.4" ILI9341 module is the safe default.

## ST7789

The ST7789 appears on many 1.3" and 1.54" 240x240 square displays, as well as some 240x320 and 240x135 modules. It's broadly similar to the ILI9341 in capability but has some command-set differences that make ILI9341 drivers fail on it. The initialization sequence is different, and the memory access control register values may need adjustment depending on the specific panel's pixel mapping. ST7789 modules have become very popular due to the availability of small, cheap square displays that work well for watch-like projects or compact UIs.

## ST7735

The ST7735 drives smaller, lower-resolution displays — 128x160 (1.8") and 128x128 (1.44") are the most common. These are the cheapest color TFTs you can buy and the most forgiving in terms of SPI speed requirements. The downsides are low resolution and limited viewing angles. Still useful for simple status displays where you need color but not many pixels.

## ILI9488

When you need more screen real estate, the ILI9488 drives 320x480 panels (typically 3.5" modules). The catch is that many ILI9488 modules only support 18-bit color (RGB666) over SPI, not the 16-bit RGB565 that most embedded graphics libraries default to. This means 3 bytes per pixel instead of 2, which increases bus traffic by 50%. Some libraries handle this transparently; others need configuration. The larger pixel count also means DMA becomes much more important for acceptable frame rates.

## Quick Comparison

| Controller | Typical Resolution | Interface | Color Depth | Sweet Spot |
|------------|-------------------|-----------|-------------|------------|
| ILI9341 | 240x320 | SPI (fast) | 16/18-bit | General-purpose small color display |
| ST7789 | 240x240, 240x320 | SPI (fast) | 16/18-bit | Compact square displays |
| ST7735 | 128x160, 128x128 | SPI | 16-bit | Cheapest color option |
| ILI9488 | 320x480 | SPI | 18-bit (SPI) | When you need more pixels |

The best advice: buy modules where the product listing clearly states the controller IC, and confirm it with a quick search before committing to a driver library. Modules that just say "TFT LCD" without specifying the controller are gambling.

## Tips

- Buy modules that explicitly state the controller IC in the listing — verify with a web search before committing to a driver
- Start with the ILI9341 for your first color display project; it has the broadest library support and the most community troubleshooting resources
- If you're building for a specific form factor, the ST7789 on a 240x240 square module gives a watch-like layout that works well for compact UIs

## Caveats

- **ILI9488 often requires RGB666 over SPI** — Many ILI9488 modules don't support RGB565 on the SPI interface, forcing 3 bytes per pixel instead of 2. This 50% bandwidth increase makes a noticeable performance difference on large screens
- **ST7789 and ILI9341 drivers are not interchangeable** — Despite both being 240x320 SPI TFTs, the initialization sequences and some command bytes differ. Using the wrong driver produces a white screen or garbled colors
- **Identical-looking modules may use different controllers** — Cheap modules from different batches or suppliers sometimes swap controllers without changing the product listing

## In Practice

- A white screen after initialization usually means the wrong controller driver is selected, the SPI mode is wrong, or the DC pin isn't toggling correctly
- Colors that are shifted or inverted (red shows as blue, etc.) suggest the memory access control register or color format is misconfigured for the specific panel
- A display that works at low SPI clock but corrupts at higher speeds may have the wrong SPI mode selected — most TFT controllers use Mode 0
