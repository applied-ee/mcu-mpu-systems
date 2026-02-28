---
title: "Linker Scripts Demystified"
weight: 30
---

# Linker Scripts Demystified

The linker script is the contract between the compiled firmware and the physical memory of the target MCU. It tells the linker where flash begins, how large SRAM is, and which sections of the program go where. On a Cortex-M, the linker script also controls the vector table placement, the stack pointer initialization, and the data that the startup code must copy or zero before calling main(). When this file is wrong, the firmware may link successfully but crash immediately at runtime — or worse, run with subtle corruption.

## The MEMORY Block

The MEMORY block defines the physical address ranges available on the target. A typical STM32F411 linker script looks like:

```
MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = 512K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 128K
}
```

The flags `rx` (read/execute) and `rwx` (read/write/execute) describe permitted access. These values must match the datasheet exactly — specifying 256K of RAM on a 128K device causes no linker error but produces firmware that writes to nonexistent memory.

## The SECTIONS Block

SECTIONS maps compiled output into the defined memory regions. The essential sections for a Cortex-M project:

- **.isr_vector** — The vector table (stack pointer + exception/interrupt handler addresses), placed at the very start of flash. The Cortex-M core reads the initial stack pointer from address 0x08000000 and the reset handler from 0x08000004.
- **.text** — Executable code, placed in flash after the vector table.
- **.rodata** — Read-only constants (string literals, const arrays), also in flash.
- **.data** — Initialized global variables. Stored in flash (load address) but copied to RAM (runtime address) by the startup code. The linker provides symbols `_sdata`, `_edata`, and `_sidata` so the startup code knows the source and destination.
- **.bss** — Zero-initialized globals. Placed in RAM with linker symbols `_sbss` and `_ebss` so the startup code can zero the region.
- **.stack** / ._user_heap_stack — Reserves space at the end of RAM for the stack and heap.

## The Startup Sequence

Before main() executes, the startup code (usually `startup_stm32f4xx.s` or equivalent) runs the Reset_Handler, which performs three critical steps: copies .data from flash to SRAM using the `_sidata`, `_sdata`, and `_edata` symbols; zeroes .bss from `_sbss` to `_ebss`; then calls SystemInit (clock configuration) followed by main(). If any of these steps are skipped or the symbols are wrong, initialized globals contain flash-address garbage and .bss variables are not zeroed.

## Reading Build Output

`arm-none-eabi-size -A firmware.elf` shows the size of each section in bytes. A healthy output for a small project might show: .text at 24 KB, .rodata at 3 KB, .data at 512 bytes, .bss at 8 KB. The flash usage is .text + .rodata + .data (the initial values). The SRAM usage is .data + .bss + stack + heap. The map file (`-Wl,-Map=firmware.map`) provides exact addresses and shows which object files contribute the most to each section — essential for tracking down unexpected memory growth.

## Tips

- Always regenerate the linker script when switching to a different MCU variant in the same family — a script for a 512K flash part will link without error on a 256K part, but the firmware will overrun physical flash.
- Use `KEEP()` around the vector table and any sections referenced only by address (not by symbol) to prevent the linker from discarding them with `--gc-sections`.
- Add `ASSERT(. <= ORIGIN(RAM) + LENGTH(RAM), "RAM overflow")` at the end of the RAM sections to catch SRAM overflows at link time instead of runtime.
- Check `arm-none-eabi-size` output in CI — a build that suddenly gains 20 KB of .bss usually means someone added a large static buffer.
- Keep a known-good linker script under version control and treat changes to it as carefully as changes to the startup code.

## Caveats

- **A linker script error does not always produce a linker error** — Specifying the wrong RAM size or omitting a section can produce a valid ELF that crashes at runtime with no diagnostic.
- **Section ordering in the linker script matters** — Placing .data before .bss or misordering initialization symbols causes the startup code to copy the wrong data or zero the wrong region.
- **ALIGN directives are not optional** — ARM Cortex-M requires the vector table to be naturally aligned (to a power of two matching the number of vectors). Missing alignment causes a hard fault at reset.
- **Custom sections require explicit placement** — Code or data placed in a user-defined section (e.g., `__attribute__((section(".my_config")))`) will be silently dropped by `--gc-sections` unless the linker script places it with `KEEP()`.
- **The initial stack pointer is not set by software** — The Cortex-M core reads it from the first word of the vector table at reset. If the linker script sets this value incorrectly, the first push instruction corrupts memory before any code can detect the problem.

## In Practice

- Firmware that hard-faults immediately at reset — before any breakpoint in main() is reached — commonly has a vector table alignment issue or an incorrect initial stack pointer value in the linker script.
- Initialized global variables that contain wrong values at the start of main() indicate that the .data copy in the startup code is using mismatched symbols, often because the linker script was modified without updating the startup assembly.
- A build that suddenly reports zero bytes for .data or .bss despite having global variables usually has a linker script that omits those section definitions, causing the linker to silently discard them.
- Firmware that works when flashed with a debugger but fails when loaded via a bootloader often has a vector table at the wrong flash offset — the bootloader expects the application at 0x08010000 but the linker script still targets 0x08000000.
- A project that compiles and links cleanly but crashes in specific functions often has a RAM overflow that the linker did not catch — adding an ASSERT for RAM bounds immediately reveals the conflict.
