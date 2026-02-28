---
title: "Custom Characters & CGRAM"
weight: 30
---

# Custom Characters & CGRAM

The HD44780 has a lesser-known feature that's surprisingly useful: you can define up to 8 custom characters and display them alongside the built-in font. These live in CGRAM (Character Generator RAM), a small writable area separate from the main character ROM. Each custom character is a 5x8 pixel bitmap, and you reference them using character codes `0x00` through `0x07`. It's not much, but it's enough for battery icons, signal bars, custom arrows, or mini progress bars.

## Defining a Custom Character

Each character is defined by 8 bytes, one per row, where the lower 5 bits of each byte set the pixels (MSB is leftmost, but only bits 4–0 matter). For example, a simple smiley face might be `0x00, 0x0A, 0x00, 0x11, 0x0E, 0x00, 0x00, 0x00` — you sketch it out on a 5x8 grid, convert each row to a binary value, and that's your character data. There are plenty of online generators that let you click pixels and spit out the byte array, which saves the tedious manual bit-twiddling.

To load a character, you send a "set CGRAM address" command pointing to the character slot (slot number times 8), then write 8 data bytes. After that, writing character code `0x00` to the display shows your custom character in slot 0, `0x01` shows slot 1, and so on. Most libraries wrap this in a `createChar(slot, data)` function.

## Practical Uses

The 8-slot limit forces some creativity. Common patterns I've seen and used:

- **Progress bars**: Define characters for empty, 1/5 filled, 2/5 filled, etc., then string them across a row for a smooth progress indicator wider than a single character
- **Battery icons**: A set of battery outlines at different charge levels — full, three-quarter, half, quarter, empty
- **Arrows and navigation symbols**: Custom arrows that look better than the `>` and `<` characters from the built-in font
- **Unit symbols**: Degree symbol (°) is actually in the HD44780 ROM already at `0xDF`, but other symbols like "µ" might need custom characters
- **Simple animations**: You can redefine a CGRAM slot while the character is displayed, and the display updates immediately — so you can animate a spinning icon by cycling through definitions in a timer loop

## Gotchas

The main limitation is that all 8 slots are global. If character code `0x00` is defined as a battery icon, every position on the display showing `0x00` displays that same icon. You can't have slot 0 mean one thing on the first line and another on the second. Also, CGRAM is volatile — it resets on power cycle, so you need to reload your custom characters during initialization. One subtle issue: some HD44780 clones have slightly different CGRAM behavior, particularly around the timing of when redefined characters appear on screen. If a character looks partially updated, add a brief delay after writing the CGRAM data before refreshing the display.
