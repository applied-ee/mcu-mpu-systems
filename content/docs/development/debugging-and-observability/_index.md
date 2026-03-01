---
title: "Debugging & Observability"
weight: 20
bookCollapseSection: true
---

# Debugging & Observability

Embedded debugging is fundamentally different from desktop debugging — there's no terminal to print to by default, no operating system catching segfaults, and the failure mode is often a chip that simply stops responding. The tools and techniques for observing what an embedded system is actually doing span hardware debug interfaces (SWD, JTAG), serial output channels (UART, SWO, RTT), bench instruments (logic analyzers, oscilloscopes), and post-mortem crash analysis. Proficiency with these tools is what separates productive embedded development from hours of guessing.

The investment in setting up good observability infrastructure — a working debug probe connection, reliable serial output, and familiarity with basic bench instruments — pays for itself on every project. Most embedded bugs become obvious once the right signal is visible.

## What This Section Covers

- **[SWD, JTAG & Debug Probes]({{< relref "swd-jtag-and-debug-probes" >}})** — The hardware debug interfaces that enable breakpoints, memory inspection, and flash programming: protocols, probe options, and connection requirements.
- **[Serial Debug Output — UART, SWO & RTT]({{< relref "serial-debug-output" >}})** — The three main channels for getting text and data out of a running MCU: traditional UART, ARM's Serial Wire Output, and SEGGER's Real-Time Transfer.
- **[Logic Analyzers & Oscilloscopes at the Bench]({{< relref "logic-analyzers-and-oscilloscopes" >}})** — Using logic analyzers for protocol decoding and timing verification, and oscilloscopes for signal integrity and power rail analysis.
- **[Hard Faults & Crash Analysis]({{< relref "hard-faults-and-crash-analysis" >}})** — What happens when a Cortex-M processor hits a hard fault: register inspection, stack unwinding, and the common code patterns that trigger bus faults, usage faults, and memory protection violations.
