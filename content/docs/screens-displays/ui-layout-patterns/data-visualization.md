---
title: "Data Visualization on MCUs"
weight: 30
---

# Data Visualization on MCUs

Displaying raw numbers on a screen is useful, but visualizing data as charts, gauges, or graphs makes patterns immediately obvious. The challenge on MCUs is doing this with limited resolution, limited RAM (no floating-point-heavy chart libraries), and limited CPU time. The good news: even simple visualizations are surprisingly effective on small screens.

## Sparklines

A sparkline is a minimal line chart without axes or labels — just the data trend rendered as a thin line across a small area. It's perfect for showing "what has this value been doing recently?" in a compact space. Implementation is straightforward: keep a circular buffer of N recent values (where N equals the pixel width of the sparkline), scale the values to the pixel height, and draw a line connecting adjacent points.

Scaling is the key detail: map your data range to the pixel range. If your temperature readings range from 20°C to 30°C and your sparkline area is 40 pixels tall, each degree equals 4 pixels. You can either use a fixed range (good when you know the expected bounds) or auto-scale to the min/max of the current buffer (good for exploration, but can make small variations look like dramatic swings).

## Bar Charts

Vertical bar charts work well on small screens for comparing a few discrete values — channel levels, per-sensor readings, or categorical data. Each bar is just a `fillRect()` call. A 128-pixel-wide display can comfortably fit 5-8 bars with spacing. Horizontal bar charts are useful when labels are important (the label goes to the left, the bar extends right).

For a progress bar or level indicator, a single bar with a filled portion and an empty outline is the simplest visualization and one of the most commonly used. Add tick marks or thresholds by drawing short lines at specific positions.

## Gauges

A semicircular or arc gauge gives an analog-meter feel that's immediately readable. Drawing an arc gauge involves some trigonometry: for each angular position, compute the (x, y) endpoint using `sin()` and `cos()`, then draw a line from the center (or a tick mark at the edge). Most libraries don't have a native "draw arc" function, so you build it from line segments or individual pixels.

For resource-constrained MCUs, pre-computing a lookup table of sin/cos values (even just 90 entries for a quarter circle) avoids runtime floating-point math. Or use integer-only approximations — for a gauge with 30-50 angular positions, the precision requirements are very low.

## Live-Updating Plots

For continuous data display (like an oscilloscope trace or a rolling temperature log), the common approach is:

1. Maintain a circular buffer of the last N samples
2. On each update, shift the buffer (or advance the write pointer) and add the new sample
3. Redraw the entire plot area

The "redraw everything" approach is simple and avoids artifacts, but can flicker on slow displays. Alternatives include scrolling the existing framebuffer content left by one pixel and drawing only the new column, which is faster but requires framebuffer-level access.

For faster signals, consider a triggered sweep like an oscilloscope: fill the buffer, render the full trace, wait for a trigger condition, then fill and render again. This decouples the sample rate from the display refresh rate.

## Scaling Data to Pixel Ranges

The core math for any visualization is mapping data values to pixel coordinates:

```
pixel = (value - data_min) * (pixel_max - pixel_min) / (data_max - data_min) + pixel_min
```

Use integer arithmetic where possible: multiply before dividing to maintain precision, and watch for overflow on 16-bit platforms. For Y-axis mapping, remember that pixel coordinates typically increase downward, so you'll need to invert: `pixel_y = pixel_max - scaled_value`.

Fixed-point math (e.g., scaling by 256 and shifting right by 8) is a practical alternative to floating point when you need fractional precision without the FPU overhead.

## Tips

- Use a fixed data range for sparklines and gauges when the expected bounds are known — auto-scaling makes small noise look like dramatic changes
- For bar charts on small displays, include a 1-pixel gap between bars for visual clarity — solid adjacent bars are harder to distinguish, especially on monochrome screens
- Multiply before dividing in integer scaling math to preserve precision, and use 32-bit intermediates to avoid overflow on 16-bit platforms

## Caveats

- **Auto-scaling sparklines can be misleading** — If the data range is narrow (e.g., temperature varying by 0.5°C), auto-scaling magnifies noise into what looks like significant variation. Fixed ranges prevent this at the cost of reduced visual resolution for small changes
- **Y-axis is inverted in pixel coordinates** — Screen coordinates increase downward, but data values typically increase upward. Forgetting to invert produces upside-down charts
- **Trigonometric functions for gauge rendering are expensive without an FPU** — Pre-compute a lookup table of sin/cos values for the number of angular positions you need rather than calling `sin()` and `cos()` in the draw loop

## In Practice

- A sparkline that appears to flatline despite changing data usually has a scaling range that's too wide — the variation is real but visually invisible at the current scale
- A gauge needle that jitters between adjacent positions suggests the input data has noise that needs filtering — apply a simple moving average or exponential filter before mapping to pixel positions
- Charts that draw correctly but take noticeably long to render are likely calling `drawPixel()` per data point — use `drawLine()` to connect adjacent points in a single call, or draw into a sprite and push once
