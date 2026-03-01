---
title: "Azure IoT Hub"
weight: 20
---

# Azure IoT Hub

Azure IoT Hub is Microsoft's managed service for bidirectional communication between IoT devices and the cloud. It provides device authentication, message routing, state synchronization via device twins, command-and-control through direct methods, and fleet-scale provisioning through the Device Provisioning Service (DPS). IoT Edge extends the hub's capabilities to gateway devices running containerized workloads. The platform's device model differs from AWS IoT Core in significant ways — authentication options are broader (connection strings, X.509, TPM), the messaging architecture is built around Event Hubs rather than a pure MQTT broker, and the twin/direct method split separates state management from imperative commands more explicitly.

## Device Provisioning Service (DPS)

DPS automates zero-touch device registration across one or more IoT Hubs. Rather than hardcoding a specific hub's hostname into firmware, devices are manufactured with DPS credentials and a global DPS endpoint (`global.azure-devices-provisioning.net`). At first boot, the device contacts DPS, which determines the appropriate IoT Hub based on allocation policies and provisions the device automatically.

### Enrollment Types

- **Individual enrollment** — A single device registered with its own attestation mechanism (X.509 certificate, TPM endorsement key, or symmetric key). Each enrollment entry maps to exactly one device and can specify the target IoT Hub, initial twin state, and device ID. Suitable for high-value devices or lab/test scenarios.
- **Enrollment group** — A group of devices sharing a common attestation mechanism. For X.509, all devices present certificates signed by the same intermediate or root CA. For symmetric keys, individual device keys are derived from a group master key using HMAC-SHA256 over the device's registration ID. Enrollment groups scale to millions of devices without per-device registration entries.

### Allocation Policies

DPS supports four allocation strategies when multiple IoT Hubs are linked:

| Policy | Behavior |
|--------|----------|
| **Lowest latency** | Assigns the device to the hub with the lowest network latency from DPS |
| **Evenly weighted** | Distributes devices across hubs using weighted round-robin |
| **Static configuration** | Every device goes to a single specified hub |
| **Custom (Azure Function)** | A serverless function inspects device attributes and returns the target hub — enables geo-routing, capacity-aware placement, or tenant isolation |

Re-provisioning policies control what happens when a device already registered in one hub contacts DPS again — it can be reassigned to a different hub with or without migrating its twin data.

## Authentication Mechanisms

IoT Hub supports three device authentication methods, each with different security and provisioning tradeoffs:

- **Symmetric key (connection string)** — The simplest option. Each device receives a connection string containing the hub hostname, device ID, and a shared access key. The key generates SAS tokens for authentication. Easy to implement but the key is a static secret — if extracted from one device, it can impersonate that device indefinitely until manually rotated. Suitable for prototyping and low-security environments.
- **X.509 certificate** — Mutual TLS with per-device or CA-signed certificates. The same security model as AWS IoT Core. CA-signed certificates enable DPS enrollment groups, where any device presenting a certificate signed by the registered CA is automatically provisioned. Certificate thumbprint authentication registers specific certificates by their SHA-1 thumbprint.
- **TPM (Trusted Platform Module)** — Hardware-based attestation using the TPM's endorsement key. The TPM generates proof of identity without exposing the underlying key material. Common on industrial gateways and Windows IoT devices. DPS performs a challenge-response protocol with the TPM during provisioning.

## IoT Hub Endpoints and Messaging

IoT Hub exposes multiple endpoints for different communication patterns:

### Device-to-Cloud (D2C)

Devices send telemetry messages to IoT Hub using MQTT (`devices/{deviceId}/messages/events/`), AMQP, or HTTPS. Each message can carry up to 256 KB of payload and includes application properties (key-value headers) for routing.

The D2C messages land in a **built-in Event Hubs-compatible endpoint** with a configurable retention period (1–7 days, default 1 day). Backend applications consume messages using Event Hubs SDKs or Apache Kafka protocol. The built-in endpoint has 4 partitions on the basic tier, 4 on the standard tier (expandable), and operates as an append-only log — consumers track their own position using checkpoints, enabling replay and catch-up processing.

### Cloud-to-Device (C2D)

Three patterns exist for sending commands and data to devices:

| Pattern | Latency | Delivery | Use Case |
|---------|---------|----------|----------|
| **C2D messages** | Seconds to minutes (queued) | At least once, with TTL | Non-urgent commands, configuration delivery |
| **Direct methods** | Sub-second (synchronous) | Request-response with timeout | Immediate commands (reboot, lock, calibrate) |
| **Twin desired properties** | Seconds (asynchronous) | Persistent until device acknowledges | Configuration state that survives reboots |

C2D messages queue on the hub if the device is offline (up to 50 messages per device, configurable TTL per message, maximum 48 hours). When the device connects, it receives pending messages in FIFO order. Direct methods require the device to be online — if the device is disconnected, the method call returns a 404 error immediately.

## Device Twins

Device twins are the Azure equivalent of AWS device shadows — JSON documents that store device state in the cloud. A twin has three sections:

```json
{
  "deviceId": "sensor-node-042",
  "status": "enabled",
  "tags": {
    "location": "building-7-floor-3",
    "deploymentRing": "canary",
    "hardwareRevision": "rev-C"
  },
  "properties": {
    "desired": {
      "telemetryInterval": 30,
      "ledBrightness": 75,
      "$version": 12
    },
    "reported": {
      "telemetryInterval": 60,
      "ledBrightness": 75,
      "firmwareVersion": "3.1.0",
      "batteryLevel": 87,
      "$version": 34
    }
  }
}
```

Key differences from AWS shadows:

- **Tags** — Cloud-only metadata (the device cannot read or write tags). Tags support IoT Hub query language for fleet operations: `SELECT * FROM devices WHERE tags.location = 'building-7-floor-3'`. This enables grouping without device involvement.
- **No computed delta** — Unlike AWS shadows, IoT Hub does not compute a delta section. The device receives the entire `desired` property object on change and must compute the difference itself. Firmware typically compares `desired.$version` against a locally cached version to detect changes.
- **Size limit** — 32 KB total for the twin document (8 KB for tags, 8 KB for desired properties, 8 KB for reported properties, plus metadata). Larger than AWS shadows but still insufficient for bulk data.

### Twin Change Notifications

When desired properties change, the device receives a notification on the MQTT topic `$iothub/twin/PATCH/properties/desired/`. The payload contains only the changed properties, not the full desired state. On initial connection, the device retrieves the full twin with a `GET` request to `$iothub/twin/GET/` and subscribes to patch notifications for subsequent changes.

## Direct Methods

Direct methods provide synchronous request-response communication between the cloud and a specific device. A method invocation specifies:

- **Method name** — A string identifier (e.g., `reboot`, `setCalibration`, `runDiagnostics`).
- **Payload** — A JSON body with parameters (up to 128 KB).
- **Response timeout** — How long IoT Hub waits for the device to respond (5–300 seconds, default 30).
- **Connection timeout** — How long to wait for the device to come online (0–300 seconds, 0 means the device must be connected already).

The device registers method handlers that execute when invoked and return a status code (200 for success, 400–500 range for errors) and an optional JSON response payload. Direct methods are the right tool for imperative, one-shot operations where the caller needs immediate confirmation — rebooting a device, triggering a sensor calibration cycle, requesting a diagnostic dump.

Direct methods do not persist. If the device is offline and the connection timeout expires, the call fails. For operations that must eventually reach the device regardless of connectivity, desired properties or C2D messages with a TTL are more appropriate.

## Message Routing

IoT Hub's message routing evaluates incoming D2C messages against rules and sends matching messages to custom endpoints. Without routing rules, all messages go to the built-in Event Hubs endpoint. Routing rules use a SQL-like query syntax against message properties:

```sql
temperatureAlert = 'true' AND $body.temperature > 50
```

### Supported Endpoints

| Endpoint Type | Use Case |
|---------------|----------|
| **Built-in (Event Hubs)** | Default consumer path for all telemetry |
| **Azure Blob Storage** | Archival of raw telemetry data in AVRO or JSON format |
| **Service Bus Queue** | Ordered, transactional message processing |
| **Service Bus Topic** | Fan-out to multiple subscribers with filtering |
| **Event Hubs (custom)** | High-throughput streaming to a dedicated Event Hubs namespace |
| **Cosmos DB** | Direct write to a globally distributed database (preview) |

**Fallback route** — When enabled, messages that do not match any routing rule are sent to the built-in endpoint. When disabled, unmatched messages are dropped. Disabling the fallback route without comprehensive routing rules causes silent data loss.

### Message Enrichment

Message enrichments add metadata to D2C messages before they reach endpoints, without the device needing to send the data. An enrichment rule adds a key-value pair from a static string, the device twin's tags, or twin properties. For example, adding `$twin.tags.location` as a `location` header on every message — downstream processors can filter by location without querying the twin separately.

## IoT Edge

Azure IoT Edge runs containerized modules on gateway devices (Linux or Windows). An Edge device is registered in IoT Hub like any other device, plus an Edge runtime that manages module lifecycle, local routing, and cloud synchronization.

### Architecture

- **Edge Agent** — A system module that pulls deployment manifests from IoT Hub and manages module containers (start, stop, restart, health monitoring).
- **Edge Hub** — A local MQTT/AMQP broker that provides the same messaging interface as IoT Hub. Downstream devices (leaf devices) connect to the Edge Hub as if it were IoT Hub, enabling offline operation. Messages are store-and-forwarded to the cloud when connectivity returns.
- **Custom modules** — Docker containers that process data locally. Typical examples: protocol translation (Modbus/BACnet to MQTT), data filtering/aggregation (send only anomalies to the cloud), and local ML inference.

### Module Twins

Each Edge module has its own twin — identical in structure to device twins but scoped to the module. Module twins configure module behavior from the cloud. A temperature filtering module's desired properties might specify a threshold (`"alertThreshold": 45.0`), and the module updates reported properties with its current configuration and processing statistics.

### Offline Capabilities

IoT Edge is designed for intermittent connectivity. The Edge Hub buffers messages locally (up to 4 GB by default, configurable) and forwards them when the cloud connection is restored. Leaf devices continue to publish telemetry to the Edge Hub without interruption. The offline duration is limited only by local storage capacity — multi-day disconnections are common in industrial and remote deployments.

## Tips

- Use DPS enrollment groups with X.509 CA certificates for production fleets. Individual enrollments and symmetric keys work for prototyping but create per-device management overhead at scale. With a CA-signed enrollment group, any device that presents a valid certificate signed by the registered CA is automatically provisioned — no per-device API calls during manufacturing.
- Separate telemetry, alerts, and state updates into different message routing rules early in the architecture. Routing all messages to the built-in endpoint and filtering downstream creates unnecessary processing load. Route high-priority alerts directly to a Service Bus Queue for immediate processing and bulk telemetry to Blob Storage for batch analytics.
- Set explicit TTL values on C2D messages. The default TTL is 1 hour — for a device that connects once per day, queued commands expire before delivery. Setting TTL to 48 hours (the maximum) ensures offline devices receive pending commands on their next connection.
- Use tags in device twins for fleet segmentation rather than desired or reported properties. Tags are cloud-only, do not count against the device's property size limit, and support IoT Hub query language for group operations like targeted deployments.
- Register direct method handlers for diagnostic operations (dump logs, report memory usage, run self-test) even in production firmware. Remote diagnostics eliminate the need for physical access to debug field issues.

## Caveats

- **IoT Hub does not compute a delta for twin desired properties.** The device receives the full desired property object on change (or a patch with the changed keys), but must determine what actually changed compared to its current state. Firmware that naively applies the entire desired property object on every notification may trigger unnecessary hardware reconfigurations or restart cycles.
- **Direct methods fail immediately if the device is offline and the connection timeout is zero.** There is no built-in retry or queuing for failed method invocations. If the calling service does not implement its own retry logic, commands intended for intermittently connected devices are silently lost.
- **The built-in Event Hubs endpoint has a fixed number of partitions that cannot be changed after hub creation.** Partition count determines the maximum number of parallel consumers. Starting with 4 partitions and later needing 32 requires creating a new IoT Hub and migrating the fleet — there is no in-place upgrade.
- **Message enrichment from twin data uses eventually consistent reads.** If a twin property changes and a message arrives within the same second, the enriched value may reflect the old twin state. Workflows that depend on enrichment reflecting real-time twin changes can encounter race conditions.
- **DPS re-provisioning can orphan devices.** If a device is re-provisioned to a different hub and the "migrate data" policy is not configured, the device loses its twin state, queued C2D messages, and direct method registrations. The old hub retains a stale device entry that never reconnects.

## In Practice

- **A device that connects to IoT Hub but never receives twin desired property changes** is typically missing the MQTT subscription to `$iothub/twin/PATCH/properties/desired/#`. The connection succeeds and telemetry flows, but the twin notification channel is a separate subscription that firmware must explicitly establish after connecting.
- **Telemetry messages that appear in IoT Hub monitoring but never reach the backend application** usually indicate a routing configuration issue. If custom routes are defined but the fallback route is disabled, messages that do not match any rule are silently dropped. The `d2c.telemetry.egress.dropped` metric in IoT Hub diagnostics confirms this.
- **Direct method calls that timeout even though the device is online** often mean the method handler takes longer than the response timeout. A firmware update check that queries a remote server, for example, might take 15 seconds while the default timeout is 5 seconds. Increasing the response timeout in the method invocation call (up to 300 seconds) resolves this.
- **A DPS-provisioned device that works in the development hub but fails in production** frequently results from the enrollment group's allocation policy pointing to a different hub than expected. The device receives its assigned hub hostname from DPS and connects there — if the production hub's SKU, firewall rules, or IP filter differ from the development hub, the connection fails with errors that do not mention DPS at all.
- **Devices behind an IoT Edge gateway that show stale reported properties in their twins** are usually experiencing Edge Hub's store-and-forward buffering. The leaf device updated its twin through the Edge Hub, but the Edge Hub has not yet synchronized with IoT Hub (due to bandwidth limits or connectivity issues). The twin update is queued locally and will arrive when the Edge Hub's upstream connection clears.
