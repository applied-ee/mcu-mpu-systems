---
title: "Animations & Frame Rendering"
weight: 50
bookCollapseSection: true
---

# Animations & Frame Rendering

An LED strip is a display, and driving it requires the same frame-by-frame rendering approach used in any graphics system — compute pixel values, write them to a buffer, send the buffer to the hardware, repeat. The difference is that LED strips are one-dimensional, memory is tight, and the microcontroller doing the rendering may also be handling sensors, communication, and user input. The animation architecture must fit within these constraints while producing smooth, visually appealing output.

This section covers the firmware patterns that turn static LED arrays into dynamic displays: framebuffer management, palette-based color systems, and the timing architecture that keeps everything running at a consistent frame rate without starving other tasks.

## What This Section Covers

- **[Framebuffer Patterns for LED Strips]({{< relref "framebuffer-patterns" >}})** — In-memory pixel representation: flat arrays, double buffering, coordinate mapping for matrices, and layered compositing for multi-effect animation systems.
- **[Palette-Based Animation]({{< relref "palette-based-animation" >}})** — Color lookup tables for memory-efficient effects: gradient palettes, palette cycling, and smooth transitions between color schemes.
- **[Timing & Frame Rate]({{< relref "timing-and-frame-rate" >}})** — Maintaining consistent animation speed: frame time budgets, DMA-driven transmission pipelines, delta-time updates, and the tradeoffs between fixed and variable frame rates.
