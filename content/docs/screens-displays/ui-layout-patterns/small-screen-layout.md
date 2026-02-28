---
title: "Layout Strategies for Small Screens"
weight: 10
---

# Layout Strategies for Small Screens

Designing for a 128x64 OLED or a 240x320 TFT is nothing like designing for a phone screen. Every pixel matters, text choices are constrained, and there's no room for decorative padding. But small doesn't mean primitive — with careful layout, these tiny screens can communicate a surprising amount of information clearly.

## Information Hierarchy

The first question for any small screen UI is: what does the user need to see *right now*? On a 128x64 display, you might fit 4 lines of medium text or 8 lines of tiny text. That's your entire information budget. Prioritize ruthlessly:

- **Primary value**: the one number or status the user cares about most, displayed large and prominently
- **Secondary context**: units, labels, or supporting data, displayed smaller
- **Status indicators**: battery, connectivity, mode — often as small icons rather than text

A common mistake is trying to show everything at once. A temperature sensor readout doesn't need to simultaneously display the current reading, min, max, average, trend, timestamp, and battery level. Show the current reading prominently and put the rest on other pages or behind a button press.

## Status Bar Pattern

Many embedded UIs dedicate the top (or bottom) 8-16 pixels as a persistent status bar showing system-level info: battery level, wireless connectivity, current mode, or a clock. The remaining screen area shows page-specific content. This pattern works well because it gives users constant orientation — they always know the system state without navigating anywhere.

On a 128x64 OLED, an 8-pixel status bar leaves 56 pixels for content — still enough for 3-4 lines of readable text. Draw a 1-pixel horizontal line to visually separate the status bar from the content area.

## Multi-Page / Tab Navigation

When content doesn't fit on one screen, break it into pages that the user cycles through with a button press or rotary encoder. Common patterns:

- **Page indicator dots**: small circles at the bottom or side showing which page is active (like mobile app onboarding screens)
- **Page number**: "2/5" in a corner
- **Tab-style header**: the active section name at the top, changing as the user navigates

Keep the navigation model simple. "Press button to go to next page" is easier to learn than "short press for next, long press for back, double press for home." Users will learn complex navigation eventually, but in practice, most embedded UIs work best with minimal input.

## Scrolling Lists

For displaying more items than fit on screen (menu options, log entries, sensor channels), a scrolling list with a selection indicator works well. The visible window shows N items, and the list scrolls as the selection moves past the top or bottom edge. An arrow indicator or inverted-color highlight shows the current selection. Keep the list items short enough to avoid horizontal truncation — or truncate with an ellipsis if names are variable length.

## Layout for Different Display Sizes

The approach shifts with display resolution:

- **128x32** — extremely limited; one large reading or 2 lines of text; status bars are usually not worth the space cost
- **128x64** — the sweet spot for simple UIs; status bar + 3-4 content lines, or a larger primary display with secondary info
- **240x240 / 240x320** — enough room for actual UI design with buttons, icons, multiple data fields, and even small charts
- **320x480** — approaching phone-like layouts; multi-column data, detailed charts, image display

The temptation on larger displays is to fill all the space. Resist it — whitespace (or rather, blackspace on an OLED) improves readability and makes the important elements stand out.
