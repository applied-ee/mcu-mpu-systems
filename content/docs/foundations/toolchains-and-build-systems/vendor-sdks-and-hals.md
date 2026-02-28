---
title: "Vendor SDKs & Hardware Abstraction Layers"
weight: 40
---

# Vendor SDKs & Hardware Abstraction Layers

A Hardware Abstraction Layer (HAL) sits between application code and peripheral registers, providing an API that describes intent (configure UART at 115200 baud) rather than mechanism (write 0x00000068 to USART1->BRR). Vendor SDKs bundle a HAL with startup code, linker scripts, middleware, and example projects. The choice of SDK — or the decision to bypass it — affects code size, performance, portability, and debugging difficulty throughout the life of a project.

## STM32 HAL and LL Drivers

STMicroelectronics provides two abstraction levels. The HAL (Hardware Abstraction Layer) offers high-level functions like `HAL_UART_Transmit()` with built-in timeout handling, DMA support, and interrupt callbacks — but each call carries overhead, typically 20-50 extra instructions per peripheral operation compared to direct register access. The LL (Low-Level) drivers are thin inline wrappers around registers: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)` compiles to a single store instruction.

The performance difference across abstraction levels is visible in a GPIO toggle benchmark on a 168 MHz STM32F4:

```c
/* HAL — multiple function calls, parameter validation */
HAL_GPIO_TogglePin(GPIOA, GPIO_PIN_5);  // ~20 cycles, ~1 MHz toggle

/* LL — thin inline wrapper, no validation */
LL_GPIO_TogglePin(GPIOA, LL_GPIO_PIN_5);  // ~5 cycles, ~8 MHz toggle

/* Direct register access — single read-modify-write */
GPIOA->ODR ^= (1 << 5);  // ~3 cycles

/* BSRR for atomic set/clear — single write, no read */
GPIOA->BSRR = (1 << 5);  // ~2 cycles, set only
GPIOA->BSRR = (1 << 21); // ~2 cycles, clear only (bit + 16)
```

A common pattern is using HAL for complex peripherals (USB, Ethernet) and LL for performance-critical paths (GPIO toggling, fast ADC reads). The HAL-vs-register decision is not binary — even within a single project, different peripherals warrant different levels of abstraction.

## CubeMX Code Generation Workflow

STM32CubeMX generates initialization code (clock configuration, peripheral setup, pin mapping) into a project skeleton. The generated files contain paired markers — `/* USER CODE BEGIN */` and `/* USER CODE END */` — that delineate protected regions. Application code placed between these markers survives regeneration; anything outside them is overwritten. The intended workflow is: configure peripherals in CubeMX, generate, add application logic inside user-code blocks, and regenerate freely as pin assignments or clock trees change. Keeping generated code in version control makes it possible to diff what CubeMX changed between regeneration cycles. Placing substantial application logic in separate source files (not in the generated `main.c`) minimizes the risk of accidental overwrites and keeps the project structure clean.

## Bare-Metal Register Access

Direct register access bypasses all abstraction layers and manipulates peripheral control registers through CMSIS-provided struct pointers (e.g., `GPIOA->MODER`, `USART1->CR1`). This approach produces the smallest and fastest code, but requires reading the reference manual for every register field. The tradeoff is readability: `USART1->BRR = 0x0683;` conveys nothing about the baud rate without consulting the manual, while `HAL_UART_Init(&huart1)` with a configuration struct is self-documenting. Register-level code is appropriate for time-critical interrupt handlers, bit-banged protocols, and situations where the HAL introduces unacceptable latency or does not expose a needed feature. STM32CubeMX generates initialization code for both HAL and LL layers and produces Makefile or CMake projects.

## ESP-IDF

Espressif's ESP-IDF is a FreeRTOS-based SDK for the ESP32 family. It uses a component system where each peripheral, protocol stack, and middleware library is a self-contained component with its own `CMakeLists.txt`. Configuration is handled through `menuconfig` (Kconfig), exposing hundreds of options from WiFi TX power to FreeRTOS tick rate. The API is callback-driven: `esp_wifi_init()` configures the radio, and event handlers process connection state changes asynchronously. Flash layout is partition-table driven, supporting OTA updates natively. Typical compiled binary sizes start around 200 KB for a minimal WiFi application — substantially larger than bare-metal Cortex-M projects due to the integrated RTOS, WiFi stack, and TLS library.

## nRF Connect SDK and Zephyr

Nordic Semiconductor's nRF Connect SDK builds on Zephyr RTOS and uses devicetree for hardware description. Peripherals are configured in `.dts` overlay files rather than in C code — a UART's baud rate, pin assignment, and interrupt priority are all declared in devicetree and resolved at compile time. The build system is CMake with west (a meta-tool for managing repositories). Zephyr's driver model provides a uniform API across vendors: `uart_poll_out(dev, ch)` works identically on nRF52, STM32, and other Zephyr-supported chips. This portability comes at the cost of a steep learning curve — understanding devicetree, Kconfig, and west is required before writing the first line of application code.

## RP2040 Pico SDK and CMSIS

The Raspberry Pi Pico SDK takes a minimalist approach: lightweight C functions, clear documentation, and no RTOS dependency. `gpio_put(25, 1)` toggles a pin; `spi_write_blocking(spi0, data, len)` sends SPI data. The entire SDK is readable in a few days, making it a strong choice for learning and prototyping. CMSIS (Cortex Microcontroller Software Interface Standard) is ARM's vendor-neutral standard providing core register definitions, DSP/math functions (CMSIS-DSP), and a neural-network inference library (CMSIS-NN). CMSIS headers are used underneath most vendor HALs and are the foundation for writing portable bare-metal code across any Cortex-M device.

## Tips

- Use the vendor HAL for initial bring-up and prototyping, then replace performance-critical sections with LL or direct register access once the system is functional — optimizing before the hardware is proven wastes effort.
- Read the HAL source code, not just the API documentation — understanding what `HAL_SPI_Transmit()` does internally reveals timeout behavior, interrupt masking, and error recovery that the docs often omit.
- Pin the SDK version in version control (git submodule or package lock) — vendor SDKs receive frequent updates that can change peripheral behavior or default configurations.
- Use CMSIS-DSP functions (`arm_fir_f32`, `arm_rfft_fast_f32`) instead of hand-written math for DSP tasks — they are hand-optimized in assembly for each Cortex-M variant and significantly outperform naive C implementations.
- When evaluating a new vendor platform, build and flash the SDK's blinky example first — if the toolchain, flasher, and basic GPIO work, the platform's development story is likely solid.
- Keep CubeMX-generated code and application logic in separate source files — this reduces the surface area exposed to regeneration and makes it practical to diff generated changes in version control.
- For register-level debugging, keep the reference manual's register map open alongside the debugger's peripheral view — vendor HAL source often obscures which bits are actually being set.

## Caveats

- **HAL overhead is measurable in tight loops** — An STM32 HAL GPIO toggle at 168 MHz produces a ~1 MHz waveform; the same operation via direct register access reaches 42 MHz. For bit-banged protocols and fast sampling, HAL latency is not acceptable.
- **Generated code from CubeMX overwrites manual edits** — Code placed outside the designated `USER CODE BEGIN` / `USER CODE END` blocks is silently deleted on regeneration, a common source of lost work.
- **Vendor SDK bugs exist and are often version-specific** — STM32 HAL has had documented issues with I2C repeated-start handling and SPI DMA in specific versions; checking the errata and release notes before updating is essential. Pinning to a known-good SDK version and updating deliberately (not automatically) avoids surprises.
- **Zephyr's devicetree model is unfamiliar to most embedded developers** — Misconfigured pin assignments or missing node references produce build errors that are difficult to diagnose without understanding the devicetree compilation process.
- **ESP-IDF's large binary size is not always reducible** — Even with `menuconfig` trimming, the WiFi and TLS stacks consume ~150 KB of flash as a baseline, which constrains application code on parts with limited flash.
- **Mixing HAL and LL calls on the same peripheral can leave it in an inconsistent state** — The HAL maintains internal state structs that LL bypasses entirely; if LL modifies a register that the HAL tracks, subsequent HAL calls may behave incorrectly.

## In Practice

- A peripheral that initializes without error but produces no output often has a clock that was not enabled — HAL init functions typically enable peripheral clocks, but LL and bare-metal code require explicit `RCC` register writes that are easy to overlook.
- **An interrupt handler that fires once but never again** commonly appears when the HAL's interrupt flag clearing mechanism was bypassed — mixing direct register access with HAL calls in the same ISR can leave flags in an unexpected state.
- A Zephyr project that fails to compile after changing a pin assignment usually has a devicetree overlay error — missing semicolons, incorrect node paths, or property type mismatches produce errors that reference generated headers rather than the source `.dts` file.
- **A function that takes 500 us when the datasheet says the peripheral should complete in 10 us** is likely using the HAL's polled implementation with timeout overhead; switching to LL or DMA-based transfer resolves the latency.
- An ESP-IDF project that runs out of heap despite allocating only 20 KB typically has the WiFi stack, TLS, and MQTT client consuming 80-120 KB of heap at runtime — `heap_caps_get_free_size()` reveals the actual available memory after system initialization.
- **CubeMX regeneration that silently breaks functionality** often results from application code placed outside `USER CODE` blocks — diffing the generated files before and after regeneration in version control immediately reveals what was overwritten.
- A bare-metal register write that appears to have no effect often targets a peripheral whose clock has not been enabled in the `RCC` registers — unlike the HAL, direct register code receives no automatic clock gating, and writes to an unclocked peripheral are silently ignored.
