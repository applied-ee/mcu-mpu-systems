---
title: "Power Sequencing & Reset Circuits"
weight: 30
---

# Power Sequencing & Reset Circuits

When a board has multiple voltage rails — a common scenario with modern MCUs that require separate core, I/O, and analog supplies — the order and timing of those rails coming up determines whether the system starts cleanly or enters an undefined state. Incorrect sequencing can cause latch-up (a potentially destructive parasitic SCR condition), excessive current draw during startup, or peripheral buses that lock up before firmware even begins executing.

## Why Sequencing Matters

Most MCUs specify that the core supply (typically 1.2V or 1.8V on parts with internal regulators) must be stable before or simultaneously with the I/O supply (3.3V). If the I/O pins are powered before the core, internal ESD protection diodes can forward-bias and inject current into unpowered logic, triggering latch-up. The STM32F4 datasheet requires that VDD be applied before or at the same time as VDDA, and both must be present before any signal pin sees a logic-high level. Violating this constraint is a common cause of damage during board bring-up when test equipment drives signals before all rails are live.

## Reset Supervisors

A reset supervisor monitors the supply voltage and holds the MCU's reset line asserted until the supply is stable and above a defined threshold. The TPS3839 is a popular nanowatt supervisor (150nA quiescent) that holds NRST low until VDD crosses its threshold (available in fixed voltages like 2.93V for 3.3V systems). The APX809 is another common choice, offering a clean active-low reset output with a typical threshold accuracy of 2.5%.

The STM32 NRST pin has an internal pull-up and a built-in power-on reset (POR) circuit, but the internal POR threshold can vary across manufacturing lots. An external supervisor with a tighter threshold tolerance eliminates this variability — a worthwhile addition on any production board.

## Brownout Detection

Brownout occurs when the supply voltage dips below the MCU's minimum operating voltage momentarily, often due to a load transient or a weak battery. The STM32 family includes an internal brownout detector (BOR) configurable through option bytes at levels from 2.1V to 2.9V. When VDD falls below the BOR threshold, the MCU holds itself in reset until the supply recovers. External brownout supervisors like the TPS3839 or MAX809 offer tighter threshold accuracy and faster response than the internal BOR on many MCU families.

## Power-Good Signals and Sequencing ICs

Switching regulators often provide a power-good (PG) output that goes high when the output voltage is within regulation. Chaining the PG output of one regulator to the enable (EN) pin of the next creates a simple sequencing scheme: the 1.8V core rail must be stable before the 3.3V I/O regulator is allowed to start. For boards with three or more rails, dedicated sequencing ICs (like the TPS382x family) manage startup order, timing delays, and fault detection in a single part.

## RC Reset Circuits vs Dedicated Supervisors

The classic RC reset circuit — a resistor and capacitor on the NRST pin that creates a time delay after power-on — is still found on simple designs. The delay is roughly 0.7 * R * C; a 100kOhm resistor and 100nF capacitor gives about 7ms of reset hold time. However, an RC circuit does not monitor voltage — it starts its delay from the moment current flows, regardless of whether VDD has actually reached a safe level. A dedicated supervisor actively watches the supply voltage and releases reset only when VDD is genuinely stable, handling both slow-rising supplies and brownout events that an RC circuit ignores entirely.

## Tips

- Use an external reset supervisor on any production board — the cost is under $0.10 in volume and it eliminates startup failures caused by slow-rising or noisy power supplies
- Connect the supervisor's reset output to the MCU NRST pin through an open-drain configuration to allow multiple reset sources (supervisor, debug probe, pushbutton)
- Set the BOR level to match the minimum operating voltage of the slowest peripheral on the bus, not just the MCU's minimum VDD
- Place a 100nF filter capacitor on the NRST pin to reject noise glitches that could cause spurious resets, per the STM32 hardware design guide
- When chaining regulator enable pins for sequencing, verify that each rail reaches regulation before the next is enabled — check startup waveforms with an oscilloscope during bring-up

## Caveats

- **An RC reset circuit cannot protect against brownout** — It provides a one-time delay at startup but does nothing if VDD dips below minimum during operation, leaving the MCU to execute from corrupted SRAM or flash-read states
- **Applying signals to I/O pins before VDD is stable risks latch-up** — External devices that power up faster than the MCU can inject current through ESD diodes into unpowered core logic, potentially causing permanent damage
- **The internal POR threshold varies across manufacturing lots** — Relying solely on the STM32's built-in power-on reset means some boards in a production run may start reliably while others do not, depending on where each part falls within the threshold tolerance
- **Sequencing violations may not cause immediate failure** — Latch-up can manifest as excessive current draw that slowly overheats the die, or as rare random resets that only appear under specific supply conditions

## In Practice

- A board that boots reliably on a bench supply but randomly fails to start in the field often has a slow-rising supply (such as a loaded USB port) that the internal POR does not detect properly — an external supervisor with a defined threshold eliminates the inconsistency
- An MCU that draws abnormally high current immediately after power-on, with the die getting hot, is likely in latch-up caused by a sequencing violation — removing power completely and correcting the startup order is the only recovery
- Intermittent resets that correlate with motor activation or relay switching on the same board commonly trace back to brownout — the supply dips below the operating threshold for a few milliseconds during the load transient
- A system that works with a debug probe attached but fails standalone often depends on the probe holding NRST low during its own power-up sequencing — the production board lacks this external reset hold, exposing the sequencing gap
