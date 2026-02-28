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

## Tips

- Use an online CGRAM character generator to design glyphs visually rather than computing byte arrays by hand
- Define all custom characters during initialization, right after the HD44780 wake-up sequence
- For progress bars, define a set of partially-filled characters (1/5, 2/5, 3/5, etc.) and string them across a row for smooth-looking fractional progress

## Caveats

- **All 8 slots are global** — Character code `0x00` displays the same glyph everywhere it appears on screen. You can't have slot 0 mean one thing on row 1 and another on row 2
- **CGRAM is volatile** — Custom characters are lost on power cycle. Reload them as part of your initialization routine
- **Redefining a character updates every instance immediately** — This is useful for animation (cycle a slot's definition in a timer), but it means you can't partially update character definitions without visible glitches

## In Practice

- A custom character that looks partially garbled or shows the wrong pattern often means the CGRAM address calculation is off by one slot — each slot is 8 bytes apart
- Characters that work after a reset but not on cold boot may indicate the CGRAM write is happening before the initialization sequence completes — add a delay before defining characters
- On some HD44780 clones, redefining a character while it's on screen may briefly show an intermediate state — adding a short delay after the CGRAM write before returning to DDRAM eliminates the flicker
