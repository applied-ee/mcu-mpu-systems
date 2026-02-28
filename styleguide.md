# Content Style Guide

This document defines the structure, terminology, and intent of pages in the MCU & MPU Systems notebook. Its purpose is consistency — not just in formatting, but in how readers develop **applied reasoning** when building embedded systems.

The goal is that after reading a handful of pages, a reader subconsciously knows:
- where to find practical guidance
- where to look for traps
- how firmware concepts connect to real hardware behavior

---

## Page Levels

The notebook is organized into three conceptual levels:

- **L0** — Major domains (e.g. *Foundations for Building Embedded Systems*)
- **L1** — Topic groupings within a domain (e.g. *Power Architecture*)
- **L2** — Individual concepts or techniques (e.g. *HD44780 & Compatible Controllers*)

Each level has a distinct purpose and writing style.

---

## L0 Pages (Domain Overviews)

**Purpose:**
Orient the reader. Explain *why this domain exists* and *when to come here*.

**Tone:**
High-level, conceptual, motivating.

**Characteristics:**
- No code snippets or register maps
- No step-by-step procedures
- Minimal examples
- Focus on scope and mental framing

**Typical Structure:**
- Short conceptual introduction
- Why this domain matters
- List of child L1 sections with brief descriptions

**Example:**
*Foundations for Building Embedded Systems* — What to understand before writing firmware.

---

## L1 Pages (Concept Groupings)

**Purpose:**
Define a family of ideas and establish the *non-negotiable constraints* that bind them.

**Tone:**
Authoritative but explanatory.

**Characteristics:**
- May include brief code or register references (sparingly)
- Explains what always holds versus what is commonly misapplied
- No step-by-step procedures
- Very limited numeric examples

**Typical Structure:**
- Conceptual framing
- What this section covers
- Curated list of L2 pages

**Example:**
*I²C* — A two-wire bus that trades speed for simplicity.

---

## L2 Pages (Core Learning Units)

**Purpose:**
Teach one concept deeply enough to apply it correctly on real hardware.

This is where theory meets firmware and bench behavior.

**Tone:**
Practical, grounded, experience-informed.

---

## Standard L2 Section Order

Not every L2 page must contain every section, but **when a section exists, its name and intent are fixed**.

---

### 1. Core Explanation
(Title varies: *How It Works*, *Pin Layout and Wiring*, *Protocol Basics*, etc.)

- Explains the concept itself
- May include code, register maps, or timing diagrams
- Minimal numeric examples
- Focus on correctness, not application

---

### 2. When It Applies / When It Doesn't
(Optional but common)

- Defines scope and limits
- Clarifies assumptions
- Separates ideal/datasheet behavior from real-world behavior
- Prefer **plain-language limits** ("narrow range of conditions", "specific situations") over jargon

---

### 3. Tips

**Purpose:**
Enable *correct use* of the concept.

**Tips answer:**
> "What should be done or checked to stay on the happy path?"

**What goes here:**
- Rules of thumb
- Safe defaults
- Sanity checks
- Bench techniques
- Numeric guidance that teaches *scale*

**Guidelines:**
- Actionable but not step-by-step
- Forward-looking
- May include specific values or ranges
- Assumes the concept is being applied correctly

**What does NOT go here:**
- Failure symptoms
- Root-cause analysis
- Interpretive diagnosis
- Explanations of why something went wrong

**Example:**
- "4-bit mode saves four GPIO pins and is what every library defaults to — there is rarely a reason to use 8-bit mode."

---

### 4. Caveats

**Purpose:**
Prevent mistakes and false confidence.

**Caveats answer:**
> "Where does this break, mislead, or quietly fail?"

**What goes here:**
- Common failure modes
- Measurement traps
- Assumption violations
- Situations where intuition breaks
- "This works… until it doesn't"

**Guidelines:**
- Warning-oriented
- Experience-based
- Numbers only if they explain the trap
- No happy-path examples

**What does NOT go here:**
- How failures appear at the bench
- Diagnostic interpretation
- What to do differently next time

**Example:**
- "Clone controllers may have slightly different timing requirements — working code on one module can garble text on another."

---

### 5. In Practice

**Purpose:**
Tie theory to **what is observed at the bench or in firmware behavior**.

In Practice answers:
> "How does this concept explain the measurements or symptoms appearing right now?"

**What goes here:**
- Observable symptoms (resets, garbled output, bus lockups, thermal behavior)
- Measurements that don't match expectations
- How correct theory explains confusing or misleading observations
- Interpretation that links multiple observations together

**Guidelines:**
- Interpretive, not procedural
- No new techniques (those belong in Tips)
- No new warnings (those belong in Caveats)
- May reference later topics only as explanatory anchors
- Organize by **observable behavior**, not by component or subsystem

**Preferred framing:**
- "often shows up as…"
- "commonly appears when…"
- "a frequent cause of this symptom is…"
- "this measurement usually indicates…"

**In Practice is not a summary — it is a bridge between concepts and observations.**

---

## Section Boundary Rule (L2 Pages)

Each L2 section has a single job:

- **Tips** — how to succeed
- **Caveats** — how things fail
- **In Practice** — how behavior and failures *appear in measurements or symptoms*. Add distinction between unrelated items and bold the main symptom.

If a paragraph contains:
- advice **and** diagnosis → split it
- warnings **and** interpretation → split it
- techniques **and** symptoms → move techniques to Tips

**If it explains *why something looks wrong*, it belongs in In Practice.**
**If it explains *how to avoid it*, it belongs in Tips or Caveats.**

---

## Narrative Voice

Use a neutral, tool-centric voice.

Avoid first-person and second-person phrasing (*I*, *we*, *you*, *your*).
The goal is to describe how hardware, firmware, and measurements behave — not to address or narrate from any individual perspective.

**Preferred framing:**
- "In practice…"
- "At the bench…"
- "This shows up as…"
- "A common sanity check is…"
- "When a measurement doesn't line up…"
- "The typical approach is…"
- "Most libraries handle this by…"

**Avoid:**
- "When you see…"
- "The first thing you reach for…"
- "If you do this…"
- "We can tell that…"
- "I've found that…"
- "You'll encounter…"

Also avoid:
- Long multi-symptom paragraphs — prefer one observable behavior per paragraph

This keeps the text readable without projecting habits, authority, or assumptions onto the reader.

---

## Consistent Terminology (Canonical)

Use these section names verbatim across all pages:

- **Tips**
- **Caveats**
- **In Practice**

Avoid:
- "Practical Considerations"
- "Why This Matters"
- "Practice Notes" (unless a special callout)

Consistency beats cleverness.

---

## Examples and Numbers

> **If an example uses realistic values and teaches scale, keep it.
> If it only restates the formula, generalize it.**

- Concrete numbers are encouraged at L2
- Especially valuable for:
  - Current draw and power budgets
  - Bus speeds and timing constraints
  - Memory sizes and buffer limits
  - Voltage levels and logic thresholds
- Avoid contrived algebra-only examples

This is an engineer's notebook, not a textbook.

---

## Tone Contract

Across all levels:

- Prefer clarity over elegance
- Prefer bench experience and working firmware over abstract theory
- Avoid jargon unless it is explicitly being taught
- Treat mismatches between expected and observed behavior as clues, not failures
- Assume the reader will test this on real hardware

If something doesn't work, the datasheet isn't wrong — the assumptions are.

---

## Final Principle

This notebook is not about memorizing APIs or register maps.

It's about building **applied reasoning**:
- knowing when a peripheral or pattern applies
- knowing when it doesn't
- understanding what real hardware behavior and firmware symptoms mean when things don't match expectations

That skill is what turns datasheets into working systems.
