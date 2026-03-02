---
title: "Protocol Selection & Radio Coexistence"
weight: 50
bookCollapseSection: true
---

# Protocol Selection & Radio Coexistence

Choosing a wireless protocol is one of the earliest and most consequential decisions in an embedded connectivity project. The choice constrains data rate, range, power budget, infrastructure requirements, and which silicon platforms are available — and switching protocols after hardware design means a board respin. There is no universally best protocol; there are only trade-offs along axes that matter differently for each application.

This section provides cross-cutting comparison material: a decision framework for selecting between WiFi, BLE, Thread, Zigbee, Sub-GHz, and cellular; practical guidance on managing radio coexistence when multiple 2.4 GHz protocols share the same spectrum; and the reality of running TLS and DTLS on constrained devices where a single handshake can take seconds and consume tens of kilobytes of RAM.

## Pages

- **[Wireless Protocol Selection Guide]({{< relref "protocol-comparison" >}})** — Decision matrix across WiFi, BLE, Thread, Zigbee, Sub-GHz, and cellular: data rate, range, power, infrastructure needs, IP nativity, and common protocol pairings.
- **[2.4 GHz Radio Coexistence]({{< relref "radio-coexistence" >}})** — WiFi, BLE, Thread, and Zigbee sharing the 2.4 GHz band: PTA on combo chips, channel selection strategies, adaptive frequency hopping, and measuring interference.
- **[TLS & DTLS on Constrained Devices]({{< relref "embedded-tls-dtls" >}})** — TLS 1.2 vs 1.3 handshake costs, mbedTLS RAM footprint, DTLS for UDP protocols, certificate vs PSK authentication, hardware crypto acceleration, and session resumption.
