---
title: "Cell Selection & Ratings"
weight: 10
---

# Cell Selection & Ratings

Selecting a lithium-ion cell for an embedded project involves balancing energy density, discharge capability, physical size, and safety margins. The datasheet numbers — nominal voltage, capacity in milliamp-hours, maximum discharge current — only tell part of the story. Real-world performance depends on temperature, age, internal resistance, and how closely the system's load profile matches the cell's design envelope. A cell that performs well on a bench at 25 degrees C may sag below the regulator's dropout voltage in a cold enclosure, or overheat when pulsed at its rated maximum.

## Chemistry Types

Lithium-ion is not a single chemistry. The cathode material determines the voltage range, energy density, cycle life, and thermal stability of the cell.

| Chemistry | Abbreviation | Nominal Voltage | Max Charge | Cutoff Voltage | Energy Density | Cycle Life |
|-----------|-------------|-----------------|------------|----------------|----------------|------------|
| Lithium Cobalt Oxide | LiCoO2 (LCO) | 3.7V | 4.20V | 3.0V | ~200 Wh/kg | 300–500 |
| Lithium Iron Phosphate | LiFePO4 (LFP) | 3.2V | 3.65V | 2.5V | ~120 Wh/kg | 2000+ |
| Nickel Manganese Cobalt | NMC | 3.7V | 4.20V | 2.5V | ~220 Wh/kg | 500–1000 |
| Lithium Polymer (pouch) | LiPo | 3.7V | 4.20V | 3.0V | ~180 Wh/kg | 300–500 |

LiCoO2 dominates in consumer electronics — phones, tablets, and small embedded devices — due to its high energy density and wide availability. LiFePO4 trades energy density for thermal stability and long cycle life, making it suitable for solar-charged systems, outdoor installations, and applications that require thousands of charge-discharge cycles. NMC cells occupy the middle ground, offering higher energy density than LFP with better thermal behavior than LCO, and appear commonly in power tools and e-bikes. LiPo pouch cells use the same LCO or NMC cathode chemistry but package them in a flexible aluminum-laminate pouch rather than a rigid metal can, enabling custom shapes and thinner profiles at the cost of mechanical protection.

## Form Factors

The physical format of a cell constrains the mechanical design and determines what protection is available.

| Form Factor | Dimensions | Typical Capacity | Notes |
|-------------|-----------|-----------------|-------|
| 18650 | 18mm dia x 65mm | 2000–3500 mAh | Most common cylindrical; rigid steel can; available protected and unprotected |
| 21700 | 21mm dia x 70mm | 4000–5000 mAh | Larger cylindrical; higher capacity; used in Tesla packs and power tools |
| 14500 | 14mm dia x 50mm | 700–1000 mAh | AA-sized; convenient for retrofitting AA-powered designs |
| Pouch | Custom | 100–10000 mAh | Flat, flexible; no rigid case; requires external structural support |
| LIR2032 | 20mm dia x 3.2mm | 40–70 mAh | Rechargeable coin cell; drop-in for CR2032 form factor; very low capacity |

Cylindrical cells like the 18650 and 21700 include a vent mechanism that releases gas in a controlled direction during thermal runaway, reducing the risk of rupture. Pouch cells swell when gas is generated internally — the enclosure design must account for up to 10% thickness increase over the cell's lifetime. Coin-format lithium-ion cells (LIR2032) provide rechargeable capability in the CR2032 footprint but deliver only 40–70 mAh at 3.7V nominal, limiting them to ultra-low-power RTC backup or sensor beacon applications.

## C-Ratings and Discharge Current

The C-rating expresses maximum discharge current as a multiple of the cell's capacity. A 3000 mAh cell rated at 1C can deliver 3000 mA (3A) continuously. At 2C, the same cell delivers 6A. At 0.2C, it delivers 600 mA.

Most standard 18650 cells (Samsung INR18650-25R, Sony VTC5, LG HG2) support continuous discharge rates between 1C and 7C:

| Cell | Capacity | Max Continuous Discharge | C-Rating |
|------|----------|-------------------------|----------|
| Samsung INR18650-25R | 2500 mAh | 20A | 8C |
| Sony US18650VTC5 | 2600 mAh | 20A | 7.7C |
| LG HG2 (INR18650HG2) | 3000 mAh | 20A | 6.7C |
| Samsung INR18650-35E | 3500 mAh | 8A | 2.3C |
| Panasonic NCR18650B | 3400 mAh | 6.8A | 2C |

High-capacity cells (3400–3500 mAh) tend to have lower C-ratings because the thicker electrodes that increase energy density also increase internal resistance. High-drain cells (20A continuous) sacrifice some capacity for thinner electrodes and lower resistance. Embedded systems that draw steady currents under 1A can use high-capacity cells comfortably. Systems with motor drives, high-power RF transmitters, or LED arrays that pulse several amps should select high-drain cells and verify the voltage sag at peak current stays above the regulator's minimum input.

## Voltage Ranges and Charge Limits

For standard LCO/NMC/LiPo cells, the voltage window is well-defined:

- **Maximum charge voltage**: 4.20V +/- 0.05V. Charging above 4.25V accelerates electrolyte decomposition and lithium plating on the anode, creating internal short-circuit risk. Every 0.1V of overcharge roughly halves cycle life.
- **Nominal voltage**: 3.7V (LCO/NMC/LiPo) or 3.2V (LFP). The nominal value represents the average voltage across a full discharge cycle, not a fixed operating point.
- **Cutoff voltage**: 3.0V for LCO/LiPo, 2.5V for NMC/LFP. Discharging below the cutoff dissolves copper from the anode current collector into the electrolyte. This copper can redeposit as dendrites during the next charge, creating internal shorts.
- **Storage voltage**: 3.7–3.8V (approximately 40–60% SOC). Storing cells fully charged accelerates calendar aging; storing them fully discharged risks the cell drifting below cutoff through self-discharge.

LiFePO4 cells have a different and notably flat discharge curve — the voltage stays between 3.2V and 3.3V for roughly 80% of the discharge, then drops steeply. This flat profile simplifies voltage regulation (a 3.3V rail can be powered almost directly) but makes voltage-based state-of-charge estimation very difficult in the middle of the discharge range.

## Temperature Limits

Lithium-ion cells impose asymmetric temperature restrictions on charging versus discharging.

| Operation | Minimum | Maximum | Notes |
|-----------|---------|---------|-------|
| Charging | 0 deg C | 45 deg C | Charging below 0 deg C causes lithium plating; irreversible |
| Discharging | -20 deg C | 60 deg C | Capacity reduced by 20–40% at -20 deg C |
| Storage | -20 deg C | 45 deg C | Calendar aging doubles for every 10 deg C above 25 deg C |

The charging restriction is the critical one: lithium plating that occurs during sub-zero charging creates metallic lithium deposits on the anode that cannot be reversed. These deposits reduce capacity permanently and can eventually cause internal shorts. A robust battery management system disables charging when the thermistor reading indicates a cell temperature below 0 degrees C, even if the ambient temperature is slightly above freezing (the cell's internal temperature may lag ambient during rapid temperature changes).

## Internal Resistance and Voltage Sag

Every cell has an internal resistance (often called DCIR — DC internal resistance) that causes the terminal voltage to drop under load according to V_sag = I_load * R_internal. A fresh Samsung INR18650-25R has approximately 20 milliohms DCIR. At 5A discharge, this produces 100mV of sag. An aged cell of the same type may reach 60–80 milliohms, producing 300–400mV of sag at the same current.

This sag directly affects whether the downstream voltage regulator stays in regulation. A 3.3V LDO with 200mV dropout needs at least 3.5V input. A cell at 3.6V nominal that sags 300mV under load presents only 3.3V to the regulator input — below the dropout threshold, causing output voltage droop and potential MCU brownout.

Measuring DCIR on the bench requires applying a known load step and recording the instantaneous voltage drop (within the first few milliseconds, before the slower electrochemical response takes effect). A simple approach: record V_open at rest, apply a 1A load, and read V_loaded after 1 second. DCIR = (V_open - V_loaded) / I_load. Values between 15 and 40 milliohms are typical for healthy 18650 cells.

## Capacity Ratings and Derating

Manufacturer capacity ratings are measured under specific conditions — typically 0.2C discharge at 25 degrees C from 4.2V to the cutoff voltage. Real-world capacity is lower due to several factors:

- **Higher discharge rates**: A 3000 mAh cell delivers approximately 2700 mAh at 1C and 2400 mAh at 3C, due to increased resistive losses and electrochemical inefficiency at higher currents.
- **Low temperature**: At 0 degrees C, available capacity drops to 70–80% of the 25 degrees C rating. At -20 degrees C, only 50–60% of rated capacity is accessible.
- **Aging**: After 300 full cycles, a typical LCO cell retains 80% of its original capacity. After 500 cycles, 70% is more realistic. Calendar aging also reduces capacity regardless of cycling — roughly 2–4% per year at 25 degrees C storage.
- **Depth of discharge**: Limiting discharge to 80% of capacity (stopping at ~3.4V rather than 3.0V) can double or triple cycle life.

For system design, applying a 20–30% derating factor to the manufacturer's rated capacity provides a more realistic runtime estimate over the product's expected service life.

## Tips

- Always verify the cell's maximum continuous discharge rating against the system's peak current draw — including startup inrush, motor stall current, and RF transmit bursts, not just the steady-state average
- Select cells from reputable manufacturers (Samsung SDI, LG Chem, Sony/Murata, Panasonic) — counterfeit 18650 cells claiming 5000+ mAh capacity at the 18650 form factor do not exist and typically deliver under 1000 mAh
- For products that ship with cells, check IEC 62133 and UN 38.3 certification requirements — uncertified cells may be rejected by shipping carriers or fail regulatory review
- Store incoming cells at 3.7–3.8V (40–60% SOC) in a cool environment to minimize calendar aging before assembly
- When paralleling cells, match capacity and internal resistance within 10–20% to prevent imbalanced current sharing

## Caveats

- **Datasheet capacity is a best-case number** — Real-world capacity at the system's actual discharge rate and operating temperature may be 20–40% lower than the headline specification
- **"Protected" 18650 cells are 2–3mm longer than unprotected ones** — The PCM board adds length to the cell, and some battery holders designed for standard 65mm cells will not accept 68mm protected cells
- **LiFePO4 voltage ranges are incompatible with LCO/NMC chargers** — A charger set for 4.2V will overcharge an LFP cell (max 3.65V) and create a serious safety hazard; dedicated LFP charge profiles are required
- **Self-discharge is real but slow** — A healthy cell loses roughly 2–5% per month at room temperature, but a cell with internal micro-shorts from age or damage may self-discharge much faster, indicating end-of-life

## In Practice

- A battery-powered sensor node that runs for six months on a 3000 mAh cell in the lab but fails after three months in the field is likely encountering lower ambient temperatures that reduce effective capacity by 20–30%, combined with higher-than-expected transmit duty cycles
- A design that uses an LDO with 300mV dropout running from a single LiPo cell starts resetting when the battery drops below 3.6V — even though the cell still has 20% capacity remaining, the voltage sag under load pushes the LDO out of regulation
- A product recalled for battery swelling often traces back to cells that were stored fully charged at elevated temperatures during warehousing, accelerating gas generation inside the cell before the product ever reached the end user
- An 18650-powered flashlight that claims 3500 mAh but delivers only 40 minutes of runtime at its "high" mode is likely drawing 3–5A, where the effective capacity is closer to 2500 mAh due to high-rate discharge losses plus voltage sag dropping below the boost converter's minimum input
