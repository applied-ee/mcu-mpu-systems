---
title: "Energy Harvesting"
weight: 70
bookCollapseSection: true
---

# Energy Harvesting

Energy harvesting captures ambient energy — solar, thermal, vibration, or RF — and converts it into usable electrical power for embedded systems. The available power is typically measured in microwatts to low milliwatts, orders of magnitude below what a continuously-running MCU consumes. Making harvesting viable requires ultra-low-power system design, efficient harvesting ICs with maximum power point tracking (MPPT), intermediate energy storage in supercapacitors or small rechargeable cells, and a duty-cycling strategy that matches energy consumption to the rate of energy collection.

A sensor node that wakes every 60 seconds, samples, transmits, and returns to sleep in 15ms might average 15µA — achievable from a 50mm × 50mm solar panel indoors. The engineering challenge is not the panel or the MCU but the power management chain between them: the harvesting IC, the storage element, the voltage conversion, and the firmware that knows when enough energy is available to perform useful work.

## What This Section Covers

- **[Solar Cell Integration]({{< relref "solar-cell-integration" >}})** — Small-panel characteristics, Voc/Isc/fill factor, series and parallel wiring, and matching panels to harvesting ICs.
- **[Harvesting ICs & MPPT]({{< relref "harvesting-ics-and-mppt" >}})** — BQ25570, AEM10941, SPV1050 — extracting maximum power from microwatt-level sources.
- **[Supercapacitor Buffering]({{< relref "supercapacitor-buffering" >}})** — Primary storage vs buffer roles, sizing for duty-cycled loads, leakage characteristics, and charge/discharge management.
- **[Ultra-Low-Power Harvesting Budgets]({{< relref "ultra-low-power-harvesting-budgets" >}})** — Matching harvested energy to duty-cycle requirements and analyzing conditions for indefinite operation.
