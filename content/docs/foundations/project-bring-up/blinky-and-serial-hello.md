---
title: "Blinky & Serial Hello World"
weight: 20
---

# Blinky & Serial Hello World

Once the hardware is electrically verified, the first firmware milestones are a blinking LED and a serial message. These two tests are not trivial — they validate the entire chain from source code through compiler, linker, flash programming, clock configuration, and GPIO/peripheral initialization. A working blinky proves the MCU is executing code from flash, the system clock is running, and at least one GPIO is correctly configured. A serial hello world adds UART peripheral setup, baud rate generation, and confirms that the toolchain's printf retargeting or low-level write path is functional.

## Minimal Blinky

The blinky program configures a single GPIO pin as a push-pull output and toggles it in a delay loop. On an STM32F4, this means enabling the GPIO port clock in RCC, setting the pin mode to output, and writing to the output data register. The delay can be a simple busy-wait loop — no timers or interrupts needed at this stage. A 500 ms on / 500 ms off pattern (1 Hz) is easy to verify visually. If the LED blinks, the MCU is fetching and executing instructions, the flash is programmed correctly, and the startup code (stack pointer init, vector table, clock setup) is working.

A register-level blinky on STM32F4 (PA5, the user LED on Nucleo boards) looks like this:

```c
/* Enable GPIOA clock */
RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;
/* Set PA5 as general-purpose output */
GPIOA->MODER &= ~(3 << (5 * 2));
GPIOA->MODER |=  (1 << (5 * 2));
/* Toggle LED in a busy-wait loop */
while (1) {
    GPIOA->ODR ^= (1 << 5);
    for (volatile int i = 0; i < 500000; i++);
}
```

The `volatile` qualifier on the loop variable prevents the compiler from optimizing the delay away at `-O2` or higher. This minimal example avoids HAL dependencies entirely, making it useful for verifying that the toolchain, linker script, and startup file are all correct before introducing any abstraction layers.

## Why Blinky Matters Beyond Hello World

A working blinky is not merely a tradition — it validates multiple subsystems simultaneously. The fact that the LED toggles confirms: the debug probe can program flash, the reset vector points to valid code, the stack pointer initializes correctly, the system clock is running (at some frequency), and the GPIO peripheral responds to register writes. Failure at any one of these stages results in no blink at all, making blinky a coarse but effective integration test for the entire firmware build and flash pipeline.

## Verifying Clock Frequency

A visually blinking LED confirms code execution but does not verify clock accuracy. Measuring the GPIO toggle frequency with an oscilloscope reveals whether the system clock is running at the intended speed. If the firmware configures the PLL for 168 MHz but the blink rate is 4x slower than expected, the MCU is likely running from the 16 MHz internal HSI oscillator because the external crystal failed to start. On STM32 parts, the MCO (Microcontroller Clock Output) pin can output the system clock divided down — configuring MCO to output HSE/1 and measuring with a frequency counter directly confirms whether the external oscillator is running and at the correct frequency (e.g., 8.000 MHz +/- 20 ppm).

A rough clock verification is possible from the blinky delay loop itself. If the HSI runs at 16 MHz and the delay loop body compiles to approximately 6 instructions per iteration (a typical result for a `volatile int` decrement with branch), then 500,000 iterations take roughly `500000 * 6 / 16e6 = 187.5 ms`. Measuring the actual blink period with a scope and comparing it to this estimate confirms whether the clock is close to the expected value. A measured period that is 10x longer than calculated, for example, indicates the MCU may be running from an LSI (32 kHz) fallback or a misconfigured PLL divider.

## Serial Hello World

After blinky, the next milestone is UART output. Initialize one UART peripheral — typically USART2 on STM32 Nucleo boards, which routes through the ST-Link as a virtual COM port. Configure TX pin as alternate function push-pull, set baud rate to 115200, 8N1 framing. The simplest test sends a fixed string like `"Hello\r\n"` by polling the TXE (transmit empty) flag and writing bytes to the data register. Retargeting `printf` to UART (implementing `_write` or `fputc` depending on the C library) is useful but not required for the first test — a raw byte-send function is sufficient and avoids C library dependencies at this stage.

For projects that do use `printf`, the retarget glue depends on the C library in use. With Newlib (the default for most ARM GCC toolchains), implementing the `_write` syscall is sufficient:

```c
int _write(int fd, char *ptr, int len) {
    for (int i = 0; i < len; i++) {
        while (!(USART2->SR & USART_SR_TXE));
        USART2->DR = ptr[i];
    }
    return len;
}
```

With ARM Compiler's MicroLib, the override is `fputc` instead. Getting the wrong function results in `printf` producing no output at all — a common source of confusion during serial bring-up.

## Confirming Baud Rate and Signal Integrity

A serial terminal showing garbled text is almost always a baud rate mismatch. A logic analyzer on the UART TX line provides definitive measurement — capture a known byte (e.g., 0x55, which produces an alternating bit pattern) and measure the bit period. At 115200 baud, each bit is 8.68 us. If the measured bit period is 8.68 us but the terminal still shows garbage, the issue is likely a voltage level mismatch (3.3 V logic into an RS-232 port) or incorrect framing (wrong stop bits or parity setting). If the bit period is off by a factor of two or more, the UART peripheral clock source is wrong — check the APB bus prescaler configuration.

## Tips

- Start with the internal RC oscillator (HSI) for the first blinky — it removes the external crystal as a variable and always works out of reset.
- Use a known-good USB-to-serial adapter (FTDI FT232 or CP2102) as a second verification path if the onboard virtual COM port is not responding.
- Toggle the GPIO pin as fast as possible (no delay) and measure the frequency — this gives a rough confirmation of the instruction execution speed and system clock.
- Keep the first blinky and serial test as a standalone minimal project, separate from the main application firmware — it serves as a reference and a hardware diagnostic tool throughout the project.
- Flash the blinky via the debug probe, not a bootloader — this confirms that the SWD/JTAG programming path works end to end.

## Caveats

- **A blinking LED does not prove the clock is correct** — The MCU could be running from a fallback oscillator at a completely different frequency, and the blink rate just happens to look reasonable to the eye.
- **Printf retargeting varies by C library** — Newlib, Newlib-nano, and ARM Compiler's MicroLib each require different function overrides (`_write`, `fputc`, `__io_putchar`), and getting the wrong one results in printf silently doing nothing.
- **Baud rate error accumulates over a frame** — A 3% clock error may be tolerable for a single byte but causes framing errors on longer transmissions, especially at high baud rates like 921600.
- **Nucleo virtual COM port is not always USART2** — Different Nucleo board variants route different UART instances to the ST-Link; check the board schematic rather than assuming.
- **Optimizing compilers can remove delay loops** — A busy-wait loop with no side effects may be optimized away at `-O2` or higher, making the LED appear always-on; marking the loop variable as `volatile` prevents this.

## In Practice

- A board that programs successfully via SWD but the LED never blinks usually has a GPIO clock that was not enabled — the pin stays in its reset state (analog input on STM32) and never drives the LED.
- A serial terminal that shows nothing at all, despite correct wiring, often means the TX pin is not configured for the correct alternate function — each STM32 pin has multiple AF mappings and only one is correct for the chosen UART instance.
- A blinky that runs at exactly half the expected rate typically indicates the PLL multiplier or divider is misconfigured, resulting in a system clock that is 2x slower than intended.
- Garbled serial output that becomes readable when the baud rate is changed to exactly half or double the configured rate points to an APB prescaler set differently than the firmware assumes.
- A blinky that works after a debug probe launch but not after a power cycle usually means the boot configuration (BOOT0 pin) is pulling the MCU into the system bootloader instead of booting from flash.
