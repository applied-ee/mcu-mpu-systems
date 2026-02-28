---
title: "Graphics Library Landscape"
weight: 10
---

# Graphics Library Landscape

Choosing a graphics library for an embedded display is one of those decisions that shapes your whole project. The library determines your API, what displays you can easily support, how much RAM and flash you need, and whether features like touch input or widgets come built-in. Here's a practical overview of the major options.

## LVGL (Light and Versatile Graphics Library)

LVGL is the most feature-rich option and the closest thing to a "real GUI framework" for MCUs. It provides widgets (buttons, sliders, charts, lists), a layout engine, themes, animations, and even a font converter. The tradeoff is resource usage: LVGL wants at least 64KB of flash and 16KB of RAM as a minimum, and realistically more like 128KB+ flash and 32KB+ RAM for a usable UI. It's overkill for a simple sensor readout on a 128x64 OLED, but if you're building a thermostat with a touchscreen TFT, LVGL is probably the right tool.

LVGL is display-agnostic — you provide a "flush" callback that sends pixel data to your specific display, and LVGL handles everything above that. This means it works with any display but requires you to write or find the driver glue code.

## U8g2

U8g2 is the go-to for monochrome displays: OLEDs (SSD1306, SH1106, SSD1309), character LCDs, and various other small screens. Its greatest strength is its built-in driver list — it ships with support for a huge number of display controllers out of the box. Just pick your constructor and go. U8g2 also supports page-buffer mode for low-RAM environments and includes a solid collection of bitmap fonts.

For color displays, U8g2 isn't the right choice. It's designed around monochrome and grayscale pixel models.

## Adafruit GFX

Adafruit GFX is a simple graphics primitives library (lines, rectangles, circles, text, bitmaps) that pairs with display-specific driver libraries (Adafruit_SSD1306, Adafruit_ILI9341, etc.). It's widely used in the Arduino ecosystem and easy to understand. The font support is basic but functional, and there are tools to convert TrueType fonts to the Adafruit GFX format. The main limitation is performance — it wasn't designed with DMA or double buffering in mind, and the abstraction layer adds overhead on tight loops.

## TFT_eSPI

TFT_eSPI is a high-performance TFT library specifically for ESP8266 and ESP32 (and increasingly RP2040). It's configured at compile time via a `User_Setup.h` file where you specify your display controller, pins, and SPI settings. The compile-time configuration makes it fast — there's no runtime polymorphism overhead — but it also means you can't switch displays without recompiling. TFT_eSPI includes DMA support, sprite rendering, and smooth font rendering, making it a strong choice for ESP-based color display projects.

## LovyanGFX

LovyanGFX is a newer alternative to TFT_eSPI with a similar performance focus but a more modern C++ API and better multi-platform support (ESP32, RP2040, SAMD). It supports runtime display configuration (unlike TFT_eSPI's compile-time approach), has built-in DMA, sprite/framebuffer management, and works as an LVGL backend driver. If you're starting a new ESP32 TFT project, LovyanGFX is worth evaluating alongside TFT_eSPI.

## When to Pick Which

| Scenario | Library |
|----------|---------|
| Small monochrome OLED, simple output | U8g2 |
| Arduino TFT, basic graphics | Adafruit GFX |
| ESP32 TFT, performance matters | TFT_eSPI or LovyanGFX |
| Touch UI with widgets, polished look | LVGL |
| Need to support many display types | U8g2 (mono) or LovyanGFX (color) |
