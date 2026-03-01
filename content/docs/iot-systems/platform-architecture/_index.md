---
title: "Platform Architecture"
weight: 10
bookCollapseSection: true
---

# Platform Architecture

The first architectural decision in any IoT deployment is where the backend infrastructure lives. Cloud-managed platforms — AWS IoT Core, Azure IoT Hub, and their equivalents — provide device registries, MQTT brokers, provisioning services, and state synchronization as managed services. Self-hosted deployments run those same components on private infrastructure: Mosquitto or EMQX for MQTT brokering, custom provisioning servers for device enrollment, and Prometheus or InfluxDB for monitoring. Hybrid architectures split the workload — local brokers handle latency-sensitive traffic and store-and-forward during outages, while cloud services provide analytics, long-term storage, and fleet-wide visibility.

This decision shapes everything downstream. Provisioning workflows differ: cloud platforms offer zero-touch enrollment through DPS or fleet provisioning templates, while self-hosted deployments build enrollment around custom certificate authorities and database-backed registries. Security models differ: cloud platforms manage TLS termination and certificate lifecycle, while self-hosted brokers require explicit certificate rotation and ACL management. Monitoring differs: cloud-native stacks use CloudWatch or Azure Monitor, while on-premises deployments assemble Prometheus, Grafana, and Alertmanager. Even network architecture changes — cloud deployments route through public internet or VPN tunnels to cloud endpoints, while self-hosted systems can keep all traffic on a private network.

No single approach is universally correct. Cloud-managed platforms minimize operational burden but introduce vendor lock-in, per-message costs at scale, and dependency on external availability. Self-hosted infrastructure provides full control and data sovereignty but shifts the operational burden — broker patching, scaling, certificate management, backup — to the deploying organization. Hybrid architectures offer a middle path at the cost of additional integration complexity. The pages in this section cover all three approaches.

## What This Section Covers

- **[AWS IoT Core]({{< relref "aws-iot-core" >}})** — Thing registry, X.509 certificate provisioning, MQTT broker endpoints, device shadows, rules engine, and Greengrass edge runtime.
- **[Azure IoT Hub]({{< relref "azure-iot-hub" >}})** — Device Provisioning Service, IoT Hub endpoints and routing, device twins, direct methods, and IoT Edge modules.
- **[GCP IoT]({{< relref "gcp-iot" >}})** — IoT Core retirement context, migration paths, Cloud Pub/Sub with custom device bridges, and alternative platforms.
- **[Self-Hosted MQTT Brokers]({{< relref "self-hosted-mqtt-brokers" >}})** — Mosquitto, EMQX, and HiveMQ: deployment patterns, TLS and authentication without cloud PKI, clustering, persistence, and capacity planning.
- **[Self-Hosted Device Management]({{< relref "self-hosted-device-management" >}})** — Provisioning without cloud DPS, OTA without cloud delivery, device state synchronization without managed shadows, and the operational infrastructure that self-hosted deployments must build and maintain.
- **[Hybrid Architectures]({{< relref "hybrid-architectures" >}})** — Edge-to-cloud bridging, store-and-forward patterns, split processing between local and cloud, multi-cloud strategies, and migration paths between deployment models.
