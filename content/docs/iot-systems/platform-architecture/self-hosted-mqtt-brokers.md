---
title: "Self-Hosted MQTT Brokers"
weight: 40
---

# Self-Hosted MQTT Brokers

Self-hosted MQTT brokers provide the same publish/subscribe messaging layer that cloud IoT platforms offer — but under full operational control. The broker runs on private infrastructure (bare metal, VMs, containers, or Kubernetes), handles device authentication and authorization locally, and delivers messages without routing through a cloud provider's endpoint. This eliminates per-message cloud fees, keeps data on-premises for sovereignty requirements, and removes dependency on external service availability. The tradeoff is operational responsibility: scaling, patching, monitoring, TLS certificate management, and persistence all shift to the deploying organization.

Three brokers dominate self-hosted IoT deployments: Mosquitto for single-node simplicity, EMQX for clustered high-availability, and HiveMQ for enterprise environments with commercial support requirements.

## Mosquitto

Eclipse Mosquitto is the reference open-source MQTT broker. It is single-threaded, runs in under 1 MB of RAM at idle, and handles 10,000–50,000 concurrent connections on modest hardware (2-core VM, 2 GB RAM). Mosquitto's simplicity is its strength — a single configuration file, a single binary, and predictable behavior under load.

### Configuration

The core configuration lives in `mosquitto.conf`:

```
listener 8883
certfile /etc/mosquitto/certs/server.crt
keyfile /etc/mosquitto/certs/server.key
cafile /etc/mosquitto/certs/ca.crt
require_certificate true

persistence true
persistence_location /var/lib/mosquitto/

max_inflight_messages 20
max_queued_messages 1000
```

Key settings for IoT deployments:

| Setting | Purpose | Typical Value |
|---------|---------|---------------|
| `max_connections` | Hard limit on concurrent clients | -1 (unlimited) or match OS file descriptor limit |
| `max_inflight_messages` | QoS 1/2 messages in flight per client | 10–20 |
| `max_queued_messages` | Messages queued for disconnected persistent clients | 1000–10000 |
| `persistent_client_expiration` | How long to keep sessions for disconnected clients | 24h for battery devices, 1h for mains-powered |
| `message_size_limit` | Maximum payload size in bytes | 262144 (256 KB) |

### Authentication and ACLs

Mosquitto supports several authentication backends:

- **Password file** — A flat file of username/bcrypt-hashed password pairs. Simple, suitable for small fleets (< 100 devices). The file is loaded at startup; changes require a reload signal (`SIGHUP`).
- **Dynamic security plugin** (`mosquitto_dynamic_security`)** — A built-in plugin (Mosquitto 2.0+) that manages clients, groups, and roles through an administrative MQTT API. Clients are organized into groups, groups are assigned roles, and roles define topic access. All configuration is persisted to a JSON file and can be modified at runtime without restart.
- **Custom auth plugin** — A shared library implementing the Mosquitto plugin API. Common patterns include authenticating against LDAP, a PostgreSQL database, or an HTTP endpoint. The `mosquitto-go-auth` community plugin supports multiple backends (files, PostgreSQL, MySQL, JWT, HTTP) in a single plugin.
- **X.509 client certificates** — Mutual TLS where each device presents a client certificate. The `require_certificate true` and `use_identity_as_username true` settings extract the certificate's Common Name (CN) as the MQTT username, which can then be used in ACL rules.

ACL patterns map certificate identities or usernames to topic permissions:

```
# Device can publish to its own telemetry topic
pattern readwrite devices/%u/telemetry

# Device can subscribe to its own command topic
pattern read devices/%u/commands

# All devices can read shared configuration
topic read config/global/#
```

The `%u` substitution resolves to the connecting client's username (or certificate CN). This scoping pattern — equivalent to AWS IoT Core's `${iot:Connection.Thing.ThingName}` policy variable — prevents devices from accessing other devices' topics.

### Limitations

Mosquitto is single-threaded and does not cluster. Throughput is bounded by a single CPU core — approximately 50,000–80,000 messages per second for small payloads (< 256 bytes) on modern hardware. For fleets exceeding 50,000 concurrent connections or requiring high-availability failover, EMQX or HiveMQ are more appropriate. Mosquitto can be deployed behind a load balancer with sticky sessions for horizontal scaling, but this requires external session state management and does not provide shared subscriptions across instances.

## EMQX

EMQX is a distributed MQTT broker designed for high-concurrency IoT workloads. The open-source edition supports clustering, MQTT 5.0, a built-in rule engine, and millions of concurrent connections across a multi-node cluster. The enterprise edition adds role-based access control, audit logging, and additional data integration plugins.

### Clustering

EMQX nodes form a cluster using Erlang's distributed process model. A 3-node cluster provides:

- **Automatic failover** — If a node goes down, clients reconnect to surviving nodes. Persistent sessions are replicated across the cluster, so QoS 1/2 message queues survive node failures.
- **Shared subscriptions** — Multiple clients subscribe to the same topic with load balancing across subscribers. Messages are distributed round-robin or by hash, enabling parallel processing of high-volume telemetry streams.
- **Linear scaling** — Each additional node adds connection capacity. A single EMQX node handles approximately 1–2 million concurrent connections on a 16-core, 32 GB RAM server. A 3-node cluster comfortably handles 3–5 million connections.

Cluster formation uses one of several discovery mechanisms:

| Discovery Method | Use Case |
|-----------------|----------|
| `static` | Fixed node list in config — suitable for known infrastructure |
| `dns` | DNS A/SRV record lookup — works with Kubernetes headless services |
| `etcd` | External etcd cluster for node registration |
| `k8s` | Kubernetes API-based discovery using pod labels |

### MQTT 5.0 Features

EMQX's MQTT 5.0 support enables features unavailable on older brokers or cloud platforms with limited 5.0 implementation:

- **Topic aliases** — Replace long topic strings with short integer aliases after the first publish, reducing per-message overhead for constrained devices.
- **User properties** — Key-value metadata on PUBLISH and CONNECT packets. Useful for carrying device metadata (firmware version, hardware revision) without embedding it in the payload.
- **Shared subscriptions** — `$share/group/topic` syntax distributes messages across group members. A pool of backend workers subscribing to `$share/processors/telemetry/#` processes telemetry in parallel without each worker receiving every message.
- **Request/response** — Correlation data and response topic fields enable RPC-style interactions over MQTT without custom protocol layers.
- **Session expiry interval** — Per-client configurable session lifetime, allowing battery-powered devices to request longer session persistence than always-on gateways.

### Rule Engine

EMQX includes a SQL-based rule engine that processes messages inside the broker without external consumers:

```sql
SELECT payload.temperature AS temp, payload.humidity AS humid, clientid
FROM "devices/+/telemetry"
WHERE payload.temperature > 50.0
```

Rules can forward matching messages to external systems: PostgreSQL, MySQL, Redis, Kafka, HTTP endpoints, or other MQTT brokers. This eliminates the need for a separate bridge service between the broker and the data pipeline — a function that AWS IoT Core's rules engine provides as a managed service.

### Bridging

EMQX supports MQTT bridging to other brokers, including cloud MQTT endpoints. A bridge configuration connects to AWS IoT Core, Azure IoT Hub, or another EMQX cluster and forwards selected topics bidirectionally. This is the foundation for hybrid architectures where a local broker handles device-facing traffic and forwards aggregated data to the cloud.

## HiveMQ

HiveMQ is a commercial MQTT broker focused on enterprise IoT deployments. The Community Edition is open-source and suitable for development and small-scale production. The Platform (commercial) edition adds clustering, persistence, and an extension SDK.

### Enterprise Features

- **Extension SDK** — A Java-based API for custom authentication, authorization, message transformation, and integration with external systems. Extensions run inside the broker process with access to every message lifecycle event. Common extensions include LDAP/Active Directory authentication, database-backed ACLs, and protocol translation.
- **Control Center** — A web-based management UI for monitoring connections, subscriptions, retained messages, and cluster health. Provides real-time dashboards and historical metrics without deploying a separate monitoring stack.
- **Data Hub** — A schema registry and data governance layer that validates message payloads against JSON Schema or Protobuf definitions before delivery. Messages that fail validation can be dropped, redirected to a dead-letter topic, or flagged for review. This catches malformed telemetry at the broker level rather than in downstream consumers.

### Persistence

HiveMQ uses a disk-based persistence layer rather than relying solely on memory. This means retained messages, QoS 1/2 message queues, and client session state survive broker restarts without data loss. The persistence engine is designed for append-heavy IoT workloads with configurable compaction and retention policies.

## TLS Setup Without Cloud PKI

Cloud platforms manage TLS certificate lifecycle automatically — AWS IoT Core generates device certificates from its internal CA, and Azure DPS handles certificate enrollment. Self-hosted deployments must build this infrastructure.

### Private Certificate Authority

A typical setup uses a two-tier CA hierarchy:

```
Root CA (offline, air-gapped)
  └── Intermediate CA (online, signs device certificates)
        ├── Device certificate: sensor-001
        ├── Device certificate: sensor-002
        └── Device certificate: gateway-A
```

The root CA private key stays offline (hardware security module or air-gapped machine). The intermediate CA signs device certificates during manufacturing or provisioning. If the intermediate CA is compromised, it can be revoked without replacing the root CA on every device.

Tools for managing the CA:

- **OpenSSL** — Direct CA management with `openssl ca`. Full control but manual and error-prone at scale.
- **cfssl** — Cloudflare's PKI toolkit. JSON-based configuration, REST API for certificate signing, suitable for automation in manufacturing lines.
- **step-ca** (Smallstep) — A lightweight online CA with ACME protocol support, SSH certificate issuance, and automatic renewal. Integrates well with automated provisioning pipelines.
- **HashiCorp Vault PKI** — Vault's PKI secrets engine generates and signs certificates on demand. The most feature-rich option but adds Vault as an infrastructure dependency.

### Client Certificate Authentication

With mutual TLS configured on the broker, every connecting device must present a certificate signed by a trusted CA. The broker validates the certificate chain, checks revocation status (via CRL or OCSP if configured), and extracts the device identity from the certificate's Common Name or Subject Alternative Name fields.

Certificate Revocation Lists (CRLs) or OCSP stapling provide a mechanism to revoke compromised device certificates without replacing the CA certificate on every other device. CRL distribution is simpler but requires periodic updates; OCSP provides real-time revocation checking but adds a network dependency to every TLS handshake.

## Capacity Planning

Broker sizing depends on three primary dimensions:

| Dimension | Scaling Factor | Memory Impact |
|-----------|---------------|---------------|
| **Concurrent connections** | Each idle MQTT connection holds a TCP socket and session state | 10–50 KB per connection (broker-dependent) |
| **Message throughput** | Messages per second across all topics | CPU-bound; scales with core count |
| **Message size** | Average payload size | Memory for in-flight and queued messages |

### Sizing Examples

| Fleet Size | Broker | Hardware | Notes |
|------------|--------|----------|-------|
| 1,000 devices, 1 msg/min | Mosquitto | 1 vCPU, 512 MB RAM | Single node, minimal resources |
| 10,000 devices, 1 msg/10s | Mosquitto | 2 vCPU, 2 GB RAM | Approaching single-node limit |
| 50,000 devices, 1 msg/10s | EMQX (3-node) | 4 vCPU, 8 GB RAM per node | Shared subscriptions for parallel processing |
| 500,000 devices, 1 msg/min | EMQX (5-node) | 8 vCPU, 16 GB RAM per node | Rule engine offloads some processing |

These estimates assume small payloads (< 1 KB) and QoS 1. Larger payloads, QoS 2, or heavy use of retained messages increase memory requirements.

## Operational Concerns

### Upgrades

Broker upgrades in production require planning that cloud-managed services handle invisibly:

- **Mosquitto** — Single-node, so upgrades require a maintenance window. Persistent sessions survive a restart if the persistence database is preserved, but clients will disconnect and must reconnect.
- **EMQX** — Rolling upgrades across cluster nodes. Take one node out of the cluster, upgrade it, rejoin it, and proceed to the next. Clients on the upgraded node reconnect to other cluster members during the upgrade window.
- **HiveMQ** — Similar rolling upgrade model for clustered deployments.

### Monitoring

Self-hosted brokers need external monitoring (the broker does not monitor itself):

- **Mosquitto** — Publishes system metrics to `$SYS/#` topics (connected clients, messages sent/received, bytes transferred). A Telegraf or Prometheus exporter subscribes to `$SYS/#` and exposes metrics.
- **EMQX** — Built-in Prometheus endpoint (`/api/v5/prometheus/stats`) and a Grafana dashboard template. Exposes connection counts, message rates, rule engine execution stats, and per-node resource utilization.
- **HiveMQ** — Control Center provides built-in monitoring. Also exposes JMX metrics for integration with Prometheus via the JMX exporter.

### Backup and Recovery

- **Mosquitto** — Back up the persistence database file (`mosquitto.db`) and the configuration directory. Restoring from backup recovers retained messages and persistent session state.
- **EMQX** — Cluster state is replicated across nodes. Single-node failures recover automatically. Full cluster backup requires snapshotting the Mnesia database on each node.
- **HiveMQ** — The persistence layer is self-contained per node. Cluster-level backup requires coordinated snapshots.

## When Self-Hosted Beats Cloud-Managed

Self-hosted MQTT brokers are the better architectural choice in several scenarios:

- **Air-gapped networks** — Industrial control systems, classified environments, and facilities without internet connectivity cannot use cloud-managed brokers. The broker must run on the same network as the devices.
- **Data sovereignty** — Regulatory requirements (GDPR, HIPAA, national data residency laws) may prohibit telemetry data from leaving a specific geographic boundary or facility. A local broker keeps all data on-premises.
- **Cost at scale** — Cloud MQTT services charge per message or per connection-minute. A fleet of 100,000 devices publishing every 10 seconds generates 864 million messages per day. At $1.00 per million messages (AWS IoT Core pricing tier), that is $864/day ($315,000/year) in messaging costs alone. A 5-node EMQX cluster handling the same load runs on approximately $3,000/month in compute costs.
- **Latency requirements** — A local broker on the same LAN as the devices delivers messages in 1–5 ms. Cloud brokers add 20–200 ms of round-trip latency depending on region and network path. Control loops that require sub-10 ms response times cannot tolerate the cloud path.
- **Protocol flexibility** — Cloud MQTT endpoints often restrict protocol features (AWS IoT Core does not support QoS 2, limits subscriptions to 50 per connection). A self-hosted broker provides full control over protocol version, QoS levels, topic limits, and payload sizes.

## Tips

- Start with Mosquitto for fleets under 10,000 devices unless high-availability is a hard requirement. Mosquitto's single-binary deployment, minimal configuration, and predictable resource consumption make it the fastest path to a working self-hosted broker. Migration to EMQX or HiveMQ later is straightforward — the MQTT protocol is the same; only the broker-side configuration changes.
- Use the dynamic security plugin (Mosquitto 2.0+) instead of static password and ACL files for any deployment that adds or removes devices at runtime. The administrative MQTT API allows provisioning systems to create client credentials and assign topic permissions without restarting the broker.
- Configure persistent sessions with explicit expiry intervals matched to device behavior. A battery-powered sensor that connects once per hour needs a session expiry of at least 2 hours. A mains-powered gateway with continuous connectivity can use a shorter expiry (15–30 minutes). Over-provisioning session expiry wastes broker memory; under-provisioning causes message loss during expected disconnection periods.
- Deploy EMQX with an odd number of nodes (3 or 5) for cluster consensus. Even-numbered clusters can encounter split-brain scenarios during network partitions. The `autoheal` split-brain recovery strategy is the safest default for IoT workloads where data consistency matters more than availability during partitions.
- Monitor `$SYS/#` topics (Mosquitto) or the Prometheus endpoint (EMQX) from the start, not after a production incident. Connection count trends, message rate anomalies, and subscription growth are the leading indicators of capacity problems.

## Caveats

- **Mosquitto does not cluster.** A single Mosquitto instance is a single point of failure. Deploying two Mosquitto instances behind a load balancer provides connection-level redundancy but does not replicate session state — a client that fails over to the second instance loses its persistent session, queued messages, and subscription state. True high-availability requires EMQX, HiveMQ, or a third-party clustering solution.
- **EMQX's open-source edition does not include all enterprise features.** Role-based access control, audit logging, the Data Hub schema registry, and some data integration connectors are enterprise-only. The open-source rule engine and clustering are fully functional, but compliance-driven deployments may require the commercial license.
- **Self-hosted TLS certificate management is an ongoing operational burden.** Server certificates expire (typically 1–2 years), intermediate CA certificates expire (3–5 years), and CRLs must be regenerated and distributed on a schedule. A missed certificate renewal causes a fleet-wide connection failure — every device rejects the broker's expired certificate simultaneously. Automated renewal with step-ca or Vault PKI mitigates this but adds infrastructure complexity.
- **Broker memory consumption scales with the number of queued QoS 1/2 messages, not just connections.** A fleet of 50,000 devices with persistent sessions and 1,000-message queues per device consumes 50 million message slots at worst case. If the average message is 512 bytes, that is 25 GB of memory for queued messages alone — far more than the connection overhead. Tune `max_queued_messages` conservatively and monitor queue depth.
- **MQTT bridging between self-hosted and cloud brokers introduces a single point of failure at the bridge.** If the bridge process fails or the cloud endpoint is unreachable, messages accumulate on the local broker. Without explicit backpressure or overflow handling, the local broker's memory or disk fills up. Bridge monitoring and store-and-forward with bounded buffers are essential in hybrid deployments.

## In Practice

- **A self-hosted Mosquitto broker that handles a development fleet of 50 devices without issue but fails under a production fleet of 5,000** is typically hitting the operating system's file descriptor limit rather than Mosquitto's own limits. Each MQTT connection consumes a file descriptor, and the default `ulimit -n` on many Linux distributions is 1,024. Setting the file descriptor limit to 65,536 or higher (via `systemd` unit configuration or `/etc/security/limits.conf`) resolves the immediate problem.
- **Devices that connect successfully to a self-hosted broker but disconnect every few minutes with "not authorized" errors** often indicate a mismatch between the certificate's Common Name and the ACL pattern. If the certificate CN is `sensor-001` but the ACL expects `devices/sensor-001/telemetry` with `%u` substitution resolving to the MQTT username (which defaults to empty if not explicitly set), the ACL check fails on every publish. Setting `use_identity_as_username true` in Mosquitto aligns the certificate identity with the ACL substitution variable.
- **An EMQX cluster where message delivery latency spikes periodically despite low CPU and memory utilization** often traces to garbage collection pauses in the Erlang VM. EMQX's default Erlang VM settings are tuned for throughput, not latency. Adjusting the `+hms` (heap management strategy) and `+P` (process limit) flags, or enabling dirty schedulers for I/O-heavy workloads, smooths latency at the cost of slightly lower peak throughput.
- **A fleet migration from a cloud broker to a self-hosted broker where 10% of devices fail to connect** commonly results from devices that have a cloud-provider-specific root CA certificate hardcoded in firmware rather than a configurable trust store. The cloud CA (e.g., Amazon Root CA 1) validates the cloud endpoint's certificate but does not validate the self-hosted broker's certificate signed by a private CA. Devices need the private CA's root certificate in their trust store — which may require a firmware update through the old cloud platform before the migration.
- **A self-hosted broker that runs reliably for months then experiences a sudden cascade of disconnections across the entire fleet** is a classic symptom of TLS certificate expiration. Server certificate renewal was missed, every client rejects the expired certificate at the same moment, and reconnection attempts create a thundering herd that overwhelms the broker once the certificate is replaced. Automated certificate monitoring with alerting at 30, 14, and 7 days before expiry prevents the scenario entirely.
