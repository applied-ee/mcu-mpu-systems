---
title: "Regulators — LDO vs Switching"
weight: 10
---

# Regulators — LDO vs Switching

Every embedded system needs at least one voltage regulator to convert a supply rail into the clean, stable voltage the MCU and its peripherals require. The two fundamental topologies — linear (LDO) and switching — differ in efficiency, noise, size, and cost. Choosing the wrong one wastes power, introduces noise into sensitive circuits, or generates more heat than the board can dissipate.

## LDO Fundamentals

A low-dropout regulator (LDO) works by burning excess voltage as heat. The power dissipated is straightforward: P = (Vin - Vout) * Iload. Converting 5V to 3.3V at 200mA dissipates (5 - 3.3) * 0.2 = 340mW — manageable in a SOT-223 package. Converting 12V to 3.3V at the same current dissipates 1.74W, which exceeds most small-package thermal limits without a copper pour or heatsink.

The "dropout voltage" is the minimum Vin - Vout the regulator can sustain while keeping output in regulation. The AMS1117-3.3, a ubiquitous cheap LDO, has a 1.0V dropout — it needs at least 4.3V in to produce a stable 3.3V. The AP2112-3.3 drops out at just 250mV and draws only 55µA quiescent current, making it far better suited for battery-powered designs where every milliamp matters.

## Switching Regulator Basics

Switching regulators use an inductor and high-frequency switching (typically 500kHz–2MHz) to convert voltages with 85–95% efficiency. A buck converter steps voltage down; a boost converter steps it up; a buck-boost handles both directions. The MP2359 is a compact buck converter that converts 12V to 3.3V at up to 1.2A with roughly 90% efficiency — dissipating only ~440mW versus the 10.4W an LDO would waste at the same operating point.

The TPS63001 is a buck-boost converter commonly used with single-cell LiPo batteries. It maintains a 3.3V output whether the battery is at 4.2V (freshly charged) or 2.5V (near cutoff), seamlessly transitioning between buck and boost modes as the cell discharges.

## Noise Characteristics

LDOs produce inherently clean output — their output noise is typically 10–50µV RMS, making them ideal for powering ADCs, audio codecs, and RF front-ends. Switching regulators generate ripple at their switching frequency, typically 10–50mV peak-to-peak before filtering. In mixed-signal designs, a common architecture uses a switching regulator for bulk power conversion, followed by an LDO on the analog supply rail to reject switching noise.

## When to Use Which

For low current draw (under ~300mA) with a small Vin-Vout differential, an LDO is simpler, cheaper, and quieter. For higher currents, large input-output differentials, or battery-powered systems where efficiency directly determines runtime, a switching regulator is the right choice. Many production boards use both — a buck converter for the main 3.3V rail and an LDO for noise-sensitive analog power.

## Tips

- Calculate LDO power dissipation before committing to a package — (Vin - Vout) * Imax gives worst-case thermal load, and exceeding the package rating causes thermal shutdown or reduced lifespan
- For battery-powered designs, select LDOs with quiescent current under 100µA — parts like the AP2112 (55µA) or MCP1700 (1.6µA) extend standby battery life significantly
- Place the switching regulator's inductor and input capacitor as close to the IC as possible — long traces add parasitic inductance that degrades efficiency and increases EMI
- Use the regulator's datasheet-recommended capacitor values and types — ceramic X5R or X7R for switching regulators, as Y5V capacitors lose too much capacitance at DC bias
- When in doubt about noise sensitivity, add a ferrite bead and 10µF capacitor between a switching regulator output and an analog supply pin

## Caveats

- **LDO thermal limits sneak up on higher input voltages** — A regulator that runs cool at 5V-to-3.3V may overheat at 9V-to-3.3V with the same load, because power dissipation scales linearly with the voltage differential
- **Switching regulator efficiency curves are not flat** — Datasheets show peak efficiency at a specific load point; at very light loads (under 1mA), many switching regulators drop to 50–60% efficiency, worse than an LDO
- **The AMS1117 is not actually low-dropout** — Despite appearing on countless breakout boards, its 1.0V dropout makes it a poor choice for 3.3V output from a 3.7V LiPo cell that sags to 3.5V under load
- **Switching regulators require careful PCB layout** — A poorly routed buck converter can emit enough electromagnetic interference to corrupt nearby SPI or I2C signals, even if the schematic is correct

## In Practice

- A board that works on USB power but resets intermittently on a 3.7V LiPo often has an LDO with too much dropout — as the battery voltage sags under load, the regulator falls out of regulation and the MCU browns out
- An ADC reading that shows periodic noise at a fixed frequency (e.g., 500kHz ripple) commonly traces back to a switching regulator on the same board — adding an LC filter or replacing the analog supply with an LDO resolves it
- A regulator that runs warm under light load but becomes too hot to touch at full system current is dissipating more than the package can handle — switching to a buck converter or adding thermal relief copper is the corrective step
- A circuit that draws 200mA continuously from a CR2032 coin cell through an LDO and dies in hours instead of days is dominated by the LDO's operating current plus the wasted heat — a micropower buck converter dramatically extends runtime
