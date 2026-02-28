---
title: "Clocks & Timing"
weight: 30
bookCollapseSection: true
---

# Clocks & Timing

The clock system is the heartbeat of every microcontroller — it determines core execution speed, peripheral baud rates, ADC conversion timing, and power consumption. Most modern MCUs provide a flexible clock tree with multiple source options, PLLs for frequency multiplication, and prescalers that let different bus domains run at different speeds. Misconfiguring any part of this tree produces symptoms that range from subtle (UART baud rate slightly off, ADC readings noisier than expected) to catastrophic (processor won't boot, flash programming fails).

Understanding clock architecture is essential for getting peripherals to run at correct speeds, hitting precise timing requirements for communication protocols, and managing the power-performance tradeoff that dominates battery-powered design.

## What This Section Covers

- **[Oscillator Sources — Internal RC vs External Crystal]({{< relref "oscillator-sources" >}})** — The accuracy, stability, and startup tradeoffs between internal RC oscillators, external crystals, and MEMS oscillators, and when each is appropriate.
- **[Clock Trees & PLL Configuration]({{< relref "clock-trees-and-plls" >}})** — How clock multiplexers, PLLs, and prescalers route and transform the base oscillator into the system clock, bus clocks, and peripheral clocks.
- **[Clock Output & Measurement]({{< relref "clock-output-and-measurement" >}})** — Using MCO pins, frequency counters, and oscilloscopes to verify that the clock tree is configured correctly and stable.
- **[RTC & Low-Speed Clock Domains]({{< relref "rtc-and-low-speed-clocks" >}})** — The 32.768 kHz oscillator domain that drives real-time clocks, watchdog timers, and low-power wakeup sources independently of the main system clock.
