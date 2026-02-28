---
title: "Hard Faults & Crash Analysis"
weight: 40
---

# Hard Faults & Crash Analysis

When an ARM Cortex-M processor encounters an unrecoverable error, it triggers a fault exception. Without a proper fault handler, the default behavior is an infinite loop — the system appears frozen with no indication of what went wrong. Implementing fault capture and understanding the fault registers transforms a mysterious hang into a diagnosable event with a precise faulting instruction and root cause.

## Cortex-M Fault Types

The Cortex-M fault architecture defines four exception types. **HardFault** (exception 3) is the catch-all — any fault that cannot be handled by a more specific handler escalates here. **BusFault** fires on invalid memory accesses: reads from unmapped addresses, writes to read-only regions, or peripheral access with clocks disabled. **UsageFault** catches illegal instructions, unaligned access (when not permitted), and divide-by-zero (if enabled via CCR.DIV_0_TRP). **MemManage** triggers on MPU violations — access to regions forbidden by the Memory Protection Unit configuration. On Cortex-M0/M0+, only HardFault exists; the other three require Cortex-M3 or higher and must be explicitly enabled via the SHCSR register.

## Fault Status Registers

The key diagnostic registers live in the System Control Block. The **CFSR** (Configurable Fault Status Register, at 0xE000ED28) combines three sub-registers: MMFSR (bits 7:0), BFSR (bits 15:8), and UFSR (bits 31:16). Each bit indicates a specific fault cause — for example, BFSR bit 7 (BFARVALID) signals that the **BFAR** register (0xE000ED38) holds the address that caused the bus fault. The **HFSR** (0xE000ED2C) indicates whether the hard fault was caused by a vector table read error (bit 1, VECTTBL) or escalation from a lower-priority fault (bit 30, FORCED). The **MMFAR** (0xE000ED34) captures the address for memory management faults when MMFSR.MMARVALID is set.

## Hard Fault Handler Implementation

A practical fault handler captures the stacked exception frame — the processor automatically pushes R0, R1, R2, R3, R12, LR, PC, and xPSR onto the active stack (MSP or PSP) on exception entry. The assembly-level handler determines which stack was active by inspecting bit 2 of the EXC_RETURN value in LR, then passes the stack pointer to a C function:

```c
void HardFault_Handler_C(uint32_t *frame) {
    volatile uint32_t r0  = frame[0];
    volatile uint32_t r1  = frame[1];
    volatile uint32_t r2  = frame[2];
    volatile uint32_t r3  = frame[3];
    volatile uint32_t r12 = frame[4];
    volatile uint32_t lr  = frame[5];
    volatile uint32_t pc  = frame[6];  // Faulting instruction
    volatile uint32_t psr = frame[7];
    volatile uint32_t cfsr = *(volatile uint32_t *)0xE000ED28;
    volatile uint32_t hfsr = *(volatile uint32_t *)0xE000ED2C;
    volatile uint32_t bfar = *(volatile uint32_t *)0xE000ED38;
    __BKPT(0);  // Halt here if debugger attached
}
```

The `pc` value points to the instruction that caused the fault (or the instruction after, for imprecise bus faults). Loading the `.map` file or using `addr2line` converts this address to a source file and line number.

## Common Fault Causes

Null pointer dereferences produce a BusFault when the access hits the reserved address range near 0x00000000. Unaligned 32-bit access on Cortex-M0 (which lacks unaligned access support) triggers a HardFault. Stack overflow — the stack pointer descending past the allocated region into heap or global variable space — corrupts memory silently until something reads a poisoned value. Writing to flash memory without unlocking the flash controller or writing to a peripheral register with its bus clock disabled both produce BusFaults. A corrupted function pointer or vtable entry causes a HardFault when the processor attempts to fetch instructions from an invalid address.

## Debugging with GDB

With a debug probe attached, GDB provides direct access to the fault state. The command `info registers` shows the current register file. Examining the fault registers directly: `x/wx 0xE000ED28` reads CFSR, `x/wx 0xE000ED2C` reads HFSR. The `bt` (backtrace) command may work if the stack is intact, but corrupted stacks require manual unwinding from the stacked PC value. Setting `pc` from the stacked frame and using `list *0x<address>` maps the faulting instruction back to source code.

## Tips

- Enable BusFault, UsageFault, and MemManage handlers early in startup by setting the corresponding enable bits in SHCSR (0xE000ED24) — this provides more specific fault information than a generic HardFault escalation.
- Place a canary value (e.g., 0xDEADBEEF) at the bottom of the stack region and check it periodically or in the idle task — this catches stack overflow before it causes a hard-to-trace fault.
- Store the faulting PC, CFSR, and LR to a persistent region (backup SRAM or a reserved flash sector) before resetting, so crash information survives a watchdog reset.
- Enable divide-by-zero trapping via the CCR register (bit 4, DIV_0_TRP) — without this, Cortex-M silently returns zero on integer division by zero.
- Compile with `-fstack-usage` and `-Wstack-usage=N` to get per-function stack consumption at build time, helping size the stack allocation correctly.

## Caveats

- **Imprecise bus faults do not capture the faulting address** — The write buffer on Cortex-M3/M4 can decouple the store instruction from the actual bus transaction, meaning BFAR is invalid and the stacked PC may point several instructions past the actual cause.
- **Stack overflow faults are often misleading** — The corrupted stack pointer causes the exception entry push to write to invalid memory, producing a secondary fault that masks the original overflow.
- **HardFault in HardFault escalates to lockup** — If the hard fault handler itself faults (e.g., due to stack overflow), the processor enters a lockup state that only a reset can recover from; a debugger shows PC stuck at 0xFFFFFFFE.
- **Cortex-M0 lacks fault status registers** — Only HardFault exists, with no CFSR/BFAR/MMFAR; diagnosis depends entirely on the stacked PC and register values.
- **Optimized code changes the fault location** — Compiler optimizations (especially inlining and instruction reordering) move the apparent fault address away from the source line containing the bug; building with `-Og` during fault investigation preserves debug-friendly mapping.

## In Practice

- A HardFault with CFSR showing 0x00000100 (IBUSERR) and a stacked PC pointing to a RAM address indicates the processor jumped to a non-executable region — typically caused by a corrupted function pointer or return address from stack overflow.
- A BusFault that occurs only after the MCU runs for minutes or hours, with BFAR pointing to the heap region, suggests heap corruption from a buffer overrun or use-after-free — the fault appears long after the actual bug executes.
- A UsageFault with UFSR bit 0 (UNDEFINSTR) set and the stacked PC pointing to valid flash suggests the instruction stream was corrupted, which can happen from errant DMA transfers writing into the code region.
- A system that hard faults immediately on startup with the stacked PC at or near 0x00000000 indicates a missing or corrupted vector table — the processor read an invalid reset handler address from the first entry in flash.
- A MemManage fault that only appears in release builds but not debug builds often traces to a stack overflow triggered by aggressive inlining, which increases stack usage beyond the allocated region.
