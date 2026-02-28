---
title: "Popular MCU Families Compared"
weight: 30
---

# Popular MCU Families Compared

No single MCU family is best for everything. Each has a core strength — wireless integration, toolchain maturity, price, or community momentum — and a set of tradeoffs that make it a poor fit for certain projects. Understanding what each family does well, and where it struggles, prevents the common mistake of choosing a chip based on familiarity rather than fit.

## Family Overview

| Family | Core | Clock (MHz) | Flash | RAM | Wireless | Typical Price (1K) |
|--------|------|-------------|-------|-----|----------|-------------------|
| STM32F4 | Cortex-M4F | 168 | 256 KB–2 MB | 128–256 KB | No | $3–6 |
| STM32H7 | Cortex-M7 | 480 | 128 KB–2 MB | 1 MB | No | $7–12 |
| ESP32-S3 | Xtensa LX7 (dual) | 240 | 8 MB (ext) | 512 KB | WiFi + BLE 5 | $2–3 |
| nRF52840 | Cortex-M4F | 64 | 1 MB | 256 KB | BLE 5.3, 802.15.4 | $3–5 |
| nRF5340 | Cortex-M33 + M4 | 128/64 | 1 MB | 512 KB | BLE 5.4, direction finding | $4–6 |
| RP2040 | Cortex-M0+ (dual) | 133 | 16 MB (ext) | 264 KB | No | $0.70 |
| ATmega328P | AVR (8-bit) | 20 | 32 KB | 2 KB | No | $1.50 |
| PIC18F | PIC (8-bit) | 64 | 128 KB | 4 KB | No | $1–2 |
| ESP32-C3 | RISC-V | 160 | 4 MB (ext) | 400 KB | WiFi + BLE 5 | $1–2 |
| CH32V003 | RISC-V | 48 | 16 KB | 2 KB | No | $0.10 |

## STM32 — The Broad Range

ST's STM32 line spans from the ultra-low-power L0 (Cortex-M0+, 32 MHz, sub-uA stop) to the H7 (Cortex-M7, 480 MHz, 1 MB RAM). CubeMX generates peripheral initialization code, and the HAL library covers most peripherals. The ecosystem is mature: Keil, IAR, GCC, and CubeIDE all work. The weakness is complexity — the HAL is verbose, CubeMX-generated code can be opaque, and the sheer number of part variants (over 1,000 SKUs) makes selection itself a project. Supply chain exposure became a headline issue during 2021–2023: STM32F4 and STM32H7 lead times stretched to 52+ weeks, and spot pricing for some parts exceeded 10x the normal rate. ST manufactures primarily through a small number of fabs, making the line vulnerable to single-source disruption. Designing with pin-compatible alternatives (GD32, AT32 from Artery) or maintaining a firmware HAL that can retarget to a different family provides insurance.

## ESP32 — WiFi and BLE Built In

The ESP32 family (original, S2, S3, C3, C6) integrates WiFi and Bluetooth on a single module for under $3. ESP-IDF provides FreeRTOS-based firmware with mature WiFi/BLE stacks, OTA updates, and HTTPS client support. The tradeoff is power — an ESP32-S3 in active WiFi mode draws 180-240 mA, making it unsuitable for coin-cell applications. Deep-sleep current on modules (as opposed to bare SoCs) is often 50–200 uA due to onboard regulators and flash leakage, significantly higher than Nordic's nRF52 series at 1–2 uA system-off. GPIO count is limited on smaller modules (ESP32-C3 has 22 GPIO), and the ADC is notably noisy (ENOB around 9 bits without calibration). Espressif is a single-source vendor with no pin-compatible second sources; however, the low price point and wide module availability from multiple assembly houses reduce practical supply risk for most projects.

## nRF52/nRF53 — BLE Specialists

Nordic's nRF52840 and nRF5340 are the default choice for BLE-centric products. The SoftDevice (nRF52) or network core (nRF5340) handles the BLE stack independently, leaving the application core free. Zephyr RTOS is the primary SDK, with strong support for Bluetooth Mesh, Thread, and Matter. Power consumption in BLE advertising mode is 5-10 uA average, and system-off current is under 1 uA — substantially lower than ESP32 modules in deep sleep. The limitation is non-wireless peripherals — no USB host on most variants, limited timer count compared to STM32, and no built-in WiFi. Nordic is sole-source for nRF parts, but long-term availability has been reasonable, and the nRF54 series is the announced successor with backward-compatible software support through Zephyr.

## RP2040 — Simplicity and PIO

The RP2040 stands out for its $0.70 price, dual Cortex-M0+ cores, and Programmable I/O (PIO) state machines that can implement custom protocols (WS2812, VGA, SDIO) in hardware. The SDK is clean and well-documented. The RP2350 (announced as RP2040's successor) adds Cortex-M33 cores with an FPU, security features (ARM TrustZone), and more GPIO. Limitations of the RP2040 include no internal flash (external QSPI flash required), no FPU (floating-point math is software-emulated), no built-in wireless, and 3.3 V only GPIO with no 5 V tolerance. The Raspberry Pi Foundation is a single source, but the $0.70 price point and broad distribution reduce practical supply risk for most applications.

## RISC-V — The Open ISA Contenders

RISC-V MCUs are moving from novelty to viable alternatives for cost-sensitive and open-toolchain projects:

- **CH32V series (WCH)** — The CH32V003 is a Cortex-M0-class RISC-V part at $0.10 in quantity, with 16 KB flash and 2 KB SRAM. The CH32V307 steps up to 144 MHz with USB HS, Ethernet MAC, and CAN. Toolchain support is maturing (GCC, MounRiver IDE), but documentation is primarily in Chinese and the community outside China is small.
- **GD32VF103 (GigaDevice)** — A RISC-V alternative to the STM32F103, pin-compatible in many packages. The GD32VF103 runs at 108 MHz with similar peripheral sets. It serves as a drop-in second source for STM32F1-based designs, though peripheral register differences require HAL-level adaptation.
- **ESP32-C3 / ESP32-C6 (Espressif)** — Single-core RISC-V with WiFi and BLE. The C3 runs at 160 MHz with 400 KB SRAM; the C6 adds WiFi 6 and 802.15.4 (Thread/Zigbee). These parts inherit ESP-IDF's mature software stack, making them the most accessible RISC-V option for wireless IoT projects.

The primary limitation across RISC-V MCUs is ecosystem maturity — debugger support, RTOS ports, and third-party library coverage lag behind ARM Cortex-M. Debug probe support is improving (Segger J-Link now supports several RISC-V targets), but the experience is not yet as seamless as SWD on Cortex-M. For production designs, RISC-V parts eliminate ARM licensing fees from the BOM, which matters at very high volumes but is invisible at prototype quantities.

## AVR and PIC — Legacy and Industrial

The ATmega328P (Arduino Uno) remains the entry point for hobbyist embedded development, with the simplest possible toolchain and thousands of library examples. PIC microcontrollers (PIC18, PIC24, dsPIC) dominate industrial applications where long-term availability (20+ year supply commitments from Microchip) and extensive analog peripherals matter. Both families are increasingly niche for new designs — 8-bit parts with 2-4 KB of RAM cannot support modern communication stacks or complex firmware architectures. Microchip's acquisition of Atmel consolidated AVR and PIC under one vendor, and the newer AVR-Dx series (AVR128DA) modernizes the AVR core with more peripherals, but the 8-bit architecture remains fundamentally limiting for compute-intensive applications.

## Tips

- Match the wireless requirement first — if BLE is needed, start with nRF; if WiFi is needed, start with ESP32; if neither, the field opens to STM32 and RP2040. If both WiFi and BLE are needed with minimal power, a two-chip architecture (ESP32 for WiFi + nRF for BLE) sometimes outperforms a single ESP32 trying to time-share the radio.
- Check module availability, not just bare chip pricing — an ESP32-S3 module with antenna, flash, and PSRAM pre-integrated can be cheaper than sourcing those components separately for an STM32 design.
- Evaluate the debugging experience — SWD debug on STM32 and nRF (with a $20 J-Link EDU Mini) is far more productive than printf-over-serial on ESP32 or RP2040.
- For prototyping speed, the RP2040 with its drag-and-drop UF2 bootloader and MicroPython support gets to a working demo faster than almost any other platform.
- Consider the long-term: STM32 and PIC have the strongest track record for 10+ year production availability; ESP32 and RP2040 are newer and less proven for decade-long product support.
- For RISC-V evaluation, the ESP32-C3 offers the lowest-friction entry point — it uses the mature ESP-IDF toolchain, so the learning curve is the RISC-V ISA itself, not an unfamiliar build system.
- When comparing families, normalize power measurements to the same workload — advertising "low power" without specifying the active/sleep ratio and peripheral state makes cross-family comparisons misleading.

## Caveats

- **ESP32 deep sleep current is module-dependent** — The bare SoC achieves 10 uA, but many modules with integrated voltage regulators and flash chips idle at 50-200 uA, which drains a coin cell in days.
- **STM32 part selection is overwhelming** — With over 1,000 variants, picking the right sub-family (F0, F1, F4, G0, G4, L4, H7, U5) requires understanding the architecture differences, not just reading the feature table. The 2021–2023 shortage demonstrated that popular STM32 parts can become unobtainable for months; maintaining a second-source option (GD32, AT32) in the design reduces single-vendor risk.
- **nRF Zephyr has a steep learning curve** — The SDK's device tree model, Kconfig system, and west build tool are powerful but complex; expect significant ramp-up time compared to Arduino or ESP-IDF.
- **RP2040 has no built-in flash protection** — The external QSPI flash can be read out by anyone with SWD access, which matters for products containing proprietary firmware. The RP2350 addresses this with ARM TrustZone and secure boot support.
- **RISC-V toolchains are not yet drop-in replacements** — While GCC supports RISC-V, some vendor extensions (WCH's custom interrupt controller on CH32V, for example) require vendor-specific toolchain patches, limiting compiler flexibility.
- **AVR's 8-bit architecture limits modern use** — 2 KB of SRAM and no hardware multiply make it impractical for anything beyond simple control tasks; even a basic display driver can exhaust available memory. The newer AVR-Dx series adds more memory and peripherals but does not close the architectural gap with 32-bit ARM or RISC-V cores.

## In Practice

- A WiFi-connected sensor that lasts only two days on a 2000 mAh battery is likely using an ESP32 in active mode too frequently — implementing proper WiFi sleep intervals or switching to BLE with an nRF can extend battery life by 10-100x.
- A project that starts on Arduino (ATmega328P) and outgrows its 2 KB of RAM mid-development typically migrates to RP2040 or STM32 with minimal firmware restructuring if the code was written in portable C.
- A BLE product that drops connections intermittently on an ESP32 but works reliably on an nRF52840 is likely hitting the shared WiFi/BLE radio scheduling issue on the ESP32.
- A custom protocol (e.g., WS2812 or DPI display) that cannot be bit-banged reliably on an interrupt-driven MCU can often be offloaded to RP2040 PIO, eliminating timing jitter entirely.
- A high-volume consumer product that switched from an STM32F0 to a CH32V003 cut MCU BOM cost by 90%, but the firmware port required three weeks of engineering time to adapt to the different peripheral register set and debug tooling.
- An industrial controller specified with a 15-year production life that was designed around an ESP32 faces supply risk — PIC or STM32 families have longer manufacturer commitments.
- A team evaluating RISC-V MCUs for cost-sensitive IoT finds that CH32V003 at $0.10 undercuts every ARM option, but the limited English documentation and smaller community increase development time — the per-unit savings must be weighed against engineering hours.
- A product initially designed around an nRF52840 for BLE that later adds WiFi requirements faces an architectural decision: add an ESP32-C3 as a WiFi co-processor (keeping the proven BLE stack intact) or migrate entirely to an ESP32-S3 (rewriting both BLE and application firmware). The co-processor approach is typically faster to market.
