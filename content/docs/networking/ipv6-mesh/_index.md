---
title: "IPv6, 6LoWPAN & Mesh"
weight: 40
bookCollapseSection: true
---

# IPv6, 6LoWPAN & Mesh

IPv6 removes the NAT layer that has historically isolated embedded devices from end-to-end IP connectivity. With 128-bit addresses and stateless autoconfiguration (SLAAC), every sensor node can have a globally routable address — no port forwarding, no gateway translation, no application-layer address rewriting. This matters for embedded systems because it enables direct device-to-cloud and device-to-device communication over standard IP infrastructure.

The challenge is fitting IPv6 over constrained radio links. IEEE 802.15.4 frames carry only 127 bytes, far too small for a 40-byte IPv6 header plus payload. 6LoWPAN solves this with aggressive header compression and fragmentation, enabling IPv6 over low-power radios. Thread builds a self-healing mesh network on top of 6LoWPAN, and Matter extends the reach further by unifying WiFi, Thread, and Ethernet devices under a single application protocol.

## Pages

- **[IPv6 on Embedded Devices]({{< relref "ipv6-embedded" >}})** — Why IPv6 matters for embedded (no NAT, SLAAC), address types, dual-stack RAM cost, and practical IPv6 connectivity on ESP32, STM32, and Zephyr.
- **[6LoWPAN: IPv6 over 802.15.4]({{< relref "6lowpan" >}})** — Header compression, fragmentation for 127-byte frames, 802.15.4 radio basics, hardware platforms, and border router architecture.
- **[Thread & OpenThread]({{< relref "thread-openthread" >}})** — Mesh topology roles, self-healing routing, OpenThread on nRF52840, network commissioning, security model, and performance characteristics.
- **[Matter Protocol: Network Fundamentals]({{< relref "matter-network-layer" >}})** — Multi-transport operation (WiFi, Thread, Ethernet), BLE commissioning, multi-fabric, IPv6 multicast discovery, and SDK flash costs.
- **[Mesh Networking Topologies & Trade-offs]({{< relref "mesh-topologies" >}})** — Thread vs BLE Mesh vs ESP-WIFI-MESH vs Zigbee: flooding vs routing, practical node limits, and when mesh beats star.
