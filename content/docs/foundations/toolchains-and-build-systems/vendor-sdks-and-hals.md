---
title: "Vendor SDKs & Hardware Abstraction Layers"
weight: 40
---

# Vendor SDKs & Hardware Abstraction Layers

A Hardware Abstraction Layer (HAL) sits between application code and peripheral registers, providing an API that describes intent (configure UART at 115200 baud) rather than mechanism (write 0x00000068 to USART1->BRR). Vendor SDKs bundle a HAL with startup code, linker scripts, middleware, and example projects. The choice of SDK — or the decision to bypass it — affects code size, performance, portability, and debugging difficulty throughout the life of a project.

## STM32 HAL and LL Drivers

STMicroelectronics provides two abstraction levels. The HAL (Hardware Abstraction Layer) offers high-level functions like `HAL_UART_Transmit()` with built-in timeout handling, DMA support, and interrupt callbacks — but each call carries overhead, typically 20-50 extra instructions per peripheral operation compared to direct register access. The LL (Low-Level) drivers are thin inline wrappers around registers: `LL_GPIO_SetOutputPin(GPIOA, LL_GPIO_PIN_5)` compiles to a single store instruction. A common pattern is using HAL for complex peripherals (USB, Ethernet) and LL for performance-critical paths (GPIO toggling, fast ADC reads). STM32CubeMX generates initialization code for both layers and produces Makefile or CMake projects.

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

## Caveats

- **HAL overhead is measurable in tight loops** — An STM32 HAL GPIO toggle at 168 MHz produces a ~1 MHz waveform; the same operation via direct register access reaches 42 MHz. For bit-banged protocols and fast sampling, HAL latency is not acceptable.
- **Generated code from CubeMX overwrites manual edits** — Code placed outside the designated `USER CODE BEGIN` / `USER CODE END` blocks is silently deleted on regeneration, a common source of lost work.
- **Vendor SDK bugs exist and are often version-specific** — STM32 HAL has had documented issues with I2C repeated-start handling and SPI DMA in specific versions; checking the errata and release notes before updating is essential.
- **Zephyr's devicetree model is unfamiliar to most embedded developers** — Misconfigured pin assignments or missing node references produce build errors that are difficult to diagnose without understanding the devicetree compilation process.
- **ESP-IDF's large binary size is not always reducible** — Even with `menuconfig` trimming, the WiFi and TLS stacks consume ~150 KB of flash as a baseline, which constrains application code on parts with limited flash.

## In Practice

- A peripheral that initializes without error but produces no output often has a clock that was not enabled — HAL init functions typically enable peripheral clocks, but LL and bare-metal code require explicit `RCC` register writes that are easy to overlook.
- **An interrupt handler that fires once but never again** commonly appears when the HAL's interrupt flag clearing mechanism was bypassed — mixing direct register access with HAL calls in the same ISR can leave flags in an unexpected state.
- A Zephyr project that fails to compile after changing a pin assignment usually has a devicetree overlay error — missing semicolons, incorrect node paths, or property type mismatches produce errors that reference generated headers rather than the source `.dts` file.
- **A function that takes 500 us when the datasheet says the peripheral should complete in 10 us** is likely using the HAL's polled implementation with timeout overhead; switching to LL or DMA-based transfer resolves the latency.
- An ESP-IDF project that runs out of heap despite allocating only 20 KB typically has the WiFi stack, TLS, and MQTT client consuming 80-120 KB of heap at runtime — `heap_caps_get_free_size()` reveals the actual available memory after system initialization.
