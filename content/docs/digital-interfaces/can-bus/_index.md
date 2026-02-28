---
title: "CAN Bus in Embedded Systems"
weight: 80
bookCollapseSection: true
---

# CAN Bus in Embedded Systems

CAN (Controller Area Network) is the dominant serial bus in automotive and industrial systems — designed for reliable multi-node communication in electrically noisy environments. Unlike I²C or SPI, CAN is a message-oriented protocol with built-in arbitration, error detection (CRC, bit stuffing, acknowledgment), and automatic retransmission. A two-wire differential bus (CANH, CANL) provides noise immunity over cable runs of 40+ meters at 1 Mbps. The protocol's robustness comes with configuration complexity: bit timing must be calculated precisely, message filters must be set up correctly to avoid FIFO overflows, and error handling state machines must account for bus-off recovery.

This section covers CAN bus firmware implementation: bit timing calculation and baud rate configuration, hardware message filtering and FIFO management, error handling and bus-off recovery strategies, and CAN-FD with its extended data frames and dual bit-rate operation.

## Pages

- **[CAN Bit Timing & Baud Rate]({{< relref "can-bit-timing" >}})** — Time quanta, segment configuration, sample point placement, and the prescaler calculations that achieve standard CAN baud rates from a given peripheral clock.
- **[Message Filtering & FIFO Management]({{< relref "can-filtering" >}})** — Hardware filter banks, mask vs list mode, FIFO assignment, and the strategies that prevent message loss under high bus load.
- **[Error Handling & Bus-Off Recovery]({{< relref "can-error-handling" >}})** — TEC/REC counters, error-active/error-passive/bus-off states, automatic vs manual recovery, and firmware patterns for robust error management.
- **[CAN-FD & Extended Frames]({{< relref "can-fd" >}})** — Flexible data rate operation, dual bit-rate configuration, extended payload sizes up to 64 bytes, and backward compatibility with classic CAN nodes.
