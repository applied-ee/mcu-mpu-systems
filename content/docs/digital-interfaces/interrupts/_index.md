---
title: "Interrupt Architecture & Firmware Patterns"
weight: 50
bookCollapseSection: true
---

# Interrupt Architecture & Firmware Patterns

Interrupts are the mechanism that makes embedded systems responsive — a hardware event triggers immediate execution of a handler function, preempting whatever the CPU was doing. On ARM Cortex-M, the Nested Vectored Interrupt Controller (NVIC) manages up to 240 interrupt sources with configurable priority levels, preemption groups, and tail-chaining optimizations. Getting interrupt architecture right determines whether firmware is responsive, deterministic, and free of the subtle data corruption bugs that only appear under load.

This section covers interrupt-driven firmware design: NVIC configuration and priority grouping, the rules that keep ISRs fast and safe, shared data protection with volatile and memory barriers, and critical section strategies that balance responsiveness against data integrity.

## Pages

- **[NVIC Configuration & Priority Grouping]({{< relref "nvic-configuration" >}})** — Priority bits, preemption vs sub-priority, group configuration, and the priority inversion traps that emerge in complex interrupt hierarchies.
- **[ISR Design Rules]({{< relref "isr-design-rules" >}})** — What belongs in an ISR, what does not, flag-and-defer patterns, and the timing constraints that keep handlers from breaking the rest of the system.
- **[Shared Data & Volatile Semantics]({{< relref "shared-data-and-volatile" >}})** — When volatile is necessary, when it is not sufficient, memory barriers, and the compiler optimization behaviors that corrupt shared state between ISR and main-loop code.
- **[Critical Sections & Interrupt Masking]({{< relref "critical-sections" >}})** — PRIMASK, BASEPRI, save-and-restore patterns, RTOS-aware critical sections, and the latency costs of disabling interrupts.
