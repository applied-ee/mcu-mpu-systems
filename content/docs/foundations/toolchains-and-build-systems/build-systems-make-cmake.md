---
title: "Build Systems — Make, CMake & Beyond"
weight: 20
---

# Build Systems — Make, CMake & Beyond

A build system turns source files into flashable firmware reproducibly. Without one, every build requires remembering the exact compiler flags, include paths, linker scripts, and object file order — a process that breaks the moment the project moves to a different machine or a new developer. Even a 10-file embedded project benefits from a Makefile; larger projects with multiple libraries and configuration variants need something more structured like CMake or PlatformIO.

## Makefile Basics for Embedded

A minimal embedded Makefile defines the toolchain prefix, CPU-specific flags, and pattern rules for compilation. The core variables are `CC = arm-none-eabi-gcc`, `CFLAGS = -mcpu=cortex-m4 -mthumb -Os -Wall`, and `LDFLAGS = -T linkerscript.ld -nostdlib`. Pattern rules like `%.o: %.c` let Make infer how to build each object file, and the final link step produces the `.elf`. Incremental builds are Make's primary advantage — only modified `.c` files trigger recompilation, cutting rebuild times from 30 seconds to under 2 seconds on a typical project.

## Dependency Tracking with -MMD -MP

Header file changes are invisible to Make unless dependency tracking is configured. The `-MMD` compiler flag generates a `.d` file alongside each `.o` file, listing every header that the source file includes (directly or transitively). The `-MP` flag adds phony targets for each header, preventing Make errors when a header is deleted. Including the generated `.d` files in the Makefile (via `-include $(DEPS)`) ensures that modifying any header triggers recompilation of every source file that depends on it. Without these flags, changing a struct definition in a header produces no recompilation — the stale object files link successfully but the resulting firmware has mismatched struct layouts, causing corruption that is extremely difficult to diagnose at runtime.

## CMake for Embedded Projects

CMake adds a layer of abstraction: a `CMakeLists.txt` file describes the project, and CMake generates the actual Makefile (or Ninja build file). For cross-compilation, a toolchain file sets `CMAKE_SYSTEM_NAME`, `CMAKE_C_COMPILER`, and CPU flags. A typical Cortex-M4 toolchain file looks like:

```cmake
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_C_FLAGS_INIT "-mcpu=cortex-m4 -mthumb -mfloat-abi=hard -mfpu=fpv4-sp-d16")
set(CMAKE_EXE_LINKER_FLAGS_INIT "-specs=nano.specs -specs=nosys.specs")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
```

The project `CMakeLists.txt` then uses `add_executable(firmware main.c startup.c)`, `target_compile_options()` for flags, and `target_link_options(-T ${LINKER_SCRIPT})` for the linker script. Invoking CMake with `-DCMAKE_TOOLCHAIN_FILE=arm-toolchain.cmake` selects the cross-compiler before any project code is evaluated. CMake handles dependency tracking, out-of-tree builds, and conditional compilation cleanly. STM32CubeMX generates CMake projects natively as of recent versions, and the nRF Connect SDK (Zephyr-based) uses CMake as its primary build system.

## PlatformIO as an Alternative

PlatformIO wraps the entire toolchain, build system, and library management into a single tool. A `platformio.ini` file specifying `platform = ststm32`, `board = nucleo_f446re`, and `framework = stm32cube` is enough to build and flash without any manual toolchain setup. Library dependencies are resolved automatically from a central registry. The tradeoff is less visibility into the build process — when something goes wrong at the linker level, diagnosing it requires understanding what PlatformIO is doing underneath. Running `pio run -v` enables verbose output showing the exact compiler and linker commands, which is essential for debugging build failures. For teams that need fast iteration without deep build-system expertise, PlatformIO eliminates significant setup overhead. It also supports multiple environments in a single `platformio.ini`, making it straightforward to build the same firmware for different boards or with different configurations (debug vs. release) from one project.

## Map File Reading

The linker map file (generated with `-Wl,-Map=firmware.map`) is the most detailed view of where flash and RAM are spent. It lists every symbol, its size, the object file it came from, and its final address. Sorting by size reveals the largest functions — a single `sprintf` call pulling in full `newlib` formatting can add 30 KB that is not obvious from `arm-none-eabi-size` alone. The map file also shows cross-reference information: which object files reference which symbols, making it possible to trace why an unwanted library function was linked. Searching for `.text.*` section names after enabling `-ffunction-sections` reveals individual function sizes, which is essential for targeted optimization on flash-constrained targets.

## CI Integration

Embedding the cross-compilation toolchain in a CI pipeline ensures that every commit produces a reproducible build. A common pattern uses a Docker container with a pinned toolchain version (e.g., `arm-none-eabi-gcc 12.3`), the build system, and flashing tools. The CI pipeline typically performs three steps:

1. **Build** — Run `make` or `cmake --build` inside the container, producing `.elf`, `.bin`, and `.map` artifacts.
2. **Size check** — Parse `arm-none-eabi-size` output and fail the build if `.text` + `.data` exceeds the flash budget or `.data` + `.bss` exceeds the RAM budget.
3. **Archive** — Store the `.elf`, `.bin`, `.hex`, and `.map` as build artifacts for traceability and deployment.

Size budget enforcement is typically a shell comparison or a small script that extracts section totals and compares against a threshold stored in the repository. This catches flash creep before it reaches hardware testing — a 500-byte increase per week goes unnoticed until the build suddenly overflows, but a CI gate catches it on the commit that introduced the growth.

## Separating Source, Build, and Configuration

Keeping source files (`src/`), build artifacts (`build/`), and configuration (linker scripts, toolchain files) in separate directories prevents accidental commits of object files and makes clean builds trivial (`rm -rf build/`). Debug and release configurations should be separate build directories or CMake presets — mixing `-O0` debug objects with `-Os` release objects in the same directory causes subtle, hard-to-trace inconsistencies. A typical structure places the linker script in a `ld/` or `config/` directory, startup assembly in `src/` alongside application code, and generated outputs in `build/debug/` or `build/release/`.

## Tips

- Always use out-of-tree builds (a dedicated `build/` directory) — in-tree builds scatter `.o` and `.d` files alongside source and make version control noisy.
- Add a `size` target to the Makefile that runs `arm-none-eabi-size` on the output `.elf` after every build — monitoring flash and RAM usage continuously catches overflows early.
- Store compiler flags in a single variable and echo them during the build so that the exact flags used are visible in CI logs and build output.
- Use `make -j$(nproc)` for parallel builds — a 50-file project that takes 20 seconds sequentially often completes in 3-4 seconds with parallel compilation.
- Pin the toolchain version in CI (e.g., `arm-none-eabi-gcc 12.2`) to ensure builds are byte-identical across machines and over time.
- Generate and archive the map file (`-Wl,-Map=firmware.map`) in every CI build — when a commit causes unexpected size growth, the map file diff immediately shows which symbols grew or appeared.
- Use CMake presets (`CMakePresets.json`) to define debug and release configurations — this replaces ad-hoc shell scripts and makes `cmake --preset release` a single reproducible command for any developer or CI runner.

## Caveats

- **Make does not track flag changes by default** — Changing `CFLAGS` without modifying any source file results in no recompilation; a `make clean && make` is required, or the Makefile must explicitly depend on its own contents.
- **Forgetting `-nostdlib` links against the host C library** — The default linker behavior pulls in `libc` for x86, causing massive binaries and undefined symbol errors for syscalls like `_sbrk` or `_write`.
- **CMake caches are persistent and sticky** — Changing the toolchain file or compiler path after the first `cmake` invocation may not take effect until the build directory is deleted entirely. Deleting the `build/` directory and re-running `cmake` is the reliable fix.
- **PlatformIO version updates can change build behavior** — A library that compiled cleanly last month may fail after a `pio upgrade` because a dependency's version constraint was relaxed upstream.
- **Parallel builds can mask dependency errors** — A Makefile that works with `make -j1` but fails with `make -j8` has a missing dependency declaration, where one object file depends on a generated header that has not been built yet.
- **Map file sizes can be misleading without context** — The raw `.elf` file size includes debug sections that are not flashed; always use `arm-none-eabi-size` or parse the map file's memory summary to determine actual flash and RAM consumption.

## In Practice

- A build that always recompiles every file despite no changes usually has missing or broken dependency tracking — adding `-MMD -MP` to `CFLAGS` and including the generated `.d` files in the Makefile resolves this.
- **Linker errors about missing `_exit`, `_sbrk`, or `_kill`** commonly appear when `-nostdlib` was omitted or when `newlib` syscall stubs are not provided — adding a `syscalls.c` with minimal stubs satisfies the linker. Alternatively, `--specs=nosys.specs` provides default no-op stubs for all required syscalls.
- **A map file showing a single function consuming 25 KB** often points to `_vfprintf_r` or `_vfscanf_r` from full `newlib` — this is typically triggered by a single `printf` call and can be resolved by switching to `newlib-nano` or replacing `printf` with a lightweight alternative like `iprintf` (integer-only formatting).
- A project that builds on one developer's machine but fails on another typically has a hardcoded toolchain path or an implicit dependency on a system-installed library that is not present in the cross-compilation sysroot.
- **An `.elf` that is unexpectedly 500 KB on a 256 KB flash target** often contains debug sections (`.debug_info`, `.debug_line`) — these do not get flashed, but `arm-none-eabi-size` must be used instead of `ls -l` to determine actual flash usage.
- A CMake build that ignores changes to the linker script likely has the script listed only in `target_link_options()` and not in `set_target_properties(LINK_DEPENDS)`, so CMake does not know to re-link when the script changes.
