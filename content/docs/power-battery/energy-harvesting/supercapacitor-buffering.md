---
title: "Supercapacitor Buffering"
weight: 30
---

# Supercapacitor Buffering

Supercapacitors bridge the gap between conventional capacitors and rechargeable batteries, offering cycle life measured in hundreds of thousands of cycles, charge and discharge rates limited only by ESR, and energy storage proportional to the square of the terminal voltage. In energy harvesting systems, supercapacitors serve as the primary storage element — absorbing energy from the harvesting IC during periods of availability and delivering it to the load during darkness, shade, or other interruptions. Unlike lithium-ion cells, supercapacitors tolerate deep discharge to 0V without damage, require no charge management IC, and introduce no fire or swelling risk. The trade-off is dramatically lower energy density: a 1F, 5.5V supercapacitor stores roughly 15 millijoules, while a 40mAh LIR2032 coin cell stores 530 joules — a 35,000:1 ratio.

Choosing between a supercapacitor and a rechargeable battery (or using both) depends on the duty cycle, the required bridge time, and the cycle life expectations of the application. Systems that need to survive minutes to hours of darkness lean toward supercapacitors; those that need to survive days lean toward batteries.

## Supercapacitor vs Battery Comparison

| Characteristic | Supercapacitor | Li-ion Battery (LIR2032) | Li-ion Battery (small pouch) |
|---------------|---------------|--------------------------|------------------------------|
| Cycle life | >500,000 cycles | 300–500 cycles | 300–500 cycles |
| Energy density | 5–10 Wh/kg | 100–200 Wh/kg | 150–250 Wh/kg |
| Self-discharge | 5–50% per day (initial) | 2–5% per month | 2–5% per month |
| Voltage range | 0V to rated max | 3.0V – 4.2V | 3.0V – 4.2V |
| Charge method | Constant voltage (current-limited) | CC-CV with termination | CC-CV with termination |
| Deep discharge damage | None | Permanent capacity loss | Permanent capacity loss |
| Temperature range | -40 to +65 deg C | 0 to 45 deg C (charge) | 0 to 45 deg C (charge) |
| Fire/swelling risk | None | Yes — requires protection IC | Yes — requires protection IC |
| Cost per joule stored | ~$0.50/J | ~$0.001/J | ~$0.0005/J |

The energy stored in a supercapacitor follows:

```
E = 1/2 * C * V^2

Where:
  E = energy in joules
  C = capacitance in farads
  V = voltage in volts

Example: 1F capacitor charged to 3.0V
  E = 0.5 * 1.0 * 3.0^2 = 4.5 J

Example: 0.47F capacitor charged to 5.5V
  E = 0.5 * 0.47 * 5.5^2 = 7.11 J
```

The V-squared relationship means that a supercapacitor at half its rated voltage holds only 25% of its full energy. This has a direct consequence for usable energy: if the downstream regulator requires a minimum of 2.0V, a 1F capacitor charged to 3.0V can only deliver energy corresponding to the voltage swing from 3.0V to 2.0V:

```
E_usable = 1/2 * C * (V_max^2 - V_min^2)
E_usable = 0.5 * 1.0 * (3.0^2 - 2.0^2)
E_usable = 0.5 * 1.0 * (9.0 - 4.0) = 2.5 J

Only 2.5J of the 4.5J total is accessible — 55.6% utilization.
```

Using a buck-boost converter downstream instead of an LDO allows extracting energy down to a lower voltage, improving utilization. A converter that operates down to 0.8V input extracts:

```
E_usable = 0.5 * 1.0 * (3.0^2 - 0.8^2) = 4.18 J — 92.9% utilization
```

## Sizing for Duty-Cycled Loads

The primary design question: how large must the supercapacitor be to sustain the system through periods without harvested energy?

```
Step 1: Calculate energy per duty cycle

  Example system: BLE sensor node
    Active phase: 15ms at 8mA (MCU + radio TX) at 3.0V = 0.36 mW*s = 0.36 mJ
    Sleep phase:  985ms at 2uA at 3.0V = 0.006 mJ
    Total per 1-second cycle: 0.366 mJ

Step 2: Calculate energy for bridge period

  Bridge 8 hours overnight (28,800 seconds):
    Cycles in 8 hours: 28,800
    Total energy: 28,800 * 0.366 mJ = 10,541 mJ = 10.54 J

Step 3: Calculate required capacitance

  C = 2 * E / (V_max^2 - V_min^2)

  With V_max = 3.0V, V_min = 2.0V (LDO minimum):
    C = 2 * 10.54 / (9.0 - 4.0) = 4.22 F

  With V_max = 5.0V, V_min = 1.5V (buck-boost minimum):
    C = 2 * 10.54 / (25.0 - 2.25) = 0.93 F
```

Higher storage voltage dramatically reduces required capacitance, but the supercapacitor's voltage rating and the harvesting IC's output voltage must align. Most harvesting ICs with supercapacitor targets regulate the storage voltage to 3.0V–3.6V to stay within common supercap ratings and to allow direct LDO regulation to 1.8V or 2.5V.

## Common Supercapacitor Parts

| Manufacturer | Part Number | Capacitance | Voltage | ESR | Leakage | Package |
|-------------|-------------|-------------|---------|-----|---------|---------|
| Murata | DMF3Z5R5H105M3DTA0 | 1F | 5.5V | 30 ohm | 3uA (72h) | 13.5mm dia x 5.5mm |
| Murata | DMH3Z5R5H474M3FTA0 | 0.47F | 5.5V | 50 ohm | 2uA (72h) | 11.5mm dia x 5.5mm |
| AVX BestCap | BZ015B503ZSB | 50mF | 5.5V | 2 ohm | 5uA | 15.5mm x 8.0mm |
| AVX BestCap | BZ054B104ZCB | 0.1F | 5.5V | 0.9 ohm | 5uA | 22mm x 10mm |
| Vishay/Maxwell | MAL219691109E3 | 1F | 5.5V | 30 ohm | 5uA | 21.5mm dia x 7.5mm |
| Eaton | HV0810-2R7105-R | 1F | 2.7V | 75 ohm | 2uA (72h) | 8mm dia x 10mm |
| Eaton | TV1625-3R0107-R | 100mF | 3.0V | 25 ohm | 1uA (72h) | 16mm dia x 2.5mm |
| Seiko | CPH3225A | 11mF | 3.3V | 100 ohm | 0.3uA | 3.2mm x 2.5mm x 0.9mm |

The Seiko CPH3225A is notable for its tiny SMD footprint (3.2mm x 2.5mm), making it suitable for PCB-mounted applications where coin-cell-sized supercaps are too large. At 11mF it stores only 60uJ at 3.3V — enough for a few duty cycles of an ultra-low-power MCU but not for extended bridge periods.

## Series Connection for Higher Voltage

Individual supercapacitors are typically rated at 2.7V or 5.5V. Achieving higher storage voltages requires series connection, but capacitance tolerances cause voltage imbalance:

```
Two 1F, 2.7V supercapacitors in series:
  Total voltage rating: 5.4V
  Total capacitance: 0.5F  (capacitance halves in series)
  Total energy: 0.5 * 0.5 * 5.4^2 = 7.29 J

Problem: If C1 = 0.9F and C2 = 1.1F (within 20% tolerance):
  Applied voltage distributes inversely proportional to capacitance
  V1 = V_total * C2 / (C1 + C2) = 5.4 * 1.1 / 2.0 = 2.97V
  V2 = V_total * C1 / (C1 + C2) = 5.4 * 0.9 / 2.0 = 2.43V

  C1 exceeds its 2.7V rating — accelerated degradation or failure.
```

Balancing resistors in parallel with each cell equalize the voltage distribution:

```
Passive balancing with resistors:
  R_balance across each cell: 100k to 1M ohm

  For R = 470k ohm, V_cell = 2.7V:
    I_balance = 2.7V / 470k = 5.7uA per cell
    Total balancing loss = 2 * 5.7uA * 2.7V = 30.8uW

  This continuous 31uW loss may be acceptable for outdoor solar
  systems but is significant for indoor harvesting at 50-200uW total.
```

Active balancing ICs (e.g., TI BQ33100) reduce balancing losses but add complexity and cost. For most embedded harvesting applications, staying within a single supercapacitor's voltage rating avoids the balancing problem entirely.

## Leakage Current Characterization

Supercapacitor leakage is not a fixed number — it is time-dependent, starting high after initial charge and decreasing over hours to days as the charge distribution within the porous electrode material equilibrates:

```
Typical leakage current profile for a 1F, 5.5V supercap:

Time after charge   Leakage current
-----------------   ---------------
1 minute            50uA
10 minutes          20uA
1 hour              8uA
24 hours            3uA
72 hours            1.5uA (datasheet "steady-state" value)
```

This behavior means that datasheet leakage specifications measured after 72 hours of conditioning dramatically understate the initial leakage. A 1F supercapacitor freshly charged to 3.0V may lose 50uA initially — comparable to or exceeding the load current of an ultra-low-power sensor node in sleep mode. The voltage drop from leakage alone in the first hour:

```
dV = I_leak * dt / C
dV = 20uA * 3600s / 1F = 72mV (average leakage of 20uA over 1 hour)
```

For applications where the supercapacitor is continuously topped off by the harvesting IC, steady-state leakage dominates and the initial transient is irrelevant. But for applications where the supercap is charged and then disconnected (e.g., charged during the day, powering the system overnight), the leakage during the first few hours of the dark period is significantly higher than the datasheet value suggests.

## Charge Management

Supercapacitors do not require the complex CC-CV charging algorithm of lithium-ion cells, but they do need current limiting during initial charge and voltage clamping at the rated maximum:

**Current limiting**: When a discharged supercapacitor (0V) is connected to a voltage source, the initial current equals V_source / ESR_total. A 3.0V source charging through a 30-ohm ESR supercap draws an initial 100mA — acceptable. But a 5V source through a 0.9-ohm ESR BestCap would draw 5.6A, potentially damaging the source or PCB traces. Harvesting ICs inherently limit charge current to the available harvested power (typically microamps to milliamps), so external current limiting is only needed when pre-charging from a bench supply or USB source.

**Voltage clamping**: The harvesting IC's overvoltage threshold must be set at or below the supercapacitor's voltage rating. The BQ25570's OV threshold is programmed with external resistors. Setting OV to 3.0V for a 5.5V-rated supercap provides generous margin; setting OV to 5.0V for a 5.5V-rated supercap works but leaves little headroom for threshold accuracy and transient overshoot.

```
BQ25570 configuration for supercapacitor storage at 3.0V:

  VBAT_OV = 3.0V:
    R_OV1 = 2.87M, R_OV2 = 4.22M
    VBAT_OV = 3/2 * 1.21 * (1 + 2.87/4.22) = 3.05V

  VBAT_UV = 1.8V (system minimum for 1.8V LDO):
    R_UV1 = 1.54M, R_UV2 = 5.76M
    VBAT_UV = 3/2 * 1.21 * (1 + 1.54/5.76) = 1.87V

  When VSTOR drops below VBAT_UV, VBAT_OK goes low,
  signaling the MCU to enter ultra-deep-sleep or shut down.
```

## Discharge Curves Under Load

Supercapacitor discharge behavior differs fundamentally depending on whether the load draws constant current or constant power:

**Constant current load** (e.g., LED, resistive heater):
```
V(t) = V0 - (I * t) / C

1F charged to 3.0V, discharging at 100uA:
  Time to reach 2.0V: t = C * (V0 - Vmin) / I
  t = 1.0 * (3.0 - 2.0) / 100e-6 = 10,000 seconds = 2.78 hours
```

**Constant power load** (e.g., MCU with regulator maintaining fixed output):
```
V(t) = sqrt(V0^2 - (2 * P * t) / C)

1F charged to 3.0V, discharging at 300uW constant power:
  Time to reach 2.0V: t = C * (V0^2 - Vmin^2) / (2 * P)
  t = 1.0 * (9.0 - 4.0) / (2 * 300e-6) = 8,333 seconds = 2.31 hours
```

The constant-power case discharges faster because as voltage drops, the regulator draws increasing current to maintain constant output power (P = V * I, so I increases as V decreases). This accelerating current draw is an important consideration when calculating bridge time.

## Supercapacitor as Buffer for Rechargeable Battery

In some designs, the supercapacitor does not serve as the primary storage but as a high-current buffer in front of a rechargeable battery. The battery provides long-duration energy storage (hours to days), while the supercapacitor absorbs pulse loads that would otherwise cause excessive voltage sag on the battery:

```
Topology:
  Harvesting IC --> Supercap (0.1F) --+--> Battery (LIR2032)
                                      |
                                      +--> System load

  The supercap absorbs the 8mA, 15ms TX pulse current:
    Charge drawn per pulse: 8mA * 15ms = 120uC
    Voltage sag on 0.1F cap: dV = 120uC / 0.1F = 1.2mV

  Without the supercap, the same pulse on the 40mAh LIR2032
  (200 ohm internal resistance at end of life):
    Voltage sag: 8mA * 200 ohm = 1.6V — likely below regulator dropout
```

This hybrid topology extends battery cycle life (the battery sees smooth, low-current charging from the harvesting IC rather than pulsed discharge) while the supercapacitor handles the transient current spikes.

## Tips

- Size supercapacitors for the worst-case bridge time plus a 50% margin to account for leakage, ESR losses, and capacitance degradation over the product's lifetime
- Prefer a single supercapacitor at 5.5V rating over two in series at 2.7V — the single-cap approach avoids balancing complexity and achieves higher total energy for the same footprint
- Measure actual leakage current on the chosen part at the operating voltage, not just the datasheet value — variations between manufacturers and even between lots of the same part can be 2–3x
- When pre-charging supercapacitors for testing, use a current-limited bench supply (set to 10–50mA) rather than connecting directly to 5V — the inrush current through a low-ESR cap can trip protection circuits or damage connectors

## Caveats

- **Leakage current can exceed the load current** — A 1F supercapacitor's initial leakage of 20–50uA may be larger than the 5–15uA average current of an ultra-low-power sensor node; this makes the supercapacitor the dominant power consumer during the first hours after a full charge
- **Capacitance degrades with age and temperature** — Electrolytic-based supercapacitors lose 20–30% of rated capacitance over 10 years at rated voltage and temperature; derate accordingly for long-deployment designs
- **ESR increases at low temperature** — A supercapacitor with 30 ohm ESR at 25 degrees C may show 100+ ohm ESR at -20 degrees C, increasing voltage sag under pulsed loads and reducing the effective energy delivery
- **5.5V-rated supercapacitors cannot replace 3.0V coin cells directly** — The voltage profiles are incompatible; a supercap charged to 3.0V and discharged to 2.0V has a 1V swing, whereas a CR2032 maintains 2.7–3.0V for 90% of its life; downstream regulators must tolerate the wider input range

## In Practice

- A solar-harvested temperature logger using a BQ25570, 0.47F 5.5V Murata supercap (charged to 3.6V), and an STM32L031 in stop mode at 1.2uA survives 12 hours of complete darkness before the supercap voltage drops below the 1.8V LDO minimum — marginal for overnight operation in temperate climates but insufficient for winter nights at high latitudes
- A BLE asset tracker using a 1F supercap and a 50mm x 50mm indoor solar panel transmits a beacon every 30 seconds during office hours but finds the supercap fully depleted every Monday morning — the 60-hour weekend bridge time requires 4.7F or a small LIR2032 backup battery
- A vibration sensor on an industrial motor uses a 0.1F supercap as a pulse buffer in front of a 50mAh LiPo — the motor's vibration-harvesting piezo provides only 100uW average, but the supercap delivers the 20mA, 10ms burst needed for a Zigbee transmission without sagging the LiPo
- A prototype that works on the bench with a new supercapacitor fails in the field after 18 months because the capacitor was operated at 95% of its voltage rating continuously, accelerating electrolyte degradation and reducing effective capacitance by 35% — operating at 70–80% of rated voltage significantly extends service life
