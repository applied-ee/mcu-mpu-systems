---
title: "MQTT"
weight: 10
---

# MQTT

MQTT (Message Queuing Telemetry Transport) is a lightweight publish/subscribe messaging protocol designed for constrained devices and unreliable networks. Originally developed by IBM in 1999 for SCADA systems over satellite links, it has become the dominant messaging protocol in IoT deployments. The protocol operates over TCP, uses a central broker to decouple publishers from subscribers, and provides three levels of delivery guarantee. A minimal MQTT CONNECT packet is 14 bytes, and a typical publish with a short topic and small payload fits in under 100 bytes — roughly 10x smaller than an equivalent HTTP POST with headers. This low overhead makes MQTT viable on devices with as little as 10 KB of RAM and on networks where every byte costs money (cellular, satellite, LPWAN).

## Broker Architecture

MQTT uses a hub-and-spoke model centered on a **broker** that receives all published messages and routes them to subscribers. Devices never communicate directly with each other — every message passes through the broker, which handles connection management, topic matching, message queuing, and delivery guarantees.

The broker maintains a session state for each connected client:

- **Active subscriptions** — Which topics each client has subscribed to, including wildcard patterns.
- **QoS 1/2 message queues** — Messages awaiting acknowledgment from the client.
- **Inflight messages** — Messages currently being transmitted under QoS 1 or 2 handshakes.
- **Last Will and Testament** — A predefined message to publish if the client disconnects unexpectedly.

Popular brokers include **Eclipse Mosquitto** (lightweight, single-threaded, ideal for edge gateways — handles ~30,000 messages/sec on a Raspberry Pi 4), **EMQX** (clustered, supports millions of concurrent connections), and **AWS IoT Core / Azure IoT Hub** (managed cloud brokers with built-in device authentication and rules engines).

A single broker becomes a single point of failure. Production deployments either use clustered brokers (EMQX, HiveMQ, VerneMQ) or deploy redundant standalone brokers behind a load balancer with session state replication.

## Publish/Subscribe and Topic Hierarchy

Clients publish messages to **topics** — UTF-8 strings organized as a hierarchy separated by forward slashes. The broker matches published messages against subscriber topic filters, which may include wildcards:

- `+` matches exactly one level: `sensors/+/temperature` matches `sensors/room1/temperature` but not `sensors/room1/sub/temperature`.
- `#` matches zero or more levels and must be the last character: `sensors/#` matches `sensors/room1/temperature`, `sensors/humidity`, and `sensors` itself.

A well-designed topic hierarchy follows a general-to-specific pattern:

```
{site}/{building}/{floor}/{room}/{device_type}/{device_id}/{measurement}
```

For example: `factory/building-a/floor-2/line-7/plc/unit-042/vibration`. This structure enables subscribers to consume data at any granularity — subscribing to `factory/building-a/#` captures everything in a building, while `factory/+/+/+/plc/+/vibration` captures vibration readings from all PLCs across all sites.

Topics beginning with `$` are reserved by the broker. `$SYS/` is the conventional prefix for broker statistics (connected clients, message rates, memory usage). Clients must not publish to `$SYS/` topics.

## QoS Levels

MQTT defines three Quality of Service levels that trade reliability for overhead:

### QoS 0 — At Most Once ("Fire and Forget")

The publisher sends the PUBLISH packet once. The broker makes a best-effort attempt to deliver it to subscribers. No acknowledgment, no retry, no storage. If the subscriber is offline or the TCP connection drops at the wrong moment, the message is lost.

- **Overhead**: 2 bytes of fixed header + topic length + payload. No additional control packets.
- **Use case**: High-frequency sensor telemetry where individual samples are expendable — a temperature reading every 5 seconds can tolerate the occasional dropped message.

### QoS 1 — At Least Once

The publisher sends PUBLISH and waits for a PUBACK from the broker. If no PUBACK arrives within the retry interval, the publisher resends with the DUP flag set. The broker delivers to subscribers and stores the message until each subscriber acknowledges. This guarantees delivery but allows **duplicates** — if the PUBACK is lost, the publisher resends and the broker delivers the message again.

- **Overhead**: PUBLISH + PUBACK (4 bytes). One additional round trip per message.
- **Use case**: State changes, alerts, and commands where every message must arrive but the application can handle duplicates (idempotent operations).

### QoS 2 — Exactly Once

A four-packet handshake: PUBLISH → PUBREC → PUBREL → PUBCOMP. Both sides track message IDs to ensure the message is delivered exactly once with no duplicates. This is the highest reliability but also the highest overhead and latency.

- **Overhead**: Four control packets, two round trips. On a 200 ms latency cellular link, QoS 2 adds ~400 ms of protocol overhead per message.
- **Use case**: Billing events, firmware update triggers, or any operation where duplicates cause real harm. Rarely justified on constrained devices.

In fleet deployments, the vast majority of traffic uses QoS 0 or QoS 1. QoS 2 represents less than 1% of messages on most production brokers due to its overhead.

## Retained Messages

A **retained message** is stored by the broker on a topic and immediately delivered to any new subscriber. Each topic holds at most one retained message — publishing a new retained message replaces the previous one. Publishing a retained message with a zero-length payload clears the retained message for that topic.

Retained messages solve the "late joiner" problem: a device that subscribes to `devices/thermostat-01/status` immediately receives the last known status without waiting for the next publish cycle. This is particularly important for topics that update infrequently — a device configuration that changes once a month would otherwise require the subscriber to wait up to a month.

## Last Will and Testament (LWT)

The client specifies a **Last Will and Testament** message during the CONNECT handshake. If the client disconnects ungracefully (TCP timeout, network failure, device crash), the broker publishes the LWT message on the client's behalf. Graceful disconnects (DISCONNECT packet) do not trigger the LWT.

A standard pattern for device presence uses two topics:

- On connect, publish a retained message to `devices/{id}/status` with payload `online`.
- Set LWT to publish a retained message to the same topic with payload `offline`.

When the device crashes or loses connectivity, the broker publishes `offline` automatically. New subscribers always see the latest status.

The broker detects ungraceful disconnects via the **keep-alive timer**. The client must send at least one control packet (typically PINGREQ) within the keep-alive interval. If the broker receives nothing within 1.5x the keep-alive period, it considers the client dead and fires the LWT. Common keep-alive values range from 30 seconds (responsive presence detection) to 900 seconds (battery-constrained devices that wake infrequently).

## Session Persistence

The **Clean Session** flag (v3.1.1) or **Clean Start** flag (v5.0) controls whether the broker preserves session state across reconnections:

- **Clean Session = true** — The broker discards any previous session state when the client connects. Subscriptions and queued messages are gone. The client must resubscribe after each reconnection. This is simpler and uses less broker memory.
- **Clean Session = false** — The broker retains the client's subscriptions and queues QoS 1/2 messages that arrive while the client is offline. On reconnection, the broker delivers the queued messages. This ensures no messages are lost during temporary disconnections, but broker memory consumption grows with the number of offline clients and the volume of queued messages.

MQTT v5.0 adds **Session Expiry Interval**, which controls how long the broker retains session state after disconnect. A value of 0 means immediate cleanup (equivalent to clean session). A value of 3600 retains the session for one hour. `0xFFFFFFFF` means the session never expires. This provides finer control than the binary clean session flag of v3.1.1.

For battery-powered devices that wake every 15 minutes to transmit data, a persistent session with a session expiry of 1800 seconds (30 minutes) ensures command messages from the cloud are queued and delivered on the next wake cycle without requiring permanent broker-side storage.

## Payload Serialization

MQTT is payload-agnostic — the protocol treats the payload as an opaque byte array. The serialization format is an application-level decision:

- **JSON** — Human-readable, widely supported, easy to debug with standard tools. Overhead is significant: a reading like `{"temperature": 23.5, "humidity": 61.2, "ts": 1709312400}` is ~55 bytes. JSON parsing on a Cortex-M0 with a library like cJSON or jsmn is feasible but not free (~2–5 ms per parse for small objects).
- **CBOR (Concise Binary Object Representation)** — Binary encoding with the same data model as JSON. The same reading encodes to ~25 bytes. CBOR is standardized (RFC 8949), supported by libraries like tinycbor (2 KB flash footprint), and is the native encoding for CoAP payloads.
- **Protocol Buffers (Protobuf)** — Schema-defined binary encoding. Extremely compact (~15 bytes for the same reading with a predefined schema) but requires pre-shared `.proto` definitions. Nanopb provides a Protobuf implementation for embedded C with static allocation (no malloc).
- **Raw binary structs** — Packing values directly into a byte array with a fixed schema (e.g., 2 bytes for temperature as a scaled integer, 2 bytes for humidity, 4 bytes for timestamp). Minimal overhead (~8 bytes) but fragile — schema changes require coordinated firmware and backend updates.

For fleets with cellular connectivity where data costs dominate, the move from JSON to CBOR or Protobuf can reduce payload sizes by 50–70%, which directly reduces per-device data costs.

## Embedded Client Libraries

Several client libraries target resource-constrained devices:

- **Eclipse Paho Embedded C** — The reference implementation. Supports QoS 0/1/2, persistent sessions, and TLS via pluggable network interfaces. Requires ~20 KB flash and 2–4 KB RAM. No dynamic memory allocation in the core library.
- **lwMQTT** — A lightweight client written in C. Smaller footprint than Paho (~10 KB flash) with a simpler API. Supports QoS 0/1.
- **Mosquitto client library (libmosquitto)** — Full-featured C library with built-in TLS (via OpenSSL or mbedTLS). Heavier than Paho (~60 KB flash with TLS) but well-tested and suitable for Linux-based gateways and MPU-class devices.
- **ESP-MQTT** — Espressif's native MQTT client for ESP-IDF. Supports MQTT v3.1.1 and v5.0, integrates directly with the ESP-IDF event loop, and uses mbedTLS for TLS. Optimized for ESP32 memory architecture.

When selecting a library, the critical considerations are: static vs. dynamic memory allocation (critical for safety-critical systems), maximum message size support, and whether the library handles automatic reconnection or exposes it to the application layer.

## TLS and Authentication

MQTT transmits credentials and payloads in cleartext by default. Production deployments require security at both the transport and application layers:

### Transport Security

MQTT over TLS (port 8883, versus 1883 for plaintext) encrypts the entire TCP stream. The TLS handshake adds 2–4 KB of overhead and 1–3 round trips to connection setup. On constrained devices, mbedTLS is the typical TLS library, requiring ~60 KB flash and ~30 KB RAM for a TLS 1.2 session with ECDHE-ECDSA-AES128-GCM-SHA256.

### Authentication

- **Username/password** — Sent in the CONNECT packet. Simple to implement but the credentials must be provisioned securely and rotated periodically. Suitable for development and small deployments.
- **X.509 client certificates** — Each device has a unique certificate signed by a trusted CA. The broker validates the certificate chain during the TLS handshake. This is the standard approach for fleet-scale IoT: no passwords to manage, per-device identity, and revocation via CRL or OCSP. AWS IoT Core and Azure IoT Hub mandate client certificate authentication.
- **Token-based (JWT, OAuth 2.0)** — The client authenticates with a short-lived token passed as the MQTT password. Google Cloud IoT Core used this approach. Tokens can be scoped to specific topics and expire automatically, reducing the impact of token theft.

### Authorization

Topic-level access control restricts which topics a client can publish or subscribe to. Most brokers support ACL rules mapping client identifiers to allowed topic patterns. A sensor device might be allowed to publish only to `devices/{its-own-id}/telemetry` and subscribe only to `devices/{its-own-id}/commands`.

## MQTT v3.1.1 vs v5.0

MQTT v5.0 (released 2019) adds significant features while maintaining backward compatibility at the packet format level:

| Feature | v3.1.1 | v5.0 |
|---------|--------|------|
| Session Expiry | Binary (clean session flag) | Configurable interval in seconds |
| Reason Codes | Limited (CONNACK only) | Every ACK packet includes a reason code |
| Shared Subscriptions | Broker-specific extensions | Standardized `$share/{group}/{filter}` |
| Topic Aliases | Not supported | 2-byte alias replaces full topic string |
| User Properties | Not supported | Key-value pairs on any packet |
| Flow Control | Not supported | Receive Maximum limits inflight messages |
| Message Expiry | Not supported | Per-message TTL in seconds |
| Request/Response | Application-level convention | Standardized correlation data and response topic |

**Topic aliases** reduce bandwidth for devices that publish to the same topic repeatedly. After the first PUBLISH that maps alias 1 to `factory/line-7/plc/unit-042/vibration`, subsequent publishes use only the 2-byte alias instead of the full 45-byte topic string — a significant saving at high publish rates.

**Shared subscriptions** allow multiple subscribers to load-balance messages from a single topic. Messages published to `$share/workers/jobs/incoming` are distributed round-robin among all subscribers in the `workers` group. This enables horizontal scaling of message processors without application-level coordination.

**Reason codes** on DISCONNECT, PUBACK, and SUBACK packets provide meaningful error feedback. In v3.1.1, a failed subscription silently receives QoS 0x80, giving the client no information about why the subscription was rejected.

Most constrained MCU targets still use v3.1.1 due to wider library support and simpler implementation. The v5.0 features primarily benefit Linux-class gateways and cloud-side subscribers.

## Tips

- Set the keep-alive interval to 1.5x the expected maximum gap between publishes. If a sensor publishes every 60 seconds, a keep-alive of 90 seconds avoids unnecessary PINGREQ overhead while detecting disconnects promptly. For battery-powered devices that publish every 15 minutes, a keep-alive of 1200 seconds (20 minutes) prevents the broker from falsely declaring the client dead between wake cycles.
- Use QoS 1 as the default for most IoT telemetry. QoS 0 loses messages during brief network interruptions, and QoS 2 doubles the round trips for marginal benefit — most IoT applications can tolerate or deduplicate the occasional duplicate message from QoS 1.
- Embed the device ID in the topic path and enforce topic-based ACLs on the broker. A compromised device that can only publish to `devices/{its-own-id}/#` cannot inject data into other devices' topic spaces.
- Set a Last Will message with the retained flag on a status topic for every device. This provides an automatic presence system with zero application-level polling.
- Use MQTT v5.0 topic aliases on high-frequency publish paths where the topic string exceeds 20 bytes. At 10 messages per second, replacing a 50-byte topic with a 2-byte alias saves ~480 bytes/sec of bandwidth per device.
- Limit persistent session queue depth on the broker (most brokers expose a `max_queued_messages` setting). A device offline for a week with a high-throughput subscription can accumulate gigabytes of queued messages, exhausting broker memory.

## Caveats

- **MQTT provides no end-to-end encryption** — TLS protects the link between client and broker, but the broker sees all messages in plaintext. If the broker is compromised or multi-tenant, sensitive payloads require application-level encryption (e.g., encrypting the payload with a pre-shared symmetric key before publishing).
- **The MQTT specification does not define topic namespace management or discovery.** There is no standard mechanism for a subscriber to learn what topics exist. Topic structures are a design convention, not a protocol feature — and undocumented topic proliferation in large deployments becomes an operational burden.
- **A persistent session with QoS 1 subscriptions on a device that goes offline for an extended period can overwhelm it on reconnection.** The broker delivers all queued messages immediately after the client reconnects. A device with 4 KB of receive buffer that reconnects to find 10,000 queued messages will stall, drop messages, or run out of memory. MQTT v5.0's Session Expiry Interval and Message Expiry mitigate this, but v3.1.1 has no built-in protection.
- **Client ID collisions cause silent disconnections.** If two devices connect with the same Client ID, the broker disconnects the first one. The first client reconnects, disconnecting the second. This creates a "flapping" pattern where both devices alternate between connected and disconnected states, each blaming the network for instability.
- **Mosquitto in its default configuration is single-threaded and stores all state in memory.** A Mosquitto instance on a Raspberry Pi handling 50,000 subscribers with persistent sessions can consume hundreds of megabytes of RAM and become unresponsive when flushing state to disk. For edge deployments exceeding a few thousand concurrent clients, a clustered broker or managed cloud service is more appropriate.

## In Practice

- **A device that connects, subscribes, and then receives no messages** despite active publishers on the matching topic often has a QoS mismatch: the publisher sends at QoS 0 and the subscriber was offline when the message was published. QoS 0 messages are not queued for offline subscribers, even with a persistent session.
- **Telemetry messages arriving out of order at the subscriber** typically indicate multiple publisher threads or tasks without message ordering guarantees. MQTT guarantees ordering only within a single client publishing to a single topic at a single QoS level. Messages from different publishers, or from the same publisher at different QoS levels, may interleave arbitrarily.
- **A device that appears online on the broker's connection list but never receives commands** often has a subscription that silently failed. In MQTT v3.1.1, a SUBACK with return code 0x80 (failure) is easy to overlook if the client library does not surface subscription errors. Checking the SUBACK return codes in the subscribe callback reveals the failure.
- **Gradually increasing memory usage on the broker that correlates with the number of offline devices** is the persistent session queue growing unbounded. Each offline client with QoS 1 subscriptions accumulates messages in broker memory. This is most visible in deployments with battery-powered devices that sleep for hours and subscribe to high-volume topics.
- **A device that connects and immediately disconnects in a repeating loop** is often experiencing a Client ID collision with another device, a TLS handshake failure due to certificate expiry or clock drift, or an authentication rejection that the client library retries without backoff. Broker-side logs (Mosquitto's `log_type all` or EMQX's client trace) isolate the cause faster than device-side debugging.
