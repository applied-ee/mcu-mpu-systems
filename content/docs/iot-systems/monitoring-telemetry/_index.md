---
title: "Monitoring & Telemetry"
weight: 50
bookCollapseSection: true
---

# Monitoring & Telemetry

Embedded devices generate telemetry — heartbeats, sensor readings, log entries, error codes — but the value of that data depends entirely on the backend infrastructure that receives, stores, queries, and acts on it. A fleet of 10,000 devices publishing metrics every 60 seconds produces 14.4 million data points per day. Without purpose-built ingestion pipelines, time-series databases, and alerting systems, that stream of telemetry disappears into a void or overwhelms general-purpose infrastructure never designed for the write-heavy, append-only, time-correlated access patterns that IoT workloads demand.

This section covers the backend side of the monitoring equation: the infrastructure that turns raw device telemetry into searchable logs, queryable metrics, actionable alerts, and security event detection. The device side — what metrics to collect, heartbeat design, log formatting, per-device alerting thresholds — is covered in [Fleet Monitoring]({{< relref "/docs/iot-systems/device-lifecycle/fleet-monitoring" >}}).

The monitoring stack itself follows from the [platform architecture]({{< relref "/docs/iot-systems/platform-architecture" >}}) decision. Cloud-managed deployments typically use cloud-native monitoring (CloudWatch, Azure Monitor, Amazon Timestream) with minimal operational overhead. Self-hosted deployments assemble Prometheus, Grafana, Alertmanager, and a time-series database (InfluxDB, TimescaleDB) into a monitoring stack that must be deployed and maintained alongside the broker and device management infrastructure.

The boundary between the two sides falls at the message broker. Fleet Monitoring describes what a device publishes to MQTT topics and how it manages its own telemetry budget. This section picks up from the broker onward: how subscribers route messages into log aggregators, how time-series databases store and downsample metric streams, how alerting pipelines decide when to page an engineer, and how security event monitoring detects anomalous behavior across the fleet.

## What This Section Covers

- **[Centralized Logging with ELK]({{< relref "centralized-logging-elk" >}})** — Aggregating device logs with Elasticsearch, Logstash, and Kibana: MQTT-to-Logstash ingestion, index lifecycle management, KQL search patterns, and Grafana Loki as a lightweight alternative.
- **[Metrics & Dashboards]({{< relref "metrics-dashboards" >}})** — Prometheus and Grafana for IoT fleet metrics: bridging MQTT to the pull model, PromQL fleet queries, dashboard hierarchy design, and scaling with Thanos or Cortex.
- **[Alerting]({{< relref "alerting" >}})** — Alertmanager configuration, route trees, fleet-wide vs. per-device rules, PagerDuty and OpsGenie integration, runbook linking, and alert fatigue management.
- **[Time-Series Databases]({{< relref "time-series-databases" >}})** — InfluxDB, TimescaleDB, and Amazon Timestream: data models, retention policies, downsampling strategies, and schema design for IoT workloads.
- **[Distributed Tracing]({{< relref "distributed-tracing" >}})** — OpenTelemetry concepts, trace context propagation through MQTT and cloud functions, Jaeger architecture, and sampling strategies for IoT pipelines.
- **[SIEM & Security Monitoring]({{< relref "siem-security-monitoring" >}})** — Security information and event management for IoT fleets: anomalous traffic detection, intrusion detection patterns, compliance logging, and incident response workflows.
