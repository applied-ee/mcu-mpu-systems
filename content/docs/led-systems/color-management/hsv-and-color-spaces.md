---
title: "HSV & Color Spaces"
weight: 20
---

# HSV & Color Spaces

RGB is the native language of addressable LEDs — each pixel takes a red, green, and blue value — but it's a terrible color space for humans to think in. Asking "what RGB values make a slightly warmer orange at half brightness?" is unintuitive. HSV (Hue, Saturation, Value) separates color identity from brightness and saturation, making it the natural choice for LED animation and color design. Understanding the mapping between color spaces — and the tradeoffs of each — is fundamental to producing predictable LED output.

## RGB: The Hardware Color Space

Every addressable LED ultimately receives red, green, and blue intensity values, typically 8 bits per channel (0–255). RGB is an additive color model: (255, 0, 0) is pure red, (0, 255, 0) is pure green, (255, 255, 0) is yellow (red + green), and (255, 255, 255) is white (all channels full). This maps directly to hardware but makes common operations awkward — cycling through a rainbow, dimming a color without shifting its hue, or interpolating between two colors all require manipulating all three channels simultaneously.

## HSV: The Animation Color Space

HSV represents color as three independent axes:

- **Hue (H)**: The color identity, mapped to a 0–360° wheel (or 0–255 in 8-bit implementations). Red is at 0°, green at 120°, blue at 240°, and it wraps back to red at 360°.
- **Saturation (S)**: How vivid the color is. 100% is fully saturated (pure color); 0% is white/gray.
- **Value (V)**: Brightness. 100% is full brightness; 0% is black.

This decomposition makes common LED operations trivial: cycling through a rainbow means incrementing H while holding S and V constant. Dimming means reducing V without touching H or S. Desaturating (making a color more pastel) means reducing S. These operations require single-axis changes in HSV but complex three-axis math in RGB.

## HSV-to-RGB Conversion

The conversion from HSV to RGB is a piecewise function that maps the hue wheel into six 60° sectors, each blending between two primary colors. The standard algorithm:

```c
// H: 0-359, S: 0-255, V: 0-255
uint8_t region = h / 60;
uint8_t remainder = (h - (region * 60)) * 255 / 60;
uint8_t p = (v * (255 - s)) >> 8;
uint8_t q = (v * (255 - ((s * remainder) >> 8))) >> 8;
uint8_t t = (v * (255 - ((s * (255 - remainder)) >> 8))) >> 8;
```

This runs fast on microcontrollers — no floating point needed. FastLED's `CHSV` type and its `hsv2rgb_rainbow()` function implement an optimized version that's tuned for LED output (with a more perceptually uniform hue distribution than the mathematical HSV model).

## HSL vs HSV

HSL (Hue, Saturation, Lightness) is a related model where L=0 is black, L=50% is the pure color, and L=100% is white. HSV's V=100% is the pure color at full brightness, and there's no way to reach white without also increasing saturation. For LED work, HSV is almost universally preferred because V maps directly to the concept of "LED brightness" — reducing V dims the LED, which is the most common operation. HSL's lightness axis, where the pure color sits at the midpoint, adds unnecessary complexity for LED applications.

## Perceptual Uniformity

Neither RGB nor HSV is perceptually uniform — equal numeric steps don't produce equal perceived differences. The hue wheel is particularly uneven: the green region (roughly 60°–180°) appears to span a much wider perceptual range than the blue-to-magenta region. FastLED addresses this with its `hsv2rgb_rainbow()` function, which redistributes the hue wheel to produce more visually uniform rainbow transitions. For applications where color precision matters, the CIELAB (L\*a\*b\*) color space is truly perceptually uniform, but its computational cost makes it impractical for real-time LED work on most microcontrollers.

## Tips

- Use HSV for all color selection, animation design, and user-facing controls — convert to RGB only at the point of output to the LEDs
- Use FastLED's `hsv2rgb_rainbow()` instead of the standard mathematical HSV conversion for visually smoother rainbow effects
- When fading between two colors, interpolate in HSV rather than RGB to avoid the muddy intermediate colors that RGB interpolation produces (e.g., red-to-blue through RGB passes through dark gray; through HSV it passes through magenta)
- Store animation parameters in HSV to make brightness and color independently adjustable at runtime

## Caveats

- **8-bit hue has only 256 steps for the full color wheel** — This is 0.7° per step in the 0–180 range common in some implementations. For slow rainbow rotations, the stepping can be visible. Using 16-bit hue internally with 8-bit output dithering improves smoothness
- **HSV white is not the same as "good" white** — HSV with S=0 produces equal RGB values, which looks cool-blue on most LED strips. Warm or neutral white requires either color temperature compensation or RGBW LEDs with a dedicated white channel
- **HSV interpolation can take the "long way" around the hue wheel** — Interpolating from H=10 (red-orange) to H=350 (red-pink) through HSV goes through green, cyan, and blue unless the shorter path is explicitly selected
- **Gamma correction interacts with color space conversion** — Gamma should be applied after HSV-to-RGB conversion, in the RGB domain, right before output. Applying gamma to HSV values produces incorrect results

## In Practice

- A rainbow animation that appears to "stall" on green and rush through blue is showing the perceptual non-uniformity of the mathematical HSV hue wheel — switching to FastLED's rainbow HSV corrects the distribution
- Color fades that pass through unexpected muddy or dark intermediate values are likely being interpolated in RGB — switching to HSV interpolation produces cleaner transitions
- A white produced by setting S=0 in HSV that looks blue-ish compared to an incandescent bulb is a color temperature issue, not a bug — the LED strip's white point is cooler than expected
- Dimming a color by reducing V in HSV and noticing a slight hue shift suggests the RGB-to-LED transfer is not purely linear — either gamma correction is misapplied or the LED's color channels have different brightness-to-current curves
