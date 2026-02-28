---
title: "SH1106 & Other Controllers"
weight: 20
---

# SH1106 & Other Controllers

The SSD1306 gets all the attention, but it's not the only OLED controller out there. The SH1106 is probably the second most common, and there are a handful of others worth knowing about — especially once you move beyond the 128x64 monochrome sweet spot. Understanding the differences matters because using the wrong driver for your controller produces garbled output or nothing at all, and the modules often look physically identical.

## SH1106 — The Column Offset Catch

The SH1106 is extremely similar to the SSD1306 in capability, but has one critical difference: it has 132 columns of internal RAM instead of 128. Since the display panel is still 128 pixels wide, the visible area starts at column 2 (offset of 2). If you use an SSD1306 driver on an SH1106 display, you'll see the image shifted left by 2 pixels with a garbage strip on the right edge. The fix is simple — add a 2-pixel column offset when setting the display start address — but diagnosing it the first time is confusing.

The SH1106 also lacks the horizontal scrolling hardware and continuous horizontal addressing mode that the SSD1306 has. This means you can't just stream a full framebuffer to the display in one shot the same way; you typically need to set the page and column address for each page individually. Most libraries handle this transparently, but it's why SH1106 displays can feel slightly slower to update than SSD1306.

## SSD1309 — The Bigger Sibling

The SSD1309 is essentially an SSD1306 scaled up for larger panels, commonly 2.42" at 128x64. It supports the same command set, so SSD1306 drivers often work with minimal modification. The main difference is the higher driving voltage needed for larger OLED panels. These bigger OLEDs are great for projects where readability at a distance matters, but they draw more current and cost more.

## SSD1327 — Grayscale

If monochrome isn't enough but full color is overkill, the SSD1327 offers 16-level grayscale at resolutions like 128x128. Each pixel is 4 bits, so the framebuffer is twice the size of an equivalent monochrome display. Grayscale is handy for smooth fonts, gradients, or displaying images with reasonable fidelity. The command set is different enough from the SSD1306 that you need a dedicated driver — don't expect SSD1306 libraries to work.

## Choosing a Controller

For most projects, the SSD1306 remains the default choice due to price, library support, and availability. Pick the SH1106 if you find a module you like that happens to use it (the 1.3" 128x64 modules are often SH1106). Go SSD1309 when you need a physically larger display. Consider the SSD1327 when grayscale rendering would genuinely improve your UI. The best advice is to check which controller your module actually uses before ordering libraries and writing code — the product listing doesn't always match reality.
