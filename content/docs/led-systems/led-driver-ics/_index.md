---
title: "LED Driver ICs & Constant-Current Control"
weight: 40
bookCollapseSection: true
---

# LED Driver ICs & Constant-Current Control

Addressable LED strips have their driver built into every pixel, but many LED projects use discrete LEDs — high-power emitters, indicator arrays, seven-segment displays, LED matrices — that need external drive circuitry. The core challenge is the same: LEDs are current-driven devices, and controlling their brightness accurately means controlling the current, not the voltage. Dedicated driver ICs handle current regulation, PWM dimming, and multi-channel multiplexing in hardware, freeing firmware from timing-critical output tasks.

This section covers the IC-level building blocks for driving LEDs that don't have built-in controllers: constant-current regulators that ensure brightness uniformity, PWM controllers that provide flicker-free dimming at arbitrary resolution, and multiplexing techniques that drive large LED arrays from a limited number of pins.

## What This Section Covers

- **[Constant-Current LED Drivers]({{< relref "constant-current-drivers" >}})** — Linear and switching current regulators: why constant-current matters for LED uniformity, common driver ICs, and setting the current with external resistors.
- **[PWM Controllers]({{< relref "pwm-controllers" >}})** — Dimming LEDs with pulse-width modulation: frequency and resolution tradeoffs, dedicated PWM ICs like the PCA9685 and TLC5940, and when to use external controllers versus MCU timers.
- **[Multiplexing & Charlieplexing]({{< relref "multiplexing-and-charlieplexing" >}})** — Driving many LEDs from few pins: row-column multiplexing, Charlieplexing with tri-state GPIOs, scan rate requirements, and hardware driver ICs for matrix displays.
