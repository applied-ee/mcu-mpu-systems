---
title: "Choosing the Right Platform"
weight: 10
bookCollapseSection: true
---

# Choosing the Right Platform

Selecting a microcontroller is the first architectural decision in any embedded project, and it constrains everything that follows — peripheral availability, power budget, firmware complexity, and long-term supply chain risk. The choice is rarely about finding the "best" chip; it's about finding the right fit for a specific set of constraints. A sensor node that sleeps for 99% of its life has different needs than a motor controller running tight control loops, and both differ from a USB HID device that needs specific peripheral support.

The landscape spans 8-bit parts with 512 bytes of RAM to application processors running Linux, with an enormous middle ground of 32-bit Cortex-M devices that cover most embedded use cases. Navigating this space requires understanding not just the silicon specifications, but the packages, toolchains, vendor ecosystems, and supply realities that determine whether a chip is practical for a given project.

## What This Section Covers

- **[MCU vs MPU — When to Use Which]({{< relref "mcu-vs-mpu" >}})** — The fundamental architectural split between microcontrollers and microprocessors: bare-metal simplicity vs OS-capable power, and where the boundary sits in practice.
- **[Key Specs That Actually Matter]({{< relref "key-specs-that-matter" >}})** — Core frequency, memory sizes, peripheral counts, and the second-order specifications like ADC resolution and timer bit-width that quietly determine project feasibility.
- **[Popular MCU Families Compared]({{< relref "popular-mcu-families" >}})** — STM32, ESP32, nRF, RP2040, AVR, PIC, and others: what each family does well, where each struggles, and the practical tradeoffs between them.
- **[Packages & Solderability]({{< relref "packages-and-solderability" >}})** — QFP, QFN, BGA, and DIP: how package choice affects prototyping, hand soldering, thermal performance, and board layout.
- **[Ecosystem & Vendor Lock-In]({{< relref "ecosystem-and-vendor-lock-in" >}})** — IDEs, HALs, community support, and second-source availability: the non-silicon factors that determine whether a chip choice remains viable over a product's lifetime.
