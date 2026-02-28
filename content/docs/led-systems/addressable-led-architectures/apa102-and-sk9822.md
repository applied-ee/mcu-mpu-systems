---
title: "APA102 & SK9822 — SPI-Based Addressable LEDs"
weight: 20
---

# APA102 & SK9822 — SPI-Based Addressable LEDs

The APA102 (and its widely available clone, the SK9822) solves the biggest headache of the WS2812B: timing-critical bit-banging. Instead of a single self-clocking data line, the APA102 uses a standard two-wire SPI interface — clock and data — which means any SPI peripheral can drive it at arbitrary speeds without worrying about nanosecond-level pulse widths. The tradeoff is an extra wire and slightly higher per-LED cost.

## Protocol Structure

Each frame begins with a 32-bit start frame of all zeros (`0x00000000`), followed by one 32-bit LED frame per pixel, and ends with an end frame. Each LED frame consists of a 3-bit header (`111`), a 5-bit global brightness field (0–31), then 8 bits each for blue, green, and red — `111BBBBB BBBBBBBB GGGGGGGG RRRRRRRR`. The global brightness field provides a second layer of dimming independent of the per-channel PWM, enabling smooth fading at low brightness levels where 8-bit PWM alone produces visible stepping.

The end frame needs at least `(n/2)` bits where `n` is the number of LEDs in the chain, rounded up to the nearest 32-bit boundary. For a 144-LED strip, that's at least 72 bits — three bytes of `0xFF` is insufficient; sending `ceil(n/2 / 8)` bytes of `0x00` or `0xFF` is the safe approach. Getting the end frame wrong causes the last LEDs in the chain to not update or to display stale data.

## Clock Speed and Throughput

The APA102 is rated for clock speeds up to roughly 20 MHz, though most implementations run between 1–8 MHz comfortably. At 8 MHz, a 300-LED strip refreshes in about 1.5ms — far faster than the WS2812B's ~9ms for the same count. This speed headroom makes the APA102 attractive for persistence-of-vision (POV) displays, high-frame-rate animations, and any application where the LED refresh needs to stay well ahead of other real-time tasks.

Because the clock is explicit, there are no timing constraints on when bits arrive. SPI transfers can be paused and resumed, interrupted without corruption, and driven by DMA with zero CPU involvement during transmission. This is the APA102's primary advantage for firmware architecture.

## APA102 vs SK9822 Differences

The SK9822 is often marketed as a drop-in APA102 replacement, and electrically it mostly is — same pinout, same protocol. The key difference is in the global brightness implementation. The APA102 uses a separate constant-current control for the global brightness field, providing true analog dimming. The SK9822 implements global brightness as a higher-frequency PWM, which is visually similar but can produce visible beating or interference patterns when captured on camera or viewed under certain conditions.

The SK9822 also has a slightly different clock propagation delay, which can matter at very high clock speeds on long chains. In practice, reducing the SPI clock to 4–6 MHz eliminates most SK9822-specific issues.

## Tips

- Use DMA-driven SPI for the data transfer — the explicit clock means the CPU can be completely free during LED updates, unlike WS2812B where timing is critical
- Start with a conservative SPI clock (1–4 MHz) and increase only if the frame rate budget demands it — signal integrity degrades at higher speeds over longer wires
- Use the global brightness field for smooth low-end dimming — fading a single channel from 3 to 0 in 8-bit PWM is only four steps, but combining it with global brightness values from 31 down to 1 provides much finer granularity
- Calculate the end frame size correctly: `ceil(num_leds / 2 / 8)` bytes minimum — too-short end frames silently fail to update tail LEDs

## Caveats

- **Two wires instead of one** — The separate clock line adds wiring complexity and an extra conductor that needs routing. For tight PCB layouts or flexible strip installations, this is a real constraint
- **The SK9822 is not a perfect APA102 clone** — The PWM-based global brightness can produce artifacts on camera and at very low brightness levels. For applications where LEDs will be filmed, the genuine APA102 may be worth the price premium
- **End frame calculation errors are silent** — If the end frame is too short, the last LEDs simply don't update. There's no error signal — it just looks like those LEDs are stuck or lagging
- **Higher per-LED cost** — APA102/SK9822 strips typically cost 1.5–2× more than equivalent WS2812B strips, which adds up quickly on large installations

## In Practice

- LEDs at the far end of a long chain not updating (while closer ones work fine) almost always points to an insufficient end frame — recalculate based on actual LED count and add padding
- Visible flickering bands when filming APA102/SK9822 strips on camera suggests the global brightness PWM frequency is interfering with the camera's scan rate — this is more pronounced on SK9822 parts
- A strip that works at low clock speeds but glitches at higher ones typically has a signal integrity problem — long wires, missing ground return, or excessive capacitance on the clock and data lines
- Smooth color gradients that look fine at full brightness but show visible stepping at low brightness are likely not using the global brightness field — combining per-channel PWM with global brightness provides 13-bit effective resolution per channel
