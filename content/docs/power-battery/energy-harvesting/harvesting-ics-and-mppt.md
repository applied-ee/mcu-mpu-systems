---
title: "Harvesting ICs & MPPT"
weight: 20
---

# Harvesting ICs & MPPT

Energy harvesting ICs sit between the transducer (solar cell, TEG, piezo element) and the storage element (supercapacitor or battery), performing three critical functions: maximum power point tracking to extract the most energy from the source, voltage conversion to match the storage element's requirements, and power path management to protect the storage element from overcharge and undercharge. The distinction between a generic boost converter and a harvesting IC lies in the ability to operate from microwatt-level inputs, cold-start from sub-volt sources, and consume nanoamp-level quiescent current when no harvestable energy is available.

The central challenge is that microwatt-level sources have very low available power and operate at voltages below what most DC-DC converters can handle. A 50mm x 50mm solar panel indoors might deliver 80uW at 1.8V. A thermoelectric generator across a 5 degree C gradient might produce 30mV at 2mA. Harvesting ICs must boost these inputs to usable voltages (3.0V–4.2V) while consuming only a fraction of the harvested power in their own overhead.

## Maximum Power Point Tracking Principle

A solar cell (or any energy transducer) delivers maximum power at a specific point on its I-V curve where the product V x I is maximized. This is the maximum power point (MPP). Operating below Vmpp wastes available voltage; operating above Vmpp causes current to collapse as the cell approaches Voc.

```
Example I-V curve data (50mm x 50mm panel, 1000 lux):

  V (mV)   I (uA)   P (uW)
  ------   ------   ------
     0      520       0
   200      510     102
   400      490     196
   600      470     282
   800      440     352
  1000      400     400    <-- near MPP
  1100      360     396
  1200      290     348
  1300      180     234
  1400       60      84
  1480        0       0    (Voc)

Vmpp ~ 1000mV, Impp ~ 400uA, Pmax ~ 400uW
Voc = 1480mV, so Vmpp/Voc = 0.676 (~68%)
```

Without MPPT, a direct connection to a storage element forces the panel to operate at whatever voltage the storage element presents. A 3.0V supercapacitor connected directly to a panel with 1.48V Voc would result in zero power transfer — the panel cannot drive current into a higher voltage. Even with a boost converter, the input operating point must be controlled to stay near Vmpp.

## Fractional Open-Circuit Voltage MPPT

The most common MPPT algorithm in nano-power harvesting ICs is fractional open-circuit voltage (fractional Voc). The principle: Vmpp is approximately a fixed fraction of Voc for a given cell technology and temperature. For crystalline silicon, Vmpp is typically 76–82% of Voc. For amorphous silicon, it is closer to 68–75%.

The algorithm proceeds as follows:

1. Periodically disconnect the load from the panel (every 16 seconds on the BQ25570)
2. Measure the open-circuit voltage Voc with no current flowing
3. Set the target input operating voltage to MPPT_ratio x Voc
4. Regulate the boost converter's input impedance to maintain this target voltage
5. Repeat at the next sampling interval

```
BQ25570 MPPT ratio configuration:

The MPPT ratio is set by a resistor divider on the VOC_SAMP pin:

  MPPT_ratio = R_OC2 / (R_OC1 + R_OC2)

For 80% MPPT ratio (typical for crystalline Si):
  R_OC1 = 1.0M ohm
  R_OC2 = 4.02M ohm
  Ratio = 4.02 / (1.0 + 4.02) = 0.801

For 70% MPPT ratio (better for amorphous Si or TEGs):
  R_OC1 = 1.62M ohm
  R_OC2 = 3.65M ohm
  Ratio = 3.65 / (1.62 + 3.65) = 0.693

During the Voc sampling period (~256ms), no energy is harvested.
At a 16-second interval, this represents 1.6% duty cycle loss.
```

The fractional Voc method is not true MPP tracking — it assumes a fixed ratio that may not hold across all illumination levels, temperatures, and cell aging states. At very low light, the actual Vmpp/Voc ratio can shift by 5–10%. Despite this limitation, fractional Voc achieves 90–97% of the theoretical maximum power extraction in most practical conditions, with near-zero computational overhead.

## BQ25570: Nano-Power Boost Charger

The Texas Instruments BQ25570 is the most widely used harvesting IC for solar and thermal energy sources in embedded systems. Key specifications:

| Parameter | Value |
|-----------|-------|
| Cold start input voltage | 330mV (typical), 600mV (guaranteed) |
| Cold start minimum power | 15uW at 330mV input |
| Operating input voltage | 100mV – 5.1V |
| Quiescent current (Iq) | 488nA typical (main boost off, Vbat in regulation) |
| Boost converter efficiency | 80–93% depending on Vin and Iout |
| MPPT sampling interval | 16 seconds |
| MPPT ratio range | 50% – 90% (resistor-programmable) |
| Output voltage range | 2.0V – 5.5V (battery), programmable VOUT_SET |
| Battery overvoltage threshold | Programmable via resistor divider (OV) |
| Battery undervoltage threshold | Programmable via resistor divider (UV) |
| Package | QFN-20, 3.5mm x 3.5mm |

Functional block diagram of the BQ25570 power path:

```
                         VBAT
  Solar   ┌──────────┐   │    ┌──────────┐
  Panel──>│  Boost   │───┼───>│  Buck    │──> VOUT (regulated)
          │Converter │   │    │Converter │    (1.8V/2.5V/3.3V)
          └──────────┘   │    └──────────┘
               ^         │         ^
               │         v         │
            MPPT      Storage    VOUT_EN
           Control   (supercap   (VBAT_OK
                     or LiPo)    threshold)
```

The BQ25570 operates in two phases. During cold start, an internal charge pump bootstraps from as little as 330mV using the nano-power starter circuit — but this circuit can only supply a few microamps, so it requires at least 15uW of input power. Once VSTOR (the internal storage node) reaches approximately 1.8V, the main boost converter takes over with significantly higher efficiency and lower minimum input voltage (100mV). The VBAT_OK output signals the system MCU that sufficient energy is stored to perform useful work.

### BQ25570 External Configuration

```
Key external resistor dividers:

1. MPPT Ratio (VOC_SAMP pin):
   R_OC1 (top) and R_OC2 (bottom)
   Ratio = R_OC2 / (R_OC1 + R_OC2)
   Recommended values: 1M-10M range to minimize current draw

2. Overvoltage threshold (VBAT_OV):
   R_OV1 (top) and R_OV2 (bottom)
   VBAT_OV = 3/2 * VBIAS * (1 + R_OV1/R_OV2)
   VBIAS = 1.21V internal reference

   For 4.2V OV (LiPo battery):
     R_OV1 = 5.76M, R_OV2 = 4.22M
     VBAT_OV = 3/2 * 1.21 * (1 + 5.76/4.22) = 4.29V

   For 3.0V OV (supercapacitor):
     R_OV1 = 3.01M, R_OV2 = 4.22M
     VBAT_OV = 3/2 * 1.21 * (1 + 3.01/4.22) = 3.11V

3. Undervoltage threshold (VBAT_UV):
   R_UV1 (top) and R_UV2 (bottom)
   VBAT_UV = 3/2 * VBIAS * (1 + R_UV1/R_UV2)

   For 2.2V UV:
     R_UV1 = 2.26M, R_UV2 = 5.76M

4. VOUT regulated voltage:
   R_OUT1 (top) and R_OUT2 (bottom)
   VOUT = 1/2 * VBIAS * (1 + R_OUT1/R_OUT2)
```

## AEM10941: Multi-Source Harvester

The e-peas AEM10941 targets multi-source harvesting with dual regulated outputs and an extremely low cold-start power requirement:

| Parameter | Value |
|-----------|-------|
| Cold start input voltage | 380mV (typical) |
| Cold start minimum power | 3uW (significantly lower than BQ25570) |
| Operating input voltage | 50mV – 5.0V |
| Quiescent current | 250nA typical |
| Boost converter efficiency | 85–95% |
| MPPT sampling interval | 5 seconds |
| MPPT ratio | Configurable: 50%, 70%, 80%, 90% (pin-selectable) |
| Outputs | Dual LDO: 1.2V–3.3V each, programmable |
| Battery protection | OV, UV, overtemperature |
| Package | QFN-28, 5mm x 5mm |

The AEM10941's key advantage over the BQ25570 is its 3uW cold-start capability, making it viable for the dimmest indoor environments where a small panel might produce only 5–10uW. The dual regulated outputs eliminate the need for external LDOs in systems that require two supply rails (e.g., 1.8V for the MCU core and 3.3V for the radio). The MPPT ratio is pin-selectable rather than resistor-programmable, simplifying the BOM but limiting fine-tuning to four preset values.

## SPV1050: Ultra-Low-Power Harvester with Integrated LDOs

The STMicroelectronics SPV1050 integrates both a boost and buck converter path, making it suitable for sources with a wide voltage range:

| Parameter | Value |
|-----------|-------|
| Input voltage range | 150mV – 18V |
| Cold start input voltage | 550mV (typical) |
| Quiescent current | 800nA typical |
| Boost converter efficiency | 80–90% |
| MPPT | Fractional Voc, resistor-programmable |
| Outputs | Two integrated LDOs (1.8V and 3.3V typical) |
| Battery protection | OV, UV programmable |
| End-of-charge current detection | Yes |
| Package | QFN-20, 4mm x 4mm |

The SPV1050's 18V maximum input voltage allows direct connection to series-wired solar panel strings or piezoelectric transducers that generate high-voltage pulses. The integrated end-of-charge detection makes it suitable for direct lithium-ion battery charging without additional charge management circuitry. Its higher quiescent current (800nA vs 488nA for BQ25570) makes it less suitable for the absolute lowest power applications.

## Harvesting IC Comparison

| Feature | BQ25570 | AEM10941 | SPV1050 | MAX20361 |
|---------|---------|----------|---------|----------|
| Manufacturer | Texas Instruments | e-peas | STMicroelectronics | Analog Devices |
| Min operating Vin | 100mV | 50mV | 150mV | 225mV |
| Cold start Vin | 330mV | 380mV | 550mV | 750mV |
| Cold start power | 15uW | 3uW | ~50uW | ~100uW |
| Iq (no harvest) | 488nA | 250nA | 800nA | 360nA |
| Max Vin | 5.1V | 5.0V | 18V | 5.5V |
| MPPT method | Fractional Voc | Fractional Voc | Fractional Voc | Fractional Voc |
| MPPT ratio config | Resistor divider | Pin-select (4 values) | Resistor divider | Resistor divider |
| Regulated output | 1 buck | 2 LDOs | 2 LDOs | 1 buck |
| Battery protection | OV + UV | OV + UV + OT | OV + UV + EOC | OV + UV |
| Package size | 3.5x3.5mm | 5x5mm | 4x4mm | 2.1x1.6mm WLP |
| Approx unit cost | $3.50 | $4.50 | $3.00 | $2.80 |

## Cold Start Requirements

Cold start is the most fragile phase of a harvesting system. The harvesting IC must bootstrap its internal circuitry from the input source alone, with no energy in the storage element. This typically requires a minimum input voltage (300–750mV) and a minimum input power (3–100uW) simultaneously.

```
Cold start scenarios:

Scenario 1: BQ25570 with 50mm x 50mm panel indoors (200 lux)
  Panel Voc at 200 lux: ~1.5V  (above 330mV cold start threshold)
  Panel Pmax at 200 lux: ~80uW (above 15uW cold start minimum)
  Result: Cold start succeeds in 100-500ms

Scenario 2: BQ25570 with 25mm x 25mm amorphous panel (200 lux)
  Panel Voc at 200 lux: ~1.0V  (above 330mV threshold)
  Panel Pmax at 200 lux: ~10uW (BELOW 15uW cold start minimum)
  Result: Cold start FAILS — insufficient power despite adequate voltage

Scenario 3: AEM10941 with same 25mm x 25mm panel (200 lux)
  Panel Voc at 200 lux: ~1.0V  (above 380mV threshold)
  Panel Pmax at 200 lux: ~10uW (above 3uW cold start minimum)
  Result: Cold start succeeds (may take several seconds)

Scenario 4: BQ25570 with TEG at 2 deg C gradient
  TEG Voc at 2 deg C: ~40mV   (BELOW 330mV threshold)
  Result: Cold start FAILS — voltage too low regardless of power
  Solution: Add an auxiliary battery or pre-charge VSTOR
```

For applications where cold-start conditions are marginal, a small backup battery (CR2032 or LIR2032) can pre-charge the storage node through a Schottky diode, allowing the main boost converter to start immediately. Once the storage element is charged, the harvesting IC maintains it indefinitely without drawing from the backup cell.

## MPPT Ratio Selection

Choosing the correct MPPT ratio depends on the energy source type:

| Source Type | Typical Vmpp/Voc | Recommended MPPT Ratio |
|-------------|------------------|------------------------|
| Monocrystalline Si solar cell | 78–82% | 80% |
| Amorphous Si solar cell | 68–75% | 70% |
| Thermoelectric generator (TEG) | 48–52% | 50% |
| Piezoelectric transducer | Varies widely | 70–80% |
| GaAs solar cell | 82–88% | 85–90% |

Setting the MPPT ratio incorrectly costs efficiency. A crystalline Si panel operating at 70% of Voc instead of 80% will harvest approximately 5–10% less power than optimal. A TEG operating at 80% of Voc instead of 50% will harvest 20–40% less power, since the TEG's internal resistance is much higher relative to the load and the I-V curve is more linear.

## Tips

- Begin harvester IC selection by identifying the worst-case input conditions (minimum illumination, minimum temperature gradient) and verifying that cold-start requirements are met — a harvester that cannot cold-start is useless regardless of its steady-state efficiency
- Use the BQ25570EVM-206 evaluation module for rapid prototyping; it includes all external resistors pre-populated for a LiPo battery target and an 80% MPPT ratio, with test points at every critical node
- Place the MPPT sampling resistors as close to the IC as possible and route them away from switching nodes to prevent noise coupling during the Voc measurement phase
- Add a 4.7uF–10uF ceramic capacitor at the harvester input (VIN to GND) to reduce switching ripple reflected back to the panel and improve MPPT accuracy

## Caveats

- **Cold-start voltage and cold-start power are independent requirements** — Meeting the minimum voltage does not guarantee cold start if the available power is below the threshold; both conditions must be satisfied simultaneously
- **MPPT sampling causes periodic output interruption** — During the 256ms Voc sampling window on the BQ25570, no energy is harvested; at very low input power levels, this 1.6% duty cycle loss is negligible, but it can cause audible noise on sensitive analog circuits connected to the output
- **Quiescent current matters most when there is no input** — The BQ25570 draws 488nA continuously from the storage element even in complete darkness; over 24 hours, this is 0.488uA x 24h = 11.7uAh, which drains a 1F supercapacitor charged to 3V by approximately 42mV
- **High-value external resistors are noise-sensitive** — The megohm-range resistors used for MPPT ratio and threshold programming pick up noise readily; guard traces and careful layout are essential for reliable threshold accuracy

## In Practice

- A solar-harvested BLE beacon using a BQ25570 and a 53mm x 30mm Panasonic AM-1417CA panel operates indefinitely at 1-second advertising intervals in a 300 lux office, but fails to cold-start after a long weekend with lights off — adding a LIR2032 backup cell through a Schottky diode to VSTOR solves the cold-start problem while the solar panel maintains the supercapacitor during normal operating hours
- A thermoelectric harvesting system using a BQ25570 with a 40mm x 40mm Bismuth Telluride TEG across a 10 degree C gradient produces approximately 4mW but required changing the MPPT ratio from 80% (default) to 50% to match the TEG's linear I-V characteristic — the 80% setting was operating too close to Voc and extracting only 40% of available power
- A multi-source harvesting design using the AEM10941 switches between a solar panel and a TEG depending on which source is available, leveraging the IC's ability to operate from 50mV input — the indoor solar panel provides power during daytime office hours while the TEG harvests from HVAC duct temperature differentials at night
- A prototype that works perfectly on the bench but fails in the field often traces to the MPPT ratio being optimized for the bench lamp's spectrum rather than the deployment location's lighting — characterizing the panel at the actual deployment site, or using a conservative 70% MPPT ratio, avoids this mismatch
