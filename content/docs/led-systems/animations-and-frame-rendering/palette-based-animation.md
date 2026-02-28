---
title: "Palette-Based Animation"
weight: 20
---

# Palette-Based Animation

Instead of storing full RGB values for every pixel in every animation, palette-based systems store a small set of colors (the palette) and reference those colors by index. This reduces memory consumption, simplifies color scheme changes, and enables smooth gradient effects with minimal computation. The technique is borrowed from 8-bit and 16-bit era graphics systems, where limited memory made full-color framebuffers impractical, and it maps naturally to the constraints of LED programming on microcontrollers.

## How Palettes Work

A palette is a lookup table of colors — typically 16 or 256 entries, each holding an RGB value. The framebuffer stores palette indices (1 byte per pixel) rather than full RGB values (3 bytes per pixel), reducing memory by 3×. At render time, each index is looked up in the palette to produce the output color.

```c
// 16-entry palette
CRGB palette[16] = {
    CRGB::Red, CRGB::OrangeRed, CRGB::Orange, CRGB::Yellow,
    CRGB::Green, CRGB::Cyan, CRGB::Blue, CRGB::Purple,
    // ... remaining entries
};

uint8_t pixel_indices[NUM_LEDS]; // 1 byte per LED instead of 3

// Render: look up each pixel's color from the palette
for (int i = 0; i < NUM_LEDS; i++) {
    leds[i] = palette[pixel_indices[i]];
}
```

Changing the palette instantly re-colors the entire animation without touching the framebuffer contents. A fire effect that uses palette indices 0–15 can transition from red-orange-yellow to blue-cyan-white simply by swapping the palette — the animation logic and index assignments remain unchanged.

## Gradient Palettes

FastLED's `CRGBPalette16` uses 16 anchor colors and linearly interpolates between them to produce a 256-entry gradient. This means a 16-entry palette definition can represent smooth, continuous color gradients. The index (0–255) maps to a position along the gradient, and the library handles the interpolation:

```c
CRGBPalette16 heatPalette = CRGBPalette16(
    CRGB::Black, CRGB::Red, CRGB::Yellow, CRGB::White
);

// Look up interpolated color at position 0-255
CRGB color = ColorFromPalette(heatPalette, index, brightness);
```

This is the foundation of many common LED effects: fire simulations, water ripples, aurora effects, and spatial gradients. The index can represent position along the strip, time, temperature, audio amplitude, or any other parameter that maps to a 0–255 range.

## Palette Cycling

One of the simplest and most visually effective animations is palette cycling: shifting the index offset over time so that the colors appear to move along the strip. Adding a time-based offset to each pixel's index creates a scrolling pattern:

```c
uint8_t offset = millis() / 10; // Scrolling speed
for (int i = 0; i < NUM_LEDS; i++) {
    uint8_t index = (i * 256 / NUM_LEDS) + offset; // Wraps naturally at 8-bit
    leds[i] = ColorFromPalette(palette, index);
}
```

The 8-bit integer overflow handles the wraparound automatically — when the offset reaches 256 it wraps to 0, creating a seamless loop. Varying the multiplier changes the spatial frequency (how many repetitions of the palette appear along the strip), and varying the time divisor controls the animation speed.

## Blending Between Palettes

Smooth transitions between palettes avoid jarring visual jumps when changing color schemes. The standard approach is linear interpolation (lerp) between two palettes over a transition period:

```c
// Blend two 16-entry palettes, fract8 is 0-255 (0=palette1, 255=palette2)
CRGBPalette16 blended;
for (int i = 0; i < 16; i++) {
    blended[i] = blend(palette1[i], palette2[i], fract8);
}
```

FastLED's `nblendPaletteTowardPalette()` provides an incremental version that blends one step per call, designed to be called once per frame for a gradual transition.

## Tips

- Use `CRGBPalette16` with gradient interpolation for smooth effects — 16 anchor points produce 256 effective colors with minimal memory
- Design palettes with the endpoints in mind — index 0 and index 255 should either be the same color (for seamless looping) or meaningful boundary colors (e.g., black at 0, white at 255 for intensity mapping)
- Store multiple palettes in PROGMEM on AVR to avoid consuming SRAM — palette data is read-only and benefits from flash storage
- Use palette cycling as a starting point for new effects — an enormous variety of visual patterns emerge from different palettes, spatial frequencies, and offset speeds

## Caveats

- **16-entry gradient palettes lose detail between anchor points** — If two adjacent anchor colors are very different, the interpolation between them may produce visible banding. Adding more anchor points (or using a 256-entry palette) improves the gradient smoothness
- **Palette index arithmetic must use 8-bit unsigned wrapping** — Using signed integers or wider types for palette indices breaks the natural modular arithmetic that makes cyclic animations seamless
- **Interpolation between distant colors can pass through unintended hues** — Blending from red (RGB 255,0,0) to blue (0,0,255) in RGB space passes through black (128,0,128 is purple, but 64,0,64 is very dark). Palette design must account for the interpolation path, not just the anchor colors
- **Runtime palette changes allocate no new memory** — But calculating interpolated palettes does consume CPU cycles per frame. On slow MCUs with many LEDs, the `ColorFromPalette` call in a tight loop can become the frame rate bottleneck

## In Practice

- A "fire" effect that looks flat or banded typically has too few palette entries in the critical orange-to-yellow range — adding intermediate anchor colors in that region smooths the gradient
- An animation that looks identical with different palettes loaded suggests the index assignment code is not using the full 0–255 range — if all indices cluster around a narrow band, only a small portion of the palette is visible
- A palette cycle animation that "jumps" periodically instead of scrolling smoothly is likely using an integer type wider than 8 bits for the offset, causing the modular wraparound to happen at 65536 instead of 256
- Transitions between palettes that flash or flicker during the blend period usually indicate the blend factor is being recalculated inconsistently between frames — using a monotonically increasing blend factor tied to elapsed time produces smooth transitions
