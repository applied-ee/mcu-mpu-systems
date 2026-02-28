---
title: "Charging ICs & Profiles"
weight: 20
---

# Charging ICs & Profiles

Lithium-ion cells require a precise charging algorithm to reach full capacity without exceeding the voltage limits that cause electrolyte decomposition, lithium plating, or thermal runaway. The standard CC/CV (constant-current / constant-voltage) profile has been the industry norm since the early 1990s, and dedicated charging ICs implement this profile with minimal external components. The difference between a safe, long-lived battery system and one that degrades rapidly or catches fire often comes down to the charging IC selection and configuration.

## CC/CV Charging Profile

The CC/CV charge cycle proceeds through three distinct phases:

**Phase 1 — Preconditioning (Trickle Charge)**
If the cell voltage is below a threshold (typically 2.8–3.0V), the charger applies a reduced current — usually 10% of the full charge current — to gently bring the cell voltage up. This protects deeply discharged cells where forcing full charge current could cause excessive heating or copper dendrite dissolution. Preconditioning continues until the cell voltage rises above the threshold, at which point the charger transitions to full CC mode.

**Phase 2 — Constant Current (CC)**
The charger supplies a fixed current (set by an external resistor on most ICs) while the cell voltage rises from ~3.0V toward 4.2V. The charge current during this phase is typically 0.5C to 1C — for a 2000 mAh cell, that means 1000 mA to 2000 mA. Approximately 70–80% of the cell's capacity is restored during the CC phase.

**Phase 3 — Constant Voltage (CV)**
Once the cell reaches 4.2V, the charger holds the voltage constant and allows the current to taper. As the cell's internal electrochemical potential approaches equilibrium, the charge current decays exponentially. Charge termination occurs when the current drops below a threshold — typically 10% of the programmed charge current (C/10). At this point, the cell is at approximately 97–99% of full capacity.

```
Voltage (V)                    Current (mA)
4.2 ─────────────────────╮     1000 ┐
                    ╱    │          │ CC Phase
               ╱         │     ──── │────────────╲
          ╱               │                        ╲  CV Phase
3.0 ─╱                   │                          ╲── 100mA (termination)
     │  Precond. │   CC   │        CV        │ Done
     t0          t1       t2                  t3
```

The total charge time from empty to full for a 1C charge rate is typically 2.5–3 hours: roughly 1 hour for CC and 1.5–2 hours for CV tapering.

## TP4056 — Standalone Linear Charger

The TP4056 (NanJing Top Power) is a widely available linear charging IC in SOP-8 package, found on countless breakout boards and low-cost consumer products. It implements the full CC/CV profile with preconditioning and automatic charge termination.

**Key specifications:**
- Input voltage: 4.5V to 8.0V (typically USB 5V)
- Charge voltage accuracy: 4.2V +/- 1%
- Programmable charge current: 50 mA to 1000 mA
- Preconditioning threshold: 2.9V
- Termination current: 1/10th of programmed charge current
- Package: SOP-8

**Charge current programming** is set by a single resistor (RPROG) between the PROG pin and ground:

| RPROG (kohm) | Charge Current (mA) |
|-------------|---------------------|
| 10 | 130 |
| 5 | 250 |
| 2 | 580 |
| 1.2 | 1000 |

The relationship is approximately: I_charge = 1200 / RPROG(kohm) mA.

**Typical application circuit:**

```
USB 5V ──┬── VIN (pin 4) ────────── TP4056 ──── BAT (pin 5) ──┬── Cell+
         │                                                      │
        4.7µF                                      RPROG ──── PROG (pin 2)
        ceramic                                    (1.2k)       │
         │                                                     GND
        GND ─── GND (pin 3)

Status pins:
  CHRG (pin 7) ── 1k ── LED1 (charging)
  STDBY (pin 6) ── 1k ── LED2 (standby/complete)
```

The TP4056 includes thermal regulation that reduces charge current when the die temperature exceeds approximately 120 degrees C. This prevents thermal damage to the IC but means that at high charge currents (1A) with poor thermal relief, the actual charge current may be lower than programmed. Adequate copper area on the exposed pad is essential — the datasheet recommends at least 4 square centimeters of copper pour connected to the thermal pad.

**Limitation**: The TP4056 has no power-path management. When the charger is connected, the system load draws from the battery, not the input supply. This means the charge current delivered to the cell equals the programmed current minus the system load, extending charge time and making charge termination unreliable if the system load varies.

## MCP73831 — SOT-23-5 Linear Charger

The Microchip MCP73831 is a miniature linear charge controller in a SOT-23-5 package, requiring only a single external resistor and two capacitors. Its small footprint makes it a standard choice for space-constrained wearables, sensors, and IoT devices.

**Key specifications:**
- Input voltage: 3.75V to 6.0V
- Charge voltage accuracy: 4.2V +/- 0.75% (MCP73831)
- Programmable charge current: 15 mA to 500 mA
- Preconditioning threshold: 70% of regulation voltage (~2.94V)
- Termination current: 7.5% of programmed charge current
- Package: SOT-23-5

**Pin assignments:**

| Pin | Name | Function |
|-----|------|----------|
| 1 | STAT | Open-drain charge status output (low = charging, hi-Z = complete or no input) |
| 2 | VSS | Ground |
| 3 | VBAT | Battery connection and charge output |
| 4 | VDD | Input supply (USB 5V typical) |
| 5 | PROG | Charge current programming resistor to ground |

**Charge current programming:**

| RPROG (kohm) | Charge Current (mA) |
|-------------|---------------------|
| 66 | 15 |
| 10 | 100 |
| 5 | 200 |
| 2 | 500 |

The formula is: I_charge = 1000V / RPROG. The STAT pin is particularly useful for firmware — connecting it to a GPIO with an internal pull-up allows the MCU to detect charge state without polling the battery voltage.

**Typical application circuit:**

```
USB 5V ──┬── VDD (pin 4)
         │
        4.7µF                MCP73831
        ceramic               SOT-23-5
         │
        GND ─── VSS (pin 2)

                VBAT (pin 3) ──┬── Cell+
                               │
                              4.7µF
                              ceramic
                               │
                              GND

                PROG (pin 5) ── 2k ── GND   (sets 500mA charge current)
                STAT (pin 1) ── 10k pull-up to VDD ── MCU GPIO
```

The MCP73831 does not include NTC thermistor input for temperature monitoring — that function is available in the MCP73832 variant, which replaces the STAT output with a TE pin for connecting a 10k NTC thermistor. The charger suspends charging if the thermistor indicates the cell temperature is outside 0–45 degrees C.

## BQ24072 — Power-Path Management Charger

The Texas Instruments BQ24072 solves the power-path problem that simpler chargers like the TP4056 ignore. It provides simultaneous charging and system supply by routing input power to the system first and directing the remainder to the battery. If the system load exceeds the input current limit, the BQ24072 supplements the difference from the battery, seamlessly transitioning between input-powered and battery-powered operation.

**Key specifications:**
- Input voltage: 4.35V to 6.40V
- Charge voltage accuracy: 4.2V +/- 0.5%
- Programmable charge current: up to 1.5A
- Input current limit: 100 mA or 500 mA (selectable via EN1/EN2 pins)
- Power-path output (OUT pin): provides system supply independent of battery
- Package: QFN-20 (3.5mm x 3.5mm)
- Integrated power FETs

**Power-path architecture:**

```
                    ┌─────────────────────┐
USB 5V ── IN ──────│  BQ24072            │── OUT ── System Load (3.5–5V)
                    │                     │
                    │  Charge Controller  │── BAT ── Cell+
                    │                     │
         EN1/EN2 ──│  Current Limit Sel  │
         RPROG ────│  Charge Current Set │
         TS ───────│  NTC Thermistor In  │
                    └─────────────────────┘
```

When USB is connected, the OUT pin provides up to the input current limit to the system. Any remaining current charges the battery. When USB is disconnected, the battery feeds the OUT pin through an internal FET, maintaining uninterrupted system operation. This architecture eliminates the common problem of charge termination failing because system load draws current through the battery path.

**NTC thermistor integration**: The TS pin connects to a voltage divider formed by a 10k NTC thermistor and fixed bias resistors. The BQ24072 compares the TS voltage against internal thresholds corresponding to 0 degrees C and 45 degrees C (assuming a standard 10k B=3435 NTC). If the cell temperature falls outside this window, charging suspends and resumes automatically when temperature returns to the safe range.

**Charge current programming**: A resistor from the ISET pin to ground programs the fast-charge current. The relationship is: I_charge = K_ISET / R_ISET, where K_ISET is approximately 890 A-ohm. For 1A charge current, use a 890-ohm resistor. For 500 mA, use 1.78 kohm.

## Thermal Regulation

All linear charging ICs dissipate power as heat: P_dissipated = (V_IN - V_BAT) * I_charge. At 5V input, charging a 3.0V cell at 1A dissipates 2W — enough to exceed the thermal limits of a small SOT-23-5 package without adequate copper pour.

Most modern charging ICs include thermal regulation (also called thermal foldback) that automatically reduces charge current when the die temperature approaches a programmed threshold — typically 100–120 degrees C. This prevents thermal damage but extends charge time. The thermal regulation behavior is not always obvious — a charger that appears to deliver only 500 mA when programmed for 1A may be thermally folding back due to insufficient PCB copper area.

Layout recommendations for managing thermal dissipation:
- Connect the thermal pad (if present) to a copper pour on the component side
- Provide at least 4–6 square centimeters of unobstructed copper on the charger IC's ground plane
- Use thermal vias (0.3mm drill, array of 4–9 vias) under the IC to conduct heat to an inner or bottom copper layer
- Keep the charge current resistor and status LED traces away from the thermal pad area

## Charge Current Selection

Selecting the charge current involves balancing charge time against cell stress and thermal dissipation:

| Charge Rate | Charge Time (approx.) | Cell Stress | Thermal Load |
|------------|----------------------|-------------|--------------|
| 0.2C | 6–7 hours | Minimal | Low |
| 0.5C | 3–4 hours | Low | Moderate |
| 1.0C | 2–3 hours | Moderate | High |
| 2.0C | 1–1.5 hours | High | Very high (requires switching charger) |

Most cell manufacturers recommend charging at 0.5C–1.0C for standard cells. High-rate cells designed for fast charging may tolerate 2C–3C, but this must be confirmed against the cell's specific datasheet. Exceeding the manufacturer's recommended charge rate accelerates capacity fade, increases internal gas generation, and raises the risk of lithium plating — particularly at lower temperatures.

For linear chargers, the thermal ceiling often limits the practical charge rate before the cell's electrical limits are reached. A TP4056 on a minimal PCB may only sustain 600–700 mA before thermal foldback kicks in, even with a 1.2k RPROG resistor that nominally programs 1A.

## Tips

- Always include a 4.7 uF ceramic capacitor (X5R or X7R, 10V rated minimum) on both the input and battery pins of any charging IC — the input cap prevents oscillation from USB cable inductance, and the battery cap stabilizes the feedback loop
- Use 1% tolerance resistors for RPROG — a 5% resistor can shift the charge current by 50 mA, which may exceed the cell's maximum recommended charge rate for small cells
- Route the STAT/CHRG output to an MCU GPIO to detect charge state in firmware — this enables the system to display charge status, log charge cycles, or adjust power modes during charging
- For systems that must operate during charging, strongly prefer a power-path IC like the BQ24072 over simpler chargers — the added cost (~$0.80 vs ~$0.15) prevents charge termination failures and provides cleaner system supply
- Test charge termination with the actual system load connected — a charger that terminates correctly with no load may never terminate if the system draws more than the termination threshold current through the battery path

## Caveats

- **Linear chargers waste significant power at high Vin-Vbat differentials** — Charging from a 9V adapter through a TP4056 at 1A dissipates nearly 5W in the IC, far exceeding any small package's thermal capacity; use a buck converter to pre-regulate the input to ~5V
- **TP4056 boards from online marketplaces often lack input reverse-polarity protection** — Connecting the supply backwards will destroy the IC and may short the battery to the input; adding a series Schottky diode (SS14) or P-channel MOSFET on the input prevents this
- **Charge termination can fail silently** — If the system load draws more current than the termination threshold (typically C/10), the charger never detects the taper and continues indefinitely, slowly overcharging the cell
- **NTC thermistor placement matters** — Mounting the thermistor on the PCB near the charger IC instead of against the cell surface causes the charger to measure PCB temperature rather than cell temperature, defeating the purpose of thermal protection
- **USB current limits apply** — A standard USB 2.0 port supplies 500 mA maximum; programming a charger for 1A on a USB 2.0 port violates the specification and may cause the host to shut down the port or trip overcurrent protection

## In Practice

- A wearable device that charges erratically when worn — sometimes completing, sometimes stalling at 80% — often has a charger without power-path management where the varying system load during active use prevents the taper current from ever reaching the termination threshold
- A battery-powered sensor that charges normally in the lab but suspends charging in the field during summer deployment is likely triggering the NTC over-temperature threshold as direct sunlight heats the enclosure above 45 degrees C
- A TP4056 on a minimal breakout board that gets uncomfortably hot and charges a 2000 mAh cell in 4 hours instead of the expected 2.5 hours is thermally folding back from the programmed 1A to approximately 600 mA — adding copper area to the thermal pad or reducing the charge current to 500 mA resolves both the heat and the unpredictable charge time
- A design that works on one USB port but not another — charging at full rate on a wall adapter but only 100 mA on a laptop port — is hitting the USB host's current limit enforcement, which throttles the supply to the 100 mA default until USB enumeration negotiates a higher limit
- A product that shows "fully charged" but the runtime is 20% shorter than expected may have a charge voltage set slightly low — a 4.15V charge termination instead of 4.20V leaves roughly 10–15% of the cell's capacity unused, compounding with other derating factors
