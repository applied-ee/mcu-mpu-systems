---
title: "Common E-Ink Modules"
weight: 30
---

# Common E-Ink Modules

The E-Ink module market is dominated by a few manufacturers who package electrophoretic display panels with driver boards aimed at hobbyists and product developers. Knowing the major players and their module conventions saves time when selecting hardware and finding compatible libraries.

## Waveshare

Waveshare is probably the most visible E-Ink module brand in the hobbyist space. They offer a wide range of sizes (1.54", 2.13", 2.9", 4.2", 7.5" and larger), colors (black/white, black/white/red, black/white/yellow), and interface options. Their modules typically come with an FPC cable and a breakout board with SPI pins clearly labeled. Documentation quality varies but is generally adequate, and they provide example code for Arduino, Raspberry Pi, and STM32.

Waveshare model numbers encode useful information: the size in inches and a version letter (e.g., "2.13inch e-Paper V4" uses a different controller than V2). Getting the version right matters — using a V2 driver on a V4 panel produces nothing. Always check the silkscreen on the board or the product page for the exact revision.

## Good Display (GDEH / GDEW / DEPG Series)

Good Display is one of the largest E-Ink panel OEMs, and you'll encounter their panels even in modules branded by other companies. Their model numbering follows a pattern: `GDEH` prefix for older series, `GDEW` for newer, and `DEPG` for their latest generation. The numbers typically encode the size and color capability. Good Display panels often have better documentation on waveform LUTs than Waveshare, which matters if you're doing custom LUT work.

Many "generic" E-Ink breakout boards on AliExpress use Good Display panels, so knowing the GDEW/DEPG model number helps you find the right datasheet and driver even when the seller's listing is vague.

## SPI Wiring

Nearly all E-Ink modules use SPI with a few extra control pins:

- **SCK, MOSI, CS** — standard SPI lines
- **DC** — data/command select, same concept as TFT displays
- **RST** — hardware reset
- **BUSY** — output from the display indicating it's still processing a refresh

The `BUSY` pin is unique to E-Ink and critical. After sending a refresh command, the controller takes seconds to physically update the display. The BUSY pin goes high (or low, depending on the module) during this time. You must wait for BUSY to signal completion before sending the next command, or the update will fail or produce corrupted output. Polling the BUSY pin in a loop is the standard approach.

## Typical Resolutions and Colors

| Size | Resolution | Common Controllers | Notes |
|------|-----------|-------------------|-------|
| 1.54" | 200x200 | SSD1681, IL3829 | Small, good for badges |
| 2.13" | 250x122 | SSD1680, UC8151 | Popular size, many variants |
| 2.9" | 296x128 | SSD1680, UC8151 | Good balance of size and resolution |
| 4.2" | 400x300 | SSD1619, UC8176 | Large enough for detailed content |
| 7.5" | 800x480 | IT8951 (with HAT) | Needs more RAM, often uses separate controller board |

Three-color displays (adding red or yellow) use different controllers and have significantly slower refresh times (often 10-15 seconds for a full refresh) because the third pigment particles need additional waveform phases to position correctly.

## Library Support

GxEPD2 (Arduino/ESP) is the most comprehensive E-Ink library, supporting dozens of panel variants. For Raspberry Pi, Waveshare's own Python library works well. For ESP-IDF, there are components in the IDF component registry but the ecosystem is less mature than for TFTs. MicroPython E-Ink support exists but varies in completeness depending on the display model.

## Tips

- Always check the exact module version (e.g., Waveshare 2.13" V2 vs V4) before selecting a driver — different versions use different controllers and are not interchangeable
- Use GxEPD2 as the starting point for Arduino/ESP projects; it supports the widest range of panels and handles the BUSY pin polling automatically
- For the best documentation on waveform LUTs, look at Good Display datasheets rather than Waveshare — Good Display is often the actual panel OEM

## Caveats

- **The BUSY pin is not optional** — Unlike TFT displays where you can fire-and-forget commands, E-Ink requires waiting for the BUSY signal after every refresh. Ignoring it produces corrupted or incomplete updates
- **Module versions matter more than module size** — A Waveshare 2.13" V2 uses a completely different controller than a V4. Using the wrong driver version produces nothing on screen
- **Large E-Ink panels (7.5"+) need separate controller boards** — They require more RAM than a typical MCU can provide and often use an IT8951 controller HAT that communicates over SPI or I²C at a higher level of abstraction

## In Practice

- A module that produces no output at all, despite correct SPI communication, is almost always a version/controller mismatch — verify the controller IC printed on the board's flex cable or silkscreen
- Partial artifacts or incomplete updates that seem to "time out" suggest the BUSY pin isn't being polled correctly — check the active level (some modules are active-high, others active-low)
- Modules from different suppliers that look identical may use different panel revisions — always verify by testing with known-working example code before integrating into a project
