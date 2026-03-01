---
title: "Metrics & Dashboards"
weight: 20
---

# Metrics & Dashboards

Metrics are numeric measurements sampled at regular intervals — CPU usage, battery voltage, RSSI, heap free bytes, message throughput. Unlike logs (discrete events with variable content), metrics are structured, compact, and designed for time-series aggregation. A fleet of 10,000 devices reporting 8 metrics every 60 seconds generates 480,000 data points per minute, or roughly 700 million per day. This write-heavy, append-only workload demands infrastructure purpose-built for time-series data: efficient ingestion, columnar compression, and query engines optimized for range scans and aggregations over time windows.

Prometheus and Grafana have become the standard open-source stack for metrics and visualization. Adapting them to IoT — where devices cannot expose HTTP endpoints for Prometheus to scrape — requires bridging MQTT telemetry into the Prometheus data model.

## Prometheus for IoT Fleets

Prometheus operates on a pull model: it scrapes HTTP endpoints (`/metrics`) at configured intervals. IoT devices behind NAT, on cellular connections, or in deep sleep cannot serve HTTP requests. The standard adaptation is an MQTT-to-Prometheus bridge that subscribes to device telemetry topics, maintains the latest metric values in memory, and exposes them as a scrapable endpoint:

```
Device → MQTT Broker → mqtt2prometheus bridge → /metrics → Prometheus
```

The bridge subscribes to topics like `devices/+/telemetry` and parses incoming JSON payloads into Prometheus metric format:

```
# HELP device_battery_voltage Battery voltage in volts
# TYPE device_battery_voltage gauge
device_battery_voltage{device_id="sensor-0042",site="warehouse-east",firmware="2.3.1"} 3.82
device_battery_voltage{device_id="sensor-0043",site="warehouse-east",firmware="2.3.1"} 3.91

# HELP device_cpu_usage CPU usage percentage
# TYPE device_cpu_usage gauge
device_cpu_usage{device_id="sensor-0042",site="warehouse-east",firmware="2.3.1"} 34.2
```

Labels (`device_id`, `site`, `firmware`) enable dimensional queries — filtering, grouping, and aggregating metrics across the fleet. The bridge assigns labels from either the MQTT topic structure or fields within the telemetry payload.

**Metric types for IoT telemetry:**

- **Gauge** — A value that goes up and down: battery voltage, temperature, RSSI, free heap. Most device telemetry maps to gauges.
- **Counter** — A monotonically increasing value: total messages sent, total bytes transmitted, boot count, error count. Counters reset to zero on device reboot. Prometheus's `rate()` and `increase()` functions handle resets automatically.
- **Histogram** — Distribution of observed values: message round-trip latency, sensor reading distribution. Useful for detecting bimodal behavior (e.g., 90% of messages arrive in 50 ms, but 10% take 2 seconds due to cellular retransmissions).

## PromQL Fleet Queries

PromQL (Prometheus Query Language) enables powerful fleet-wide analysis:

- **Average battery voltage across the fleet:**
  ```promql
  avg(device_battery_voltage)
  ```

- **Average battery voltage by deployment site:**
  ```promql
  avg by (site) (device_battery_voltage)
  ```

- **Devices with battery below 3.3V (count):**
  ```promql
  count(device_battery_voltage < 3.3)
  ```

- **95th percentile CPU usage by firmware version:**
  ```promql
  quantile by (firmware) (0.95, device_cpu_usage)
  ```

- **Devices that have rebooted in the last hour:**
  ```promql
  increase(device_boot_count[1h]) > 0
  ```

- **Message throughput per site (messages per second):**
  ```promql
  sum by (site) (rate(device_messages_sent_total[5m]))
  ```

- **Devices with degrading RSSI (decrease over 24 hours):**
  ```promql
  device_rssi_dbm - device_rssi_dbm offset 24h < -10
  ```

These queries power both dashboards and alerting rules. A single PromQL expression can answer questions that would require custom scripts against a relational database.

## Grafana Dashboard Design for IoT

Grafana connects to Prometheus (and other data sources) to render dashboards. IoT fleet dashboards benefit from a hierarchical structure that matches how operators and engineers investigate issues:

### Dashboard Hierarchy

**Level 1 — Fleet Overview:**
- Total device count by status (online, offline, degraded) — stat panels with thresholds
- Fleet-wide battery voltage heatmap — color-coded by voltage range
- Message ingestion rate — time-series graph showing messages per second
- Active alert count by severity — stat panels linked to Alertmanager
- Firmware version distribution — pie chart or bar graph

**Level 2 — Site/Region View:**
- Device count and health per site — table with sortable columns
- Site-specific metric trends — battery, temperature, RSSI averaged per site
- Per-site offline device list — table linked to individual device dashboards
- Comparison panels — overlay two sites to identify site-specific anomalies

**Level 3 — Individual Device:**
- Time-series panels for every reported metric (battery, CPU, temperature, RSSI, heap)
- Connection event timeline — annotations showing connect/disconnect events
- Log panel (via Loki or Elasticsearch data source) — correlated log entries
- Device metadata — firmware version, hardware revision, last OTA date, provisioning date

### Panel Types for IoT Data

- **Stat panel** — Single number with color-coded thresholds. Ideal for fleet-wide KPIs: total offline devices (green < 1%, yellow 1–5%, red > 5%).
- **Time-series panel** — Standard line graph for metric trends. For fleet-wide views, use `avg`, `min`, `max`, or percentile aggregations rather than plotting individual device lines (10,000 overlapping lines render as an unreadable blob).
- **Heatmap** — Shows distribution of a metric across the fleet over time. A battery voltage heatmap reveals whether the fleet clusters tightly around 3.8 V (healthy) or spreads bimodally with a cluster near 3.2 V (subset approaching end-of-life).
- **Table panel** — Lists devices matching a query condition (e.g., all devices with battery below 3.3 V). Sortable columns and links to individual device dashboards enable drill-down.
- **Geomap panel** — Plots devices on a map using latitude/longitude labels. Color-coding by health status or battery voltage gives geographic visibility into fleet condition.
- **Annotations** — Overlay events (OTA rollout start/end, configuration change, known outage) on time-series panels. Correlating a metric change with a deployment event is immediate when both appear on the same timeline.

### Template Variables

Grafana template variables make dashboards reusable:

```
Variable: site     → label_values(device_battery_voltage, site)
Variable: firmware → label_values(device_battery_voltage, firmware)
Variable: device   → label_values(device_battery_voltage{site="$site"}, device_id)
```

Dropdown selectors at the top of the dashboard let operators filter by site, firmware version, or individual device without creating separate dashboards for each combination.

## Scaling Prometheus for Large Fleets

A single Prometheus instance handles approximately 1–2 million active time series with 16 GB of RAM. For a fleet of 10,000 devices reporting 8 metrics each, the cardinality is 80,000 series — well within a single instance's capacity. Scaling concerns emerge at 50,000+ devices (400,000 series) or when high-cardinality labels inflate series counts.

**Scaling strategies:**

- **Thanos** — Adds long-term storage and global querying across multiple Prometheus instances. Each Prometheus instance ships its data blocks to object storage (S3, GCS). Thanos Query federates queries across all instances, providing a single Grafana data source for the entire fleet. Thanos Compactor downsamples historical data (5-minute resolution after 30 days, 1-hour resolution after 90 days), reducing storage costs for long retention periods.
- **Cortex / Mimir** — A horizontally scalable, multi-tenant Prometheus-compatible backend. Replaces Prometheus for large deployments. Ingests metrics via remote_write from Prometheus instances or directly from the MQTT bridge. Handles millions of active series across multiple tenants (useful for IoT platforms serving multiple customers). Storage is backed by object storage with a write-ahead log for durability.
- **Federation** — A built-in Prometheus feature where a global Prometheus scrapes aggregated metrics from site-level Prometheus instances. Site-level instances hold full-resolution data for local queries; the global instance holds only aggregated fleet-wide metrics. Simpler than Thanos but loses the ability to drill down to individual devices from the global view.

**Cardinality management:**

High-cardinality labels are the primary scaling risk. Adding a `request_id` or `session_id` label to a metric creates a new time series for every request or session — millions of series that overwhelm Prometheus. For IoT metrics, `device_id` is inherently high-cardinality but unavoidable. Avoid adding transient identifiers (message ID, connection ID) as metric labels. Use logs or traces for per-event correlation instead.

## Tips

- Set the Prometheus scrape interval for the MQTT bridge to match or exceed the device reporting interval. Scraping every 15 seconds when devices report every 60 seconds wastes resources and creates misleading interpolated data points in Grafana. A 60-second scrape interval aligns cleanly with 60-second device telemetry.
- Use recording rules in Prometheus to pre-compute expensive fleet-wide aggregations. A recording rule like `fleet:battery_voltage:avg = avg(device_battery_voltage)` runs once per evaluation interval and stores the result as a new time series, making dashboard queries instant instead of aggregating across thousands of series on every page load.
- Add `info`-type metrics to carry device metadata without inflating cardinality. A metric like `device_info{device_id="sensor-0042", firmware="2.3.1", hw_rev="B", site="warehouse-east"} 1` allows joining metadata with telemetry in PromQL using `* on(device_id) group_left(firmware, hw_rev)` without duplicating those labels on every metric.
- Configure Grafana dashboard refresh intervals to 30–60 seconds for fleet overview dashboards. Faster refresh rates generate unnecessary query load on Prometheus and provide no additional insight when the underlying device telemetry arrives at 60-second intervals.

## Caveats

- **The MQTT-to-Prometheus bridge is a single point of failure in the metrics pipeline.** If the bridge process crashes or loses its MQTT connection, Prometheus scrapes stale metric values (the last known state) rather than receiving an error. Stale metrics are worse than missing metrics — a device whose battery voltage was 3.8 V before the bridge failed continues to appear healthy in dashboards even as the real voltage drops to 3.0 V. Health checks on the bridge and staleness detection in Prometheus (`up` metric, `absent()` function) are essential.
- **Prometheus's pull model introduces a fundamental visibility gap for intermittently connected devices.** A device that connects, publishes telemetry, and disconnects within a 30-second window may never be seen by Prometheus if the scrape interval is 60 seconds. The bridge caches the last value, so the metric appears eventually, but the timestamp reflects the scrape time, not the device reporting time. For devices with connection windows shorter than the scrape interval, pushing metrics via remote_write to a Prometheus-compatible endpoint (Cortex, Mimir, VictoriaMetrics) avoids this gap.
- **Label changes on existing metrics create new time series, not updates to existing ones.** If a device's `firmware` label changes from "2.3.0" to "2.3.1" after an OTA update, Prometheus creates a new series and the old series goes stale. Queries spanning the update see a discontinuity. Grafana's "stale data" handling and PromQL's `label_replace()` function can paper over this, but the underlying data model treats label changes as identity changes.
- **Grafana dashboards with high panel counts and short refresh intervals can overwhelm Prometheus.** A device-detail dashboard with 12 panels, each querying over a 7-day range, generates 12 queries per refresh. With a 10-second refresh and 50 engineers simultaneously viewing different devices, the query load reaches 60 queries per second — more than many Prometheus deployments handle comfortably. Rate-limiting Grafana queries, using recording rules for common aggregations, and setting reasonable refresh intervals prevent this.

## In Practice

- **A Grafana fleet overview dashboard showing average battery voltage slowly declining over weeks across all sites** indicates normal battery aging or a seasonal temperature effect (cold temperatures reduce effective battery capacity). The decline rate determines urgency — 0.01 V per week is gradual aging; 0.1 V per week suggests a firmware issue increasing power consumption. Segmenting by firmware version (`avg by (firmware) (device_battery_voltage)`) isolates whether the decline correlates with a specific release.
- **A site-level dashboard showing one site's offline device count at 30% while all other sites show less than 1%** points to a site-specific infrastructure issue: network outage, power failure, or physical damage. The site's RSSI trend panel often confirms — a simultaneous RSSI drop across all devices at the affected site indicates the access point or gateway failed, not the individual devices.
- **Prometheus alerting on `absent(device_battery_voltage{device_id="sensor-0042"})` firing for a device that was recently decommissioned** is a false alarm caused by the metric series going stale after the device stopped reporting. Maintaining a device registry that Prometheus consults (via service discovery or relabeling rules) to exclude decommissioned devices prevents these alerts. Without registry integration, every decommissioned device eventually triggers an absence alert.
- **A heatmap of message round-trip latency showing a bimodal distribution — one cluster at 50–100 ms and another at 2–5 seconds** reveals two distinct network paths. The low-latency cluster is typically Wi-Fi-connected devices; the high-latency cluster is cellular devices experiencing modem wake-up and connection establishment delays. Separating the heatmap by `connectivity_type` label confirms the split and prevents the high-latency cellular cluster from skewing fleet-wide latency averages.
