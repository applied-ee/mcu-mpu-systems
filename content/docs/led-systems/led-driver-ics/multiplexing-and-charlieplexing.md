---
title: "Multiplexing & Charlieplexing"
weight: 30
---

# Multiplexing & Charlieplexing

Driving a large number of individual LEDs — not addressable strip LEDs, but discrete LEDs in a custom matrix or indicator array — quickly exhausts available GPIO pins. Multiplexing exploits persistence of vision to drive N×M LEDs from N+M pins by scanning through rows (or columns) fast enough that the eye perceives all LEDs as simultaneously lit. Charlieplexing pushes this further, exploiting the tri-state capability of GPIO pins to drive N×(N−1) LEDs from just N pins.

## Standard Row-Column Multiplexing

A multiplexed LED matrix connects LEDs at every intersection of a row wire and a column wire. An 8×8 matrix contains 64 LEDs but requires only 16 pins (8 rows + 8 columns). At any given moment, one row is driven high (or low, depending on polarity) while the column pins control which LEDs in that row are lit. The firmware rapidly scans through all rows, enabling each one in sequence. If the scan rate exceeds roughly 100–200Hz per complete frame, the eye perceives a steady, non-flickering image.

The tradeoff is duty cycle: in an 8-row matrix, each row is on for 1/8 of the time. To achieve the same perceived brightness as a directly driven LED, the peak current during the active phase must be 8× higher. This requires the GPIO pins (or driver transistors) to handle higher peak current, and the LED must be rated for the pulsed current level. Most standard LEDs can handle 5–10× their continuous rating in pulsed operation with appropriate duty cycles.

## Charlieplexing

Charlieplexing takes advantage of the fact that most microcontroller GPIO pins have three states: high, low, and high-impedance (input/tri-state). With N pins, Charlieplexing drives N×(N−1) LEDs — compared to multiplexing's N×M with N+M pins. For 3 pins, that's 6 LEDs; for 6 pins, 30 LEDs; for 8 pins, 56 LEDs.

The wiring places an LED between every ordered pair of pins. The LED between pin A and pin B lights when A is driven high, B is driven low, and all other pins are set to high-impedance (so they neither source nor sink current). The complementary LED (B to A, with reversed polarity) lights when the drive directions are reversed.

The practical limit on Charlieplexing is around 8–10 pins (56–90 LEDs). Beyond that, the wiring complexity becomes extreme, the duty cycle per LED drops below 1/56, and the peak current requirements become impractical. A dedicated LED driver IC is a better solution at that scale.

## Scan Rate and Flicker

The scan rate must be fast enough that each LED's off-time doesn't produce visible flicker. For an 8-row multiplexed display:

- Minimum frame rate: 100Hz (to avoid flicker)
- Scan rate per row: 100Hz × 8 rows = 800Hz
- Time per row: 1.25ms

For a Charlieplexed 8-pin array (56 LEDs), the scan rate per LED is 100Hz × 56 = 5.6kHz, giving just 178µs per LED. At this speed, interrupt-driven scanning with a hardware timer is essential — software delays in a main loop will produce visible flicker whenever other code takes time to execute.

## Driver ICs for Multiplexed Arrays

For larger matrices, dedicated driver ICs handle the multiplexing in hardware:

- **MAX7219/MAX7221**: Drives up to 8×8 LED matrices or 8 seven-segment digits. SPI interface, built-in scan circuitry, adjustable brightness. The workhorse for simple LED matrix projects.
- **HT16K33**: 16×8 multiplexed driver with I²C interface. Common in Adafruit's LED backpack products. Handles the scanning entirely in hardware.
- **IS31FL3731**: 16×9 matrix driver with individual 8-bit PWM per LED. I²C interface, designed for RGB LED matrices and animated displays.

## Tips

- Use a hardware timer interrupt for multiplexed scanning — never rely on delay loops in the main program, as any blocking code produces visible flicker
- For Charlieplexed arrays, ensure the GPIO pins can truly tri-state — some microcontrollers have weak internal pull-ups that are enabled by default in input mode, which causes ghost lighting
- Use external transistor drivers (MOSFETs or BJTs) for the row-enable lines in multiplexed matrices — most MCU GPIO pins cannot source/sink the peak current required for a full row at visible brightness
- Default to a MAX7219 for 7-segment or simple dot-matrix displays — the hardware scanning eliminates all firmware timing concerns

## Caveats

- **Brightness drops with multiplex ratio** — Each LED is only on for 1/N of the time. An 8-row matrix produces LEDs that appear 1/8 as bright as directly driven LEDs at the same current. Compensating with higher peak current has limits set by the LED's absolute maximum pulsed rating
- **Charlieplexing does not support lighting all LEDs simultaneously** — Only one LED can be on at any instant. For displays that need many LEDs lit at once, the duty cycle per LED becomes very low and the perceived brightness drops accordingly
- **Ghost lighting is a persistent Charlieplexing problem** — Parasitic paths through off-state LEDs can weakly illuminate LEDs that should be dark. The effect is faint but visible in dark environments. Careful attention to LED forward voltage matching and the microcontroller's tri-state leakage current is needed
- **PCB routing for Charlieplexed arrays is complex** — Every pin connects to every other pin through an LED, creating a dense web of traces. Beyond about 20 LEDs, the PCB layout becomes a significant design challenge

## In Practice

- A multiplexed display that appears to flicker when the user moves their eyes (saccade-induced flicker) but looks steady when staring is running at a marginal scan rate — increasing the frame rate to 200Hz or above usually eliminates this
- Individual LEDs in a Charlieplexed array that glow faintly when they should be off are exhibiting ghosting from parasitic current paths — adding small series resistors or verifying true tri-state behavior on the GPIO pins addresses this
- A multiplexed 7-segment display that shows correct digits but at uneven brightness across segments usually has unequal row-enable timing — one row's ISR routine takes slightly longer than the others, producing a visible brightness difference
- An LED matrix driven by a MAX7219 that looks perfect at close range but shows visible scan lines when photographed is operating at the MAX7219's default scan rate — most applications look fine to the eye but the camera's shutter speed resolves the individual scan phases
