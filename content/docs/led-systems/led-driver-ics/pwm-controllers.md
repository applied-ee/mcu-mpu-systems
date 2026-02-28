---
title: "PWM Controllers"
weight: 20
---

# PWM Controllers

Pulse-width modulation is the universal technique for dimming LEDs. Rather than reducing the current (which shifts the LED's color), PWM switches the LED fully on and fully off at a frequency high enough that the eye perceives an average brightness proportional to the duty cycle. A 50% duty cycle at 1kHz looks like half brightness — the LED flickers 1000 times per second, far faster than the eye can track. Dedicated PWM controller ICs generate these signals precisely, freeing the MCU from timing-critical output tasks.

## PWM Fundamentals for LEDs

The two parameters that define LED PWM behavior are **frequency** and **resolution**:

- **Frequency**: Must be high enough to avoid visible flicker. The threshold varies — 200Hz is sufficient for static displays, but 1kHz+ is preferred for any LED that might be viewed in peripheral vision or captured on camera. Below 100Hz, flicker is visible to most people. Above 20kHz, the PWM is inaudible (no coil whine from inductors or capacitors in the circuit).
- **Resolution**: The number of discrete brightness steps. 8-bit PWM provides 256 levels, 12-bit provides 4096, and 16-bit provides 65536. Higher resolution matters most at low brightness where the steps between adjacent levels are perceptually large.

On a microcontroller's built-in timer/PWM peripheral, there's a direct tradeoff between frequency and resolution: for a given timer clock, doubling the frequency halves the available resolution. A 16MHz AVR running a timer at 62.5kHz gets only 256 counts (8-bit). The same timer at 244Hz gets 65536 counts (16-bit).

## Dedicated PWM Controller ICs

When an MCU's timer channels run out or more precision is needed, external PWM ICs provide banks of PWM outputs:

- **PCA9685**: 16-channel, 12-bit PWM, I²C interface. Up to 62 devices on one bus (992 channels). Each channel has independent on/off timing, enabling staggered switching that reduces supply current spikes. The 12-bit resolution (4096 steps) is a significant improvement over 8-bit for smooth dimming. Commonly used with servo motors as well as LEDs.
- **TLC5940**: 16-channel, 12-bit PWM with built-in constant-current sink. SPI-daisy-chainable for unlimited channels. Combines PWM dimming with per-channel current regulation — each channel sinks a precise current set by a single external resistor. Designed specifically for LED applications.
- **TLC5947/TLC5971**: 24-channel, 12-bit PWM, SPI interface. Similar to the TLC5940 but with more channels per IC, reducing component count for large arrays.

## Internal MCU PWM vs External Controller

For small projects with a few LEDs, the MCU's built-in PWM peripherals are sufficient and require no additional hardware. The decision to add an external controller is driven by:

- **Channel count**: An ATmega328P has 6 PWM channels. A single PCA9685 adds 16 more. For LED matrices or multi-zone lighting, external ICs are necessary.
- **Resolution**: Most MCU timers are 8-bit or 16-bit but achieving high resolution at high frequency requires a fast timer clock. External ICs like the PCA9685 deliver 12-bit resolution independent of MCU clock.
- **CPU load**: Generating software PWM for many channels consumes CPU cycles and is jitter-prone. Offloading to hardware PWM ICs frees the processor for other tasks.
- **Synchronization**: External PWM ICs can be configured to stagger their output transitions, spreading the current demand over time rather than all channels switching simultaneously.

## Tips

- Use 12-bit (4096-step) PWM for any application where smooth dimming below 25% brightness is required — the perceptual difference versus 8-bit is dramatic at the low end
- Set PWM frequency above 1kHz for any LED that might be filmed or viewed in motion — camera rolling shutter artifacts appear at lower frequencies
- Use the PCA9685's staggered output feature to reduce peak current draw — all channels switching high simultaneously creates a current spike proportional to the total LED load
- For LED arrays using TLC5940-series ICs, daisy-chain via SPI to minimize wiring — a single clock, data, and latch line controls an arbitrary number of channels

## Caveats

- **PWM frequency and resolution trade off on MCU timers** — Achieving 12-bit resolution at 10kHz requires a 40MHz+ timer clock. Lower-speed MCUs may be forced to choose between smooth dimming and flicker-free operation
- **I²C bus speed limits PWM update rate** — The PCA9685 on a standard 400kHz I²C bus takes about 0.5ms to update all 16 channels. For fast animation (>100fps), this bus overhead becomes the bottleneck
- **PWM dimming shifts perceived color slightly** — During the "off" portion of each PWM cycle, the LED is fully off, but the eye integrates the on-phase color. For some LED types, the color at low duty cycle appears slightly shifted from the color at high duty cycle due to nonlinear phosphor response
- **Multiple PWM controllers need shared clock or synchronization** — Unsynchronized controllers running at slightly different frequencies produce visible beating patterns when LEDs from different controllers are physically adjacent

## In Practice

- An LED that appears to flicker when viewed in peripheral vision but looks steady when stared at directly is running at a PWM frequency in the 100–300Hz range — increasing to 1kHz eliminates the effect
- A smooth fade that shows visible "stepping" at low brightness (below 5%) is limited by PWM resolution — switching from 8-bit to 12-bit PWM dramatically improves the transition
- Horizontal bands visible when filming LEDs with a phone camera indicate the PWM frequency is interacting with the camera's rolling shutter — increasing the PWM frequency above the camera's frame rate × line count eliminates the banding
- Multiple LED zones that appear to "shimmer" or "beat" against each other are likely driven by unsynchronized PWM controllers — sharing a clock source or synchronizing the output-enable signals resolves the interference
