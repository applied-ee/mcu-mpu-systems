# MCU & MPU Systems — Project Conventions

## Purpose

This is a structured notebook on microcontroller and microprocessor systems — architecture, peripherals, firmware, and hands-on development. The tone is exploratory and practical: recording concepts, experiments, procedures, patterns, and gotchas encountered while working with MCUs and MPUs.

## Repository Structure

- **Hugo static site** using the [hugo-book](https://github.com/alex-shpak/hugo-book) theme
- Content lives in `content/docs/` organized into sections (TBD as content is added)
- Built with `make html` (runs `hugo --minify`)
- Local dev server with `make server`

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
- **Exploratory tone**: Write as someone learning, not lecturing; include uncertainty, questions, and corrections
- **Practical focus**: Prefer bench experience, real measurements, and working circuits over pure theory
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
