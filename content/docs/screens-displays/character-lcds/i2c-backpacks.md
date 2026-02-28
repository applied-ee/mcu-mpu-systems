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

## Gotchas

The biggest practical issue is speed. I²C transactions add overhead, and at the standard 100kHz clock rate, updating the full display takes noticeably longer than direct parallel. For most applications (showing sensor readings, status text) this doesn't matter. But if you're trying to do rapid display updates or smooth scrolling, you'll feel the latency. Bumping the I²C clock to 400kHz helps, though not all PCF8574 modules handle it reliably. Also, the backlight control is typically all-or-nothing via a transistor — there's no PWM dimming unless you add your own circuit.
