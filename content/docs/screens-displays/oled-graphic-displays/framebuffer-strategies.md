---
title: "Framebuffer Strategies for Small OLEDs"
weight: 30
---

# Framebuffer Strategies for Small OLEDs

On a desktop, allocating a framebuffer is trivial — but on a microcontroller with 2-20KB of RAM, a 1024-byte buffer for a 128x64 monochrome display is a meaningful chunk of total memory. For larger or grayscale displays, the buffer grows fast. How drawing and flushing and flushing pixels to the display has real implications for both RAM usage and update speed.

## Full Framebuffer

The simplest approach: allocate a buffer in RAM that mirrors the entire display contents. Draw everything into the buffer using the graphics library, then flush the whole thing to the display in one transfer. For a 128x64 monochrome OLED, that's 1024 bytes — very manageable on most modern MCUs. The advantage is simplicity: pixels can be drawn in any order, text layered over graphics, and the library handles all the pixel math in RAM before anything touches the bus.

The full-buffer flush for an SSD1306 over I²C at 400kHz takes roughly 20-25ms, which gives roughly 40-50fps theoretical maximum. Over SPI at a few MHz, well past 100fps is achievable. In practice, the drawing operations themselves take time too, but the point is that for 128x64 monochrome, the full framebuffer approach works well.

## Page-at-a-Time

When RAM is tight, rendering and sending one page (one horizontal strip of 8 pixel rows) at a time. Instead of a 1024-byte buffer, only 128 bytes are needed. The downside is that each page must be fully composed before sending — drawing a diagonal line that spans multiple pages in a single pass isn't straightforward. Libraries like U8g2 support this "page buffer" mode, where the drawing callback gets called once per page and the drawing commands re-execute each time, with the library clipping to the current page. It works, but it means the drawing code runs 8 times (for 8 pages on a 128x64 display), which can be noticeable if the drawing logic is complex.

## Dirty-Rectangle Tracking

A middle-ground approach: keep a full framebuffer but track which regions have changed since the last flush. Only the modified pages (or columns) get sent to the display. This saves bus time when only part of the screen changes — like updating a single number on an otherwise static layout. The bookkeeping is simple: maintain a "dirty" flag per page, or for finer granularity, track a bounding rectangle. After flushing, clear the dirty flags. This is especially valuable over I²C, where bus time is the bottleneck.

## Double Buffering

For tear-free updates — where the display never shows a partially-drawn frame — two framebuffers are maintained and swapped between. Draw into the back buffer, then swap it to become the active buffer and flush. This doubles the RAM usage (2KB for a 128x64 display), which is only practical on MCUs with enough headroom. It's rarely necessary for small OLEDs since the flush is fast enough that tearing is seldom visible, but for animations or fast-updating UIs it can make a visual difference.

## Tips

- For 128x64 SSD1306, just use a full framebuffer — the 1KB cost is almost always worth the simplicity
- Use dirty-rectangle tracking for a mostly-static layout with a few changing elements (e.g., a sensor reading updating on an otherwise fixed screen)
- In U8g2, the page buffer mode (128 bytes instead of 1024) is the go-to for ATtiny and similarly constrained platforms

## Caveats

- **Page mode re-executes the drawing code N times** — For a 128x64 display with 8 pages, the draw callback runs 8 times per frame. If drawing logic is complex (lots of string formatting, math), this overhead adds up
- **Dirty-rectangle tracking adds bookkeeping** — Dirty flags must be maintained and cleared in sync with the draw/flush cycle. Bugs here produce stale regions that don't update or unnecessary full redraws
- **Double buffering doubles RAM cost** — 2KB for a 128x64 monochrome display, which may be significant on small MCUs. Only reach for this when visible tearing is an actual problem

## In Practice

- Flickering on a full-framebuffer setup usually means the framebuffer is being flushed while still being drawn into — either flush after all drawing is complete, or use double buffering
- A page-mode display that looks correct but updates slowly suggests the drawing callback is doing expensive work that gets repeated per page — move invariant calculations outside the draw loop
- Regions of the screen that appear "stuck" with stale content often indicate the dirty-rectangle tracking isn't marking those regions for refresh
