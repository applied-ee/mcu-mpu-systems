---
title: "HD44780 & Compatible Controllers"
weight: 10
---

# HD44780 & Compatible Controllers

The HD44780 is the controller behind nearly every cheap character LCD you'll encounter — the 16x2 and 20x4 modules that have been around since the 1980s. It's genuinely the "hello world" of embedded displays. If you've seen a blue or green LCD with white or black text at a hackerspace, it was almost certainly HD44780-based. The controller is so ubiquitous that dozens of manufacturers clone it, and the interface has become a de facto standard.

## Pin Layout and Wiring

A typical HD44780 module exposes 16 pins: `VSS` (GND), `VDD` (+5V), `V0` (contrast), `RS` (register select), `RW` (read/write), `E` (enable), `D0`–`D7` (data bus), and `LED+`/`LED-` for the backlight. In practice you can tie `RW` low (write-only mode) and skip `D0`–`D3` entirely if you use 4-bit mode, which brings the GPIO count down to six data/control lines plus power. That's still a lot of pins, which is why I²C backpacks became so popular.

The contrast pin `V0` needs a voltage divider or a 10k potentiometer between `VDD` and `VSS`. Getting this wrong is the most common reason people think their LCD is dead — the display is actually working, but contrast is set so that characters are invisible. Start with the pot fully toward `VSS` (ground) and slowly turn it until text appears.

## 4-Bit vs 8-Bit Mode

In 8-bit mode, you send a full byte over `D0`–`D7` in one clock cycle. In 4-bit mode, you send the high nibble first on `D4`–`D7`, pulse `E`, then send the low nibble — two cycles per byte, but you save four GPIO pins. Almost everyone uses 4-bit mode. The initialization sequence differs slightly between the two modes and is notoriously fiddly: you have to send a specific sequence of function-set commands with precise timing to reliably enter 4-bit mode from an unknown state. Most libraries handle this, but if you're writing a driver from scratch, the HD44780 datasheet timing diagrams are essential reading.

## Initialization Sequence

The HD44780 powers up in an undefined state, and the datasheet prescribes a specific wake-up sequence: wait at least 40ms after power-on, then send `0x30` three times with specific delays (4.1ms after the first, 100us after the second), then finally set the interface width. For 4-bit mode, you send `0x20` to switch, then configure display lines, font, display on/off, and entry mode. Getting these delays wrong leads to intermittent startup failures — the display works sometimes and garbles other times. I've found that being generous with delays (doubling the datasheet minimums) eliminates most flaky initialization problems.

## Gotchas

One thing that trips people up: the HD44780 has a relatively slow internal controller. After sending a character or command, you need to wait for the busy flag to clear (typically 37-40us for most commands, but 1.52ms for clear-display and return-home). You can either poll the busy flag via the `RW` pin or just insert conservative delays. Most simple drivers use delays to avoid the complexity of reading back from the display. Also, the 20x4 display has a non-obvious memory layout — the third row follows the first in DDRAM, and the fourth follows the second, so row addresses go `0x00`, `0x40`, `0x14`, `0x54`. That catches everyone at least once.
