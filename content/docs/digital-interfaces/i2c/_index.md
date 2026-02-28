---
title: "I²C in Real Systems"
weight: 20
bookCollapseSection: true
---

# I²C in Real Systems

I²C is a two-wire protocol that trades speed for simplicity — two signals (SCL, SDA) can address up to 112 devices on a shared bus. The protocol itself is straightforward, but real-world I²C systems encounter clock stretching stalls, stuck-bus conditions, address collisions, and timing violations that the datasheet examples never show. Most I²C bugs are not protocol errors — they are firmware configuration errors that produce confusing symptoms on the scope.

This section covers I²C from the firmware implementation side: peripheral initialization and clock configuration, multi-byte transfer patterns for sensor and EEPROM devices, error recovery when the bus locks up, and multi-master arbitration for systems with more than one controller on the bus.

## Pages

- **[I²C Initialization & Clock Configuration]({{< relref "i2c-initialization" >}})** — Peripheral setup, timing register calculation, clock speed selection, and the configuration differences across STM32, ESP32, and RP2040.
- **[Multi-Byte Read/Write Patterns]({{< relref "i2c-multi-byte-patterns" >}})** — Register-addressed transfers, repeated start conditions, sequential reads, and the firmware patterns that match real sensor and EEPROM protocols.
- **[Error Recovery & Bus Reset]({{< relref "i2c-error-recovery" >}})** — Detecting stuck buses, clock-pulse recovery, software reset sequences, and building retry logic that actually recovers from real failures.
- **[Multi-Master & Arbitration]({{< relref "i2c-multi-master" >}})** — Arbitration mechanics, clock synchronization, firmware design for multi-master topologies, and when to avoid multi-master entirely.
