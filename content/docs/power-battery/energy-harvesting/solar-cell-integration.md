---
title: "Solar Cell Integration"
weight: 10
---

# Solar Cell Integration

Small solar panels — ranging from thumbnail-sized 25mm x 25mm indoor cells to 100mm x 150mm outdoor modules — serve as the primary energy source for most harvesting-powered embedded systems. Unlike utility-scale photovoltaics where peak wattage dominates the specification, embedded solar integration revolves around matching the panel's output voltage and current to the input requirements of a harvesting IC under the actual illumination conditions the product will encounter. A panel that delivers 200mW under full sun may produce only 200uW under office lighting, a 1000:1 reduction that changes every design decision downstream.

The fundamental parameters — open-circuit voltage (Voc), short-circuit current (Isc), maximum power point voltage (Vmpp), and fill factor — characterize the electrical behavior of the cell. Understanding how these shift with illumination level, temperature, and panel aging determines whether a given panel can sustain a sensor node indefinitely or only during peak daylight hours.

## Panel Electrical Parameters

Every solar cell has four key parameters that define its electrical output at a given illumination and temperature:

| Parameter | Symbol | Description | Measurement Condition |
|-----------|--------|-------------|-----------------------|
| Open-circuit voltage | Voc | Terminal voltage with no load attached | Zero current draw |
| Short-circuit current | Isc | Current flowing when terminals are shorted | Zero terminal voltage |
| Max power point voltage | Vmpp | Voltage at which V x I is maximized | Load adjusted for peak power |
| Max power point current | Impp | Current at which V x I is maximized | Load adjusted for peak power |
| Fill factor | FF | Ratio of (Vmpp x Impp) / (Voc x Isc) | Derived from I-V curve |

Fill factor quantifies how "square" the I-V curve is. Ideal cells approach FF = 0.85; real small panels typically achieve 0.55 to 0.75 depending on cell technology and interconnect losses. A low fill factor indicates high series resistance, shunt resistance losses, or poor cell matching in a multi-cell panel.

## Common Small Panel Specifications

Panels commonly used in embedded energy harvesting range from coin-sized indoor cells to hand-sized outdoor modules:

| Panel Size | Cell Type | Voc (1 sun) | Isc (1 sun) | Pmax (1 sun) | Voc (200 lux indoor) | Pmax (200 lux) |
|------------|-----------|-------------|-------------|--------------|----------------------|-----------------|
| 25mm x 25mm | Amorphous Si | 4.8V | 8mA | 22mW | 3.2V | ~15uW |
| 50mm x 50mm | Monocrystalline | 5.5V | 80mA | 280mW | 3.8V | ~80uW |
| 55mm x 70mm | IXYS SLMD121H04L | 2.0V | 50mA | 68mW | 1.5V | ~55uW |
| 70mm x 55mm | Panasonic AM-1815CA | 5.4V | 26mA | 100mW | 4.0V | ~100uW |
| 100mm x 80mm | Polycrystalline | 6.0V | 150mA | 600mW | 3.5V | ~120uW |
| 100mm x 150mm | Monocrystalline | 6.0V | 300mA | 1200mW | 4.0V | ~200uW |

One-sun conditions correspond to AM1.5 illumination at 1000 W/m^2 — direct, unobstructed sunlight. Indoor conditions at 200 lux (typical office) correspond to roughly 0.06 W/m^2 for fluorescent lighting and 0.04 W/m^2 for LED lighting. The 1000x reduction in irradiance does not produce a 1000x reduction in Voc — voltage drops logarithmically with light level — but current drops nearly linearly, collapsing available power by roughly three orders of magnitude.

## The I-V Curve

The current-voltage relationship of a solar cell follows a characteristic shape described by the Shockley diode equation with a photocurrent source:

```
I = Iph - I0 * (exp(V / (n * Vt)) - 1)

Where:
  Iph  = photo-generated current (proportional to irradiance)
  I0   = diode reverse saturation current (~1e-10 A for Si)
  n    = ideality factor (1.0 - 2.0, typically 1.3 for crystalline Si)
  Vt   = thermal voltage = kT/q (~25.7mV at 25 deg C)
```

At any operating point on the I-V curve, the power delivered equals V x I. The maximum power point (MPP) sits at the "knee" of the curve, where the product is maximized. Operating below Vmpp wastes voltage headroom; operating above Vmpp causes the current to collapse as the cell approaches Voc.

As illumination decreases:
- Isc drops nearly proportionally (halve the light, halve the current)
- Voc decreases logarithmically (~60mV per decade of light reduction for a single junction)
- The MPP shifts to a lower voltage and much lower current
- Fill factor may degrade slightly due to shunt resistance becoming dominant at low currents

## Illumination Levels and Irradiance

Translating from lux (photometric) to W/m^2 (radiometric) depends on the light source spectrum:

| Environment | Typical Lux | Irradiance (fluorescent) | Irradiance (LED) |
|-------------|-------------|--------------------------|-------------------|
| Overcast outdoor | 1000–5000 | 0.3–1.5 W/m^2 | 0.2–1.0 W/m^2 |
| Direct sunlight | 80,000–120,000 | ~1000 W/m^2 | N/A |
| Bright office | 400–500 | 0.12–0.15 W/m^2 | 0.08–0.10 W/m^2 |
| Typical office | 200–300 | 0.06–0.09 W/m^2 | 0.04–0.06 W/m^2 |
| Dim corridor | 50–100 | 0.015–0.03 W/m^2 | 0.01–0.02 W/m^2 |
| Warehouse | 100–200 | 0.03–0.06 W/m^2 | 0.02–0.04 W/m^2 |

Amorphous silicon cells perform better under indoor lighting relative to their outdoor rating because their spectral response better matches the narrow emission peaks of fluorescent and LED sources. Monocrystalline cells, while more efficient outdoors, may underperform amorphous cells indoors on a per-area basis. The IXYS SLMD and Panasonic AM-series cells are specifically designed and characterized for indoor light harvesting.

## Series vs Parallel Wiring

Multiple cells or panels can be combined in series or parallel to match the harvesting IC input requirements:

**Series connection** — voltages add, current stays the same as the weakest cell:
```
Two cells in series:
  Voc_total = Voc_1 + Voc_2
  Isc_total = min(Isc_1, Isc_2)

Example: Two IXYS SLMD121H04L in series
  Voc = 2.0V + 2.0V = 4.0V
  Isc = 50mA (unchanged)
  Suitable for BQ25570 input range (0.1V – 5.1V)
```

**Parallel connection** — currents add, voltage stays the same as the lowest cell:
```
Two cells in parallel:
  Voc_total = min(Voc_1, Voc_2)
  Isc_total = Isc_1 + Isc_2

Example: Two IXYS SLMD121H04L in parallel
  Voc = 2.0V (unchanged)
  Isc = 50mA + 50mA = 100mA
  Double the current at the same voltage
```

Series wiring is typically preferred when the harvesting IC needs a higher input voltage for efficient cold-start or boost operation. Parallel wiring is preferred when voltage is already adequate but more current (and therefore more power) is needed. Mismatched cells in series cause the weakest cell to limit the string — partial shading on one cell in a series string collapses the output of all cells.

## Bypass and Blocking Diodes

**Blocking diodes** prevent reverse current flow from the storage element back through the panel during darkness. Without a blocking diode, a charged supercapacitor or battery connected to the panel's output through the harvester will discharge backward through the panel when illumination drops to zero. Most harvesting ICs (BQ25570, AEM10941) integrate this function internally, but discrete panel-to-harvester connections require an external Schottky diode (e.g., BAT54, SS14) in series with the panel's positive output. The forward voltage drop (0.2V–0.4V for Schottky) directly reduces available power, so selecting a low-Vf diode matters.

**Bypass diodes** protect individual cells in a series string from reverse-biasing when partially shaded. A shaded cell in a series string acts as a load rather than a source, and the other cells can drive enough voltage across it to cause hot-spot damage. A Schottky diode in anti-parallel across each cell (or group of cells) provides a low-loss bypass path. For small embedded panels with only 2–4 cells in series, bypass diodes are often omitted because the voltages are too low to cause damage — but they become important in strings of 6 or more cells.

## Panel Sizing for Power Targets

Estimating the required panel size starts with the target power budget and the expected illumination:

```
Required panel area = P_target / (irradiance * eta_cell * eta_harvester)

Where:
  P_target      = average power needed by the load (e.g., 100uW)
  irradiance    = light intensity in W/m^2 at the deployment location
  eta_cell      = panel efficiency (15-22% monocrystalline, 6-10% amorphous)
  eta_harvester = harvesting IC efficiency (70-90% at MPP)

Example: 100uW load, indoor office at 200 lux (0.06 W/m^2), amorphous Si (8%), harvester at 80%:
  Area = 100e-6 / (0.06 * 0.08 * 0.80)
  Area = 100e-6 / 3.84e-3
  Area = 0.026 m^2 = 26 cm^2
  A 50mm x 55mm panel (27.5 cm^2) would marginally satisfy this budget.
```

This calculation assumes uniform illumination during all operating hours. In practice, illumination varies throughout the day, the panel may be partially obstructed, and dust accumulation reduces output by 5–15% per year without cleaning. A safety margin of 2x to 3x over the calculated minimum is standard practice.

## Matching Panels to Harvesting ICs

The harvesting IC's input voltage range constrains which panels are usable:

| Harvesting IC | Min Operating Vin | Max Vin | Cold Start Vin | Recommended Voc |
|---------------|-------------------|---------|----------------|-----------------|
| BQ25570 | 100mV | 5.1V | 330mV+ (15uW min) | 0.5V – 5.0V |
| AEM10941 | 50mV | 5.0V | 380mV+ (3uW min) | 0.5V – 5.0V |
| SPV1050 | 150mV | 18V | 550mV+ | 0.5V – 16V |
| MAX20361 | 225mV | 5.5V | 750mV+ | 0.5V – 5.0V |

The panel's Voc under worst-case (minimum) illumination must remain above the harvester's cold-start voltage. The panel's Voc under best-case (maximum) illumination must remain below the harvester's absolute maximum input voltage. Since Voc varies logarithmically with illumination, a panel with 5.5V Voc at one sun might still show 3.0V Voc at 200 lux indoors — well within the BQ25570's range.

The MPPT ratio of the harvesting IC determines the operating voltage. The BQ25570, for instance, samples Voc periodically and regulates the input to a fraction of Voc (set by a resistor divider, typically 70–80% of Voc). This fraction should place the operating point near the panel's actual Vmpp. For most silicon cells, Vmpp sits at approximately 78–82% of Voc, making 80% a reasonable default MPPT ratio.

## Tips

- Characterize panels at the actual deployment illumination, not at one-sun lab conditions — a panel's 200 lux performance may not scale linearly from its one-sun datasheet values due to shunt resistance effects
- Use amorphous silicon or dye-sensitized cells for indoor harvesting; monocrystalline panels are optimized for the solar spectrum and lose relative efficiency under artificial lighting
- When prototyping, a bench power supply in constant-voltage mode with a series resistor can simulate a solar panel's I-V curve for repeatable testing without waiting for sunlight
- Place decoupling capacitance (10uF–100uF ceramic) directly at the harvester input to smooth the panel's output and reduce ripple from the harvester's switching

## Caveats

- **Indoor power is microwatts, not milliwatts** — A 50mm x 50mm panel rated at 280mW under one sun produces roughly 80uW at 200 lux; system designs must account for this three-order-of-magnitude reduction
- **Temperature coefficient is negative for voltage** — Panel Voc drops approximately 2mV per degree C per cell; a panel at 60 degrees C in direct sunlight may have 10–15% lower Voc than its 25 degrees C rating, potentially dropping below the harvester's MPPT range
- **Partial shading is disproportionately destructive in series strings** — One shaded cell in a four-cell series string does not reduce output by 25%; it can collapse output by 80% or more because the shaded cell becomes a resistive load
- **Panel degradation is real** — Outdoor panels lose 0.5–1% efficiency per year; epoxy-encapsulated small panels exposed to UV degrade faster, losing 10–20% in the first two years without UV-stable encapsulation

## In Practice

- A solar-powered environmental sensor using a 50mm x 50mm monocrystalline panel and BQ25570 operates indefinitely outdoors in temperate climates but fails to cold-start indoors because the panel's Voc at 200 lux drops below the 330mV cold-start threshold — switching to a larger amorphous panel with higher indoor Voc resolves the issue
- A smart agriculture sensor deployed in partial shade under a crop canopy receives only 10–20% of full-sun irradiance for most of the day, reducing a nominally 500mW panel to 50–100mW effective output — the 3x oversizing margin in the original design barely covers this, and the system goes dark during overcast weeks without a sufficiently large supercapacitor buffer
- A desk-mounted indoor air quality sensor using a Panasonic AM-1815CA panel harvests approximately 100uW under 300 lux office lighting, enough to sustain a BLE sensor node that averages 40uW — but weekend and holiday periods with lights off require a supercapacitor large enough to bridge 60+ hours of darkness
- A design that connects a 6V Voc panel directly to a BQ25570 without checking the absolute maximum input rating works fine at room temperature, but during cold winter mornings when temperature coefficient pushes Voc to 6.8V, the harvester's input protection clamps and the resulting current causes localized heating on the IC
