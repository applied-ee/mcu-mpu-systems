---
title: "WiFi"
weight: 10
bookCollapseSection: true
---

# WiFi

WiFi is the most capable wireless link available on low-cost microcontrollers — offering megabit throughput, IP-native connectivity, and integration with existing home and enterprise infrastructure. It is also the most power-hungry and RAM-intensive radio option, drawing 100–300 mA during active transmission and requiring 30–50 KB of heap just for a TLS connection. Every WiFi firmware project involves balancing throughput, security, and power consumption against the constraints of the target hardware.

This section covers WiFi from the embedded firmware perspective across multiple platforms — ESP32 (ESP-IDF), Raspberry Pi Pico W (CYW43439), Microchip ATWINC1500, and Linux-based SBCs. Topics range from the 802.11 association flow and reconnection strategies to SoftAP provisioning, WPA3 security, power-saving modes, and local network discovery with mDNS.

## Pages

- **[WiFi Fundamentals for Embedded]({{< relref "wifi-fundamentals" >}})** — 802.11 b/g/n in the MCU context, 2.4 vs 5 GHz trade-offs, association flow, and real throughput ceilings across common platforms.
- **[Station Mode & Connection Management]({{< relref "station-mode" >}})** — Scan → associate → DHCP lifecycle, reconnection strategies, RSSI-based roaming, and multi-platform event-handling patterns.
- **[SoftAP, Captive Portals & Provisioning]({{< relref "softap-captive-portal" >}})** — Running a device as an access point for credential provisioning, DNS hijack captive portals, and alternative provisioning methods (SmartConfig, BLE).
- **[WiFi Security on Constrained Devices]({{< relref "wifi-security" >}})** — WPA2-PSK vs WPA3-SAE, TLS stack RAM costs, certificate pinning, enterprise EAP-TLS, and hardcoded-PSK risks.
- **[WiFi Power Management]({{< relref "wifi-power-management" >}})** — PS-Poll, listen intervals, DTIM tuning, modem sleep vs light sleep, and duty-cycling strategies for battery-powered WiFi devices.
- **[mDNS, HTTP Servers & Local Discovery]({{< relref "mdns-http-local" >}})** — Multicast DNS hostname resolution, lightweight HTTP servers, DNS-SD service advertisement, and memory overhead.
