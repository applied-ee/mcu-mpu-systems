---
title: "Screens & Displays"
weight: 5
bookCollapseSection: true
---

# Screens & Displays

Getting pixels in front of a user. Displays are often the most visible part of an embedded project — literally — and the choice of display technology shapes the UI, the power budget, the bus configuration, and the firmware complexity. Character LCDs, monochrome OLEDs, color TFTs, and E-Ink panels each bring different strengths and constraints, and picking the right one depends on what you're showing, how often it changes, and how much power you can spend.

This section covers the major display technologies used in MCU and MPU projects, from the humble HD44780 character LCD through high-refresh color TFTs, along with the graphics libraries, font rendering strategies, and UI layout patterns needed to put useful information on screen.

## Sections

- **[Character LCDs]({{< relref "character-lcds" >}})** — The HD44780 and its I²C backpack ecosystem: parallel wiring, 4-bit mode, custom characters, and the display that's been the embedded hello-world for decades.
- **[OLED Graphic Displays]({{< relref "oled-graphic-displays" >}})** — SSD1306, SH1106, and friends: small monochrome OLEDs with pixel-level control, framebuffer management, and the tradeoffs between controllers.
- **[TFT Color Displays]({{< relref "tft-color-displays" >}})** — ILI9341, ST7789, and other color TFT controllers: SPI configuration, color formats, and the DMA strategies needed to push pixels fast enough.
- **[E-Ink]({{< relref "e-ink" >}})** — Electrophoretic displays: bistability, refresh behavior, ghosting tradeoffs, and the modules commonly used in low-power projects.
- **[Graphics Libraries & Fonts]({{< relref "graphics-libraries-and-fonts" >}})** — LVGL, U8g2, Adafruit GFX, and others: choosing a library, rendering fonts, and drawing primitives on constrained hardware.
- **[UI Layout Patterns]({{< relref "ui-layout-patterns" >}})** — Designing usable interfaces on small screens: layout strategies, menu navigation, and data visualization with limited pixels.
