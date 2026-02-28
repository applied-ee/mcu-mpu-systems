---
title: "Power Measurement & Instrumentation"
weight: 40
bookCollapseSection: true
---

# Power Measurement & Instrumentation

Estimating power consumption from datasheets and calculations is a starting point, but real embedded systems behave differently under real firmware. A peripheral left enabled after initialization, a pull-up resistor sinking current through an unused bus, or a radio that never fully enters sleep can each add milliamps that do not appear in any schematic review. Accurate power measurement — with the right tools and the right measurement architecture — is the only way to verify that a design meets its energy budget.

Current sensing methods range from a simple shunt resistor and oscilloscope to dedicated power analyzers that capture microamp sleep currents and hundred-milliamp transmit bursts in the same trace. In-circuit monitors like the INA219 and INA226 provide continuous measurement over I2C, enabling firmware-driven power logging without external instruments. This section covers the full instrumentation chain: sensing architectures, dedicated analyzer tools, and embedded current monitors.

## What This Section Covers

- **[Current Sensing Methods]({{< relref "current-sensing-methods" >}})** — Shunt resistors, sense resistor selection, and the basic measurement circuits behind every power measurement.
- **[High-Side vs Low-Side Sensing]({{< relref "high-side-vs-low-side-sensing" >}})** — Architectural tradeoffs and current-sense amplifier ICs (INA180, INA213) for each topology.
- **[Power Analyzer Tools]({{< relref "power-analyzer-tools" >}})** — Nordic PPK2, Otii Arc, Joulescope, and Keysight N6705C workflows for characterizing embedded power consumption.
- **[In-Circuit Current Monitoring]({{< relref "in-circuit-current-monitoring" >}})** — INA219/INA226 I2C configuration, register setup, alert thresholds, and firmware logging patterns.
