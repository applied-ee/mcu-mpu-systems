---
title: "Fleet Monitoring"
weight: 30
---

# Fleet Monitoring

Fleet monitoring is the practice of continuously collecting, transmitting, and analyzing health telemetry from deployed embedded devices to detect failures, performance degradation, and anomalous behavior before they escalate to outages. Unlike server monitoring — where agents run on machines with gigabytes of RAM and gigabit network links — embedded fleet monitoring operates under severe constraints: microcontrollers with 64–512 KB of RAM, cellular connections billed per kilobyte, and battery budgets measured in milliamp-hours. The challenge is extracting enough observability from each device to manage a fleet of thousands without the monitoring overhead itself becoming the dominant consumer of bandwidth, power, and flash wear.

## Device Health Telemetry

The core metrics that matter for embedded device health:

- **CPU usage** — On RTOS-based systems (FreeRTOS, Zephyr), the idle task's runtime percentage provides CPU utilization. FreeRTOS exposes this via `vTaskGetRunTimeStats()`. A device consistently above 80% CPU has no headroom for burst processing (incoming OTA commands, sensor fusion spikes) and may start missing real-time deadlines.
- **Memory watermarks** — FreeRTOS tracks the minimum free stack for each task via `uxTaskGetStackHighWaterMark()`. The heap high watermark (minimum free heap since boot) indicates how close the system has come to exhaustion. A task that has used 90% of its stack allocation is one recursive call away from a stack overflow. Heap fragmentation is equally dangerous — a device may report 8 KB free heap but fail a 2 KB allocation because no contiguous block exists.
- **Temperature** — Most MCUs include an internal temperature sensor (STM32's ADC channel 16, ESP32's built-in sensor with ~1°C accuracy). Junction temperature above 85°C on consumer-grade parts triggers derating. Outdoor deployments in direct sunlight regularly see enclosure temperatures of 60–70°C, pushing die temperatures past rated limits.
- **Battery voltage** — The most critical metric for battery-powered devices. A LiPo cell's voltage curve is relatively flat from 4.2 V down to 3.6 V, then drops steeply to the 3.0 V cutoff. Sampling battery voltage under load (during radio transmission) captures the true operating point — open-circuit voltage overestimates remaining capacity by 10–20%.
- **Uptime and reset counters** — Tracking time since last boot and cumulative reset count distinguishes stable devices from those caught in reset loops. A device that reports 45 days of uptime is healthy; one that reports 3 minutes of uptime and a reset count of 847 is in a crash-reboot cycle.
- **Flash wear counters** — For devices that log to internal flash or perform frequent NVS writes, tracking the erase cycle count of critical sectors provides early warning of flash degradation. Most MCU flash is rated for 10,000 erase cycles; reaching 8,000 warrants attention.

## Heartbeat Patterns and Keepalive Intervals

Heartbeats are the fundamental liveness signal for fleet monitoring:

- **Periodic heartbeat** — The device publishes a telemetry message at a fixed interval (every 60 seconds, 5 minutes, or 1 hour depending on power budget). The backend tracks the last-received timestamp and flags a device as offline if no heartbeat arrives within a grace window (typically 2–3x the heartbeat interval). A 5-minute heartbeat with a 15-minute grace window means an offline device is detected within 15 minutes of failure.
- **Event-driven heartbeat** — The device sends telemetry only when something changes (sensor threshold crossed, state transition, error condition). Quieter on the network but makes liveness detection harder — a silent device may be healthy and idle or dead. Combining event-driven telemetry with a low-frequency periodic heartbeat (once per hour) solves this.
- **MQTT keepalive** — The MQTT protocol includes a keep-alive mechanism at the transport level. The client and broker agree on a keep-alive interval (typically 30–300 seconds). If the broker receives no MQTT packet within 1.5x the keep-alive interval, it closes the connection and publishes the device's Last Will and Testament (LWT) message. The LWT typically updates a device status topic from "online" to "offline."
- **Adaptive intervals** — Some deployments adjust heartbeat frequency based on conditions. A device on mains power with a Wi-Fi connection sends heartbeats every 60 seconds. The same device on battery over cellular extends to every 30 minutes. The backend must track the expected interval per device to set appropriate offline detection thresholds.

Choosing the heartbeat interval is a direct tradeoff between detection latency and power consumption. On a cellular modem that draws 200 mA during transmission and takes 3 seconds per publish, a 1-minute heartbeat consumes ~10 mA average — significant for a device targeting 2-year battery life on a 6000 mAh cell.

## Connectivity Monitoring

Beyond simple online/offline status, connection quality metrics reveal network health across the fleet:

- **Last-seen timestamp** — The most basic connectivity metric. The backend records the timestamp of the most recent message from each device. A simple query ("devices not seen in the last 2 hours") generates the offline device list. Storing a rolling history of last-seen timestamps enables trend analysis — a device whose gaps between messages are gradually increasing may be experiencing worsening signal conditions.
- **Connection duration** — How long the device maintains a continuous MQTT or TCP connection before disconnecting. Healthy Wi-Fi devices may hold connections for days. Cellular devices on networks that aggressively close idle NAT mappings may reconnect every 5–15 minutes regardless of keepalive settings. A sudden fleet-wide decrease in connection duration often indicates a carrier-side NAT policy change.
- **RSSI and signal quality** — Cellular modems report RSSI, RSRP, RSRQ, and SINR via AT commands. Wi-Fi devices report RSSI in dBm. An RSSI below -85 dBm on Wi-Fi or an RSRP below -110 dBm on LTE correlates with increased packet loss and retransmissions. Tracking these per device over time reveals environmental changes (new construction blocking signal, seasonal foliage).
- **Reconnection frequency** — The number of times a device reconnects per day. A healthy device on Wi-Fi reconnects 0–2 times per day (router reboots, DHCP lease renewal). A device reconnecting 50+ times per day is experiencing persistent connectivity issues — marginal signal, TLS handshake failures, or broker-side session limits.

## Alerting Thresholds and Escalation

Effective fleet alerting requires both per-device and fleet-wide thresholds:

- **Per-device thresholds** — Battery voltage below 3.3 V, CPU usage above 90% for more than 5 consecutive reports, temperature above 80°C, zero heartbeats in 3x the expected interval. These catch individual device failures.
- **Fleet-wide thresholds** — More than 5% of devices offline simultaneously, average battery voltage dropping below 3.5 V across a deployment site, or more than 1% of devices reporting boot loops. Fleet-wide alerts catch systemic issues (bad firmware rollout, network outage, environmental event) that per-device alerts would surface as noise — hundreds of individual alerts instead of one actionable fleet-level alarm.
- **Escalation tiers** — A typical escalation chain: (1) automated alert to a monitoring dashboard and Slack channel, (2) on-call engineer paged after 15 minutes without acknowledgment, (3) incident escalation to the team lead after 1 hour if the affected device count exceeds a threshold. Battery voltage alerts for devices nearing end-of-life may route to a logistics queue for replacement scheduling rather than to engineering.
- **Alert suppression and deduplication** — A device in a crash loop generates a new alert every reboot cycle. Without deduplication, a single broken device produces hundreds of alerts per hour. Grouping alerts by device ID and suppressing repeats within a cooldown window (e.g., 1 alert per device per hour) keeps the alert channel usable.

## Dashboard Design for Embedded Fleets

Fleet dashboards serve two distinct audiences: operations teams monitoring overall health, and engineers debugging individual devices.

**Fleet-wide view (operations):**
- Total device count by status: online, offline, degraded, provisioning
- Geographic map with device locations color-coded by health status
- Firmware version distribution (pie chart or table showing percentage per version)
- Fleet-wide trend lines: average battery voltage, average RSSI, total message throughput per hour
- Alert summary: active alerts by severity, top 10 most-alerted devices

**Individual device view (engineering):**
- Time-series graphs for all telemetry: CPU, memory, temperature, battery, RSSI
- Connection event log: connect, disconnect, reconnect with timestamps and duration
- Recent message log: last 50 messages with topics and payload summaries
- Firmware version, hardware revision, provisioning date, last OTA update
- Current alert status and alert history

A common platform stack: devices publish telemetry via MQTT to a broker (AWS IoT Core, EMQX, Mosquitto), a rule engine routes messages to a time-series database (InfluxDB, TimescaleDB, Amazon Timestream), and a visualization layer (Grafana, AWS CloudWatch) renders dashboards. For fleets under 1,000 devices, this pipeline handles the load comfortably. Beyond 10,000 devices publishing every 60 seconds, the ingestion layer (167 messages/second) requires attention to database write throughput and MQTT broker connection limits.

## Anomaly Detection for Device Behavior

Pattern recognition across fleet telemetry catches failures that static thresholds miss:

- **Boot loop detection** — A device that resets more than 3 times in 10 minutes is in a boot loop. The backend detects this from the reset counter incrementing rapidly or from a burst of connection events. Automated response: flag the device as degraded, suppress normal alerting, and trigger a diagnostic data request (crash dump, last log entries).
- **Telemetry drift** — A temperature sensor that gradually shifts from reporting 22°C to reporting 35°C over weeks without a corresponding environmental change indicates sensor degradation or calibration drift. Detecting this requires comparing individual device trends against fleet baselines — the median temperature for devices in the same deployment zone.
- **Sudden silence** — A device that has been reliably reporting every 5 minutes and then stops is different from a device that has always had intermittent connectivity. Anomaly detection systems track per-device reporting cadence and alert when the observed pattern deviates from the historical baseline, not just when a static timeout expires.
- **Memory leak signatures** — Free heap decreasing linearly over days or weeks, eventually triggering a crash and reboot that temporarily restores heap, followed by the same linear decrease. The sawtooth pattern in heap watermark telemetry is the classic signature. Correlating the leak rate with firmware version identifies which release introduced the defect.
- **Connectivity pattern changes** — A cohort of devices in the same geographic area all showing increased reconnection frequency simultaneously suggests an infrastructure change (cell tower maintenance, Wi-Fi access point failure) rather than individual device faults.

## Log Aggregation from Constrained Devices

Collecting logs from devices with 128 KB of RAM and cellular connections requires different strategies than collecting logs from cloud servers:

- **Syslog over MQTT** — The device publishes log entries to a dedicated MQTT topic (e.g., `devices/{id}/logs`). Each message contains a structured log line with timestamp, severity, module name, and message. The backend subscriber writes entries to a centralized log store (Elasticsearch, CloudWatch Logs). This piggybacks on the existing MQTT connection — no additional protocol overhead.
- **Structured logging** — JSON-formatted log entries (`{"ts":1709312400,"lvl":"ERR","mod":"wifi","msg":"assoc fail","rssi":-89}`) enable automated parsing and indexing. The overhead of JSON formatting versus raw strings is 30–100% more bytes per entry, but the queryability improvement is worth the cost for devices on non-metered connections. For bandwidth-constrained devices, CBOR encoding reduces the structured log overhead by 40–60% compared to JSON.
- **Log level management** — Devices default to `WARN` or `ERROR` level logging in production, producing 5–20 log entries per day under normal operation. When debugging a specific device, the backend sends a command (via MQTT device shadow or a command topic) to temporarily increase the log level to `DEBUG`. A timeout mechanism (automatically revert to `WARN` after 2 hours) prevents a forgotten debug session from filling the device's log buffer and consuming cellular bandwidth indefinitely.
- **Circular log buffers** — Constrained devices allocate a fixed-size RAM buffer (2–8 KB) for log entries. When the buffer fills, the oldest entries are overwritten. The buffer is published to the cloud periodically (every 5 minutes) or on-demand when the backend requests a diagnostic dump. On crash, the buffer contents (if preserved across reset via a no-init RAM section) provide the last moments before failure.
- **Log sampling** — For fleets of 50,000+ devices, collecting all logs from all devices at all times overwhelms both the bandwidth budget and the log storage backend. Instead, 1–5% of devices are randomly selected for detailed logging each day, providing a statistically representative sample. Specific devices can be individually promoted to full logging when investigating an issue.

## Fleet Segmentation for Monitoring

Not all devices in a fleet are equal. Segmenting devices into groups enables targeted monitoring and alerting:

- **By firmware version** — After a rollout, devices running the new firmware version are monitored more aggressively (tighter thresholds, more frequent telemetry) than devices on the stable previous version. This creates an automatic canary monitoring tier. If the error rate for v2.3.1 devices is 5x higher than v2.3.0 devices within 24 hours of rollout, the rollout is paused.
- **By hardware revision** — Different hardware revisions have different normal operating parameters. Rev A boards with an LDO regulator run 5°C hotter than Rev B boards with a switching regulator. Setting temperature alert thresholds per hardware revision avoids false alarms on Rev A and missed overheating on Rev B.
- **By deployment site** — Devices in a refrigerated warehouse have a normal temperature range of 2–8°C. Devices in a desert solar installation operate at 40–65°C. A single global temperature threshold generates either constant false alarms from the desert site or fails to detect overheating in the warehouse. Site-specific baselines solve this.
- **By connectivity type** — Wi-Fi devices can afford 60-second heartbeats and verbose logging. Cellular devices on metered plans need 15-minute heartbeats and minimal logging. Satellite-connected devices may report only once per hour. Monitoring rules must account for these different cadences to avoid false offline alerts.
- **By lifecycle stage** — Newly provisioned devices in their first 48 hours receive heightened monitoring to catch provisioning failures and early infant mortality. Devices past their warranty period may have relaxed monitoring to reduce operational overhead.

## Tips

- Include a monotonic boot counter and uptime in every heartbeat message. The boot counter detects devices in crash-reboot loops even when uptime appears normal — a device reporting 4 minutes of uptime could be healthy (just powered on) or pathological (rebooting every 4 minutes). The boot counter distinguishes the two cases.
- Sample battery voltage under load, not during idle. Measuring open-circuit voltage gives an optimistic reading. Schedule ADC sampling during radio transmission when current draw is highest — this captures the true voltage the regulator sees and provides early warning of cells with high internal resistance that sag under load.
- Set offline detection thresholds per connectivity class, not globally. A Wi-Fi device that misses one 60-second heartbeat is probably offline. A satellite-connected device that misses one hourly report may just have had a blocked sky view. Applying a 3-minute offline threshold to the satellite device generates hundreds of false alarms per month.
- Rate-limit log publishing from devices to prevent a chatty error condition from consuming the entire cellular data budget. A hard cap (e.g., 50 log messages per 5-minute window) with a severity-based priority queue ensures critical errors are always transmitted even when the rate limit is active.
- Tag every telemetry message with firmware version and hardware revision at the device level, not just in the fleet registry. If the registry is stale (device updated firmware but registry sync failed), the telemetry message itself carries the ground truth for segmentation.
- Persist the last N heartbeat messages in device-side non-volatile storage. If connectivity is lost for hours, the device can transmit the backlog when it reconnects, filling gaps in the monitoring timeline rather than leaving a blind spot.

## Caveats

- **Monitoring overhead can exceed the application's own resource consumption on constrained devices.** A telemetry system that collects CPU usage, memory watermarks, temperature, battery voltage, RSSI, and log entries every 60 seconds may use more CPU, RAM, and bandwidth than the application it monitors. Budget monitoring overhead explicitly — 5% of CPU and 10% of bandwidth is a reasonable ceiling.
- **Clock synchronization errors corrupt time-series telemetry.** Devices without NTP or with inaccurate RTCs generate timestamps that are minutes, hours, or even years off. Inserting telemetry with a timestamp of January 1970 into InfluxDB does not produce an error — it silently creates data points in the wrong decade. Server-side timestamp injection (using the message arrival time instead of the device-reported time) avoids this but loses information about when the event actually occurred on the device.
- **MQTT Last Will and Testament messages are only published when the broker detects a connection drop, not when the device gracefully disconnects.** If a device calls `mqtt_disconnect()` before shutting down, no LWT is published and the fleet dashboard continues showing the device as online until the keepalive timeout expires. Devices should publish an explicit "offline" status message before graceful shutdown.
- **Fleet-wide anomaly detection systems trained on historical data will flag every device as anomalous after a firmware update that changes normal telemetry baselines.** A firmware update that optimizes memory usage shifts the free heap baseline from 12 KB to 18 KB — the anomaly detector sees a fleet-wide memory spike and triggers alerts. Retraining or resetting baselines after intentional changes is operationally necessary but rarely automated.
- **Cellular data costs for fleet monitoring scale linearly and can dominate operational expenses.** A 200-byte heartbeat every 60 seconds is 8.6 MB per device per year. At $0.50 per MB on an IoT MVNO plan, monitoring alone costs $4.30 per device per year. For a 50,000-device fleet, this is $215,000 annually just for heartbeats — before any application data. Extending the heartbeat interval to 15 minutes drops the cost to $0.29 per device per year.

## In Practice

- **A device that appears to go offline every day at the same time** is typically on a network with scheduled maintenance, a Wi-Fi access point with a nightly reboot, or a solar-powered device that loses power at sunset. Correlating the offline window with local sunset times (for solar) or facility maintenance schedules (for infrastructure) confirms the cause. These predictable offline patterns should be excluded from alerting to reduce noise.
- **Fleet-wide memory usage slowly increasing over weeks across all devices running the same firmware version** is the signature of a memory leak. The leak rate (KB per day) can be estimated from the telemetry trend line. Dividing the remaining free heap by the leak rate gives the estimated time to exhaustion — the point at which devices start crashing. A fix must be deployed via OTA before this deadline.
- **A subset of devices reporting abnormally high CPU usage while others on the same firmware are idle** often indicates those devices are in a retry loop — attempting to reach a cloud endpoint that is down, re-processing a corrupted sensor reading, or retrying a failed flash write. The CPU usage itself is a symptom; the root cause is usually visible in the log entries as a repeated error message.
- **Dashboard showing 100% of devices online but application-level metrics (sensor readings, actuator commands) have stopped updating** indicates the MQTT connection is alive and heartbeats are flowing, but the application task that publishes sensor data has hung or crashed. The RTOS idle task and the monitoring task continue running normally, masking the application failure. Monitoring must include application-level health indicators, not just connectivity.
- **A newly deployed batch of devices showing 15–20% higher battery drain than identical devices deployed six months earlier** despite running the same firmware may be caused by a cellular carrier change that increased network registration time, a component supplier substitution with higher quiescent current, or seasonal temperature differences affecting battery chemistry. Segmenting telemetry by deployment date and cross-referencing with procurement records narrows the cause.
