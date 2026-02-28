---
title: "Flashing & Boot Modes"
weight: 30
---

# Flashing & Boot Modes

Getting compiled firmware into a microcontroller's flash memory — and ensuring it boots correctly — is the final step between a successful build and a running system. Multiple flashing methods exist, each with different hardware requirements, speed, and use cases. The boot sequence itself is deterministic on Cortex-M: the processor reads the vector table, loads the stack pointer, and jumps to the reset handler, all within microseconds of power-on. Understanding both the flashing path and the boot path is essential for reliable bring-up.

## SWD and JTAG Flashing

SWD (Serial Wire Debug) is the standard debug and programming interface for ARM Cortex-M devices, requiring only two signal lines (SWDIO and SWCLK) plus ground. Common debug probes include the ST-LINK V2 (bundled with STM32 Nucleo boards), Segger J-Link, and CMSIS-DAP adapters. OpenOCD and pyOCD are open-source tools that drive these probes: `openocd -f interface/stlink.cfg -f target/stm32f4x.cfg -c "program firmware.elf verify reset exit"` flashes, verifies, and resets in a single command. J-Link Commander (`JLinkExe`) offers faster flash speeds — often 500 KB/s or more — and supports direct `.bin`, `.hex`, and `.elf` loading. SWD also enables live debugging, breakpoints, and memory inspection, making it the primary interface during development.

## UART and USB Bootloaders

Most STM32 devices include a factory-programmed ROM bootloader accessible by holding the BOOT0 pin high during reset. This bootloader speaks UART (and sometimes I2C or SPI) and can be driven by `stm32flash` on the host: `stm32flash -w firmware.bin /dev/ttyUSB0` writes the binary at 115200 baud by default. No debug probe is required — only a USB-to-UART adapter and two wires. USB DFU (Device Firmware Upgrade) is another built-in option on STM32 parts with USB peripherals; `dfu-util -a 0 -s 0x08000000:leave -D firmware.bin` flashes and boots in one step. DFU is commonly used for field updates where SWD access is not available.

## UF2 Drag-and-Drop

The RP2040 (Raspberry Pi Pico) popularized the UF2 (USB Flashing Format) approach: holding the BOOTSEL button during power-on makes the chip enumerate as a USB mass-storage device. Copying a `.uf2` file to this drive flashes and reboots the target automatically. No drivers, no tools, no configuration — this is the lowest-friction programming method available. The tradeoff is that UF2 provides no debug access and no flash verification feedback beyond "the device rebooted." Other platforms adopting UF2 include Adafruit's SAMD and nRF52 boards.

## Boot Sequence on Cortex-M

On a Cortex-M, the boot process is hardware-defined and takes microseconds. The processor reads the initial stack pointer from address 0x00000000 (mapped to flash base, typically 0x08000000 on STM32) and the reset vector from address 0x00000004. Execution begins at the `Reset_Handler`, which typically copies `.data` from flash to RAM, zeroes `.bss`, calls `SystemInit()` to configure clocks, and finally calls `main()`. The entire sequence from power-on to `main()` entry is typically under 10 ms with default clock settings, and under 1 ms if the PLL setup is deferred.

## Tips

- Always use the `verify` option when flashing — `openocd` and `JLinkExe` both support post-write verification, which catches flash corruption and incomplete writes before debugging begins.
- Keep a known-good blinky firmware binary available for each board — it is the fastest way to confirm that the flashing path and hardware are functional when diagnosing a new issue.
- Use `.hex` files with UART bootloaders when possible, since they carry address information and prevent flashing to the wrong offset.
- Label the BOOT0 pin configuration on custom boards and include a test point or jumper — without BOOT0 access, a bricked device with corrupted firmware requires SWD to recover.
- Check the reset vector with `arm-none-eabi-objdump -d firmware.elf | head -20` — the second entry in the vector table must point to a valid `Reset_Handler` address in flash.

## Caveats

- **BOOT0 left floating on STM32 causes intermittent boot failures** — The pin must be explicitly pulled low (typically 10k to GND) for normal flash boot; an unconnected BOOT0 may read high on some boards due to noise or leakage.
- **UART bootloader baud rate detection requires a sync byte** — The STM32 ROM bootloader auto-detects baud rate from an initial 0x7F byte; sending data before the sync handshake completes causes communication failure.
- **Read-out protection (RDP) can lock out SWD permanently** — Setting RDP Level 2 on STM32 is irreversible; the chip cannot be reprogrammed or debugged ever again. Level 1 can be reversed but triggers a full flash erase.
- **UF2 flashing provides no error feedback** — If the `.uf2` file is malformed or the write is interrupted, the device may silently boot corrupted firmware or remain in bootloader mode with no diagnostic output.
- **Flash write endurance is finite** — Most MCU flash is rated for 10,000 erase/write cycles; rapid reflashing during development is not a concern, but a firmware update mechanism that writes on every boot can wear out flash within months.

## In Practice

- A device that does not respond to SWD after flashing new firmware often has a corrupted vector table — the stack pointer or reset vector points to an invalid address, and the core enters a hard fault before the debugger can attach. Flashing via UART bootloader with BOOT0 held high bypasses the vector table entirely.
- **A board that boots correctly after power-on but fails after a warm reset** commonly has a `SystemInit()` that assumes default register states which are only true on a cold boot — the PLL or clock configuration may be in an unexpected state after reset without power cycling.
- An STM32 that appears completely dead — no SWD connection, no UART response — but was previously functional likely has the SWD pins reconfigured as GPIO in firmware. Holding BOOT0 high during reset forces the ROM bootloader and recovers SWD access.
- **Flash verification failures that occur only with large images** often indicate insufficient power supply decoupling — flash erase operations draw current spikes of 50-100 mA above normal, and a weak supply causes voltage droops that corrupt the erase or write cycle.
- A Cortex-M device that enters `main()` but behaves erratically with uninitialized variables often has a startup file that fails to zero the `.bss` section or copy `.data` from flash to RAM — checking the `Reset_Handler` disassembly confirms whether these initialization steps are present.
