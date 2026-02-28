---
title: "PMIC Selection & Integration"
weight: 30
---

# PMIC Selection & Integration

A Power Management IC (PMIC) integrates multiple power functions — battery charger, DC-DC converters, LDOs, power path management, and supervisory logic — into a single package. For battery-powered embedded systems that charge via USB, a PMIC replaces what would otherwise be three to six discrete ICs: a charger controller, a boost converter, one or two buck regulators, an LDO, and a fuel gauge. The integration reduces BOM count, PCB area, and design risk, since the PMIC vendor has already verified the interactions between the charger, power path, and voltage regulators in a tested reference design.

The trade-off is flexibility. A discrete design can use the optimal charger, converter, and LDO for each requirement independently. A PMIC constrains the designer to whatever output rails, current limits, and switching frequencies the vendor chose. In practice, for most portable embedded products — sensor nodes, wearables, handheld instruments, development boards — a well-chosen PMIC simplifies the design dramatically while meeting all performance requirements.

## Why PMICs Over Discrete Components

| Factor | Discrete Design | PMIC Integration |
|--------|----------------|-----------------|
| BOM count | 30–60 components | 10–20 components |
| PCB area | 200–400 mm^2 | 50–150 mm^2 |
| Design effort | High (loop compensation, sequencing, thermal) | Moderate (register configuration, layout) |
| Reference design | Must be assembled from separate eval boards | Vendor provides a complete reference schematic |
| Power path | Requires external ideal diode or load switch | Integrated (charge + system power managed internally) |
| Quiescent current | Sum of all individual ICs (often 20–100 uA total) | Optimized internally (5–30 uA typical) |
| Flexibility | Any combination of voltages and currents | Fixed to PMIC's available rails |

For products where the battery capacity is small (100–1000 mAh) and every microwatt of quiescent current matters, a PMIC with optimized low-Iq modes can extend standby life significantly compared to a discrete approach where each IC contributes its own quiescent draw.

## AXP192: Multi-Rail PMIC for Compact Systems

The AXP192 (X-Powers / Allwinner) is a highly integrated I2C PMIC widely used in the M5Stack ecosystem (M5StickC, M5Core2) and other ESP32-based designs. It provides multiple output rails, a Li-Ion charger, coulomb counter, ADC, and GPIO — all in a QFN-48 package.

### Block Diagram

| Block | Description |
|-------|-------------|
| DCDC1 | 0.7–3.5V, 1.2A, buck converter (typically 3.3V for ESP32) |
| DCDC2 | 0.7–2.275V, 1.6A, buck converter (typically CPU core voltage) |
| DCDC3 | 0.7–3.5V, 0.7A, buck converter (additional rail) |
| LDO1 | 3.3V fixed, 30mA, always-on RTC supply |
| LDO2 | 1.8–3.3V, 200mA, adjustable (LCD backlight, peripherals) |
| LDO3 | 0.7–3.5V, 200mA, adjustable (sensor power, can be used as GPIO) |
| Charger | 4.2V Li-Ion, CC-CV, 100–1320mA configurable |
| Coulomb counter | Integrates charge/discharge current over time |
| ADC | 12-bit, measures VBUS, VBAT, charge current, temperature |
| GPIO | 4 GPIOs with configurable function (output, ADC input, PWM) |

### I2C Register Configuration

The AXP192 uses I2C address 0x34. Key registers:

| Register | Address | Purpose |
|----------|---------|---------|
| Power Output Control | 0x12 | Enable/disable each DCDC and LDO rail |
| DCDC1 Voltage | 0x26 | Set DCDC1 output (25mV steps) |
| DCDC2 Voltage | 0x23 | Set DCDC2 output (25mV steps) |
| DCDC3 Voltage | 0x27 | Set DCDC3 output (25mV steps) |
| LDO2/LDO3 Voltage | 0x28 | LDO2 in bits 7:4, LDO3 in bits 3:0 (100mV steps) |
| Charge Control 1 | 0x33 | Charge enable, charge current, charge voltage target |
| ADC Enable 1 | 0x82 | Enable ADC channels for VBAT, VBUS, current |
| VBUS Current Limit | 0x30 | Set USB input current limit (100/500mA or no limit) |
| Coulomb Counter Control | 0xB8 | Enable/disable coulomb counter, clear |
| Power Off Voltage | 0x31 | VBUS VHOLD voltage, VOFF threshold |

Example: configuring the AXP192 for an ESP32-based device:

```c
// Enable DCDC1 (3.3V) and LDO2 (backlight) and LDO3 (sensor)
axp192_write(0x12, 0x4D);  // Bit 0=DCDC1, 2=LDO2, 3=LDO3, 6=DCDC2

// Set DCDC1 to 3.3V: (3300mV - 700mV) / 25mV = 104 = 0x68
axp192_write(0x26, 0x68);

// Set LDO2 to 3.0V, LDO3 to 2.8V
// LDO2: (3000 - 1800) / 100 = 12 = 0x0C (upper nibble)
// LDO3: (2800 - 700) / 25 = 84... but LDO3 uses different encoding
// LDO2/3 share register 0x28: LDO2 bits 7:4, LDO3 bits 3:0
axp192_write(0x28, 0xC0 | 0x08);  // LDO2=3.0V, LDO3=2.5V

// Configure charger: enable, 4.2V target, 780mA charge current
// Reg 0x33: bit 7 = enable, bits 6:5 = voltage (10=4.2V),
//           bits 3:0 = current (1000 = 780mA)
axp192_write(0x33, 0xC8);

// Set VBUS current limit to 500mA
axp192_write(0x30, 0x62);  // VBUS current limit = 500mA, VHOLD = 4.4V

// Enable ADC for VBAT, VBUS, charge/discharge current, temperature
axp192_write(0x82, 0xFF);
```

### Reading Battery Voltage and Current

```c
// Read VBAT (12-bit, registers 0x78 and 0x79)
uint16_t vbat_raw = (axp192_read(0x78) << 4) | (axp192_read(0x79) & 0x0F);
float vbat_mv = vbat_raw * 1.1;  // LSB = 1.1mV

// Read charge current (13-bit, registers 0x7A and 0x7B)
uint16_t ichg_raw = (axp192_read(0x7A) << 5) | (axp192_read(0x7B) & 0x1F);
float ichg_ma = ichg_raw * 0.5;  // LSB = 0.5mA

// Read coulomb counter (32-bit charge in, 32-bit charge out)
uint32_t coulomb_in = (axp192_read(0xB0) << 24) | (axp192_read(0xB1) << 16) |
                      (axp192_read(0xB2) << 8) | axp192_read(0xB3);
uint32_t coulomb_out = (axp192_read(0xB4) << 24) | (axp192_read(0xB5) << 16) |
                       (axp192_read(0xB6) << 8) | axp192_read(0xB7);
// Net mAh = (coulomb_in - coulomb_out) * 65536 / 3600 / ADC_sample_rate
```

## BQ25895: USB Charger with Boost and HVDCP

The Texas Instruments BQ25895 is a single-cell Li-Ion/Li-Polymer charger with integrated boost converter, supporting input voltages from 3.9V to 14V. It supports HVDCP (High Voltage Dedicated Charging Port) for Qualcomm Quick Charge compatibility, D+/D- BC1.2 detection, and provides a narrow VDC (Voltage Direct Conversion) power path for efficient charging.

### Key Specifications

| Parameter | Value |
|-----------|-------|
| Input voltage range | 3.9V – 14V (absolute max 17.6V) |
| Charge current | Up to 5.056A (programmable in 64mA steps) |
| Charge voltage | 3.840V – 4.608V (programmable in 16mV steps) |
| Boost output | 4.55V – 5.51V, up to 1.4A (for OTG mode) |
| Buck efficiency | Up to 92% at 2A |
| Switching frequency | 1.5 MHz |
| I2C address | 0x6A (7-bit) |
| Package | QFN-24 (4x4mm) |
| Quiescent current | 550 uA (normal), 5.8 uA (ship mode) |

### Register Map Highlights

| Register | Address | Purpose |
|----------|---------|---------|
| REG00 | 0x00 | Input current limit (IINLIM), enable HIZ mode |
| REG01 | 0x01 | VINDPM threshold, HVDCP handshake control |
| REG02 | 0x02 | D+/D- detection control, HVDCP mode |
| REG03 | 0x03 | Charge enable, OTG boost enable, watchdog reset |
| REG04 | 0x04 | Charge current (ICHG) |
| REG05 | 0x05 | Precharge and termination current |
| REG06 | 0x06 | Charge voltage (VREG), BATLOWV, VRECHG |
| REG07 | 0x07 | Watchdog timer, safety timer, thermal regulation threshold |
| REG08 | 0x08 | Compensation resistor, compensation capacitor |
| REG09 | 0x09 | Boost voltage, boost current limit, BATFET control |
| REG0A | 0x0A | Boost mode voltage (BOOSTV) |
| REG0B | 0x0B | Status register (VBUS status, charge status, PG) |
| REG0C | 0x0C | Fault register (watchdog fault, boost fault, charge fault, BAT fault) |
| REG0E | 0x0E | ADC conversion start, read VBAT |
| REG0F-12 | 0x0F–0x12 | ADC results: VBUS, charge current, VBAT, VSYS |

### Narrow VDC Power Path

The BQ25895's narrow VDC architecture regulates the system voltage (VSYS) at a fixed offset above VBAT (typically VBAT + 100mV). This means:

- When charging from USB, the input power goes through a buck converter to VSYS, then simultaneously charges the battery and powers the system.
- The system always runs from VSYS, not directly from VBUS or VBAT.
- When the input is removed, the battery seamlessly takes over (VSYS = VBAT, no switchover glitch).
- Input current = charge current + system current, so the input current limit must be set high enough to cover both.

### Configuration Example

```c
// Set input current limit to 2A (for a 5V/2A adapter)
// REG00: IINLIM = 2000mA (bits 5:0, 50mA per step, offset 100mA)
// (2000 - 100) / 50 = 38 = 0x26
bq25895_write(0x00, 0x26);

// Set charge current to 1024mA
// REG04: ICHG bits 6:0, 64mA per step
// 1024 / 64 = 16 = 0x10
bq25895_write(0x04, 0x10);

// Set charge voltage to 4.208V
// REG06: VREG bits 7:2, 16mV per step, offset 3.840V
// (4208 - 3840) / 16 = 23 = 0x17 -> bits 7:2 = 0x5C
bq25895_write(0x06, 0x5E);  // 4.208V, BATLOWV=3.0V, VRECHG=100mV

// Enable charging, reset watchdog
// REG03: CHG_CONFIG=1, OTG_CONFIG=0, WD_RST=1
bq25895_write(0x03, 0x3A);  // Enable charge, 40s watchdog, min sys = 3.5V

// Start ADC conversion (one-shot)
// REG02: CONV_START=1, CONV_RATE=0 (one-shot)
bq25895_write(0x02, 0x80);

// Wait 1 second, then read ADC results
uint8_t vbus_reg = bq25895_read(0x11);  // VBUS ADC
float vbus_v = 2.6 + (vbus_reg & 0x7F) * 0.1;  // 100mV/step, offset 2.6V

uint8_t vbat_reg = bq25895_read(0x0E);  // VBAT ADC
float vbat_v = 2.304 + (vbat_reg & 0x7F) * 0.02;  // 20mV/step, offset 2.304V
```

## nPM1300: Nordic Semiconductor's Embedded PMIC

The nPM1300 is Nordic Semiconductor's PMIC designed to companion their nRF52/nRF53/nRF91 series wireless SoCs. It integrates two buck regulators, one LDO, a Li-Ion/Li-Poly charger, GPIO, ship mode, and a fuel gauge with no external sense resistor — all controlled via I2C or SPI from the Nordic SoC.

### Key Specifications

| Parameter | Value |
|-----------|-------|
| Buck 1 | 1.0V – 3.3V, 200mA |
| Buck 2 | 1.0V – 3.3V, 200mA |
| LDO 1 | 1.0V – 3.3V, 100mA, with load switch mode |
| Charger | 4.1V or 4.2V, 32–800mA, trickle + CC + CV |
| Fuel gauge | Integrated (no external sense resistor) |
| Input voltage | 4.0V – 5.5V (VBUS) |
| Iq (ship mode) | 470 nA typical |
| Iq (hibernate) | 1.2 uA typical |
| Package | QFN-32 (5x5mm) or WLCSP (2.1x2.1mm) |
| I2C address | 0x6B (7-bit) |

### Register Architecture

The nPM1300 uses a two-byte address scheme: a base address selects the functional block, and an offset selects the register within that block.

| Block | Base Address | Function |
|-------|-------------|----------|
| SYSTEM | 0x00 | System control, reset, task triggers |
| CHARGER | 0x03 | Charger configuration, status, NTC |
| BUCK1 | 0x04 | Buck 1 voltage, mode, enable |
| BUCK2 | 0x05 | Buck 2 voltage, mode, enable |
| LDSW | 0x08 | LDO/load switch configuration |
| GPIO | 0x06 | GPIO configuration (5 GPIOs) |
| ADC | 0x0A | ADC measurement triggers and results |
| FUELGAUGE | 0x0D | Fuel gauge status, SOC, battery model |
| SHIP | 0x0B | Ship mode, hibernate, wakeup config |

### Configuration Example

```c
// Configure Buck 1 for 1.8V (nRF52 core)
// BUCK1.VOUTULP register (base=0x04, offset=0x08)
// Voltage = 1.0V + code * 50mV -> (1800-1000)/50 = 16 = 0x10
npm1300_write(0x04, 0x08, 0x10);  // BUCK1 = 1.8V

// Configure Buck 2 for 3.3V (peripherals)
// BUCK2.VOUTULP register (base=0x05, offset=0x08)
// (3300-1000)/50 = 46 = 0x2E
npm1300_write(0x05, 0x08, 0x2E);  // BUCK2 = 3.3V

// Enable Buck 1 and Buck 2
npm1300_write(0x04, 0x04, 0x01);  // BUCK1 enable
npm1300_write(0x05, 0x04, 0x01);  // BUCK2 enable

// Configure charger: 4.2V, 400mA charge current
// CHARGER.VTERM (base=0x03, offset=0x08)
npm1300_write(0x03, 0x08, 0x03);  // 4.2V termination

// CHARGER.ICHGSET (base=0x03, offset=0x0A)
// Current = 32mA + code * 2mA -> (400-32)/2 = 184 = 0xB8
npm1300_write(0x03, 0x0A, 0xB8);  // 400mA charge current

// Enable charger
npm1300_write(0x03, 0x04, 0x01);

// Enter ship mode (470nA quiescent, wakes on VBUS insertion)
// This latches off all rails until USB is connected
npm1300_write(0x0B, 0x00, 0x01);  // SHIP.TASK_SHIPENTER
```

### Integrated Fuel Gauge

The nPM1300 fuel gauge estimates state-of-charge without an external current-sense resistor. It uses:

- Battery voltage measurement (OCV-based estimation during rest periods)
- Charge/discharge current integration (coulomb counting via internal sense element)
- Battery model parameters stored in firmware (nominal capacity, impedance profile)

The fuel gauge reports SOC as a percentage (0–100%) through I2C registers, eliminating the need for an external gauge IC like the MAX17048 or BQ27441.

## Power Path Management

Power path management determines how the PMIC handles simultaneous USB input power, battery charging, and system load. There are two fundamental architectures:

### System Priority (Power Path Through)

The system load gets first priority. Available input power minus system consumption goes to battery charging:

```
Input Current = System Current + Charge Current
If Input Current Limit is reached: Charge Current is reduced, System power maintained
```

This is the BQ25895's approach (narrow VDC). The system never browns out due to charging, but charge time increases when the system load is high.

### Charge Priority

The battery gets first priority up to its programmed charge current. The system runs from VSYS, which is either VBUS (via LDO or pass FET) or VBAT depending on what is available. If the input current limit is reached, system performance may be affected. This architecture is simpler but can cause system voltage dips during heavy load if the input current limit is marginal.

### Input Current Limit

Every PMIC limits the current drawn from the USB input. This limit must match the source's capability:

| Source Type | Recommended IINLIM |
|-------------|-------------------|
| USB 2.0 SDP (enumerated) | 500mA |
| USB 3.x SDP (enumerated) | 900mA |
| BC1.2 DCP/CDP | 1500mA |
| Type-C 1.5A | 1500mA |
| Type-C 3.0A | 3000mA |
| USB PD (per contract) | Per negotiated PDO |

Setting IINLIM too high causes the source to current-limit or shut down. Setting it too low wastes available charging power.

## Thermal Regulation

All three PMICs discussed here include thermal regulation. When the die temperature exceeds a threshold (typically 100–120 degrees C), the charger automatically reduces the charge current to limit heat generation:

| PMIC | Thermal Regulation Threshold | Behavior |
|------|------------------------------|----------|
| AXP192 | Internal, not user-configurable | Reduces charge current |
| BQ25895 | 60/80/100/120 deg C (REG07 bits 1:0) | Reduces charge current in steps |
| nPM1300 | Die temperature monitored, NTC input for battery temp | Reduces charge current, disables charge below 0 deg C |

The BQ25895 also supports an external NTC thermistor for battery temperature monitoring. If the battery temperature falls outside the configured JEITA window (typically 0–45 deg C for charging), the charger reduces or suspends charging to prevent lithium plating (cold) or thermal runaway (hot).

## Ship Mode and Battery Disconnect

Ship mode is critical for products that ship with a battery installed. In ship mode, the PMIC disconnects the battery from the system rails and enters an ultra-low-power state:

| PMIC | Ship Mode Iq | Wake Source |
|------|-------------|-------------|
| AXP192 | ~2 uA | Power button, VBUS insertion |
| BQ25895 | 5.8 uA (BATFET off) | VBUS insertion (automatic) |
| nPM1300 | 470 nA | VBUS insertion, GPIO |

Without ship mode, a product sitting on a warehouse shelf for months would slowly drain its battery through the PMIC's quiescent current. At 10 uA quiescent from a 500 mAh cell, self-discharge would drain the battery in approximately 50,000 hours (5.7 years) — acceptable. But if downstream loads are not fully disconnected and total system leakage reaches 100 uA, the shelf life drops to approximately 7 months.

## PMIC Selection Criteria

| Criteria | AXP192 | BQ25895 | nPM1300 |
|----------|--------|---------|---------|
| Input voltage range | 4.0–6.5V | 3.9–14V | 4.0–5.5V |
| Output rails | 3x DCDC + 3x LDO | VSYS (1 rail) + boost | 2x Buck + 1x LDO |
| Charge current max | 1320mA | 5056mA | 800mA |
| Boost output (OTG) | None | 4.55–5.51V, 1.4A | None |
| Fuel gauge | Coulomb counter | ADC (no gauge) | Integrated fuel gauge |
| Iq (ship) | ~2 uA | 5.8 uA | 470 nA |
| HVDCP/QC support | No | Yes (up to 12V) | No |
| Package | QFN-48 | QFN-24 (4x4mm) | QFN-32 / WLCSP |
| Best suited for | Multi-rail ESP32 systems | High-current USB charger + OTG | Nordic nRF-based, ultra-low-power |
| Availability / Sourcing | Limited (Chinese supply chain) | Widely available (TI distribution) | Nordic ecosystem |

## Tips

- Start PMIC bring-up with all rails disabled and enable them one at a time via I2C, verifying each output voltage with a multimeter before enabling the next — a misconfigured voltage register can destroy a connected IC instantly
- Set the watchdog timer during development but consider disabling it in production firmware once stability is proven — a watchdog timeout resets the charger configuration to defaults, which may set an inappropriate charge current
- For the BQ25895, always read the status register (0x0B) and fault register (0x0C) after initial configuration to verify no fault conditions exist before enabling charging
- When using the AXP192 with an ESP32, configure the VBUS current limit (register 0x30) immediately at boot — the default may be too low for the ESP32's Wi-Fi transmit current plus charge current

## Caveats

- **AXP192 documentation is primarily in Chinese** — English datasheets exist but are often incomplete or machine-translated; cross-referencing with the Chinese-language datasheet and M5Stack's open-source driver code provides more reliable register descriptions
- **BQ25895 watchdog resets charge parameters to defaults** — If firmware does not periodically reset the watchdog (REG03 bit 6), all charge parameters revert to default values after the watchdog timeout (40/80/160 seconds), which may mean an unsafe charge current for the connected battery
- **nPM1300 fuel gauge accuracy depends on the battery model** — Without proper characterization of the specific cell's impedance and capacity curve, SOC estimates from the nPM1300 fuel gauge may be off by 10–20% or more
- **I2C bus contention during boot** — If the PMIC shares an I2C bus with other peripherals, and the PMIC's interrupt line is not properly handled, repeated I2C traffic from the PMIC can delay or block communication with other devices during the boot sequence

## In Practice

- An M5StickC-based environmental monitor uses the AXP192 to power an ESP32-PICO, BME280 sensor, and SH1107 OLED from a 120 mAh LiPo, achieving 14 hours of continuous runtime — the AXP192's coulomb counter provides a reliable battery percentage display without requiring an external fuel gauge IC
- A GPS tracker prototype uses the BQ25895 to charge a 3000 mAh cell at 2A from a 5V/3A USB-C adapter (with 10k Rp on CC), with the narrow VDC power path keeping the GPS module and cellular modem running during charging without any voltage glitches at the transition between USB-powered and battery-powered operation
- A Bluetooth sensor tag built on the nRF52840 uses the nPM1300 in ship mode (470 nA) during warehouse storage, waking when the end user connects a USB-C cable for the first time — the 200 mAh coin-cell LiPo retains over 99% of its charge after 6 months on the shelf
- A design that connects the BQ25895 to a 14V PD source (negotiated by an external STUSB4500) draws 3A charge current from the high-voltage input, reducing USB cable losses compared to the same power at 5V — the BQ25895's internal buck converter steps the 14V input down to VSYS efficiently at 90%+ conversion efficiency
