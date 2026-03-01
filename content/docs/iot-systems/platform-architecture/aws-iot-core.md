---
title: "AWS IoT Core"
weight: 10
---

# AWS IoT Core

AWS IoT Core is Amazon's managed MQTT broker and device management service for IoT workloads. It handles device authentication, message routing, and state synchronization for fleets ranging from a handful of prototypes to millions of production devices. The service is built around a registry of "things," X.509 certificate-based mutual TLS authentication, a device shadow mechanism for state synchronization, and a rules engine that routes messages to downstream AWS services. Understanding the provisioning models, topic namespace, shadow document structure, and policy language is necessary for building firmware that connects reliably and securely at scale.

## Thing Registry and Thing Types

The **thing registry** is a database of device metadata. Each device is registered as a "thing" with a unique name and optional attributes (firmware version, hardware revision, deployment site). Things can be organized into **thing types** — templates that define a fixed set of searchable attributes — and **thing groups** (static or dynamic) for fleet-level operations.

A thing type might define attributes like `hardwareRevision`, `firmwareVersion`, and `sensorType`. Once created, a thing type's attribute list is immutable (attributes cannot be added or removed), though the values on individual things can change. Thing types that are no longer needed can be deprecated but not deleted for 5 minutes after deprecation — a guardrail against accidental removal.

Dynamic thing groups use fleet indexing queries to automatically include devices matching specific criteria. A query like `attributes.firmwareVersion < 2.5.0 AND attributes.region = us-east` creates a group that updates as device attributes change. This is the foundation for targeted OTA rollouts.

## X.509 Certificate Provisioning

AWS IoT Core uses mutual TLS with X.509 client certificates as the primary authentication mechanism. Every device connection requires three things: the Amazon Root CA certificate, a device-specific certificate, and the corresponding private key. The private key must never leave the device — ideally it is generated on-device and stored in a hardware secure element (ATECC608, STSAFE-A110, or an MCU's built-in secure enclave).

### Individual Provisioning

For low-volume production (hundreds of devices), each device receives a unique certificate and private key during manufacturing. The typical flow:

1. Generate a key pair on the factory programming station (or on-device if the hardware supports it).
2. Create a Certificate Signing Request (CSR).
3. Register the certificate with AWS IoT Core and attach it to the thing.
4. Flash the certificate and private key to the device's secure storage.

This approach provides the strongest security posture — each device has a unique identity from the moment it leaves the factory — but scales poorly beyond a few thousand units because it requires per-device interaction with the AWS API during manufacturing.

### Fleet Provisioning

For high-volume manufacturing, AWS offers two fleet provisioning patterns:

- **Provisioning by claim** — Every device ships with a shared "claim certificate" that has minimal permissions (only enough to call the provisioning API). On first boot, the device uses the claim certificate to request a unique device certificate. A provisioning template defines the thing name pattern, group membership, and attached policies. The claim certificate is a bootstrap credential, not a long-term identity.
- **Provisioning by trusted user** — A human operator or manufacturing system with IAM credentials provisions the device on its behalf. The device never holds a claim certificate; instead, it receives its unique certificate through an out-of-band channel (USB, serial, NFC tap).

### Just-In-Time Provisioning (JITP)

JITP automates registration for devices that present certificates signed by a CA registered with AWS IoT Core. When an unknown device connects with a valid CA-signed certificate, IoT Core automatically creates the thing, registers the certificate, and attaches policies based on a provisioning template associated with that CA. The device's first connection attempt is rejected (the registration happens asynchronously), and the device connects successfully on its second attempt — firmware must handle this initial rejection gracefully with a retry.

## MQTT Broker and Protocol Support

AWS IoT Core exposes a fully managed MQTT broker at an account-specific endpoint (`<account-id>-ats.iot.<region>.amazonaws.com` on port 8883 for MQTT over TLS). The broker supports:

- **MQTT 3.1.1** — Full support including QoS 0 (at most once) and QoS 1 (at least once). QoS 2 is not supported.
- **MQTT 5.0** — Supported since 2023, adding features like topic aliases, user properties, and shared subscriptions.
- **MQTT over WebSockets** — For browser-based dashboards and web applications, using IAM or Cognito credentials for authentication instead of client certificates. Port 443.
- **HTTPS** — A REST-style publish endpoint for devices that cannot maintain persistent connections. Useful for extremely constrained devices or Lambda-triggered publishes, but limited to publishing only (no subscriptions).

The maximum MQTT payload size is 128 KB. The maximum number of subscriptions per connection is 50 (a hard limit that requires careful topic design). Messages can be retained (MQTT retained messages are supported), and persistent sessions survive disconnections for up to 1 hour by default (configurable up to 24 hours).

## Device Shadows

A device shadow is a JSON document maintained by AWS IoT Core that stores the last known state of a device. Shadows enable asynchronous state synchronization between a device and its cloud applications — the device reports what it is doing, applications request what it should do, and IoT Core tracks the difference.

### Shadow Document Structure

```json
{
  "state": {
    "desired": {
      "heaterEnabled": true,
      "targetTemp": 22.5,
      "reportingInterval": 60
    },
    "reported": {
      "heaterEnabled": false,
      "targetTemp": 18.3,
      "reportingInterval": 300,
      "firmwareVersion": "2.4.1"
    },
    "delta": {
      "heaterEnabled": true,
      "targetTemp": 22.5,
      "reportingInterval": 60
    }
  },
  "metadata": {
    "desired": {
      "heaterEnabled": { "timestamp": 1709312400 },
      "targetTemp": { "timestamp": 1709312400 },
      "reportingInterval": { "timestamp": 1709312400 }
    },
    "reported": {
      "heaterEnabled": { "timestamp": 1709310000 },
      "targetTemp": { "timestamp": 1709310000 },
      "reportingInterval": { "timestamp": 1709310000 },
      "firmwareVersion": { "timestamp": 1709280000 }
    }
  },
  "version": 47,
  "timestamp": 1709312400
}
```

The `delta` section is computed automatically by IoT Core — it contains every key that exists in `desired` but either does not exist in `reported` or differs in value. This is the mechanism that drives device configuration changes.

### Shadow Topics

Shadow operations use reserved MQTT topics:

| Operation | Topic |
|-----------|-------|
| Update (device reports state) | `$aws/things/{thingName}/shadow/update` |
| Update accepted | `$aws/things/{thingName}/shadow/update/accepted` |
| Update rejected | `$aws/things/{thingName}/shadow/update/rejected` |
| Get shadow | `$aws/things/{thingName}/shadow/get` |
| Get accepted | `$aws/things/{thingName}/shadow/get/accepted` |
| Delta (desired != reported) | `$aws/things/{thingName}/shadow/update/delta` |
| Delete shadow | `$aws/things/{thingName}/shadow/delete` |

A device subscribes to the `/delta` topic to receive configuration change notifications. When a cloud application updates the `desired` state, IoT Core computes the delta and publishes it. The device applies the change, then publishes its new `reported` state. Once `reported` matches `desired`, the delta becomes empty.

**Named shadows** (up to 10 per thing) separate unrelated state into independent documents — for example, a `connectivity` shadow for network configuration and a `firmware` shadow for update state. This prevents unrelated changes from creating spurious delta notifications.

## Rules Engine

The rules engine evaluates every message published to IoT Core and routes matching messages to downstream AWS services. A rule consists of a SQL-like query and one or more actions:

```sql
SELECT temperature, humidity, deviceId
FROM 'sensors/+/telemetry'
WHERE temperature > 50.0
```

This rule selects fields from messages published to any `sensors/<id>/telemetry` topic where the temperature exceeds 50.0 degrees.

### Common Actions

| Action | Use Case |
|--------|----------|
| **Lambda** | Transform data, trigger workflows, invoke external APIs |
| **S3** | Archive raw telemetry to object storage for batch analytics |
| **DynamoDB** | Store time-series data or device state in a NoSQL table |
| **DynamoDBv2** | Write entire message payload as a single DynamoDB item |
| **SNS** | Send alerts (SMS, email, push notifications) for threshold breaches |
| **SQS** | Buffer messages for downstream consumers that process in batches |
| **Kinesis Data Streams** | High-throughput streaming analytics pipeline |
| **Kinesis Firehose** | Deliver data to S3, Redshift, or Elasticsearch with automatic batching |
| **IoT Analytics** | Managed data pipeline with query, transform, and dataset features |
| **CloudWatch** | Publish custom metrics for monitoring dashboards |
| **Republish** | Route messages to a different MQTT topic within IoT Core |

An **error action** can be configured for each rule to handle failures (e.g., writing failed messages to an S3 dead-letter bucket). Without an error action, undeliverable messages are silently dropped — a common source of data loss in production.

## Greengrass Edge Runtime

AWS IoT Greengrass extends IoT Core to edge devices, typically Linux-based gateways (Raspberry Pi, industrial PCs, NVIDIA Jetson). Greengrass v2 (the current version) uses a modular component architecture:

- **Local MQTT broker** — Greengrass devices can broker MQTT messages between local IoT devices without round-tripping to the cloud. Local latency drops from 50–200 ms (cloud) to 1–5 ms (LAN).
- **Component deployment** — Software components (custom code, AWS-provided components, community components) deploy to edge devices from the cloud. Components can be Lambda functions, Docker containers, or native executables.
- **Stream manager** — Buffers telemetry data locally and uploads to S3 or Kinesis when connectivity is available. Configurable retention policies define behavior when local storage fills up — oldest-first eviction or backpressure to the data source.
- **ML inference** — Deploy machine learning models (TensorFlow Lite, Amazon SageMaker Neo) to Greengrass cores for local inference. An anomaly detection model running on a Jetson Nano can classify sensor readings in 10–50 ms without cloud connectivity.
- **Local shadows** — Greengrass maintains local shadow state for connected devices, synchronizing with the cloud when connectivity permits. This keeps shadow-based control loops functional during network outages.

Greengrass v2 requires a Linux environment with at least 128 MB RAM and 256 MB disk space (minimum), though practical deployments with stream manager and ML inference need 512 MB+ RAM and 1 GB+ storage.

## IoT Policies and Authorization

IoT policies are JSON documents that define which MQTT topics a device can publish to, subscribe to, and receive messages from. Policies are attached to certificates (not to things directly), so a device's permissions are determined by which certificate it authenticates with.

### Policy Structure

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "iot:Connect",
      "Resource": "arn:aws:iot:us-east-1:123456789012:client/${iot:Connection.Thing.ThingName}"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Publish",
      "Resource": [
        "arn:aws:iot:us-east-1:123456789012:topic/devices/${iot:Connection.Thing.ThingName}/telemetry",
        "arn:aws:iot:us-east-1:123456789012:topic/$aws/things/${iot:Connection.Thing.ThingName}/shadow/update"
      ]
    },
    {
      "Effect": "Allow",
      "Action": "iot:Subscribe",
      "Resource": "arn:aws:iot:us-east-1:123456789012:topicfilter/$aws/things/${iot:Connection.Thing.ThingName}/shadow/update/delta"
    },
    {
      "Effect": "Allow",
      "Action": "iot:Receive",
      "Resource": "arn:aws:iot:us-east-1:123456789012:topic/$aws/things/${iot:Connection.Thing.ThingName}/shadow/update/delta"
    }
  ]
}
```

The policy variable `${iot:Connection.Thing.ThingName}` resolves to the thing name associated with the connecting certificate. This is the standard pattern for restricting devices to their own topics — without this scoping, any device could publish or subscribe to another device's shadow topics.

Key policy actions:

- **iot:Connect** — Permission to establish an MQTT connection. The resource ARN specifies the allowed client IDs.
- **iot:Publish** — Permission to publish to specific topics.
- **iot:Subscribe** — Permission to create subscriptions to topic filters.
- **iot:Receive** — Permission to receive messages on topics. Subscribe and Receive are separate actions — a device can subscribe to a topic filter but only receive messages on a subset of matching topics.

## Tips

- Use the `${iot:Connection.Thing.ThingName}` policy variable to scope every device's permissions to its own topics and shadow. A single overly permissive policy like `iot:*` on `*` works during prototyping but allows any compromised device to access the entire fleet's data and shadows.
- Set the MQTT client ID to the thing name. IoT Core enforces a 1:1 mapping between client ID and concurrent connection — if a second connection uses the same client ID, the first is disconnected. Mismatched client IDs cause shadow operations to fail silently because the policy variable resolves against the thing name, not the client ID.
- Use named shadows to separate independent state domains (connectivity, firmware, application config). Classic shadows create a single monolithic document, and an update to any field triggers a delta notification even when the device only cares about specific fields.
- Configure an error action on every rules engine rule. The default behavior is to silently drop messages that fail to deliver to the target action — with no logging, no retry, and no indication that data was lost.
- Implement exponential backoff with jitter for MQTT reconnections. A fleet of 10,000 devices that lose connectivity simultaneously (region failover, network partition) and all reconnect at once can overwhelm the IoT Core endpoint. AWS recommends a full jitter backoff with a maximum delay of 30–60 seconds.
- Keep shadow documents under 8 KB (the maximum is 8 KB for a classic shadow and 8 KB per named shadow). Storing large binary blobs or arrays in shadows causes throttling — use S3 and store only a reference URL in the shadow.

## Caveats

- **QoS 2 (exactly once delivery) is not supported.** MQTT QoS 2 requires a four-step handshake that doubles per-message overhead. AWS IoT Core's maximum is QoS 1 (at least once), which means duplicate message delivery is possible. Firmware must handle duplicate messages idempotently — using message IDs or timestamps to deduplicate.
- **JITP rejects the device's first connection attempt.** The registration process is asynchronous: the device connects, IoT Core triggers the JITP template, and the connection is closed. The device must retry after 2–5 seconds. Firmware that does not expect this initial rejection will fail on first boot in production.
- **The 50-subscription-per-connection limit is a hard ceiling.** Unlike most AWS quotas, this one cannot be raised through a support request. A device that subscribes to per-sensor topics individually can hit this limit quickly. The solution is topic hierarchy design with wildcards — subscribe to `sensors/#` instead of individual sensor topics.
- **Thing type attributes are immutable once created.** If a thing type is defined with three attributes and a fourth is needed later, a new thing type must be created and devices migrated. Plan attribute schemas carefully before deploying to production fleets.
- **Device shadow version conflicts cause silent update rejection.** If a shadow update includes a `version` field that does not match the current version in IoT Core, the update is rejected. The rejection is published to the `/rejected` topic, but firmware that does not subscribe to rejection topics will not know the update failed.

## In Practice

- **A device that connects, publishes telemetry, but never receives shadow deltas** is usually a policy misconfiguration. The device has `iot:Subscribe` permission but is missing `iot:Receive` on the delta topic — the subscription succeeds (no error), but messages are silently filtered out. Checking the IoT Core logs for `Authorization` failures reveals the mismatch.
- **Intermittent disconnections where a device reconnects every 5–10 minutes** often indicate two devices (or a device and a test script) using the same client ID. IoT Core disconnects the older connection when a new one arrives with the same client ID, creating a "flapping" pattern in CloudWatch connection metrics.
- **A rules engine action that works during testing but fails under load** typically means the target service (Lambda, DynamoDB) is throttling. Lambda has default concurrency limits (1,000 per region), and DynamoDB throughput depends on provisioned capacity. The rules engine does not retry failed actions unless an error action is configured — messages are dropped.
- **Fleet provisioning that works in development but stalls in production** often results from the claim certificate's IoT policy being too restrictive. The claim certificate needs permissions to publish and subscribe to the fleet provisioning reserved topics (`$aws/provisioning-templates/<template>/provision/json`). Missing any one of the required topic permissions causes the provisioning flow to hang without a clear error.
- **Shadow updates from the device that appear in the console but do not trigger delta notifications to the device** usually mean the `desired` and `reported` states already match for the updated fields. Deltas are only generated when `desired` differs from `reported` — publishing a `reported` state that matches the existing `desired` state clears the delta rather than creating one.
