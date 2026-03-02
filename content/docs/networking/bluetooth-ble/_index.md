---
title: "Bluetooth & BLE Patterns"
weight: 30
bookCollapseSection: true
---

# Bluetooth & BLE Patterns

Bluetooth Low Energy dominates short-range embedded connectivity — phone-to-device communication, sensor beacons, asset tracking, and mesh networks all run over BLE. The "low energy" label is earned: a BLE peripheral advertising once per second draws roughly 10 µA average, three orders of magnitude less than an active WiFi radio. That efficiency comes from a protocol stack built around short, infrequent bursts of data rather than sustained connections.

This section covers BLE from the firmware engineer's perspective: advertising and GAP roles, GATT service design, pairing and bonding security, connection parameter tuning for throughput or power, power optimization techniques measured with real hardware, and central-role scanning for gateway and aggregator applications.

## Pages

- **[BLE Advertising & GAP]({{< relref "ble-advertising-gap" >}})** — Advertisement packets, scan responses, GAP roles, BLE 5.0 extended advertising, connectable vs non-connectable modes, and power at various advertising intervals.
- **[GATT Services & Characteristics]({{< relref "gatt-services" >}})** — Services, characteristics, descriptors, handles, custom UUIDs, MTU negotiation, and profile design patterns across NimBLE, SoftDevice, and BlueZ.
- **[BLE Bonding & Security]({{< relref "ble-bonding-security" >}})** — Pairing vs bonding, security levels, LE Secure Connections, key storage, resolvable private addresses, and known BLE attacks.
- **[BLE Connection Parameters & Throughput]({{< relref "ble-connection-parameters" >}})** — Connection interval, slave latency, supervision timeout, Data Length Extension, 2M PHY, and real-world throughput measurements.
- **[BLE Power Optimization]({{< relref "ble-power-optimization" >}})** — Advertising interval trade-offs, connection interval tuning for sensors, system-off modes, PPK2 measurement techniques, and BLE vs WiFi power comparison.
- **[BLE Central Role & Scanning]({{< relref "ble-scanning-central" >}})** — MCU as central: scan modes, UUID filtering, multi-connection management, gateway aggregation pattern, and scan window/interval tuning.
