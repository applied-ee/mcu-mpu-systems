---
title: "SSD1306 — The Ubiquitous OLED"
weight: 10
---

# SSD1306 — The Ubiquitous OLED

The SSD1306 is to OLEDs what the HD44780 is to character LCDs — the one everyone encounters first. These tiny monochrome OLED modules (usually 0.96" at 128x64 or 0.91" at 128x32) show up in every "getting started with displays" tutorial for good reason: they're cheap (often under $3), need no backlight since OLEDs are self-emitting, have excellent contrast, and work over I²C with just four wires. For small status displays, sensor readouts, or debug output, they're hard to beat.

## I²C vs SPI Variants

Most SSD1306 modules come wired for I²C out of the box, typically at address `0x3C` (sometimes `0x3D`). Some modules have an address select resistor you can move to switch between the two. SPI variants exist and are noticeably faster — the SSD1306 supports SPI clock rates well above what I²C can do — but they require more wires (`MOSI`, `SCK`, `CS`, `DC`, `RES`) and are less common in the cheap module market. If you're just putting a status display on a project, I²C is fine. If you're pushing lots of graphical updates, SPI is worth the extra pins.

## Wiring and Initialization

For I²C, it's just `VCC`, `GND`, `SDA`, `SCL`, plus pull-up resistors if your board doesn't already have them (most breakout modules include pull-ups). The SSD1306 needs an initialization sequence to configure the multiplex ratio, display offset, COM pin configuration, contrast, and charge pump. The charge pump is important — these modules need an internal DC-DC converter to generate the OLED driving voltage, and if you don't enable it, you get nothing on screen. Every library handles this automatically, but if you're writing a bare-metal driver, the charge pump enable command (`0x8D` followed by `0x14`) is the one you'll forget and wonder why your display stays dark.

## The 128x64 Framebuffer

The SSD1306 has 1KB of internal GDDRAM organized as 8 pages of 128 bytes each. Each byte represents a vertical column of 8 pixels within a page, with the LSB at the top. This page-oriented layout means that to set a single arbitrary pixel, you need to read-modify-write an entire byte (or maintain a local framebuffer and write the whole thing). Most libraries maintain a 1024-byte buffer in MCU RAM and flush it to the display when you call a `display()` or `update()` function. For a 128x32 display, you only need 512 bytes. On memory-constrained MCUs, this buffer size matters.

## Gotchas

Address conflicts are a common pain point: if you want two SSD1306 modules on the same I²C bus, you only get two addresses (`0x3C` and `0x3D`), and some modules don't even expose the address selection pad. Also, while these OLEDs have great contrast, they're susceptible to burn-in if you display a static image for extended periods — consider implementing a screen saver or periodically inverting the display for always-on applications. The viewing angle is excellent compared to LCDs, but the small size means text smaller than about 8 pixels tall becomes hard to read.
