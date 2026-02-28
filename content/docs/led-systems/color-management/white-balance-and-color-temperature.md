---
title: "White Balance & Color Temperature"
weight: 30
---

# White Balance & Color Temperature

Driving an RGB LED at (255, 255, 255) rarely produces what the eye perceives as "white." Most WS2812B strips produce a distinctly cool, bluish white because the blue die is typically the most efficient and the green-to-red phosphor balance varies by manufacturer. Achieving a consistent, pleasing white — or matching a specific color temperature — requires per-channel scaling that compensates for the LED's spectral characteristics.

## Color Temperature Basics

Color temperature is measured in Kelvin (K) and describes the warmth or coolness of white light. Standard reference points:

- **2700K**: Warm white (incandescent bulb)
- **3000K**: Soft white (halogen)
- **4000K**: Neutral white (bright office)
- **5000K**: Daylight
- **6500K**: Cool daylight (overcast sky, typical monitor white)

An uncompensated WS2812B strip typically produces white in the 7000–9000K range — noticeably cooler than any common indoor light source. This is why LED strip "white" looks harsh and clinical compared to traditional lighting.

## Per-Channel Correction

To shift the white point warmer, the blue channel is reduced and optionally the green channel is slightly reduced relative to red. A simple correction applies scaling factors to each channel:

```c
// Warm white correction (~3000K target)
#define R_SCALE 255
#define G_SCALE 176
#define B_SCALE 100

uint8_t corrected_r = (r * R_SCALE) >> 8;
uint8_t corrected_g = (g * G_SCALE) >> 8;
uint8_t corrected_b = (b * B_SCALE) >> 8;
```

These scaling factors are empirical — they depend on the specific LED strip's spectral characteristics and should be tuned by eye (or with a colorimeter) against a reference white source. FastLED provides built-in color temperature presets (`Candle`, `Tungsten40W`, `Halogen`, `CarbonArc`, etc.) that apply similar per-channel corrections.

## RGBW and Dedicated White

RGBW strips (like the SK6812 RGBW) include a dedicated white LED die alongside the RGB dies. This white die produces a more spectrally complete white than any RGB mix — it's fundamentally a different emitter, typically binned at 4000–5000K. Using the white channel for white output and the RGB channels for color produces both better white quality and higher energy efficiency (one white die uses less power than three RGB dies at the same luminance).

The firmware challenge with RGBW is decomposing an RGB color into RGBW: determining how much of the color can be produced by the white channel and how much requires the RGB channels. A common approach extracts the minimum of R, G, B as the white component and subtracts it from each color channel. More sophisticated algorithms weight the extraction by the white die's actual color temperature to avoid color shifts.

## Batch-to-Batch Variation

No two LED strip batches produce exactly the same white point. The phosphor coating thickness, die binning, and forward voltage distribution all vary between manufacturing runs. Two "WS2812B" strips from the same supplier, ordered months apart, may have noticeably different white points when placed side by side. For installations where color consistency matters, purchasing all strips from the same batch (same reel if possible) is the most reliable approach. When mixing batches is unavoidable, per-strip white balance correction in firmware provides compensation.

## Tips

- Calibrate white balance under the actual installation lighting conditions — a correction that looks perfect in a dark workshop may look too warm or too cool in the destination environment
- Use FastLED's built-in color temperature constants as starting points, then fine-tune by eye to match the specific strip and environment
- For RGBW strips, use the white channel for any white or near-white output rather than mixing RGB — the color rendering and efficiency are both substantially better
- Buy all LED strips for a visible installation from the same batch to minimize white point variation between strips

## Caveats

- **White balance correction reduces maximum brightness** — Scaling down the blue channel to warm the white point means the corrected white is dimmer than the uncorrected full-drive white. Budget for 20–40% brightness reduction when targeting warm white from RGB strips
- **Correction factors are not universal** — Every LED strip model and batch has different spectral characteristics. Published correction values from libraries or online references are starting points, not final values
- **White balance and gamma correction interact** — Both are per-channel transforms applied to the output. The order matters: color temperature correction should be applied before gamma correction in the processing chain, since gamma operates on the final linear intensity values
- **Ambient light affects perceived white point** — The same LED strip that matches a 3000K bulb in a warm-lit room will look yellowish in a daylight-lit room. There is no single "correct" white balance — it's always relative to the viewing environment

## In Practice

- An LED strip that looks "fine" during daytime testing but appears harshly blue at night is showing its native (uncorrected) color temperature — the eye adapts to ambient light, and at night there's no warm reference to shift perception
- Two strips from different batches that display the same RGB values but show a visible color difference where they meet need per-strip white balance correction — even a 5% difference in the blue channel is visible in a side-by-side comparison
- A white that looks correct at full brightness but shifts color when dimmed suggests the gamma correction is not applied uniformly across channels — at low brightness, even small per-channel differences become visible
- An RGBW strip that produces better white from the W channel alone than from full RGB confirms the advantage of the dedicated white die — mixing in RGB to "boost" the white just shifts the color and wastes power
