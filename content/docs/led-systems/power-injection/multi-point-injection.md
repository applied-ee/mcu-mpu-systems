---
title: "Multi-Point Injection"
weight: 20
---

# Multi-Point Injection

Multi-point injection adds power connections at multiple locations along a strip, reducing the maximum distance any LED sits from a power feed point. This is the standard approach for any installation longer than about a meter at full brightness, and it's the single most effective technique for eliminating the color shift and dimming caused by voltage drop.

## How It Works

Instead of relying on the strip's thin PCB traces to carry current for the entire run, additional VDD and GND wires are soldered to the strip at regular intervals. Each injection point creates a "zone" where current flows from the nearest power tap rather than traveling through the full length of the strip's internal copper. The data line remains a single continuous chain — only power is injected at multiple points, not signal.

A typical approach for a 5-meter strip of 60 LED/m WS2812B: inject power every 1–1.5 meters (4–5 injection points total), all connected back to the same power supply. This keeps the maximum trace distance to any LED under 0.75 meters, well within the range where voltage drop is negligible at moderate brightness.

## Injection Point Placement

The goal is to keep the voltage at any LED within an acceptable range — ideally within 0.3V of the supply voltage. Placement depends on density, brightness, and strip resistance:

- **60 LED/m at full brightness**: inject every 0.75–1.0 meters
- **60 LED/m at 50% brightness**: inject every 1.5–2.0 meters
- **144 LED/m at full brightness**: inject every 0.3–0.5 meters
- **30 LED/m at full brightness**: inject every 2.0–3.0 meters

Even spacing isn't strictly required — placing injection points where physical access is convenient (at corners, behind mounting channels, at connector junctions) works fine as long as no segment is excessively long.

## Wiring Topology

All injection points connect back to the power supply in a star topology: each injection wire runs independently from the power supply (or a central power distribution point) to the strip. Daisy-chaining injection points along the strip — connecting the second injection wire to the first, which connects to the supply — adds the current of downstream LEDs to the upstream wires, partially defeating the purpose.

The wire gauge for each injection run should be sized for the current of that segment, not the full strip. A 1-meter segment of 60 LEDs at full white draws about 3.6A, so 20AWG or heavier is appropriate for each run. The main supply wires from the PSU to the distribution point carry the full strip current and need heavier gauge accordingly.

## Shared Ground

Every injection point must include both VDD and GND connections. Injecting only VDD and relying on the strip's internal ground trace to carry return current is a common mistake that leads to ground potential differences between segments. These voltage offsets cause erratic LED behavior — color shifts, flickering, or LEDs in the middle of the strip acting as if they're at a different brightness than commanded.

## Tips

- Always inject both VDD and GND at every injection point — skipping ground injection creates return-current problems that are harder to diagnose than voltage drop
- Use star topology from the supply, not daisy-chain, to prevent current stacking on upstream wires
- Mark injection points on the strip before installation — soldering access is much harder once the strip is mounted in an aluminum channel or enclosure
- Test the full strip at maximum expected brightness before final installation to verify that injection spacing is adequate

## Caveats

- **Injection does not help the data signal** — Only power is improved by injection. If the data signal degrades over a long strip, a signal repeater or buffer is needed separately
- **Different power supplies at different injection points create ground loops** — If using multiple power supplies, their grounds must be connected together. Floating grounds between segments produce unpredictable behavior
- **Solder joints on flex PCBs are stress points** — The injection wires soldered to a flexible strip are mechanically vulnerable. Strain relief (hot glue, cable ties, or silicone) prevents fatigue failures
- **More injection points means more wiring complexity** — Each injection point adds two wires that need routing back to the supply. For permanent installations, planning the wire routing is as important as the LED layout

## In Practice

- A strip with injection at both ends that still shows dimming in the middle has injection points spaced too far apart — the center of the strip is the farthest point from any power feed
- Adding a single mid-point injection to a 3-meter strip that previously had end-only injection typically produces a dramatic improvement in color uniformity — the maximum trace distance is cut in half
- Flickering LEDs near injection points (rather than far from them) usually indicates a poor solder joint at the injection tap — the intermittent connection is worse than no injection at all
- A strip that works fine at low brightness but shows uneven brightness at high levels despite injection points likely has undersized injection wires — the wire resistance is limiting current delivery to specific segments
