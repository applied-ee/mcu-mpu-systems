---
title: "Flash & SRAM Fundamentals"
weight: 10
---

# Flash & SRAM Fundamentals

Every MCU has two primary memory regions: flash for non-volatile storage and SRAM for runtime data. On a typical Cortex-M device — say an STM32F407 — the flash holds 1 MB of compiled firmware starting at 0x08000000, while 192 KB of SRAM at 0x20000000 holds variables, the stack, and the heap. The entire address space, including peripheral registers, is memory-mapped into a single flat 32-bit space, which means reading a GPIO register and reading a variable in SRAM use the same load instruction.

## Flash: Code and Constants

Flash stores the compiled program (.text), read-only constants (.rodata), and the initial values of initialized global variables (.data). During normal execution, flash is read-only — writing to it requires unlocking a flash controller peripheral and following an erase-then-program sequence. Typical MCU flash ranges from 64 KB (STM32F030) to 2 MB (STM32H743). Flash reads at higher clock speeds incur wait states: an STM32F4 running at 168 MHz needs 5 wait states for flash access, meaning the CPU stalls for those cycles unless the prefetch buffer or ART accelerator hides the latency.

## SRAM: Runtime Data

SRAM holds everything that changes at runtime: global variables, the stack, the heap, and DMA buffers. It is volatile — all contents are lost on power-off or reset. Sizes range from 4 KB on low-end Cortex-M0 parts to 512 KB or more on high-end Cortex-M7 devices. SRAM runs at zero wait states at full CPU speed, making it the preferred location for performance-critical data or code that needs fast execution.

## Execute in Place vs Copy to RAM

Most Cortex-M firmware executes directly from flash (XIP — execute in place). This is simple and works well when the ART accelerator masks flash wait states. However, interrupt handlers or tight loops that are latency-sensitive can be copied to SRAM and executed from there at zero wait states. The linker script controls this placement. Some STM32 families offer CCM (Core Coupled Memory) — a tightly coupled SRAM block (e.g., 64 KB on STM32F405) connected directly to the CPU data bus, ideal for stack or DMA-free buffers since it has zero wait states but is not accessible by DMA.

## Memory-Mapped Peripherals

Peripherals like GPIO, UART, SPI, and timers are controlled through registers mapped into the address space. On STM32, peripheral registers start at 0x40000000. Writing to a GPIO output register is just a store instruction to a specific address. This means pointer errors in firmware can accidentally write to peripheral registers, causing hardware behavior that appears completely unrelated to the buggy code.

## Tips

- Check the flash wait-state table in the datasheet when selecting clock speed — running at the maximum clock often means 5-7 wait states, which the prefetch unit may not fully hide for all access patterns.
- Place DMA buffers in main SRAM, not CCM — CCM on STM32F4 is not on the DMA bus, and DMA transfers targeting CCM will silently produce garbage.
- Use `__attribute__((section(".ccmram")))` in GCC to place latency-critical variables in CCM when available.
- Keep flash constants (lookup tables, font data, string literals) in .rodata rather than copying them to SRAM — flash reads are free at low clock speeds and only mildly penalized at high speeds.
- Run `arm-none-eabi-size` after every build to track flash and SRAM usage trends before they become emergencies.

## Caveats

- **Flash wait states are cumulative with instruction fetch patterns** — Even with the ART accelerator enabled, non-sequential branches (common in interrupt-heavy firmware) can miss the prefetch buffer and stall for the full wait-state count.
- **CCM is not available on all STM32 families** — Code written for an F4 with CCM will not link correctly on an L4 or G4 without modifying the linker script.
- **Memory-mapped peripheral writes have side effects** — A wild pointer that overwrites 0x40011000 changes USART1 configuration, and the resulting behavior (baud rate change, framing errors) will not point back to the offending code.
- **SRAM contents are undefined after power-on** — Relying on SRAM being zeroed at startup without the startup code explicitly clearing .bss leads to intermittent bugs that depend on the previous power state.
- **Flash reads during flash write/erase stall the entire bus** — On single-bank flash devices, writing to flash halts code execution from that same flash until the operation completes, which can be 16 ms per sector on some parts.

## In Practice

- Firmware that runs correctly at 48 MHz but exhibits data corruption or hard faults at 168 MHz often has incorrect flash wait-state configuration — the CPU is reading stale or partial instruction data from flash.
- A DMA transfer that produces all-zero or garbage data despite correct peripheral configuration commonly points to a buffer placed in CCM or another region not accessible by the DMA controller.
- A variable that holds the correct value on one power cycle but contains 0xFFFFFFFF on the next is likely allocated in flash (misplaced in .rodata or a linker error) rather than SRAM, since 0xFF is the erased state of flash.
- Firmware that grows slowly over months and then suddenly hard-faults at startup has likely exceeded the available flash or SRAM — `arm-none-eabi-size` output showing usage near 100% confirms this.
- A system that freezes for 20-40 ms periodically with no interrupt latency explanation is often performing a flash erase or write operation, stalling the instruction bus on a single-bank flash MCU.
