---
title: "Single-End Injection"
weight: 10
---

# Single-End Injection

Single-end injection is the default wiring approach: power enters the LED strip at one end, and current flows through the strip's copper traces to reach every LED. It works well for short strips at moderate brightness, but voltage drop along the thin PCB traces creates a brightness gradient that becomes visible surprisingly quickly — often within the first meter at full white.

## How Voltage Drop Manifests

An addressable LED strip is effectively a long, thin copper trace carrying the full current load of every LED downstream. The WS2812B's copper power traces are typically 1oz (35µm) copper, roughly 10mm wide, giving a resistance of approximately 0.1–0.2Ω per meter depending on the strip manufacturer. A 60 LED/m strip at full white draws about 3.6A per meter. By Ohm's law, a 2-meter run drops 0.72–1.44V across the power traces — enough to pull the far end below the WS2812B's minimum operating voltage of ~3.5V.

The effect is visible as a color shift and dimming toward the far end. White becomes yellowish or pinkish as the blue (highest forward voltage) LED die drops out first. At extreme voltage drops, LEDs at the far end simply fail to light or display erratic colors.

## Maximum Practical Run Length

For 5V WS2812B strips at full brightness, single-end injection is reliable for roughly:

- **30 LED/m**: ~2–3 meters (60–90 LEDs)
- **60 LED/m**: ~1–1.5 meters (60–90 LEDs)
- **144 LED/m**: ~0.5 meters (72 LEDs)

These limits assume full white. At 50% brightness (a common operating point), the usable length roughly doubles. For applications that never exceed 30–40% brightness, single-end injection may be adequate for longer runs than expected.

## Wiring Considerations

The power wires from the supply to the strip matter as much as the strip's internal traces. A 3-meter run of 22AWG wire adds about 0.15Ω of resistance, which at 5A produces a 0.75V drop before the current even reaches the strip. Using heavier gauge wire (18AWG or 16AWG) for the supply run keeps the delivered voltage closer to the supply output. Measuring voltage at the strip's input connector — not at the power supply terminals — reveals the actual delivered voltage.

## Tips

- Measure voltage at the far end of the strip under load, not at the power supply — this reveals the actual voltage available to the last LEDs
- Use 18AWG or heavier wire for the supply run to the strip, even for short installations — the factory-attached wires on most strips are undersized for full-brightness operation
- Limit single-end injection to strips under 1 meter at 60 LED/m for full-brightness applications, or under 2 meters at reduced brightness
- Keep the power supply close to the strip's input to minimize wire-run voltage drop

## Caveats

- **Full white is the worst case but not the only problem case** — Bright pastel colors (light pink, light blue) draw nearly as much current as full white. Pure saturated colors (full red, full green) draw only one-third
- **Factory-soldered lead wires are often 24AWG or thinner** — The wires that come pre-attached to LED strips are sized for convenience, not for full-load current. Replacing them with heavier gauge wire is almost always worthwhile
- **Voltage drop is not linear along the strip** — LEDs closer to the input draw current that flows through all the downstream trace. The voltage curve is steepest near the input where total current is highest, then flattens toward the end where fewer LEDs draw through each trace segment
- **Cold solder joints at the strip input can mimic voltage drop** — A resistive connection at the input creates a fixed voltage offset that looks like excessive drop

## In Practice

- A strip that shows clean white at the start but shifts to yellow or pink toward the end is exhibiting classic voltage-drop color shift — blue LEDs have the highest forward voltage and drop out first
- LEDs at the far end flickering or going dark at full brightness but working fine at lower brightness confirms the voltage is marginal — reducing brightness or adding injection solves it
- A strip that measures 5.0V at the input but only 3.8V at the far end under load has lost 1.2V to trace resistance — this is well beyond the point where color accuracy degrades
- Replacing the pre-soldered 24AWG input wires with 18AWG and seeing immediate improvement in far-end brightness confirms the supply wiring was the bottleneck, not the strip's internal traces
