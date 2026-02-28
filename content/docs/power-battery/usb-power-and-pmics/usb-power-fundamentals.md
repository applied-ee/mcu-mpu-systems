---
title: "USB Power Fundamentals"
weight: 10
---

# USB Power Fundamentals

USB power delivery has evolved through several specification revisions, each increasing the available current and introducing new detection mechanisms. What started as a simple 5V bus with a 100mA default has grown into a system that can advertise up to 3A at 5V through passive resistor configuration alone — before any digital negotiation takes place. Understanding each layer of this evolution is essential for embedded power design, because a device that fails to detect its source type correctly may draw too little current (leaving charging performance on the table) or attempt to draw too much (causing the source to shut down or the cable to overheat).

The USB Type-C connector introduces a fundamentally different power signaling mechanism compared to the legacy Type-A/Type-B ecosystem. Rather than relying solely on the D+/D- data lines for power negotiation, Type-C uses dedicated CC (Configuration Channel) pins with resistor networks that communicate current capability through analog voltage levels. This analog signaling layer operates independently of USB Power Delivery (PD), which adds a digital protocol on top of the same CC pins.

## USB 2.0 Power

USB 2.0 defines two power states for downstream-facing ports:

| State | Voltage | Current | Condition |
|-------|---------|---------|-----------|
| Unconfigured | 5V | 100mA max | Device attached but not enumerated |
| Configured | 5V | 500mA max | Device enumerated, configuration descriptor accepted |

A USB 2.0 device must not draw more than 100mA until the host has completed enumeration and accepted a configuration that requests higher current. The configuration descriptor's `bMaxPower` field specifies the maximum current in units of 2mA (so a value of 250 means 500mA). The host may reject a configuration if the requested current exceeds what the port can supply — for example, an unpowered hub limits each downstream port to 100mA.

The VBUS pin on a USB 2.0 Type-A receptacle is specified at 5V +/- 5% (4.75V to 5.25V) at the source. Cable drop and connector resistance can reduce this to 4.4V or lower at the device end of a marginal cable. Embedded designs that regulate from USB VBUS should tolerate an input range of 4.0V to 5.5V to account for worst-case cable drop plus overshoot transients.

## USB 3.x Power

USB 3.0 (SuperSpeed) and USB 3.1/3.2 increase the unconfigured and configured current limits:

| Specification | Unconfigured | Configured | Data Rate |
|---------------|-------------|------------|-----------|
| USB 2.0 | 100mA | 500mA | 480 Mbps |
| USB 3.0 / 3.1 Gen 1 | 150mA | 900mA | 5 Gbps |
| USB 3.1 Gen 2 | 150mA | 900mA | 10 Gbps |
| USB 3.2 Gen 2x2 | 150mA | 900mA | 20 Gbps |

The jump from 500mA to 900mA configured current in USB 3.x reflects the higher power demands of SuperSpeed peripherals (external SSDs, capture devices). The 150mA unconfigured limit also provides more headroom for devices that need to power up a microcontroller and enumerate before requesting full current.

## USB Battery Charging 1.2 (BC1.2)

BC1.2 was introduced to solve a practical problem: USB chargers (wall adapters, car chargers) are not hosts and cannot enumerate devices, so a device connected to a charger has no mechanism to discover that more than 100mA is available through standard USB 2.0 enumeration. BC1.2 defines three source types detected through D+/D- signaling:

| Source Type | Abbreviation | Max Current | D+/D- Behavior |
|-------------|-------------|-------------|-----------------|
| Standard Downstream Port | SDP | 500mA (after enum) | Normal USB data signaling |
| Dedicated Charging Port | DCP | 1.5A | D+ and D- shorted together (< 200 ohm) |
| Charging Downstream Port | CDP | 1.5A | Responds to voltage forcing on D+/D- |

### DCP Detection

A Dedicated Charging Port (the most common wall adapter type) shorts D+ to D- through a resistance of less than 200 ohms. The device detects this by driving a voltage on D+ (VDP_SRC, typically 0.5–0.7V) and checking whether D- follows. If D- rises above its detection threshold (VDM_SRC, approximately 0.25V), the port is a DCP, and the device may draw up to 1.5A without any enumeration.

Many charger ICs implement DCP detection automatically. For example, the TPS2514A provides the D+/D- short on the source side, while the BQ24296 and BQ25895 perform the D+/D- detection sequence on the sink side and adjust their input current limit accordingly.

### CDP Detection

A Charging Downstream Port can supply up to 1.5A while also supporting USB data. CDP detection is a two-phase handshake:

1. The device drives VDP_SRC (0.5–0.7V) on D+ and checks D-. A CDP will not short D+/D-, so D- stays low — distinguishing it from a DCP.
2. The device then drives VDM_SRC on D- and checks D+. A CDP responds by pulling D+ high (above 0.8V). An SDP does not respond, keeping D+ at its idle level.

If both checks pass — D- low in phase 1, D+ high in phase 2 — the port is a CDP. The device may draw up to 1.5A and also establish a data connection.

### Apple and Qualcomm Proprietary Detection

Apple chargers do not implement BC1.2. Instead, they use specific voltage divider ratios on D+ and D- to indicate current capability:

| Apple Mode | D+ Voltage | D- Voltage | Current |
|------------|-----------|-----------|---------|
| 500mA | 2.0V | 2.0V | 500mA |
| 1A | 2.7V | 2.0V | 1A |
| 2.1A | 2.7V | 2.7V | 2.1A |
| 2.4A | 2.7V | 2.7V | 2.4A |

Qualcomm Quick Charge (QC2.0/3.0) uses different D+/D- voltage combinations to request elevated VBUS voltages (9V, 12V, 20V). This is distinct from USB PD and operates on the D+/D- pins rather than the CC pin.

## USB Type-C Connector Pinout

The USB Type-C connector has 24 pins arranged in a rotationally symmetric layout, allowing the plug to be inserted in either orientation:

| Pin | Name | Function | Pin | Name | Function |
|-----|------|----------|-----|------|----------|
| A1 | GND | Ground | B1 | GND | Ground |
| A2 | TX1+ | SuperSpeed TX+ (pair 1) | B2 | TX2+ | SuperSpeed TX+ (pair 2) |
| A3 | TX1- | SuperSpeed TX- (pair 1) | B3 | TX2- | SuperSpeed TX- (pair 2) |
| A4 | VBUS | Bus power | B4 | VBUS | Bus power |
| A5 | CC1 | Configuration Channel 1 | B5 | VCONN | VCONN (or CC2 on plug) |
| A6 | D+ | USB 2.0 D+ | B6 | D+ | USB 2.0 D+ (not used in cable) |
| A7 | D- | USB 2.0 D- | B7 | D- | USB 2.0 D- (not used in cable) |
| A8 | SBU1 | Sideband Use 1 | B8 | SBU2 | Sideband Use 2 |
| A9 | VBUS | Bus power | B9 | VBUS | Bus power |
| A10 | RX2- | SuperSpeed RX- (pair 2) | B10 | RX1- | SuperSpeed RX- (pair 1) |
| A11 | RX2+ | SuperSpeed RX+ (pair 2) | B11 | RX1+ | SuperSpeed RX+ (pair 1) |
| A12 | GND | Ground | B12 | GND | Ground |

Key details about the pin arrangement:

- **VBUS** appears on four pins (A4, A9, B4, B9), providing redundant power connections for both orientations. All four are connected together inside the connector.
- **GND** appears on four pins (A1, A12, B1, B12) for the same reason.
- **D+/D-** are present on both rows (A6/A7, B6/B7) in the receptacle, but a standard Type-C cable only connects one pair — a mux inside the device or on the cable routes the correct pair based on orientation.
- **CC1/CC2** pins (A5/B5) are the Configuration Channel pins used for orientation detection, current advertisement, and PD communication.
- **SBU1/SBU2** are used for Alternate Mode signaling (DisplayPort AUX, Thunderbolt).

## Cable Orientation Detection via CC Pins

A USB Type-C plug contains only one CC pin (not two). The plug connects this single CC pin to either CC1 or CC2 on the receptacle, depending on which way the plug is inserted. The device-side USB controller monitors both CC1 and CC2. Whichever CC pin shows a valid voltage (via the Rp/Rd divider) indicates the cable's orientation, which then determines:

- Which SuperSpeed TX/RX pairs are active
- Which D+/D- pair to route (if a mux is required)
- Which pin becomes VCONN (the CC pin not used for communication)

For an electronically marked cable (one containing an e-marker chip), the unused CC pin supplies VCONN to power the e-marker IC. This is discussed further below.

## Type-C CC Pin Fundamentals

The CC (Configuration Channel) pins provide a simple analog mechanism for a source to advertise its current capability and for a sink to detect attachment and current level — without any digital protocol.

### Rp and Rd Resistors

- **Rp (pull-up)**: The source places a pull-up resistor from the CC pin to VBUS (or a fixed voltage like 3.3V or 5V depending on implementation). The value of Rp encodes the current capability.
- **Rd (pull-down)**: The sink places a 5.1 kohm pull-down resistor from each CC pin to GND.

When a cable is connected, the Rp and Rd form a voltage divider on the active CC pin. The sink measures the resulting voltage to determine the advertised current level.

### Rp Values and Current Advertisement

When Rp is pulled up to 5V (the most common configuration for discrete implementations):

| Current Level | Rp to 5V | Rp to 3.3V | Rp to 1.7V (current source) | CC Voltage at Sink |
|--------------|----------|-----------|----------------------------|-------------------|
| Default USB (500mA / 900mA) | 56 kohm | 36 kohm | 80 uA | ~0.41V |
| 1.5A | 22 kohm | 12 kohm | 180 uA | ~0.92V |
| 3.0A | 10 kohm | 4.7 kohm | 330 uA | ~1.68V |

The CC voltage at the sink is calculated from the voltage divider: `V_CC = V_pullup * Rd / (Rp + Rd)`, where Rd = 5.1 kohm. For Rp = 56 kohm to 5V: `V_CC = 5.0 * 5.1 / (56 + 5.1) = 0.417V`.

### CC Voltage Thresholds

The sink must compare the measured CC voltage against defined thresholds to determine the current level:

| Threshold | Voltage Range | Meaning |
|-----------|--------------|---------|
| vRd-Connect | 0.25V – 0.61V | Source attached, default current (500/900mA) |
| vRd-1.5A | 0.70V – 1.16V | Source advertising 1.5A |
| vRd-3.0A | 1.31V – 2.04V | Source advertising 3.0A |

A simple comparator-based detection circuit with two thresholds (e.g., 0.65V and 1.23V) can distinguish the three levels. Many USB PD controller ICs (STUSB4500, FUSB302, CYPD3177) include this detection internally and expose the result through I2C status registers.

## Type-C Current Without PD

An important and often overlooked capability: a Type-C source can advertise up to 3A at 5V purely through the Rp resistor value, with no USB PD controller required. This is sometimes called "Type-C Current" and is distinct from USB PD.

The total available power at each Type-C current level:

| Advertisement | Voltage | Current | Power |
|--------------|---------|---------|-------|
| Default (56k Rp) | 5V | 500mA (USB 2.0) or 900mA (USB 3.x) | 2.5W / 4.5W |
| 1.5A (22k Rp) | 5V | 1.5A | 7.5W |
| 3.0A (10k Rp) | 5V | 3.0A | 15W |

This means a USB-C charger rated at 5V/3A does not necessarily support USB PD at all. It may simply use a 10 kohm Rp resistor. The sink detects 3A availability, sets its input current limit to 3A, and charges at 15W — all without a single PD message.

## VBUS Management

In the Type-C ecosystem, VBUS defaults to 5V (or 0V when no device is attached — dead-bus behavior). The source must not apply VBUS until a valid sink is detected via the CC pin (Rd pull-down present). This "VBUS after CC" rule prevents voltage from appearing on the connector when nothing is plugged in, improving safety and reducing connector corrosion in humid environments.

Once USB PD negotiation begins (covered in the PD Negotiation page), VBUS can be commanded to other voltages (9V, 15V, 20V, up to 48V under PD 3.1 EPR). The transition follows a strict timing protocol:

- Source must ramp VBUS to the new voltage within the `tSrcTransition` window (maximum 550ms for PD 3.0).
- VBUS must not overshoot the negotiated voltage by more than a defined margin.
- The sink must tolerate the VBUS transition, including a brief dip that may occur as the source's converter adjusts.

## VCONN for Electronically Marked Cables

VCONN provides power (nominally 5V, up to 1W) to active components inside a USB-C cable:

- **E-marker ICs**: These chips store the cable's identity, current rating, and supported speeds in a small EEPROM. The USB PD controller queries the e-marker via SOP' messages on the CC pin to verify that the cable supports the requested voltage and current.
- **Active cables**: Cables with signal repeaters or retimers (required for USB4 and Thunderbolt 3/4 at full speed over 1m+) draw VCONN power to operate the active electronics.

VCONN is supplied on the CC pin that is not used for communication. The source determines which CC pin carries the signal (via Rp/Rd detection) and applies VCONN to the other CC pin. VCONN must be between 4.75V and 5.5V with a minimum of 1W sourcing capability.

## Comparison of All USB Power Modes

| Mode | Connector | Voltage | Max Current | Max Power | Detection Method |
|------|-----------|---------|-------------|-----------|-----------------|
| USB 2.0 (unconfigured) | Type-A/B/C | 5V | 100mA | 0.5W | None (default) |
| USB 2.0 (configured) | Type-A/B/C | 5V | 500mA | 2.5W | Enumeration |
| USB 3.x (configured) | Type-A/B/C | 5V | 900mA | 4.5W | Enumeration |
| BC1.2 DCP | Type-A/B/Micro | 5V | 1.5A | 7.5W | D+/D- short |
| BC1.2 CDP | Type-A/B/Micro | 5V | 1.5A | 7.5W | D+/D- handshake |
| Type-C Default | Type-C | 5V | 500/900mA | 2.5/4.5W | CC pin (56k Rp) |
| Type-C 1.5A | Type-C | 5V | 1.5A | 7.5W | CC pin (22k Rp) |
| Type-C 3.0A | Type-C | 5V | 3.0A | 15W | CC pin (10k Rp) |
| USB PD (SPR) | Type-C | 5–20V | up to 5A | 100W | PD protocol on CC |
| USB PD 3.1 (EPR) | Type-C | 5–48V | up to 5A | 240W | PD protocol on CC |

## Tips

- Always place 5.1 kohm pull-down resistors on both CC1 and CC2 pins of a Type-C receptacle when designing a sink-only device — omitting these resistors means no source will apply VBUS, and the device will not power up
- For sink-only designs that do not need PD, a simple resistor divider and comparator on the CC pin can detect the advertised current level and set the charger IC's input current limit via a GPIO or I2C command
- When using a USB-C receptacle on a board that only needs USB 2.0 data, the SuperSpeed pins (TX/RX) can be left unconnected, but CC1, CC2, VBUS, GND, D+, and D- must still be properly connected
- Verify that the chosen USB-C cable supports the required current — many low-cost cables use 28 AWG VBUS conductors rated for only 3A maximum, and some omit the e-marker chip required for 5A operation

## Caveats

- **BC1.2 detection and Type-C CC advertisement are mutually exclusive mechanisms** — A device behind a Type-C connector should use CC pin detection, not D+/D- BC1.2 probing, to determine current availability. Some charger ICs (BQ25895, BQ25756) support both and select the appropriate method based on the connector type.
- **Not all USB-C ports support USB PD** — Many laptops, power banks, and chargers have Type-C connectors but only provide 5V at default current (500mA–3A). A device that requires PD negotiation for higher voltages should not assume PD is available just because the connector is Type-C.
- **The 5.1 kohm Rd tolerance matters** — The USB Type-C specification allows a +/- 20% tolerance on Rd (4.08k–6.12k). Resistors outside this range may cause intermittent detection failures, especially with strict source implementations.
- **VCONN leakage through the unused CC pin can cause false detection** — If the sink-side CC pin detection circuit does not account for VCONN voltage on the unused CC pin, it may misidentify the cable orientation or current level. Most PD controller ICs handle this internally.

## In Practice

- A custom embedded device with a USB-C receptacle and a TP4056 linear charger fails to charge from a USB-C power adapter because the design omits the 5.1 kohm Rd pull-downs on CC1 and CC2 — the adapter never detects a sink and does not apply VBUS
- A portable instrument draws 800mA from a USB-C laptop port but only configures for 500mA because the firmware relies on USB 2.0 enumeration rather than reading the CC pin voltage, which indicates 1.5A or 3A availability through the Rp value
- A USB-C breakout board used for prototyping routes CC1 and CC2 through the board's pin headers with 10cm jumper wires — the added capacitance and noise on the CC lines cause intermittent PD negotiation failures on some chargers, while simple Rp/Rd current detection still works reliably
- A design that works perfectly with one USB-C cable but fails with another traces to a cable that does not connect the CC wire (some charge-only cables omit CC), preventing the source from detecting a sink and applying VBUS
