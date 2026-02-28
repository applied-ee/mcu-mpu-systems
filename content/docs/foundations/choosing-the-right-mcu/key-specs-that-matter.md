---
title: "Key Specs That Actually Matter"
weight: 20
---

# Key Specs That Actually Matter

MCU datasheets list hundreds of parameters, but most projects are decided by a handful of specifications that interact with each other. A 200 MHz clock means little if the flash has 5 wait states and no cache. A 12-bit ADC sounds capable until the effective number of bits (ENOB) turns out to be 9.5 at full speed. Learning to read past the headline numbers and focus on the specs that constrain real designs separates productive part selection from spec-sheet paralysis.

## Core Frequency and Architecture

Cortex-M0/M0+ cores (e.g., RP2040 at 133 MHz, STM32L0 at 32 MHz) handle GPIO, UART, SPI, and simple control loops with minimal power draw — the M0+ is the most energy-efficient ARM core per MHz. Cortex-M4F cores (STM32F4 at 168 MHz, nRF5340 at 128 MHz) add a single-precision FPU and DSP instructions — essential for digital filtering, PID loops, and audio processing. Cortex-M7 cores (STM32H7 at 480 MHz, i.MX RT1060 at 600 MHz) include double-precision FPU, instruction/data caches, and tightly-coupled memory. The jump from M0 to M4 matters far more than raw clock speed for compute-bound tasks: a 64 MHz M4F outperforms a 133 MHz M0+ on FIR filter execution because of the hardware multiplier and MAC instruction.

## Flash and SRAM

Flash holds the program; SRAM holds runtime data. An STM32F103C8 has 64 KB flash and 20 KB SRAM — enough for bare-metal sensor applications but tight for a BLE stack. An ESP32-S3 provides up to 16 MB of external flash (via SPI) and 512 KB of internal SRAM. A FreeRTOS task typically consumes 256-1024 bytes of stack, so running 10 tasks on a 20 KB SRAM part requires careful allocation. Flash size becomes critical with TLS libraries (~50-80 KB), USB stacks (~20-40 KB), or graphic assets for displays. Doubling the flash from 128 KB to 256 KB often costs less than $0.30 at volume, so over-specifying flash is cheap insurance.

## Peripheral Counts and Capabilities

The raw count of UART, SPI, and I2C interfaces matters less than their pinout flexibility and DMA support. An STM32F4 with 6 USARTs sounds generous, but on a 48-pin LQFP package, pin conflicts may limit actual use to 3. Timer capabilities vary dramatically: basic timers (counting only), general-purpose timers (PWM, input capture), and advanced timers (complementary outputs with dead-time for motor control) are not interchangeable. A project needing 6 independent PWM channels requires checking the timer architecture, not just the GPIO count.

## ADC Resolution and Sampling Rate

A 12-bit ADC with a maximum sampling rate of 2 MSPS (e.g., STM32F4) sounds adequate, but ENOB at full speed may drop to 9-10 bits due to internal noise. For applications requiring true 12-bit performance, reducing the sampling rate to 100 KSPS or using an external ADC (ADS1115 at 16-bit, 860 SPS) is often necessary. The number of ADC channels, the presence of a sample-and-hold for simultaneous sampling, and whether DMA can stream ADC results to memory without CPU intervention are more important than headline resolution for data acquisition projects.

## Operating Voltage and Package Options

Most modern MCUs run at 3.3 V, but 1.8 V cores are increasingly common for low-power parts (nRF52840 runs internally at 1.3 V with an on-chip regulator). A 5 V-tolerant GPIO (available on many STM32 parts) avoids the need for level shifters when interfacing with legacy sensors. Package selection constrains prototyping and production: the ATmega328P comes in 28-pin DIP (breadboard-friendly), while the STM32H750 is only available in 100-pin LQFP or BGA — ruling out hand-soldered prototypes for many engineers.

## Tips

- Check the DMA channel count and peripheral-to-DMA mapping early — a part with 8 SPI ports but only 2 DMA channels creates bottlenecks in high-throughput designs.
- Use the pin-mux tool (CubeMX, PinMUX, etc.) before committing to a specific package — alternate function conflicts are the most common reason for mid-project part changes.
- Compare SRAM size against the combined stack and heap requirements of the planned RTOS tasks, communication stacks, and data buffers — running out of RAM mid-development is painful.
- Verify the ADC ENOB at the actual sampling rate planned for the application, not the headline resolution — datasheets usually bury ENOB data in electrical characteristics tables.
- Pick the smallest package that still routes cleanly — a 64-pin LQFP is often preferable to a 48-pin QFN if it eliminates two PCB layers.

## Caveats

- **Clock speed alone is misleading** — An M7 at 480 MHz with 5 flash wait states and no cache can be slower than an M4 at 168 MHz with zero wait states for interrupt-driven code that does not benefit from caching.
- **"Up to" peripheral counts include shared pins** — A datasheet claiming 5 I2C interfaces may only allow 2-3 simultaneously on the chosen package due to pin multiplexing.
- **Low-power specs assume specific conditions** — The 1.6 uA stop current on an STM32L4 datasheet is measured with all peripherals off, all GPIO pins configured, and no leakage from external components.
- **Internal oscillator accuracy limits UART reliability** — A +/- 2% RC oscillator may cause framing errors on UART at 115200 baud; an external crystal or TCXO may be required.
- **Flash endurance is finite** — Typical flash endurance is 10,000 erase-write cycles; designs that log data to internal flash must account for wear leveling or use external NOR/NAND.

## In Practice

- A project that intermittently drops SPI frames under load is likely starved for DMA channels, with the CPU unable to service the peripheral fast enough in interrupt mode.
- An ADC reading that jitters by +/- 20 counts on a stable input suggests the ENOB is lower than expected at the configured sampling rate — reducing speed or averaging samples often restores usable resolution.
- A firmware build that exceeds flash capacity after adding a USB stack was sized too tightly at part selection — the USB stack, descriptor tables, and string descriptors can easily consume 30-50 KB.
- A device that works on the bench but fails in the field at high temperature may be relying on internal oscillator accuracy that degrades with thermal drift.
- A pin-mux conflict discovered after PCB layout is routed typically costs a board revision — catching this during part selection avoids weeks of delay.
