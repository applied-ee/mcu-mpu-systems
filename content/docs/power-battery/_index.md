---
title: "🔋 Power & Battery Patterns"
weight: 6
bookCollapseSection: true
---

# Power & Battery Patterns

Battery-powered embedded systems introduce constraints that wall-powered designs never face. A circuit that runs indefinitely from a USB cable must suddenly account for cell chemistry limits, discharge curves, protection thresholds, and energy budgets measured in milliamp-hours. The power subsystem becomes an active part of the firmware — managing charge state, switching between power sources, negotiating USB PD contracts, and putting entire domains to sleep to extend runtime from hours to months.

This section covers the full lifecycle of embedded power: selecting and integrating battery cells, designing efficient conversion topologies, measuring and profiling current draw, protecting against fault conditions, interfacing with USB Power Delivery, and harvesting ambient energy for indefinite operation. The Foundations section covers regulator basics, decoupling, sequencing, and budgets — the material here builds on those fundamentals with battery-specific integration patterns and deeper instrumentation techniques.

## Sections

- **[Li-Ion Battery Integration]({{< relref "li-ion-integration" >}})** — Cell selection, charging IC configuration, protection circuits, and fuel gauging firmware for single-cell lithium-ion systems.
- **[Low Power Design Patterns]({{< relref "low-power-design" >}})** — Sleep modes, clock gating, current profiling, and battery life estimation techniques that turn milliamp budgets into months of runtime.
- **[Power Supply Design for Battery Systems]({{< relref "power-supply-design" >}})** — Buck, boost, and buck-boost converter selection and layout for battery-to-rail conversion, plus charge pumps and multi-rail sequencing.
- **[Power Measurement & Instrumentation]({{< relref "power-measurement" >}})** — Current sensing architectures, dedicated power analyzers, and in-circuit I2C monitors for quantifying energy consumption.
- **[Power Distribution & Protection]({{< relref "power-protection" >}})** — Reverse polarity protection, TVS diodes, inrush limiting, and load switching for robust power path design.
- **[USB Power Delivery & PMIC Integration]({{< relref "usb-power-and-pmics" >}})** — USB current limits, PD negotiation, multi-function PMICs, and OTG source mode from battery systems.
- **[Energy Harvesting]({{< relref "energy-harvesting" >}})** — Solar cell integration, harvesting ICs with MPPT, supercapacitor buffering, and ultra-low-power budgets for indefinite operation.
