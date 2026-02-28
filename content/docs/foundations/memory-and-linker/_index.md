---
title: "Memory Architecture & Linker Configuration"
weight: 40
bookCollapseSection: true
---

# Memory Architecture & Linker Configuration

Embedded systems operate under memory constraints that application developers rarely encounter — a typical Cortex-M4 project might have 256 KB of flash and 64 KB of SRAM, and every byte of both is visible in the firmware's memory map. Understanding where code lives, where data goes, how the stack grows, and what the linker does to arrange all of it is not optional knowledge — it's the difference between firmware that works reliably and firmware that crashes under load when the stack collides with the heap.

The linker script is the bridge between the compiler's output and the physical memory layout of the target chip. It defines memory regions, places sections, and controls startup behavior. When something goes wrong at this level, the symptoms are baffling: variables that corrupt each other, code that works in debug but fails in release, or peripherals that seem to ignore configuration writes because the initialization data never made it to RAM.

## What This Section Covers

- **[Flash & SRAM Fundamentals]({{< relref "flash-and-sram-fundamentals" >}})** — How flash and SRAM are organized in typical MCUs, memory-mapped peripherals, and the execution-from-flash vs copy-to-RAM tradeoffs that affect performance.
- **[Stack, Heap & Static Allocation]({{< relref "stack-heap-and-static" >}})** — How the stack, heap, and statically allocated data share SRAM, and the failure modes that emerge when any of them grows beyond its intended region.
- **[Linker Scripts Demystified]({{< relref "linker-scripts-demystified" >}})** — The anatomy of a linker script: MEMORY regions, SECTIONS placement, startup code, and the initialization sequence that copies data and zeroes BSS before main().
- **[Flash Wear & Persistent Storage]({{< relref "flash-wear-and-persistent-storage" >}})** — Flash endurance limits, wear-leveling strategies, and lightweight key-value storage patterns for saving configuration and calibration data without an external EEPROM.
