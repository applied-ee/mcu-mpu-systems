---
title: "Power Distribution & Protection"
weight: 50
bookCollapseSection: true
---

# Power Distribution & Protection

A working power supply is only half the problem — the power path between supply and load must also survive reverse connections, voltage transients, inrush currents, and hot-plug events. A reversed battery connection without protection destroys the regulator and everything downstream in milliseconds. An ESD event on an exposed connector can punch through a sensitive IC. Plugging a charged capacitor bank into a live supply creates an inrush spike that trips upstream fuses or welds connector pins.

Protection circuits add minimal cost and board area but eliminate entire categories of field failures. This section covers the standard protection topologies — reverse polarity, overvoltage clamping, inrush limiting, and power-path switching — with specific IC recommendations and the design calculations that size each component correctly.

## What This Section Covers

- **[Reverse Polarity Protection]({{< relref "reverse-polarity-protection" >}})** — P-MOSFET and ideal-diode protection circuits, voltage drop considerations, and quiescent current impact.
- **[Overvoltage & TVS Diodes]({{< relref "overvoltage-and-tvs-diodes" >}})** — TVS selection for ESD and transient protection, clamping voltage calculations, and placement strategy.
- **[Inrush Limiting & eFuses]({{< relref "inrush-limiting-and-efuses" >}})** — Soft-start circuits, TPS2596/MAX14525 eFuse ICs, and managing capacitive inrush on hot-plug connections.
- **[Power Path & Load Switching]({{< relref "power-path-and-load-switching" >}})** — TPS22918 load switches, battery/USB switchover architecture, and controlled power domain management.
