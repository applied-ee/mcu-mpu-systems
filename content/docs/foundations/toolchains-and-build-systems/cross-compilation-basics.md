---
title: "Cross-Compilation Basics"
weight: 10
---

# Cross-Compilation Basics

Cross-compilation is the process of building code on one machine (the host) that will run on a different machine (the target). In embedded development, the host is typically an x86_64 Linux or Windows workstation, while the target is an ARM Cortex-M microcontroller with no operating system, no filesystem, and a fraction of the host's memory. The toolchain bridges this gap — it knows the target's instruction set, memory layout, and calling conventions, and produces binaries that the host cannot execute directly.

## The Toolchain and Compilation Pipeline

The standard ARM embedded toolchain is `arm-none-eabi-gcc` — "arm" for the architecture, "none" for no OS, "eabi" for the Embedded Application Binary Interface. The compilation pipeline transforms source into a flashable image in stages: `.c` source files are compiled to `.o` object files, object files are linked into a `.elf` (Executable and Linkable Format) file using a linker script, and the `.elf` is then converted to `.bin` (raw binary) or `.hex` (Intel HEX with address metadata) for flashing. Each stage can be inspected independently — this is where most build issues become visible.

## Key Compiler Flags

Target-specific flags tell the compiler which instructions and hardware features are available. For a Cortex-M4 with a hardware FPU, the typical set is: `-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16`. Omitting `-mfloat-abi=hard` causes the compiler to emit software floating-point calls, which are 10-50x slower for math-heavy code. Optimization levels matter significantly on constrained targets: `-O0` preserves all debug information and variable access but can inflate code size by 2-4x compared to `-Os` (optimize for size). `-O2` favors speed, while `-Os` is often the best default for flash-limited MCUs — an STM32F103 with 64 KB of flash can run out of space at `-O0` on a moderately sized project.

## Output Formats — ELF, BIN, and HEX

The `.elf` file is the richest output — it contains executable code, debug symbols, section headers, and relocation information. Debuggers (GDB, Ozone) consume the `.elf` directly. The `.bin` file is a raw memory image with no metadata; it must be written to a known flash address (typically 0x08000000 on STM32). The `.hex` file (Intel HEX format) encodes both data and addresses in ASCII records, making it self-describing and suitable for production programming tools. Running `arm-none-eabi-objcopy -O binary firmware.elf firmware.bin` strips all metadata. Running `arm-none-eabi-objcopy -O ihex firmware.elf firmware.hex` preserves address information.

## Inspecting the Build Output

`arm-none-eabi-size firmware.elf` reports section sizes — `.text` (code and constants), `.data` (initialized globals), and `.bss` (zero-initialized globals). On a Cortex-M4 with 256 KB flash and 64 KB SRAM, the `.text` + `.data` must fit in flash, while `.data` + `.bss` must fit in RAM. `arm-none-eabi-objdump -d firmware.elf` disassembles the binary, which is essential for verifying that Thumb-2 instructions are being generated and that the vector table is correctly placed at the base of flash.

## Tips

- Always check `arm-none-eabi-size` output after each build — catching flash or RAM overflow early avoids cryptic linker errors or runtime crashes.
- Use `-Os` as the default optimization level and switch to `-O0` only for active debugging sessions, since the code size difference is substantial on small targets.
- Keep the `.elf` file alongside the `.bin`/`.hex` for every release — without it, debugging a field failure requires a full rebuild with the exact same source and toolchain version.
- Add `-Wall -Wextra -Werror` to catch implicit conversions and unused variables, which cause subtle bugs more often on embedded targets than on desktop code.
- Verify the correct toolchain is on `PATH` by running `arm-none-eabi-gcc --version` before diagnosing mysterious build failures — having a desktop `gcc` shadow the cross-compiler is a common misconfiguration.

## Caveats

- **Mixing soft-float and hard-float objects causes linker errors or silent ABI mismatches** — Every object file, library, and startup file in the build must use the same float ABI, and prebuilt libraries from vendors are not always compiled with `-mfloat-abi=hard`.
- **A .bin file has no address information** — Flashing a `.bin` to the wrong base address produces a non-booting device with no error, because the tool has no way to detect the mismatch.
- **Optimization can remove code the debugger expects** — At `-O2` or `-Os`, the compiler may inline functions, reorder statements, or eliminate variables entirely, making single-stepping appear to jump unpredictably.
- **The host toolchain cannot run the output** — Accidentally invoking the system `gcc` instead of `arm-none-eabi-gcc` produces an x86 binary that links successfully but is completely non-functional on the target.
- **Toolchain version differences can change code generation** — A project that fits in 64 KB of flash with GCC 10 may overflow with GCC 12 due to different inlining and optimization decisions.

## In Practice

- A build that links without error but produces a device that immediately hard-faults on boot often has a missing or incorrect `-mcpu` flag, causing the compiler to emit instructions the target core does not support.
- A project that suddenly overflows flash after adding a small feature likely had `-O0` enabled, where switching to `-Os` can recover 30-50% of flash space.
- **Floating-point results that are wrong or extremely slow** commonly appear when `-mfloat-abi=soft` is in effect on a Cortex-M4F, forcing all math through software emulation instead of the hardware FPU.
- A firmware image that works when loaded via the debugger but fails when flashed as a `.bin` usually has an incorrect base address in the flashing command — the `.hex` file avoids this class of error entirely.
- **`arm-none-eabi-size` showing 0 bytes in `.text`** typically indicates the linker script is missing or the wrong startup file was linked, so no code was placed in the flash section.
