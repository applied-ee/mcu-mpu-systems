---
title: "GCP IoT"
weight: 30
---

# GCP IoT

Google Cloud IoT Core was Google's managed service for connecting and managing IoT devices. It was retired on August 16, 2023, after less than six years in production. The shutdown is significant not because of the service itself — its feature set was narrower than AWS IoT Core or Azure IoT Hub — but because it demonstrated the real cost of platform dependency in IoT deployments where device lifetimes routinely exceed 5–10 years. This page documents what IoT Core provided, why it was retired, the migration paths that emerged, and the architectural patterns for building IoT workloads on GCP without a dedicated managed service.

## What IoT Core Provided

IoT Core was a device connection layer that bridged MQTT and HTTP devices to Google Cloud Pub/Sub. Its scope was deliberately narrow compared to competing platforms:

- **Device registry** — A database of device identities organized into registries within GCP projects. Each registry belonged to a specific Cloud region and contained devices with metadata, credentials, and configuration state.
- **MQTT bridge** — A managed MQTT 3.1.1 broker at `mqtt.googleapis.com:8883`. Devices published telemetry to a fixed topic path and received configuration and commands via subscriptions. The MQTT bridge did not support arbitrary topics — devices published to a single telemetry topic and received on a single config/command topic.
- **HTTP bridge** — A REST endpoint for devices that could not maintain persistent connections. Devices posted telemetry as HTTP requests and retrieved pending configuration via polling.
- **JWT authentication** — Devices authenticated by presenting a JSON Web Token (JWT) signed with an RSA or ECDSA private key. The corresponding public key was registered in the device registry. JWTs expired after a configurable period (maximum 24 hours), and devices were responsible for token renewal. This was simpler than X.509 mutual TLS but placed the authentication logic in the application layer rather than the transport layer.
- **Device state and configuration** — Each device had a state blob (up to 64 KB, device-reported) and a configuration blob (up to 64 KB, cloud-set). State updates were limited to 1 per second per device. Configuration updates were delivered to the device on its next connection or immediately if connected. The model was simpler than AWS shadows or Azure twins — no desired/reported delta computation, no versioned patches, just opaque blobs.
- **Pub/Sub integration** — Telemetry and state data automatically flowed to designated Cloud Pub/Sub topics. This was IoT Core's primary value — it handled the device-facing protocol complexity and delivered structured messages to Pub/Sub, where the rest of the GCP ecosystem (Dataflow, BigQuery, Cloud Functions) could consume them.

## Why It Was Retired

Google did not publish a detailed post-mortem, but the retirement followed a pattern consistent with several factors:

- **Limited market share** — By 2022, AWS IoT Core and Azure IoT Hub dominated the managed IoT platform market. IoT Core launched in 2018, years after AWS (2015) and Azure (2016), and never achieved comparable adoption. Limited partner integrations, fewer edge computing options (no equivalent to Greengrass or IoT Edge at the time), and a narrower feature set contributed to slow growth.
- **Feature stagnation** — IoT Core received minimal feature updates between 2020 and its retirement announcement in 2022. Features that competitors shipped as standard — fleet provisioning templates, device groups, rules engines, edge runtimes — were either absent or required custom implementation on GCP.
- **Strategic focus shift** — Google refocused IoT investment on higher-level services (Vertex AI for edge ML, Anthos for hybrid infrastructure) rather than the device connectivity layer. The messaging was that partners and third-party platforms could handle device connectivity while Google provided the compute and analytics backend.

The retirement was announced in August 2022 with a one-year migration window. Existing devices continued to function until August 16, 2023, after which the MQTT and HTTP bridges stopped accepting connections. Device registries and all associated data were deleted.

## Migration Paths

Organizations operating IoT fleets on IoT Core faced three primary migration strategies:

### 1. Cloud Pub/Sub with a Custom MQTT Bridge

The most common GCP-native approach replaces IoT Core's managed MQTT bridge with a self-hosted broker that publishes to Pub/Sub:

- **MQTT broker** — Deploy Eclipse Mosquitto, EMQX, or HiveMQ on Compute Engine, GKE, or Cloud Run. The broker handles device connections, authentication, and topic management.
- **Pub/Sub publisher** — A bridge component subscribes to broker topics and forwards messages to Cloud Pub/Sub. EMQX has a native Pub/Sub integration plugin. For Mosquitto, a custom bridge script (Python, Go) subscribes to relevant topics and publishes to Pub/Sub using the client library.
- **Authentication** — Without IoT Core's JWT verification, the broker must implement its own authentication. Options include username/password with a credential database, X.509 client certificates (similar to AWS/Azure), or a custom auth plugin that validates JWTs against a Cloud IAM or Firebase Auth backend.

This approach preserves the existing GCP backend (Dataflow pipelines, BigQuery tables, Cloud Functions) and only replaces the device-facing entry point. The tradeoff is operational responsibility for the MQTT broker — scaling, patching, monitoring, and TLS certificate management become the operator's concern.

### 2. Third-Party IoT Platforms

Several commercial platforms offered direct migration tools:

- **ClearBlade** — Google's recommended migration partner. ClearBlade's IoT Core product was explicitly designed as a drop-in replacement, supporting the same MQTT topic structure and JWT authentication scheme. The migration required changing the MQTT endpoint hostname in device firmware — in many cases, a single DNS record change or a firmware configuration update via the existing IoT Core config channel before shutdown.
- **HiveMQ** — An enterprise MQTT broker with a GCP Pub/Sub extension. HiveMQ Cloud (managed) or HiveMQ Platform (self-hosted on GKE) provides the MQTT broker, and the extension forwards messages to Pub/Sub. Authentication supports X.509, OAuth 2.0, and custom plugins.
- **Cumulocity IoT, Losant, Particle** — Other platforms that offered IoT Core migration programs with varying levels of GCP integration.

### 3. Multi-Cloud or Cloud-Agnostic Architecture

The retirement prompted many organizations to decouple their device connectivity layer from any single cloud provider:

- **Platform-agnostic MQTT broker** — Self-hosted EMQX or HiveMQ with output plugins for multiple cloud backends (Pub/Sub, Kinesis, Event Hubs). Switching cloud providers requires reconfiguring the output plugin, not reflashing device firmware.
- **Open-source device management** — Projects like Eclipse Hono and ThingsBoard provide device registry, authentication, and command-and-control without cloud vendor lock-in.
- **Device firmware abstraction** — Firmware that targets a generic MQTT endpoint (configurable hostname, standard MQTT topics) rather than vendor-specific topic structures (`$aws/things/...`, `$iothub/twin/...`) can migrate between providers with a configuration change rather than a firmware update.

## Building a Custom Device Bridge with Cloud Pub/Sub

For teams that want to stay on GCP without a third-party platform, the custom bridge architecture looks like this:

```
Devices ──MQTT──→ MQTT Broker ──→ Cloud Pub/Sub ──→ Dataflow / Cloud Functions / BigQuery
                       ↑                 │
                   Auth Plugin      Subscription ──→ Command Service ──→ MQTT Broker ──→ Devices
```

### Pub/Sub Topic Design

A practical topic structure separates telemetry from commands and isolates device types:

| Pub/Sub Topic | Purpose | Publisher | Subscriber |
|---------------|---------|-----------|------------|
| `telemetry-raw` | All device telemetry | MQTT bridge | Dataflow pipeline |
| `telemetry-alerts` | Threshold-triggered alerts | Cloud Function (filter) | Alerting service |
| `device-state` | Device-reported state changes | MQTT bridge | State management service |
| `commands-{deviceType}` | Commands for a device class | Command API | MQTT bridge (for delivery) |

Pub/Sub topics do not map 1:1 to MQTT topics. The MQTT broker may use a rich topic hierarchy (`devices/{id}/sensors/{type}/data`), while the Pub/Sub side consolidates into a few topics with message attributes carrying the device ID, sensor type, and other metadata. This separation allows the MQTT topic structure to evolve independently of the Pub/Sub consumer architecture.

### Message Attributes

Pub/Sub message attributes (key-value metadata on each message) are critical for routing and filtering:

```json
{
  "data": "<base64-encoded telemetry payload>",
  "attributes": {
    "deviceId": "sensor-042",
    "deviceType": "environmental-v2",
    "region": "us-central1",
    "firmwareVersion": "2.4.1",
    "contentType": "application/json"
  }
}
```

Pub/Sub subscriptions can filter on attributes — a subscription with filter `attributes.deviceType = "environmental-v2"` receives only messages from that device type, reducing processing load on downstream consumers.

### Command Channel

Sending commands to devices through the custom bridge requires a reverse path:

1. A backend service publishes a command message to a Pub/Sub topic (e.g., `commands-environmental`) with the target device ID in the attributes.
2. A command dispatcher service (Cloud Run, Cloud Function, or a sidecar process on the MQTT broker) subscribes to the command topic.
3. The dispatcher publishes the command to the device's MQTT command topic (e.g., `devices/{deviceId}/commands`).
4. The device receives the command via its MQTT subscription.

Pub/Sub guarantees at-least-once delivery to the dispatcher, but MQTT delivery to the device depends on QoS level and device connectivity. Commands for offline devices must be queued — either in the MQTT broker's persistent session (limited by broker memory) or in a separate command queue database.

## Alternative GCP Services for IoT Workloads

Without IoT Core, GCP's IoT story is a collection of general-purpose services assembled into a custom architecture:

- **Cloud Run** — Host the MQTT bridge, command dispatcher, or device API endpoints. Auto-scales to zero when idle, making it cost-effective for fleets with bursty traffic patterns. However, Cloud Run's maximum request timeout (60 minutes for HTTP, streaming support varies) is a consideration for long-lived MQTT connections — a dedicated Compute Engine or GKE deployment is often more appropriate for the MQTT broker itself.
- **Cloud Functions (2nd gen)** — Event-driven processing triggered by Pub/Sub messages. Suitable for telemetry transformation, alert evaluation, and command generation. Cold start latency (100 ms–2 s for Python/Node.js, longer for Java) is acceptable for asynchronous processing but not for latency-sensitive command paths.
- **Dataflow (Apache Beam)** — Streaming and batch processing pipelines for telemetry data. A typical pattern reads from a Pub/Sub subscription, applies windowed aggregations (5-minute averages, hourly rollups), and writes to BigQuery for analytics and dashboarding.
- **BigQuery** — The destination for historical telemetry data. Streaming inserts handle real-time ingestion at up to 100,000 rows per second per table. Partitioning by ingestion time and clustering by device ID keeps query costs manageable for large fleets.
- **Firestore or Cloud Bigtable** — Device state storage. Firestore provides document-based state management with real-time listeners (suitable for fleets up to ~100,000 devices). Bigtable handles larger scale with time-series optimized row key design (e.g., `deviceId#reversedTimestamp`).

## Tips

- Abstract the cloud endpoint in device firmware behind a configurable hostname and standard MQTT topic structure. Hardcoding a vendor-specific endpoint (whether `mqtt.googleapis.com`, `xxx-ats.iot.xxx.amazonaws.com`, or a custom broker) into firmware that cannot be updated over-the-air makes cloud migration impossible without physical access to every device.
- When building a custom MQTT-to-Pub/Sub bridge, include the device ID, message timestamp, and content type as Pub/Sub message attributes — not just inside the payload body. Attribute-based filtering on Pub/Sub subscriptions is orders of magnitude cheaper than deserializing every message payload in a consumer to decide whether to process it.
- Use Pub/Sub dead-letter topics for messages that consumers cannot process. After a configurable number of delivery attempts (default 5), unprocessable messages move to a dead-letter topic instead of blocking the subscription. This prevents a single malformed device message from stalling an entire processing pipeline.
- Deploy the MQTT broker with persistent sessions enabled and a session expiry of at least 24 hours for battery-powered devices. Without persistent sessions, devices that disconnect and reconnect miss messages published during the disconnection window, including pending commands.
- Plan for IoT Core's retirement as a general pattern, not a one-time event. Design the architecture so that replacing the device connectivity layer (MQTT broker, authentication system) does not require changes to the data processing pipeline (Pub/Sub consumers, Dataflow jobs, BigQuery schemas). The connectivity layer has a shorter expected lifetime than the data platform.

## Caveats

- **Cloud Pub/Sub is not an MQTT broker.** Pub/Sub provides topic-based messaging with at-least-once delivery, but it does not support MQTT protocol, persistent device sessions, last-will-and-testament messages, or retained messages. An MQTT broker is still required between the devices and Pub/Sub — IoT Core's retirement removed the managed option, not the need.
- **JWT authentication (IoT Core's model) is weaker than mutual TLS for device identity.** JWTs are bearer tokens — any entity that possesses a valid JWT can authenticate as the device. If a JWT is intercepted before expiration, the attacker has a time-limited impersonation capability. Mutual TLS with X.509 certificates binds authentication to a private key that never leaves the device's secure element.
- **Self-hosted MQTT brokers require operational investment that managed services did not.** Broker patching, TLS certificate rotation, scaling under load spikes, monitoring connection counts, and handling ungraceful client disconnections are all responsibilities that shift from the cloud provider to the operations team. A fleet of 50,000 devices maintaining persistent MQTT connections requires careful broker sizing — each connection consumes 10–50 KB of memory, so 50,000 connections need 500 MB–2.5 GB of broker memory at baseline.
- **ClearBlade and other migration partners introduce a new platform dependency.** Migrating from a retired Google service to a startup-backed platform trades one vendor risk for another. Evaluating the migration target's financial stability, SLA commitments, and data portability is as important as evaluating its technical compatibility.
- **Pub/Sub message ordering is not guaranteed by default.** Messages from a single device may arrive at consumers in a different order than they were published. Enabling ordering (using ordering keys set to the device ID) guarantees per-key FIFO ordering but reduces throughput and increases latency. Telemetry pipelines that assume chronological ordering without explicit ordering keys will produce incorrect aggregations during traffic spikes or redelivery events.

## In Practice

- **Organizations that hardcoded `mqtt.googleapis.com` into firmware with no OTA update path faced the worst migration outcomes.** Devices that could not be remotely reconfigured required physical retrieval or replacement — in agricultural deployments with thousands of sensors spread across remote fields, the cost of touching each device exceeded the original hardware cost.
- **The most common post-migration architecture on GCP uses EMQX on GKE with the Pub/Sub bridge plugin.** EMQX handles MQTT connection management and authentication, publishes telemetry to Pub/Sub, and subscribes to command topics for device-bound messages. A 3-node EMQX cluster on GKE handles approximately 100,000 concurrent device connections with automatic scaling.
- **Teams that used IoT Core's device state and configuration blobs as their primary state management mechanism had the most difficult migration.** These features had no direct equivalent in Pub/Sub — rebuilding bidirectional state synchronization required adding a database (Firestore or Redis) and custom synchronization logic that IoT Core had provided as a managed service.
- **Fleets that already published telemetry through Cloud Pub/Sub (the standard IoT Core path) experienced minimal backend disruption.** The Dataflow pipelines, BigQuery tables, and Cloud Function triggers continued to work unchanged — only the device-facing MQTT endpoint changed. This validates the pattern of using a message bus (Pub/Sub, Kafka) as the integration boundary between device connectivity and data processing.
- **Some organizations used the IoT Core retirement as the catalyst to move their entire IoT stack to AWS or Azure**, concluding that a fully managed device platform with long-term commitment was preferable to assembling custom infrastructure on GCP. The migration cost was highest for teams that had built GCP-specific backend pipelines (Dataflow + BigQuery) rather than portable ones.
