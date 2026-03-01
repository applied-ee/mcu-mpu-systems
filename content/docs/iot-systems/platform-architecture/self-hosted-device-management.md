---
title: "Self-Hosted Device Management"
weight: 50
---

# Self-Hosted Device Management

Cloud IoT platforms bundle device management as a suite of managed services — AWS IoT Core provides thing registries and fleet provisioning, Azure DPS handles zero-touch enrollment, and both offer device shadows/twins for state synchronization. Self-hosted deployments must build each of these capabilities from individual components: a provisioning server for device enrollment, a certificate authority for identity management, an OTA update server for firmware delivery, and a state synchronization mechanism for configuration management. The operational surface area is significantly larger, but the architecture is fully customizable and free from cloud vendor constraints.

## Provisioning Without Cloud DPS

Cloud provisioning services (AWS Fleet Provisioning, Azure DPS) automate the workflow of assigning a device identity, issuing credentials, and registering the device in a fleet registry. Self-hosted provisioning replaces these managed services with a custom enrollment pipeline.

### Custom Provisioning Server

A typical self-hosted provisioning flow:

```
Device (first boot) ──TLS──→ Provisioning Server ──→ Certificate Authority
                                    │                        │
                                    ├── Issue device cert ←──┘
                                    ├── Register in fleet DB
                                    ├── Assign MQTT broker endpoint
                                    └── Return credentials to device
```

The provisioning server is an HTTP or MQTT service that:

1. Authenticates the device using a bootstrap credential (shared key, one-time token, or factory-provisioned claim certificate — the same concept as AWS provisioning by claim).
2. Validates the device against an allowlist or manufacturing database.
3. Requests a device-specific certificate from the CA (step-ca, Vault PKI, or cfssl).
4. Registers the device in a fleet database (PostgreSQL, MySQL) with metadata: device ID, hardware revision, firmware version, provisioning timestamp, assigned broker endpoint.
5. Returns the signed certificate, broker connection details, and initial configuration to the device.

### Certificate Enrollment Protocols

Two standard protocols automate certificate enrollment without custom API design:

- **EST (Enrollment over Secure Transport, RFC 7030)** — An HTTP-based protocol for certificate enrollment and renewal. The device sends a CSR over TLS, the EST server forwards it to the CA, and returns the signed certificate. EST supports re-enrollment (certificate renewal before expiry) and full CMC enrollment for complex scenarios. step-ca implements EST natively.
- **SCEP (Simple Certificate Enrollment Protocol)** — An older protocol common in enterprise and industrial environments. SCEP uses HTTP with PKCS#7 and PKCS#10 messages. Less elegant than EST but widely supported by embedded TLS stacks and hardware security modules. Microsoft NDES (Network Device Enrollment Service) is a common SCEP server in Windows-centric environments.

### Fleet Registry

Without a cloud thing registry, device metadata lives in a database:

```sql
CREATE TABLE devices (
    device_id       TEXT PRIMARY KEY,
    hardware_rev    TEXT NOT NULL,
    firmware_ver    TEXT NOT NULL,
    cert_serial     TEXT NOT NULL,
    cert_expires    TIMESTAMP NOT NULL,
    provisioned_at  TIMESTAMP DEFAULT NOW(),
    last_seen       TIMESTAMP,
    broker_endpoint TEXT NOT NULL,
    status          TEXT DEFAULT 'active'  -- active, suspended, decommissioned
);

CREATE INDEX idx_devices_status ON devices(status);
CREATE INDEX idx_devices_cert_expires ON devices(cert_expires);
```

A query like `SELECT device_id FROM devices WHERE firmware_ver < '2.5.0' AND status = 'active'` identifies devices needing an OTA update — equivalent to AWS IoT Core's fleet indexing dynamic groups but implemented with standard SQL.

Certificate expiry tracking (`cert_expires`) enables automated renewal alerts. A scheduled job queries for certificates expiring within 30 days and initiates re-enrollment through the EST server or custom renewal endpoint.

## OTA Without Cloud Delivery

Cloud platforms provide OTA infrastructure: AWS IoT Jobs, Azure Device Update, and their equivalents manage firmware image distribution, rollout scheduling, and progress tracking. Self-hosted OTA uses purpose-built update frameworks that run on private infrastructure.

### Open-Source OTA Frameworks

Three frameworks dominate self-hosted OTA for Linux-based devices:

| Framework | Update Model | Server | Device Agent |
|-----------|-------------|--------|-------------|
| **Mender** | Full root filesystem (dual A/B) or module-based | Mender Server (self-hosted or hosted) | `mender-client` daemon |
| **RAUC** | Bundle-based (A/B slots) | Custom HTTP/MQTT server | `rauc` service with D-Bus API |
| **SWUpdate** | Image or delta updates | hawkBit server or custom | `swupdate` with handlers |

**Mender** provides the most complete self-hosted experience. The Mender Server (open-source, deployable via Docker Compose or Kubernetes) includes a device inventory, deployment scheduler, artifact management, and rollback tracking. The device-side client handles download, verification, installation, and automatic rollback if the new firmware fails a health check on first boot.

**RAUC** is lighter-weight — a bundle manager that handles A/B partition switching with cryptographic verification. RAUC does not include a server component; the update bundle can be served from any HTTP endpoint, S3 bucket, or delivered via MQTT. The server-side orchestration (which devices get which update, rollout pacing, success tracking) must be built separately.

**SWUpdate** offers the most flexibility. It supports multiple update handlers (raw image, UBI volumes, scripts, bootloader environment), custom Lua scripting during updates, and integration with Eclipse hawkBit as an update orchestration server. hawkBit provides rollout management, device targeting, and campaign tracking — similar in scope to AWS IoT Jobs.

### MCU OTA (Bare-Metal and RTOS)

For microcontrollers without a Linux environment, OTA follows a different pattern:

- A custom bootloader (MCUboot, or vendor-specific) manages dual application slots.
- The device downloads a signed firmware image from an HTTP endpoint or receives it over MQTT in chunks.
- The bootloader validates the image signature, writes it to the secondary slot, and reboots into the new image.
- A watchdog timer and application self-test confirm the update succeeded. If the application fails to mark the image as valid before the watchdog expires, the bootloader rolls back to the previous slot.

The update server can be a simple HTTP file server behind a device-authenticated TLS endpoint. The update orchestration logic — determining which devices need updates, pacing rollouts, tracking success rates — typically runs as a service that publishes update availability notifications to MQTT topics and monitors device-reported firmware versions.

## Device Shadows/Twins Without Cloud

AWS device shadows and Azure device twins provide desired/reported state synchronization as a managed service. Self-hosted deployments can approximate this pattern at various levels of complexity.

### Retained MQTT Messages as Lightweight State Sync

The simplest approach uses MQTT retained messages as a state store:

- **Desired state** — A management application publishes a retained message to `devices/{id}/config/desired` with the target configuration as JSON payload.
- **Reported state** — The device publishes a retained message to `devices/{id}/config/reported` with its current configuration.
- **Delta detection** — The device (or a backend service) compares the desired and reported messages to identify configuration drift.

This approach requires no additional infrastructure beyond the MQTT broker. The broker stores the last retained message per topic indefinitely (or until explicitly cleared). Any new subscriber to a retained topic receives the current state immediately on subscription.

Limitations: retained messages are a single key-value store per topic with no versioning, no atomic compare-and-swap, no delta computation, and no conflict resolution beyond last-write-wins. For fleets with infrequent configuration changes (typical of sensor deployments), this is often sufficient. For complex state machines with concurrent updates from multiple sources, a proper shadow service is necessary.

### Custom Shadow Service

A more robust approach implements a shadow service as a backend component:

```
Device ──MQTT──→ Broker ──→ Shadow Service ──→ PostgreSQL/Redis
                   ↑               │
                   └── Publishes delta to devices/{id}/shadow/delta
```

The shadow service:

1. Subscribes to `devices/+/shadow/update` (device-reported state).
2. Stores reported state in a database alongside the desired state set by management APIs.
3. Computes the delta (keys present in desired but different in reported).
4. Publishes the delta to `devices/{id}/shadow/delta`.
5. Exposes a REST API for management applications to read device state and update desired properties.

This replicates the core functionality of AWS device shadows — desired/reported/delta with version tracking — at the cost of building and maintaining a stateful service. PostgreSQL handles the state storage; Redis can serve as a cache layer for high-frequency reads.

## Monitoring Stack

Cloud platforms provide integrated monitoring: AWS CloudWatch, Azure Monitor, and their IoT-specific dashboards. Self-hosted deployments assemble a monitoring stack from open-source components.

### Prometheus + Grafana On-Premises

The standard self-hosted monitoring stack for IoT infrastructure:

- **Prometheus** scrapes metrics from the MQTT broker (via exporter), the provisioning server, the OTA server, and any other infrastructure components. Custom metrics (fleet connection count, message throughput, provisioning success rate) are exposed via `/metrics` endpoints.
- **Grafana** provides dashboards and visualization. Pre-built dashboard templates exist for Mosquitto, EMQX, and HiveMQ.
- **Alertmanager** routes alerts based on Prometheus rules — broker connection count exceeding 90% of capacity, certificate expiry within 14 days, OTA failure rate exceeding threshold.

The monitoring infrastructure itself needs monitoring — a single-node Prometheus instance is a single point of failure for fleet visibility. Production deployments use Thanos or Cortex for high-availability Prometheus, or VictoriaMetrics as a more resource-efficient alternative.

For detailed coverage of monitoring backend infrastructure, time-series databases, alerting pipelines, and dashboard design, see [Monitoring & Telemetry]({{< relref "/docs/iot-systems/monitoring-telemetry" >}}).

## The Operational Burden

Self-hosted device management trades cloud service fees for operational responsibility. The infrastructure that cloud platforms provide "for free" (included in per-device or per-message pricing) must be built, deployed, monitored, and maintained:

| Capability | Cloud Platform Provides | Self-Hosted Requires |
|-----------|------------------------|---------------------|
| **Device registry** | Managed database with fleet indexing | PostgreSQL + custom API |
| **Certificate management** | Automated issuance, rotation, revocation | CA server (step-ca/Vault) + renewal automation |
| **Provisioning** | Fleet provisioning templates, JITP/DPS | Custom provisioning server + enrollment protocol |
| **State sync** | Device shadows/twins with delta computation | MQTT retained messages or custom shadow service |
| **OTA delivery** | IoT Jobs/Device Update with rollout management | Mender/SWUpdate/hawkBit + update orchestration |
| **Monitoring** | CloudWatch/Azure Monitor integration | Prometheus + Grafana + Alertmanager |
| **Audit logging** | Built-in event logging | Custom logging pipeline |
| **High availability** | Multi-AZ managed infrastructure | Redundant deployment + failover configuration |

For small fleets (< 1,000 devices), the operational overhead of self-hosting often exceeds the cloud service cost. The crossover point where self-hosted becomes economically favorable depends on message volume, fleet size, and the organization's existing infrastructure and operations capability. Fleets above 50,000 devices with moderate message rates almost always favor self-hosted economics.

## Tips

- Use EST (RFC 7030) for certificate enrollment rather than building a custom enrollment API. EST provides a standardized, well-tested protocol for CSR submission, certificate issuance, and re-enrollment. step-ca's EST implementation integrates with most embedded TLS stacks and avoids the need to design, document, and maintain a custom enrollment protocol.
- Start with MQTT retained messages for state synchronization before building a full shadow service. For fleets where configuration changes happen infrequently (daily or less), retained messages provide 80% of shadow functionality with zero additional infrastructure. Upgrade to a custom shadow service only when concurrent state updates, versioning, or complex delta logic become necessary.
- Deploy Mender Server with Docker Compose for fleets under 10,000 devices. The single-server deployment handles artifact storage, device inventory, and deployment scheduling without Kubernetes complexity. Scale to a Kubernetes-based deployment when device count, deployment frequency, or high-availability requirements justify the additional infrastructure.
- Track certificate expiry dates in the fleet registry and alert at 30, 14, and 7 days before expiry. Expired device certificates cause fleet-wide connection failures that appear identical to a broker outage. Automated certificate renewal via EST re-enrollment eliminates the manual rotation burden.
- Implement a health-check endpoint on the provisioning server that verifies connectivity to the CA, the fleet database, and the MQTT broker. A provisioning server that is running but cannot reach its dependencies silently fails to provision new devices — a condition that only becomes apparent when a new device arrives on the factory floor or in the field.

## Caveats

- **Self-hosted provisioning has no built-in rate limiting or abuse protection.** Cloud provisioning services throttle enrollment requests and detect anomalous patterns. A self-hosted provisioning server exposed to the network without rate limiting can be overwhelmed by a misconfigured device retry loop or a deliberate denial-of-service attack. Implement rate limiting per source IP and per bootstrap credential.
- **MQTT retained messages are not a database.** Retained messages persist across broker restarts (if persistence is enabled), but the broker provides no query interface, no transaction guarantees, and no backup mechanism beyond its persistence file. A broker failure that corrupts the persistence file loses all retained state. Critical device configuration should also be stored in a proper database, with retained messages as a delivery mechanism rather than the source of truth.
- **MCU OTA without A/B partitions risks bricking devices.** Single-partition update schemes that overwrite the running firmware have no rollback path if the update fails mid-write (power loss, flash corruption). A/B partitioning with a verified bootloader (MCUboot) is the minimum safe OTA architecture for deployed devices. The flash size cost (roughly 2x application partition size) is the price of reliable updates.
- **Custom shadow services introduce a stateful component that must be highly available.** If the shadow service fails, devices continue to operate with their last known configuration, but new configuration changes are lost and delta notifications stop. Unlike MQTT retained messages (which the broker serves as long as it is running), a shadow service failure creates a gap in the state synchronization chain.
- **Self-hosted OTA servers become a high-value attack target.** A compromised update server can push malicious firmware to the entire fleet. Image signing with asymmetric keys (the private key on the build server, the public key on each device) ensures that devices reject tampered images even if the update server is compromised. The signing key must never reside on the update server itself.

## In Practice

- **A provisioning server that works reliably in the lab but fails intermittently on the factory floor** often traces to network timing. Factory networks may have higher latency or packet loss than the lab environment. The device's provisioning client uses a 2-second timeout on the HTTP enrollment request, the provisioning server takes 3 seconds to sign the certificate through the CA, and the request times out. Increasing client-side timeouts and adding retry logic with backoff resolves the immediate issue; optimizing the CA's signing latency addresses the root cause.
- **Devices that successfully provision but fail to connect to the MQTT broker** commonly result from the provisioning server returning a broker endpoint that the device cannot resolve. If the broker is addressed by an internal hostname (`mqtt.iot.local`) and the device's DNS configuration does not include the internal DNS server, the connection fails at DNS resolution before TLS even begins. Provisioning with IP addresses avoids DNS dependency but creates a different maintenance burden if the broker's address changes.
- **An OTA rollout that succeeds on 95% of devices but consistently fails on the remaining 5%** frequently correlates with hardware revision. Devices from an earlier manufacturing run may have a different flash layout, a smaller flash chip, or a bootloader version that does not support the current update format. The fleet registry's hardware revision field identifies the affected cohort, and a revision-specific update bundle addresses the incompatibility.
- **A self-hosted shadow service that reports increasing database size over months without corresponding fleet growth** typically indicates that shadow history is accumulating without compaction. Each state update creates a new row (or document version) in the database. Without a retention policy that prunes historical state older than a configured window (7 days, 30 days), the database grows unboundedly. Adding a scheduled cleanup job with appropriate retention resolves the growth.
- **Devices that oscillate between two configuration states — applying a desired change, reverting on reboot, reapplying, reverting again** usually indicate that the device's startup code reads configuration from local flash (the old value) and publishes it as reported state before checking for pending deltas. The shadow service sees the old reported state, computes a new delta, and the cycle repeats. Ensuring that the device checks for deltas and applies them before publishing its initial reported state breaks the loop.
