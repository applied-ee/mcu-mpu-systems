---
title: "How E-Ink Works"
weight: 10
---

# How E-Ink Works

E-Ink displays (more precisely, electrophoretic displays) are fundamentally different from LCDs and OLEDs. They don't emit light, they don't need constant refreshing, and they look like printed paper. Understanding the physics explains why they behave so differently from every other display technology you'll encounter in embedded work — especially the slow refresh rates that surprise everyone the first time.

## The Electrophoretic Principle

An E-Ink display consists of millions of tiny microcapsules, each about the diameter of a human hair. Each capsule contains positively charged white particles and negatively charged black particles suspended in a clear fluid. When an electric field is applied across a capsule, one color of particle migrates to the top (visible) surface and the other moves to the bottom. Reverse the field, and the particles swap positions. By controlling the field at each pixel, you create a pattern of black and white dots — an image.

Color E-Ink displays (the three-color models with red or yellow) use a similar principle but with a third type of particle, which is why they're even slower to refresh — three populations of particles need to be sorted instead of two.

## Bistability — The Killer Feature

The key property that makes E-Ink special is bistability: once the particles are positioned, they stay put with zero power. The display holds its image indefinitely with the controller completely powered down. This is why E-Ink is ideal for battery-powered projects that show information that changes infrequently — a weather station updating every 30 minutes, a price tag, a room sign. You pay the power cost only when updating, not while displaying.

This also means there's no "refresh rate" in the LCD/OLED sense. The display isn't being redrawn 60 times per second. It's drawn once and then just sits there, using no power, until you decide to change it.

## Why Refresh Is Slow

Moving physical particles through viscous fluid takes time — typically 1-3 seconds for a full refresh on common modules. The controller applies a carefully timed sequence of voltages (positive, negative, zero) in multiple phases to push all particles to their correct positions. This sequence is called a waveform, and it's stored in lookup tables (LUTs) specific to the display panel and even the ambient temperature (particle mobility changes with temperature).

The visible "flashing" during a full refresh — where the display goes black, then white, then to the target image — is intentional. It's the controller cycling the particles to ensure they're fully reset before being placed in their final positions. Skipping this step (partial refresh) is faster but risks leaving some particles in intermediate positions, causing ghosting artifacts.

## What This Means for Embedded Projects

E-Ink is not a general-purpose display replacement. It's a specialized technology that excels in a narrow but valuable niche: low-power, infrequently-updated, readable-in-sunlight applications. Trying to use E-Ink for anything resembling real-time updates or animation will lead to frustration. But for the right application, nothing else comes close — a coin cell can last years driving periodic updates to an E-Ink display, and the readability in bright light is unmatched.
