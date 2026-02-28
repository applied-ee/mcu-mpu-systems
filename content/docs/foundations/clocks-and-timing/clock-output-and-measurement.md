---
title: "Clock Output & Measurement"
weight: 30
---

# Clock Output & Measurement

Verifying that the clock tree is configured correctly requires measuring actual frequencies, not just trusting register settings. Most STM32 and other ARM Cortex-M microcontrollers provide MCO (Microcontroller Clock Output) pins that route internal clock signals to a GPIO, making them directly measurable with an oscilloscope or frequency counter. This capability turns clock debugging from guesswork into straightforward measurement.

## MCO Pin Configuration

MCO pins output a selectable internal clock source on a standard GPIO. On STM32F4 devices, MCO1 (PA8) can output HSI, HSE, LSE, or the PLL clock, while MCO2 (PC9) can output SYSCLK, PLLI2S, HSE, or the PLL clock. Each MCO has a configurable prescaler (1, 2, 3, 4, or 5) to bring high-frequency clocks within range of measurement equipment.

Configuration requires setting the GPIO to alternate function mode and selecting the clock source and prescaler in the RCC_CFGR register. With SYSCLK at 168 MHz and MCO prescaler of 4, the output is 42 MHz — easily measured by a 100 MHz oscilloscope or a basic frequency counter. The MCO output has limited drive strength, so keeping the probe trace short (under 10 cm) and using proper grounding avoids ringing artifacts that corrupt frequency readings.

## Measurement with Oscilloscope and Frequency Counter

An oscilloscope reveals both the frequency and the signal quality — overshoot, ringing, and duty cycle distortion all become visible. A frequency counter provides higher accuracy, often resolving to 1 Hz or better, which is necessary for confirming crystal accuracy to ppm level.

At the bench, the expected measurement for an 8 MHz HSE crystal is 8.000 MHz +/-160 Hz (at +/-20 ppm). If the counter reads 7.998 MHz or 8.003 MHz, the crystal is within spec but the load capacitors may be slightly off — the frequency pulling caused by mismatched load capacitance is directly observable. An HSI measurement of 15.8-16.2 MHz (16 MHz +/-1%) on a room-temperature part confirms the internal oscillator is within its specified tolerance.

## HSE Bypass Mode

When an external clock source is already available — from another oscillator, a clock generator IC, or a neighboring MCU's MCO output — the HSE bypass mode accepts this external clock directly on the OSC_IN pin without the internal oscillator circuit. This eliminates the need for a crystal and its load capacitors. The external clock must be a clean square wave or clipped sine wave within the input frequency range (4-26 MHz on most STM32 parts).

This mode is common on boards with a shared master clock: one crystal drives an oscillator whose output fans out to multiple MCUs in bypass mode, ensuring all devices share an identical, synchronous clock reference.

## Measuring Drift Over Temperature

Clock accuracy specifications are given across the full temperature range, but the actual drift curve is measurable. Placing the board in a thermal chamber (or using a heat gun carefully at the bench) while monitoring the MCO output on a frequency counter reveals how the oscillator frequency shifts with temperature. Internal RC oscillators typically show a parabolic drift curve with the best accuracy near 25C and increasing error toward the temperature extremes.

For an HSI specified at +/-1% at 25C and +/-3% over temperature, a measurement might show 16.00 MHz at 25C, 15.92 MHz at -20C, and 16.08 MHz at 70C. This data is invaluable for deciding whether the HSI is sufficient for a specific UART baud rate at the product's operating temperature range.

## Tips

- Configure an MCO output as the first step when bringing up a new board — confirming the clock is running at the expected frequency eliminates an entire class of downstream debugging
- Use the MCO prescaler to keep the output frequency within the bandwidth of available measurement equipment — a 200 MHz scope cannot reliably capture 168 MHz SYSCLK, but 42 MHz (prescaler of 4) is well within range
- For ppm-level accuracy verification, a frequency counter with a stable timebase is essential — oscilloscope frequency measurements are typically accurate only to 0.1-1%, insufficient for confirming crystal specifications
- When routing MCO output on a PCB, treat it as a high-speed signal: keep the trace short, add a series resistor (33-100 ohm) near the MCU pin to reduce ringing, and place a test point near the pin
- Compare HSI frequency across multiple boards from the same production run to understand part-to-part variation — this reveals whether the HSI is consistently close to nominal or varies significantly

## Caveats

- **MCO output impedance is not matched to 50 ohm** — Connecting a long cable or 50-ohm terminated instrument input without a series resistor produces reflections that distort the waveform and corrupt frequency readings
- **MCO prescaler does not cover all ratios** — Only prescalers of 1-5 are available on most STM32 parts, so a 168 MHz clock can only be output at 168, 84, 56, 42, or 33.6 MHz, some of which may still exceed the measurement equipment bandwidth
- **Probing the MCO pin can load the oscillator** — Adding probe capacitance (10-15 pF for a standard passive probe) to the clock output can slightly shift the frequency being measured, particularly for sensitive crystal oscillator circuits
- **HSE bypass mode has no amplitude detection** — If the external clock signal is too weak or absent, the MCU does not generate an error; the HSE simply fails to start, and the system falls back to HSI silently

## In Practice

- An MCO output that reads 16.1 MHz when HSI is selected confirms the internal RC is running but slightly above nominal — this is normal and within the +/-1% specification, but the deviation should be accounted for in UART baud rate calculations
- A crystal that measures exactly the right frequency on a frequency counter but produces a visibly distorted waveform on the oscilloscope (excessive amplitude, clipping, or parasitic oscillation) may be overdriven — reducing the crystal drive strength setting in the RCC registers often resolves this
- A board where MCO outputs the correct HSE frequency but the system clock is wrong indicates a PLL misconfiguration — the oscillator is fine but the multiplier/divider chain is producing an unexpected frequency
- SYSCLK measured via MCO that drifts by several percent when the board is heated with a heat gun confirms the system is running on the HSI, not the HSE — crystals drift by ppm, not percent, so large thermal drift is a definitive indicator of RC oscillator operation
