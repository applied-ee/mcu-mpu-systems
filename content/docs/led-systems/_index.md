---
title: "🔆 LED Systems"
weight: 6
bookCollapseSection: true
---

# LED Systems

LEDs show up in nearly every embedded project — as status indicators, ambient lighting, notification displays, or the primary visual output. Working with them ranges from trivially simple (a single GPIO and a resistor) to genuinely complex (thousands of addressable pixels with real-time animation, power distribution engineering, and careful signal integrity). The jump from "blink an LED" to "build a reliable LED installation" involves electrical design, color science, and firmware architecture that doesn't get covered in most getting-started tutorials.

This section covers the full stack of LED work in embedded systems: the addressable strip protocols and their tradeoffs, power delivery at scale, color management for human perception, driver ICs for discrete LED arrays, animation and rendering patterns, and the signal integrity problems that plague every installation longer than a meter.

## Sections

- **[Addressable LED Strip Architectures]({{< relref "addressable-led-architectures" >}})** — WS2812B, APA102, and their clones: one-wire vs SPI protocols, strip selection criteria, and the hardware tradeoffs that shape firmware design.
- **[Power Injection Strategies]({{< relref "power-injection" >}})** — Delivering power to LED strips at scale: single-end limits, multi-point injection, bus bar architectures, and the high-current safety considerations that 5V systems demand.
- **[Color Management]({{< relref "color-management" >}})** — Gamma correction, HSV color spaces, and white balance: bridging the gap between linear PWM values and what the human eye actually perceives.
- **[LED Driver ICs & Constant-Current Control]({{< relref "led-driver-ics" >}})** — Constant-current regulators, PWM controllers, and multiplexing: driving discrete LEDs and LED arrays with dedicated hardware.
- **[Animations & Frame Rendering]({{< relref "animations-and-frame-rendering" >}})** — Framebuffer patterns, palette-based color systems, and timing architecture: the firmware side of making LEDs do something interesting at a consistent frame rate.
- **[Signal Integrity & Level Shifting]({{< relref "signal-integrity" >}})** — Level shifting, long-run data lines, and common wiring failures: keeping the data signal clean from the MCU to the first LED.
