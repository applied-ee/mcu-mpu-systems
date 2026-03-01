# MCU & MPU Systems — Project Conventions

## Purpose

This is a structured notebook on microcontroller and microprocessor systems — architecture, peripherals, firmware, and hands-on development. The tone is exploratory and practical: recording concepts, experiments, procedures, patterns, and gotchas encountered while working with MCUs and MPUs.

## Repository Structure

- **Hugo static site** using the [hugo-book](https://github.com/alex-shpak/hugo-book) theme
- Content lives in `content/docs/` organized into twelve L0 sections
- Built with `make html` (runs `hugo --minify`)
- Local dev server with `make server`

## Section Structure

Content uses a 3-level hierarchy: L0 (top sections) → L1 (subsections) → L2 (pages).

| Weight | Directory | Title |
|--------|-----------|-------|
| 1 | `foundations/` | Foundations for Building Embedded Systems |
| 2 | `digital-interfaces/` | Digital Interfaces & Peripheral Patterns |
| 3 | `led-systems/` | LED Systems |
| 4 | `sensor-integration/` | Sensor Integration Patterns |
| 5 | `screens-displays/` | Screens & Displays |
| 6 | `power-battery/` | Real-World Power + Battery Projects |
| 7 | `networking/` | Networking & Connectivity |
| 8 | `linux-embedded/` | Linux-Based Embedded Systems |
| 9 | `audio-projects/` | Audio Projects |
| 9 | `motor-control/` | Motor Control |
| 10 | `edge-ai/` | Edge AI |
| 99 | `glossary/` | Glossary |

L0 and L1 directories use `bookCollapseSection: true` in their `_index.md` so they appear as collapsible items in the sidebar. L2 entries are leaf pages (`.md` files) inside L1 directories.

## Adding a New Entry

Create a markdown file inside the appropriate section directory under `content/docs/`:

```
content/docs/<section>/<entry>.md
```

Frontmatter pattern:

```yaml
---
title: "Entry Title"
weight: 10
---
```

- **title**: Descriptive name for the entry
- **weight**: Controls ordering within the section; use increments of 10 to leave room for future entries

## Content Conventions

- **Evergreen entries**: Entries get revised and expanded over time; they are not dated posts
- **No chronological structure**: No dates in filenames or frontmatter unless documenting a specific experiment with a date-sensitive result
- **Neutral voice**: No first-person (*I*, *we*) or second-person (*you*, *your*). Use tool-centric, observation-oriented phrasing. See `styleguide.md` for full voice rules and preferred framing.
- **Practical focus**: Prefer bench experience, real measurements, and working firmware over pure theory
- **Standard L2 sections**: Tips, Caveats, In Practice — names and intent are fixed (see `styleguide.md`)
- **Entry types**: Concepts, procedures, experiments, patterns, gotchas — no formal taxonomy required, just pick what fits

## Glossary & Tooltip System

An automatic glossary tooltip system links terms on every page (except the glossary itself) to their definitions.

**Key files:**
- `data/glossary.json` — single source of truth (term, definition, anchor, aliases)
- `static/js/glossary.js` — client-side auto-linking (first occurrence per term per page)
- `layouts/partials/docs/inject/body.html` — injects glossary data + JS

## Build & Verify

```sh
make html      # Build the site (hugo --minify)
make server    # Local dev server with live reload
make clean     # Remove build artifacts
```
