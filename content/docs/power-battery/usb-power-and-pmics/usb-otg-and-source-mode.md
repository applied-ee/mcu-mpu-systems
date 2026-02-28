---
title: "USB OTG & Source Mode"
weight: 40
---

# USB OTG & Source Mode

USB On-The-Go (OTG) allows a battery-powered device to switch from its normal role as a USB peripheral (sink) to acting as a USB host (source), providing 5V power and data connectivity to downstream devices. In the legacy Micro-B connector world, OTG detection used the ID pin — grounding the ID pin through a special OTG cable signaled the device to assume the host role. With USB Type-C, OTG is subsumed into the broader concept of Dual Role Port (DRP), where the CC pin resistor configuration determines whether a port acts as source or sink, and roles can be swapped dynamically through USB PD role-swap messages.

For embedded systems, OTG source mode enables practical use cases: a handheld data logger that hosts a USB flash drive for data export, a battery-powered instrument that powers and communicates with a USB sensor, or a portable audio recorder that drives a USB microphone. Each of these requires the device to boost its battery voltage up to 5V, provide current to the peripheral, and manage the power budget to avoid draining the battery unexpectedly.

## Legacy OTG: Micro-B and the ID Pin

The original USB OTG specification (USB 2.0 supplement) used the Micro-AB connector, which includes a fifth pin — the ID pin:

| ID Pin State | Resistance | Role |
|-------------|-----------|------|
| Floating (open) | > 100 kohm | B-device (peripheral/sink) |
| Grounded | < 10 ohm | A-device (host/source) |

An OTG cable (Micro-A to Micro-B) shorts the ID pin to ground at the Micro-A end. When a device with OTG support detects a grounded ID pin, it:

1. Activates its internal boost converter to generate 5V on VBUS
2. Enables its USB host controller
3. Begins device enumeration as a host

The ID pin is sampled by the OTG controller or detected via a GPIO interrupt. Many SoCs (STM32F4, ESP32-S3, i.MX RT) have dedicated OTG peripherals with integrated ID pin detection logic.

### Session Request Protocol (SRP) and Host Negotiation Protocol (HNP)

Legacy OTG defined two supplementary protocols:

- **SRP**: Allows the B-device to request the A-device to turn on VBUS (to save power by not keeping VBUS active continuously)
- **HNP**: Allows the A-device and B-device to swap host/peripheral roles without unplugging

These protocols are largely obsolete in the Type-C era, where DRP and USB PD Power Role Swap provide the same functionality with a more robust mechanism.

## Type-C Dual Role Port (DRP)

A Type-C DRP alternates between presenting source (Rp) and sink (Rd) resistors on its CC pins. When another device is connected, the DRP settles into whichever role complements the partner:

- If the partner presents Rd (sink), the DRP detects it during an Rp phase and becomes the source.
- If the partner presents Rp (source), the DRP detects it during an Rd phase and becomes the sink.
- If both ports are DRP, they will eventually settle into complementary roles through the toggling timing.

### CC Resistor Toggling

The DRP toggling sequence operates on a defined duty cycle:

| Parameter | Value |
|-----------|-------|
| tDRP (toggle period) | 50–100ms (implementation specific) |
| Rp duty cycle | 30–70% of tDRP |
| Rd duty cycle | Remainder of tDRP |
| dcSRC.DRP (source %) | Recommended 30–50% for devices that prefer sink |
| dcSRC.DRP (source %) | Recommended 50–70% for devices that prefer source |

A device that prefers to be a sink (e.g., a phone that mostly charges but occasionally hosts a USB drive) should spend more time presenting Rd. A device that prefers to be a source (e.g., a laptop) should spend more time presenting Rp. The asymmetric duty cycle biases the attachment outcome but does not guarantee it.

### DRP Implementation with FUSB302

The FUSB302 supports DRP toggling through its internal toggle engine:

```c
// Configure FUSB302 for DRP mode
// Switches0: Enable both pull-downs (PDWN1, PDWN2)
fusb302_write(0x02, 0x03);  // PDWN1 + PDWN2

// Control2: Configure toggle mode
// TOG_RD_ONLY = 0, TOG_SAVE_PWR bits, TOGGLE bit
fusb302_write(0x08, 0x25);  // Enable DRP toggle, tDRP = default

// Start toggling
fusb302_write(0x08, fusb302_read(0x08) | 0x40);  // Set TOGGLE bit

// The FUSB302 now alternates between Rp and Rd on CC1/CC2.
// When a partner is detected, TOGSS bits in Status1a indicate the result:
//   01 = Presenting Rp (partner is sink -> this device is source)
//   10 = Presenting Rd (partner is source -> this device is sink)
//   11 = Audio accessory detected

// Poll or wait for interrupt
uint8_t status1a = fusb302_read(0x3D);
uint8_t togss = (status1a >> 3) & 0x07;

if (togss == 0x05) {
    // Source role: partner has Rd. Enable VBUS boost.
    enable_otg_boost();
    // Configure for host operation
} else if (togss == 0x06) {
    // Sink role: partner has Rp. Disable boost, enable charging.
    disable_otg_boost();
    // Configure for device operation
}
```

### DRP State Machine

A complete DRP implementation manages the following states:

```
                  +------------+
                  |   DRP      |
                  |  Toggling  |
                  +-----+------+
                        |
               Partner detected
                   /         \
                  v           v
         +-----------+   +-----------+
         | Attached  |   | Attached  |
         | as Source  |   | as Sink   |
         +-----+-----+   +-----+-----+
               |                |
          Enable Boost     Disable Boost
          Apply VBUS       Monitor VBUS
          Enumerate        Wait for Host
               |                |
               v                v
         +-----------+   +-----------+
         | Source     |   | Sink      |
         | Active    |   | Active    |
         +-----+-----+   +-----+-----+
               |                |
          Detach/Error     Detach/Error
               |                |
               v                v
         +------------+   +------------+
         | Discharge  |   | Return to  |
         | VBUS       |   | Toggling   |
         +-----+------+   +------------+
               |
          Return to
          Toggling
```

## USB PD Power Role Swap

When both devices support USB PD, a more graceful role switch is available through the PR_Swap (Power Role Swap) message:

1. One device sends PR_Swap.
2. The partner responds with Accept (or Reject/Wait).
3. If accepted, the current source turns off VBUS, the current sink turns on VBUS, and the roles are swapped.
4. PS_RDY confirms the new source has applied VBUS.

This allows a device to transition from sink to source without a physical disconnect/reconnect, enabling scenarios like a phone that is charging from a laptop and then seamlessly switches to powering a connected peripheral when the laptop is disconnected.

### Data Role Swap (DR_Swap)

Distinct from power role swap, DR_Swap changes which device is the USB host (DFP) and which is the device (UFP) without changing who provides power. This is useful when a device needs to act as a USB host for data but still receive power from the partner.

## Current Advertisement When Acting as Source

When a DRP settles into the source role, it must advertise its current capability through the Rp value on the active CC pin:

| Rp Value (to 5V) | Advertised Current | Typical Use Case |
|------------------|--------------------|-----------------|
| 56 kohm | Default (500/900mA) | Low-power peripherals, USB flash drives |
| 22 kohm | 1.5A | Tablets, small devices |
| 10 kohm | 3.0A | High-power peripherals, PD-capable sinks |

For a battery-powered device acting as OTG source, the advertised current should reflect what the boost converter can actually deliver without excessively draining the battery. A conservative approach is to use the 56 kohm Rp (default current) unless the attached peripheral requires more. Dynamic Rp switching — starting at 56 kohm and increasing to 22 kohm after verifying sufficient battery capacity — adds safety margin.

```c
// Set Rp value on FUSB302 for source mode
// Control0 register, HOST_CUR bits:
//   00 = No current (off)
//   01 = Default (56k equivalent)
//   10 = Medium (22k equivalent, 1.5A)
//   11 = High (10k equivalent, 3.0A)

// Advertise default USB current
fusb302_write(0x06, (fusb302_read(0x06) & 0xF3) | (0x01 << 2));

// Or advertise 1.5A if boost converter supports it
fusb302_write(0x06, (fusb302_read(0x06) & 0xF3) | (0x02 << 2));
```

## OTG Boost Converters

When acting as a USB source from a single Li-Ion cell (2.7V–4.2V), a boost converter is required to generate 5V on VBUS. Several approaches exist:

### Integrated Boost (BQ25895)

The BQ25895 includes a 5V boost converter specifically for OTG mode:

| Parameter | Value |
|-----------|-------|
| Output voltage | 4.550V – 5.510V (64mV steps) |
| Output current | Up to 1.4A |
| Minimum battery voltage | 3.0V (BATFET cutoff) |
| Control | I2C register REG03 bit 5 (OTG_CONFIG) |

```c
// Enable OTG boost mode on BQ25895
// REG03: OTG_CONFIG = 1, CHG_CONFIG = 0 (disable charger)
uint8_t reg03 = bq25895_read(0x03);
reg03 |= (1 << 5);   // OTG_CONFIG = 1
reg03 &= ~(1 << 4);  // CHG_CONFIG = 0 (cannot charge while boosting)
bq25895_write(0x03, reg03);

// Set boost voltage to 5.062V
// REG0A: BOOSTV bits 7:4 (64mV/step, offset 4.550V)
// (5062 - 4550) / 64 = 8 = 0x08
bq25895_write(0x0A, 0x80);  // BOOSTV = 5.062V

// Set boost current limit to 1.4A
// REG0A: BOOST_LIM bits 2:0 = 101 (1.4A)
uint8_t reg0a = bq25895_read(0x0A);
reg0a = (reg0a & 0xF8) | 0x05;  // BOOST_LIM = 1.4A
bq25895_write(0x0A, reg0a);

// Monitor boost status via REG0B and REG0C
// REG0B bits 7:5 = VBUS_STAT: 111 = OTG mode active
// REG0C bit 6 = BOOST_FAULT: 1 = boost fault (overcurrent, VBUS short)
```

The BQ25895 cannot charge the battery and provide OTG boost simultaneously — the charger must be disabled when OTG mode is active. Firmware must detect when OTG is no longer needed and re-enable charging.

### External Boost Converter (TPS61236P)

For higher current requirements or when the charger IC lacks an integrated boost, an external boost converter provides more flexibility:

| IC | Input Range | Output | Max Current | Efficiency | Package |
|----|-------------|--------|-------------|------------|---------|
| TPS61236P | 2.3–5.5V | 5.0V fixed | 3.5A | 93% at 1A | SOT-23-6 |
| TPS61023 | 0.5–5.5V | 5.0V fixed | 600mA | 90% at 200mA | SOT-23-5 |
| TPS61032 | 1.8–5.5V | 5.0V adj | 4.0A (pulsed) | 92% at 500mA | MSOP-10 |
| SY7208 | 2.6–5.5V | Up to 12.6V | 2A | 90% at 1A | SOT-23-6 |

The TPS61236P is particularly suitable for OTG applications: it starts from a single depleted Li-Ion cell (2.3V), provides a fixed 5V output, and delivers up to 3.5A — enough for most USB peripherals including bus-powered hard drives.

```
Typical TPS61236P OTG circuit:

 VBAT ──┬── 4.7uH ──┬── 5V_OTG
        |            |
     10uF (in)    22uF (out)
        |            |
       GND          GND

   EN pin: controlled by MCU GPIO (HIGH = enable boost)
   PGOOD pin: monitored by MCU (HIGH = output in regulation)
```

### VBUS FET Control

Between the boost converter output and the USB-C VBUS pin, a high-side PMOS FET (or a load switch IC) gates the voltage:

```
5V_BOOST ──[ PMOS ]── VBUS_CC_CONNECTOR
              |
           GATE_DRIVE (from MCU or OTG controller)
```

Common choices:

| FET/Switch | RDS(on) | Current | Notes |
|-----------|---------|---------|-------|
| Si2301 (PMOS) | 100 mohm | 2.3A | Cheap, widely used |
| DMG2305UX (PMOS) | 46 mohm | 5A | Lower RDS(on), SOT-23 |
| TPS22918 (load switch) | 52 mohm | 2A | Integrated soft-start, fault flag |
| SiP32431 (load switch) | 50 mohm | 2A | Ultra-small (1mm x 1mm) |

The FET must handle the full OTG current without excessive voltage drop. At 1.5A through a 100 mohm PMOS, the drop is 150mV (5V becomes 4.85V at the connector — still within the 4.75V minimum for VBUS). The gate drive must pull fully to ground for a PMOS (use an NPN inverter or push-pull GPIO if the MCU voltage is not sufficient for V_GS to reach threshold).

## Protecting the Boost Output

### Overcurrent Protection

Most boost converter ICs include switch current limiting, but this protects the converter's inductor, not the output. Additional protection is needed:

- **Current-sense resistor + comparator**: A 50 mohm resistor in series with VBUS generates a measurable voltage drop. At 1.5A, the drop is 75mV. A comparator triggers a fault output if the current exceeds the threshold.
- **Integrated load switch with current limit**: ICs like the TPS22918 include programmable current limiting via an external resistor on the ILIM pin.
- **PMIC fault monitoring**: The BQ25895 monitors boost output current and sets BOOST_FAULT in REG0C if overcurrent is detected, automatically shutting down the boost.

### Short-Circuit Protection

A short circuit on the VBUS pin presents essentially zero impedance to the boost converter output. Without protection:

1. The boost converter attempts to source maximum current.
2. The output capacitor discharges rapidly.
3. The inductor current ramps up until the switch current limit trips.
4. The converter may oscillate between current-limit and recovery, generating high switch node voltages and potentially damaging the IC.

The recommended protection approach is a fast-acting load switch (< 1 us response) between the boost output and VBUS. The TPS22918's overcurrent fault response time is approximately 10 us, which is fast enough to prevent damage in most cases.

### Reverse Current Blocking

When OTG mode is disabled and the device returns to sink mode, external VBUS (from a charger) must not backfeed into the boost converter's output. A Schottky diode or ideal-diode controller between the boost output and the VBUS FET prevents this. Many load switch ICs also block reverse current inherently.

## VBUS Discharge When Switching Roles

When a device transitions from source to sink (or when the OTG peripheral is disconnected), VBUS must be discharged from 5V to vSafe0V (below 0.8V) within tVBUSDischarge (time specified in the USB Type-C spec, typically < 800ms for PD, shorter for non-PD transitions).

Without active discharge, the VBUS capacitance (10–22uF at the connector plus any capacitance on the cable) can hold 5V for several seconds, confusing the partner's port detection logic.

### Discharge Methods

| Method | Discharge Time | Notes |
|--------|---------------|-------|
| Bleed resistor (1 kohm to GND) | ~50ms for 22uF | Simple, but wastes 25mW during normal operation |
| Switched resistor via FET | ~50ms when active | No static power loss; enable only during discharge |
| FUSB302 internal discharge | Controlled by register | Switches0 bit VBUS_MEAS with discharge path |
| BQ25895 VBUS discharge | Automatic on OTG disable | Integrated in the charger IC |

```c
// Enable VBUS discharge on FUSB302 after exiting source mode
// Write to Power register to enable internal pull-down on VBUS
fusb302_write(0x0B, fusb302_read(0x0B) | 0x01);  // Enable discharge path

// Wait for VBUS to drop below 0.8V
// Monitor Status0 VBUSOK bit
while (fusb302_read(0x40) & 0x80) {
    // VBUS still above threshold, wait
    delay_ms(10);
}

// Disable discharge path
fusb302_write(0x0B, fusb302_read(0x0B) & ~0x01);
```

## Powering USB Peripherals from Battery

When designing a battery-powered OTG host, the power budget is the primary constraint:

| Peripheral Type | Typical Current Draw | Battery Impact (1000mAh cell) |
|----------------|---------------------|-------------------------------|
| USB flash drive | 100–200mA | 5–10 hours at idle read |
| USB keyboard | 50–100mA | 10–20 hours |
| USB-UART adapter | 20–50mA | 20–50 hours |
| USB audio interface | 200–500mA | 2–5 hours |
| Bus-powered HDD | 500–900mA | 1–2 hours |
| USB webcam | 300–500mA | 2–3 hours |

The boost converter efficiency affects the actual battery drain. At 90% boost efficiency and 5V/500mA output (2.5W), the battery-side draw from a 3.7V cell is: 2.5W / 0.90 / 3.7V = 751mA. A 1000 mAh cell would last approximately 1.3 hours under continuous load — a useful metric for determining whether OTG is practical for a given application.

### Battery Low Cutoff

Firmware should monitor battery voltage and disable OTG boost when the cell voltage drops to a safe threshold (typically 3.2–3.4V for LiCoO2). Allowing the boost converter to continue running as the battery approaches its cutoff voltage (3.0V) risks deep discharge, which damages the cell and may prevent future charging if the voltage drops below the charger IC's trickle-charge entry threshold (typically 2.8–3.0V).

```c
// Periodic OTG safety check
float vbat = read_battery_voltage();

if (vbat < 3.3) {
    // Low battery warning: notify connected peripheral
    set_led(LED_BATTERY_LOW, ON);
}

if (vbat < 3.1) {
    // Critical: disable OTG to protect battery
    disable_otg_boost();
    disconnect_vbus_fet();
    set_led(LED_OTG_DISABLED, ON);
}
```

## Practical OTG Design Patterns

### Pattern 1: BQ25895 + MCU with OTG PHY

The simplest integrated OTG design uses the BQ25895's internal boost and an MCU with a USB OTG peripheral (STM32F4, ESP32-S2/S3):

```
USB-C ──> BQ25895 ──> VSYS ──> MCU (USB OTG)
              |           |
           Battery     3.3V LDO
              |
         OTG Boost ──> VBUS (via PMOS FET)
```

Firmware switches between charge mode and OTG mode based on the CC pin role detection. When the FUSB302 (or MCU's internal Type-C logic) detects a sink partner, firmware enables OTG boost on the BQ25895 and configures the MCU's USB peripheral as a host.

### Pattern 2: Separate Boost + Charger + USB Hub

For designs that need to host multiple USB peripherals simultaneously:

```
USB-C ──> STUSB4500 ──> Charger IC ──> Battery
                   |
              TPS61236P ──> USB Hub IC ──> Port 1 (peripheral)
                   |                  ──> Port 2 (peripheral)
                   |                  ──> Port 3 (peripheral)
              VBUS FET
                   |
           MCU (USB Host)
```

A dedicated USB hub IC (USB2514B, USB2517) distributes power and data to multiple ports. The total current budget for all ports must not exceed what the boost converter can supply from the battery.

### Pattern 3: Power Bank with Pass-Through

A power bank that charges a device while itself being charged uses the OTG boost and charger simultaneously — which requires a charger IC that supports this (the BQ25895 does not; the BQ25703A does):

```
USB-C IN ──> BQ25703A ──> Battery
                    |
                    ├──> System
                    |
USB-C OUT <── Boost (integrated or external)
```

The BQ25703A supports simultaneous charge and OTG (independent buck and boost paths), making it suitable for power bank and docking station designs.

## Tips

- Start OTG development with a current-limited bench supply set to simulate the battery voltage (3.7V, current limit 2A) rather than using an actual Li-Ion cell — this prevents accidental deep discharge and provides clear current measurement during debugging
- Test OTG functionality with at least three different USB peripherals — behavior varies significantly between USB flash drives (which may draw a large inrush current at insertion), keyboards (which are well-behaved and low-power), and devices that attempt to charge from the OTG port
- When using the BQ25895 for OTG, remember to periodically reset the watchdog timer (REG03 bit 6) even in OTG mode — a watchdog timeout disables OTG boost and drops VBUS, disconnecting the peripheral
- Place the VBUS FET as close to the USB-C connector as possible to minimize the trace inductance between the FET and the connector, reducing voltage overshoot during load transients

## Caveats

- **BQ25895 cannot charge and boost simultaneously** — Entering OTG mode disables the charger. If a user connects both a charger and a peripheral via a USB-C hub, the device must choose one role and cannot provide both functions at once without a more capable PMIC
- **Not all MCU USB peripherals support host mode** — The ESP32 (original, not S2/S3) has a USB-Serial-JTAG peripheral that cannot act as a host. The STM32F103 has a USB device peripheral only. Verify that the chosen MCU has an actual OTG or host-capable USB peripheral before designing the boost converter circuit
- **OTG detection in DRP mode may not be deterministic** — Two DRP devices connected together may settle into either role depending on timing. If a specific role outcome is required, use asymmetric duty cycles or implement PD Try.SRC/Try.SNK behavior
- **Peripheral inrush current can trip the boost converter's overcurrent protection** — A USB flash drive may draw 500mA+ for 10–50ms at insertion. The boost converter's transient response must handle this without shutting down; adding a soft-start delay on the VBUS FET can smooth the inrush

## In Practice

- A handheld barcode scanner uses the BQ25895 OTG boost to power an external USB-HID keyboard for manual data entry — the 1.4A boost limit is more than sufficient for the keyboard's 50mA draw, and the battery (2000 mAh) lasts over 30 hours in OTG mode with the keyboard connected and occasional scanning
- An ESP32-S3-based portable audio recorder enters OTG host mode to connect a USB microphone, using a TPS61236P boost converter for 5V at up to 500mA — the system drains a 3000 mAh battery in approximately 4 hours of continuous recording, dominated by the ESP32-S3's audio processing current rather than the OTG power draw
- A prototype data logger with a USB-C DRP port and FUSB302 toggles between charging (when connected to a power adapter) and hosting a USB flash drive (when the user connects a drive via OTG cable) — initial testing reveals that some USB-C to USB-A adapters present unexpected CC configurations, requiring firmware to handle fallback detection via VBUS presence rather than relying solely on CC pin state
- A design that omits VBUS discharge after disabling OTG boost causes the next charger connection to fail PD negotiation because residual voltage on VBUS (held by 22uF of output capacitance) prevents the charger from detecting the device as a new sink attachment — adding a 1 kohm switched discharge resistor controlled by a GPIO resolves the issue, with VBUS dropping below 0.8V in under 30ms
