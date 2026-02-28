---
title: "Peripheral Smoke Tests"
weight: 30
---

# Peripheral Smoke Tests

After blinky and serial output confirm that the core system works, each peripheral subsystem needs individual verification before building application firmware on top of it. Testing one peripheral at a time isolates failures — if SPI and I2C are both initialized simultaneously and neither works, the root cause could be a shared clock misconfiguration, a pin conflict, or two independent problems. A smoke test for each peripheral should produce a clear pass/fail result with minimal code, and the expected output should be documented before running the test.

## SPI Loopback Test

The simplest SPI verification requires no external device. Connect the MOSI pin directly to the MISO pin with a jumper wire, configure the SPI peripheral in master mode (clock polarity 0, phase 0, 1 MHz clock to start), and transmit a known byte like `0xA5`. The received byte should match exactly. If it does not, check pin mapping — SPI1 on an STM32F4 can appear on multiple pin sets (PA5/PA6/PA7 or PB3/PB4/PB5), and selecting the wrong alternate function is a common error. Once loopback passes, connect an actual SPI device and verify chip-select timing. Most SPI slaves require CS to go low at least 10-50 ns before the first clock edge.

## I2C Bus Scan

An I2C bus scan sends a start condition followed by each possible 7-bit address (0x08 through 0x77) and checks for an ACK. Any device that ACKs is present and responsive. On a board with an LIS3DH accelerometer at address `0x19` (SDO/SA0 pulled high) and an SSD1306 OLED at `0x3C`, the scan should report exactly those two addresses. If no devices ACK, check pull-up resistors — I2C requires external pull-ups (typically 4.7 kOhm for 100 kHz standard mode, 2.2 kOhm for 400 kHz fast mode) on both SDA and SCL. Missing pull-ups cause the bus lines to float, and the controller sees no ACKs.

## ADC: Read a Known Voltage

Connect a simple resistor divider (two 10 kOhm resistors between 3.3 V and GND) to an ADC input pin. The expected reading is half the reference voltage — on a 12-bit ADC with a 3.3 V reference, the expected raw value is approximately 2048 (1.65 V). Readings consistently at 0 or 4095 indicate a pin configuration error (pin not set to analog mode) or a reference voltage problem. A reading that drifts by more than +/- 20 counts at steady state suggests inadequate VDDA decoupling. For boards with a separate VREF+ pin, verify that it is tied to 3.3 V through a ferrite bead and decoupling network, not left floating.

## Timer and PWM Output

Configure a general-purpose timer to output a PWM signal at a known frequency — 1 kHz at 50% duty cycle is a good starting point. Measure the output with an oscilloscope or frequency counter. On an STM32F4 running at 168 MHz with a timer on APB1 (84 MHz timer clock), a prescaler of 84 and auto-reload of 999 produces exactly 1.000 kHz. If the measured frequency is off by a factor related to the bus prescaler (2x, 4x), the timer clock source assumption is wrong. Verify duty cycle accuracy by measuring the high time — at 50% duty and 1 kHz, the high period should be 500 us +/- 1 us.

## Tips

- Test each peripheral with the simplest possible configuration first — lowest clock speed, polling mode (no DMA or interrupts), default pin mapping — and increase complexity only after the basic test passes.
- Keep each smoke test as a standalone function that can be called from a diagnostic menu over serial, making it easy to re-run individual tests during debugging.
- Document the expected result before running each test — "SPI loopback should return 0xA5", "I2C scan should find devices at 0x19 and 0x3C" — so that pass/fail is unambiguous.
- Use a logic analyzer to capture the actual bus waveforms during each test; this provides evidence that timing, signal levels, and protocol framing are correct even when the data appears right.
- After each peripheral passes its smoke test individually, run all tests sequentially in a single firmware build to catch pin conflicts or clock configuration interactions.

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
