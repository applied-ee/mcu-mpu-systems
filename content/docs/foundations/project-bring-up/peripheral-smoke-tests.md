---
title: "Peripheral Smoke Tests"
weight: 30
---

# Peripheral Smoke Tests

After blinky and serial output confirm that the core system works, each peripheral subsystem needs individual verification before building application firmware on top of it. Testing one peripheral at a time isolates failures — if SPI and I2C are both initialized simultaneously and neither works, the root cause could be a shared clock misconfiguration, a pin conflict, or two independent problems. A smoke test for each peripheral should produce a clear pass/fail result with minimal code, and the expected output should be documented before running the test.

## SPI Loopback Test

The simplest SPI verification requires no external device. Connect the MOSI pin directly to the MISO pin with a jumper wire, configure the SPI peripheral in master mode (clock polarity 0, phase 0, 1 MHz clock to start), and transmit a known byte like `0xA5`. The received byte should match exactly. If it does not, check pin mapping — SPI1 on an STM32F4 can appear on multiple pin sets (PA5/PA6/PA7 or PB3/PB4/PB5), and selecting the wrong alternate function is a common error. Once loopback passes, connect an actual SPI device and verify chip-select timing. Most SPI slaves require CS to go low at least 10-50 ns before the first clock edge.

A minimal register-level SPI loopback test:

```c
uint8_t tx = 0xA5, rx;
/* Write data to the SPI data register */
SPI1->DR = tx;
/* Wait until receive buffer is not empty */
while (!(SPI1->SR & SPI_SR_RXNE));
rx = SPI1->DR;
/* rx should equal 0xA5 if MOSI is jumpered to MISO */
```

Sending multiple test patterns (0x00, 0xFF, 0xA5, 0x5A) catches bit-stuck and bit-swap faults that a single pattern might miss.

## I2C Bus Scan

An I2C bus scan sends a start condition followed by each possible 7-bit address (0x08 through 0x77) and checks for an ACK. Any device that ACKs is present and responsive. On a board with an LIS3DH accelerometer at address `0x19` (SDO/SA0 pulled high) and an SSD1306 OLED at `0x3C`, the scan should report exactly those two addresses. If no devices ACK, check pull-up resistors — I2C requires external pull-ups (typically 4.7 kOhm for 100 kHz standard mode, 2.2 kOhm for 400 kHz fast mode) on both SDA and SCL. Missing pull-ups cause the bus lines to float, and the controller sees no ACKs.

The scan pattern at the register level involves generating a START condition, sending the 7-bit address shifted left by one with the R/W bit clear (write), and checking whether the device pulls SDA low during the ACK clock cycle. On STM32 I2C peripherals, this translates to writing the address to `I2C1->DR` after setting the START bit, then checking the `ADDR` flag in `I2C1->SR1`. A timeout on each address (1-2 ms) prevents the scan from hanging if the bus is stuck. Addresses 0x00-0x07 and 0x78-0x7F are reserved by the I2C specification and should be skipped during the scan.

## ADC: Read a Known Voltage

Connect a simple resistor divider (two 10 kOhm resistors between 3.3 V and GND) to an ADC input pin. The expected reading is half the reference voltage — on a 12-bit ADC with a 3.3 V reference, the expected raw value is approximately 2048 (1.65 V). Readings consistently at 0 or 4095 indicate a pin configuration error (pin not set to analog mode) or a reference voltage problem. A reading that drifts by more than +/- 20 counts at steady state suggests inadequate VDDA decoupling. For boards with a separate VREF+ pin, verify that it is tied to 3.3 V through a ferrite bead and decoupling network, not left floating.

## DMA Memory-to-Memory Transfer

Before testing DMA with peripherals, a memory-to-memory transfer verifies that the DMA controller itself is functional. Configure a DMA stream to copy a buffer of known data (e.g., 256 bytes of incrementing values) from one SRAM location to another. After triggering the transfer and waiting for the transfer-complete flag, compare the source and destination buffers byte-by-byte. A mismatch indicates a DMA configuration error — typically wrong data width settings (byte vs. half-word vs. word), incorrect source/destination address increment settings, or a stream conflict where two peripherals are mapped to the same DMA stream. This test isolates DMA functionality from any peripheral-specific complications.

## Interrupt-Driven UART Echo

A UART echo test — receive a character via interrupt and transmit it back — validates the interrupt subsystem in addition to the UART peripheral. Configure the UART RX interrupt (RXNE), enable the corresponding IRQ in the NVIC, and implement the ISR to read the received byte and write it to the transmit data register. Sending characters from a serial terminal and verifying they echo back correctly confirms that the NVIC priority configuration is correct, the vector table points to the right handler, and the ISR entry/exit sequence works. If characters are lost or duplicated, the interrupt priority may conflict with another ISR, or the RXNE flag may not be cleared properly — reading `USARTx->DR` clears the flag implicitly on STM32, but failing to read it causes the interrupt to fire continuously.

## Timer and PWM Output

Configure a general-purpose timer to output a PWM signal at a known frequency — 1 kHz at 50% duty cycle is a good starting point. Measure the output with an oscilloscope or frequency counter. On an STM32F4 running at 168 MHz with a timer on APB1 (84 MHz timer clock), a prescaler of 84 and auto-reload of 999 produces exactly 1.000 kHz. If the measured frequency is off by a factor related to the bus prescaler (2x, 4x), the timer clock source assumption is wrong. Verify duty cycle accuracy by measuring the high time — at 50% duty and 1 kHz, the high period should be 500 us +/- 1 us.

## Tips

- Test each peripheral with the simplest possible configuration first — lowest clock speed, polling mode (no DMA or interrupts), default pin mapping — and increase complexity only after the basic test passes.
- Keep each smoke test as a standalone function that can be called from a diagnostic menu over serial, making it easy to re-run individual tests during debugging.
- Document the expected result before running each test — "SPI loopback should return 0xA5", "I2C scan should find devices at 0x19 and 0x3C" — so that pass/fail is unambiguous.
- Use a logic analyzer to capture the actual bus waveforms during each test; this provides evidence that timing, signal levels, and protocol framing are correct even when the data appears right.
- After each peripheral passes its smoke test individually, run all tests sequentially in a single firmware build to catch pin conflicts or clock configuration interactions.
- For DMA tests, zero-fill the destination buffer before starting the transfer — this ensures a passing result is not just stale data from a previous run.
- When testing interrupt-driven peripherals, add a global counter that increments in the ISR and print it periodically from the main loop — this confirms the interrupt is actually firing and not just appearing to work due to polling fallback code.
- Run peripheral smoke tests at both the slowest and fastest clock speeds the application will use — some timing-sensitive peripherals (SPI, I2C) behave differently when bus prescalers change.

## Caveats

- **SPI loopback does not test chip-select timing** — A loopback passes with no CS involved, so CS setup and hold time issues only appear when an actual slave device is connected.
- **I2C address confusion between 7-bit and 8-bit notation** — Some datasheets list the 8-bit shifted address (e.g., 0x32 for a device at 7-bit address 0x19); sending the wrong format results in no ACK and a device that appears missing.
- **ADC readings depend on the reference voltage** — If VREF+ droops under load (common when VDDA is shared with a noisy digital supply), all ADC readings shift proportionally, and the error looks like a gain problem rather than a reference problem.
- **Timer clock sources vary between APB1 and APB2** — On STM32, timers on APB1 and APB2 may run at different frequencies, and the timer clock is often 2x the APB bus clock when the APB prescaler is greater than 1.
- **Floating unused GPIO pins can inject noise into adjacent analog channels** — Uninitialized pins left in high-impedance input mode can couple noise into nearby ADC inputs through PCB crosstalk.

## In Practice

- An SPI device that returns `0xFF` for every register read is almost always not seeing the chip-select signal — the slave is ignoring the clock because CS is not asserted.
- An I2C scan that finds a device at an unexpected address (e.g., `0x18` instead of `0x19`) typically means an address selection pin (SDO/SA0) is in the wrong state — check whether it is pulled high or low on the PCB.
- An ADC channel that reads 4095 regardless of input voltage is usually configured as a digital GPIO instead of analog mode, or the pin is internally pulled up to VREF.
- A PWM output that appears correct on the oscilloscope but drives a motor or LED erratically often has excessive ringing or undershoot at the transitions — check the output impedance and add a series resistor (33-100 Ohm) to damp reflections.
- A timer interrupt that fires at exactly half the expected rate usually means the timer clock is APB1 (42 MHz) when the code assumes APB2 (84 MHz), or the prescaler calculation does not account for the automatic 2x multiplier.
- A DMA transfer that completes without error but the destination buffer remains zeroed often means the source address was wrong (pointing to an unmapped region) or the DMA stream was not enabled after configuration — on STM32, the enable bit must be set last after all other parameters.
- An interrupt-driven UART echo that works for the first few characters but then stops responding typically indicates the ISR is not clearing all required flags, causing the NVIC to stop delivering further interrupts for that peripheral.
