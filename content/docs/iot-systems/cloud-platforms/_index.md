---
title: "Cloud Platforms"
weight: 30
bookCollapseSection: true
---

# Cloud Platforms

Cloud IoT platforms handle the infrastructure between edge devices and the applications that consume their data — device registration, authentication, message routing, state synchronization, and fleet-scale management. AWS IoT Core, Azure IoT Hub, and Google Cloud each take different architectural approaches to these problems, and understanding their device models, provisioning workflows, and messaging patterns is necessary for selecting the right platform and avoiding lock-in traps.

This section covers the major cloud IoT platforms from the perspective of the embedded engineer connecting devices to them, not the cloud architect designing backend pipelines.

## What This Section Covers

- **[AWS IoT Core]({{< relref "aws-iot-core" >}})** — Thing registry, X.509 certificate provisioning, MQTT broker endpoints, device shadows, rules engine, and Greengrass edge runtime.
- **[Azure IoT Hub]({{< relref "azure-iot-hub" >}})** — Device Provisioning Service, IoT Hub endpoints and routing, device twins, direct methods, and IoT Edge modules.
- **[GCP IoT]({{< relref "gcp-iot" >}})** — IoT Core retirement context, migration paths, Cloud Pub/Sub with custom device bridges, and alternative platforms.
