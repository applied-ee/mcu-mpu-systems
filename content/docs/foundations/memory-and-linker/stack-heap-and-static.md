---
title: "Stack, Heap & Static Allocation"
weight: 20
---

# Stack, Heap & Static Allocation

All runtime data on a Cortex-M lives in SRAM, and it gets divided into three categories: static allocations (globals and statics, known at link time), the stack (function calls and local variables, growing downward), and the heap (dynamic allocations via malloc, growing upward). On a device with 64 KB of SRAM, these three regions share the space with no MMU and no protection — when one grows into another, the result is silent data corruption, not a clean segfault.

## Static and Global Variables

Global variables and file-scope statics are placed by the linker into two sections. Initialized variables (e.g., `int count = 5;`) go into .data, which occupies flash for initial values and SRAM for the runtime copy. Zero-initialized or uninitialized globals (e.g., `int buffer[256];`) go into .bss, which occupies no flash — the startup code zeroes the region before main(). On a typical project, .data might be 2 KB and .bss might be 12 KB. These sizes are fixed at compile time and visible in the map file.

## The Stack

The stack starts at the top of SRAM (or at a linker-defined address) and grows downward. Each function call pushes a stack frame: local variables, saved registers, and the return address. A Cortex-M4 defaults to a 1-4 KB stack in most vendor-provided linker scripts, though this is configurable. Deep call chains, recursive functions, or large local arrays (e.g., `char buf[1024]` inside a function) consume stack rapidly. Stack overflow is the single most common memory bug in embedded firmware — it overwrites .bss or heap data silently, producing symptoms far removed from the offending function.

### Stack Watermark Painting

A practical technique for measuring worst-case stack depth is "painting" the stack region with a known sentinel value at startup, then scanning from the bottom after the firmware has exercised all code paths:

```c
/* Paint stack region at startup (call before main) */
extern uint32_t _sstack, _estack;
void stack_paint(void) {
    volatile uint32_t *p = &_sstack;
    while (p < &_estack - 64) { *p++ = 0xDEADBEEF; }
}

uint32_t stack_high_water(void) {
    uint32_t *p = &_sstack;
    while (*p == 0xDEADBEEF) p++;
    return (uint32_t)(&_estack - p);  /* bytes used */
}
```

The `stack_paint()` function should run from the Reset_Handler before any C runtime initialization that uses the stack. Calling `stack_high_water()` later — via a debug UART command or a periodic diagnostic task — reports the maximum stack depth observed since boot.

### Static Analysis with `-fstack-usage`

GCC's `-fstack-usage` flag generates a `.su` file alongside each object file, listing the stack consumption of every function in bytes. A typical entry looks like:

```
main.c:42:6:process_packet	128	static
```

This means `process_packet` at line 42 uses 128 bytes of stack, and the usage is statically determinable (no variable-length arrays or alloca). Combining `.su` data with the call graph from `-fdump-rtl-expand` allows computing worst-case stack depth for the entire call tree without running the firmware.

### MPU-Based Stack Overflow Detection

On Cortex-M devices with an MPU (Memory Protection Unit), a guard region can be configured at the bottom of the stack. Setting a 32-byte or 64-byte MPU region with no access permissions causes a MemManage fault the instant the stack pointer enters the guard zone, producing a deterministic trap instead of silent corruption. This approach catches overflow at the exact instruction that crosses the boundary, making the root cause immediately visible in a debugger.

## The Heap

Heap memory comes from malloc/calloc/realloc and grows upward from the end of .bss. On desktop systems, the heap is effectively unlimited; on an MCU with 32 KB of SRAM, it might be 4-8 KB at best. Fragmentation is the primary risk: after many allocate/free cycles, the heap can have enough total free bytes but no single contiguous block large enough to satisfy a request. Many embedded projects avoid the heap entirely, using only static allocation and stack variables. When dynamic allocation is needed, fixed-size block pools or arena allocators provide predictable behavior without fragmentation.

### Static Pool Allocator Pattern

A common alternative to `malloc` in safety-critical or long-running firmware is a static pool allocator. The pool is a fixed-size array of equal-sized blocks, with a free list tracking available slots:

```c
#define POOL_BLOCK_SIZE  64
#define POOL_BLOCK_COUNT 16

static uint8_t pool_memory[POOL_BLOCK_COUNT][POOL_BLOCK_SIZE];
static uint8_t pool_free[POOL_BLOCK_COUNT];
static int pool_initialized = 0;

void pool_init(void) {
    for (int i = 0; i < POOL_BLOCK_COUNT; i++) pool_free[i] = 1;
    pool_initialized = 1;
}

void *pool_alloc(void) {
    for (int i = 0; i < POOL_BLOCK_COUNT; i++) {
        if (pool_free[i]) { pool_free[i] = 0; return pool_memory[i]; }
    }
    return NULL;  /* pool exhausted */
}

void pool_free_block(void *ptr) {
    int idx = ((uint8_t *)ptr - &pool_memory[0][0]) / POOL_BLOCK_SIZE;
    if (idx >= 0 && idx < POOL_BLOCK_COUNT) pool_free[idx] = 1;
}
```

This approach guarantees O(n) worst-case allocation time, zero fragmentation, and a deterministic memory ceiling visible in the map file. Multiple pools with different block sizes can coexist when the application requires several allocation granularities.

## RTOS Stack Considerations

In a FreeRTOS or Zephyr project, each task gets its own stack, allocated from the heap or a static array. A system with five tasks each assigned 512 bytes of stack uses 2.5 KB of SRAM for stacks alone, plus the idle task and timer task stacks. Under-sizing any single task stack causes a hard fault or silent corruption. FreeRTOS provides `uxTaskGetStackHighWaterMark()` to report the minimum remaining stack for a task, which is essential for tuning stack sizes after the firmware stabilizes.

## Tips

- Use stack watermarking (fill the stack region with a known pattern like 0xDEADBEEF at startup, then scan for how much was overwritten) to measure actual worst-case stack usage before finalizing the linker script.
- Avoid large local arrays in deeply nested functions — move large buffers to file-scope static variables or allocate from a pool to keep the stack shallow.
- Compile with `-fstack-usage` (GCC) to get per-function stack consumption in .su files — this reveals which functions are stack-heavy without running the firmware.
- Reserve at least 25% more stack than measured worst-case to account for interrupt preemption, which pushes additional context onto the current stack.
- Keep heap usage to zero if possible — static allocation makes memory usage fully deterministic and visible in the map file.

## Caveats

- **Stack overflow has no hardware trap on most Cortex-M devices** — Without an MPU region guard, the stack silently grows into .bss or heap, corrupting data that may not be accessed until much later.
- **malloc on embedded does not return NULL reliably** — Some newlib-nano implementations do not track heap boundaries correctly, and malloc may return a pointer into the stack region instead of failing.
- **Interrupt handlers share the main stack (MSP)** — Nested interrupts on Cortex-M push context onto the main stack pointer, meaning a worst-case interrupt storm adds to peak stack usage even in RTOS configurations where tasks use the PSP.
- **Compiler optimizations change stack usage** — A function that uses 200 bytes of stack at -O0 might use 48 bytes at -O2 due to register allocation; stack measurements from debug builds do not apply to release builds.
- **RTOS stack sizes are in words, not bytes, on some implementations** — Configuring a FreeRTOS stack as 256 when the unit is uint32_t means 1024 bytes, not 256 bytes.

## In Practice

- A system that crashes after running for hours under load but passes every bench test at startup likely has a slow stack overflow — the deepest call path only occurs under a rare combination of active features.
- A hard fault that occurs inside a well-tested library function (e.g., sprintf) commonly indicates that the calling task has insufficient stack for that function's internal buffer requirements — sprintf can consume 500+ bytes of stack.
- Global variables that change value without any code writing to them are a hallmark of stack overflow or heap corruption — the corrupted bytes belong to a stack frame that grew past its boundary.
- An RTOS application where one task works correctly in isolation but fails when all tasks run simultaneously is often hitting total SRAM exhaustion — the sum of all task stacks plus static data exceeds available memory.
- A release build that crashes while the debug build works reliably often has a stack-size dependency on optimization level, or the debug build's larger stack allocation (added by some IDEs) was masking an overflow.
