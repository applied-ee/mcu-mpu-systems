---
title: "Ethernet & PoE"
weight: 20
bookCollapseSection: true
---

# Ethernet & PoE

Wired Ethernet eliminates the range uncertainty, interference, and power-hungry radios of wireless connectivity — at the cost of a physical cable. For industrial controllers, PoE-powered sensors, and any device where reliability matters more than mobility, Ethernet remains the preferred transport. On microcontrollers, Ethernet connectivity ranges from integrated MAC peripherals with external PHYs (STM32F4/H7, i.MX RT) to SPI-attached modules (W5500, ENC28J60) that bring networking to any MCU with a free SPI bus.

This section covers the hardware and firmware layers of embedded Ethernet: PHY and MAC configuration, SPI-based Ethernet modules, the lwIP TCP/IP stack that runs on most RTOS platforms, Power over Ethernet PD circuit design, and link-level diagnostics.

## Pages

- **[Ethernet PHY, MAC & RMII/MII]({{< relref "ethernet-phy-mac" >}})** — Internal MAC vs external, RMII vs MII wiring, common PHY chips, MDIO register access, and auto-negotiation.
- **[SPI Ethernet Modules]({{< relref "spi-ethernet-modules" >}})** — W5500 (hardware TCP/IP) vs ENC28J60 (raw frames + lwIP), SPI throughput limits, and driver integration patterns.
- **[lwIP & Embedded TCP/IP Stacks]({{< relref "lwip-tcpip-stack" >}})** — Raw vs netconn vs socket API, memory pool configuration, RTOS integration, and common pitfalls like PCB exhaustion and PBUF starvation.
- **[Power over Ethernet: PD Design]({{< relref "poe-pd-design" >}})** — IEEE 802.3af/at/bt power classes, PD controller ICs, detection handshake, 48V DC-DC conversion, and thermal layout.
- **[Link Management & Diagnostics]({{< relref "ethernet-link-management" >}})** — Link up/down detection, auto-MDIX, cable diagnostics, duplex mismatch, TCP keepalive, and PHY LED outputs.
