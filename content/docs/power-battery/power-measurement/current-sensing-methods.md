---
title: "Current Sensing Methods"
weight: 10
---

# Current Sensing Methods

Every power measurement begins with converting a current into a voltage that can be digitized. The dominant technique in embedded systems is the shunt resistor — a low-value, precision resistor placed in the current path so that the voltage drop across it is proportional to the current flowing through it. The fundamental relationship is Ohm's law: V = I × R. A 100mA current through a 100mΩ shunt produces a 10mV signal. The entire accuracy of the measurement chain depends on the shunt resistor value, its tolerance, its placement on the board, and how the resulting voltage is amplified and digitized.

## Shunt Resistor Fundamentals

A shunt resistor (also called a current sense resistor) is deliberately inserted in series with the load. The voltage developed across the resistor is measured and divided by the known resistance to recover the current. The resistor must be low enough in value to avoid significant power loss and voltage drop, yet large enough to produce a measurable signal above the noise floor of the ADC or amplifier that follows.

The power dissipated in the shunt is P = I² × R. A 10mΩ shunt carrying 1A dissipates 10mW — negligible. The same shunt carrying 10A dissipates 1W, which requires a physically larger resistor with adequate thermal rating. Current sense resistors are specified with both a resistance tolerance (typically ±0.5% or ±1%) and a temperature coefficient of resistance (TCR), expressed in ppm/°C. A TCR of 50 ppm/°C means the resistance drifts 0.005% per degree Celsius — acceptable for most embedded power monitoring, but significant in precision metering.

## Sense Resistor Value Selection

The choice of shunt resistance involves a direct tradeoff between signal amplitude and power loss:

| Current Range | Typical Shunt Value | Signal at Full Scale | Power at Full Scale |
|---------------|--------------------|-----------------------|---------------------|
| 0–50mA        | 1Ω                 | 50mV                  | 2.5mW               |
| 0–500mA       | 100mΩ              | 50mV                  | 25mW                |
| 0–2A          | 25mΩ               | 50mV                  | 100mW               |
| 0–5A          | 10mΩ               | 50mV                  | 250mW               |
| 0–20A         | 2mΩ                | 40mV                  | 800mW               |

At 50mV full-scale signal, a 12-bit ADC with 3.3V reference has a resolution of about 0.8mV per LSB — meaning the full-scale shunt voltage spans only ~62 counts. This is why a dedicated current sense amplifier (such as the INA180 or INA213) is almost always placed between the shunt and the ADC. The amplifier boosts the millivolt-level shunt signal to a range that fills more of the ADC's input span.

For ultra-low-power applications measuring microamp sleep currents alongside milliamp active currents, a single shunt value cannot provide adequate resolution across the full dynamic range. Instruments like the Nordic PPK2 and Joulescope solve this with auto-ranging measurement hardware.

## Common Sense Resistor Parts

Several manufacturers produce resistors specifically designed for current sensing:

| Part Number        | Resistance | Tolerance | TCR (ppm/°C) | Power Rating | Package |
|--------------------|-----------|-----------|---------------|-------------|---------|
| Bourns CSS2H-2512R-L010F | 10mΩ | ±1% | ±75 | 3W | 2512 |
| Vishay WSLP2817-R010 | 10mΩ | ±0.5% | ±75 | 2W | 2817 |
| Ohmite LVK12R010DER | 10mΩ | ±0.5% | ±50 | 0.5W | 1206 |
| Susumu KRL1632E-M-R100-F | 100mΩ | ±1% | ±50 | 0.5W | 1206 |
| Panasonic ERJ-M1WTJ10MU | 10mΩ | ±5% | ±200 | 1W | 2512 |

Metal element and metal foil resistors offer the best TCR (as low as ±15 ppm/°C) but cost more. Thick-film chip resistors with higher TCR (±200 ppm/°C) are adequate for coarse monitoring but introduce measurement drift with temperature.

## Resistor Power Rating and Derating

A sense resistor's rated power applies at 25°C with specific PCB mounting conditions. Above 25°C, power handling must be derated — typically linearly, reaching zero at the maximum operating temperature (often 155°C for metal element types). A 1W-rated 2512 resistor at 85°C ambient may safely handle only 0.5W. Always check the manufacturer's derating curve. Overheating a sense resistor changes its resistance (temporarily or permanently), corrupting every current reading.

Thermal design matters: a 10mΩ resistor dissipating 500mW on a 1206 pad reaches a surface temperature well above the surrounding PCB. Adequate copper pour around the pads acts as a heatsink. For resistors above 1W, dedicated thermal vias to inner copper planes or a heatsink pad may be necessary.

## 4-Wire Kelvin Sensing

At resistances below 50mΩ, the resistance of the PCB traces connecting to the shunt becomes significant relative to the shunt itself. A 10mm trace at 1oz copper (35µm thick, 0.5mm wide) has a resistance of roughly 10mΩ — comparable to the shunt. If the voltage measurement includes any trace resistance, the effective sense resistance is higher than the shunt value, introducing a systematic error.

Kelvin sensing solves this by using four connections to the resistor: two force connections carry the load current, and two separate sense connections measure the voltage directly at the resistor terminals. Since the sense connections carry negligible current, the voltage drop along the sense traces is essentially zero. Dedicated current sense resistors with four terminals (such as the Bourns CSS4 series or Vishay WSLF series) provide separate Kelvin sense pads.

```
         Force+                    Force-
    ────────┤                    ├────────
            │   ┌──────────┐    │
            ├───┤  R_SENSE ├────┤
            │   └──────────┘    │
    ────────┤                    ├────────
         Sense+                  Sense-
            │                    │
            └──── to amplifier ──┘
              (high-impedance input)
```

Even with a standard 2-terminal resistor, the PCB layout can approximate Kelvin sensing. The voltage measurement traces should connect directly to the resistor pads — not to the power traces that carry load current. A dedicated via or trace from each pad of the resistor routes to the amplifier input, while the high-current path routes separately through wider traces.

## Reading the Shunt Voltage

The simplest approach connects the shunt voltage directly to a differential ADC input. Some MCUs (such as the STM32G4 series) include a built-in programmable gain amplifier (PGA) on the ADC, allowing direct connection of millivolt-level shunt signals. The STM32G474's OPAMP peripheral can be configured as a PGA with gains of 2, 4, 8, 16, 32, or 64, feeding directly into the internal ADC without external components.

For MCUs without internal PGA capability, an external current sense amplifier is used. The amplifier provides a fixed or adjustable gain, level-shifts the signal (critical for high-side sensing where the common-mode voltage equals the supply rail), and outputs a ground-referenced voltage suitable for a single-ended ADC input.

A basic firmware routine for reading a shunt voltage through an STM32 ADC:

```c
/* Shunt: 100mΩ, amplifier gain: 50V/V
 * At 1A: V_shunt = 100mV, V_out = 5.0V (clipped to 3.3V — reduce gain or shunt)
 * At 500mA: V_shunt = 50mV, V_out = 2.5V
 * ADC: 12-bit, Vref = 3.3V → 0.806mV/LSB
 *
 * current_mA = (adc_counts * Vref) / (4096 * gain * R_shunt)
 *            = (adc_counts * 3.3) / (4096 * 50 * 0.1)
 *            = adc_counts * 0.0001611 (amps)
 */

#define VREF_MV         3300
#define ADC_RESOLUTION  4096
#define AMP_GAIN        50
#define R_SHUNT_MOHM    100   /* 100mΩ = 0.1Ω */

uint32_t read_current_ua(ADC_HandleTypeDef *hadc)
{
    HAL_ADC_Start(hadc);
    HAL_ADC_PollForConversion(hadc, 10);
    uint32_t counts = HAL_ADC_GetValue(hadc);

    /* V_adc (µV) = counts * (VREF_MV * 1000) / ADC_RESOLUTION */
    uint64_t v_adc_uv = (uint64_t)counts * VREF_MV * 1000 / ADC_RESOLUTION;

    /* V_shunt (µV) = V_adc / gain */
    uint64_t v_shunt_uv = v_adc_uv / AMP_GAIN;

    /* I (µA) = V_shunt (µV) / R_shunt (mΩ) * 1000 */
    uint32_t current_ua = (uint32_t)(v_shunt_uv * 1000 / R_SHUNT_MOHM);

    return current_ua;
}
```

## PCB Layout for Sense Resistors

Layout errors in current sensing circuits can introduce errors larger than the shunt resistor's tolerance. The key principles:

**Kelvin connections**: Route the voltage sense traces from the resistor pads directly to the amplifier inputs. These traces should not carry any load current and should not share a path with the force (power) traces. Even 5mm of shared trace at high current introduces measurable error.

**Copper resistance**: At 1oz copper (35µm), a 0.5mm-wide trace has approximately 1mΩ per millimeter of length. For a 10mΩ shunt, every millimeter of shared trace adds 10% error. Wider traces reduce resistance but also make Kelvin routing more difficult.

**Ground plane integrity**: The amplifier's ground reference must connect to a clean, quiet ground — not through a high-current return path. A ground plane break or a thin ground trace between the amplifier and the ADC introduces common-mode noise.

**Component placement**: The sense amplifier should be placed within 10mm of the shunt resistor to minimize trace length on the high-impedance sense inputs, which are susceptible to noise pickup. Bypass capacitors (100nF ceramic) on the amplifier's supply pin should be placed within 3mm.

```
  GOOD layout:                      BAD layout:

  ┌──────┐  sense traces   ┌───┐   ┌──────┐  shared power path
  │R_SENSE├────────────────►│AMP│   │R_SENSE├─────┬───────►LOAD
  └──┬───┘                 └───┘   └──┬───┘     │
     │                                │    ┌────┘
     └──────────────────►LOAD         └───►│AMP│
                                           └───┘
```

## Tips

- Start with a shunt value that produces at least 10mV at the lowest current of interest — below this, noise and offset voltages in the amplifier dominate the reading
- Use 0.5% or better tolerance sense resistors for any measurement expected to be accurate to within a few percent — a 5% resistor contributes 5% systematic error before anything else in the signal chain
- For applications requiring measurement of both microamp sleep currents and hundred-milliamp active currents, consider a logarithmic amplifier or auto-ranging front end rather than a single fixed-gain amplifier
- Place a small (100pF–1nF) capacitor across the amplifier's differential inputs as an anti-aliasing filter — this prevents high-frequency switching noise from being folded into the ADC measurement
- Verify sense resistor accuracy with a known current source and calibrated multimeter before trusting firmware readings — solder joint quality and PCB trace routing can shift the effective resistance

## Caveats

- **A sense resistor in the ground return path shifts the load's ground potential** — If the load shares ground with sensitive analog circuitry, the millivolt drop across the shunt introduces a ground offset that corrupts ADC readings on other channels
- **Inrush current can momentarily exceed the shunt resistor's peak current rating** — A 10mΩ 0.5W resistor can handle 7A continuous, but capacitive loads can draw 20A+ for microseconds at power-on; the resistor's pulse handling specification determines survival, not its continuous power rating
- **Temperature-dependent resistance drift is cumulative with self-heating** — A shunt carrying continuous high current heats itself, shifting its resistance; the resulting error is current-dependent and cannot be calibrated out with a single-point offset correction
- **PCB trace resistance between the shunt and amplifier inputs adds directly to the measured resistance** — On a 10mΩ shunt, even 2mm of 0.5mm-wide 1oz trace adds 2mΩ (20% error) if the layout does not use Kelvin connections
- **Switching noise from nearby DC-DC converters couples into the sense traces** — Shielding the sense traces with ground pour and keeping them away from switching nodes reduces this, but filtering at the amplifier input is usually necessary

## In Practice

- A firmware power measurement that reads consistently 15–20% higher than a bench multimeter often indicates that PCB trace resistance is being included in the measurement — the effective shunt resistance is higher than the nominal value due to non-Kelvin routing
- Sleep current measurements that show a stable floor of 50–100µA when the datasheet promises 2µA typically point to an amplifier or ADC that cannot resolve signals below its input offset voltage — dedicated nanoamp-class instruments are needed for these measurements
- A sense resistor that reads correctly at room temperature but drifts at elevated temperatures is likely a thick-film type with high TCR (200+ ppm/°C); switching to a metal element type with 50 ppm/°C TCR eliminates the temperature-dependent error
- Intermittent current spikes visible on an oscilloscope but absent from ADC readings indicate that the ADC sampling rate is too slow to capture the transient — either increase sampling rate, add a peak-hold circuit, or use an analog low-pass filter to capture the energy of the spike as an averaged increase
- A current reading that oscillates even with a steady DC load often traces to inadequate decoupling on the sense amplifier's supply pin or to ground noise coupling through a shared ground return path
