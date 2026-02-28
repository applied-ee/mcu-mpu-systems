---
title: "I2C Backpack Modules"
weight: 20
---

# I²C Backpack Modules

If you've used a character LCD in the last decade, odds are you used an I²C backpack rather than wiring up the parallel interface directly. These tiny PCBs solder onto the back of a standard HD44780 module and reduce the connection down to four wires: `VCC`, `GND`, `SDA`, and `SCL`. The most common chip on these boards is the PCF8574 (or PCF8574A), an 8-bit I/O expander that bit-bangs the HD44780's parallel interface over I²C.

## How They Work

The PCF8574 provides 8 GPIO pins over I²C. The backpack maps these to the HD44780's `RS`, `E`, `RW`, `D4`–`D7`, and the backlight transistor control. When you write a byte to the PCF8574, it sets those 8 output lines accordingly. To send a nibble to the LCD, the library writes the data bits along with `E` high, then writes again with `E` low — toggling the enable line remotely. It's surprisingly effective, though noticeably slower than direct GPIO since every nibble requires two I²C transactions.

## Address Selection

The PCF8574 has three address pins (`A0`, `A1`, `A2`) exposed as solder jumpers on the backpack board. The base address is `0x20` for the PCF8574 and `0x27` for some common modules (the most typical default). The PCF8574A variant uses base address `0x38`. If you're getting no response, run an I²C scan — it's the fastest way to find the actual address. I've seen modules from different suppliers ship with different default addresses even when they look identical. If you need multiple character LCDs on the same bus, you can set unique addresses by bridging or cutting the `A0`–`A2` jumpers, giving you up to 8 addresses per chip variant.

## Library Landscape

The library support is excellent across platforms. On Arduino, `LiquidCrystal_I2C` is the go-to — it's a drop-in replacement for the built-in `LiquidCrystal` library but communicates over I²C instead of parallel GPIO. For ESP-IDF, there are several I²C LCD components available in the component registry. MicroPython has `lcd_i2c` and similar modules. The one thing to watch is the pin mapping — not all backpack boards wire the PCF8574 outputs to the same HD44780 pins, and some libraries let you specify the mapping while others assume a fixed layout. If your display shows garbled text, a pin mapping mismatch is a likely culprit.

## Tips

- Always run an I²C scan first to find the actual address — don't trust the product listing
- If you need multiple LCDs on one bus, bridge the `A0`–`A2` solder jumpers to set unique addresses
- Try 400kHz I²C clock for faster updates, but fall back to 100kHz if you see missed characters or display glitches

## Caveats

- **Pin mapping varies between backpack boards** — Not all boards wire the PCF8574 outputs to the same HD44780 pins. If the display shows garbled text with a working library, the pin mapping is likely wrong. Some libraries let you specify the mapping; others assume a fixed layout
- **Backlight is all-or-nothing** — The backlight transistor on most backpacks only supports on/off control. PWM dimming requires adding your own drive circuit
- **I²C speed limits real update rate** — At 100kHz, a full 16x2 display update is noticeably slower than direct parallel. For status text this is fine; for scrolling or animation, the latency is visible

## In Practice

- A backpack module that doesn't respond to any I²C address is usually a wiring issue (swapped SDA/SCL) or missing pull-up resistors — check both before suspecting a dead module
- Garbled text that's consistently wrong (same wrong characters each time) points to a pin mapping mismatch between the library and the board layout
- Display corruption when other I²C devices share the bus suggests address conflicts or bus capacitance issues at higher clock speeds
