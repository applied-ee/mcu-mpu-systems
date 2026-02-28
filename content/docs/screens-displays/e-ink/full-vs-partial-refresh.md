---
title: "Full vs. Partial Refresh"
weight: 20
---

# Full vs. Partial Refresh

The refresh behavior of E-Ink displays is where most of the practical complexity lives. Understanding the difference between full and partial refresh — and the tradeoffs involved — is essential for building E-Ink projects that look good and don't degrade the display.

## Full Refresh

A full refresh cycles every pixel through a complete sequence: typically white → black → white → target color (or a similar multi-step waveform). This takes 2-4 seconds on most modules and produces the characteristic "flash" effect. The advantage is that every pixel is fully driven to its correct state — no ghosting, no artifacts, crisp contrast. Full refresh is the "clean slate" operation.

Most E-Ink manufacturers recommend a full refresh periodically (every few partial refreshes, or at minimum every few hours) to clear accumulated ghosting artifacts and maintain display health. Some datasheets suggest a full refresh every 10-20 partial updates, though the exact ratio depends on the panel and content.

## Partial Refresh

Partial refresh updates only the pixels that need to change, skipping the full black-white cycling. This is much faster — often under a second — and avoids the distracting flash. It makes E-Ink usable for things like updating a clock display every minute or changing a single sensor reading.

The tradeoff is ghosting: faint remnants of previous images remain visible because the particles weren't fully reset. After several partial refreshes, the display can look muddy, with reduced contrast and visible shadows of old content. The severity depends on the display panel, the waveform LUTs, and the ambient temperature.

## LUT Tables

The waveform lookup tables (LUTs) are the core of E-Ink refresh behavior. They define the exact voltage sequence applied to each pixel during a refresh, and different LUTs produce different speed/quality tradeoffs. Some displays store LUTs in an on-board flash chip (OTP — one-time programmable); others allow uploading custom LUTs from the MCU. The latter gives you control over refresh behavior at the cost of complexity.

Libraries like GxEPD2 often ship multiple LUT options: a "default" full-refresh LUT and a "fast" partial-refresh LUT. Some advanced users create custom LUTs tuned for their specific use case — for example, optimizing for text display rather than images, or tweaking timing for a specific operating temperature range.

## Fast Mode / Turbo Refresh

Some newer E-Ink panels and controllers support a "fast mode" that can refresh in under 300ms by using aggressive, shortened waveforms. The image quality is lower — reduced contrast, more ghosting — but the speed opens up possibilities like slowly-updating animations or reasonably responsive UI. Good Display's "fast refresh" panels and Waveshare's modules with partial refresh support have made this increasingly accessible.

## Practical Recommendations

For most projects, a workable pattern is:

- Use **partial refresh** for routine updates (sensor readings, time display, status changes)
- Perform a **full refresh** periodically to clean up ghosting (every 10-30 partial updates, or on a timer)
- Use **full refresh** whenever the entire screen content changes (page navigation, mode switching)
- Avoid rapid partial refreshes in a tight loop — give the display time to settle between updates
- If operating in extreme temperatures (below 0°C or above 40°C), expect slower refresh and more ghosting; some controllers have temperature compensation, but it's not perfect
