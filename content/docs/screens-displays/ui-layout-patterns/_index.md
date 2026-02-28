---
title: "UI Layout Patterns"
weight: 60
bookCollapseSection: true
---

# UI Layout Patterns

Designing usable interfaces with limited pixels and limited input. Building a UI for a 128x64 OLED or a 240x320 TFT is nothing like web or mobile design — every pixel counts, input is usually a button or rotary encoder, and there's no layout engine doing the work for you. But with careful information hierarchy, sensible navigation, and a few proven patterns, small screens can communicate a surprising amount of information clearly.

## What This Section Covers

- **[Layout Strategies for Small Screens]({{< relref "small-screen-layout" >}})** — Information hierarchy, status bar patterns, multi-page navigation, scrolling lists, and how layout approach shifts with display resolution from 128x32 through 320x480.
- **[Menus & Navigation Patterns]({{< relref "menus-and-navigation" >}})** — Rotary encoder + button navigation, hierarchical menus, selection indicators, input debouncing for UI, and the state machine approach to menu management.
- **[Data Visualization on MCUs]({{< relref "data-visualization" >}})** — Sparklines, bar charts, gauges, live-updating plots, and the integer math for scaling data values to pixel coordinates.
