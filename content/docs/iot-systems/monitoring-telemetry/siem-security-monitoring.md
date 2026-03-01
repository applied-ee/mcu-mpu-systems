---
title: "SIEM & Security Monitoring"
weight: 60
---

# SIEM & Security Monitoring

Security Information and Event Management (SIEM) applies to IoT fleets differently than to traditional IT infrastructure. Enterprise SIEM monitors user logins, firewall logs, endpoint detection alerts, and application audit trails. IoT SIEM monitors device authentication events, firmware integrity, anomalous traffic patterns, and communication between constrained devices and cloud endpoints — a fundamentally different telemetry profile with different threat models. A compromised web server exfiltrates data; a compromised IoT device may become part of a botnet, physically manipulate an actuator, or provide a lateral entry point into an enterprise network. Detecting and responding to these threats requires security monitoring infrastructure tuned to the unique characteristics of embedded device fleets.

## SIEM Architecture for IoT

A SIEM system collects, normalizes, correlates, and analyzes security-relevant events from across the infrastructure:

- **Collection** — Security events from MQTT brokers (authentication failures, ACL violations), cloud platforms (device shadow modifications, policy changes), network infrastructure (firewall logs, IDS alerts), and device telemetry (unexpected reboot patterns, firmware hash mismatches) are ingested into the SIEM.
- **Normalization** — Events from heterogeneous sources are mapped to a common schema. The Elastic Common Schema (ECS) or OCSF (Open Cybersecurity Schema Framework) provides standardized field names for event type, source IP, device identity, timestamp, and severity.
- **Correlation** — Rules engine links related events across time and sources. A single authentication failure is noise; 50 authentication failures for different device IDs from the same source IP in 5 minutes is a credential stuffing attack. Correlation rules express these multi-event patterns.
- **Analysis and alerting** — Correlated events are evaluated against detection rules, and alerts are generated for conditions that warrant investigation. Severity classification (informational, low, medium, high, critical) routes alerts appropriately.

### Platform Options

- **Elastic SIEM** — Built on the Elastic Stack (Elasticsearch, Kibana, Elastic Agent). Provides detection rules, case management, and timeline investigation. Shares infrastructure with ELK-based log aggregation, reducing operational overhead. Detection rules are written in KQL or EQL (Event Query Language) for sequence-based detections.
- **Splunk** — Enterprise SIEM with SPL (Search Processing Language) for complex event correlation. Splunk's IoT-specific apps and add-ons provide pre-built dashboards and detection rules for common IoT platforms. The pricing model (per GB ingested) makes it expensive for high-volume IoT telemetry — security events should be filtered before ingestion, sending only security-relevant data to Splunk rather than all device telemetry.
- **Wazuh** — Open-source security monitoring platform with host-based intrusion detection, log analysis, and vulnerability detection. Wazuh agents run on Linux-based gateways and edge devices (Raspberry Pi, industrial gateways), providing file integrity monitoring, rootkit detection, and log-based intrusion detection. The central Wazuh manager correlates events from all agents. For MCU-based devices that cannot run agents, Wazuh monitors the MQTT broker and cloud platform logs instead.
- **Microsoft Sentinel** — Cloud-native SIEM on Azure. Integrates directly with Azure IoT Hub, providing built-in detection rules for IoT-specific threats. Kusto Query Language (KQL) enables custom detection rules. Consumption-based pricing aligns with variable IoT event volumes.

## Anomalous Traffic Detection

IoT devices have predictable network behavior profiles: a temperature sensor connects to the MQTT broker on port 8883, publishes to its telemetry topic every 60 seconds, and occasionally subscribes to its command topic. Deviations from this profile indicate misconfiguration, compromise, or malfunction:

- **Unexpected outbound connections** — A device connecting to IP addresses or ports outside its expected communication pattern (MQTT broker, NTP server, OTA update endpoint) may be compromised. DNS query logs revealing resolution requests for unknown domains are a strong indicator. Detection rule: alert when a device's DNS queries include domains not in the allowlist.
- **Traffic volume anomalies** — A sensor that normally transmits 200 bytes every 60 seconds suddenly transmitting 50 KB every 10 seconds is either malfunctioning or exfiltrating data. Baseline traffic volume per device type and alert on deviations exceeding 3 standard deviations from the 7-day rolling average.
- **Protocol anomalies** — A device using HTTP, SSH, or Telnet when the fleet exclusively uses MQTT over TLS indicates either a misconfigured device or an attacker using the device as a proxy. Network flow logs from the gateway or firewall provide protocol-level visibility.
- **Lateral movement indicators** — An IoT device scanning other devices or internal network segments is a strong compromise indicator. IoT devices have no legitimate reason to initiate connections to other devices (peer-to-peer exceptions aside). Firewall logs showing connection attempts from an IoT VLAN to the corporate VLAN warrant immediate investigation.

## Intrusion Detection Patterns

Specific attack patterns targeting IoT infrastructure have well-defined detection signatures:

### Credential Stuffing and Brute Force

Attackers attempt to authenticate to the MQTT broker using lists of common default credentials (admin/admin, device/device) or credentials harvested from other breaches:

- **Detection:** More than N failed authentication attempts from a single source IP within M minutes. For IoT brokers, also monitor for failed attempts across multiple device IDs from the same IP — legitimate devices use unique credentials and connect from known IP ranges.
- **Response:** Block the source IP at the firewall. Audit the fleet for devices still using default credentials. Enable rate limiting on the MQTT broker's authentication endpoint.

### Firmware Exfiltration

An attacker with access to the OTA update infrastructure or a compromised device attempts to download firmware images for reverse engineering:

- **Detection:** Unusual access patterns on the firmware update server — bulk downloads of multiple firmware versions, downloads from IP addresses outside the device fleet's known ranges, or downloads of firmware for device models that do not exist at the requesting site.
- **Response:** Restrict firmware download access to authenticated devices with valid certificates. Log and alert on all firmware download events. Consider firmware encryption at rest to limit the value of exfiltrated images.

### Device Impersonation

An attacker provisions a rogue device using stolen or cloned credentials to inject false telemetry data or receive commands intended for legitimate devices:

- **Detection:** Two devices presenting the same client certificate or client ID connecting simultaneously. MQTT brokers enforce unique client IDs — a second connection with the same ID disconnects the first. Monitoring for rapid connect/disconnect cycles on a single client ID reveals the conflict. Also: telemetry from a device ID that arrives from an unexpected IP range or geographic location.
- **Response:** Revoke the compromised credential. Investigate how the credential was obtained (leaked private key, compromised provisioning system, physical access to a deployed device). Rotate certificates for the affected device class.

### Command Injection via Device Shadow

Cloud platforms (AWS IoT Device Shadow, Azure IoT Hub Device Twin) allow bidirectional state synchronization. An attacker who gains access to the shadow/twin API can send arbitrary commands to devices:

- **Detection:** Shadow/twin updates originating from unexpected IAM roles, service accounts, or IP addresses. Changes to critical shadow fields (firmware_url, config_endpoint, log_level) that did not originate from the authorized deployment pipeline.
- **Response:** Restrict shadow/twin write access to specific IAM roles with least-privilege policies. Enable CloudTrail (AWS) or Activity Log (Azure) auditing for all shadow/twin operations. Alert on shadow modifications outside of scheduled maintenance windows.

## Compliance Logging

Regulatory and industry frameworks impose specific logging and monitoring requirements for IoT deployments:

### GDPR (General Data Protection Regulation)

- **Requirement:** Log all access to personal data. If device telemetry contains personally identifiable information (PII) — location data, health metrics, usage patterns — access to that data must be auditable.
- **Implementation:** Enable audit logging on the TSDB and dashboard platform. Record who queried what data, when, and from where. Implement data retention limits matching the declared processing purpose. Provide data deletion capabilities for GDPR Article 17 (right to erasure) requests — every system in the pipeline (TSDB, log aggregator, SIEM) must support targeted deletion by device/user ID.

### HIPAA (Health Insurance Portability and Accountability Act)

- **Requirement:** For IoT medical devices (remote patient monitors, wearable health sensors), all access to protected health information (PHI) must be logged with a 6-year retention period.
- **Implementation:** Encrypt telemetry in transit (TLS 1.2+) and at rest (AES-256). Log all administrative access to the MQTT broker, TSDB, and dashboards. Implement access controls based on the minimum necessary standard. Store audit logs in a tamper-evident format (append-only with cryptographic hashing).

### IEC 62443 (Industrial Automation and Control Systems Security)

- **Requirement:** Security levels (SL-1 through SL-4) define progressively stricter requirements for device authentication, communication integrity, access control, and audit logging.
- **Implementation:** At SL-2 and above, all security-relevant events (authentication, authorization, configuration changes, firmware updates) must be logged and monitored. At SL-3, logs must be protected against tampering and forwarded to a centralized SIEM in near-real-time. At SL-4, continuous monitoring with automated response capabilities is required.

### Common Compliance Architecture

A unified compliance logging architecture serves multiple frameworks:

```
Device → MQTT Broker → Security Event Filter → SIEM (Elastic/Splunk/Wazuh)
                     ↓                                    ↓
              Telemetry Pipeline                   Compliance Archive
              (InfluxDB/Timestream)                (S3 + Glacier, 6-year retention)
```

The security event filter separates compliance-relevant events (authentication, authorization, configuration changes) from routine telemetry. Only security events flow to the SIEM and compliance archive, keeping storage costs manageable. Routine telemetry follows the standard metrics pipeline with its own retention policies.

## IoT Incident Response

When a security incident is detected, the response process for IoT fleets differs from traditional IT incident response:

### Containment

- **Network isolation** — Move the affected device(s) to a quarantine VLAN or restrict MQTT ACLs to allow only diagnostic topics. Full disconnection preserves forensic state but loses the ability to remotely investigate.
- **Credential revocation** — Revoke the device's client certificate or token immediately. For fleets using shared credentials (not recommended but common), revoking the shared credential affects all devices in the group — a containment action with significant blast radius.
- **OTA rollout pause** — If the incident involves compromised firmware, pause all OTA rollouts immediately to prevent the compromised image from spreading to additional devices.

### Investigation

- **Telemetry forensics** — Query the TSDB for the affected device's telemetry history: unusual CPU usage, memory consumption, or network traffic patterns in the hours or days before the incident.
- **Log analysis** — Search the centralized logging system for the affected device ID, firmware version, and time window. Look for error patterns, unexpected module activity, or configuration changes.
- **Trace analysis** — If distributed tracing is deployed, examine traces involving the affected device for anomalous paths (messages routed to unexpected services, writes to unauthorized topics).
- **Firmware analysis** — If firmware integrity is in question, request a firmware hash report from the device (if it supports attestation) and compare against known-good hashes.

### Recovery

- **Firmware re-flash** — For confirmed compromise, OTA-deploy a clean firmware image. If the OTA mechanism itself is compromised, physical access for JTAG/SWD re-flash may be required.
- **Credential rotation** — Issue new certificates or tokens for affected devices. For certificate-based authentication, the Certificate Authority (CA) may need to issue a new intermediate CA certificate if the compromise involved CA-level access.
- **Post-incident monitoring** — Place recovered devices under enhanced monitoring (100% log level, 100% tracing, tighter alerting thresholds) for 30–90 days to detect re-compromise or residual indicators.

## Tips

- Feed MQTT broker authentication logs directly into the SIEM as a high-priority source. Authentication events (success, failure, certificate validation errors) are the highest-value security signal in an IoT deployment and have a low volume relative to telemetry data — typically thousands of events per day rather than millions.
- Maintain a network behavior baseline per device type, not per individual device. A fleet of 5,000 identical temperature sensors should have a single traffic profile (expected ports, protocols, data volume, connection frequency). Profiling 5,000 individual devices is operationally impractical; profiling 3–5 device types is manageable.
- Implement automated certificate expiration alerting with at least 30 days of lead time. Certificate expiration is the most common preventable security event in IoT fleets — devices fail to connect, telemetry stops, and the fleet appears to suffer a mass outage. The root cause is purely administrative, not technical.
- Separate security event storage from operational telemetry storage. Compliance requirements often mandate longer retention periods (6 years for HIPAA) and tamper-evident storage. Mixing security events with operational data forces the entire dataset to comply with the strictest retention and integrity requirements, increasing storage costs unnecessarily.

## Caveats

- **IoT devices generate a high volume of false positive security alerts due to their inherent behavioral variability.** A device rebooting after an OTA update changes its connection pattern, traffic volume, and possibly its IP address — triggering anomaly detection rules designed to catch compromise. Every firmware rollout, configuration change, and seasonal behavior shift (solar-powered devices with variable uptime) generates a wave of false positives unless the detection baselines are updated accordingly.
- **Constrained devices cannot run SIEM agents or host-based intrusion detection.** An MCU with 256 KB of RAM and 1 MB of flash has no capacity for a Wazuh agent, file integrity monitor, or endpoint detection and response (EDR) client. Security monitoring for these devices is entirely passive — based on network traffic analysis and cloud-side event correlation. This creates a visibility gap: activity on the device itself (memory corruption, unauthorized flash writes, runtime code injection) is invisible to the SIEM unless the device explicitly reports it via telemetry.
- **Shared credential architectures undermine per-device forensics.** If 1,000 devices share the same MQTT username and password, an authentication failure log entry does not identify which physical device was involved. Device-specific credentials (per-device certificates or unique tokens) are a prerequisite for meaningful security monitoring. Migrating from shared to per-device credentials on an already-deployed fleet is operationally expensive but necessary for security posture improvement.
- **Compliance logging retention requirements can dominate storage costs.** HIPAA's 6-year retention for audit logs, applied to a fleet of 50,000 devices generating 100 security events per device per day, produces approximately 10 TB of audit data over the retention period. At S3 Glacier pricing ($0.004/GB/month), storage costs $40/month — modest. But indexing those 10 TB for searchable compliance queries (Elasticsearch or Splunk) costs orders of magnitude more.

## In Practice

- **The SIEM alerting on "multiple failed authentication attempts" immediately after a fleet-wide certificate rotation** is expected behavior, not an attack. Devices that have not yet received the new certificate attempt to connect with the old one, which the broker rejects. The alert volume correlates directly with the certificate rollout progress — it peaks when the broker begins enforcing the new certificate and drops as devices update. Suppressing this alert type during planned certificate rotations prevents alarm fatigue.
- **A single device ID appearing in authentication logs from two different source IP addresses simultaneously** indicates either a credential clone (security incident) or a legitimate device that has dual connectivity (Wi-Fi and cellular failover). Device metadata (does this device type support dual connectivity?) and network context (are both IPs from expected carrier/ISP ranges?) distinguish the two cases. Without this context, the SIEM generates a high-severity alert for what may be normal failover behavior.
- **Network flow logs showing an IoT device making DNS requests for domains unrelated to the deployment (e.g., cryptocurrency mining pools, known C2 domains)** is a strong indicator of compromise. The device's firmware has been replaced or its DNS resolver has been poisoned. Containment (network isolation) should be immediate, followed by firmware verification and forensic analysis of how the device was compromised.
- **A compliance audit requesting proof that all access to patient health data was logged for the past 3 years** exposes gaps in the audit trail if the logging infrastructure was deployed after the devices. Retroactive audit coverage is impossible — the logs did not exist before the SIEM was configured. This scenario underscores the importance of deploying compliance logging infrastructure at fleet launch, not as a retrofit after the first audit finding.
- **An anomaly detection rule flagging 15% of the fleet as "suspicious" after a daylight saving time transition** results from devices whose RTCs do not adjust automatically, causing their reporting timestamps to shift by one hour. The SIEM's behavioral baseline expects messages at specific intervals aligned to UTC; the shifted timestamps trigger timing-based anomaly rules. Normalizing all timestamps to UTC at ingestion and basing behavioral analysis on UTC time prevents this class of false positive.
