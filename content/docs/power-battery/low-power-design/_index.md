---
title: "Low Power Design Patterns"
weight: 20
bookCollapseSection: true
---

# Low Power Design Patterns

The difference between a battery-powered device that lasts days and one that lasts months is rarely the battery — it is how aggressively the firmware manages power. A typical Cortex-M4 MCU draws 30–50mA at full speed but under 10µA in deep sleep. An ESP32 running Wi-Fi consumes 120–240mA but drops to 10µA in hibernation. Exploiting these ratios requires understanding the specific sleep modes each platform offers, how to wake from them quickly, which clocks and peripherals to gate, and how to profile the resulting current waveform to verify that the design actually achieves the target power budget.

Low power design is not a single technique — it is a discipline that touches clock configuration, peripheral lifecycle management, firmware state machines, and measurement methodology. This section covers the patterns that turn a continuously-running prototype into a deployment-ready battery device.

## What This Section Covers

- **[Sleep Modes & Wake Sources]({{< relref "sleep-modes-and-wake-sources" >}})** — STM32 Stop/Standby, ESP32 deep sleep, nRF52 System ON/OFF, and the wake sources that bring each platform back.
- **[Clock Gating & Peripheral Power]({{< relref "clock-gating-and-peripheral-power" >}})** — Selective clock disable, power domain control, and the startup latency tradeoffs of aggressive gating.
- **[Current Profiling Techniques]({{< relref "current-profiling-techniques" >}})** — Nordic PPK2, Otii Arc, shunt-and-scope methods, and correlating current waveforms to firmware states.
- **[Battery Life Estimation]({{< relref "battery-life-estimation" >}})** — Integrating current profiles over duty cycles, accounting for self-discharge, and predicting months of operation.
