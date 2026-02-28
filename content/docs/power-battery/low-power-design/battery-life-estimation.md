---
title: "Battery Life Estimation"
weight: 40
---

# Battery Life Estimation

Predicting battery life requires more than dividing capacity by current. A CR2032 coin cell rated at 230 mAh does not deliver 230 mA for one hour — it delivers 230 mAh only under specific conditions (typically 15 kΩ load to 2.0 V cutoff at 23°C). At higher loads, lower temperatures, or higher cutoff voltages, the usable capacity drops significantly. Accurate estimation integrates the measured current profile over the full duty cycle, accounts for self-discharge, derates for temperature and aging, and applies safety margins for production variance. The result is a prediction within 10–20% of real-world runtime — close enough to make informed battery sizing decisions.

## Weighted Average Current Calculation

The fundamental formula for average current over a repeating duty cycle:

```
I_avg = (I_sleep * t_sleep + I_active * t_active + I_tx * t_tx + ...) / T_cycle
```

Where `T_cycle = t_sleep + t_active + t_tx + ...` is the total cycle period.

### Worked Example: BLE Sensor Node on nRF52840

A temperature sensor that wakes every 60 seconds, reads an I2C sensor, and transmits one BLE advertisement:

| Phase | Current | Duration | Charge per Cycle |
|-------|---------|----------|-----------------|
| Deep sleep (System ON idle) | 1.5 µA | 59.988 s | 24.995 µAh / 3600 = 0.0250 µAh |
| Wake + clock init | 5 mA | 0.5 ms | 0.000694 µAh |
| I2C sensor read (TMP117) | 1.8 mA | 3 ms | 0.00150 µAh |
| BLE advertising (3 channels) | 8.5 mA | 3.6 ms | 0.00850 µAh |
| Data processing + GATT update | 4.2 mA | 1.5 ms | 0.00175 µAh |
| GPIO + peripheral shutdown | 2.0 mA | 0.4 ms | 0.000222 µAh |
| **Total per cycle** | | **60.0 s** | **0.03747 µAh** |

Average current: 0.03747 µAh / (60 / 3600 h) = **2.25 µA**

With a 230 mAh CR2032: 230 / 0.00225 = **102,222 hours = 11.7 years** (theoretical maximum).

This number is wildly optimistic because it ignores self-discharge, capacity derating, and the battery's inability to sustain the 8.5 mA TX peaks at end-of-life.

## Self-Discharge Rates

All batteries self-discharge, even with no connected load. The rate depends on chemistry:

| Cell Type | Chemistry | Typical Self-Discharge | Annual Capacity Loss |
|-----------|-----------|----------------------|---------------------|
| CR2032 | Lithium MnO2 | 1–2% / year | 2.3–4.6 mAh / year |
| LR44 / AG13 | Alkaline | 5–10% / year | 7.5–15 mAh / year |
| AA (Energizer L91) | Lithium FeS2 | 1% / year | 30 mAh / year |
| AA (Duracell) | Alkaline | 5–8% / year | 140–230 mAh / year |
| 18650 (Samsung 30Q) | Li-ion | 2–3% / month | ~900 mAh / year |
| LIR2032 | Rechargeable Li | 5–10% / month | — |
| ER14505 (AA Lithium) | Li-SOCl2 | < 1% / year | < 25 mAh / year |

For a 5-year deployment on CR2032, self-discharge alone consumes 12–23 mAh (5–10% of rated capacity). Lithium thionyl chloride (Li-SOCl2) cells like the ER14505 (2.4 Ah, 3.6 V) are specifically designed for multi-year deployments, with self-discharge under 1% per year.

### Passivation in Li-SOCl2 Cells

Li-SOCl2 cells (e.g., Tadiran TL-5903, SAFT LS14500) develop a passivation layer on the lithium anode during extended storage or very low-drain operation. This layer creates a temporary voltage dip when load is first applied — the open-circuit voltage of 3.67 V can sag to 2.5 V or lower for 100 ms to several seconds under a sudden 10 mA load. This can cause a brownout reset on a 3.3 V MCU. Mitigation involves a brief high-drain pulse at initialization or a small ceramic capacitor (100 µF) to bridge the voltage sag.

## Capacity Derating

### Temperature Effects

Battery capacity decreases at temperature extremes. Manufacturers typically rate at 23°C:

| Cell Type | 0°C | -10°C | -20°C | -40°C |
|-----------|-----|-------|-------|-------|
| CR2032 (Energizer) | 85% | 70% | 50% | 20% |
| AA Alkaline | 80% | 60% | 40% | ~0% |
| AA Lithium (L91) | 95% | 90% | 85% | 70% |
| Li-SOCl2 (ER14505) | 90% | 80% | 70% | 50% |
| 18650 Li-ion | 90% | 75% | 55% | 20% |

For an outdoor deployment in a Nordic climate where winter temperatures reach -20°C, a CR2032 delivers only ~115 mAh of its rated 230 mAh — halving the expected battery life.

### Aging and Cycle Effects

For rechargeable cells, capacity degrades with charge cycles:

- **18650 Li-ion** — Typically retains 80% capacity after 300–500 full cycles (depending on charge/discharge rates and temperature)
- **LiPo pouch cells** — Similar to 18650, but more sensitive to high-temperature aging; a cell at 45°C loses capacity 2–3x faster than one at 25°C
- **LIR2032 rechargeable coin cells** — Rated at 40 mAh nominal, these typically retain 80% (32 mAh) after 100 cycles

### Pulse Load Derating

High-current pulses reduce effective capacity on high-impedance cells. A CR2032 has an internal resistance of 10–30 Ω (increasing with discharge). Drawing 15 mA for a BLE TX burst produces a voltage drop of 150–450 mV across the internal resistance:

```
V_terminal = V_cell - I_load * R_internal
V_terminal = 3.0 V - 0.015 A * 25 Ω = 2.625 V
```

If the MCU's brown-out detection (BOR) is set at 2.7 V, the device may reset during TX even though the cell has substantial remaining capacity. Near end-of-life (when V_cell drops to 2.8 V):

```
V_terminal = 2.8 V - 0.015 A * 35 Ω = 2.275 V  ← MCU resets
```

The cell still has ~15% capacity remaining, but it is unusable because the terminal voltage during pulse loads falls below the MCU's minimum operating voltage. This "early cutoff" effect can reduce usable capacity by 10–20% on coin cells with high-current loads.

## Battery Life Formula with Derating

The complete battery life estimation:

```
                    C_rated * K_temp * K_age * K_pulse * K_margin
Life (hours)  =  ──────────────────────────────────────────────────
                         I_avg + I_self_discharge
```

Where:
- `C_rated` = Manufacturer's rated capacity (mAh)
- `K_temp` = Temperature derating factor (0.0 – 1.0)
- `K_age` = Aging/cycle derating factor (0.0 – 1.0)
- `K_pulse` = Pulse load derating factor — accounts for unusable capacity below BOR (0.0 – 1.0)
- `K_margin` = Design margin factor, typically 0.8 for production (0.0 – 1.0)
- `I_avg` = Weighted average current from duty cycle analysis (mA)
- `I_self_discharge` = Self-discharge current equivalent (mA)

### Worked Example with Full Derating

Continuing the BLE sensor node example:

- **Battery**: CR2032, 230 mAh rated
- **Environment**: Indoor, 10–35°C range → K_temp = 0.95
- **Aging**: Primary cell, no cycles → K_age = 1.0
- **Pulse load**: 8.5 mA TX through 20 Ω internal resistance → 170 mV sag → K_pulse = 0.90 (10% unusable near end-of-life)
- **Design margin**: K_margin = 0.80 (20% margin for production variance)
- **Average current**: 2.25 µA (from earlier calculation)
- **Self-discharge**: 1.5% / year = 230 * 0.015 / 8766 hours = 0.000394 mA = 0.394 µA equivalent

```
                230 * 0.95 * 1.0 * 0.90 * 0.80
Life (hours)  = ────────────────────────────────
                   0.00225 + 0.000394

             = 157.32 / 0.002644

             = 59,515 hours = 6.8 years
```

Compared to the naive 11.7 years, the derated estimate of 6.8 years is 42% lower — and far closer to real-world performance.

## Voltage-Dependent Efficiency Losses

Many battery-powered designs use a voltage regulator between the cell and the MCU. The regulator's efficiency directly impacts battery life:

### Boost Converter from Single-Cell

A single-cell LiPo (3.0–4.2 V) powering a 3.3 V MCU through a buck-boost converter (e.g., TPS63001):

```
I_battery = (I_mcu * V_mcu) / (V_battery * η)
```

At 85% efficiency and V_battery = 3.7 V (nominal):

```
I_battery = (0.00225 mA * 3.3 V) / (3.7 V * 0.85)
          = 0.00743 / 3.145
          = 0.00236 mA
```

The efficiency penalty at 2.25 µA load is minimal because the TPS63001's quiescent current (50 µA typical) dominates:

```
I_battery_actual = I_quiescent + I_load / η
                 = 0.050 mA + 0.00225 / 0.85
                 = 0.050 + 0.00265
                 = 0.0526 mA = 52.6 µA
```

The regulator's 50 µA quiescent current is 23x the MCU's sleep current. For ultra-low-power designs, either eliminate the regulator (run directly from the cell when voltage range permits) or select a regulator with sub-microamp quiescent current, such as the TPS62840 (60 nA IQ).

### Direct Battery Connection

Running an nRF52840 directly from a CR2032 (2.0–3.0 V operating range, MCU minimum 1.7 V) eliminates regulator losses entirely. The nRF52840's internal DC-DC converter can be enabled for the digital core, reducing active-mode current by ~20% compared to the internal LDO:

```c
#include "nrf_power.h"

/* Enable internal DC-DC for REG0 (main regulator) */
NRF_POWER->DCDCEN = POWER_DCDCEN_DCDCEN_Enabled << POWER_DCDCEN_DCDCEN_Pos;
```

## Spreadsheet / Calculator Approach

A structured spreadsheet captures the full estimation in one place:

| Row | Parameter | Value | Unit | Source |
|-----|-----------|-------|------|--------|
| 1 | Battery capacity (rated) | 230 | mAh | Datasheet |
| 2 | Temperature derating | 0.95 | — | Datasheet curve at 10°C |
| 3 | Aging derating | 1.00 | — | Primary cell |
| 4 | Pulse derating | 0.90 | — | BOR analysis |
| 5 | Design margin | 0.80 | — | Production safety factor |
| 6 | **Effective capacity** | **157.3** | **mAh** | Row 1 * 2 * 3 * 4 * 5 |
| | | | | |
| 7 | Sleep current | 1.5 | µA | PPK2 measured |
| 8 | Sleep duration | 59.988 | s | Design parameter |
| 9 | Active current | 4.0 | mA | PPK2 measured |
| 10 | Active duration | 9.0 | ms | PPK2 measured |
| 11 | TX current | 8.5 | mA | PPK2 measured |
| 12 | TX duration | 3.6 | ms | PPK2 measured |
| 13 | Cycle period | 60.0 | s | Sum of durations |
| 14 | **Avg current (load)** | **2.25** | **µA** | Weighted average |
| | | | | |
| 15 | Self-discharge rate | 1.5 | %/year | Datasheet |
| 16 | Self-discharge equivalent | 0.39 | µA | C_rated * rate / 8766 |
| 17 | Regulator IQ | 0.06 | µA | TPS62840 datasheet |
| 18 | **Total avg current** | **2.70** | **µA** | Row 14 + 16 + 17 |
| | | | | |
| 19 | **Battery life** | **58,222** | **hours** | Row 6 / Row 18 |
| 20 | **Battery life** | **6.6** | **years** | Row 19 / 8766 |

This spreadsheet structure makes it straightforward to adjust individual parameters and see the impact. Changing the wake interval from 60 seconds to 120 seconds roughly halves the active/TX contribution, reducing average current to ~1.7 µA and extending life to ~8.5 years.

## Margin Factors for Production Variance

The 0.80 design margin factor accounts for multiple real-world uncertainties:

| Uncertainty Source | Typical Range | Contribution to Margin |
|-------------------|---------------|----------------------|
| Battery capacity tolerance | ±5–10% (cell to cell) | 5% |
| MCU sleep current variation | ±20–50% (lot to lot) | 3% |
| Crystal oscillator accuracy | ±20 ppm → timer drift | 1% |
| Component leakage (PCB, caps) | 0.1–2 µA (depends on cleanliness) | 5% |
| Firmware edge cases (retries, error handling) | +10–50% active time | 5% |
| Environmental (humidity, contamination) | +0.5–5 µA leakage | 3% |

The combined effect is a 15–25% reduction from theoretical life, which a 0.80 factor (20% margin) covers for most designs. Safety-critical or remote-deployment applications (where battery replacement is expensive) may use 0.65–0.70.

### PCB Leakage

PCB surface contamination — flux residue, humidity absorption, dust — creates resistive paths between traces that leak current. Between a 3.3 V trace and ground with 10 MΩ of contamination resistance:

```
I_leak = V / R = 3.3 V / 10 MΩ = 0.33 µA
```

Multiple contaminated trace pairs compound this. A board with four such leakage paths draws 1.3 µA from the PCB alone — comparable to the MCU's sleep current. Conformal coating and thorough flux cleaning reduce PCB leakage to the low nanoamp range.

## Comparing Battery Options

For a device requiring 5 µA average current with 3-year minimum life:

Required capacity (with 0.80 margin): 5 µA * 8766 h/yr * 3 yr / 0.80 = 164 mAh

| Cell | Chemistry | Capacity | Volume | Weight | Voltage | Viable? |
|------|-----------|----------|--------|--------|---------|---------|
| CR2032 | Li/MnO2 | 230 mAh | 0.67 cm³ | 3.0 g | 3.0 V | Yes (marginal) |
| CR2450 | Li/MnO2 | 620 mAh | 1.57 cm³ | 6.9 g | 3.0 V | Yes (comfortable) |
| CR123A | Li/MnO2 | 1500 mAh | 5.3 cm³ | 17 g | 3.0 V | Yes (oversize) |
| ER14505 | Li/SOCl2 | 2400 mAh | 8.3 cm³ | 19 g | 3.6 V | Yes (overkill, best for >5 yr) |
| 2x AAA | Alkaline | 1200 mAh | 7.6 cm³ | 23 g | 3.0 V (series) | Risky (self-discharge) |
| LIR2032 | Li-ion | 40 mAh | 0.67 cm³ | 3.0 g | 3.7 V | No (insufficient capacity) |

The CR2032 provides 230 mAh versus the 164 mAh requirement — a 40% margin that might not survive 3 years of self-discharge (losing ~10 mAh/year). The CR2450 at 620 mAh gives 3.8x the required capacity and is the more conservative choice.

## Tips

- Always use measured current profiles from the PPK2 or Otii Arc as inputs — datasheet typical values underestimate real-world consumption because they exclude I2C pull-up current, voltage regulator quiescent draw, and PCB leakage
- Model the duty cycle in a spreadsheet with separate rows for each firmware phase — this makes it trivial to see which phase dominates the power budget and where optimization effort should focus
- For coin cell designs, verify that the peak current does not cause voltage sag below the MCU's BOR threshold — simulate this by measuring terminal voltage under load at 50% remaining capacity, not just on a fresh cell
- Include regulator quiescent current in the calculation even when it seems negligible — a 50 µA IQ regulator powering a 2 µA sleep-mode MCU increases total sleep current by 25x
- For multi-year deployments, use Li-SOCl2 chemistry (ER14505 or similar) — the sub-1% annual self-discharge rate preserves capacity far better than alkaline or standard lithium coin cells

## Caveats

- **CR2032 internal resistance increases with discharge** — A fresh cell has ~10 Ω, but near end-of-life this rises to 30–50 Ω, causing greater voltage sag under pulse loads and earlier effective cutoff than the capacity calculation predicts
- **Alkaline self-discharge makes multi-year predictions unreliable** — A pair of AA alkalines rated at 2800 mAh loses 400–800 mAh to self-discharge over 3 years, making them unsuitable for deployments longer than 18–24 months even at very low average current
- **Datasheet sleep currents are measured at 25°C with no external loads** — Real designs include pull-up resistors, voltage dividers, LED indicators, and sensor quiescent currents that collectively add 1–10 µA to the sleep baseline
- **Li-SOCl2 passivation voltage dip can brownout an MCU** — After months of storage or very low-drain operation, the initial load pulse may sag below 2.5 V for hundreds of milliseconds, requiring either a depassivation circuit or a bulk capacitor to sustain the MCU through the transient
- **Rechargeable coin cells (LIR2032) have very low capacity** — At 40 mAh, a LIR2032 provides only 17% of a CR2032's capacity and cannot sustain multi-month operation for most sensor node applications, despite being physically identical in size

## In Practice

- A LoRaWAN soil moisture sensor designed for 2-year life on a CR2450 was deployed in an agricultural field; after 14 months the devices started dropping offline — the root cause was winter temperatures reaching -15°C, derating the CR2450 to ~60% capacity and combining with higher-than-modeled retry rates during poor LoRa signal conditions to exhaust the cell 10 months early; switching to ER14505 (Li-SOCl2) cells and adding a retry budget cap in firmware extended deployment life to 4+ years
- A consumer BLE tracker estimated at 12 months on CR2032 achieved only 7 months in production — the 5-month shortfall traced to three factors: the BLE advertising interval was 200 ms instead of the designed 1000 ms (firmware bug after OTA update), PCB leakage from unclean flux added 0.8 µA, and 10% of cells from one supplier delivered only 190 mAh
- A battery life calculator that used datasheet typical sleep current (0.7 µA for nRF52840) predicted 5.2 years on CR2032, but PPK2 measurement of the actual board showed 3.8 µA sleep current due to an I2C pull-up to VCC through a 10 kΩ resistor (330 µA) plus the accelerometer's always-on quiescent current (3.0 µA) — the real battery life was 9 months
- An industrial IoT gateway powered by 4x AA lithium (Energizer L91) cells estimated 3 years of operation transmitting cellular data every 15 minutes; the design used a 0.75 margin factor and included a 220 µF capacitor across VCC to handle the cellular module's 2A TX bursts without sagging below 2.8 V — after 30 months of field deployment, remaining capacity measurements showed 18% remaining, tracking within 5% of the spreadsheet prediction
