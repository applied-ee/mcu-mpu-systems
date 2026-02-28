---
title: "Gamma Correction"
weight: 10
---

# Gamma Correction

Human vision perceives brightness logarithmically, but LEDs emit light linearly with PWM duty cycle. Without gamma correction, a fade from 0 to 255 looks like it jumps to "almost full brightness" in the first quarter and then barely changes for the remaining three-quarters. Applying a gamma curve transforms linear PWM values into perceptually uniform brightness steps — making a value of 128 actually look like "half brightness" to the eye.

## The Perception Problem

Setting a WS2812B to RGB(128, 128, 128) — nominally 50% — produces a pixel that looks about 73% as bright as full white to a human observer. This is because the eye's response to luminance roughly follows a power law: perceived brightness ≈ (actual luminance)^(1/γ), where γ is typically around 2.2 for most display contexts. To get perceived 50% brightness, the PWM value needs to be around 56 (out of 255), not 128.

This mismatch affects every brightness-dependent operation: fades look non-linear, color mixing produces unexpected hues at intermediate values, and dim-to-bright transitions have a visible "jump" at the low end followed by imperceptible changes at the high end.

## Applying the Correction

The standard approach is a lookup table (LUT) that maps linear input values (0–255) to gamma-corrected output values. The correction formula for each value is:

```
output = 255 × (input / 255)^γ
```

With γ = 2.8 (a common value for LEDs, slightly higher than the 2.2 used for monitors because LED phosphor response differs):

| Input | Output (γ=2.8) | Perceived effect |
|---|---|---|
| 0 | 0 | Off |
| 1 | 0 | Still off — lost step |
| 2 | 0 | Still off — lost step |
| 8 | 0 | First visible output on many LEDs |
| 32 | 2 | Barely visible |
| 64 | 13 | Dim |
| 128 | 69 | Perceptual midpoint |
| 192 | 159 | Bright |
| 255 | 255 | Full brightness |

The LUT is typically precomputed as a 256-byte array and applied to each color channel independently before sending data to the LEDs.

## Resolution Loss at Low Brightness

Gamma correction compresses the low end of the range, which means many input values map to the same output value — or to zero. With γ=2.8 on an 8-bit scale, the first 6–8 input values all map to 0, and the next several map to 1 or 2. This creates visible stepping in dim fades: instead of a smooth transition from off to dim, the LED jumps from off to the first visible level with no intermediate steps.

The only real solution is higher output resolution. Using 16-bit internal calculations with dithering, or driving LEDs with higher-resolution PWM (the APA102's global brightness provides an additional 5 bits), significantly improves low-brightness smoothness. FastLED and similar libraries use temporal dithering — alternating between adjacent brightness levels across frames — to simulate sub-step resolution on 8-bit hardware.

## Choosing a Gamma Value

The "correct" gamma depends on the LEDs, the viewing environment, and personal preference:

- **γ = 2.0**: Mild correction, preserves more low-end resolution but fades still look slightly non-linear
- **γ = 2.2**: Standard display gamma, a reasonable starting point
- **γ = 2.8**: Common for LED strips, produces perceptually smooth fades for most RGB LEDs
- **γ = 3.0+**: Aggressive correction, useful for high-brightness outdoor installations where the eye adapts to bright ambient light

Viewing the LED output in a dark room versus a lit room changes the perception significantly. A gamma value that looks perfect in a dim workshop may look too dark in a well-lit living room.

## Tips

- Apply gamma correction as the last step before sending data to the LEDs — all animation math and color blending should happen in linear space
- Use a precomputed 256-byte LUT per channel rather than runtime power calculations — the lookup is a single array access versus a floating-point exponentiation
- Start with γ=2.8 for RGB LED strips and adjust by eye — the "correct" value is the one that makes fades look smooth in the actual installation environment
- Consider temporal dithering for low-brightness applications — libraries like FastLED implement this automatically and it significantly improves perceived smoothness below 10% brightness

## Caveats

- **Gamma correction destroys low-end resolution** — With 8-bit output, the first several input steps are all zero after correction. Applications that spend most of their time at low brightness need higher-resolution PWM or dithering to compensate
- **Different LED colors may need different gamma values** — Red, green, and blue phosphors have slightly different brightness-to-current relationships. Per-channel gamma tables improve accuracy but add complexity
- **Gamma-corrected and uncorrected code don't mix well** — If an animation library applies gamma but a separate white-balance adjustment doesn't (or vice versa), the interaction produces unexpected color shifts. The correction must be applied consistently and exactly once
- **Some LED libraries apply gamma internally** — FastLED's `setBrightness()` is gamma-aware in some modes. Applying an additional external gamma correction on top of a library's internal correction double-corrects, making everything too dark at low levels

## In Practice

- A fade from off to full brightness that appears to "jump" quickly to near-full and then barely change indicates missing gamma correction — the linear PWM values don't match the eye's logarithmic response
- A smooth fade that looks good at medium brightness but shows visible stepping below 10% suggests the gamma correction is working but 8-bit resolution is insufficient at the low end — temporal dithering or higher-resolution output helps
- Colors that look correct at full brightness but appear shifted at partial brightness (e.g., a pink that turns reddish when dimmed) may have gamma correction applied to only some channels or with mismatched per-channel gamma values
- An animation that looks perfect in a dim room but washed-out in daylight may benefit from a higher gamma value — ambient light adaptation shifts the eye's brightness response
