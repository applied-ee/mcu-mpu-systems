---
title: "SH1106 & Other Controllers"
weight: 20
---

# SH1106 & Other Controllers

The SSD1306 gets all the attention, but it's not the only OLED controller out there. The SH1106 is probably the second most common, and there are a handful of others worth knowing about — especially beyond the 128x64 monochrome sweet spot. Understanding the differences matters because using the wrong driver for a controller produces garbled output or nothing at all, and the modules often look physically identical.

## SH1106 — The Column Offset Catch

The SH1106 is extremely similar to the SSD1306 in capability, but has one critical difference: it has 132 columns of internal RAM instead of 128. Since the display panel is still 128 pixels wide, the visible area starts at column 2 (offset of 2). Using an SSD1306 driver on an SH1106 display shifts the image left by 2 pixels with a garbage strip on the right edge. The fix is simple — add a 2-pixel column offset when setting the display start address — but diagnosing it the first time is confusing.

The SH1106 also lacks the horizontal scrolling hardware and continuous horizontal addressing mode that the SSD1306 has. This means streaming a full framebuffer to the display in one shot the same way isn't possible; the page and column address must be set for each page individually. Most libraries handle this transparently, but it's why SH1106 displays can feel slightly slower to update than SSD1306.

## SSD1309 — The Bigger Sibling

The SSD1309 is essentially an SSD1306 scaled up for larger panels, commonly 2.42" at 128x64. It supports the same command set, so SSD1306 drivers often work with minimal modification. The main difference is the higher driving voltage needed for larger OLED panels. These bigger OLEDs are great for projects where readability at a distance matters, but they draw more current and cost more.

## SSD1327 — Grayscale

If monochrome isn't enough but full color is overkill, the SSD1327 offers 16-level grayscale at resolutions like 128x128. Each pixel is 4 bits, so the framebuffer is twice the size of an equivalent monochrome display. Grayscale is handy for smooth fonts, gradients, or displaying images with reasonable fidelity. The command set is different enough from the SSD1306 that a dedicated driver is required — SSD1306 libraries will not work.

## Tips

- Always verify which controller the module uses before writing code — product listings frequently misidentify SH1106 as SSD1306
- When evaluating a new controller, check whether the preferred graphics library has explicit support before committing
- The 1.3" 128x64 modules are very often SH1106 despite being sold as "SSD1306 OLED" — if one of these misbehaves with an SSD1306 driver, try an SH1106 driver first

## Caveats

- **SH1106 needs a 2-pixel column offset** — Using an SSD1306 driver on an SH1106 display shifts the image left by 2 pixels with a garbage strip on the right edge. The fix is a column offset, but diagnosing this the first time is confusing
- **SH1106 lacks continuous horizontal addressing** — Streaming a full framebuffer in one shot like the SSD1306 isn't possible. Each page needs its own address setup, which makes SH1106 updates slightly slower
- **SSD1327 grayscale uses a different command set** — SSD1306 libraries won't work. The framebuffer is also twice the size (4 bits per pixel), so memory requirements double

## In Practice

- An image shifted by exactly 2 pixels with a vertical garbage strip on one edge is the classic sign of an SH1106 being driven as an SSD1306
- A module that works perfectly with one library but produces nothing with another may be an SH1106/SSD1306 mismatch — the libraries may default to different controllers
- Grayscale displays that show only black and white despite using an SSD1327 driver typically need the grayscale lookup table configured — check the contrast and gamma settings
