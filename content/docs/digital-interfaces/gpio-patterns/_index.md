---
title: "GPIO Patterns That Scale"
weight: 10
bookCollapseSection: true
---

# GPIO Patterns That Scale

GPIO is the simplest peripheral on any MCU — and the one most likely to accumulate technical debt. A single `HAL_GPIO_WritePin()` call works fine for blinking an LED, but production firmware managing dozens of pins across multiple ports needs atomic access, clean abstractions, and reliable debouncing. The patterns that work for four pins break at forty.

This section covers GPIO from the firmware architecture perspective: how different HALs configure pins, how to manipulate multiple pins atomically without race conditions, how to build abstraction layers that survive a platform change, and how to debounce mechanical inputs without blocking or burning CPU cycles.

## Pages

- **[Pin Configuration Across HALs]({{< relref "pin-configuration-across-hals" >}})** — How STM32 HAL, ESP-IDF, Zephyr, and direct register access configure mode, speed, pull, and alternate function for GPIO pins.
- **[Atomic Port Access & Bit-Banding]({{< relref "atomic-port-access" >}})** — SET/CLEAR registers, bit-banding on Cortex-M3/M4, and avoiding read-modify-write hazards in interrupt-heavy firmware.
- **[GPIO Abstraction Layers]({{< relref "gpio-abstraction-layers" >}})** — Table-driven pin maps, HAL-agnostic interfaces, and patterns that keep GPIO configuration maintainable as pin counts grow.
- **[Debouncing in Firmware]({{< relref "debouncing-in-firmware" >}})** — Timer-based, polling-based, and state-machine debouncing strategies with measured settling times and interrupt considerations.
