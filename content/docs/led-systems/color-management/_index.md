---
title: "Color Management"
weight: 30
bookCollapseSection: true
---

# Color Management

Getting the "right" color out of an LED is harder than it looks. The mismatch between how LEDs produce light (linear PWM) and how humans perceive brightness (logarithmic) means that naive color values look wrong — fades jump, whites look blue, and dimming shifts hues. Color management bridges the gap between the numbers in firmware and the colors the eye actually sees, using gamma correction, perceptually useful color spaces, and white-point calibration.

These techniques apply to every LED project, whether it's a single status indicator or a 1000-pixel ambient installation. The difference between a professional-looking LED project and an amateur one is often just gamma correction and white balance — the hardware is identical, but the color pipeline makes the output look dramatically better.

## What This Section Covers

- **[Gamma Correction]({{< relref "gamma-correction" >}})** — Mapping linear PWM values to perceptually uniform brightness: the lookup table approach, resolution loss at low brightness, and choosing the right gamma exponent.
- **[HSV & Color Spaces]({{< relref "hsv-and-color-spaces" >}})** — Working in Hue-Saturation-Value for intuitive color control: HSV-to-RGB conversion, perceptual uniformity, and why RGB is the wrong space for animation design.
- **[White Balance & Color Temperature]({{< relref "white-balance-and-color-temperature" >}})** — Correcting the blue-shifted white of RGB strips: per-channel scaling, color temperature targets, RGBW decomposition, and batch-to-batch variation.
