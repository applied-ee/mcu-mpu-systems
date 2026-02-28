---
title: "Character LCDs"
weight: 10
bookCollapseSection: true
---

# Character LCDs

The original embedded display. Character LCDs based on the HD44780 controller have been the default "show some text" solution since the 1980s, and they're still everywhere — cheap, well-understood, and supported by every platform. The parallel interface is straightforward but pin-hungry, which is why I²C backpack modules have become the standard way to wire them up.

These displays are limited to fixed character grids (16x2 and 20x4 being the most common), but that constraint is also a simplicity advantage: no framebuffers, no pixel math, just send ASCII characters and they appear on screen.

## What This Section Covers

- **[HD44780 & Compatible Controllers]({{< relref "hd44780-and-compatible" >}})** — The ubiquitous parallel-interface character LCD: pin mapping, 4-bit vs 8-bit mode, initialization sequence, contrast adjustment, and the DDRAM addressing quirks of 20x4 displays.
- **[I²C Backpack Modules]({{< relref "i2c-backpacks" >}})** — PCF8574-based backpacks that reduce a 16-pin parallel interface to 4-wire I²C: address selection, pin mapping mismatches, and the library landscape across platforms.
- **[Custom Characters & CGRAM]({{< relref "custom-characters" >}})** — Defining custom 5x8 pixel glyphs in the HD44780's 8-slot CGRAM: progress bars, battery icons, animations, and the global-slot limitation.
