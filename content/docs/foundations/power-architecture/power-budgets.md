---
title: "Estimating Power Budgets"
weight: 40
---

# Estimating Power Budgets

A power budget accounts for every source of current draw in a system, across all operating modes, and compares the total against what the supply can deliver and what the thermal design can dissipate. Skipping this step leads to regulators that overheat, batteries that die in hours instead of days, and intermittent brownouts that masquerade as firmware bugs. The budget should be a living document — started at schematic time and revised as bench measurements replace datasheet estimates.

## Measuring Current Draw

The simplest measurement technique is a low-value shunt resistor (10–100 milliohms) in series with the supply, measuring the voltage drop across it with a multimeter or oscilloscope. A 100 milliohm shunt carrying 50mA drops 5mV — measurable but easy to lose in noise without a differential probe. For more dynamic measurements, the INA219 is a popular I2C current/power monitor that samples at up to 2kHz, suitable for profiling mode transitions. The Nordic Power Profiler Kit II (PPK2) is the gold standard for embedded current measurement, capturing current from 200nA to 1A with microsecond resolution — essential for profiling sleep-mode transitions and wake-up spikes.

A typical PPK2 measurement workflow: connect the PPK2 in "source" mode (it powers the target) or "ampere meter" mode (inline with the existing supply). Set the supply voltage to match the target rail. The PPK2 software displays a real-time current waveform at up to 100kHz sampling. To profile a sleep-wake cycle, trigger a capture over several duty cycles and use the built-in average/peak statistics. Current spikes during wake-up — often 10–50mA lasting 1–5ms — become clearly visible, along with the baseline sleep current between them. For INA219-based monitoring, a microcontroller reads the shunt voltage register over I2C and logs it to serial or SD card; this approach integrates directly into the target system for field profiling but lacks the PPK2's bandwidth for sub-millisecond transients.

## Typical MCU Consumption

Current draw varies enormously by clock speed, active peripherals, and operating mode. Representative figures for common parts:

- **STM32F405 at 168MHz**, all peripherals idle: ~50–100mA (varies with flash wait states, ART accelerator, and voltage scaling)
- **STM32F405 in Stop mode**: ~10–30µA, depending on which wake-up sources remain active
- **STM32L476 at 80MHz** (low-power family): ~25mA active, ~1µA in Stop 2 mode
- **ESP32 with Wi-Fi active**: ~160–240mA during transmit bursts, ~20mA in modem sleep

Peripherals add their own draw: an SD card during a write burst can pull 100–200mA, a GPS module typically draws 25–40mA during acquisition, and an OLED display consumes 10–30mA depending on content.

## Worst-Case vs Typical Budgeting

A reliable power budget uses worst-case figures for thermal and regulator sizing, but typical figures for battery life estimation. Worst case means every peripheral active simultaneously, at maximum clock speed, at the highest operating temperature (where leakage current increases). Typical case reflects the actual duty cycle — an MCU that spends 95% of its time in Stop mode at 10µA and 5% active at 80mA averages about 4mA. The weighted average determines battery life; the worst-case peak determines regulator and trace current ratings.

## Thermal Calculations

The junction temperature of a regulator or MCU under load is: Tj = Ta + (Pdiss * Rth_ja), where Ta is ambient temperature and Rth_ja is the junction-to-ambient thermal resistance from the datasheet. An STM32F405 in a LQFP-64 package has Rth_ja of roughly 45°C/W. At 100mA from a 3.3V supply (330mW total power), the junction rises about 15°C above ambient — well within the 85°C or 105°C maximum. But a voltage regulator dissipating 1.5W in a SOT-223 package (Rth_ja ~60°C/W) raises its junction 90°C above ambient, which exceeds the maximum junction temperature (typically 125°C) even at a 40°C ambient.

## Sleep/Wake Duty Cycle Calculation

Most battery-powered systems spend the vast majority of time in a sleep mode, waking briefly to sample a sensor, transmit data, or check for input. The average current is the time-weighted sum of each mode: Iavg = (Isleep * Tsleep + Iactive * Tactive) / (Tsleep + Tactive). For a concrete example: an STM32L4 drawing 5µA in Stop 2 mode for 990ms, then waking to 20mA active mode for 10ms, yields Iavg = (0.005 * 990 + 20 * 10) / 1000 = (4.95 + 200) / 1000 = 0.205mA, or about 205µA average. Extending the active period to 50ms raises the average to 1.005mA — a fivefold increase from a 40ms change. This sensitivity makes duty cycle optimization the single most effective tool for extending battery life.

## Peripheral-by-Peripheral Budget

A structured power budget table lists every current-drawing component with its active current, sleep current, duty cycle, and resulting average contribution:

| Peripheral | Active (mA) | Sleep (mA) | Duty Cycle (%) | Avg (mA) |
|---|---|---|---|---|
| MCU core (STM32L4) | 20 | 0.005 | 1 | 0.205 |
| LoRa radio (SX1276 TX) | 120 | 0.001 | 0.1 | 0.120 |
| Temperature sensor (TMP117) | 0.135 | 0.001 | 0.5 | 0.002 |
| GPS module (MAX-M10S) | 25 | 0.010 | 5 | 1.260 |
| Status LED | 10 | 0 | 0.2 | 0.020 |
| **Total** | | | | **1.607** |

This format makes it immediately clear which peripheral dominates the budget. In this example, the GPS module accounts for 78% of the average draw despite only 5% duty cycle — reducing GPS acquisition time or duty cycle is the highest-leverage optimization.

## Battery Life Estimation

The fundamental formula is: Runtime (hours) = Battery capacity (mAh) / Average current (mA). A 1000mAh LiPo powering a system averaging 1.6mA gives a theoretical runtime of 625 hours (~26 days). In practice, derate by 10–20% to account for battery aging, self-discharge, and the regulator's dropout preventing full use of the cell's capacity. A system designed around the STM32L4 in Stop 2 mode with periodic 100ms wake-ups every 10 seconds averages roughly 50µA, giving a theoretical runtime of 20,000 hours (over 2 years) from a 1000mAh cell — real-world factors like self-discharge and temperature effects typically limit this to 12–18 months.

## Tips

- Start the power budget at schematic time using datasheet typical values, then replace each estimate with a bench measurement during bring-up — this catches discrepancies early
- Measure current during each operating mode independently (active, sleep, peripheral burst) and calculate the weighted average based on the actual duty cycle
- Add a 20% margin above the worst-case total when selecting regulator current ratings — component tolerances, temperature effects, and future firmware changes all push consumption upward
- Use the Nordic PPK2 or similar tool to capture the full current profile during sleep-wake transitions — the wake-up spike (often 10–50mA for a few milliseconds) is invisible to a multimeter but affects average consumption at high wake-up rates
- Document every entry in the power budget spreadsheet with its source (datasheet page, bench measurement, or estimate) so discrepancies can be traced during debugging

## Caveats

- **Datasheet typical values are measured at 25°C with minimal peripheral activity** — Real-world consumption at 85°C with DMA, ADC, and communication peripherals active can be 30–50% higher than the headline figure
- **Sleep mode current depends heavily on pin configuration** — An STM32 in Stop mode with floating GPIO pins or an enabled pull-up on every pin can draw 100µA or more, far above the 10µA specification
- **Battery capacity ratings are at controlled discharge rates** — A CR2032 is rated at 230mAh but only delivers that capacity at a 0.2mA drain; at 10mA, usable capacity drops below 100mAh due to internal resistance
- **Multimeter current measurements miss fast transients** — A multimeter averages over hundreds of milliseconds, completely hiding the 150mA wake-up spike that occurs for 2ms every second and contributes meaningfully to average consumption

## In Practice

- A battery-powered device that lasts the expected duration in lab testing but dies early in the field often has a peripheral that fails to enter sleep mode under certain conditions — profiling current over a full operating cycle with the PPK2 reveals the unexpected active period
- An MCU that resets when a radio module transmits commonly shows a power budget deficiency — the transmit burst pulls the supply below the brownout threshold because the regulator or battery cannot deliver the peak current
- A system that meets its power budget on the first prototype but exceeds it after a firmware update likely enabled a new peripheral or increased the wake-up rate — comparing current profiles between firmware versions isolates the change
- A board that runs significantly hotter than the thermal calculation predicts often has a current path not accounted for in the budget — leakage through a protection diode, an unintended pull-up, or a peripheral left in active mode
