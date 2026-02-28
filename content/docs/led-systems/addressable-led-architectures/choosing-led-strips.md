---
title: "Choosing an LED Strip"
weight: 30
---

# Choosing an LED Strip

Picking the right addressable LED strip means balancing pixel density, color capability, protocol complexity, power requirements, and budget. The decision isn't just about which chip is "best" — it's about which constraints matter most for a given project. A POV display has different needs than a room ambient light, and a battery-powered wearable has different needs than a permanent architectural installation.

## LED Density and Package Size

Addressable strips come in standard densities: 30, 60, 96, 144, and occasionally 200 LEDs per meter. Higher density means smoother color gradients and fewer visible gaps between pixels, but also higher power draw per meter and higher data throughput requirements. A 144 LED/m WS2812B strip at full white draws roughly 8.6A per meter at 5V — a 5-meter run would need over 43A, which is impractical without power injection.

Package size matters too. The standard 5050 (5mm × 5mm) package is the most common, but 2020 and 3535 packages exist for higher-density or slimmer profile strips. Smaller packages generally have lower maximum brightness per LED but allow tighter pixel pitch.

## Protocol Tradeoffs

| Feature | WS2812B (one-wire) | APA102/SK9822 (SPI) |
|---|---|---|
| Wires needed | 3 (VDD, GND, Data) | 4 (VDD, GND, Clock, Data) |
| Timing sensitivity | High — nanosecond pulse widths | Low — clock-driven |
| Max data rate | ~800 kbps fixed | Up to ~20 Mbps |
| Interrupt tolerance | None during TX | Full tolerance |
| Global brightness | No | Yes (5-bit, 32 levels) |
| Per-LED cost | Lower | 1.5–2× higher |
| DMA friendliness | Requires SPI/timer tricks | Native SPI DMA |

For projects where firmware simplicity and interrupt compatibility matter — real-time audio reactive displays, multi-tasking RTOS applications, POV displays — the APA102 protocol is significantly easier to work with. For cost-sensitive projects with long runs and simpler animation requirements, WS2812B is the default choice.

## Voltage: 5V vs 12V vs 24V

Most addressable strips run at 5V, which keeps individual LED forward voltages within range but creates serious current problems at scale. 12V addressable strips (like the WS2815) group three LEDs in series per addressable pixel, reducing current by 3× for the same brightness. 24V variants push this further. The tradeoff: 12V and 24V strips have lower pixel density limits (typically 30 or 60 per meter) and each "pixel" is physically three LEDs, which limits minimum pitch.

12V strips are often the better choice for long architectural runs where power injection complexity needs to be minimized. 5V strips remain the default for short runs, wearables, and projects where single-LED pixel density matters.

## RGBW vs RGB

SK6812 RGBW strips add a dedicated white LED die alongside the red, green, and blue emitters. This produces a cleaner, more efficient white than mixing RGB — an RGB white has a characteristic cool blue tint and wastes energy exciting three phosphors to produce what one white emitter handles directly. The extra channel increases data per pixel from 24 to 32 bits, reducing maximum refresh rate by about 25% for a given strip length.

RGBW is worth the tradeoff for any application where white or warm-white light quality matters — ambient lighting, task lighting, and displays viewed by humans in mixed-lighting environments. For decorative color effects where white quality is irrelevant, RGB saves cost and data bandwidth.

## Tips

- Start the selection process from the power budget, not the feature list — a strip that requires more current than the power supply and wiring can deliver will underperform regardless of its specifications
- Default to 60 LED/m for general-purpose projects — it balances visual density, power consumption, and cost effectively for most applications
- Choose 12V strips for runs over 2 meters where power injection complexity needs to stay low
- Budget for 60mA per LED at full white for 5V WS2812B planning — actual consumption varies, but this is a safe ceiling for thermal and wiring calculations

## Caveats

- **Advertised brightness is at full white, which is rarely used** — Most animations use partial brightness and colored patterns. Designing a power supply for 100% white on every LED wastes capacity and cost for a condition that may never occur in practice
- **Not all strips with the same chip name behave identically** — Different manufacturers use different binning, phosphor mixes, and even slightly different controller silicon. Two "WS2812B" strips from different suppliers may have noticeably different white points and color consistency
- **Waterproof coatings affect thermal performance** — IP65 (silicone-coated) and IP67 (silicone-sleeved) strips trap heat. Derate brightness expectations by 20–30% for sealed strips in enclosed installations
- **LED density above 100/m creates thermal challenges** — High-density strips generate substantial heat at even moderate brightness. Without adequate heat sinking (aluminum channel extrusion), thermal throttling or LED degradation occurs over time

## In Practice

- A strip that looks great at 25% brightness but washes out or shows color inconsistency at full brightness likely has inadequate power delivery — voltage drop along the strip is starving LEDs further from the injection point
- Visible color differences between the start and end of a long strip (warm shift or dimming toward the far end) indicate voltage drop — adding power injection points or switching to a higher-voltage strip reduces the gradient
- A project that needs both vibrant colors and clean white light almost always benefits from RGBW strips — attempting to color-correct RGB white in firmware is possible but never matches a dedicated white emitter
- Strips that work on the bench but fail in an enclosed aluminum channel may be overheating — reducing maximum brightness in firmware or improving airflow in the channel resolves the issue
