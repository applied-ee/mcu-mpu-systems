---
title: "SPI Configuration & Wiring"
weight: 20
---

# SPI Configuration & Wiring

TFT displays over SPI involve more wires and more configuration choices than I²C OLEDs. Getting the SPI mode, clock speed, and control pins right is essential — misconfigure any one of them and you'll get a white screen, garbled colors, or nothing at all.

## Pin Connections

A typical TFT SPI module exposes these pins:

- **SCK / CLK** — SPI clock
- **MOSI / SDA / DIN** — data from MCU to display (naming varies wildly across modules)
- **CS / SS** — chip select, active low
- **DC / RS / A0** — data/command select; high = pixel data, low = command bytes
- **RST / RES** — hardware reset, active low
- **BLK / LED** — backlight control
- **MISO / SDO** — data from display to MCU (optional, often unused)

The `DC` pin is the one that distinguishes TFT SPI from normal SPI peripherals. The display needs to know whether each byte is a command (like "set column address") or data (like pixel values). This pin toggles between the two, and your driver must manage it in sync with the SPI transfers. Libraries handle this, but it means TFT displays don't play nicely with generic SPI abstraction layers that don't account for the DC pin.

## SPI Mode and Clock Speed

Most TFT controllers (ILI9341, ST7789, ST7735) use SPI Mode 0 (CPOL=0, CPHA=0). Using the wrong mode typically produces garbled or shifted pixel data. Clock speed varies by controller and wiring: the ILI9341 datasheet specifies a write clock maximum of 10MHz, but in practice most modules work fine at 40MHz, and many people run them at 80MHz with short wires. Long jumper wires or breadboard connections will limit your reliable speed — if you see pixel corruption at high clock rates, try dropping the speed before debugging anything else.

## Level Shifting

Many TFT modules are 3.3V logic. If your MCU runs at 5V (classic Arduino boards), you need level shifting on the SPI lines. Some modules are 5V-tolerant on their inputs, but this isn't guaranteed and risks damaging the display controller over time. A simple solution is a set of resistive voltage dividers, but dedicated level-shifter ICs (like the 74LVC245 or TXB0104) are more reliable at higher SPI speeds. If your MCU is already 3.3V (ESP32, STM32, RP2040), this isn't a concern.

## Backlight Control

The backlight pin usually connects to an LED anode through a current-limiting resistor on the module. Pulling it high turns the backlight on at full brightness. For dimming, you can drive it with a PWM signal — most modules tolerate this fine. Some modules have a built-in transistor so you can control the backlight with a logic-level GPIO; others need you to source the LED current directly, which may exceed what a GPIO pin can safely supply. Check the module's schematic if brightness control matters for your project.

## Reset Pin

The hardware reset pin (`RST`) isn't strictly required — most controllers support a software reset command — but using it is more reliable, especially at startup. A typical pattern is to pull `RST` low for 10-100ms, then release it and wait another 100-200ms before starting the initialization sequence. If you're short on GPIO, you can tie `RST` to your MCU's reset line so they reset together, or tie it high through a resistor and rely on software reset.

## Tips

- Use SPI Mode 0 (CPOL=0, CPHA=0) unless the datasheet explicitly says otherwise — this is correct for ILI9341, ST7789, and ST7735
- Start at a conservative SPI clock (10MHz), confirm the display works, then increase incrementally until you find the reliable maximum for your wiring
- Use the hardware reset pin if you have a spare GPIO — it eliminates a class of initialization failures that software reset can't always recover from
- For 5V MCUs, use dedicated level shifters rather than resistive dividers for SPI speeds above 10MHz

## Caveats

- **The DC pin makes TFT SPI non-standard** — Generic SPI libraries that don't manage a data/command pin won't work. The display driver must toggle DC in sync with each SPI transaction
- **Long wires limit SPI speed** — Breadboard jumper wires add capacitance and inductance. If a display works on short wires but corrupts on longer ones, reduce the clock speed before debugging the driver
- **Backlight current may exceed GPIO limits** — Some modules expect the backlight pin to source 20-40mA, which exceeds what many MCU GPIO pins can safely provide. Check the module schematic or measure the current before connecting directly to a GPIO

## In Practice

- A display that flickers or shows intermittent corruption at high SPI speeds but works fine at lower speeds is hitting the reliable speed limit of the wiring — shorter, cleaner connections allow higher clocks
- Pixel data that appears shifted or offset by one pixel column often indicates a timing issue with the DC pin — the controller is interpreting the first data byte as a command or vice versa
- A display that initializes correctly but shows no backlight may have the backlight pin floating — some modules need it explicitly driven high
