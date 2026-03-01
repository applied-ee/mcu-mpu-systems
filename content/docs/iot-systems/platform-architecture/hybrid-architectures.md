---
title: "Hybrid Architectures"
weight: 60
---

# Hybrid Architectures

Hybrid IoT architectures split infrastructure between local (on-premises or edge) and cloud components. A local MQTT broker handles device-facing traffic — low-latency messaging, store-and-forward during connectivity gaps, and data that must stay on-premises — while cloud services provide analytics, long-term storage, fleet-wide dashboards, and integrations that benefit from elastic scale. This is not a compromise between cloud-managed and self-hosted; it is a distinct architectural pattern that addresses requirements neither approach satisfies alone.

The hybrid model is common in industrial IoT (factory floors with intermittent cloud connectivity), regulated environments (process data stays local, aggregates go to cloud), and geographically distributed deployments (local brokers at each site, centralized cloud visibility).

## Edge-to-Cloud Bridging

The core mechanism of hybrid IoT is an MQTT bridge between a local broker and a cloud MQTT endpoint. The bridge maintains a persistent connection to the cloud and forwards selected topics bidirectionally.

### Bridge Topologies

```
Site A                              Cloud
┌──────────────────┐          ┌──────────────────┐
│ Devices ──→ EMQX ├──bridge──→ AWS IoT Core     │
│            (local)│          │   or Azure IoT   │
└──────────────────┘          │   or EMQX Cloud  │
                              └──────────────────┘

Site B
┌──────────────────┐               │
│ Devices ──→ EMQX ├──bridge───────┘
│            (local)│
└──────────────────┘
```

Each site runs its own broker cluster. The bridge forwards telemetry topics upstream (local → cloud) and command topics downstream (cloud → local). Devices connect only to their local broker and are unaware of the cloud layer.

### Bridge Configuration (EMQX Example)

EMQX's bridge configuration forwards selected topics to a cloud endpoint:

```
bridges.mqtt.aws_bridge {
  server = "a1b2c3d4e5-ats.iot.us-east-1.amazonaws.com:8883"
  ssl {
    certfile = "/etc/emqx/certs/bridge.crt"
    keyfile = "/etc/emqx/certs/bridge.key"
    cacertfile = "/etc/emqx/certs/AmazonRootCA1.pem"
  }
  egress {
    remote_topic = "sites/${site_id}/telemetry/${topic}"
    local_topic = "devices/+/telemetry"
  }
  ingress {
    remote_topic = "sites/${site_id}/commands/#"
    local_topic = "commands/${topic}"
  }
}
```

Mosquitto supports bridging through its `connection` configuration directive. HiveMQ uses the Enterprise Bridge Extension. The bridge acts as an MQTT client to the remote broker, authenticating with its own credentials (X.509 certificate for AWS IoT Core, SAS token for Azure IoT Hub).

### Topic Namespace Design

Hybrid architectures require a topic namespace that works at both the local and cloud levels:

| Scope | Local Topic | Cloud Topic |
|-------|------------|-------------|
| Device telemetry | `devices/{id}/telemetry` | `sites/{site}/devices/{id}/telemetry` |
| Device commands | `devices/{id}/commands` | `sites/{site}/devices/{id}/commands` |
| Site aggregates | `site/aggregates/{metric}` | `sites/{site}/aggregates/{metric}` |
| Global config | (received from cloud) | `global/config/{key}` |

The bridge prepends a site identifier when forwarding to the cloud, creating a globally unique namespace. Cloud-side consumers and rules engines use the site prefix for routing and filtering.

## Store-and-Forward During Cloud Outages

The primary operational advantage of hybrid over pure-cloud architecture is resilience during connectivity loss. When the bridge connection to the cloud drops, the local broker continues operating normally — devices publish telemetry, subscribe to commands, and interact with local services without interruption.

### Buffer Management

Messages destined for the cloud accumulate on the local broker during outages:

- **EMQX** — The bridge buffers outbound messages in memory and optionally on disk. Configurable buffer size (`max_buffer_bytes`) and overflow behavior (drop oldest, drop newest, or backpressure). A 10 GB disk buffer at 1 KB per message stores approximately 10 million messages — enough for a fleet of 1,000 devices publishing every 10 seconds to buffer through a 28-hour outage.
- **Mosquitto** — Bridge messages queue in the persistence database. The queue depth is bounded by `max_queued_messages`. Mosquitto's single-threaded architecture makes it more susceptible to performance degradation under heavy queuing.
- **Custom bridge services** — A standalone bridge application (Python, Go, Rust) that subscribes to local topics and publishes to the cloud can implement application-level buffering with SQLite, RocksDB, or a bounded file-based queue. This provides more control over buffer management than broker-level queuing.

### Replay and Deduplication

When connectivity resumes, the bridge replays buffered messages. This creates two challenges:

- **Message ordering** — Buffered messages arrive at the cloud in chronological order per topic, but interleaved with new real-time messages. Cloud-side consumers must handle out-of-order delivery or accept temporal gaps during the replay window.
- **Duplicate detection** — If the bridge's connection dropped during message delivery (after sending but before receiving the PUBACK), the same message may be sent twice on reconnection. QoS 1 guarantees at-least-once delivery, not exactly-once. Cloud consumers should deduplicate using a message ID, device-generated sequence number, or timestamp within a deduplication window.

## Split Processing

Hybrid architectures divide processing between edge and cloud based on latency requirements, data volume, and cost:

### Local Rule Engine for Latency-Sensitive Actions

A local rule engine (EMQX's built-in engine, Node-RED on a gateway, or custom logic in an edge application) processes messages that require immediate response:

- **Safety interlocks** — Temperature exceeds threshold → publish shutdown command to the actuator. Round-trip time: 1–5 ms (local) vs. 50–200 ms (cloud).
- **Local control loops** — PID controller running on the edge gateway, reading sensor topics and publishing actuator commands at 10–100 Hz. Cloud latency makes this infeasible.
- **Data filtering** — Devices publish raw sensor readings at high frequency (10 Hz). The local rule engine aggregates (5-minute averages, min/max) and forwards only the aggregates to the cloud, reducing cloud message volume by 3,000x.

### Cloud for Analytics and Long-Term Storage

The cloud side handles workloads that benefit from elastic compute, managed storage, and broad integration:

- **Time-series analytics** — Dataflow/Kinesis processes telemetry streams, computes fleet-wide aggregations, and writes to BigQuery/Timestream for historical queries.
- **Machine learning** — Training anomaly detection models on historical data (cloud), deploying inference models to edge gateways (local). The training dataset is too large for edge storage; the inference latency is too high for cloud.
- **Dashboards and alerting** — Grafana Cloud or cloud-native dashboards (QuickSight, Managed Grafana) provide fleet-wide visibility. Site-level dashboards can run locally for operators who need visibility during cloud outages.

## Multi-Cloud and Cloud-Agnostic Patterns

Hybrid architectures naturally support multi-cloud strategies because the local broker is the integration point, not a cloud-specific SDK:

### MQTT as the Common Layer

Devices speak MQTT to their local broker. The local broker bridges to one or more cloud endpoints. Switching cloud providers means reconfiguring the bridge — changing the remote endpoint, updating credentials, and adjusting topic mappings. No device firmware changes are needed.

A multi-cloud deployment might bridge telemetry to AWS IoT Core for device management while simultaneously bridging the same data to GCP Pub/Sub (via an MQTT-to-Pub/Sub bridge) for analytics in BigQuery. The local broker fans out to both destinations independently.

### Avoiding Vendor-Specific Topic Structures

Cloud platforms use reserved topic namespaces for device management features:

- AWS: `$aws/things/{id}/shadow/...`
- Azure: `$iothub/twin/...`, `$iothub/methods/...`

Devices that publish directly to these topics are locked to that platform. A hybrid architecture that keeps device-facing topics generic (`devices/{id}/telemetry`, `devices/{id}/config`) and uses the bridge to translate into platform-specific topics preserves portability. The bridge configuration handles the mapping; the device firmware remains cloud-agnostic.

## Migration Paths

### Self-Hosted to Cloud

Adding a cloud layer to an existing self-hosted deployment:

1. Deploy an MQTT bridge from the existing self-hosted broker to the target cloud platform.
2. Forward telemetry topics to the cloud while maintaining local processing unchanged.
3. Gradually move device management (provisioning, OTA) to cloud services as confidence builds.
4. Optionally migrate devices to connect directly to the cloud endpoint if the local broker is no longer needed.

The bridge provides a non-disruptive transition — devices never change their connection endpoint during the migration.

### Cloud to Hybrid

Adding a local layer to an existing cloud-only deployment:

1. Deploy a local MQTT broker at each site.
2. Reconfigure devices to connect to the local broker instead of the cloud endpoint (via OTA configuration update or DNS redirection).
3. Configure the local broker to bridge all traffic to the cloud — the cloud side sees no change initially.
4. Gradually add local processing (rule engine, edge analytics) to reduce cloud dependency and latency.

This path is common when cloud latency or connectivity reliability proves insufficient for operational requirements discovered after initial deployment.

### Cloud to Cloud

Migrating between cloud providers (e.g., GCP IoT Core retirement):

1. Deploy a local broker as an intermediate layer.
2. Bridge from the local broker to the new cloud platform.
3. Migrate devices from the old cloud endpoint to the local broker (one cohort at a time).
4. Decommission the bridge to the old cloud platform.
5. Optionally remove the local broker and connect devices directly to the new cloud, or keep the hybrid architecture as insurance against future platform changes.

## Data Sovereignty Patterns

Regulatory requirements often dictate where data can be stored and processed. Hybrid architectures address this by splitting the data path:

- **Process locally, send aggregates to cloud** — Raw sensor data (which may contain personally identifiable or regulated information) stays on the local broker and local storage. Aggregated, anonymized, or derived metrics are forwarded to the cloud for fleet-wide analytics. The cloud never sees raw data.
- **Geofenced processing** — Each site's local broker processes data within its regulatory jurisdiction. A European site keeps data in the EU; a US site keeps data in the US. Cloud services receive only cross-site analytics that have been sanitized to comply with the strictest applicable regulation.
- **Audit trail separation** — Detailed device interaction logs stay on-premises (where they can be audited without cloud provider involvement). Summary health metrics go to the cloud for operational dashboards.

## Cost Modeling

The economic case for hybrid architecture depends on the balance between cloud service costs and local infrastructure costs:

### When Hybrid Is Cheaper Than Pure Cloud

- **High message volume, moderate fleet size** — 10,000 devices publishing every 10 seconds generate 86.4 million messages/day. Cloud messaging costs ($1/million messages) total $86/day. A local broker that aggregates 10-second readings into 5-minute summaries before forwarding reduces cloud messages by 30x to $2.88/day, plus local broker infrastructure cost (~$5/day for a 2-node EMQX cluster on small VMs). Net savings: ~$78/day.
- **Large payload processing** — Devices sending 10 KB image thumbnails or audio clips for cloud ML inference. Processing locally (edge ML) and sending only results (100 bytes) to the cloud reduces data transfer costs by 100x.

### When Hybrid Is More Expensive Than Pure Cloud

- **Small fleets with low message volume** — 100 devices publishing every minute generate 144,000 messages/day. Cloud cost: $0.14/day. Running a local broker and bridge infrastructure costs more in compute, storage, and operational overhead than the cloud messaging fee.
- **When local infrastructure requires dedicated operations staff** — The salary cost of maintaining local broker infrastructure can dwarf cloud service fees for fleets under 10,000 devices, unless existing operations teams absorb the work.

### When Hybrid Is Cheaper Than Pure Self-Hosted

- **Analytics workloads** — Running Elasticsearch, Grafana, and a time-series database on-premises for fleet analytics costs more in infrastructure and management than using managed cloud equivalents (CloudWatch, BigQuery, Managed Grafana) — especially when the analytics workload is bursty rather than constant.

## Tips

- Start with a unidirectional bridge (local → cloud) before adding the cloud → local direction. Telemetry forwarding is straightforward and low-risk. Command delivery from cloud to local devices through the bridge introduces message ordering, delivery confirmation, and security considerations that are easier to address incrementally.
- Use separate bridge credentials with minimal permissions. The bridge authenticates to the cloud as a single client — its cloud-side permissions should be scoped to the specific topics it forwards to and receives from. A compromised bridge credential should not grant access to the entire cloud IoT namespace.
- Implement message deduplication on the cloud consumer side, not on the bridge. The bridge operates at the MQTT level where QoS 1 guarantees at-least-once delivery. Deduplication belongs in the application layer where business logic can determine what constitutes a duplicate (same device + timestamp, same sequence number, identical payload hash).
- Size the local bridge buffer for the longest expected cloud outage plus a safety margin. An industrial site with a 99.5% internet uptime SLA experiences approximately 44 hours of downtime per year. If outages cluster (a single multi-hour event rather than many short ones), the buffer should hold at least 8–12 hours of telemetry at peak message rate.
- Test the bridge reconnection behavior under realistic conditions — not just clean disconnects but also half-open TCP connections, DNS failures, and TLS certificate errors. The bridge should detect a stale connection within 1–2 MQTT keepalive intervals and attempt reconnection with exponential backoff.

## Caveats

- **Bidirectional bridges create message routing loops if topic mapping is not carefully designed.** If the bridge forwards `devices/#` from local to cloud and `devices/#` from cloud to local, a message published locally will be forwarded to the cloud, then forwarded back from the cloud, creating an infinite loop. The solution is asymmetric topic mapping — forward `devices/+/telemetry` upstream and `devices/+/commands` downstream, never the same topic in both directions.
- **Bridge failover is not automatic in most broker configurations.** If the bridge process fails or the bridge node in an EMQX cluster goes down, bridged traffic stops until the bridge is restarted or another node takes over the bridge connection. Some brokers support bridge redundancy (standby bridge connections), but the failover is not instantaneous — a gap of 10–60 seconds in cloud data delivery is typical.
- **Cloud-side message ordering is not guaranteed when replaying buffered messages.** During buffer replay after an outage, messages arrive at the cloud endpoint in the order they were buffered locally, but they are interleaved with new real-time messages from devices that may have started publishing through an alternative path (direct cloud connection, cellular fallback). Time-series consumers that assume strictly ordered input produce incorrect results during replay windows.
- **The local broker and cloud endpoint may have different MQTT feature support.** A local EMQX broker supporting MQTT 5.0 features (topic aliases, user properties, shared subscriptions) bridging to AWS IoT Core (which supports MQTT 5.0 but with limitations) or Azure IoT Hub (which uses a subset of MQTT) may silently drop features that the cloud endpoint does not support. Bridge testing must verify that every feature used on the local side translates correctly through the bridge.
- **Hybrid architectures double the attack surface.** Both the local broker and the cloud endpoint are targets. The bridge connection between them is an additional attack vector — a compromised bridge can inject messages into the cloud or intercept commands flowing to devices. TLS with mutual authentication on the bridge connection, network segmentation isolating the bridge, and bridge credential rotation are necessary security measures.

## In Practice

- **A hybrid deployment where devices report correct data locally but cloud dashboards show gaps or zeros** commonly traces to the bridge's topic mapping. The local topic `devices/sensor-042/telemetry` is forwarded as `sites/factory-a/devices/sensor-042/telemetry` on the cloud side, but the cloud-side rule or subscription expects `factory-a/devices/sensor-042/telemetry` (without the `sites/` prefix). The messages arrive at the cloud endpoint but are not matched by any consumer. Checking the cloud broker's received-message metrics (which count all arrivals regardless of consumer) against the consumer's processed-message count reveals the mismatch.
- **A bridge that runs reliably for weeks then suddenly disconnects and fails to reconnect** often indicates TLS certificate expiry on the cloud side or the bridge side. The bridge established its TLS session with a valid certificate, maintained the connection through MQTT keepalives (which do not renegotiate TLS), and only discovered the certificate problem when the TCP connection dropped and the bridge attempted a new TLS handshake. Certificate monitoring on both ends of the bridge prevents this surprise.
- **Cloud-side analytics that show a sudden spike in message volume after a site outage** is the expected behavior of buffer replay, not a device malfunction. The local broker buffered hours of telemetry during the outage and forwards it all when connectivity resumes. Cloud-side rate limiting or ingestion throttling that was sized for real-time message rates may reject or drop replayed messages. Configuring the bridge to replay at a controlled rate (e.g., 80% of the cloud endpoint's rate limit) prevents replay-induced throttling.
- **Devices at one site receiving commands intended for devices at another site** indicates a bridge topic mapping that does not include site-scoping on the command path. If both sites bridge from `commands/#` on the cloud side to `devices/+/commands` locally, a command published to `commands/sensor-042/reboot` on the cloud reaches both sites. Scoping the cloud-side command topic to `sites/{site_id}/commands/#` and configuring each site's bridge to subscribe only to its own site prefix prevents cross-site command leakage.
- **A hybrid architecture that performs well in steady state but degrades during firmware OTA rollouts** often results from the bridge forwarding firmware image chunks alongside telemetry. A 10 MB firmware image downloaded in 1 KB MQTT messages generates 10,000 additional messages per device. During a fleet-wide rollout, this overwhelms the bridge's buffer and bandwidth allocation. Serving OTA images from a local HTTP endpoint (not through the MQTT bridge) eliminates the problem — only the OTA notification and status messages traverse the bridge.
