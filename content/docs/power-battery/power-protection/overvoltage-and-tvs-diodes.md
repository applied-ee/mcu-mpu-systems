---
title: "Overvoltage & TVS Diodes"
weight: 20
---

# Overvoltage & TVS Diodes

Voltage transients — ESD strikes, inductive load switching, cable plugging, and lightning-induced surges — routinely exceed the absolute maximum ratings of microcontrollers and interface ICs. A 3.3V GPIO rated for 4.0V absolute maximum will not survive a 15kV ESD event that couples through a connector. TVS (transient voltage suppressor) diodes clamp these transients to safe levels in nanoseconds, absorbing the energy before it reaches the protected IC. Proper TVS selection and placement is one of the most cost-effective reliability investments in embedded hardware.

## TVS Operating Principle

A TVS diode is a silicon avalanche device designed to break down at a precise voltage and clamp transient energy. Under normal operating conditions, the TVS presents high impedance and draws negligible leakage current. When a transient exceeds the breakdown voltage, the TVS enters avalanche mode and conducts heavily, clamping the voltage at the protected node to its clamping voltage (Vc). The energy of the transient is absorbed as heat in the TVS junction.

Unlike a Zener diode optimized for voltage regulation, a TVS diode is optimized for energy absorption — it has a much larger junction area, lower thermal impedance, and can handle peak pulse currents of tens to hundreds of amps for microsecond-duration transients.

## Key TVS Parameters

| Parameter | Symbol | Description |
|-----------|--------|-------------|
| Reverse standoff voltage | Vrwm | Maximum continuous operating voltage — must exceed the normal signal/rail voltage |
| Breakdown voltage | Vbr | Voltage at which the TVS begins to conduct (typically 1.1x Vrwm) |
| Clamping voltage | Vc | Voltage across the TVS at the specified peak pulse current (Ipp) |
| Peak pulse current | Ipp | Maximum transient current the TVS can handle for a specified pulse width |
| Peak pulse power | Ppk | Vc * Ipp — the maximum instantaneous power during clamping |
| Junction capacitance | Cj | Parasitic capacitance, critical for high-speed data lines |
| Leakage current | IR | Current drawn at Vrwm — typically under 1µA for unidirectional, higher for bidirectional |

## Unidirectional vs Bidirectional

Unidirectional TVS diodes clamp in one polarity and act as a standard forward-biased diode in the other direction (clamping at ~0.7V for negative transients). These are appropriate for DC power rails and signals that are always positive.

Bidirectional TVS diodes clamp symmetrically in both polarities. These are required for AC signals, differential data lines (RS-485, CAN, Ethernet), and any signal that swings both positive and negative relative to ground.

## Selecting TVS for Specific Applications

### Power Rail Protection (5V)

For a 5V power rail, the TVS standoff voltage must exceed 5V. The SMBJ5.0A (unidirectional) provides:

- Vrwm = 5.0V (safe for continuous 5V rail)
- Vbr = 6.4V minimum
- Vc = 9.2V at 43.5A (Ipp)
- Ppk = 600W (10/1000µs pulse)
- Package: SMB (DO-214AA)

The downstream IC must survive 9.2V for the brief clamping duration. For a 5V-tolerant regulator with 20V absolute maximum, this margin is comfortable. For a 5.5V-rated MCU supply pin, the SMBJ5.0A clamping voltage is too high — a lower-power TVS with tighter clamping (such as the PESD5V0S1BA with Vc = 8.5V) or a TVS plus series resistance to reduce peak current would be needed.

### USB Data Line Protection

USB data lines operate at 3.3V signal levels and require TVS devices with very low capacitance to avoid degrading signal integrity at 480MHz (USB 2.0 High Speed). The USBLC6-2SC6 is the standard choice:

- Vrwm = 5.25V per line
- Vc = 17V at 5A (IEC 61000-4-2 contact)
- Cj = 0.85pF per line (low enough for USB 2.0 HS)
- Package: SOT-23-6 (protects two differential pairs)
- IEC 61000-4-2 rated: ±15kV air, ±8kV contact

For USB 3.0 SuperSpeed (5Gbps), even 0.85pF is marginal. The IP4234CZ6 targets USB 3.0 with 0.27pF per line.

### GPIO and Sensor Input Protection

For 3.3V GPIO pins exposed to external connectors, the PESD3V3S1BA provides:

- Vrwm = 3.3V
- Vc = 9.8V at 8A
- Cj = 6pF (acceptable for I2C, SPI clock rates under 10MHz)
- Package: SOD-323

For higher-speed signals where 6pF is too much, the PESD5V0L1BA offers 0.37pF but with a higher standoff voltage — suitable when the pin is 5V-tolerant.

## ESD Protection Standards

The IEC 61000-4-2 standard defines ESD test levels for product immunity:

| Level | Contact Discharge | Air Discharge |
|-------|-------------------|---------------|
| 1 | ±2kV | ±2kV |
| 2 | ±4kV | ±4kV |
| 3 | ±6kV | ±8kV |
| 4 | ±8kV | ±15kV |

Most consumer products target Level 4. The Human Body Model (HBM) used for IC-level ESD testing specifies lower energies (typically 2kV) and is insufficient for system-level protection — a device rated for 2kV HBM needs external TVS protection to survive Level 4 IEC 61000-4-2 contact discharge.

## TVS Arrays for Multi-Line Protection

When multiple signal lines pass through a single connector (e.g., an 8-bit parallel bus or a multi-pin sensor header), TVS array ICs protect all lines in a single package:

| Part | Lines | Vrwm | Cj/line | Package | Application |
|------|-------|------|---------|---------|-------------|
| PRTR5V0U2X | 2 | 5.5V | 0.5pF | SOT-143B | USB 2.0 |
| TPD4E05U06 | 4 | 5.5V | 0.5pF | USON-6 | SPI, JTAG |
| TPD8E003 | 8 | 5.5V | 0.6pF | UFQFN-10 | Parallel bus, headers |
| SP0505BAHTG | 4 | 5.5V | 0.9pF | SOT-23-5 | I2C + GPIO |

Array devices are smaller and cheaper per line than individual TVS diodes and ensure matched protection across all signals.

## Placement Strategy

TVS placement follows one critical rule: as close to the connector as possible, before any series resistance or trace length. The TVS must intercept the transient before it propagates along the trace to the protected IC. Placing a TVS near the IC instead of at the connector allows the transient to travel the full trace length, inducing voltage drops across trace inductance that the TVS cannot clamp.

The PCB layout should route the signal trace from the connector pad directly to the TVS pad, then onward to the rest of the circuit. The TVS ground connection should use the shortest possible path to the ground plane — a via directly on the TVS ground pad is ideal.

```
Connector Pin ──[short trace]── TVS ──[trace]── Series R ──[trace]── IC Pin
                                 │
                                GND (via to plane)
```

Any series resistance (e.g., a 33Ω resistor for USB signal conditioning) should be placed after the TVS. The series resistor then limits the current that reaches the IC during the brief overshoot before the TVS fully clamps, providing a second layer of protection.

## TVS Plus Fuse Coordination

For sustained overvoltage events (not just transients), a TVS alone will eventually overheat and fail. A fuse in series with the power input clears before the TVS reaches thermal limits. The coordination requirement is:

1. The fuse must carry normal operating current without nuisance tripping
2. The fuse I²t rating must be lower than the TVS thermal I²t capability
3. During a sustained fault, the TVS clamps voltage while the fuse heats and eventually opens

A typical arrangement for a 5V/1A input uses a 2A fast-blow fuse with a SMBJ5.0A TVS. The TVS can handle 600W for 1ms — far more than the fuse's clearing energy — so the fuse opens before the TVS sustains damage.

## Zener vs TVS Comparison

| Characteristic | Zener Diode | TVS Diode |
|----------------|-------------|-----------|
| Primary purpose | Voltage regulation | Transient suppression |
| Junction area | Small | Large |
| Peak power | 250mW–5W continuous | 400W–30kW pulse |
| Response time | ~10ns | ~1ns (faster avalanche) |
| Clamping ratio (Vc/Vbr) | 1.2–1.5 | 1.2–1.4 |
| Capacitance | 10–100pF | 0.3–500pF (varies widely) |
| Cost | Lower | Higher |

A Zener diode can provide basic transient protection for low-energy events, but its small junction area and limited peak power make it unsuitable for ESD or high-energy surges. Using a TVS rated for the application is always the safer engineering choice.

## Clamping Voltage Calculation

The voltage the protected IC actually sees during a transient depends on the TVS clamping voltage plus any additional voltage drop across PCB traces:

```
V_at_IC = Vc + (I_transient * R_trace) + (L_trace * dI/dt)
```

For the SMBJ5.0A clamping at 9.2V with 43.5A peak current through 10mm of trace (approximately 10nH inductance) and a current rise time of 10ns:

```
V_inductive = 10nH * (43.5A / 10ns) = 43.5V
```

This inductive spike adds to the clamping voltage and can exceed the IC's absolute maximum rating despite the TVS doing its job. Minimizing trace inductance between the connector and TVS ground return is essential — this calculation demonstrates why placement close to the connector matters.

## Tips

- Select TVS standoff voltage (Vrwm) at least 10% above the maximum normal operating voltage to avoid leakage current during normal operation — a 5V rail should use a TVS with Vrwm of at least 5.5V if signal peaks can reach 5V
- For high-speed data lines (USB, HDMI, Ethernet), choose TVS devices with junction capacitance under 1pF to avoid degrading signal integrity
- Place TVS diodes at every external connector — internal board-to-board connections typically do not need TVS protection
- Use TVS arrays instead of individual diodes when protecting multi-pin connectors — they save board space and ensure matched protection characteristics
- Check that the TVS clamping voltage (Vc at Ipp) is below the absolute maximum rating of the protected IC, not just below the damage threshold

## Caveats

- **TVS clamping voltage is not the same as breakdown voltage** — The actual clamping voltage at peak current is significantly higher than Vbr (often 1.3–1.5x), and this higher value determines whether the downstream IC survives
- **Bidirectional TVS devices have higher capacitance** — The back-to-back junction structure roughly doubles the effective capacitance compared to unidirectional versions, which can be a problem on high-speed signal lines
- **TVS diodes do not protect against sustained overvoltage** — A continuously applied voltage above Vbr will cause the TVS to conduct indefinitely, eventually overheating and failing open or short; a fuse or eFuse must clear the fault first
- **Junction capacitance varies with applied voltage** — Datasheet Cj is typically specified at 0V bias; at the operating voltage, capacitance may drop by 30–50%, which is actually favorable for signal integrity
- **Cheap TVS clones with inflated ratings exist** — Parts sourced from non-authorized distributors may not meet specified Ppk ratings; using known manufacturers (Nexperia, Littelfuse, ON Semi, TI) from authorized channels avoids this risk

## In Practice

- A product that passes internal testing but fails IEC 61000-4-2 compliance testing at Level 4 (±8kV contact) typically has TVS diodes placed too far from the connector or missing entirely on exposed signal lines
- A USB device that enumerates normally but corrupts data intermittently at High Speed (480Mbps) after adding ESD protection likely has a TVS with excessive capacitance (above 2pF) on the data lines — switching to a USBLC6-2 or equivalent low-capacitance device resolves it
- An outdoor sensor node that fails after a thunderstorm despite having TVS protection on the signal lines often lacks protection on the power input — lightning-induced surges couple onto power wiring and bypass signal-only protection
- A GPIO input that shows erratic readings when a nearby relay switches is coupling inductive transients onto the signal trace — adding a PESD3V3S1BA at the GPIO connector plus a 1kΩ series resistor before the MCU pin eliminates the glitch
- A board that survives ESD testing initially but fails after environmental aging may have marginal TVS clamping voltage — the 1.4x ratio between Vc and the IC's absolute maximum rating looked sufficient but left no margin for component variation and aging drift
