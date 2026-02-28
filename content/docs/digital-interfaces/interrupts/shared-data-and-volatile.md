---
title: "Shared Data & Volatile Semantics"
weight: 30
---

# Shared Data & Volatile Semantics

When a variable is written inside an ISR and read in the main loop (or vice versa), the compiler has no visibility into the asynchronous relationship between those two execution contexts. Without explicit annotation, the optimizer treats the main-loop code as the only thread of execution and may cache the variable in a register, reorder reads and writes, or eliminate accesses entirely. The `volatile` qualifier is the primary tool for preventing these optimizations, but it is both necessary in more places than most firmware expects and insufficient in others. Getting this right is the difference between firmware that works reliably and firmware that works only at `-O0`.

## When volatile Is Required

Any variable shared between ISR context and non-ISR context must be declared `volatile`. The qualifier tells the compiler that the variable's value can change at any time outside the current execution flow — every read must load from memory, and every write must store to memory. The canonical example:

```c
volatile uint8_t data_ready = 0;

void EXTI0_IRQHandler(void) {
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_0);
    data_ready = 1;
}

int main(void) {
    /* ... init ... */
    while (1) {
        if (data_ready) {
            data_ready = 0;
            handle_event();
        }
    }
}
```

Without `volatile`, the compiler at `-O2` or higher observes that `data_ready` is never modified within `main()`, hoists the load out of the loop, and transforms the `while` body into either an infinite empty loop (if the initial value is 0) or an unconditional call to `handle_event()`. The resulting firmware appears frozen — the flag is set by the ISR but the main loop never re-reads it.

## The Classic Bug: Optimized Away

The disassembly tells the story clearly. Without `volatile`, GCC at `-O2` for Cortex-M4 compiles the polling loop to:

```
/* Without volatile — flag check optimized away */
ldr     r3, [r4]        /* Load data_ready once */
cmp     r3, #0
beq     .loop_forever   /* Branch to infinite empty loop */
/* ... handle_event never reached if data_ready was 0 at first check ... */
```

With `volatile`, every iteration forces a fresh load:

```
/* With volatile — correct behavior */
.loop:
    ldrb    r3, [r4]    /* Load data_ready from memory each iteration */
    cmp     r3, #0
    beq     .loop       /* Re-check on next iteration */
    /* ... proceed to handle_event ... */
```

This optimization is not a compiler bug — it is correct behavior under the C abstract machine model, where a single-threaded program cannot observe changes to variables that it did not itself modify. The `volatile` qualifier overrides this assumption.

## When volatile Is Not Sufficient

`volatile` guarantees that every access goes to memory, but it does **not** guarantee atomicity. On Cortex-M3/M4/M7, aligned 32-bit reads and writes are naturally atomic — a single `LDR` or `STR` instruction cannot be interrupted mid-execution. This means a `volatile uint32_t` shared between ISR and main loop is both correctly loaded every time and atomically consistent.

However, 64-bit variables (`uint64_t`, `double`) require two 32-bit instructions and can be torn: the ISR fires between the two loads or stores, leaving half the old value and half the new value. Multi-field structures have the same problem — two related `uint32_t` fields can be read in an inconsistent state if the ISR updates both between the main loop's two reads:

```c
/* DANGEROUS — non-atomic 64-bit access */
volatile uint64_t system_timestamp;

void SysTick_Handler(void) {
    system_timestamp++;  /* Two 32-bit operations; can be interrupted mid-update */
}

uint64_t get_timestamp(void) {
    return system_timestamp;  /* May read torn value */
}
```

On **Cortex-M0/M0+** (RP2040), the situation is worse: even 32-bit accesses to unaligned addresses are non-atomic, and the lack of `LDREX`/`STREX` means there are no hardware-assisted atomic read-modify-write operations. A `volatile uint32_t` flag set to 1 or 0 is still safe (single-word write), but any read-modify-write sequence (`counter++`, `flags |= bit`) on a shared variable requires interrupt disabling.

## Correct 64-Bit Access Pattern

The safe way to read a multi-word variable shared with an ISR is to disable interrupts around the access, or use a double-read consistency check:

```c
volatile uint64_t system_timestamp;

/* Option 1: Disable interrupts (simple, guaranteed correct) */
uint64_t get_timestamp(void) {
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    uint64_t ts = system_timestamp;
    __set_PRIMASK(primask);
    return ts;
}

/* Option 2: Double-read consistency (no interrupt disable, ISR must only write) */
uint64_t get_timestamp(void) {
    uint64_t a, b;
    do {
        a = system_timestamp;
        b = system_timestamp;
    } while (a != b);
    return a;
}
```

Option 2 works only when the ISR is the sole writer and updates are infrequent relative to the read loop — it can spin indefinitely under pathological timing.

## Memory Barriers

`volatile` controls the compiler's behavior, but on Cortex-M7 (and to a lesser extent Cortex-M4 with caches), the hardware itself may reorder memory accesses. ARM Cortex-M provides three barrier instructions:

| Barrier | CMSIS Intrinsic | Effect |
|---|---|---|
| Data Synchronization Barrier | `__DSB()` | Ensures all preceding memory accesses complete before the next instruction executes |
| Instruction Synchronization Barrier | `__ISB()` | Flushes the pipeline; ensures subsequent instructions are fetched after any context changes |
| Data Memory Barrier | `__DMB()` | Ensures memory access ordering without waiting for completion |

On Cortex-M3/M4, the processor is in-order and does not reorder memory accesses, so barriers are rarely needed for data correctness between ISR and main loop. The primary exception is the interrupt flag clear problem: a write to a peripheral status register must complete before the ISR returns, or the interrupt re-pends. `__DSB()` forces this completion.

On **Cortex-M7** (STM32H7), the situation is different. The M7 has a dual-issue pipeline, a prefetch unit, and optional data/instruction caches. When sharing data between ISR and main loop through cached SRAM, the cache ensures coherency for the same core, but `__DSB()` is needed after DMA transfers that bypass the cache. For ISR-to-main-loop shared data, volatile plus natural cache coherency on the same core is sufficient, but multi-core scenarios (STM32H745 dual-core) require explicit cache maintenance (`SCB_CleanDCache_by_Addr`, `SCB_InvalidateDCache_by_Addr`) or placement of shared data in non-cacheable memory regions.

## sig_atomic_t and _Atomic

The C standard defines `sig_atomic_t` as a type that can be atomically read and written in the presence of asynchronous signal delivery. On ARM Cortex-M with GCC, `sig_atomic_t` is `int` (32-bit), which is naturally atomic for aligned single-word access. It does not provide read-modify-write atomicity — `sig_atomic_t counter; counter++;` is still a non-atomic read-modify-write.

C11 `_Atomic` provides stronger guarantees. `_Atomic uint32_t` ensures that increments, compare-and-swap, and other read-modify-write operations use appropriate hardware primitives (LDREX/STREX on Cortex-M3+). On Cortex-M0, the compiler falls back to disabling interrupts for `_Atomic` operations because LDREX/STREX are not available:

```c
#include <stdatomic.h>

_Atomic uint32_t event_count = 0;

void EXTI0_IRQHandler(void) {
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_0);
    atomic_fetch_add(&event_count, 1);  /* LDREX/STREX on M3+, interrupt-disable on M0 */
}

uint32_t get_event_count(void) {
    return atomic_load(&event_count);
}
```

While `_Atomic` is correct and portable, many embedded projects avoid it due to code-size overhead on Cortex-M0 and limited familiarity in firmware codebases. The explicit pattern of disabling interrupts around the critical access is more common in practice.

## Program Order vs Memory Order

In C, the compiler may reorder statements that have no data dependency. Two `volatile` accesses to different variables are guaranteed to occur in program order (the compiler cannot reorder `volatile` accesses relative to each other), but a `volatile` access and a non-volatile access have no such ordering guarantee:

```c
volatile uint8_t flag;
uint8_t buffer[64];

/* In ISR */
buffer[0] = received_byte;  /* Non-volatile write */
flag = 1;                    /* Volatile write */
```

The compiler may reorder the non-volatile store after the volatile store, allowing the main loop to see `flag == 1` before `buffer[0]` is written. The fix is to declare the buffer volatile as well, or insert a compiler barrier (`__asm volatile("" ::: "memory")`) between the two writes:

```c
buffer[0] = received_byte;
__asm volatile("" ::: "memory");  /* Compiler barrier — prevents reordering */
flag = 1;
```

On Cortex-M3/M4, the hardware does not reorder stores, so the compiler barrier alone is sufficient. On Cortex-M7 with write buffering, adding `__DSB()` between the data write and the flag write ensures hardware ordering as well.

## Tips

- Default to `volatile` for every variable shared between ISR and main loop — the performance cost (one extra memory load per access) is negligible compared to the debugging cost of an optimization-related bug.
- For single-word flags and counters on Cortex-M3+, `volatile uint32_t` is both atomic and correctly loaded; no additional protection is needed for simple set/clear/read patterns.
- When transferring multi-byte data from ISR to main loop, prefer a ring buffer with separate `volatile` head and tail indices over a volatile structure — the single-writer-single-reader pattern avoids the need for locks.
- Compile with `-O2` or `-Os` during development, not just for release — `volatile`-related bugs are invisible at `-O0` because the optimizer is not running.
- Use `__asm volatile("" ::: "memory")` as a compiler-only memory barrier when hardware ordering is already guaranteed (Cortex-M3/M4) — it has zero runtime cost.

## Caveats

- **A missing `volatile` qualifier produces bugs that only appear at optimization levels above `-O0`** — The code works in debug builds and fails in release builds, making the issue extremely difficult to reproduce under a debugger.
- **`volatile` does not make read-modify-write operations atomic** — `volatile uint32_t count; count++;` compiles to LDR, ADD, STR; if the ISR modifies `count` between the LDR and STR, the main loop's increment overwrites the ISR's update.
- **64-bit `volatile` reads are torn on all Cortex-M** — The processor uses two 32-bit loads, and an ISR can fire between them; this affects `uint64_t`, `double`, and any multi-word type.
- **The C compiler may reorder a non-volatile write past a volatile write** — Setting a buffer's contents and then setting a volatile flag does not guarantee the buffer is written first unless both are volatile or a compiler barrier is inserted.
- **On Cortex-M0 (RP2040), `_Atomic` operations disable interrupts internally** — This adds hidden interrupt latency that is not visible in the source code; each `atomic_fetch_add` call may mask interrupts for 10+ cycles.

## In Practice

- Firmware that passes all tests at `-O0` but fails at `-O2` — a sensor reading that never updates, a flag that is never seen as set, a state machine that appears stuck — almost always traces to a missing `volatile` on a shared variable.
- A 64-bit timestamp that occasionally jumps backward or shows impossible values (e.g., the upper 32 bits from one update and the lower 32 bits from the next) indicates a torn read of a multi-word variable shared with a timer ISR.
- A ring buffer that drops bytes under high throughput, with the head index appearing to regress or the tail overrunning the head, often results from the head index not being declared `volatile` — the main loop reads a stale cached value of head and miscalculates the available data count.
- A system that works on STM32F407 but fails on RP2040, with shared counter values that occasionally lose increments, suggests that a read-modify-write operation (`counter++`) that was naturally safe on Cortex-M4 (because it happened to be a single-cycle window) is being interrupted on the M0+ where the load-add-store sequence is wider.
- A release build that hangs in a `while (!flag)` polling loop, while the ISR demonstrably fires (visible on a logic analyzer), is the textbook symptom of a non-volatile flag — the compiler loaded it once, found it zero, and branched to an infinite loop.
