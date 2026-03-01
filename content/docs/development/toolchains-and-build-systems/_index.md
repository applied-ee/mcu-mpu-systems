---
title: "Toolchains & Build Systems"
weight: 10
bookCollapseSection: true
---

# Toolchains & Build Systems

The toolchain is the machinery that transforms source code into a binary that runs on a specific microcontroller — compiler, assembler, linker, and the associated tools for format conversion, size analysis, and flash programming. Unlike desktop development where the compiler targets the same architecture it runs on, embedded development is inherently cross-compilation: the build machine is an x86 or ARM desktop, but the target is a Cortex-M0 or RISC-V microcontroller with a completely different instruction set and memory model.

Getting the toolchain and build system right is foundational work that pays off throughout a project. A well-structured build produces reproducible binaries, makes it easy to switch between debug and release configurations, and integrates cleanly with flash programming and debugging workflows.

## What This Section Covers

- **[Cross-Compilation Basics]({{< relref "cross-compilation-basics" >}})** — How cross-compilers work, the GCC ARM toolchain, compiler flags that matter for embedded targets, and the object file pipeline from `.c` to `.elf` to `.bin`.
- **[Build Systems — Make, CMake & Beyond]({{< relref "build-systems-make-cmake" >}})** — Organizing embedded builds with Make and CMake: target definitions, compiler flag management, and the patterns that keep multi-file firmware projects maintainable.
- **[Flashing & Boot Modes]({{< relref "flash-and-boot" >}})** — Getting firmware onto the chip: SWD/JTAG programming, UART/USB bootloaders, boot pin configuration, and the reset sequences that select between boot sources.
- **[Vendor SDKs & Hardware Abstraction Layers]({{< relref "vendor-sdks-and-hals" >}})** — STM32 HAL, ESP-IDF, nRF Connect SDK, and other vendor frameworks: what they provide, what they cost in complexity, and when to use them vs bare-metal register access.
