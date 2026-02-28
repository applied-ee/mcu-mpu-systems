---
title: "Oscillator Sources — Internal RC vs External Crystal"
weight: 10
---

# Oscillator Sources — Internal RC vs External Crystal

Every microcontroller needs a clock source, and the choice between internal RC oscillators, external crystals, and MEMS oscillators determines accuracy, startup speed, cost, and board complexity. The tradeoffs are well-defined: internal RC is free and fast to start but imprecise, while an external crystal is accurate but adds components and startup delay. Understanding when each source is sufficient — and when it is not — prevents both over-engineering simple projects and under-specifying timing-critical ones.

## Internal RC Oscillators (HSI)

Most STM32 devices include an internal high-speed RC oscillator (HSI) running at 16 MHz with a typical accuracy of +/-1% at 25C, degrading to +/-2-3% across the full temperature range (-40C to 85C). Startup time is on the order of 1-2 us — essentially instant. The HSI requires no external components and is the default clock source at reset, which is why code always begins executing before any crystal has stabilized.

The temperature coefficient of RC oscillators is the dominant accuracy concern. The frequency drift follows a roughly parabolic curve centered near 25C, with the error accelerating toward the extremes: a part might read 16.00 MHz at 25C, 15.84 MHz at -40C, and 15.68 MHz at 85C — a swing of roughly +/-1-5% depending on the specific MCU family and process node. Factory trimming narrows the room-temperature accuracy (some newer parts achieve +/-0.5% post-trim), but the temperature coefficient itself is inherent to the RC oscillator physics and cannot be trimmed away.

For peripherals that are tolerant of frequency variation — GPIO toggling, SPI with a cooperating slave, timers used for non-precision delays — the HSI is entirely sufficient. The 1-2% accuracy translates to a baud rate error of 1-2%, which is within the +/-3-5% tolerance window for standard UART at common rates up to 115200 baud. At higher baud rates or over long frames, this margin shrinks.

## External Crystals (HSE)

An external crystal (HSE), typically 8 MHz or 25 MHz, provides accuracy of +/-20 ppm (0.002%) — roughly 50-100x better than the HSI. Over the full temperature range, crystals drift by +/-20-50 ppm depending on the cut and specification — orders of magnitude better than any RC oscillator. The tradeoff is startup time: 2-10 ms depending on the crystal and load capacitors, plus the requirement for two capacitors (CL1, CL2) matched to the crystal's specified load capacitance.

The load capacitor calculation follows: CL = (CL1 * CL2) / (CL1 + CL2) + Cstray, where Cstray is typically 2-5 pF from PCB traces and MCU pin capacitance. For a crystal specifying 20 pF load capacitance with 3 pF stray, each capacitor should be approximately 34 pF. Using incorrect load capacitors shifts the oscillation frequency — sometimes enough to break USB enumeration or push UART outside its tolerance window.

PCB layout for the crystal circuit is critical to reliable startup and accurate frequency. Traces between the crystal pads and the MCU's OSC_IN/OSC_OUT pins should be as short as possible — ideally under 10 mm. A ground guard ring around the crystal footprint and load capacitors shields the high-impedance oscillator nodes from noise coupling. No signal traces should be routed underneath the crystal or between the crystal pads, and a continuous ground plane directly below the crystal area provides a low-impedance return path. Violating these rules introduces stray capacitance and noise pickup that can prevent oscillation or shift the frequency.

An external crystal is mandatory for USB (requires +/-0.25% or better), CAN bus, and any application requiring precise timing over temperature.

## MEMS Oscillators

MEMS oscillators (e.g., SiTime SiT8008) offer crystal-grade accuracy (+/-20-50 ppm) in a smaller package with superior vibration and shock resistance. The cost premium over a crystal is typically 2-5x, but the elimination of load capacitors and reduced sensitivity to PCB layout make them attractive for vibration-heavy environments like automotive or industrial motor control. Unlike crystals, MEMS oscillators are active devices that need a power supply and draw 1-4 mA.

## TCXOs for High-Stability Applications

For applications requiring sub-ppm stability — GPS receivers, RF local oscillators, precision instrumentation — a Temperature-Compensated Crystal Oscillator (TCXO) provides +/-0.5-2 ppm over the full temperature range. TCXOs achieve this by incorporating a temperature sensor and compensation network that adjusts the oscillator load to counteract the crystal's temperature coefficient. The cost is higher than a bare crystal (typically $1-5 in volume), and current draw is in the 1-5 mA range, but the stability gain is 10-50x over an uncompensated crystal. In GPS applications, a TCXO allows faster satellite acquisition because the initial frequency uncertainty is smaller, reducing the search window for Doppler-shifted signals.

## When RC Is Sufficient vs Crystal Required

The decision follows directly from peripheral requirements. GPIO, basic SPI, I2C, and general-purpose timers work fine on the HSI. UART at 115200 baud or below typically works with +/-1% accuracy. USB 2.0 Full Speed requires +/-0.25% — far beyond any RC oscillator. CAN bus requires +/-0.5%. Ethernet PHY clocking and precise ADC sampling rates also demand crystal-grade accuracy.

A useful decision framework:

- **No crystal needed**: LED blinking, GPIO control, SPI to sensors, I2C, general timers, UART at 9600-115200 baud (room temperature)
- **Crystal recommended**: UART at temperature extremes, high baud rates (>115200), precision PWM, inter-MCU synchronization
- **Crystal mandatory**: USB, CAN, Ethernet, high-accuracy ADC sampling, any protocol with tight frequency tolerance specifications

When in doubt, measuring the actual HSI frequency on a specific chip via the MCO pin (see Clock Output & Measurement) reveals how far it deviates from nominal.

## Tips

- Start development using the HSI to get firmware running quickly, then switch to HSE once the clock tree configuration is validated — this avoids chasing crystal hardware issues during initial bring-up
- Always verify the crystal's specified load capacitance in its datasheet and calculate the external capacitor values — do not blindly copy values from a reference design using a different crystal
- Place crystal load capacitors as close to the MCU's OSC_IN and OSC_OUT pins as possible, with short traces and a solid ground plane underneath
- For battery-powered designs, consider that the HSI can be started in microseconds for quick wake-process-sleep cycles, while HSE startup adds milliseconds to every wake event
- Check whether the target MCU's HSI is factory-trimmed — some newer parts achieve +/-0.5% after trimming, which may be sufficient for UART without an external crystal

## Caveats

- **HSI accuracy degrades with temperature** — The +/-1% specification is at 25C; across the full industrial range, drift can reach +/-3% or worse, which pushes UART baud rates outside the tolerance window at temperature extremes
- **Wrong load capacitors shift crystal frequency** — Even a 5 pF error in load capacitance can shift the oscillation frequency by 50-100 ppm, enough to cause intermittent USB enumeration failures
- **Crystal ground return path matters** — A crystal placed far from its load capacitor ground, or routed over a split ground plane, picks up noise and can fail to start or oscillate at an overtone frequency
- **Not all MCU pins tolerate crystal drive levels equally** — Some parts specify maximum drive level for the crystal oscillator; exceeding it can damage the oscillator circuit or cause excessive current draw through the crystal
- **TCXO and MEMS oscillators need a stable power supply** — Supply noise couples into the oscillator output as jitter or frequency modulation; decoupling capacitors (100 nF + 10 uF) placed directly at the oscillator supply pin are essential

## In Practice

- A board that enumerates USB reliably at room temperature but fails in a cold or hot environment is likely running on the HSI instead of the HSE — the HSI drift at temperature extremes exceeds USB's +/-0.25% requirement
- UART communication that works with short messages but produces framing errors on long transfers suggests marginal baud rate accuracy — the cumulative timing error over many bit periods eventually exceeds the receiver's sampling window
- A crystal that starts on some boards but not others from the same production run points to stray capacitance variation — trace length differences or solder paste volume changes shift the effective load capacitance enough to prevent startup
- An MCU that runs fine from the HSI but hangs during HSE startup likely has a hardware fault in the crystal circuit — missing load capacitor, solder bridge, or a crystal damaged during reflow
- Measuring the HSI frequency on five boards from the same batch and finding a spread of 15.85-16.10 MHz illustrates the part-to-part variation that makes RC oscillators unsuitable for tight-tolerance protocols — each board would need individual baud rate compensation to stay within spec
