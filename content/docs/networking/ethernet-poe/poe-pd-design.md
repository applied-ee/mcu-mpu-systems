---
title: "Power over Ethernet: PD Design"
weight: 40
---

# Power over Ethernet: PD Design

Power over Ethernet (PoE) delivers both data and DC power over standard Ethernet cabling, eliminating the need for a separate power supply at the device. For embedded systems — IP cameras, access points, industrial sensors, building automation controllers — PoE simplifies installation to a single cable drop. The Powered Device (PD) is the equipment that receives power from the cable. Designing the PD side involves selecting the correct IEEE 802.3 power class, choosing a PD controller IC, implementing the detection and classification handshake, converting 48 V to the board's operating voltages, meeting isolation requirements, and managing thermal dissipation.

## IEEE 802.3 PoE Standards

Three major PoE standards define the power levels available at the PD:

| Standard | Common Name | Max PSE Output | Max PD Input | Min PD Voltage | Max PD Voltage | Cable Pairs Used |
|----------|-------------|-----------------|-------------|----------------|----------------|-----------------|
| 802.3af | PoE | 15.4 W | 12.95 W | 36 V | 57 V | 2 (Alt A or Alt B) |
| 802.3at | PoE+ | 30 W | 25.5 W | 42.5 V | 57 V | 2 (Alt A or Alt B) |
| 802.3bt Type 3 | PoE++ / 4PPoE | 60 W | 51 W | 42.5 V | 57 V | 4 (both pairs) |
| 802.3bt Type 4 | PoE++ / 4PPoE | 100 W | 71 W | 41.1 V | 57 V | 4 (both pairs) |

The difference between PSE output and PD input accounts for cable resistance losses. A 100 m Cat 5e cable has approximately 12.5 ohms of DC loop resistance per pair, causing 2–3 W of loss at full load on a single pair.

### Power Classes

The PSE (Power Sourcing Equipment — the switch or injector) classifies the PD during the classification phase to allocate power budget. Classification determines how much power the PSE reserves for the port:

| Class | Max PD Power | Typical Application |
|-------|-------------|---------------------|
| 0 | 12.95 W | Default (unclassified) |
| 1 | 3.84 W | VoIP phone, basic sensor |
| 2 | 6.49 W | IP camera (no heater), small AP |
| 3 | 12.95 W | IP camera with pan/tilt, single-radio AP |
| 4 | 25.5 W | Dual-radio AP, PTZ camera (802.3at) |
| 5 | 40 W | Video phone, thin client (802.3bt) |
| 6 | 51 W | Compact display, multi-radio AP (802.3bt) |
| 7 | 62 W | Laptop docking (802.3bt Type 4) |
| 8 | 71 W | High-power device (802.3bt Type 4) |

For most MCU-based embedded devices, Class 1–3 (up to 12.95 W) is sufficient. A typical IoT sensor node with Ethernet PHY, MCU, and a few sensors draws 1–3 W. An IP camera with IR LEDs draws 5–10 W.

## Detection and Classification Handshake

Before delivering 48 V, the PSE performs a two-stage handshake to verify that the connected device is a valid PoE PD (not a legacy device that could be damaged by 48 V):

### Detection Phase

The PSE applies two small voltages (2.8 V and 7.7 V, within the range of 2.7–10.1 V) and measures the current. A valid PD presents a 25 kOhm signature resistance (23.75–26.25 kOhm tolerance). This resistance is provided by the PD controller IC, not a discrete resistor in most designs (though some minimal implementations use a physical 25 kOhm resistor with a diode bridge).

```
Detection voltage-current characteristic:

V (PSE applied)   I (measured)    R (calculated)
─────────────────────────────────────────────────
2.8 V              112 uA          25 kOhm ✓ Valid PD
7.7 V              308 uA          25 kOhm ✓ Valid PD

If R is outside 23.75–26.25 kOhm range:
  → PSE does NOT apply power
  → Device is treated as legacy (non-PoE) equipment
```

### Classification Phase

After successful detection, the PSE applies 15.5–20.5 V and measures the current drawn by the PD. The current level indicates the PD's power class:

| Class | Classification Current | Classification Resistance |
|-------|----------------------|--------------------------|
| 0 | 0–4 mA | > 10 kOhm (or open) |
| 1 | 9–12 mA | 1.3–1.7 kOhm |
| 2 | 17–20 mA | 787–937 Ohm |
| 3 | 26–30 mA | 510–590 Ohm |
| 4 | 36–44 mA | 340–445 Ohm |

The PD controller IC handles both detection and classification internally. An external resistor connected to the classification pin sets the class. On the TPS2379 (TI), the RCLASS pin connects to ground through a resistor:

```
Class 1: RCLASS = 750 Ohm → draws ~10 mA at classification voltage
Class 2: RCLASS = 390 Ohm → draws ~19 mA
Class 3: RCLASS = 249 Ohm → draws ~28 mA
Class 4: RCLASS = 130 Ohm → draws ~40 mA
```

## PD Controller ICs

The PD controller is the central IC in the PD power path. It manages detection, classification, inrush current limiting, undervoltage lockout (UVLO), and provides a DC output to the downstream DC-DC converter.

| PD Controller | Vendor | Standard | Key Features | Package | Price (qty 1) |
|---------------|--------|----------|-------------|---------|---------------|
| TPS2379 | TI | 802.3af/at | Integrated MOSFET, programmable class | SOT-23-6 | ~$1.20 |
| TPS23753A | TI | 802.3af/at | Integrated DC-DC controller | TSSOP-14 | ~$3.50 |
| SI3402-B | Skyworks | 802.3af/at | Low BOM count, integrated MOSFET | QFN-10 | ~$2.00 |
| LTC4267 | Analog Devices | 802.3af | Integrated bridge + controller + DC-DC | SSOP-16 | ~$5.00 |
| LTC4279 | Analog Devices | 802.3bt Type 3/4 | 71 W support, 4-pair | QFN-20 | ~$7.50 |
| PD70210 | Microchip | 802.3af/at | Low standby power (< 50 mA) | QFN-24 | ~$2.50 |
| MP8007 | MPS | 802.3af/at | Smallest solution (SOT-23-5) | SOT-23-5 | ~$0.90 |

### TPS2379 Application Circuit

The TPS2379 is one of the simplest PD controllers — a 6-pin device that handles detection, classification, and hot-swap FET control:

```
                        48V from PoE magnetics
                              │
                         ┌────┴────┐
                    ┌────┤  Diode  ├────┐
                    │    │  Bridge │    │
                    │    └─────────┘    │
                    │                   │
               VDD ┤─────────────────┤ VSS
                    │    ┌─────────┐   │
               DEN ┤────┤ TPS2379 ├───┤ RCLASS → Rclass to GND
                    │    └────┬────┘   │
              GATE ┤─────────┘        │
                    │    ┌─────────┐   │
                    ├────┤  MOSFET ├───┤    (or use internal FET)
                    │    └─────────┘   │
                    │                  │
                    └──── VDC_OUT ─────┘
                          (36–57V)
                              │
                         DC-DC Converter
                              │
                         3.3V / 5V Out
```

For the TPS23753A, TI integrates the PD controller with a current-mode DC-DC controller, reducing the total BOM:

```c
/* TPS23753A key design parameters */
/* Input:  36–57 V from PoE */
/* Output: 3.3 V at up to 3.5 A (11.5 W) */

/* Transformer turns ratio: Np/Ns = 12:1 (for 48V→3.3V flyback) */
/* Switching frequency: 250–350 kHz */
/* Output capacitor: 2x 100 uF ceramic + 330 uF electrolytic */
/* Output inductor: wound on transformer (coupled inductor topology) */
```

## 48 V to Low Voltage Conversion

The PD receives 36–57 V DC (the voltage varies with cable length and PSE design). Converting this to the 3.3 V or 5 V needed by the embedded system requires an isolated DC-DC converter. The isolation barrier is a safety and regulatory requirement.

### Topology Selection

| Topology | Power Range | Efficiency | Complexity | Isolation |
|----------|-------------|------------|------------|-----------|
| Flyback | 1–60 W | 80–88% | Low (single transformer) | Yes (inherent) |
| Forward | 10–100 W | 85–92% | Medium | Yes (requires reset winding) |
| LLC resonant | 50–200 W | 92–96% | High | Yes |

For 802.3af (< 13 W), a flyback converter is the standard choice. The transformer provides galvanic isolation while stepping down the voltage. For 802.3at (< 25.5 W), flyback still works but requires careful transformer design and a synchronous rectifier for acceptable efficiency. Beyond 25 W, forward converters or LLC topologies become more practical.

### Flyback Converter Design Essentials

```
            48V DC (from PD controller)
               │
          ┌────┴────┐
          │ Primary  │
    ┌─────┤ MOSFET   │
    │     │ (Q1)     │
    │     └────┬────┘
    │          │
    │    ┌─────┴─────┐         ┌──────────┐
    │    │Transformer│    ║    │ Secondary │
    │    │  Primary  ├────║────┤  Winding  ├────┐
    │    │  Np turns │    ║    │  Ns turns │    │
    │    └─────┬─────┘    ║    └──────┬────┘    │
    │          │                     │         │
    │          │              ┌──────┴──────┐   │
    │          │              │ Diode (D1)  │   │
    │          │              │ or Sync FET │   │
    │          │              └──────┬──────┘   │
    │          │                     │         │
    │     GND ─┘               ┌────┴────┐    │
    │                          │  COUT    │    │
    │                          │ 100-330  │    │
    │                          │   uF     │    │
    │                          └────┬────┘    │
    │                               │         │
    │                          3.3V OUT       │
    │                                        GND
    │
    └─── Feedback (optocoupler) ──────────────┘
```

Key parameters for a 48 V → 3.3 V / 3 A flyback:

| Parameter | Value | Notes |
|-----------|-------|-------|
| Input voltage range | 36–57 V | Full PoE voltage range |
| Output voltage | 3.3 V | Regulated via feedback loop |
| Output current | 3.0 A | 10 W maximum |
| Switching frequency | 250 kHz | Higher → smaller transformer, more switching loss |
| Transformer turns ratio | 10:1 | Np = 30 T, Ns = 3 T (typical EF12.6 core) |
| Primary inductance | 200–400 uH | Sets CCM/DCM boundary |
| Output capacitor | 2x 47 uF MLCC + 220 uF electrolytic | Low ESR for ripple |
| Snubber (RCD) | 100 kOhm, 1 nF, UF4007 | Clamps primary leakage spike |

### Isolation Requirements

IEEE 802.3 requires 1500 V AC (or 2121 V DC) isolation between the PoE power input and any user-accessible circuits. This isolation boundary runs through:

- **Transformer** — Primary-to-secondary isolation rated for 1500 VRMS minimum (most PoE transformers are rated for 3000 VRMS).
- **Optocoupler** — Feedback from the secondary side to the primary controller crosses the isolation boundary. Common parts: PC817, TLP785 (CTR > 100%, 5 kVRMS isolation).
- **Ethernet magnetics** — The RJ45 jack's built-in transformers provide the data-path isolation. Standard magnetics are rated for 1500 VRMS.

On the PCB, the isolation boundary manifests as a creepage/clearance gap. For 1500 VRMS working voltage, IEC 62368-1 requires minimum 2.5 mm clearance and 5.0 mm creepage on FR4 (CTI Group IIIa). This gap must be maintained across all layers of the PCB — including internal routing.

## Thermal Budget

PoE PDs dissipate heat from two sources: the DC-DC converter inefficiency and the MCU/sensor board power consumption. In a sealed enclosure with no airflow, thermal management is critical.

### Power Dissipation Estimates

For a Class 3 PD (12.95 W input) at 85% DC-DC efficiency:

| Stage | Input Power | Output Power | Heat Dissipated |
|-------|-------------|-------------|-----------------|
| Diode bridge | 12.95 W | 12.45 W | 0.5 W (4x Schottky drops) |
| PD controller + FET | 12.45 W | 12.20 W | 0.25 W |
| Flyback converter | 12.20 W | 10.37 W | 1.83 W |
| **Total heat** | | | **~2.6 W** |

2.6 W of heat in a sealed plastic enclosure (80 x 60 x 30 mm) raises internal temperature by approximately 25–40 degrees C above ambient, depending on enclosure material and surface area. At 40 degrees C ambient, internal temperature reaches 65–80 degrees C — within the operating range of most components but above the comfort zone for electrolytic capacitors (rated lifetime halves for every 10 degrees C above rated temperature).

Mitigation strategies:
- Use ceramic output capacitors (MLCC) instead of or in addition to electrolytics — MLCCs have no temperature-dependent lifetime degradation.
- Spread the heat: mount the flyback transformer, MOSFET, and output diode on separate thermal pads connected to internal copper planes.
- Choose a PD controller with low quiescent current — the TPS2379 draws < 4 mA in idle, while some controllers draw 10–20 mA.

## Layout Considerations for PoE

PCB layout for PoE is driven by high-voltage safety, EMI compliance, and thermal management.

### Critical Layout Rules

1. **Isolation gap** — Maintain a minimum 2.5 mm clearance / 5 mm creepage between primary (48 V PoE) and secondary (3.3 V system) circuits on all PCB layers. Route a slot in the PCB at the isolation boundary if creepage cannot be met with trace spacing alone.

2. **Diode bridge placement** — Place the full-bridge rectifier (or discrete Schottky diodes) as close to the RJ45 jack center-tap connections as possible. The high-current path from magnetics to bridge to PD controller should be short and wide (minimum 20 mil traces for 350 mA 802.3af, 40 mil for 802.3at currents).

3. **Transformer placement** — Center the flyback transformer between the primary and secondary ground planes. The transformer straddles the isolation boundary. Keep the primary-side switching loop (MOSFET drain → transformer primary → input capacitor → MOSFET source) as tight as possible — this is the highest di/dt loop and the primary EMI source.

4. **Ground planes** — Use separate primary and secondary ground planes connected only through the transformer's center tap (for secondary) and the PD controller's ground reference (for primary). The two ground planes should not overlap under the transformer — this creates a parasitic capacitor that couples noise across the isolation barrier.

5. **Output capacitor placement** — Place ceramic output capacitors within 5 mm of the transformer secondary pins. The rectifier diode, capacitor, and transformer secondary form a high-current loop that must be minimized.

```
  PCB Layout (top view, isolation boundary shown)

  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │   ┌────┐     ┌────────┐                        │
  │   │RJ45│─────│Magnetics│    PRIMARY SIDE        │
  │   │    │     │+ CT tap │    (48V)               │
  │   └────┘     └────┬───┘                        │
  │                   │                             │
  │              ┌────┴────┐     ┌──────────┐       │
  │              │ Diode   │     │ PD       │       │
  │              │ Bridge  ├─────┤Controller│       │
  │              └─────────┘     └────┬─────┘       │
  │                                   │             │
  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ISOLATION BOUNDARY ─ ─ ─ ─ │
  │                                   │             │
  │              ┌────────────┐  ┌────┴─────┐       │
  │              │Transformer │  │ DC-DC    │       │
  │              │ (straddles │──│ Output   │       │
  │              │ boundary)  │  │ Stage    │       │
  │              └────────────┘  └────┬─────┘       │
  │                                   │             │
  │                              3.3V / 5V          │
  │                           SECONDARY SIDE        │
  │                                                 │
  └─────────────────────────────────────────────────┘
```

## PoE Magnetics

PoE uses the Ethernet cable's center taps for power delivery. The Ethernet magnetics (transformers in the RJ45 jack or as discrete components) must support DC current on the center taps without saturating. Standard non-PoE magnetics are not designed for DC bias and will saturate, distorting the data signal.

Two wiring alternatives exist:

- **Alternative A (End-span)** — Power on data pairs (pins 1-2 and 3-6). The switch feeds power through the same pairs carrying data. The magnetics center taps provide the power extraction point.
- **Alternative B (Mid-span)** — Power on spare pairs (pins 4-5 and 7-8). A mid-span injector uses the two unused pairs for power. Requires all 4 pairs wired in the cable (Cat 5e minimum).

A compliant PD must accept power from either Alternative A or B. The diode bridge at the PD input handles this automatically — regardless of which pair carries power and with which polarity, the bridge rectifier produces positive DC output.

## Tips

- Start with an integrated PD controller + DC-DC solution (TPS23753A or LTC4267) for the first design. Separating the PD interface and DC-DC converter into discrete ICs provides more flexibility but doubles the design complexity and BOM.
- Test with multiple PSE brands during development. The PoE detection and classification timing varies between Cisco, HPE/Aruba, Juniper, and commodity PoE switches. A design that works with one vendor's switch but fails with another usually has marginal timing on the detection signature or classification current.
- Include a DC barrel jack or screw terminal as an alternative power input. Many installations require the device to work without PoE during bench testing or in locations without PoE switches. A simple OR-ing diode circuit selects the higher voltage source.
- Size the input capacitor after the diode bridge for the 48 V ripple, not just the DC voltage. A 10 uF / 63 V ceramic capacitor is adequate for most 802.3af designs. For 802.3at, increase to 22–47 uF / 63 V.
- Use a dedicated PoE reference design from the PD controller vendor as a starting point. TI, Analog Devices, and Microchip all provide complete reference layouts with BOM and Gerber files. Modifying a proven design is faster and more reliable than starting from scratch.

## Caveats

- **The 25 kOhm detection signature must be precise** — If the PD's detection resistance falls outside 23.75–26.25 kOhm, the PSE will not apply power. PCB leakage, moisture, or incorrect PD controller biasing can shift the signature resistance. Testing across temperature (-20 to +70 degrees C) is essential for outdoor devices.
- **Inrush current at power application can trigger PSE overcurrent protection** — When the PSE applies 48 V, the PD's input capacitors charge rapidly. The PD controller's built-in inrush limiter (typically a series MOSFET with controlled gate ramp) limits this to a safe level, but adding extra capacitance beyond the controller's rating can cause the PSE to shut down the port. The TPS2379 limits inrush to approximately 100 mA with its internal FET.
- **Cable length affects available voltage** — At 100 m with 802.3af, the PD may see as low as 36 V (the standard's minimum). The DC-DC converter must operate efficiently across the full 36–57 V input range. A flyback designed for 48 V nominal that drops out at 40 V will fail at maximum cable length.
- **Mixed PoE and non-PoE ports on the same device are a safety concern** — If the device has both a PoE input and a second Ethernet port (e.g., a PoE-powered switch), the isolation boundary and safety grounding become complex. The second port must not expose 48 V if the PoE port's isolation fails. Consult IEC 62368-1 for applicable safety requirements.
- **Not all PoE injectors support 802.3at** — Passive (non-negotiating) PoE injectors apply 48 V without performing detection or classification. These work with any PD controller but bypass safety protections and do not support the higher power classes of 802.3at/bt. Passive injectors are common in low-cost surveillance camera installations but are not compliant with IEEE 802.3.

## In Practice

- A PoE-powered environmental sensor (temperature, humidity, air quality) with an STM32F407 + LAN8720A PHY draws approximately 1.5 W total. A Class 1 PD design (3.84 W budget) provides ample headroom. The DC-DC converter efficiency of 82% means the converter dissipates about 0.3 W of heat — manageable in a small enclosure without any heatsinking.
- An IP camera design drawing 8 W (Class 3, 802.3af) at the board level needs a 12.95 W / 0.85 efficiency = 10.2 W PD input, fitting within Class 3 limits. Adding IR illumination LEDs that draw 4 W pushes the total to 12 W board power, requiring 14.1 W PD input — exceeding 802.3af. The options are upgrading to 802.3at (25.5 W), duty-cycling the IR LEDs, or using more efficient LEDs.
- During bring-up of a new PoE PD board, connecting it to a PoE switch with the Ethernet cable and observing the switch port's PoE status LED is the quickest diagnostic. If the LED indicates "searching" (blinking), the detection signature is not being presented correctly. If it shows "fault," the PD is drawing too much inrush current or the classification is invalid. If it shows "powered" but the board does not boot, the DC-DC converter is the problem.
- A design that works reliably with a Cisco Catalyst switch but fails intermittently with a TP-Link PoE switch may be hitting the detection timing window differently. Cisco switches use a longer detection probe (500–600 ms), while some budget switches use shorter probes (100–200 ms). Ensuring the PD controller presents the signature resistance within 50 ms of power application covers all common PSE implementations.
- For outdoor PoE devices (-20 to +60 degrees C), the flyback transformer's core material (typically ferrite NiZn or MnZn) must be rated for the full temperature range. Some low-cost ferrite materials exhibit significant permeability variation below 0 degrees C, shifting the converter's operating point and potentially causing regulation failure. Specifying a core material rated for -40 to +85 degrees C (such as TDK PC95 or Ferroxcube 3C95) prevents this issue.
