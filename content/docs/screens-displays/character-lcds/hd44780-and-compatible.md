---
title: "HD44780 & Compatible Controllers"
weight: 10
---

# HD44780 & Compatible Controllers

The HD44780 is the controller behind nearly every cheap character LCD in the embedded world — the 16x2 and 20x4 modules that have been around since the 1980s. It's genuinely the "hello world" of embedded displays. The blue or green LCDs with white or black text found at hackerspaces are almost certainly HD44780-based. The controller is so ubiquitous that dozens of manufacturers clone it, and the interface has become a de facto standard.

## Pin Layout and Wiring

A typical HD44780 module exposes 16 pins: `VSS` (GND), `VDD` (+5V), `V0` (contrast), `RS` (register select), `RW` (read/write), `E` (enable), `D0`–`D7` (data bus), and `LED+`/`LED-` for the backlight. In practice, tying `RW` low (write-only mode) and skipping `D0`–`D3` in 4-bit mode brings the GPIO count down to six data/control lines plus power. That's still a lot of pins, which is why I²C backpacks became so popular.

The contrast pin `V0` needs a voltage divider or a 10k potentiometer between `VDD` and `VSS`. Getting this wrong is the most common reason an LCD appears dead — the display is actually working, but contrast is set so that characters are invisible. Starting the pot fully toward `VSS` (ground) and slowly turning it until text appears is the standard approach.

## 4-Bit vs 8-Bit Mode

In 8-bit mode, a full byte goes over `D0`–`D7` in one clock cycle. In 4-bit mode, the high nibble goes first on `D4`–`D7`, `E` is pulsed, then the low nibble follows — two cycles per byte, but four GPIO pins are saved. Almost everyone uses 4-bit mode. The initialization sequence differs slightly between the two modes and is notoriously fiddly: a specific sequence of function-set commands with precise timing is required to reliably enter 4-bit mode from an unknown state. Most libraries handle this, but when writing a driver from scratch, the HD44780 datasheet timing diagrams are essential reading.

## Initialization Sequence

The HD44780 powers up in an undefined state, and the datasheet prescribes a specific wake-up sequence: wait at least 40ms after power-on, then send `0x30` three times with specific delays (4.1ms after the first, 100us after the second), then finally set the interface width. For 4-bit mode, sending `0x20` switches the interface, then display lines, font, display on/off, and entry mode are configured. Getting these delays wrong leads to intermittent startup failures — the display works sometimes and garbles other times. Being generous with delays (doubling the datasheet minimums) eliminates most flaky initialization problems.

## Tips

- Prefer 4-bit mode — it saves four GPIO pins and is what every library defaults to
- Be generous with initialization delays (double the datasheet minimums) to eliminate flaky startup behavior across different clones
- Tie `RW` low (write-only) to save a pin; busy-flag polling is rarely worth the extra GPIO
- Start the contrast pot fully toward `VSS` and turn slowly — an invisible display is almost always a contrast issue, not a dead module

## Caveats

- **The 20x4 DDRAM layout is non-obvious** — Row addresses go `0x00`, `0x40`, `0x14`, `0x54`. The third row follows the first in memory, and the fourth follows the second. Setting the cursor to "row 2, column 0" requires address `0x14`, not `0x28`
- **Command execution time varies widely** — Most commands take 37-40µs, but clear-display and return-home take 1.52ms. Sending commands faster than the controller can process them produces garbled output or missed characters
- **Clone controllers may differ subtly** — Dozens of manufacturers clone the HD44780. Most are compatible, but some have slightly different timing requirements or character ROM contents. If a display misbehaves with working code, increasing delays is the first thing to try before suspecting wiring

## In Practice

- A display that shows blocks on the top row and nothing on the bottom row has power but hasn't been initialized — the initialization sequence isn't completing correctly
- Characters appearing on the wrong rows on a 20x4 display almost always means the DDRAM address mapping wasn't accounted for
- Intermittent garbled text on startup that clears after a reset suggests the initialization delays are too tight — the controller occasionally isn't ready when the first commands arrive
