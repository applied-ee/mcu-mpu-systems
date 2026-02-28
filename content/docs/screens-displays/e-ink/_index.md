---
title: "E-Ink"
weight: 40
bookCollapseSection: true
---

# E-Ink

Displays that look like paper and use power like paper. E-Ink (electrophoretic) displays hold their image with zero power, are readable in direct sunlight, and excel in applications where content changes infrequently — weather stations, price tags, room signs, low-power dashboards. The tradeoff is refresh speed: updating takes seconds, not milliseconds, and the full-refresh flash is a visual distraction.

Working with E-Ink requires a different mental model than LCD or OLED: it's not about rendering frames — it's about committing images. Understanding refresh modes, ghosting behavior, and the waveform tables that control particle movement is essential for getting good results.

## What This Section Covers

- **[How E-Ink Works]({{< relref "how-e-ink-works" >}})** — The electrophoretic principle: charged particles in microcapsules, bistability, why refresh is inherently slow, and what this means for embedded project design.
- **[Full vs. Partial Refresh]({{< relref "full-vs-partial-refresh" >}})** — The central tradeoff in E-Ink usage: full-refresh ghosting cleanup vs partial-refresh speed, LUT tables, fast mode, and practical refresh strategies.
- **[Common E-Ink Modules]({{< relref "common-modules" >}})** — Waveshare, Good Display, and DEPG series modules: SPI wiring, the critical BUSY pin, typical resolutions and color options, and the library ecosystem.
