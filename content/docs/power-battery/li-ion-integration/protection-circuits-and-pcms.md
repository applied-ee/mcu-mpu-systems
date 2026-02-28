---
title: "Protection Circuits & PCMs"
weight: 30
---

# Protection Circuits & PCMs

A lithium-ion cell without protection circuitry is one fault away from a fire. The cell itself has no internal mechanism to prevent overcharge, overdischarge, or overcurrent — those limits exist only in the cell's chemistry, and violating them causes irreversible damage, capacity loss, or thermal runaway. A protection circuit module (PCM) — sometimes called a battery protection board or BMS for single-cell systems — enforces hard voltage and current limits by switching a pair of MOSFETs in series with the cell. These circuits operate autonomously, using analog comparators rather than programmable registers, and require no firmware interaction. They are the last line of defense when the charging IC malfunctions, the firmware crashes, or the load shorts.

## Protection IC Architecture

The most common single-cell protection topology uses a dedicated protection IC paired with one or two external N-channel MOSFETs. The protection IC monitors the cell voltage and the voltage across a current-sense resistor (or the MOSFET RDS(on)), and drives the MOSFET gates to disconnect the cell when limits are exceeded.

```
             Cell+                             Pack+
              │                                  │
              ├──────────────────────────────────┤
              │                                  │
         ┌────┴────┐                             │
         │  Cell   │                             │
         │  3.7V   │                             │
         └────┬────┘                             │
              │                                  │
              │    ┌──────────┐     ┌─────┐     │
              ├────│ Prot. IC │─────│Gate │     │
              │    │ (DW01A)  │     │Drive│     │
              │    └─────┬────┘     └──┬──┘     │
              │          │             │         │
              │     CS pin         ┌───┴───┐    │
              │          │         │       │    │
              │          └────┬────┤ Q1    Q2 ├──┘
              │               │    │ (OD)  (OC)│
             Cell-            │    └───┬───┘    Pack-
                              │        │
                             Rsense   GND
                              │        │
                              └────────┘
```

Q1 and Q2 are dual N-channel MOSFETs connected in series between Cell- and Pack-. Q1 controls overdischarge protection (its body diode allows charging current to flow even when Q1 is off). Q2 controls overcharge protection (its body diode allows discharge current to flow even when Q2 is off). This back-to-back arrangement ensures that each protection function can independently disconnect the cell while allowing current flow in the opposite direction for recovery.

## DW01A Protection IC

The DW01A (Fortune Semiconductor, also manufactured by numerous Chinese semiconductor companies) is the most widely used single-cell Li-Ion protection IC. It appears on virtually every protected 18650 cell and most single-cell battery packs.

**Key specifications:**

| Parameter | Condition | Typical Value | Range |
|-----------|-----------|---------------|-------|
| Overcharge detection voltage | V_OC | 4.25V | 4.20–4.30V |
| Overcharge release voltage | V_OCR | 4.15V | 4.05–4.20V |
| Overdischarge detection voltage | V_OD | 2.40V | 2.30–2.50V |
| Overdischarge release voltage | V_ODR | 3.00V | 2.90–3.10V |
| Overcurrent detection voltage | V_OI (across CS pin) | 150mV | 100–200mV |
| Short-circuit detection voltage | V_SCD | 1.00V | 0.7–1.35V |
| Quiescent current | Normal operation | 3 uA | — |
| Overcharge delay | — | 80 ms | 50–120 ms |
| Overdischarge delay | — | 40 ms | 20–70 ms |
| Short-circuit delay | — | 300 us | 200–500 us |
| Package | — | SOT-23-6 | — |

**Pin assignments:**

| Pin | Name | Function |
|-----|------|----------|
| 1 | OD | Overdischarge FET gate drive (active high) |
| 2 | CS | Current sense input (connected between the two MOSFETs) |
| 3 | OC | Overcharge FET gate drive (active high) |
| 4 | TD | Test/delay pin (connect to ground for normal operation) |
| 5 | VCC | Positive supply (connected to Cell+) |
| 6 | GND | Ground (connected to Cell-) |

**Paired MOSFETs**: The DW01A is almost always paired with the FS8205A (or equivalent 8205A) dual N-channel MOSFET in a SOT-23-6 package. The FS8205A contains two N-channel MOSFETs with RDS(on) of approximately 25 milliohms each, handling up to 6A continuous current. The overcurrent trip point depends on the combined RDS(on) of both MOSFETs plus any trace resistance — at 150mV across the CS pin and ~50 milliohms total resistance, the overcurrent threshold is approximately 3A.

**Protection behavior:**

1. **Overcharge**: When V_cell exceeds 4.25V for more than 80 ms, the DW01A pulls the OC gate low, turning off Q2. Charging current is blocked. Discharge current can still flow through Q2's body diode. When V_cell drops below 4.15V (either through self-discharge or load current through the body diode), the OC gate goes high again, re-enabling normal operation.

2. **Overdischarge**: When V_cell drops below 2.40V for more than 40 ms, the OD gate goes low, turning off Q1. This disconnects the load to prevent further discharge. The cell enters a low-power state where the DW01A draws only ~0.1 uA. Recovery requires connecting a charger — the charging current flows through Q1's body diode, and when V_cell rises above 3.0V, the OD gate goes high, re-enabling discharge.

3. **Overcurrent**: When the voltage across the CS pin exceeds 150mV (indicating excessive current through the MOSFETs), the DW01A turns off the OD FET after a short delay. Recovery is automatic after the load is removed, with a typical recovery time of 10–15 seconds.

4. **Short circuit**: When the CS voltage exceeds approximately 1.0V (indicating a dead short or very low resistance path), the DW01A turns off the OD FET within 300 microseconds. This fast response time is critical for preventing MOSFET destruction and cell damage.

## FS312F-G Alternative

The FS312F-G (Fortune Semiconductor) offers tighter voltage tolerances and a wider range of detection voltage variants compared to the DW01A.

| Parameter | FS312F-G | DW01A |
|-----------|----------|-------|
| Overcharge detection accuracy | +/- 25mV | +/- 50mV |
| Overdischarge detection accuracy | +/- 50mV | +/- 100mV |
| Available OV variants | 4.20V, 4.25V, 4.275V, 4.30V, 4.35V | 4.25V (fixed) |
| Available UV variants | 2.40V, 2.50V, 2.80V, 2.90V, 3.00V | 2.40V (fixed) |
| Package | SOT-23-6 | SOT-23-6 |

The FS312F-G's variant system allows selecting protection thresholds appropriate for different chemistries. The 4.275V overcharge / 2.80V overdischarge variant is appropriate for standard LCO cells with tighter margins. The 3.00V overdischarge variant preserves more cell capacity by cutting off discharge earlier, extending cycle life at the expense of usable energy per cycle.

## Overcurrent Threshold Engineering

The overcurrent detection threshold in the DW01A and similar ICs is determined by the voltage across the CS pin, which in turn depends on the load current and the total resistance in the current path. The primary contributors to this resistance are:

- **MOSFET RDS(on)**: The FS8205A has approximately 25 milliohms per FET, with two FETs in series yielding ~50 milliohms
- **PCB trace resistance**: Typically 5–15 milliohms depending on trace width and length
- **Sense resistor** (if added): An optional external resistor for precise current limiting

Without an external sense resistor, using only the MOSFET RDS(on) as the sense element:

| Total Path Resistance | OC Threshold (at 150mV) | SC Threshold (at 1.0V) |
|----------------------|------------------------|----------------------|
| 30 milliohms | 5.0A | 33A |
| 50 milliohms | 3.0A | 20A |
| 80 milliohms | 1.9A | 12.5A |
| 100 milliohms | 1.5A | 10A |

Adding a small sense resistor (10–50 milliohms) in series with the MOSFETs allows tuning the overcurrent threshold downward for applications that require tighter current limiting. A 50-milliohm resistor (0.050 ohm, 1206 package rated for 1W) added to the 50-milliohm MOSFET path creates 100 milliohms total, lowering the overcurrent threshold to 1.5A.

**Caution**: RDS(on) varies with temperature — a MOSFET that measures 25 milliohms at 25 degrees C may reach 40–50 milliohms at 85 degrees C. This temperature coefficient causes the overcurrent threshold to decrease at elevated temperatures, which is generally a safe-side failure mode (the protection trips earlier when hot) but can cause nuisance tripping in high-temperature environments.

## Protected vs Unprotected Cells

Commercial 18650 cells are available in both protected and unprotected configurations:

| Feature | Protected Cell | Unprotected Cell |
|---------|---------------|-----------------|
| Length | 67–69 mm | 65 mm (standard) |
| Weight | +2–3 grams | Standard |
| Max discharge current | Limited by PCM (typically 3–7A) | Limited by cell chemistry (up to 20–30A) |
| Overdischarge protection | Built-in (cuts off at ~2.5V) | None — firmware or external circuit must enforce |
| Short-circuit protection | Built-in (cuts off within 300 us) | None — fuse wire in some cells (PTC) |
| Cost | $1–3 more | Lower |
| Suitability | Consumer devices, general use | High-drain devices, custom BMS, power tools |

Protected cells include a small PCB (the PCM) spot-welded to the cell's negative terminal, with a nickel strip connecting to the positive terminal. The PCM adds 2–3 mm to the cell length and introduces 50–100 milliohms of additional resistance from the MOSFETs and connecting strips. For high-drain applications (vaping, power tools, RC vehicles), the PCM's current limit is too restrictive and the added resistance causes unacceptable voltage sag. These applications use unprotected cells with an external BMS that provides protection at higher current thresholds.

## PCM Module Placement

In a custom battery pack, the protection circuit sits between the cell and the rest of the system — the charger, the load, and any fuel gauge. The typical single-cell PCM has three connections:

- **B+ / B-**: Connect directly to the cell terminals
- **P+ / P-**: Connect to the system (charger input and load output share these terminals)

```
                    PCM Module
                 ┌──────────────┐
Cell+ ── B+ ────│              │──── P+ ── Charger IN+ / Load+
                 │   DW01A +   │
                 │   FS8205A   │
Cell- ── B- ────│              │──── P- ── Charger IN- / Load-
                 └──────────────┘
```

The protection IC monitors voltage across B+ and B- (cell voltage) and current through the MOSFET path. When a fault condition is detected, the MOSFETs open the P- connection, disconnecting the cell from the system while maintaining the cell's connection to the protection IC for continued monitoring.

**Important**: The charger connects to the P+ / P- terminals, not directly to the cell. This ensures that overcharge protection functions correctly — if the charger malfunctions and pushes the cell above 4.25V, the protection IC disconnects the charger from the cell.

## Register-Less Operation

Unlike fuel gauge ICs or sophisticated battery management systems, protection ICs like the DW01A and FS312F-G have no registers, no I2C interface, and no firmware configuration. All thresholds are set at the factory by the silicon design — the comparator reference voltages are determined by internal bandgap references and resistor ratios fixed during manufacturing.

This design philosophy is intentional: a protection circuit must operate independently of any microcontroller or software. If the MCU crashes, the power rail glitches, or the firmware hangs in an infinite loop, the protection IC continues to monitor the cell voltage and current using only the cell's own energy. The DW01A draws approximately 3 uA in normal operation and can monitor the cell for years on a single charge.

The only external component that influences behavior is the current sense resistance (MOSFET RDS(on) plus any series resistor), which sets the overcurrent and short-circuit thresholds as described above. All voltage thresholds are fixed for a given IC variant.

## Tips

- Always place the protection circuit as close to the cell terminals as possible — long traces between the cell and the protection MOSFETs add resistance that shifts the overcurrent threshold and increases I2R losses
- Use Kelvin-sense connections for the CS pin when precise overcurrent thresholds matter — route the CS trace directly to the MOSFET source, not to the load-side PCB copper, to avoid measuring trace voltage drops
- For multi-cell series packs (2S, 3S), dedicated multi-cell protection ICs like the BQ29700 (2-series) or S-8254A (3–4 series) replace multiple DW01A circuits and add cell balancing capability
- Test the short-circuit response with an actual dead short on the output — not just a low-resistance load — to verify that the protection IC disconnects within the specified 200–500 microsecond window
- Include a fuse (or PTC resettable fuse) as a backup to the electronic protection — if the MOSFETs fail short (which is the typical failure mode for MOSFETs), the fuse provides a secondary disconnect mechanism

## Caveats

- **MOSFET failure mode is short-circuit** — When a protection MOSFET fails due to exceeding its SOA (safe operating area), it typically fails short, permanently connecting the cell to the load and eliminating all protection; a series fuse is the only backup
- **Overdischarge lockout can trap the cell** — If a cell is discharged below the overdischarge threshold and then left for an extended period, continued self-discharge may push the cell voltage below 2.0V where recovery becomes difficult; some chargers refuse to precharge cells below 2.0V, requiring a manual trickle charge at low current to bring the cell back above the protection IC's release threshold
- **RDS(on) variation between MOSFET batches affects overcurrent threshold** — Two FS8205A parts from different production lots may have RDS(on) values differing by 30%, shifting the overcurrent threshold proportionally; for production designs, characterize a sample of MOSFETs and add margin
- **DW01A clones vary in quality** — The DW01A marking is used by multiple manufacturers, and threshold accuracy, delay times, and quiescent current can vary significantly between sources; verify the actual protection thresholds with a bench test on incoming parts
- **Protection ICs do not protect against reverse polarity** — Connecting a cell backwards through a DW01A circuit can destroy both the IC and the MOSFETs; mechanical keying (using connectors that prevent reverse insertion) is the primary defense

## In Practice

- A protected 18650 cell that trips its overcurrent protection under a 2A load but is rated for 3A often has corroded or high-resistance nickel strips connecting the PCM to the cell terminals — the added resistance shifts the effective overcurrent threshold downward
- A battery pack that will not charge after being left in storage for several months has likely self-discharged below the overdischarge release threshold — connecting a lab supply set to 3.3V with a 100 mA current limit directly to the B+ / B- pads (bypassing the protection) for a few minutes brings the cell voltage above the release threshold, after which the normal charger can take over
- A device that works normally but shuts off during brief high-current pulses (motor start, RF transmit burst) is tripping the overcurrent protection — either the peak current exceeds the protection threshold, or the MOSFET RDS(on) has increased due to aging, lowering the effective threshold; increasing the current handling (using lower-RDS(on) MOSFETs) or reducing the peak current resolves the issue
- A protection circuit that passes bench testing but fails in the field may be encountering temperature-dependent RDS(on) shifts — at -10 degrees C, RDS(on) decreases, raising the overcurrent threshold and allowing more current than intended; at 60 degrees C, RDS(on) increases, causing nuisance tripping at normal operating currents
