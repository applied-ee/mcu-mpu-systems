---
title: "🧱 Foundations for Building Embedded Systems"
weight: 1
bookCollapseSection: true
---

# Foundations for Building Embedded Systems

Every embedded project starts with a set of decisions that shape everything downstream: which processor to use — from bare-metal microcontrollers to Linux-capable application processors — how to power it, how clocks propagate through the system, and where code and data live in memory. These foundational choices interact with each other — a clock misconfiguration can look like a power problem, a linker script error can look like a silicon bug, and a missing decoupling capacitor can cause symptoms that no amount of firmware debugging will fix.

This section covers the core hardware knowledge needed before writing application-level firmware. The progression moves from selecting a platform (MCU or MPU), through powering and clocking it, understanding its memory architecture, and working with Linux-based embedded systems where the platform choice leads to a full operating system rather than bare-metal firmware.

## Sections

- **[Choosing the Right Platform]({{< relref "choosing-the-right-mcu" >}})** — MCU vs MPU tradeoffs, key specifications, popular families, packages, and the ecosystem considerations that shape long-term project viability.
- **[Power Architecture for Embedded Projects]({{< relref "power-architecture" >}})** — Regulator selection, decoupling strategy, power sequencing, and power budget estimation for reliable embedded power delivery.
- **[Clocks & Timing]({{< relref "clocks-and-timing" >}})** — Oscillator sources, clock tree configuration, PLL setup, and the low-speed clock domains that drive RTC and watchdog peripherals.
- **[Memory Architecture & Linker Configuration]({{< relref "memory-and-linker" >}})** — Flash and SRAM fundamentals, stack and heap layout, linker script mechanics, and persistent storage strategies.
- **[Linux-Based Embedded]({{< relref "linux-embedded" >}})** — Single-board computers, embedded Linux distributions, image-based deployments, real-time Linux, and GPIO access patterns that differ from bare-metal MCU development.
