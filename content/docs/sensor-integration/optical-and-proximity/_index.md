---
title: "Optical & Proximity Sensors"
weight: 60
bookCollapseSection: true
---

# Optical & Proximity Sensors

Light detection spans a wide range of embedded applications — from simple ambient brightness measurement for display backlight control to sophisticated gesture recognition using IR proximity arrays. The underlying transducers (photodiodes, phototransistors, integrated light-to-digital converters) all respond to photon flux, but their spectral sensitivity, dynamic range, and interface complexity vary enormously. Simple photodiodes produce a current proportional to light intensity and need an analog front-end, while integrated sensors like the VEML7700 or APDS-9960 handle amplification, ADC conversion, and digital filtering internally, presenting results over I²C.

This subsection covers the optical sensor families most commonly encountered in embedded projects, from basic photocurrent measurement through ambient light and UV sensing to IR proximity, gesture detection, and color/spectral analysis.

## Pages

- **[Photodiodes & Phototransistors]({{< relref "photodiodes-and-phototransistors" >}})** — Photovoltaic vs photoconductive mode, transimpedance amplifier front-ends, phototransistor biasing, and bandwidth-vs-sensitivity tradeoffs.
- **[Ambient Light & UV Sensors]({{< relref "ambient-light-and-uv-sensors" >}})** — Integrated light-to-digital converters (VEML7700, TSL2591), UV index sensors (VEML6075, LTR-390), lux calculation, and automatic gain/integration time control.
- **[IR Proximity & Gesture Detection]({{< relref "ir-proximity-and-gesture" >}})** — IR LED/photodiode proximity sensing, VCNL4040 and APDS-9960 integration, crosstalk cancellation, and gesture engine register configuration.
- **[Color & Spectral Sensors]({{< relref "color-and-spectral-sensors" >}})** — RGB and clear-channel sensors (TCS34725), spectral sensors (AS7341), color temperature calculation, and integration time versus noise tradeoffs.
- **[Cameras & Image Capture]({{< relref "cameras-and-image-capture" >}})** — CMOS image sensor fundamentals, parallel DVP and SPI camera interfaces, DCMI peripheral capture on STM32, JPEG compression, framebuffer memory constraints, and the MCU vs MPU boundary for vision applications.
