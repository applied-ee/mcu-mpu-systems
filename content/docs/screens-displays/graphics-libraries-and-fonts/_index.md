---
title: "Graphics Libraries & Fonts"
weight: 50
bookCollapseSection: true
---

# Graphics Libraries & Fonts

The software layer between your application logic and the display hardware. Graphics libraries handle the pixel math, font rendering, and drawing operations that turn data into something visible on screen. The choice of library shapes your API, determines what displays you can support, and sets the floor for RAM and flash usage. Font rendering is its own sub-problem — bitmap vs anti-aliased, memory budgets for character sets, and the conversion tools that bridge desktop fonts to embedded formats.

## What This Section Covers

- **[Graphics Library Landscape]({{< relref "graphics-library-landscape" >}})** — LVGL, U8g2, Adafruit GFX, TFT_eSPI, and LovyanGFX compared: what each does well, resource requirements, and when to pick which.
- **[Font Rendering on Embedded Displays]({{< relref "font-rendering" >}})** — Bitmap fonts vs anti-aliased, conversion tools, proportional vs monospace, and the memory budget that grows faster than you'd expect.
- **[Drawing Primitives & Sprites]({{< relref "drawing-primitives" >}})** — Lines, rectangles, circles, bitmap sprites, transparency approaches, and Z-ordering: the building blocks of embedded UIs.
