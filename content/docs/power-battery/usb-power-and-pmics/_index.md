---
title: "USB Power Delivery & PMIC Integration"
weight: 60
bookCollapseSection: true
---

# USB Power Delivery & PMIC Integration

USB has evolved from a simple 5V/500mA bus power source into a negotiated power delivery system capable of supplying up to 240W. For battery-powered embedded systems, USB serves double duty: it charges the battery and powers the system simultaneously, requiring careful management of the power path between USB input, battery, and system load. Modern PMICs integrate the charger, buck/boost converters, LDOs, and power-path management into a single IC with I2C control, replacing what used to be five or six discrete components.

Understanding USB power — from the basic 500mA limit of USB 2.0 through BC1.2 detection to full USB PD negotiation — determines how much energy a device can draw from its host. PMIC integration determines how efficiently that energy reaches the battery and system rails. This section covers USB power fundamentals, PD sink negotiation, PMIC selection, and OTG source mode for devices that need to provide power to downstream peripherals.

## What This Section Covers

- **[USB Power Fundamentals]({{< relref "usb-power-fundamentals" >}})** — USB 2.0/3.0 current limits, BC1.2 detection protocols, and Type-C CC pin defaults.
- **[USB PD Negotiation]({{< relref "usb-pd-negotiation" >}})** — STUSB4500 autonomous sink, FUSB302 firmware-driven negotiation, and PD contract management.
- **[PMIC Selection & Integration]({{< relref "pmic-selection-and-integration" >}})** — AXP192, BQ25895, nPM1300 — charger + regulator + power-path ICs with I2C configuration.
- **[USB OTG & Source Mode]({{< relref "usb-otg-and-source-mode" >}})** — Providing 5V from battery, boost converter enable, and role-switching state machines.
