---
title: "First Boot Checklist"
weight: 10
---

# First Boot Checklist

The first power-on of a new board is the highest-risk moment in a project. Applying power without a methodical pre-check risks damaging components, masking assembly errors, and wasting hours debugging firmware when the real problem is hardware. A disciplined bring-up sequence — visual inspection, current-limited power, rail verification, and debug probe contact — catches most issues before they cascade. No firmware should run until the board is proven electrically sound.

## Pre-Power Visual Inspection

Before any power is applied, a thorough visual inspection under magnification (10x loupe or stereo microscope) catches the most common assembly defects. Solder bridges on QFP or QFN pins are the single most frequent cause of shorted rails. Check component orientation marks — tantalum capacitors and electrolytic caps are polarized, and a reversed part can fail violently at power-on. Verify that all required passives are populated, especially decoupling capacitors near the MCU power pins. Missing 100 nF caps on VDD pins may not prevent power-on but will cause erratic behavior under load. On a four-layer board, a missing 4.7 uF bulk cap on the 3.3 V rail can cause the regulator to oscillate.

## Current-Limited First Power

Always use a bench power supply with an adjustable current limit for the first power-on — never a USB port or battery. Set the current limit to 100 mA initially. A bare STM32F4 with no peripherals active typically draws 15-30 mA at boot with the internal RC oscillator running. If the supply immediately hits the current limit and the voltage sags, there is a short on the board — do not raise the limit. Check for reversed protection diodes, shorted decoupling caps, or solder bridges with a multimeter in continuity mode. Reverse polarity protection — a series Schottky diode or P-channel MOSFET on the input — prevents catastrophic damage if the supply leads are accidentally swapped.

The current profile during first power-on provides diagnostic information. A brief inrush spike (5-10 ms, up to 2-3x steady-state) is normal — bulk and decoupling capacitors charge through the regulator's output impedance. After the spike, current should settle to a stable value within a few hundred milliseconds. A steady-state draw that matches the MCU datasheet's "run mode" figure (typically 15-50 mA depending on clock speed) indicates normal operation. Abnormal profiles include: current that stays pegged at the limit (hard short), current that oscillates (regulator instability or MCU stuck in a boot loop), and near-zero draw after inrush (MCU held in reset or not powered on its core rail).

## Thermal Checks After Power-On

Immediately after the first power-on, a quick thermal survey identifies components drawing excessive current. A thermal imaging camera (FLIR or similar) is ideal — hotspots show up as bright spots within seconds of power application. Without a thermal camera, carefully touching components with a fingertip (after confirming no hazardous voltages are present) is a crude but effective alternative. Any component that is noticeably warm within the first 5-10 seconds of low-current operation warrants investigation. Voltage regulators are expected to be slightly warm under normal load, but passive components (resistors, capacitors) should remain at ambient temperature. A hot tantalum capacitor indicates reversed polarity or a short. A hot regulator with no downstream load suggests an output short or oscillation.

## ESD Precautions During Bring-Up

Bare PCBs without enclosures or conformal coating are highly susceptible to electrostatic discharge damage. A grounded ESD mat and wrist strap are essential during all bring-up handling — static discharge events of 2-4 kV are common in dry environments and can damage or degrade CMOS inputs without leaving any visible evidence. Avoid touching exposed pins, antenna traces, or analog input circuitry directly. When probing with multimeter leads or oscilloscope probes, connect the ground clip first before touching signal pins. ESD-damaged MCUs may appear to function normally during initial testing but exhibit increased leakage current, reduced noise margins, or intermittent failures that surface days or weeks later.

## Voltage Rail Verification

Before connecting the MCU or any active ICs, measure every power rail with a multimeter. Confirm 3.3 V (typical tolerance: 3.2-3.4 V), 1.8 V core supply if the MCU has a separate VDDA or VCORE pin, and any other rails (5 V for sensors, 12 V for motor drivers). On STM32 parts with an internal core regulator, the VCAP pins should show approximately 1.2 V once the MCU is powered. Check both the regulator output and the actual voltage at the MCU pin — a broken trace or cold solder joint can drop hundreds of millivolts between the two points.

A useful practice is to measure rails with the oscilloscope as well as the multimeter. An AC-coupled probe on the 3.3 V rail reveals ripple and noise that a multimeter averages out. Acceptable ripple on a linear regulator output is typically under 10 mV peak-to-peak; a switching regulator may show 20-50 mV depending on the output filter design. Ripple exceeding 100 mV indicates a missing output capacitor, wrong capacitor type (ceramic vs. electrolytic matters for ESR), or an oscillating regulator. On boards with both analog and digital 3.3 V rails, verify that the ferrite bead or filter between them is present — a missing filter allows digital switching noise to corrupt analog measurements.

## Debug Probe Connection Test

With the board powered and rails verified, connect a debug probe (ST-Link, J-Link, or CMSIS-DAP) via SWD. The first test is reading the MCU's IDCODE register — this requires no firmware and confirms that the debug port is functional, the MCU is alive, and the SWD clock and data lines are intact. On an STM32F405, the expected IDCODE is `0x2BA01477` (Cortex-M4). A failure to read IDCODE typically indicates no power to the MCU, a broken SWD trace, or a debug port that has been locked by readout protection from a previous programming attempt.

## Tips

- Label the bench supply leads and always double-check polarity before connecting — a single reversed-power event can destroy every IC on the board.
- Keep a log of the measured voltage on each rail and the total current draw at first power — this baseline makes future debugging dramatically easier.
- Use a thermal camera or touch-test (carefully) immediately after power-on to detect components that are getting hot, which indicates a short or reversed part.
- Measure current draw with the MCU in reset (NRST held low) as a separate data point — this isolates the passive power path from the MCU's own consumption.
- If the board has multiple power domains, bring them up one at a time by populating or enabling regulators sequentially.
- When using a thermal camera, capture a baseline image of the unpowered board first — this makes it easier to spot relative temperature changes after power is applied.
- Record the steady-state current draw at each stage of bring-up (unpowered resistance, in-reset current, running-from-HSI current) as a reference table for future board revisions.
- On boards with battery charging circuits, disconnect the battery during initial bring-up and power only from the bench supply — this prevents the charger IC from complicating the current profile.

## Caveats

- **Current limit set too high defeats the purpose** — Setting the bench supply limit to 1 A "just to be safe" allows a shorted rail to push enough current to desolder components or blow traces before the problem is noticed.
- **USB power hides current draw information** — A USB port supplies 5 V at up to 500 mA with no easy way to monitor instantaneous current, making it a poor choice for first-power diagnostics.
- **Multimeter accuracy matters at low voltages** — A 1.8 V core rail measured with a cheap multimeter at +/- 1% could read anywhere from 1.78 V to 1.82 V, which may mask an out-of-spec regulator.
- **Debug probe voltage mismatch can damage the target** — Connecting a 5 V-logic debug probe to a 3.3 V target without level shifting can overdrive the SWD pins and latch up the MCU.
- **A passing IDCODE read does not mean the board is fully functional** — It confirms the MCU core is alive and debug access works, but says nothing about peripheral clocks, external oscillators, or analog subsystems.
- **ESD damage is cumulative and invisible** — A component can sustain multiple sub-threshold ESD events that progressively degrade gate oxide, leading to failures that appear weeks after bring-up with no obvious cause.
- **Thermal cameras have emissivity limitations** — Shiny metal surfaces (exposed copper pads, component leads) radiate less infrared than dark plastic packages, so they may appear cooler than their actual temperature on a thermal image.

## In Practice

- A board that draws 300 mA immediately at power-on with no firmware running almost certainly has a solder bridge or reversed component — the expected draw for a bare MCU is 10-50 mA.
- A 3.3 V rail that measures 2.9 V under load usually indicates an undersized regulator, a missing input capacitor causing oscillation, or excessive current draw from a shorted downstream device.
- A debug probe that repeatedly fails to connect despite correct wiring often points to a missing or wrong-value pull-up on the NRST line, or a BOOT0 pin stuck in the wrong state.
- A board that powers on normally but gets warm within seconds has a component drawing continuous current — check for reversed diodes, shorted tantalum caps, or an MCU stuck in a boot loop with all peripherals active.
- An IDCODE read that returns `0x00000000` or `0xFFFFFFFF` typically means the SWD lines are not connected, the MCU has no power, or the debug port has been permanently locked.
- A current draw that oscillates between two values (e.g., 20 mA and 80 mA at a few Hz) often indicates the MCU is repeatedly resetting — the brownout detector may be tripping due to a marginal regulator output or excessive ripple on the supply rail.
- On a board with a switching regulator, an audible whine during first power-on (with low current limit) can indicate the regulator is entering a hiccup mode, cycling between startup and current-limit shutdown — this is normal behavior for some buck converters under a short-circuit condition.
