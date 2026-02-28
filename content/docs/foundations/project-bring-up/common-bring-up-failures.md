---
title: "Common Bring-Up Failures & Recovery"
weight: 40
---

# Common Bring-Up Failures & Recovery

Every board bring-up encounters failures. The difference between a frustrating multi-day debug session and a quick recovery is recognizing common failure patterns and knowing the standard recovery procedure for each. Most bring-up failures fall into a small number of categories: power shorts, boot configuration errors, debug access problems, clock issues, and passive component mistakes. Learning to classify the symptom quickly — before reaching for the oscilloscope — saves significant time.

## Shorted Power Rails and Regulator Failures

A power rail short is the most immediately visible bring-up failure. The bench supply hits its current limit instantly, the voltage sags to near zero, and the regulator may get hot within seconds. Common causes include solder bridges between adjacent power and ground pads on QFN packages, reversed tantalum capacitors (which fail as a short circuit), and copper debris from PCB fabrication bridging a via to an adjacent trace. Diagnosis starts with the multimeter in continuity mode — measure resistance between each power rail and ground with the board unpowered. A healthy 3.3 V rail typically shows 10 kOhm or more to ground; a reading under 10 Ohm indicates a hard short. Isolating the fault may require removing components one at a time, starting with the bulk capacitors and then the regulator itself.

## Wrong Boot Mode and Locked Debug Ports

On STM32 devices, the BOOT0 pin determines whether the MCU boots from flash (BOOT0 = 0) or the internal bootloader (BOOT0 = 1). A floating or incorrectly pulled BOOT0 pin can redirect execution to the system bootloader, where the MCU appears alive but runs no user firmware. The fix is a 10 kOhm pull-down resistor on BOOT0. A more serious failure is a locked debug port — if readout protection (RDP) level 1 was previously enabled, the SWD port becomes inaccessible until a mass erase is performed. On a J-Link, the `J-Link Commander` tool with the `unlock` command forces a mass erase and restores debug access, but all flash contents are lost. RDP level 2 on STM32 is permanent and irreversible — the debug port is disabled for the life of the chip.

## Clock and Oscillator Failures

A failed external crystal is one of the most common silent failures. The MCU falls back to its internal RC oscillator (HSI, typically 16 MHz on STM32F4, with +/- 1% accuracy), and firmware that expects a PLL-multiplied clock from an 8 MHz HSE crystal runs at the wrong speed. Symptoms include UART baud rate errors (garbled output), USB that refuses to enumerate (USB requires +/- 0.25% clock accuracy, which HSI cannot guarantee), and PWM frequencies that are off by a non-obvious ratio. Diagnosis involves measuring the crystal pins with an oscilloscope — a working crystal shows a clean sinusoidal waveform at the expected frequency, while a failed one shows no oscillation or a DC level. Common causes of crystal failure include excessive stray capacitance from long PCB traces, wrong load capacitor values (crystal-specific, typically 10-20 pF), or a crystal that was damaged by reflow soldering temperatures.

## Passive Component and Assembly Errors

Missing or wrong-value passive components cause subtle failures that are difficult to diagnose without careful inspection. Missing I2C pull-up resistors (4.7 kOhm) cause bus communication to fail intermittently — SDA and SCL float high but cannot be driven to a clean logic low. Wrong decoupling capacitor values (e.g., 100 pF instead of 100 nF due to a BOM error) cause high-frequency noise on power rails, leading to erratic ADC readings and random resets under load. Missing reset pull-up resistors allow the NRST line to float, causing the MCU to randomly reset from noise coupling. Diagnosing these issues requires cross-referencing the PCB assembly against the BOM and schematic, checking each critical passive with a multimeter or LCR meter.

## Tips

- Keep a "known-good" reference board (dev kit or previous revision) available during bring-up to swap components and cables as a comparison point.
- Take a photo of each side of the board under magnification before powering on — this captures the assembly state for later comparison if rework is needed.
- When a peripheral does not work, check the simplest explanations first: pin mapping, clock enable, and pull resistors account for over half of all bring-up failures.
- Maintain a bring-up log with timestamps, measurements, and firmware versions — this record is invaluable when the same board revision is built again or when reporting issues to a PCB assembler.
- After recovering from a locked debug port, immediately add code to avoid re-enabling readout protection during development — an accidental RDP Level 2 write is unrecoverable.

## Caveats

- **Solder bridges are not always visible** — Fine-pitch QFN packages can have bridges under the component body that are invisible from the top; X-ray inspection is the only reliable detection method for center-pad shorts.
- **Mass erase recovery destroys all calibration data** — On some MCU families, factory-programmed calibration values (e.g., internal voltage reference, temperature sensor) are stored in flash and survive a mass erase, but option bytes are reset — verify before assuming all configuration is preserved.
- **Crystal oscillator failure can be intermittent** — A marginal crystal that starts at room temperature but fails at cold temperatures (below 0 C) causes field failures that never reproduce on the bench.
- **BOM substitution is a hidden risk** — A component supplier substituting a "compatible" part (different ESR capacitor, different pull-up tolerance) can shift circuit behavior enough to cause bring-up failures that do not appear in simulation.
- **PCB fabrication defects are rare but real** — Internal layer shorts, missing vias, and copper slivers from the routing process do occur and should be considered when all assembly and design checks pass but the board still fails.

## In Practice

- A board that draws 500 mA with nothing connected and the regulator reaching 80 C within seconds has a hard short on the output rail — removing capacitors one at a time until the current drops identifies the shorted component.
- A debug probe that connects on the first attempt after programming but fails on all subsequent power cycles points to a BOOT0 pin that is not properly tied low, causing the MCU to enter the bootloader after reset.
- UART output that displays recognizable but garbled characters (wrong characters, not random noise) at a configured 115200 baud almost always indicates the MCU is running from HSI instead of the expected HSE+PLL clock source, producing a baud rate error of 3-5%.
- An I2C bus that works with one device but fails when a second device is added often has pull-up resistors that are too weak for the combined bus capacitance — reducing from 4.7 kOhm to 2.2 kOhm typically resolves it.
- A board that works perfectly at the bench but resets randomly in the field usually has insufficient decoupling on the power rails or a missing bulk capacitor, causing voltage dips during transient current spikes.
