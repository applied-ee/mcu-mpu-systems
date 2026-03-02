---
title: "📶 Networking & Connectivity"
weight: 4
bookCollapseSection: true
---

# Networking & Connectivity

Embedded networking operates under constraints that desktop and server stacks never face — kilobytes of RAM for a TCP/IP stack, milliamps of current budget for a radio, and silicon that must maintain a wireless link while running real-time control loops. The protocols are often the same (IP, TCP, TLS), but the implementation trade-offs are fundamentally different when the endpoint runs on a Cortex-M4 with 256 KB of SRAM.

This section covers the physical, link, and transport layers of embedded connectivity — from WiFi association and BLE GATT profiles to Ethernet PHY configuration and IPv6 mesh networking. Application-layer protocols (MQTT, CoAP, HTTP APIs) and system-level concerns (OTA updates, fleet provisioning, cloud integration) live in [IoT & Systems Integration]({{< relref "/docs/iot-systems" >}}).

## Sections

- **[WiFi]({{< relref "/docs/networking/wifi" >}})** — 802.11 on microcontrollers: station mode, SoftAP provisioning, security, power management, and local discovery.
- **[Ethernet & PoE]({{< relref "/docs/networking/ethernet-poe" >}})** — Wired connectivity from PHY/MAC hardware through TCP/IP stacks to Power over Ethernet PD design.
- **[Bluetooth & BLE Patterns]({{< relref "/docs/networking/bluetooth-ble" >}})** — BLE advertising, GATT services, bonding, connection parameters, power optimization, and central-role scanning.
- **[IPv6, 6LoWPAN & Mesh]({{< relref "/docs/networking/ipv6-mesh" >}})** — IPv6 on constrained devices, 802.15.4 header compression, Thread mesh networking, and Matter protocol fundamentals.
- **[Protocol Selection & Radio Coexistence]({{< relref "/docs/networking/protocol-selection" >}})** — Choosing between wireless protocols, managing 2.4 GHz interference, and TLS/DTLS on resource-limited hardware.
