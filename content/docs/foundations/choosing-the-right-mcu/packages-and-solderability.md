---
title: "Packages & Solderability"
weight: 40
---

# Packages & Solderability

The package a microcontroller comes in determines how the board is assembled, how prototyping works, and whether rework is feasible. A design that requires BGA reflow is not getting hand-assembled in a home lab. Conversely, choosing a DIP package for production adds unnecessary board area and limits MCU selection to a shrinking set of legacy parts. Package choice is a design constraint that affects the entire project lifecycle from first prototype to volume manufacturing.

## DIP — Through-Hole Prototyping

Dual In-line Package (DIP) parts plug directly into breadboards and through-hole PCBs with 2.54 mm (0.1") pin spacing. The ATmega328P-PU (28-pin DIP) and PIC16F877A (40-pin DIP) are common examples. DIP packages are large — a 28-pin DIP occupies roughly 35 x 7 mm — and are limited to low pin counts. Almost no modern 32-bit MCU is available in DIP. For prototyping with modern parts, breakout boards (Adafruit, SparkFun, dev modules) bridge the gap between surface-mount MCUs and breadboard workflows.

## QFP — The Hand-Solder Standard

Quad Flat Package (QFP) variants — LQFP, TQFP — expose leads on all four sides at pitches from 0.8 mm down to 0.4 mm. LQFP-48 at 0.5 mm pitch (e.g., STM32F103C8T6) is reliably hand-solderable with a fine-tip iron, flux, and solder wick. LQFP-144 at 0.5 mm pitch (e.g., STM32F429ZIT6) is still manageable with drag soldering. Inspection is straightforward — solder bridges and lifted pins are visible under a standard 10x loupe. QFP remains the best choice for prototypes and low-volume production where hand assembly or rework is expected.

## QFN — Compact but Challenging

Quad Flat No-lead (QFN) packages — also called DFN or MLF — have pads on the bottom edges and typically an exposed thermal pad underneath. A QFN-48 at 0.5 mm pitch (e.g., nRF52840-QIAA) is roughly 6 x 6 mm, significantly smaller than the equivalent LQFP. Hand soldering is possible with a hot-air station, flux, and careful technique, but the hidden pad underneath requires either a reflow oven or hot-plate soldering to make reliable thermal contact. Inspection is difficult — shorts under the package are invisible without X-ray. The exposed pad often serves as the primary ground and thermal path; leaving it unsoldered causes ground bounce and thermal issues.

## BGA and WLCSP — Reflow Only

Ball Grid Array (BGA) packages (e.g., STM32H7 in TFBGA-240, 0.8 mm pitch) and Wafer-Level Chip-Scale Packages (WLCSP, 0.4 mm pitch) are the smallest options but require reflow soldering and X-ray inspection for quality assurance. A WLCSP part may be only 2 x 2 mm for a complete MCU, enabling extremely compact designs. These packages are appropriate for volume production with proper equipment and are effectively off-limits for hand prototyping. Board layout is more constrained — BGA fanout requires multiple PCB layers (typically 4+), and via-in-pad design is standard.

## Thermal Considerations

The package's thermal resistance (theta-JA) determines how effectively the MCU dissipates heat. An LQFP-64 might have theta-JA of 40-50 C/W, while a QFN-48 with a properly soldered exposed pad achieves 20-25 C/W. For MCUs running at high clock speeds (STM32H7 at 480 MHz can dissipate 500+ mW), thermal performance directly affects maximum sustained clock speed. An unsoldered QFN thermal pad can raise junction temperature by 20-40 C under load, potentially triggering thermal shutdown or reducing device lifetime.

## Tips

- Default to LQFP for first prototypes of new designs — the ability to visually inspect every joint and rework individual pins saves significant debug time.
- Invest in a hot-air rework station ($80-150 range) before attempting QFN — it converts QFN from "nearly impossible" to "routine" for hand assembly.
- Always apply solder paste to the exposed pad on QFN packages, even for hand-soldered prototypes — use a syringe of solder paste and a hot plate or hot air from below.
- Order stencils for any build with more than 5 boards — laser-cut stainless stencils cost $10-25 from PCB vendors and dramatically improve QFN and fine-pitch QFP yield.
- Verify that the chosen package has a dev board or breakout board available before committing — soldering a BGA to evaluate an MCU is not a productive use of evaluation time.

## Caveats

- **QFN exposed pads are not optional** — Omitting solder on the thermal pad may work at room temperature on the bench but causes thermal failure, ground bounce, or both under real operating conditions.
- **Fine-pitch QFP below 0.4 mm is a different skill level** — 0.5 mm pitch is forgiving; 0.4 mm pitch requires magnification, thinner solder wick, and significantly more patience. The error rate roughly doubles.
- **BGA rework requires the right equipment** — Removing and replacing a BGA MCU needs a dedicated rework station with bottom heating and profiled top heating. A standard hot-air gun risks damaging adjacent components.
- **WLCSP has no leads to inspect** — There is literally nothing visible to confirm solder quality without X-ray or electrical testing. Functional testing becomes the only verification path for prototypes.
- **Package availability varies by MCU variant** — The same MCU die may be offered in LQFP-100, QFN-68, and BGA-144, but each package exposes different GPIO counts and peripheral access. The datasheet pin table must be checked per package.

## In Practice

- An MCU that resets randomly under load on a QFN board but works perfectly on a dev board with the same firmware almost certainly has a poorly soldered or unconnected exposed thermal pad.
- Solder bridges on fine-pitch QFP (visible under magnification as shiny connections between adjacent pins) are the most common hand-assembly defect and are easily corrected with flux and solder wick.
- A prototype run where 3 out of 10 QFN boards fail to program likely has pad alignment issues — checking the stencil aperture sizing and paste deposition with a loupe before reflow catches most of these.
- A compact production design that uses BGA to save board space but then requires 3 board revisions due to assembly defects often would have reached market faster with a larger QFP layout and fewer fabrication issues.
- An MCU running 10-15 C hotter than expected in a QFN package despite adequate airflow is usually missing thermal vias under the exposed pad — adding a grid of 0.3 mm vias to an internal ground plane can drop junction temperature by 10-20 C.
