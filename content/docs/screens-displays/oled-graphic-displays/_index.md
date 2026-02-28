---
title: "OLED Graphic Displays"
weight: 20
bookCollapseSection: true
---

# OLED Graphic Displays

The step up from character LCDs. Small monochrome OLEDs — typically 128x64 or 128x32 pixels — provide full pixel-level control for graphics, custom fonts, and compact data visualizations while staying cheap and easy to wire. They're self-emitting (no backlight needed), have excellent contrast ratios, and work over I²C with just four wires, making them the go-to display for sensor readouts, debug output, and small status screens.

The tradeoff is that the firmware now manages a framebuffer, handles pixel layout, and choose between controllers that look the same on the outside but behave differently in firmware.

## What This Section Covers

- **[SSD1306 — The Ubiquitous OLED]({{< relref "ssd1306-basics" >}})** — The most common OLED controller: 128x64 and 128x32 variants, I²C vs SPI wiring, charge pump initialization, and the 1KB framebuffer that lives in MCU RAM.
- **[SH1106 & Other Controllers]({{< relref "sh1106-and-alternatives" >}})** — Beyond the SSD1306: the SH1106's column offset catch, the SSD1309 for larger panels, the SSD1327 for grayscale, and how to pick between them.
- **[Framebuffer Strategies for Small OLEDs]({{< relref "framebuffer-strategies" >}})** — Managing display memory on constrained MCUs: full framebuffer vs page mode, dirty-rectangle tracking, double buffering, and when each approach makes sense.
