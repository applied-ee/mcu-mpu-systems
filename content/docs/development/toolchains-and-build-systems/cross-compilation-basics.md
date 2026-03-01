---
title: "Cross-Compilation Basics"
weight: 10
---

# Cross-Compilation Basics

Cross-compilation is the process of building code on one machine (the host) that will run on a different machine (the target). In embedded development, the host is typically an x86_64 Linux or Windows workstation, while the target is an ARM Cortex-M microcontroller with no operating system, no filesystem, and a fraction of the host's memory. The toolchain bridges this gap — it knows the target's instruction set, memory layout, and calling conventions, and produces binaries that the host cannot execute directly.

## The Toolchain and Compilation Pipeline

The standard ARM embedded toolchain is `arm-none-eabi-gcc` — "arm" for the architecture, "none" for no OS, "eabi" for the Embedded Application Binary Interface. The full compilation pipeline has five distinct stages, each producing an inspectable intermediate artifact:

1. **Preprocessor (`cpp`)** — Expands `#include` directives, macros, and conditional compilation (`#ifdef`). Output is a single translation unit with all headers inlined. Inspect with `arm-none-eabi-gcc -E main.c -o main.i`.
2. **Compiler (`cc1`)** — Translates preprocessed C into assembly for the target architecture. This stage applies optimization (`-Os`, `-O2`) and emits Thumb-2 instructions for Cortex-M. Inspect with `arm-none-eabi-gcc -S main.c -o main.s`.
3. **Assembler (`as`)** — Converts assembly into a relocatable object file (`.o`) containing machine code with unresolved symbol references. Each `.c` file produces one `.o`.
4. **Linker (`ld`)** — Combines all `.o` files and libraries into a single `.elf`, resolving symbols and placing sections at addresses defined by the linker script. The linker script controls where `.text`, `.data`, `.bss`, and the vector table land in flash and RAM.
5. **`objcopy` (binary/hex output)** — Strips metadata from the `.elf` to produce a raw `.bin` or address-annotated `.hex` for flashing tools.

Each stage can be invoked independently, making it possible to inspect exactly where a build issue originates — whether a macro expanded incorrectly (preprocessor), an unexpected instruction was emitted (compiler), or a symbol went unresolved (linker).

## Newlib vs Newlib-Nano

The `arm-none-eabi` toolchain ships with two C library variants. Full `newlib` includes complete `printf`/`scanf` with float formatting support, wide-character functions, and a full `malloc` implementation. `newlib-nano` (selected via `--specs=nano.specs`) strips float formatting from `printf`/`scanf`, uses a simpler `malloc`, and removes rarely used functions.

The size impact is significant: switching from `newlib` to `newlib-nano` typically saves 20–50 KB of flash — often the difference between fitting in a 64 KB part or requiring the next size up. If float formatting is needed with `newlib-nano`, it can be re-enabled selectively with `-u _printf_float`, adding back only ~8 KB. The `--specs=nosys.specs` flag further avoids linking OS-level syscall implementations (file I/O, process management), which are meaningless on bare-metal targets and would otherwise require stub functions.

## Dead Code Elimination with GC Sections

By default, the linker includes entire object files even if only one function is referenced. The combination of `-ffunction-sections -fdata-sections` (compiler flags) and `--gc-sections` (linker flag) enables fine-grained dead code elimination. The compiler flags place each function and global variable into its own ELF section (e.g., `.text.main`, `.text.helper_func`). The linker's `--gc-sections` pass then traces references from the entry point and discards any section not reachable. On a typical project using a vendor HAL, this combination removes 30–60% of the HAL library code that was linked but never called. The `--print-gc-sections` linker flag lists every discarded section, which is useful for verifying that the expected dead code is being removed.

## Key Compiler Flags

Target-specific flags tell the compiler which instructions and hardware features are available. For a Cortex-M4 with a hardware FPU, the typical set is:

```
-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16
```

- `-mcpu=cortex-m4` selects the instruction set and pipeline scheduling for the specific core.
- `-mthumb` generates Thumb-2 instructions (16/32-bit mixed encoding), which is the only mode supported on Cortex-M.
- `-mfloat-abi=hard` passes floating-point arguments in FPU registers; omitting this causes the compiler to emit software floating-point calls, which are 10–50x slower for math-heavy code.
- `-mfpu=fpv4-sp-d16` identifies the specific FPU variant (single-precision, 16 double-word registers on Cortex-M4).

Optimization levels matter significantly on constrained targets: `-O0` preserves all debug information and variable access but can inflate code size by 2–4x compared to `-Os` (optimize for size). `-O2` favors speed, while `-Os` is often the best default for flash-limited MCUs — an STM32F103 with 64 KB of flash can run out of space at `-O0` on a moderately sized project. The `-Og` level is designed for debugging: it enables optimizations that do not interfere with the debug experience, producing smaller code than `-O0` while keeping most variables and control flow inspectable.

## Output Formats — ELF, BIN, and HEX

The `.elf` file is the richest output — it contains executable code, debug symbols, section headers, and relocation information. Debuggers (GDB, Ozone) consume the `.elf` directly. The `.bin` file is a raw memory image with no metadata; it must be written to a known flash address (typically 0x08000000 on STM32). The `.hex` file (Intel HEX format) encodes both data and addresses in ASCII records, making it self-describing and suitable for production programming tools. Running `arm-none-eabi-objcopy -O binary firmware.elf firmware.bin` strips all metadata. Running `arm-none-eabi-objcopy -O ihex firmware.elf firmware.hex` preserves address information.

## Inspecting the Build Output

`arm-none-eabi-size firmware.elf` reports section sizes — `.text` (code and constants), `.data` (initialized globals), and `.bss` (zero-initialized globals). On a Cortex-M4 with 256 KB flash and 64 KB SRAM, the `.text` + `.data` must fit in flash, while `.data` + `.bss` must fit in RAM. `arm-none-eabi-objdump -d firmware.elf` disassembles the binary, which is essential for verifying that Thumb-2 instructions are being generated and that the vector table is correctly placed at the base of flash.

Running `arm-none-eabi-objdump -h firmware.elf` prints the section headers table, revealing each section's name, size, virtual memory address (VMA), load memory address (LMA), and alignment. The VMA shows where the section resides at runtime (e.g., `.data` in SRAM at 0x20000000), while the LMA shows where it is stored in flash (e.g., 0x08003A00). A mismatch between expected and actual addresses in this table is an immediate indicator of a linker script error. Sections like `.text` and `.rodata` should have VMA and LMA both in the flash region; `.bss` should have zero LMA size since it carries no initialization data.

## Tips

- Always check `arm-none-eabi-size` output after each build — catching flash or RAM overflow early avoids cryptic linker errors or runtime crashes.
- Use `-Os` as the default optimization level and switch to `-O0` only for active debugging sessions, since the code size difference is substantial on small targets.
- Keep the `.elf` file alongside the `.bin`/`.hex` for every release — without it, debugging a field failure requires a full rebuild with the exact same source and toolchain version.
- Add `-Wall -Wextra -Werror` to catch implicit conversions and unused variables, which cause subtle bugs more often on embedded targets than on desktop code.
- Verify the correct toolchain is on `PATH` by running `arm-none-eabi-gcc --version` before diagnosing mysterious build failures — having a desktop `gcc` shadow the cross-compiler is a common misconfiguration.
- Combine `--specs=nano.specs` with `-ffunction-sections -fdata-sections` and `--gc-sections` as a baseline — together, these flags often reduce a HAL-based project from 80 KB to under 30 KB.
- Use `arm-none-eabi-nm --size-sort firmware.elf` to identify the largest individual symbols when chasing flash usage — this is faster than reading the full map file for a quick size audit.

## Caveats

- **Mixing soft-float and hard-float objects causes linker errors or silent ABI mismatches** — Every object file, library, and startup file in the build must use the same float ABI, and prebuilt libraries from vendors are not always compiled with `-mfloat-abi=hard`.
- **A .bin file has no address information** — Flashing a `.bin` to the wrong base address produces a non-booting device with no error, because the tool has no way to detect the mismatch.
- **Optimization can remove code the debugger expects** — At `-O2` or `-Os`, the compiler may inline functions, reorder statements, or eliminate variables entirely, making single-stepping appear to jump unpredictably. Using `-Og` mitigates this during development.
- **The host toolchain cannot run the output** — Accidentally invoking the system `gcc` instead of `arm-none-eabi-gcc` produces an x86 binary that links successfully but is completely non-functional on the target.
- **Toolchain version differences can change code generation** — A project that fits in 64 KB of flash with GCC 10 may overflow with GCC 12 due to different inlining and optimization decisions.
- **`--gc-sections` can remove functions that are only called via function pointers** — If the linker cannot trace the reference statically (e.g., a callback table populated at runtime), the function's section is discarded. Marking such functions with `__attribute__((used))` or listing them in a `KEEP()` directive in the linker script prevents this.

## In Practice

- A build that links without error but produces a device that immediately hard-faults on boot often has a missing or incorrect `-mcpu` flag, causing the compiler to emit instructions the target core does not support.
- A project that suddenly overflows flash after adding a small feature likely had `-O0` enabled, where switching to `-Os` can recover 30-50% of flash space.
- **Floating-point results that are wrong or extremely slow** commonly appear when `-mfloat-abi=soft` is in effect on a Cortex-M4F, forcing all math through software emulation instead of the hardware FPU.
- A firmware image that works when loaded via the debugger but fails when flashed as a `.bin` usually has an incorrect base address in the flashing command — the `.hex` file avoids this class of error entirely.
- **`arm-none-eabi-size` showing 0 bytes in `.text`** typically indicates the linker script is missing or the wrong startup file was linked, so no code was placed in the flash section.
- Adding a single `printf("%f", val)` call that pulls in full `newlib` float formatting can inflate flash usage by 30+ KB on a `newlib-nano` build — the `--print-gc-sections` flag reveals this by showing that the float formatting code was not garbage-collected.
- A project using `--gc-sections` that still contains unreferenced HAL functions in the final binary likely compiled without `-ffunction-sections`, so the linker received monolithic object files and could not discard individual functions.
- **`objdump -h` showing `.data` LMA outside the flash region** indicates the linker script's `AT>` directive is missing or incorrect — the startup code will copy from the wrong address, producing garbage in initialized globals.
