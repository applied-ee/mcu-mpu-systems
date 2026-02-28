---
title: "Color Formats & Pixel Packing"
weight: 30
---

# Color Formats & Pixel Packing

Color representation on embedded displays is surprisingly tricky once you move beyond "set this pixel to red." The display controller expects pixels in a specific binary format, and getting the byte ordering or bit packing wrong produces psychedelic but incorrect output. Understanding RGB565, RGB666, and the endianness gotchas will save you real debugging time.

## RGB565

RGB565 is the most common color format for embedded TFTs. Each pixel is 16 bits: 5 bits red, 6 bits green, 5 bits blue (green gets the extra bit because human eyes are more sensitive to green). The bit layout in a 16-bit value is:

```
RRRRRGGG GGGBBBBB
```

So pure red is `0xF800`, pure green is `0x07E0`, pure blue is `0x001F`, white is `0xFFFF`, and black is `0x0000`. To convert from 24-bit RGB (8 bits per channel), the formula is:

```
rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
```

This format is compact (2 bytes per pixel) and maps directly to what controllers like the ILI9341 and ST7789 expect in 16-bit color mode.

## RGB666

Some controllers, notably the ILI9488 over SPI, use 18-bit color: 6 bits each for red, green, and blue. Since SPI sends whole bytes, each pixel takes 3 bytes, with the color data in the upper 6 bits of each byte:

```
RRRRRR00 GGGGGG00 BBBBBB00
```

This wastes 25% of the bandwidth compared to RGB565 and makes the framebuffer 50% larger. In exchange, you get slightly better color gradients (64 levels per channel instead of 32/64/32). Whether that's visible in practice depends on your content — for UI elements and text, you probably won't notice the difference.

## Byte Ordering and Endianness

Here's where things get confusing. The TFT controller expects bytes in a specific order over SPI — typically big-endian (MSB first). But your MCU might be little-endian (ARM Cortex-M cores are). So an RGB565 value of `0xF800` (red) stored in MCU memory as two bytes is `0x00 0xF8` (little-endian), but the display wants `0xF8 0x00` (big-endian).

If you send pixel data without swapping bytes, colors will be wrong: red becomes a dark blue, green shifts, and everything looks off. Most display libraries handle the byte swap internally, either in software or by configuring the SPI peripheral's data size to 16-bit mode (which often handles endianness automatically). But if you're writing a raw driver or doing DMA transfers from a framebuffer, you need to either pre-swap the buffer contents or configure the byte order correctly. Some controllers have a register bit that swaps the byte order on the display side, which is the cleanest solution when available.

## Converting from 24-Bit Color

When working with color constants or importing images, you'll frequently need to convert 24-bit (0xRRGGBB) to RGB565. Some tips:

- Many graphics libraries provide a `color565(r, g, b)` helper function
- Online color pickers that show RGB565 hex values are handy for defining UI colors
- For images and bitmaps, tools like GIMP or ImageMagick can export in RGB565 format, or you can use offline converters that output C arrays
- Be aware that the conversion is lossy — the 5/6/5 bit reduction means not every 24-bit color has an exact RGB565 equivalent, and banding can be visible in smooth gradients

## Tips

- Use your library's `color565(r, g, b)` helper rather than hand-computing RGB565 values — it avoids off-by-one shift errors
- Define UI colors as named constants in RGB565 once, rather than converting from 24-bit at runtime
- For image assets, use offline conversion tools that output C arrays in the correct format rather than decoding images on the MCU

## Caveats

- **Byte-swap errors produce wrong colors, not garbled images** — If red shows up as dark blue and vice versa, the RGB565 byte order is swapped. The image structure will look correct but the colors will be wrong
- **RGB666 wastes bandwidth** — 3 bytes per pixel instead of 2, with no perceptible quality improvement for most UI content. If your controller supports RGB565, use it
- **Endianness is a per-transfer concern** — A framebuffer stored in MCU memory with swapped bytes works correctly for DMA transfers but will confuse any CPU-side code that reads pixel values directly. Pick one convention and be consistent

## In Practice

- Colors that look "almost right but slightly off" after format conversion usually mean the bit shift or mask is wrong by one position — double-check the 5/6/5 bit layout against the formula
- Visible banding in gradients on an RGB565 display is expected and inherent to the format — dithering can help but adds complexity
- An image that looks correct on one display but color-shifted on another may be a byte-order difference between controllers — check whether both expect the same MSB/LSB ordering
