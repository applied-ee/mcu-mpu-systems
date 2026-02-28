---
title: "RTC & Low-Speed Clock Domains"
weight: 40
---

# RTC & Low-Speed Clock Domains

The low-speed clock domain operates independently of the main system clock, providing timekeeping and watchdog functionality that persists through sleep modes, resets, and even main power loss (with battery backup). The 32.768 kHz crystal frequency is not arbitrary — it equals 2^15, which divides down to exactly 1 Hz using a simple 15-stage binary counter. This domain is home to the RTC (Real-Time Clock), wakeup timers, and the independent watchdog.

## LSE vs LSI

The LSE (Low-Speed External) oscillator uses a 32.768 kHz crystal with typical accuracy of +/-20 ppm, which translates to about +/-0.6 seconds per day or roughly 10 seconds per month of drift. The LSI (Low-Speed Internal) RC oscillator runs at a nominal 32 kHz but with accuracy of only +/-5-15% depending on the part — this means up to 7 minutes of drift per day, making it unsuitable for calendar timekeeping.

The LSI exists for applications where approximate timing is acceptable and the cost or board space of a 32.768 kHz crystal cannot be justified. It serves as the clock source for the independent watchdog (IWDG) on STM32 parts, where a +/-10% timeout variation is tolerable. The LSE is required for any application that needs to maintain accurate wall-clock time.

## RTC Peripheral Basics

The RTC peripheral maintains a calendar (seconds, minutes, hours, day, date, month, year) with automatic leap year correction. It provides two programmable alarms (Alarm A and Alarm B on STM32F4) that can trigger interrupts or wake the MCU from deep sleep modes. A periodic wakeup timer generates interrupts at configurable intervals from 122 us to 36 hours, commonly used for low-power periodic sampling.

The RTC prescaler chain consists of an asynchronous prescaler (typically set to 128) and a synchronous prescaler (typically 256), giving 32768 / 128 / 256 = 1 Hz for the calendar counter. The asynchronous prescaler should be set as high as possible because it consumes less power than the synchronous stage.

## LSE Crystal Requirements

The 32.768 kHz crystal has stricter layout requirements than the HSE crystal because the oscillator circuit operates at much lower power to minimize battery drain. Crystal ESR (Equivalent Series Resistance) must be below the MCU's specified maximum — typically 50-70 kohm for STM32 parts. Crystals with ESR above this limit may fail to start or oscillate unreliably.

Load capacitors follow the same formula as HSE: CL = (CL1 * CL2) / (CL1 + CL2) + Cstray. Typical values are 6.8-15 pF per capacitor, depending on the crystal's specified load capacitance (usually 6-12.5 pF). PCB traces between the crystal and MCU pins must be as short as possible — under 10 mm — with a ground guard ring to shield against noise pickup. No signal traces should be routed underneath the crystal.

## Independent Watchdog (IWDG)

The IWDG is clocked from the LSI, making it independent of the main system clock and the LSE. If the main clock fails or firmware hangs, the IWDG still counts down and resets the MCU. The LSI's poor accuracy means the actual watchdog timeout varies — a 1-second configured timeout might fire anywhere from 850 ms to 1150 ms depending on temperature and part-to-part variation.

The window watchdog (WWDG), by contrast, is clocked from the APB1 bus clock and cannot detect main clock failures. Robust designs often enable both: the IWDG catches system-level hangs including clock failures, while the WWDG provides tighter timing checks on application-level responsiveness.

## Battery Backup Domain (VBAT)

The VBAT pin powers the RTC, LSE oscillator, and backup registers when the main VDD supply is removed. A typical CR2032 coin cell (225 mAh) can maintain the RTC for 2-5 years, as the LSE oscillator and RTC together draw roughly 1-2 uA. The backup domain is protected by a power switch that automatically selects between VDD and VBAT — when VDD is present, the backup domain runs from VDD; when VDD drops below the threshold, it switches to VBAT with no data loss.

Backup registers (typically 20x 32-bit registers on STM32F4) retain data through resets and power cycles as long as VBAT is maintained. These are commonly used to store flags that distinguish between cold boot and warm reset, or to preserve small amounts of application state.

## Tips

- Always use the LSE for RTC timekeeping — the LSI's +/-5-15% accuracy makes it useless for anything requiring calendar-grade precision
- Set the RTC asynchronous prescaler to 128 (the maximum) to minimize power consumption in the backup domain
- Verify LSE startup by checking the LSERDY flag with a timeout — a crystal that fails to start should be handled gracefully, not waited on indefinitely
- Use backup registers to store a magic value on first boot; checking this value after reset distinguishes a clean power-up from a watchdog reset or brown-out recovery
- When selecting a 32.768 kHz crystal, check its ESR against the MCU datasheet's maximum — exceeding this limit is the most common cause of LSE startup failure

## Caveats

- **LSE crystals are extremely sensitive to PCB layout** — Trace lengths over 10 mm, missing ground guards, or nearby switching signals can prevent the low-power oscillator from starting. Layout rules are stricter than for the HSE because the oscillator drive current is orders of magnitude lower
- **LSI frequency varies significantly across parts and temperature** — The 32 kHz nominal can range from 17 to 47 kHz on some STM32 families. The IWDG timeout scales proportionally, making it unsuitable for precise timing requirements
- **VBAT must not be left floating** — If no backup battery is used, VBAT must be connected to VDD. A floating VBAT pin causes undefined behavior in the backup domain and can increase power consumption
- **RTC calendar registers require unlocking before write** — Writing to RTC registers without first disabling write protection (via the RTC_WPR key sequence) silently fails. The protection re-enables automatically, so every write sequence must repeat the unlock
- **Backup domain reset clears everything** — A backup domain reset (triggered by the BDRST bit or certain fault conditions) erases all backup registers and RTC configuration, even if VBAT is present. This is distinct from a normal system reset

## In Practice

- An RTC that loses several minutes per day is almost certainly clocked from the LSI instead of the LSE — the LSI's frequency error accumulates rapidly and is the most common misconfiguration in RTC setups
- An LSE crystal that starts on the bench but fails in production often has a marginal ESR combined with PCB manufacturing variation — slightly longer traces or different solder paste volume shifts the effective load capacitance enough to prevent oscillation
- A watchdog that resets the system earlier or later than expected indicates reliance on the LSI's nominal 32 kHz without accounting for its +/-15% tolerance — the configured timeout must include margin for the worst-case LSI frequency
- A board that keeps time through power cycles but loses the RTC after being unpowered for weeks has a depleted or missing VBAT battery — measuring the coin cell voltage directly confirms whether it has dropped below the minimum operating threshold (typically 1.65V)
