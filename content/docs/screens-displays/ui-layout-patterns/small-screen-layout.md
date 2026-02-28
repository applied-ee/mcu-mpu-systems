---
title: "Layout Strategies for Small Screens"
weight: 10
---

# Layout Strategies for Small Screens

Designing for a 128x64 OLED or a 240x320 TFT is nothing like designing for a phone screen. Every pixel matters, text choices are constrained, and there's no room for decorative padding. But small doesn't mean primitive — with careful layout, these tiny screens can communicate a surprising amount of information clearly.

## Information Hierarchy

The first question for any small screen UI is: what needs to be visible *right now*? On a 128x64 display, roughly 4 lines of medium text fit or 8 lines of tiny text. That's the entire information budget. Prioritize ruthlessly:

- **Primary value**: the one number or status the user cares about most, displayed large and prominently
- **Secondary context**: units, labels, or supporting data, displayed smaller
- **Status indicators**: battery, connectivity, mode — often as small icons rather than text

A common mistake is trying to show everything at once. A temperature sensor readout doesn't need to simultaneously display the current reading, min, max, average, trend, timestamp, and battery level. Show the current reading prominently and put the rest on other pages or behind a button press.

## Status Bar Pattern

Many embedded UIs dedicate the top (or bottom) 8-16 pixels as a persistent status bar showing system-level info: battery level, wireless connectivity, current mode, or a clock. The remaining screen area shows page-specific content. This pattern works well because it gives users constant orientation — the system state is always visible without navigating anywhere.

On a 128x64 OLED, an 8-pixel status bar leaves 56 pixels for content — still enough for 3-4 lines of readable text. Draw a 1-pixel horizontal line to visually separate the status bar from the content area.

## Multi-Page / Tab Navigation

When content doesn't fit on one screen, break it into pages that pages are cycled through with a button press or rotary encoder. Common patterns:

- **Page indicator dots**: small circles at the bottom or side showing which page is active (like mobile app onboarding screens)
- **Page number**: "2/5" in a corner
- **Tab-style header**: the active section name at the top, changing as the user navigates

Keep the navigation model simple. "Press button to go to next page" is easier to learn than "short press for next, long press for back, double press for home." Complex navigation is learnable, but in practice, most embedded UIs work best with minimal input.

## Scrolling Lists

For displaying more items than fit on screen (menu options, log entries, sensor channels), a scrolling list with a selection indicator works well. The visible window shows N items, and the list scrolls as the selection moves past the top or bottom edge. An arrow indicator or inverted-color highlight shows the current selection. Keep the list items short enough to avoid horizontal truncation — or truncate with an ellipsis if names are variable length.

## Layout for Different Display Sizes

The approach shifts with display resolution:

- **128x32** — extremely limited; one large reading or 2 lines of text; status bars are usually not worth the space cost
- **128x64** — the sweet spot for simple UIs; status bar + 3-4 content lines, or a larger primary display with secondary info
- **240x240 / 240x320** — enough room for actual UI design with buttons, icons, multiple data fields, and even small charts
- **320x480** — approaching phone-like layouts; multi-column data, detailed charts, image display

The temptation on larger displays is to fill all the space. Restraint helps — whitespace (or rather, blackspace on an OLED) improves readability and makes the important elements stand out.

## Tips

- Start by identifying the single most important value or status for each screen, then design the layout around it — everything else is supporting context
- Use a 1-pixel separator line between the status bar and content area for clear visual hierarchy on monochrome displays
- Keep the navigation model as simple as possible — "press to advance" is learnable in seconds; multi-button combinations require documentation

## Caveats

- **128x32 displays are too small for status bars** — Dedicating 8 pixels to a status bar leaves only 24 pixels (3 rows of tiny text) for content. On these displays, use the full screen for content and show status information on a separate page
- **Font size sets the information density ceiling** — On a 128x64 display, readable text at 8px height gives 8 lines. At 16px, 4 lines fit. The font choice is an architectural decision, not just an aesthetic one
- **Page-based navigation hides information** — Users can only see one page at a time. If critical information spans multiple pages, users must remember or navigate back and forth. Minimize cross-page dependencies

## In Practice

- A UI that feels cluttered on a small display usually has too many elements competing for attention — remove or relocate secondary information rather than shrinking fonts
- Users who frequently cycle through pages to find information suggest the page organization doesn't match their mental model — regroup content based on usage patterns, not logical categories
- A status bar that consumes too much vertical space can often be compressed by using icons instead of text — a battery icon takes 8x8 pixels, while "BAT: 72%" takes 8x56 or more
