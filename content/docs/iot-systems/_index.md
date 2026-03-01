---
title: "🌐 IoT & Systems Integration"
weight: 12
bookCollapseSection: true
---

# IoT & Systems Integration

When embedded devices become part of larger systems, the first architectural decision is where the backend infrastructure lives — cloud-managed platforms like AWS IoT Core and Azure IoT Hub, self-hosted brokers and provisioning servers on private infrastructure, or hybrid architectures that split the workload between edge and cloud. That platform decision shapes everything downstream: how devices are provisioned and authenticated, which messaging protocols are available, how network traffic is routed and segmented, how firmware updates are delivered, and what monitoring stack collects and visualizes fleet telemetry.

This section covers the full stack from platform architecture through messaging protocols, network design, device lifecycle management, and backend telemetry infrastructure — for both cloud-managed and self-hosted deployments.

## Sections

- **[Platform Architecture]({{< relref "platform-architecture" >}})** — Cloud-managed vs. self-hosted vs. hybrid: AWS IoT Core, Azure IoT Hub, GCP IoT, self-hosted MQTT brokers, self-hosted device management, and hybrid edge-to-cloud bridging patterns.
- **[Messaging Protocols]({{< relref "messaging-protocols" >}})** — MQTT, CoAP, and AMQP: publish/subscribe and request/response patterns for moving data between devices, brokers, and cloud endpoints.
- **[Network Architecture]({{< relref "network-architecture" >}})** — VLAN segmentation, firewall rules, ACLs, and edge gateway topologies for isolating and securing IoT traffic on production networks.
- **[Device Lifecycle]({{< relref "device-lifecycle" >}})** — OTA firmware updates, device provisioning, and fleet monitoring across the operational lifetime of deployed devices.
- **[Monitoring & Telemetry]({{< relref "monitoring-telemetry" >}})** — Backend infrastructure for ingesting, storing, querying, and visualizing device telemetry: log aggregation, metrics dashboards, alerting pipelines, time-series databases, distributed tracing, and security event monitoring.
