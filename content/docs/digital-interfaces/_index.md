---
title: "🔌 Digital Interfaces & Peripheral Patterns"
weight: 5
bookCollapseSection: true
---

# Digital Interfaces & Peripheral Patterns

Microcontrollers communicate with sensors, actuators, displays, and other processors through a handful of digital interfaces — GPIO, I²C, SPI, UART, CAN, timers, and DMA channels. Each protocol has well-defined electrical characteristics and timing requirements, but the firmware side is where most projects succeed or fail. Configuring a peripheral correctly means understanding clock trees, interrupt priorities, DMA streams, and error recovery — not just setting a baud rate or toggling a pin.

This section focuses on the firmware implementation of digital interfaces: HAL configuration, register-level patterns, interrupt and DMA integration, and the production robustness techniques that separate a working prototype from a reliable product. Electrical fundamentals (voltage levels, pull-up sizing, timing diagrams) are covered elsewhere — every page here starts from the assumption that the wires are connected and asks: how does the firmware drive them correctly?

## Sections

- **[GPIO Patterns That Scale]({{< relref "gpio-patterns" >}})** — Pin configuration across HALs, atomic port access, abstraction layers, and debouncing strategies that hold up beyond a single-LED demo.
- **[I²C in Real Systems]({{< relref "i2c" >}})** — Initialization, multi-byte transfer patterns, error recovery and bus reset, and multi-master arbitration on a two-wire bus.
- **[SPI in Real Systems]({{< relref "spi" >}})** — Mode and polarity configuration, chip-select management, DMA-driven transfers, and multi-device bus topologies.
- **[UART in Production]({{< relref "uart" >}})** — Baud rate accuracy, interrupt-driven reception, DMA with idle line detection, and RS-485 half-duplex driver enable.
- **[Interrupt Architecture & Firmware Patterns]({{< relref "interrupts" >}})** — NVIC configuration, ISR design rules, shared data and volatile semantics, and critical section strategies.
- **[DMA Transfer Patterns]({{< relref "dma" >}})** — Channel and stream architecture, transfer directions, circular and double-buffer modes, and cache coherency on Cortex-M7.
- **[Timer & Counter Peripherals]({{< relref "timers" >}})** — Prescaler arithmetic, PWM generation, input capture and frequency measurement, and encoder mode for quadrature decoding.
- **[CAN Bus in Embedded Systems]({{< relref "can-bus" >}})** — Bit timing and baud rate, message filtering and FIFO management, error handling and bus-off recovery, and CAN-FD extended frames.
