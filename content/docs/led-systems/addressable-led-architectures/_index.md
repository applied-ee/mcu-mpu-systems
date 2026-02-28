---
title: "Addressable LED Strip Architectures"
weight: 10
bookCollapseSection: true
---

# Addressable LED Strip Architectures

Addressable LED strips pack a controller and RGB (or RGBW) emitters into every pixel, allowing firmware to set each LED independently over a single data bus. The two dominant protocol families — one-wire (WS2812B and clones) and SPI-based (APA102 and clones) — make fundamentally different tradeoffs in timing complexity, interrupt tolerance, wiring, and cost. Understanding these protocols and the hardware differences between strip types is the foundation for every LED project, from a 10-pixel notification ring to a 2000-pixel architectural installation.

Choosing the right strip involves more than just picking a protocol. LED density, voltage, color channels (RGB vs RGBW), and mechanical form factor all interact with the power budget and firmware architecture. Getting the selection right up front avoids painful mid-project redesigns.

## What This Section Covers

- **[WS2812B & SK6812 — One-Wire Protocol]({{< relref "ws2812b-and-sk6812" >}})** — The ubiquitous one-wire addressable LED: timing-encoded data, color order variants, clone compatibility, and the interrupt-sensitivity that shapes firmware design.
- **[APA102 & SK9822 — SPI-Based Addressable LEDs]({{< relref "apa102-and-sk9822" >}})** — Clock-and-data addressable LEDs: SPI-driven protocol, global brightness control, end-frame calculation, and the DMA-friendly architecture that simplifies real-time firmware.
- **[Choosing an LED Strip]({{< relref "choosing-led-strips" >}})** — Selecting the right strip for a project: density, voltage, RGB vs RGBW, protocol tradeoffs, and the power budget constraints that narrow the field.
