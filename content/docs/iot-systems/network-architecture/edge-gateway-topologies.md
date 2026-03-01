---
title: "Edge Gateway Topologies"
weight: 30
---

# Edge Gateway Topologies

An edge gateway sits between field-level IoT devices and upstream infrastructure — cloud platforms, on-premises servers, or enterprise networks. The gateway performs protocol translation (converting BLE, Zigbee, or Modbus into MQTT or HTTPS), aggregates data from multiple devices, applies local logic, and manages the upstream connection. Gateway topology — where gateways are placed, how many are deployed, and what role each one plays — determines the fault tolerance, latency, bandwidth consumption, and operational complexity of the entire IoT system. A poor topology choice shows up as single points of failure, data gaps during connectivity loss, or gateways that become bottlenecks as the device count grows.

## Gateway Placement Patterns

### Star topology

Every field device connects directly to a single central gateway:

```
[Sensor A] ──→
[Sensor B] ──→ [Central Gateway] ──→ [Cloud/Server]
[Sensor C] ──→
```

The star is the simplest and most common topology for small deployments (under 50 devices in a single building or zone). The gateway is typically a Raspberry Pi, an industrial gateway (e.g., Advantech UNO, Teltonika RUT956), or a custom board running a broker (Mosquitto) and a data forwarder. The central gateway handles all protocol translation and cloud connectivity.

**Capacity limits:** A single Raspberry Pi 4 running Mosquitto can handle 5,000–10,000 concurrent MQTT connections at low message rates (one message per device per minute). The bottleneck is usually the upstream link, not the gateway CPU. At higher message rates (10+ messages per second per device), CPU saturation on the broker becomes the limiting factor — typically around 500–1,000 devices at 10 msg/s on a Pi 4.

**Failure mode:** A single gateway failure takes down the entire deployment. No field data is collected, no commands reach actuators, and no cloud connectivity exists until the gateway is restored.

### Mesh-to-gateway

Field devices form a wireless mesh (Zigbee, Thread, Z-Wave, LoRa mesh) and relay data through the mesh to one or more gateway nodes at the mesh edge:

```
[Sensor A] ←→ [Sensor B] ←→ [Sensor C]
                   ↓
            [Gateway Node] ──→ [Cloud/Server]
```

Zigbee and Thread networks use this pattern natively. Zigbee routers (mains-powered devices) relay traffic for end devices (battery-powered sensors). One or more Zigbee coordinators connect to the gateway hardware. A single Zigbee coordinator supports up to 65,535 logical network addresses, but practical limits are lower — 200–300 devices per coordinator due to routing table size and message throughput constraints.

The mesh provides path redundancy at the field level: if one relay node fails, the mesh re-routes through alternate paths. However, the gateway node at the mesh edge remains a single point of failure unless multiple gateway nodes are provisioned.

### Hierarchical (multi-tier) topology

Field devices connect to local gateways that aggregate data and forward it to a regional gateway, which connects to the cloud:

```
Zone A:  [Devices] → [Local GW A] ──→
Zone B:  [Devices] → [Local GW B] ──→ [Regional GW] → [Cloud]
Zone C:  [Devices] → [Local GW C] ──→
```

Hierarchical topologies appear in large-scale deployments: multi-building campuses, agricultural installations across hundreds of acres, or industrial plants with multiple production lines. Local gateways perform zone-level aggregation (averaging sensor readings, applying threshold alerts, buffering data), reducing the data volume that the regional gateway must forward. A deployment with 1,000 sensors reporting every 10 seconds generates ~6,000 messages per minute; if local gateways aggregate into 1-minute averages, the regional gateway handles only ~100 messages per minute — a 60x reduction.

**Tradeoff:** More infrastructure to deploy, power, and maintain. Each tier adds latency (typically 50–500 ms per hop depending on processing time) and introduces additional failure points.

## Protocol Translation at the Edge

Most IoT field devices speak protocols that cloud platforms do not natively understand. The gateway bridges this gap:

| Field Protocol | Cloud Protocol | Gateway Translation |
|---------------|----------------|-------------------|
| BLE (Bluetooth Low Energy) | MQTT over TLS | Gateway scans BLE advertisements or connects to GATT services, extracts sensor values, publishes to MQTT topics |
| Zigbee / Thread (802.15.4) | MQTT or HTTPS | Zigbee coordinator on the gateway receives ZCL cluster data, deserializes, and republishes |
| Modbus RTU (RS-485) | MQTT or HTTPS | Gateway polls Modbus registers on a schedule, maps register values to MQTT topic payloads |
| Modbus TCP | MQTT or HTTPS | Same mapping as RTU but over Ethernet; gateway acts as Modbus TCP client |
| LoRa / LoRaWAN | MQTT | LoRa concentrator (e.g., RAK2287) receives LoRa frames, gateway decodes and forwards via MQTT |
| Analog (4–20 mA, 0–10 V) | MQTT or HTTPS | ADC on the gateway reads analog inputs, converts to engineering units, publishes |

The translation layer must handle unit conversion, data normalization, and timestamp alignment. A Modbus temperature register might return a raw 16-bit value of 2345 representing 23.45 °C — the gateway converts this to a float and attaches a UTC timestamp before publishing. Inconsistent timestamp handling (local time vs UTC, gateway clock vs device clock) is a persistent source of data quality issues in multi-protocol deployments.

## Local Aggregation vs Direct Cloud Connect

Two architectural philosophies:

### Direct cloud connect

Every device (or every local gateway) sends data directly to the cloud platform. Each data point arrives individually with full fidelity. AWS IoT Core, Azure IoT Hub, and Google Cloud IoT are designed for this model — they handle millions of concurrent device connections natively.

**Advantages:** No intermediate infrastructure to maintain. Data arrives at the cloud with minimum latency (one network hop from device to cloud). Cloud-side processing and storage are elastic.

**Disadvantages:** Cellular or satellite bandwidth costs scale linearly with device count and message rate. A deployment with 500 sensors sending 100-byte messages every 10 seconds consumes ~430 MB/month per sensor — at typical IoT cellular rates ($0.50–$2.00/MB), this is $215–$860/month per device. Adding a local gateway that aggregates into 1-minute averages reduces the data volume by 6x and the cost proportionally.

### Local aggregation

The gateway collects data from field devices, performs local processing (averaging, min/max, threshold detection, anomaly filtering), and sends summarized data to the cloud at a lower rate.

**Aggregation strategies:**
- **Windowed averaging** — Compute the mean of sensor readings over a time window (e.g., 1-minute or 5-minute averages). Reduces data volume proportionally to the window size.
- **Change-of-value (CoV)** — Only forward data when a reading changes by more than a threshold (e.g., temperature changes by more than 0.5 °C). Highly efficient for slowly-changing values but can mask gradual drift.
- **Edge analytics** — Run threshold checks, anomaly detection, or simple ML models on the gateway. Only forward alerts or events rather than raw telemetry. An HVAC monitoring system that forwards a "compressor running hot" alert instead of 10,000 temperature readings per hour reduces cloud-side processing and storage by orders of magnitude.

## Failover and Redundancy

### Active-passive gateway pairs

Two gateways share the same device pool. The active gateway handles all traffic; the passive monitors the active gateway's heartbeat. If the heartbeat is lost (typically a 10–30 second timeout), the passive gateway takes over.

**Implementation options:**
- **VRRP (Virtual Router Redundancy Protocol)** — Both gateways share a virtual IP. Field devices connect to the virtual IP. Failover is automatic and transparent. Requires Ethernet-connected gateways.
- **MQTT Last Will and Testament (LWT)** — The active gateway publishes a retained LWT message to a status topic. The passive gateway subscribes. When the active gateway disconnects, the broker delivers the LWT, triggering the passive to activate.
- **Application-level heartbeat** — The active gateway publishes a heartbeat message every N seconds. The passive gateway promotes itself if M consecutive heartbeats are missed. Simple to implement but failover time is N × M seconds.

### N+1 redundancy

In a hierarchical topology with N local gateways, one spare gateway is pre-provisioned and can replace any of the N gateways that fails. The spare either sits idle (cold standby) or handles a share of the traffic (warm standby, redistributed via load balancing). For deployments where gateway hardware costs $200–$1,000 each, an N+1 model is more cost-effective than active-passive pairs at every location.

### No redundancy (with store-and-forward)

For cost-constrained deployments, a single gateway with store-and-forward capability provides resilience against cloud outages (see below) but not against gateway hardware failure. The acceptable downtime for a single gateway failure depends on the application — environmental monitoring can tolerate hours of data gaps; industrial process control cannot.

## Store-and-Forward for Intermittent Connectivity

Gateways that maintain a local data buffer can survive cloud outages without data loss:

```
[Devices] → [Gateway] → [Local Buffer] → (when connected) → [Cloud]
```

### Buffer storage options

| Storage | Capacity | Write Endurance | Use Case |
|---------|----------|-----------------|----------|
| SD card (gateway filesystem) | 8–128 GB | Limited (wear leveling dependent) | Hours to days of buffering |
| SQLite database | Depends on storage | Same as underlying media | Structured buffering with query support |
| Embedded flash (eMMC) | 4–64 GB | Higher than SD | Industrial gateways |
| USB SSD | 120–500 GB | 100+ TBW | Long-term buffering, weeks of data |
| RAM ring buffer | 1–8 GB (Pi 4/CM4) | Unlimited | Short outages (<1 hour), lost on power failure |

### Sizing the buffer

The buffer must hold all incoming data for the expected maximum outage duration. Calculation:

```
Buffer size = (devices × message_size × messages_per_second) × max_outage_seconds

Example:
  200 devices × 100 bytes × (1 msg / 60 sec) × 86400 sec (24 hours)
  = 200 × 100 × 1440 = 28.8 MB for 24 hours of buffering
```

For most IoT deployments, even modest storage provides days of buffering. The limiting factor is usually not storage capacity but write endurance on SD cards — continuous writes of 28.8 MB/day accumulate to ~10 GB/year, which is within the endurance budget of most industrial-grade SD cards but can degrade consumer-grade cards within 2–3 years.

### Replay after reconnect

When cloud connectivity is restored, the gateway must forward buffered data without overwhelming the upstream link or the cloud ingestion endpoint:

- **Throttled replay** — Send buffered messages at a controlled rate (e.g., 100 messages per second) rather than flushing the entire buffer at once. Burst replay can trigger rate limits on cloud platforms (AWS IoT Core limits to 100 publishes per second per connection by default) or saturate the upstream link.
- **Out-of-order timestamps** — Buffered data has historical timestamps. Cloud-side processing pipelines must handle out-of-order arrival correctly — a common failure is dashboards or alerting rules that interpret replayed historical data as current events, generating false alarms.
- **Deduplication** — If the gateway was uncertain whether a message was delivered before the outage, replaying it may create duplicates. Publishing with MQTT QoS 2 (exactly-once) prevents duplicates at the protocol level but is expensive in round trips. Most deployments use QoS 1 (at-least-once) and handle deduplication on the cloud side using message IDs or idempotent writes.

## Gateway Hardware Considerations

### Raspberry Pi (and compute modules)

The Raspberry Pi 4 and Compute Module 4 are the de facto standard for prototyping and low-volume IoT gateways:

- **Pros:** Low cost ($35–$75), extensive community support, runs full Linux (Debian/Ubuntu), GPIO for interfacing with field devices, USB for Zigbee/LoRa dongles, Ethernet + WiFi + BLE built-in.
- **Cons:** No industrial temperature rating (0–50 °C operating), SD card wear in continuous-write applications, no hardware watchdog by default (BCM2711 has one but it must be explicitly enabled), power supply sensitivity (brownouts cause filesystem corruption).
- **Practical limit:** Handles 200–500 devices with local Mosquitto broker and basic aggregation. CPU becomes the bottleneck under heavy protocol translation (e.g., Modbus polling 100 registers per second while simultaneously running BLE scanning and MQTT forwarding).

### Industrial gateways

Purpose-built for IoT edge deployments:

- **Examples:** Advantech UNO-2271G, Moxa UC-8100A, Teltonika RUT956, Sierra Wireless FX30S
- **Features:** Industrial temperature range (-40 to +70 °C), DIN rail mounting, built-in cellular modems, dual Ethernet, serial ports (RS-232/RS-485), hardware watchdog, ruggedized enclosures (IP30–IP67).
- **Cost:** $300–$2,000 per unit depending on connectivity options and compute power.
- **Practical limit:** Varies by model. Mid-range units (ARM Cortex-A53, 1–2 GB RAM) handle 500–2,000 devices. High-end units (Intel Atom, 4–8 GB RAM) scale to 5,000+ with complex edge analytics.

### Custom boards

For volume deployments (1,000+ gateways), a custom PCB reduces per-unit cost and optimizes for the specific use case:

- **Typical architecture:** i.MX6/i.MX8 or AM335x SoC, 512 MB–2 GB DDR, eMMC storage, Ethernet PHY, USB host for radio dongles (or SPI-connected radio modules), power management IC, industrial power input (9–36 VDC).
- **Cost at volume:** $40–$150 per unit in 1,000+ quantities (excluding NRE for PCB design and certification).
- **Lead time:** 3–6 months from design to production, plus regulatory certification (FCC, CE) if wireless radios are on-board.

## Data Buffering Strategies During Cloud Outages

Beyond basic store-and-forward, several strategies optimize gateway behavior during extended outages:

### Priority-based buffering

Not all data has equal value. During a buffer overflow (outage exceeds buffer capacity), the gateway should discard low-priority data first:

- **Priority 1 (never discard):** Alarms, safety events, actuator state changes
- **Priority 2 (retain recent):** Process variables, operational metrics
- **Priority 3 (discard first):** Diagnostic telemetry, heartbeats, ambient environmental data

Implementing priority-based buffering requires a structured buffer (SQLite database with a priority column) rather than a simple FIFO queue.

### Downsampling on overflow

When the buffer reaches a threshold (e.g., 80% full), the gateway switches to a reduced reporting rate — keeping every Nth sample instead of every sample. A sensor reporting every 10 seconds can be downsampled to every 60 seconds, extending the buffer duration by 6x while preserving trend visibility.

### Local alerting during outage

If the gateway cannot forward data to the cloud, it can still act locally:

- Evaluate threshold rules and trigger local actuators (e.g., shut down a pump if pressure exceeds limits)
- Activate a local visual or audible alarm (LED, buzzer, display)
- Send alerts via SMS through a cellular modem (independent of cloud connectivity)
- Log critical events to non-volatile storage for post-outage forensic analysis

This "island mode" capability is essential for safety-critical applications. A building management gateway that cannot control HVAC because the cloud connection is down represents a design failure — the gateway must be able to operate autonomously for critical functions.

## Tips

- Deploy a local MQTT broker on the gateway (Mosquitto is the standard choice) rather than having field devices connect directly to a cloud broker. The local broker decouples field-side communication from cloud connectivity — devices continue to publish and subscribe normally during cloud outages, and the gateway handles store-and-forward transparently.
- Size the gateway's storage to buffer at least 72 hours of data at peak ingestion rates. Cloud outages due to ISP issues, configuration errors, or platform maintenance routinely last 4–24 hours. The 72-hour buffer provides margin for weekend outages where on-site staff may not be available until Monday.
- Enable the hardware watchdog on Raspberry Pi gateways and configure it to reboot if the main application hangs. A Pi gateway that locks up at 2 AM on a Saturday and requires a manual power cycle causes days of data loss. The BCM2711 hardware watchdog (`bcm2835_wdt` kernel module) reboots the system after a configurable timeout (default 15 seconds).
- Use wired Ethernet for the gateway's upstream connection whenever possible. WiFi-connected gateways are subject to interference, AP reboots, and DHCP lease changes that cause intermittent cloud connectivity failures. Cellular is acceptable for remote sites but costs $5–$50/month per gateway for data plans.
- Provision gateways with static IP addresses or DHCP reservations, and document the IP-to-location mapping. When a gateway goes offline, the first troubleshooting step is reaching it over the network — a gateway with an unknown IP address requires physical access to diagnose.

## Caveats

- **A Raspberry Pi gateway that runs reliably on the bench may fail within weeks in the field due to SD card corruption.** Continuous writes to log files, databases, and buffer queues wear out consumer SD cards. The failure mode is typically a read-only filesystem remount after a block goes bad, which silently stops all data buffering and logging. Industrial-grade SD cards (e.g., SanDisk Industrial, ATP), read-only root filesystems with tmpfs overlays, or eMMC-based compute modules mitigate this.
- **Store-and-forward gateways that replay buffered data after a long outage can trigger cloud-side alert rules if the pipeline does not distinguish between real-time and historical data.** A temperature spike from 3 hours ago, replayed as if current, can trigger an unnecessary emergency response. The cloud ingestion layer must check message timestamps against the current time and route historical data to a backfill pipeline rather than the real-time alerting path.
- **Protocol translation gateways that poll Modbus devices consume significant field-bus bandwidth.** A gateway polling 50 Modbus RTU devices at 1-second intervals over a shared RS-485 bus at 9600 baud can saturate the bus. At 9600 baud, a single Modbus read transaction (request + response for 10 registers) takes approximately 25 ms. Fifty devices at 25 ms each consume 1.25 seconds per poll cycle — exceeding the 1-second target. The options are increasing the baud rate (19200 or 38400), reducing the poll frequency, or splitting devices across multiple RS-485 buses.
- **Gateway failover mechanisms that rely on network connectivity (VRRP, MQTT LWT) do not protect against failures where the gateway loses its upstream link but its local interfaces remain operational.** In this scenario, the active gateway continues to collect field data (appearing healthy to devices) but cannot forward it. The passive gateway never detects a failure because it monitors the active gateway over a network path that is also down. Split-brain detection requires an independent monitoring path — a direct serial connection, a separate management network, or a cellular out-of-band link.

## In Practice

- **A gateway that reports to the cloud intermittently — connecting for a few minutes, dropping for an hour, reconnecting — with no packet loss to local devices** typically has an upstream network issue rather than a gateway hardware problem. Common causes are DHCP lease exhaustion, DNS resolution failures, or a flapping upstream switch port. Monitoring the gateway's local syslog during the outage windows reveals the root cause.
- **Data gaps that appear in cloud dashboards but are not present in the gateway's local buffer** indicate a store-and-forward replay failure rather than a collection failure. The gateway collected the data but the replay mechanism either skipped records (database cursor error), exceeded the cloud platform's rate limit and dropped messages, or encountered a schema mismatch after a cloud-side pipeline update.
- **A multi-gateway deployment where one gateway consistently delivers data 2–5 seconds later than others** often has a resource contention issue. The slow gateway may be performing heavier protocol translation (more Modbus registers, more BLE devices), running edge analytics that consumes CPU time, or writing to a degraded SD card with high I/O latency. Comparing CPU and I/O wait metrics across gateways identifies the bottleneck.
- **A deployment that works perfectly with 50 devices but degrades when scaled to 200 devices on the same gateway** has hit a resource ceiling. The most common bottleneck is not CPU or memory but the MQTT broker's file descriptor limit — Linux defaults to 1024 open file descriptors per process, and each MQTT connection consumes one. Mosquitto must be configured with a higher limit (`max_connections` in mosquitto.conf and `ulimit -n` at the system level) to support more than ~1,000 concurrent connections.
- **A gateway running on a Raspberry Pi that occasionally reboots itself without explanation** is most likely experiencing undervoltage. The Pi 4 requires a stable 5V/3A supply; USB peripherals (Zigbee dongles, cellular modems) can draw enough current to cause brownouts during simultaneous transmit events. The kernel logs `Under-voltage detected!` warnings before the reboot — checking `dmesg` for these messages confirms the diagnosis. A powered USB hub or a higher-rated power supply resolves the issue.
