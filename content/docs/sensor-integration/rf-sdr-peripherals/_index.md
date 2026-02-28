---
title: "RF & SDR Peripherals"
weight: 80
bookCollapseSection: true
---

# RF & SDR Peripherals

Radio-frequency peripherals extend a sensor node's reach beyond wired buses — transmitting measurements to gateways, receiving commands from base stations, or scanning the RF spectrum for signals of interest. The integration challenge is partly electrical (antenna matching, ground plane layout, power supply filtering) and partly firmware (SPI command sequences, packet framing, timing constraints between TX and RX windows). Most RF modules communicate over SPI with an interrupt line for event notification, making the bus-level integration familiar, but the protocol-level complexity — frequency planning, modulation parameters, link budgets — adds a layer that pure sensor work does not require.

This subsection covers the most common RF module families encountered in embedded sensor projects, from long-range sub-GHz links to short-range 2.4 GHz mesh radios, plus software-defined radio receivers for spectrum monitoring and signal analysis.

## Pages

- **[Sub-GHz Radio Modules (LoRa, FSK)]({{< relref "sub-ghz-radio-modules" >}})** — SX1276/SX1262 register configuration, LoRa spreading factor tradeoffs, FSK packet engines, and link budget estimation for long-range sensor networks.
- **[2.4 GHz RF (nRF24, Zigbee, Thread)]({{< relref "2.4ghz-rf-modules" >}})** — nRF24L01+ SPI integration, auto-acknowledgment and retransmit, IEEE 802.15.4 basics, and Thread/Zigbee stack considerations.
- **[SDR Receiver Integration]({{< relref "sdr-receiver-integration" >}})** — RTL-SDR and similar receivers, USB and SPI-based SDR front-ends, sample streaming to an MCU or SBC, and basic signal processing pipelines.
