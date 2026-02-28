---
title: "Framebuffer Strategies for Small OLEDs"
weight: 30
---

# Framebuffer Strategies for Small OLEDs

On a desktop, you don't think twice about allocating a framebuffer — but on a microcontroller with 2-20KB of RAM, a 1024-byte buffer for a 128x64 monochrome display is a meaningful chunk of your total memory. For larger or grayscale displays, the buffer grows fast. How you manage drawing and flushing pixels to the display has real implications for both RAM usage and update speed.

## Full Framebuffer

The simplest approach: allocate a buffer in RAM that mirrors the entire display contents. Draw everything into the buffer using your graphics library, then flush the whole thing to the display in one transfer. For a 128x64 monochrome OLED, that's 1024 bytes — very manageable on most modern MCUs. The advantage is simplicity: you can draw pixels in any order, layer text over graphics, and the library handles all the pixel math in RAM before anything touches the bus.

The full-buffer flush for an SSD1306 over I²C at 400kHz takes roughly 20-25ms, which gives you about 40-50fps theoretical maximum. Over SPI at a few MHz, you can push well past 100fps. In practice, the drawing operations themselves take time too, but the point is that for 128x64 monochrome, the full framebuffer approach works well.

## Page-at-a-Time

When RAM is tight, you can render and send one page (one horizontal strip of 8 pixel rows) at a time. Instead of a 1024-byte buffer, you only need 128 bytes. The downside is that each page must be fully composed before sending — you can't easily draw a diagonal line that spans multiple pages in a single pass. Libraries like U8g2 support this "page buffer" mode, where your drawing callback gets called once per page and you re-execute your drawing commands each time, with the library clipping to the current page. It works, but it means your drawing code runs 8 times (for 8 pages on a 128x64 display), which can be noticeable if your drawing logic is complex.

## Dirty-Rectangle Tracking

A middle-ground approach: keep a full framebuffer but track which regions have changed since the last flush. Only send the modified pages (or columns) to the display. This saves bus time when only part of the screen changes — like updating a single number on an otherwise static layout. The bookkeeping is simple: maintain a "dirty" flag per page, or for finer granularity, track a bounding rectangle. After flushing, clear the dirty flags. This is especially valuable over I²C, where bus time is the bottleneck.

## Double Buffering

If you want tear-free updates — where the display never shows a partially-drawn frame — you can maintain two framebuffers and swap between them. Draw into the back buffer, then swap it to become the active buffer and flush. This doubles your RAM usage (2KB for a 128x64 display), which is only practical on MCUs with enough headroom. It's rarely necessary for small OLEDs since the flush is fast enough that tearing is seldom visible, but for animations or fast-updating UIs it can make a visual difference.

## Tips

- For 128x64 SSD1306, just use a full framebuffer — the 1KB cost is almost always worth the simplicity
- Use dirty-rectangle tracking when you have a mostly-static layout with a few changing elements (e.g., a sensor reading updating on an otherwise fixed screen)
- In U8g2, the page buffer mode (128 bytes instead of 1024) is the go-to for ATtiny and similarly constrained platforms

## Caveats

- **Page mode re-executes your drawing code N times** — For a 128x64 display with 8 pages, your draw callback runs 8 times per frame. If drawing logic is complex (lots of string formatting, math), this overhead adds up
- **Dirty-rectangle tracking adds bookkeeping** — You need to maintain and clear dirty flags in sync with your draw/flush cycle. Bugs here produce stale regions that don't update or unnecessary full redraws
- **Double buffering doubles RAM cost** — 2KB for a 128x64 monochrome display, which may be significant on small MCUs. Only reach for this when visible tearing is an actual problem

## In Practice

- Flickering on a full-framebuffer setup usually means the framebuffer is being flushed while still being drawn into — either flush after all drawing is complete, or use double buffering
- A page-mode display that looks correct but updates slowly suggests the drawing callback is doing expensive work that gets repeated per page — move invariant calculations outside the draw loop
- Regions of the screen that appear "stuck" with stale content often indicate the dirty-rectangle tracking isn't marking those regions for refresh
