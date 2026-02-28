---
title: "USB PD Negotiation"
weight: 20
---

# USB PD Negotiation

USB Power Delivery (PD) is a digital protocol that runs over the CC pin of a USB Type-C connection, enabling source and sink to negotiate voltage and current levels far beyond the 5V default. PD uses Biphase Mark Coding (BMC) at 300 kbaud to exchange structured messages that describe what the source can provide and what the sink wants to consume. The protocol is layered — a physical layer handles encoding and signaling, a protocol layer manages message framing and CRC, and a policy layer implements the negotiation state machine.

For embedded systems, PD most commonly appears in the sink role: a battery-powered device negotiates with a USB-C charger or power adapter to receive 9V, 12V, 15V, or 20V at currents up to 3A or 5A. This negotiation replaces the fixed 5V limitation of legacy USB and enables rapid charging of lithium-ion batteries, direct powering of motor controllers or LED drivers, and elimination of barrel-jack power supplies in favor of a universal USB-C input.

## BMC Signaling on the CC Pin

PD messages are transmitted as BMC-encoded data on the active CC pin (the same pin used for Rp/Rd current advertisement). BMC encoding represents each bit as a transition: a '1' bit produces a transition at the midpoint of the bit period, while a '0' bit produces no midpoint transition. Every bit boundary has a transition, providing embedded clocking.

Key signaling parameters:

| Parameter | Value |
|-----------|-------|
| Data rate | 300 kbaud |
| Encoding | Biphase Mark Coding (BMC) |
| Voltage swing | ~1.1V peak-to-peak on CC, AC-coupled |
| Preamble | 64-bit alternating pattern for clock recovery |
| CRC | CRC-32 over message payload |

The BMC signal is AC-coupled onto the CC pin, superimposed on the DC voltage used for Rp/Rd detection. This means the analog current-level detection (via Rp/Rd voltage divider) and the digital PD protocol coexist on the same physical wire. A PD PHY (such as the FUSB302) handles the separation of the DC and AC components internally.

## PD Message Structure

Every PD message follows a fixed structure:

```
| Preamble (64b) | SOP (4x K-codes) | Header (16b) | Data Objects (0-7 x 32b) | CRC-32 (32b) | EOP (1x K-code) |
```

- **SOP (Start of Packet)**: Four K-code symbols that identify the message target. SOP messages go to the port partner. SOP' messages go to the cable e-marker (plug nearest to the message sender). SOP'' reaches the far-end plug.
- **Header (16 bits)**: Contains the message type, number of data objects, message ID (3-bit rolling counter), port role (source/sink), and specification revision.
- **Data Objects**: Each is 32 bits. The number and format depend on the message type. Power Data Objects (PDOs) describe available power, Request Data Objects (RDOs) describe what the sink wants.

## PD Message Types

The most important messages for sink negotiation:

| Message | Direction | Purpose |
|---------|-----------|---------|
| Source_Capabilities | Source to Sink | Lists all available PDOs (voltage/current combinations) |
| Request | Sink to Source | Selects a specific PDO and requests operating/maximum current |
| Accept | Source to Sink | Confirms the source will provide the requested power |
| Reject | Source to Sink | Denies the request (source cannot provide it) |
| PS_RDY | Source to Sink | Power supply is ready at the new voltage/current |
| GoodCRC | Both | Acknowledges receipt of each message (sent automatically by the PHY) |
| Get_Source_Cap | Sink to Source | Requests the source to resend its capabilities |
| Soft_Reset | Both | Resets the PD protocol layer, renegotiates |
| Hard_Reset | Both | Resets everything including VBUS (returns to 5V vSafe5V) |

### GoodCRC and Retry

Every PD message must be acknowledged with a GoodCRC response within tReceive (1.0ms). If the sender does not receive GoodCRC, it retries up to nRetryCount times (typically 2). If all retries fail, the protocol enters an error state that may trigger a soft or hard reset. The GoodCRC response is handled by the PD PHY hardware — it does not require firmware intervention on most controllers.

## Power Data Objects (PDOs)

PDOs describe the source's capabilities. There are several PDO types:

### Fixed Supply PDO

The most common PDO type. Encodes a fixed voltage and maximum current:

```
Bits 31:30 = 00 (Fixed Supply)
Bits 29:20 = Voltage in 50mV units (e.g., 100 = 5.0V, 180 = 9.0V)
Bits  9:0  = Maximum current in 10mA units (e.g., 300 = 3.0A)
Bits 28:22 = Various flags (dual-role power, USB suspend, unconstrained power, etc.)
```

Example: A 20V/3A Fixed PDO: voltage field = 400 (20.0V / 50mV), current field = 300 (3.0A / 10mA).

A typical 65W charger might advertise:

| PDO # | Type | Voltage | Max Current | Power |
|-------|------|---------|-------------|-------|
| 1 | Fixed | 5V | 3A | 15W |
| 2 | Fixed | 9V | 3A | 27W |
| 3 | Fixed | 15V | 3A | 45W |
| 4 | Fixed | 20V | 3.25A | 65W |

PDO #1 is always 5V (the specification requires this as the first PDO). The remaining PDOs are listed in ascending voltage order.

### Augmented PDO (PPS — Programmable Power Supply)

PPS PDOs allow the sink to request any voltage within a continuous range, in 20mV steps, and adjust dynamically:

```
Bits 31:28 = 1100 (Augmented PDO, PPS)
Bits 24:17 = Maximum voltage in 100mV units
Bits 15:8  = Minimum voltage in 100mV units
Bits  6:0  = Maximum current in 50mA units
```

Example PPS PDO: 3.3V–11.0V at up to 3A. The sink can request 5.00V, 5.02V, 5.04V, ..., up to 11.00V in 20mV increments, and can change the requested voltage at runtime without a full renegotiation. PPS enables direct battery voltage tracking for CC-CV charging without a dedicated charger IC — the PD controller requests the exact voltage the battery needs at each moment.

### Variable Supply PDO

Specifies a voltage range (min to max) at a given maximum current. Less common in practice than Fixed or PPS.

## PD Sink Negotiation Flow

The standard negotiation sequence for a PD sink:

```
Source                          Sink
  |                               |
  |--- Source_Capabilities ------>|   (lists all available PDOs)
  |<-- GoodCRC -------------------|
  |                               |   (sink evaluates PDOs, selects one)
  |<-- Request --------------------|   (specifies PDO index, operating/max current)
  |--- GoodCRC ------------------>|
  |--- Accept -------------------->|   (source agrees to provide requested power)
  |<-- GoodCRC --------------------|
  |                               |   (source adjusts VBUS to new voltage)
  |--- PS_RDY -------------------->|   (VBUS is now stable at new voltage)
  |<-- GoodCRC --------------------|
  |                               |   (sink may now draw requested current)
```

Timing constraints:

| Parameter | Value | Description |
|-----------|-------|-------------|
| tSenderResponse | 24–30ms | Max time for sink to send Request after Source_Capabilities |
| tPSTransition | Max 550ms | Max time for source to transition VBUS to new voltage |
| tSinkTransition | Max 15ms | Max time for sink to reduce current before voltage transition |
| tPSHardResetMax | 35ms | Max time before hard reset if PS_RDY not received |

If the sink fails to send a Request within tSenderResponse, the source may resend Source_Capabilities. After nCapsCount (50) retries without a response, the source stops offering PD and falls back to Type-C default current.

## STUSB4500: Autonomous PD Sink Controller

The ST STUSB4500 (QFN-24, also available in WLCSP) is a standalone USB PD sink controller that negotiates a PD contract without any MCU intervention. The desired voltage and current are programmed into its internal NVM (non-volatile memory), and the chip handles the entire negotiation autonomously at power-up.

### Key Features

- USB PD 3.0 compliant, up to 100W (20V/5A)
- Three configurable Power Data Object (PDO) request profiles stored in NVM
- Integrated CC logic, BMC PHY, and PD protocol engine
- VBUS path control via external PMOS FET with gate drive output
- POWER_OK output indicates a valid PD contract is established
- I2C interface for runtime status and optional dynamic reconfiguration
- No firmware required — operates purely from NVM settings

### NVM Configuration

The STUSB4500 NVM stores the device's PDO requests. The three PDO profiles (PDO1 is always 5V) can be configured using ST's GUI tool or directly via I2C writes to NVM shadow registers followed by a program command.

Key NVM registers:

| Register | Address | Purpose |
|----------|---------|---------|
| DPM_PDO_NUMB | 0x70 | Number of sink PDOs (1–3) |
| DPM_SNK_PDO1 | 0x85–0x88 | PDO1 (always 5V, current configurable) |
| DPM_SNK_PDO2 | 0x89–0x8C | PDO2 (voltage and current) |
| DPM_SNK_PDO3 | 0x8D–0x90 | PDO3 (voltage and current) |
| RDO_REG_STATUS | 0x91–0x94 | Current active RDO (read-only) |
| USB_PD_STATUS | 0x28 | Connection status and CC orientation |

Example: configuring the STUSB4500 to request 9V/3A as the preferred PDO:

```c
// Write to NVM shadow registers via I2C
// PDO2: 9V / 3A (Fixed Supply)
uint8_t pdo2_data[4] = {
    0x00,  // Byte 0: bits 9:0 = current in 10mA (300 = 0x12C)
    0x2C,  // Byte 0-1: current field low byte (0x2C = lower bits)
    0x91,  // Byte 1-2: voltage in 50mV = 180 = 0x0B4, shifted
    0x00   // Byte 3: fixed supply type (bits 31:30 = 00)
};

// Set number of PDOs to 2
i2c_write_reg(STUSB4500_ADDR, 0x70, 0x02);

// The STUSB4500 will now request 9V/3A from any PD source
// that advertises 9V. If 9V is unavailable, it falls back to 5V (PDO1).
```

### Typical Circuit

A minimal STUSB4500 sink circuit requires:

- STUSB4500 IC with 1.8V and 3.3V decoupling capacitors
- 5.1 kohm Rd resistors on CC1 and CC2 (sometimes integrated, verify datasheet revision)
- External PMOS FET (e.g., Si2301) on VBUS path, gate driven by the STUSB4500 VBUS_EN_SNK output
- POWER_OK output connected to the downstream regulator's enable pin
- I2C pull-ups (4.7 kohm to 3.3V) if runtime monitoring is desired

The POWER_OK output goes high only after a successful PD negotiation, making it ideal for gating the system power-on sequence.

## FUSB302: Firmware-Driven PD PHY

The ON Semiconductor (onsemi) FUSB302 is a USB Type-C port controller with an integrated BMC PHY. Unlike the STUSB4500, the FUSB302 does not contain a PD policy engine — firmware running on an MCU must implement the PD state machine, constructing and parsing messages through the FUSB302's register interface. This makes it more flexible but requires significantly more development effort.

### Register Map Overview

The FUSB302 has a compact register set (addresses 0x01–0x43):

| Register | Address | Purpose |
|----------|---------|---------|
| Device_ID | 0x01 | Part identification and revision |
| Switches0 | 0x02 | CC pin measurement and VCONN switches |
| Switches1 | 0x03 | CC pin TX enable and auto-CRC |
| Measure | 0x04 | CC voltage measurement comparator DAC |
| Control0 | 0x06 | Auto-retry, host current advertisement |
| Control1 | 0x07 | RX flush, enable SOP' messages |
| Control3 | 0x09 | Auto-retry count, auto soft/hard reset |
| Power | 0x0B | Internal oscillator and bandgap enable |
| OCP | 0x0C | Overcurrent threshold setting |
| Status0 | 0x40 | CC line status, VBUS level, activity |
| Status1 | 0x41 | RX token and message status |
| Interrupt | 0x42 | Interrupt flags (CRC pass/fail, activity) |
| FIFOs | 0x43 | TX/RX FIFO access point |

### CC Monitoring

To detect a source connection, configure the FUSB302 to measure the CC pin voltages:

```c
// Enable internal oscillator and measurement block
fusb302_write(POWER_REG, 0x07);  // Enable bandgap, receiver, measure

// Configure to measure CC1
fusb302_write(SWITCHES0_REG, 0x07);  // MEAS_CC1, PU_EN off, PDWN1+PDWN2

// Read CC1 voltage via the comparator
// Set Measure register DAC to threshold, then read Status0.BC_LVL
fusb302_write(MEASURE_REG, 0x31);  // Set comparator DAC ~1.6V

uint8_t status = fusb302_read(STATUS0_REG);
uint8_t bc_lvl = status & 0x03;  // BC_LVL field
// 00 = < 200mV (no connection)
// 01 = > 200mV, < 660mV (default current)
// 10 = > 660mV, < 1230mV (1.5A)
// 11 = > 1230mV (3.0A)
```

### BMC TX/RX

Transmitting a PD message through the FUSB302:

```c
// Build a PD Request message for PDO #2 (9V/3A)
uint8_t header[2] = {
    0x02,  // Message type = Request, Data role = UFP
    0x12   // Num data objects = 1, Message ID = 1
};

// Request Data Object: Object Position = 2, Operating Current = 3A
uint32_t rdo = (2 << 28) |       // Object position (PDO #2)
               (300 << 10) |      // Operating current: 300 x 10mA = 3A
               (300 << 0);        // Max operating current: 3A

// Write to FUSB302 TX FIFO
uint8_t tx_buf[7];
tx_buf[0] = 0x12;  // TX SOP token sequence
tx_buf[1] = header[0];
tx_buf[2] = header[1];
tx_buf[3] = (rdo >> 0)  & 0xFF;
tx_buf[4] = (rdo >> 8)  & 0xFF;
tx_buf[5] = (rdo >> 16) & 0xFF;
tx_buf[6] = (rdo >> 24) & 0xFF;
// CRC is appended automatically by FUSB302 when auto-CRC is enabled

fusb302_write_fifo(tx_buf, sizeof(tx_buf));
// Write TX_ON to Control0 to start transmission
```

### Building a PD State Machine

A minimal PD sink state machine using the FUSB302 involves:

1. **Disconnected**: Monitor CC1/CC2 for source attachment (BC_LVL > 0).
2. **Attached**: Source detected. Enable BMC receiver on the active CC pin. Wait for Source_Capabilities message.
3. **Evaluating**: Parse Source_Capabilities PDOs. Select the best match for the application's voltage/current needs.
4. **Requesting**: Send a Request message specifying the selected PDO and desired current.
5. **Transition**: Wait for Accept, then PS_RDY. VBUS transitions to the new voltage during this phase.
6. **Contract**: PD contract active. Monitor for renegotiation (new Source_Capabilities) or errors.
7. **Error Recovery**: Handle soft/hard reset. After a hard reset, VBUS returns to 5V and renegotiation restarts.

Open-source PD stacks (such as the PD Buddy firmware, or the USB-PD library for STM32) implement this state machine and can be adapted for custom hardware built around the FUSB302.

## Voltage Transition Timing and VBUS Capacitance

During a PD voltage transition (e.g., 5V to 20V), the VBUS rail must ramp smoothly. The USB PD specification limits the VBUS capacitance that the sink may present:

| Parameter | Value |
|-----------|-------|
| Maximum sink VBUS capacitance | 10uF per volt of negotiated voltage |
| Maximum slew rate tolerance | Source must reach new voltage within 550ms |
| Minimum VBUS discharge rate | 0.5V/ms when transitioning from higher to lower voltage |

Excessive output capacitance on the sink can slow the source's voltage ramp and cause timing violations. A design that places 100uF of bulk capacitance directly on VBUS may work with some chargers but fail PD compliance testing. The recommended approach is to place only the minimum necessary capacitance (10–22uF ceramic) at the Type-C connector, followed by a load switch or soft-start circuit that isolates the larger system capacitance during PD negotiation.

## Renegotiation, Soft Reset, and Hard Reset

### Renegotiation

Either the source or sink can initiate renegotiation at any time:

- The source sends new Source_Capabilities (e.g., if another port now shares its power budget).
- The sink sends Get_Source_Cap to request the source's current capabilities.
- The sink sends a new Request to change its operating current (within the existing contract's limits) or request a different PDO.

### Soft Reset

A soft reset resets only the PD protocol layer — VBUS stays at its current level, and the negotiation restarts from Source_Capabilities. This is used when a protocol error occurs (message ID mismatch, unexpected message type) but the power path is still functional.

### Hard Reset

A hard reset resets everything. VBUS returns to vSafe5V (approximately 5V), and both sides restart negotiation from scratch. Hard resets are triggered when:

- The sink does not receive PS_RDY within tPSHardReset (800ms from Accept).
- The source detects a fault condition.
- Either side receives a CRC error after exhausting retries.

After a hard reset, the sink must reduce its current consumption to the default USB level (500mA/900mA) until a new PD contract is established.

## USB PD 3.1 Extended Power Range (EPR)

USB PD 3.1 extends the maximum voltage beyond 20V:

| Voltage | Max Current | Max Power | New in PD 3.1 |
|---------|-------------|-----------|---------------|
| 28V | 5A | 140W | Yes |
| 36V | 5A | 180W | Yes |
| 48V | 5A | 240W | Yes |

EPR requires an electronically marked cable rated for the higher voltage. The negotiation involves an additional EPR mode entry sequence — the sink sends EPR_Mode message after the initial SPR (Standard Power Range) contract is established. EPR sources include laptop chargers (140W, 180W models from Lenovo, Apple, and Dell) and high-power desktop power supplies.

For embedded systems, EPR opens possibilities for directly powering 24V or 36V actuators, motors, and LED arrays from a USB-C source without intermediate boost conversion.

## PPS: Programmable Power Supply

PPS allows dynamic voltage adjustment in 20mV steps within the range specified by an Augmented PDO. The key use cases for embedded systems:

1. **Direct CC-CV battery charging**: The PD controller requests the exact voltage the battery needs at each moment, eliminating the need for a separate charger IC with voltage regulation. The PD source acts as the CC-CV regulator.
2. **MPPT for solar-charged systems**: While unusual, a PPS sink could theoretically adjust its voltage request to optimize power draw from a solar-powered PD source.
3. **LED current control**: Requesting a voltage slightly above the LED string's forward voltage, combined with a simple current-sense resistor, can replace a dedicated LED driver.

PPS contracts require periodic refresh: the sink must resend a Request within tPPSTimeout (14 seconds) or the source reverts to vSafe5V. This "keepalive" ensures the sink is still present and functioning.

```c
// Example: PPS voltage request update (every 10 seconds)
// Request voltage = 8.40V (420 x 20mV), current limit = 2A
uint32_t rdo_pps = (1 << 28) |           // Object position (PPS PDO index)
                   (420 << 9) |            // Output voltage: 420 x 20mV = 8.40V
                   (40 << 0);              // Operating current: 40 x 50mA = 2.0A

send_pd_request(rdo_pps);
// Timer must re-send before 14 seconds elapse
```

## Practical PD Sink Design Considerations

### Input Capacitance Budget

Keep VBUS capacitance low at the connector. Place 10uF X5R ceramic (25V or higher rated) directly at the connector, and isolate the bulk system capacitance behind a load switch that enables after PS_RDY.

### Voltage Rating of VBUS Path Components

If the system negotiates 20V, every component on the VBUS path — input capacitors, TVS diodes, load switches, Schottky diodes — must be rated for at least 25V (with margin). Designs that use 16V-rated capacitors because "we only ever request 9V" risk damage if a protocol error causes the source to apply 20V during renegotiation.

### Fallback Behavior

Always design for graceful fallback. If PD negotiation fails, the system should operate (perhaps in a reduced-performance mode) at 5V from the Type-C default current. A battery-powered device should be able to charge at a slower rate from any 5V USB source, not only from PD chargers.

### Source Compatibility

Test with multiple chargers. Charger implementations vary significantly — some have slow response times, others send non-standard PDO combinations, and a few have firmware bugs that cause negotiation failures with certain request patterns.

## Tips

- Start development with an off-the-shelf USB PD analyzer (such as the Power-Z KT002 or Riden TC66C) to capture real PD negotiations and verify that the source under test actually advertises the expected PDOs
- When using the STUSB4500 for a fixed-voltage application (e.g., always request 9V), configure only two PDOs (5V fallback + 9V target) to simplify the negotiation and reduce the chance of the chip selecting an unintended voltage
- For FUSB302-based designs, enable auto-GoodCRC (Control1 register, AUTO_CRC bit) to avoid the tight timing requirement of sending GoodCRC in firmware
- Place a TVS diode rated for the maximum negotiated voltage on VBUS to protect against transients during PD voltage transitions — the BV of the TVS must exceed the maximum PD voltage, not just 5V

## Caveats

- **STUSB4500 NVM has a limited write endurance** (~100 program cycles) — Do not reprogram the NVM on every power cycle; configure it once during manufacturing or development and use I2C runtime registers for dynamic changes
- **FUSB302 does not implement the PD policy engine** — All message construction, parsing, state machine transitions, and timing enforcement must be implemented in firmware, which represents significant development effort (several thousand lines of code for a compliant implementation)
- **PPS contracts require periodic keepalive** — If firmware fails to resend the Request within 14 seconds, the source drops VBUS to 5V, potentially causing a system reset or brownout if the battery charger or regulator cannot handle the sudden input voltage change
- **Some PD sources misbehave after hard resets** — Certain low-cost GaN chargers have been observed to not re-send Source_Capabilities after a hard reset, requiring the device to be physically unplugged and re-plugged to restore PD negotiation

## In Practice

- A custom data logger that negotiates 20V/3A from a PD charger to directly feed a 24V buck-boost converter for its sensor array eliminates a separate AC adapter, running entirely from USB-C — but ships with a prominent label warning users to use only PD-capable chargers, since the device cannot operate its full sensor suite at 5V
- A development board integrating the STUSB4500 powers up in under 200ms at 9V/3A from a PD charger, with POWER_OK gating the LDO enable — but takes 2–3 seconds on a non-PD USB-C charger because the STUSB4500 attempts PD negotiation (and times out) before falling back to 5V Type-C default current
- A FUSB302-based battery charger project adapts an open-source PD stack (PD Buddy) to run on an STM32F042, requesting 9V/2A for fast charging — the initial bring-up takes several days of debugging to get the BMC timing and state machine transitions working reliably across different charger brands
- A design using PPS to implement charger-side CC-CV regulation achieves 97% end-to-end efficiency (no charger IC losses) but must handle the 14-second keepalive timer precisely, as a single missed refresh drops VBUS to 5V and interrupts the charge cycle
