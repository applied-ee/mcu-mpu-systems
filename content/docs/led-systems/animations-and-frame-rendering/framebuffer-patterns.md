---
title: "Framebuffer Patterns for LED Strips"
weight: 10
---

# Framebuffer Patterns for LED Strips

An LED strip is a one-dimensional display — a linear array of pixels that gets rewritten every frame. The framebuffer is the in-memory representation of the current pixel state, and how it's structured determines the flexibility, performance, and memory cost of the animation system. On a resource-constrained microcontroller, the framebuffer pattern choice directly impacts how many LEDs can be driven and how complex the animations can be.

## The Basic Framebuffer

The simplest framebuffer is a flat array of RGB (or RGBW) values, one entry per LED:

```c
#define NUM_LEDS 300
uint8_t framebuffer[NUM_LEDS * 3]; // RGB, 3 bytes per LED
```

For 300 WS2812B LEDs, this consumes 900 bytes. For RGBW strips, it's 1200 bytes. On an ATmega328P with 2KB of SRAM, 300 RGB LEDs consume nearly half the available memory. On an ESP32 with 520KB of SRAM, memory is not a meaningful constraint even for thousands of LEDs.

The animation loop reads and modifies this buffer, then a driver function serializes it to the strip's protocol (WS2812B timing, SPI for APA102, etc.). Separating the framebuffer from the transmission function is the fundamental architectural pattern — it allows animation code to treat LEDs as an abstract array of colors, independent of the underlying protocol.

## Double Buffering

With a single framebuffer, an animation that modifies pixels in-place risks tearing: if the transmission function reads the buffer while the animation is halfway through updating it, the strip displays a mix of old and new frame data. Double buffering solves this by maintaining two framebuffers — one being displayed (the front buffer) and one being written to (the back buffer). When a frame is complete, the buffers swap (typically by swapping pointers, not copying data).

```c
uint8_t buffer_a[NUM_LEDS * 3];
uint8_t buffer_b[NUM_LEDS * 3];
uint8_t *front = buffer_a;
uint8_t *back = buffer_b;

// After animation completes a frame:
uint8_t *temp = front;
front = back;
back = temp;
```

The cost is double the memory — 1800 bytes for 300 RGB LEDs. On memory-constrained AVR targets, this can be prohibitive. On ARM or ESP32, it's negligible. For DMA-driven transmission (where the DMA reads from the buffer while the CPU writes the next frame), double buffering is practically mandatory.

## Virtual Framebuffers and Mapping

Physical LED layouts rarely match their logical arrangement. A serpentine-routed LED matrix, a ring, or an irregularly shaped installation has a physical wiring order that differs from the logical coordinate system the animation uses. A mapping table translates between logical coordinates and physical buffer indices:

```c
// Serpentine 16x16 matrix: even rows left-to-right, odd rows right-to-left
uint16_t xy_to_index(uint8_t x, uint8_t y) {
    if (y % 2 == 0) return y * 16 + x;
    else return y * 16 + (15 - x);
}
```

This indirection allows animation code to work in (x, y) coordinates while the framebuffer stores data in the strip's physical wiring order. FastLED's `XYMap` and similar utilities provide this mapping for common matrix layouts.

## Layered Compositing

More complex animation systems use multiple virtual framebuffers (layers) that are composited into a single output buffer. Each layer might contain a different effect — a background gradient, a foreground sparkle, a notification flash — and the compositing step blends them using alpha values, additive mixing, or other blend modes:

```c
// Additive blend: add layer colors, clamping to 255
output[i].r = min(255, layer1[i].r + layer2[i].r);
output[i].g = min(255, layer1[i].g + layer2[i].g);
output[i].b = min(255, layer1[i].b + layer2[i].b);
```

This pattern separates animation concerns — each layer is independent and can be modified or enabled/disabled without affecting the others. The memory cost is proportional to the number of layers, but the architectural flexibility is substantial.

## Tips

- Keep the framebuffer as a flat array of bytes for the target protocol — avoid object-per-pixel patterns that add memory overhead and cache inefficiency on small MCUs
- Use double buffering whenever DMA is used for strip transmission — modifying the buffer during DMA transfer produces tearing or corrupted data
- Build a coordinate mapping function early if the physical layout is non-trivial — retrofitting mapping into animation code that assumed linear addressing is painful
- Use `memset()` or `memcpy()` for bulk framebuffer operations (clear, copy) — byte-level loops are significantly slower on most MCU architectures

## Caveats

- **Double buffering doubles memory usage** — On an ATmega328P, 300 RGBW LEDs double-buffered requires 2400 bytes, exceeding the available SRAM. Single-buffering with careful timing is the only option on very constrained platforms
- **Layer compositing is computationally expensive** — Blending multiple layers per pixel per frame adds up quickly. At 300 LEDs × 3 layers × 60fps, that's 54,000 blend operations per second. Feasible on ARM but potentially too heavy for 8-bit AVR at high frame rates
- **Framebuffer alignment matters for DMA** — Some DMA controllers require the source buffer to be word-aligned (4-byte boundary). Declaring the buffer with alignment attributes or as a `uint32_t` array cast to `uint8_t*` avoids hard-to-debug DMA failures
- **Pointer-swap double buffering requires careful synchronization** — Swapping the front/back pointers while a DMA transfer is in progress corrupts the current frame. The swap must occur in the DMA-complete callback, not in the animation loop

## In Practice

- Occasional single-frame glitches that show half-old, half-new data are tearing artifacts from modifying a single buffer during transmission — double buffering eliminates the symptom entirely
- An animation that works perfectly at 100 LEDs but crashes or produces garbage at 300 LEDs on an AVR is likely running out of SRAM — the framebuffer plus stack plus other variables exceeds the 2KB limit
- A serpentine LED matrix that displays correct colors but with every other row reversed has a missing or incorrect coordinate mapping — the physical wiring reverses direction on alternate rows but the animation code assumes linear addressing
- An animation system that runs at target frame rate with one effect but drops frames when compositing multiple layers is compute-bound on the blend step — reducing layers, lowering frame rate, or moving to a faster MCU resolves the bottleneck
