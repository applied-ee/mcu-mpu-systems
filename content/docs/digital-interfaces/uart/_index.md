---
title: "UART in Production"
weight: 40
bookCollapseSection: true
---

# UART in Production

UART is the oldest serial interface still in active use — and the one most likely to be underestimated. Debug printf works easily, but production UART handling requires precise baud rate generation, robust interrupt-driven reception, DMA integration for high-throughput streams, and protocol-level framing that survives noise and partial messages. The gap between "it works on the bench" and "it works in the field" is wider for UART than for most peripherals, because UART has no built-in error correction, flow control is optional, and baud rate mismatches produce symptoms that mimic hardware faults.

This section covers production-grade UART firmware: baud rate calculation and accuracy limits, interrupt-driven reception with ring buffers, DMA with idle line detection for variable-length packets, and RS-485 half-duplex communication with automatic driver enable.

## Pages

- **[Baud Rate Generation & Accuracy]({{< relref "uart-baud-rate" >}})** — How UART baud rate dividers work, the relationship between peripheral clock and achievable rates, and the error thresholds that cause communication failures.
- **[Interrupt-Driven UART Reception]({{< relref "uart-interrupt-reception" >}})** — RXNE interrupt handling, ring buffer implementation, overrun detection, and the patterns that prevent data loss at high throughput.
- **[DMA-Driven UART with Idle Line Detection]({{< relref "uart-dma-idle" >}})** — Combining DMA circular buffers with the IDLE interrupt for zero-copy reception of variable-length packets.
- **[RS-485 Half-Duplex & Driver Enable]({{< relref "uart-rs485" >}})** — Transceiver control, hardware driver-enable pins, turn-around timing, and multi-drop addressing on RS-485 buses.
