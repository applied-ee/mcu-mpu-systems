---
title: "Matter Protocol: Network Fundamentals"
weight: 40
---

# Matter Protocol: Network Fundamentals

Matter is an application-layer protocol for smart home devices that runs over three transport networks: WiFi, Thread, and Ethernet. BLE is used exclusively for commissioning — the initial pairing process that provisions network credentials — and is not used for runtime communication. This multi-transport approach means a Matter light bulb on Thread and a Matter thermostat on WiFi can communicate through a shared controller without protocol translation, because both speak the same IPv6-based application protocol.

The protocol emerged from the CHIP (Connected Home over IP) project, driven by Apple, Google, Amazon, Samsung, and the Connectivity Standards Alliance (CSA). The goal was to end the fragmentation of HomeKit, Google Home, Alexa, and SmartThings into incompatible ecosystems. Whether Matter succeeds at that goal depends on ecosystem cooperation, but the underlying network architecture is well-designed and worth understanding for embedded development.

## Network Architecture

### Transport Independence

Matter's defining architectural choice is separating the application protocol from the transport:

```
┌────────────────────────────────────────┐
│         Matter Application Layer       │
│  (Clusters, Commands, Attributes)      │
├────────────────────────────────────────┤
│       Matter Interaction Model         │
│  (Read, Write, Invoke, Subscribe)      │
├────────────────────────────────────────┤
│        Matter Message Layer            │
│  (Encryption, Session, Exchange)       │
├────────────────────────────────────────┤
│          Matter Transport              │
│    (UDP/IPv6 — MRP reliable layer)     │
├──────────┬──────────┬──────────────────┤
│  Thread  │   WiFi   │    Ethernet      │
│(802.15.4)│(802.11)  │   (802.3)        │
└──────────┴──────────┴──────────────────┘
```

All Matter devices communicate using UDP over IPv6. The Matter Reliable Protocol (MRP) adds acknowledgments and retransmissions on top of UDP, providing reliability without the overhead and state management of TCP. MRP's retransmission parameters are tuned per transport:

| Parameter | WiFi/Ethernet | Thread (SED) |
|-----------|--------------|--------------|
| Initial retransmit timeout | 300 ms | 1000 ms |
| Active retransmit timeout | 300 ms | 1000 ms |
| Retransmit count | 3 | 3 |
| Idle retransmit timeout | 500 ms | 3000 ms |

The longer timeouts for Thread SEDs account for the polling delay — a message to a sleepy device may not be delivered until the device wakes and polls its parent.

### IPv6 Multicast for Discovery

Matter devices advertise their presence using IPv6 multicast. Operational discovery uses DNS-SD (DNS Service Discovery) over mDNS:

```
# A Matter device advertises:
_matter._tcp.local.
  SRV: matter-device.local:5540
  TXT: "D=1234" "CM=1" "T=1" "VP=FFF1+8000"

# Where:
#   D    = Discriminator (unique per device)
#   CM   = Commissioning Mode (1 = open)
#   T    = Device Type
#   VP   = Vendor ID + Product ID
```

During commissioning, the commissioner (phone app) discovers commissionable devices via mDNS on the local network or via BLE advertisements. After commissioning, operational discovery uses DNS-SD with compressed instance names derived from the device's operational identity.

### Multi-Admin and Multi-Fabric

A Matter device can belong to multiple **fabrics** simultaneously. Each fabric represents an independent administrative domain — typically a smart home ecosystem:

| Fabric | Example | What It Provides |
|--------|---------|-----------------|
| Fabric 1 | Apple HomeKit | Control via Home app, Siri |
| Fabric 2 | Google Home | Control via Google Home app, Assistant |
| Fabric 3 | Amazon Alexa | Control via Alexa app, voice |

Each fabric has its own:
- Root of Trust (Certificate Authority)
- Fabric ID
- Node Operational Certificate for the device
- Session keys

The device maintains separate security contexts per fabric. A command from Google Home is authenticated against Fabric 2's credentials, while a command from Apple HomeKit uses Fabric 1's credentials. The device processes both independently.

The RAM cost of multi-fabric support is non-trivial. Each additional fabric adds approximately 2–4 KB for certificate storage, session state, and subscription tracking. A device supporting 5 fabrics simultaneously allocates 10–20 KB just for fabric management.

## Commissioning Flow

Commissioning transfers network credentials and security certificates to a new device. The process differs slightly depending on the target transport.

### BLE-to-Thread Commissioning

```
 ┌───────────┐         BLE          ┌──────────────┐
 │Commissioner│◄───────────────────►│  New Device   │
 │  (Phone)   │  PASE (passcode)   │  (Thread)     │
 └─────┬──────┘                     └───────┬───────┘
       │                                     │
       │  1. BLE scan → find device          │
       │  2. PASE key exchange (PIN/QR)      │
       │  3. Send Thread credentials         │
       │     (channel, PAN ID, network key)  │
       │  4. Send NOC (Node Op Certificate)  │
       │  5. Device joins Thread network     │
       │  6. ACK via Thread (not BLE)        │
       │                                     │
       │         Thread (IPv6/UDP)           │
       │◄───────────────────────────────────►│
       │  7. Operational discovery (DNS-SD)  │
       │  8. CASE session establishment      │
       │  9. Device ready for commands       │
```

### BLE-to-WiFi Commissioning

The flow is similar but step 3 sends WiFi credentials (SSID + passphrase) instead of Thread credentials. The device associates with the WiFi network, obtains an IPv6 address, and becomes reachable via mDNS.

### Security During Commissioning

**PASE (Passcode-Authenticated Session Establishment)** — Uses a SPAKE2+ protocol with the device's setup code (8-digit PIN or QR code) to establish an encrypted BLE channel. No pre-shared certificates are needed. The setup code is typically printed on the device or its packaging.

**CASE (Certificate-Authenticated Session Establishment)** — After commissioning, all subsequent sessions use CASE with the Node Operational Certificate issued during commissioning. This provides mutual authentication between the device and the controller.

| Phase | Security | Transport | Duration |
|-------|----------|-----------|----------|
| PASE | SPAKE2+ (setup code) | BLE | ~5 seconds |
| Credential transfer | Encrypted BLE (PASE session) | BLE | ~2 seconds |
| Network join | Thread/WiFi security | Thread/WiFi | 3–10 seconds |
| CASE establishment | Certificate-based TLS-like | UDP/IPv6 | ~2 seconds |
| Total commissioning | — | — | 12–25 seconds |

## Device Types and Clusters

Matter defines a data model where devices expose **endpoints**, each containing **clusters**. A cluster is a set of attributes, commands, and events:

```
Device: Matter Light (Endpoint 1)
├── On/Off Cluster
│   ├── Attribute: OnOff (boolean)
│   ├── Command: On()
│   ├── Command: Off()
│   └── Command: Toggle()
├── Level Control Cluster
│   ├── Attribute: CurrentLevel (uint8, 0-254)
│   ├── Command: MoveToLevel(level, transition_time)
│   └── Command: Step(step_size, transition_time)
├── Color Control Cluster
│   ├── Attribute: CurrentHue (uint8)
│   ├── Attribute: CurrentSaturation (uint8)
│   └── Command: MoveToHueAndSaturation(hue, sat, time)
└── Descriptor Cluster
    ├── Attribute: DeviceTypeList
    └── Attribute: ServerList
```

### Common Device Types

| Device Type | ID | Required Clusters | Typical Transport |
|------------|-----|-------------------|-------------------|
| On/Off Light | 0x0100 | On/Off, Level Control | Thread, WiFi |
| Dimmable Light | 0x0101 | On/Off, Level Control | Thread, WiFi |
| Color Temperature Light | 0x0102 | On/Off, Level, Color Control | Thread, WiFi |
| Contact Sensor | 0x0015 | Boolean State | Thread (SED) |
| Temperature Sensor | 0x0302 | Temperature Measurement | Thread (SED) |
| Door Lock | 0x000A | Door Lock | Thread, WiFi |
| Thermostat | 0x0301 | Thermostat | WiFi, Thread |
| Bridge | 0x000E | Descriptor, Bridged Device Basic | WiFi, Ethernet |

## SDK Options and Resource Requirements

Several vendor SDKs provide Matter implementations:

| SDK | Target SoCs | Transport | Build System |
|-----|------------|-----------|--------------|
| Espressif ESP-Matter | ESP32, ESP32-C3, ESP32-S3, ESP32-H2 | WiFi, Thread | CMake (ESP-IDF) |
| Silicon Labs Matter | EFR32MG24, EFR32MG12 | Thread | CMake (Gecko SDK) |
| Nordic nRF Connect SDK | nRF52840, nRF5340 | Thread | CMake (Zephyr) |
| NXP | K32W, RT1060 | Thread, WiFi | CMake |
| Bouffalo Lab | BL602, BL706 | WiFi, Thread | CMake |
| connectedhomeip (reference) | Linux, any Zephyr target | All | GN + CMake |

### Flash and RAM Costs

Matter's protocol stack is substantially larger than a bare MQTT or CoAP implementation:

| Component | Flash (approx.) | RAM (approx.) |
|-----------|-----------------|----------------|
| Matter core (messaging, crypto, sessions) | 200–250 KB | 40–60 KB |
| Data model (clusters, device types) | 50–100 KB | 10–20 KB |
| Transport (OpenThread for Thread) | 80–120 KB | 30–50 KB |
| Transport (WiFi + lwIP) | 100–150 KB | 50–80 KB |
| Crypto (mbedTLS or PSA) | 50–80 KB | 10–20 KB |
| BLE (commissioning only) | 30–50 KB | 5–10 KB |
| **Total (Thread device)** | **400–600 KB** | **100–160 KB** |
| **Total (WiFi device)** | **430–650 KB** | **120–190 KB** |

These numbers explain why Matter does not run on small MCUs. The nRF52840 (1 MB flash, 256 KB RAM) is the floor for a Thread-based Matter device. WiFi-based devices typically need the ESP32-S3 (8 MB flash, 512 KB SRAM) or similar to have headroom for the application.

For comparison:

| Protocol Stack | Flash | RAM | Suitable MCU |
|---------------|-------|-----|--------------|
| MQTT + TLS (minimal) | 60–100 KB | 30–50 KB | ESP32-C3 (400 KB SRAM) |
| CoAP (no TLS) | 15–30 KB | 5–15 KB | nRF52832 (64 KB RAM) |
| Matter (Thread) | 400–600 KB | 100–160 KB | nRF52840 (256 KB RAM) |
| Matter (WiFi) | 430–650 KB | 120–190 KB | ESP32-S3 (512 KB SRAM) |

## Bridging Non-Matter Devices

A Matter Bridge device exposes non-Matter devices (Zigbee, Z-Wave, proprietary) as virtual Matter endpoints. The bridge translates between Matter's cluster model and the legacy protocol.

```
┌──────────────────────────────────────────┐
│              Matter Bridge               │
│                                          │
│  Endpoint 1: Bridge device (type 0x000E) │
│  Endpoint 2: Zigbee bulb → On/Off Light  │
│  Endpoint 3: Zigbee sensor → Temp Sensor │
│  Endpoint 4: Z-Wave lock → Door Lock     │
│                                          │
│  ┌──────────┐  ┌──────────┐              │
│  │ Zigbee   │  │ Z-Wave   │              │
│  │ Radio    │  │ Radio    │              │
│  └──────────┘  └──────────┘              │
└──────────────────────────────────────────┘
```

Bridges typically run on more capable hardware (ESP32 with external Zigbee radio, Raspberry Pi, or dedicated gateway SoCs like NXP i.MX RT1060 + K32W) because they must maintain the Matter stack plus one or more legacy protocol stacks simultaneously.

## Tips

- Start Matter development with the Espressif `esp-matter` SDK on an ESP32-S3-DevKitC for WiFi devices or the Nordic nRF Connect SDK on an nRF52840-DK for Thread devices. Both have well-maintained examples for common device types (light, sensor, lock) that compile and run without modification.
- Use the chip-tool (from the connectedhomeip repository) as a command-line commissioner during development. It is faster and more debuggable than commissioning through a phone app, and it supports all commissioning modes.
- Monitor flash usage throughout development. The Matter stack consumes 400+ KB before any application code is written. On a 1 MB flash part, this leaves limited space for OTA update staging (which needs a second copy of the firmware image). Dual-bank OTA on a 1 MB part is effectively impossible with Matter; plan for 2+ MB flash.
- Test multi-fabric operation early. A device that works with one ecosystem (e.g., Google Home) may fail when a second fabric is added due to insufficient RAM for the additional certificate and session storage. The per-fabric RAM overhead (2–4 KB) multiplied by the number of supported fabrics should be budgeted during initial design.
- Reduce Matter's flash footprint by disabling unused clusters. A temperature sensor does not need the Level Control or Color Control clusters. The data model is compiled in, so excluding unused clusters saves 5–20 KB of flash per cluster.

## Caveats

- **Matter does not define a cloud protocol** — Matter is strictly local network. Controlling devices remotely (outside the home) requires each ecosystem's proprietary cloud relay (iCloud, Google Home cloud, Alexa cloud). There is no standard for Matter-over-internet.
- **BLE commissioning requires a phone or hub** — Unlike Thread (which can commission via CLI), Matter commissioning is designed around a smartphone flow with QR code scanning. Headless commissioning (factory provisioning without BLE) is possible but not standardized and varies by SDK.
- **OTA updates through Matter are complex** — The OTA Software Update cluster defines the protocol, but the update provider (server), image management, and rollback strategy are left to the implementer. Most vendors delegate this to their cloud platform rather than using Matter's built-in OTA mechanism.
- **Interoperability issues persist despite the standard** — Different ecosystems interpret Matter clusters differently, and device certification testing does not cover all edge cases. A Matter device certified for Google Home may behave unexpectedly on Apple HomeKit due to differences in subscription handling or attribute reporting. Testing across ecosystems is essential.
- **The flash and RAM requirements exclude most legacy MCU platforms** — Retrofitting Matter onto a device originally designed for a simple MQTT telemetry stack is unlikely to succeed without a hardware redesign. The ~400 KB flash and ~100 KB RAM baseline is a hard floor, and production firmware with OTA support and multi-fabric typically needs 600+ KB flash and 150+ KB RAM.

## In Practice

- A Matter-over-Thread light (nRF52840) commissioning flow takes 15–25 seconds end-to-end: BLE advertisement discovery (~3 s), PASE handshake (~5 s), Thread credential transfer (~2 s), Thread network join (~5 s), CASE session (~3 s). This latency is visible to the end user and represents the biggest UX challenge for Matter — every other smart home protocol feels faster because they skip the certificate-based security.
- Building a minimal Matter temperature sensor on ESP32-H2 (Thread) with the Espressif SDK produces a firmware image of approximately 520 KB. With a 4 MB flash part, this leaves 3.5 MB for OTA staging and NVS storage — comfortable. On the nRF52840 (1 MB flash), the same logical application compiles to ~480 KB, leaving only ~500 KB and making dual-bank OTA tight.
- A bridge device running on ESP32 (WiFi) + CC2652R (Zigbee radio via UART) hosts 20 virtual Matter endpoints for Zigbee devices. The Matter stack consumes ~600 KB flash and ~150 KB RAM on the ESP32. Each additional bridged endpoint adds ~2–5 KB RAM for attribute storage and subscription state. With 20 endpoints, total RAM usage reaches ~200 KB — feasible on the ESP32's 520 KB SRAM but requiring careful heap management.
- Development teams that prototype with chip-tool on Linux and then switch to phone-based commissioning (Google Home, Apple Home) for integration testing consistently discover timing-sensitive issues. The phone apps enforce stricter timeouts during PASE and CASE than chip-tool does, and some commissioning failures only appear with the production commissioner.
- Matter's subscription model (where a controller subscribes to attribute changes and receives reports asynchronously) generates background traffic on Thread networks. Each active subscription sends a periodic keepalive report. A controller subscribed to 20 devices with 30-second report intervals generates ~40 packets/minute of Thread traffic — manageable, but worth monitoring on networks with many devices.
