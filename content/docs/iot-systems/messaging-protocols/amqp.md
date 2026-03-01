---
title: "AMQP"
weight: 30
---

# AMQP

The Advanced Message Queuing Protocol (AMQP) is an open standard for message-oriented middleware that provides reliable, broker-mediated messaging with sophisticated routing capabilities. AMQP 0-9-1 (the version implemented by RabbitMQ and most IoT-relevant deployments) defines a rich model of **exchanges**, **queues**, and **bindings** that gives the broker fine-grained control over how messages flow from producers to consumers. Where MQTT provides a simple topic-based publish/subscribe model, AMQP offers programmable routing logic at the broker level — direct routing, pattern matching, fan-out, and header-based filtering are all native protocol features. This flexibility comes at a cost: AMQP's minimum frame overhead is 8 bytes (versus MQTT's 2 bytes), a typical connection handshake exchanges ~7 frames before the first message can flow, and the protocol assumes a reliable TCP transport with sufficient memory for queue management. For IoT, AMQP occupies a specific niche: it is rarely the right choice for constrained end devices, but it excels at edge gateways and backend processing stages where message routing complexity justifies the overhead.

## Exchange and Queue Model

AMQP decouples message producers from consumers through a three-part routing architecture:

1. **Exchanges** receive messages from producers. An exchange never stores messages — it evaluates routing rules and forwards messages to zero or more queues.
2. **Queues** store messages until consumers retrieve them. Queues have configurable durability (survive broker restarts), exclusivity (single consumer only), and auto-delete behavior.
3. **Bindings** define the routing rules between exchanges and queues. A binding specifies a **routing key** pattern that the exchange uses to decide which queues receive a given message.

### Exchange Types

AMQP 0-9-1 defines four exchange types, each implementing a different routing strategy:

**Direct exchange** — Routes messages to queues whose binding key exactly matches the message's routing key. A message published with routing key `sensor.temperature` is delivered only to queues bound with the key `sensor.temperature`. This provides point-to-point routing similar to a named channel.

**Topic exchange** — Routes based on wildcard pattern matching against the routing key. Routing keys are dot-separated strings (e.g., `factory.line7.plc.vibration`), and binding patterns support two wildcards:
- `*` matches exactly one word: `factory.*.plc.vibration` matches `factory.line7.plc.vibration` but not `factory.building-a.line7.plc.vibration`.
- `#` matches zero or more words: `factory.#` matches any routing key starting with `factory.`.

Topic exchanges provide MQTT-like publish/subscribe semantics with the additional capability of multiple independent bindings per queue.

**Fanout exchange** — Delivers every message to every bound queue, ignoring the routing key entirely. This implements broadcast semantics — useful for distributing a command or configuration update to all consumers simultaneously.

**Headers exchange** — Routes based on message header attributes instead of the routing key. Binding rules specify header key-value pairs that must match, with either `all` (AND) or `any` (OR) logic. This enables content-based routing: a message with header `device_type=plc` and `severity=critical` can route to a queue bound with `{device_type: plc, severity: critical, x-match: all}`. Headers exchanges are the most flexible but also the slowest to evaluate.

### Queue Properties

Queues accept several configuration properties that affect behavior:

- **Durable** — The queue definition survives broker restarts. Messages in a durable queue are also persisted if they are published with the `persistent` delivery mode (delivery-mode=2).
- **Exclusive** — The queue is tied to the declaring connection and deleted when that connection closes. Useful for temporary reply queues in RPC patterns.
- **TTL (Time-To-Live)** — Messages that exceed the per-queue or per-message TTL are dead-lettered or discarded. A sensor data queue with a 1-hour TTL automatically discards stale readings that were never consumed.
- **Max length** — The queue rejects or dead-letters messages when it exceeds a configured depth (by count or by total bytes). This prevents unbounded memory growth when consumers fall behind.
- **Dead Letter Exchange (DLX)** — Messages that expire, are rejected, or exceed the queue length are routed to a designated dead letter exchange for inspection, retry, or alerting. The DLX pattern is essential for debugging message flow in complex routing topologies.

## Routing Patterns for IoT

AMQP's routing model supports patterns that are awkward or impossible in MQTT:

**Priority routing** — RabbitMQ supports priority queues (up to 255 levels). A critical alarm from a safety sensor can jump ahead of routine telemetry in the same queue, ensuring low-latency processing for high-priority messages. MQTT has no native priority mechanism.

**Competing consumers** — Multiple consumers on a single queue receive messages in round-robin fashion. Adding more consumers linearly scales processing throughput without changing the producer or broker configuration. In MQTT, this requires v5.0 shared subscriptions, which not all brokers support.

**Request/reply (RPC)** — A producer publishes a request with a `reply_to` header specifying an exclusive reply queue and a `correlation_id` to match responses. The consumer processes the request and publishes the reply to the specified queue. AMQP's exclusive queues and per-message headers make this pattern first-class; in MQTT, RPC requires application-level conventions or v5.0 response topics.

**Message routing based on content** — Using headers exchanges or a plugin-based routing table, messages can be directed based on payload metadata (device type, firmware version, geographic region) without the producer needing to know the consumer topology. Adding a new analytics pipeline for a specific device class requires only a new binding — no changes to producers or existing consumers.

## IoT Edge Gateway Use Cases

AMQP's operational sweet spot in IoT architectures is at the **edge gateway** — the point where constrained device protocols (CoAP, Zigbee, BLE, Modbus) converge and data must be aggregated, transformed, filtered, and forwarded to cloud services.

A typical edge gateway pattern:

```
[Sensors] --CoAP/BLE--> [Gateway Agent] --AMQP--> [RabbitMQ on Gateway] --AMQP/MQTT--> [Cloud]
```

The local RabbitMQ instance (running on a Raspberry Pi, NVIDIA Jetson, or industrial gateway with 1+ GB RAM) provides:

- **Store and forward** — When the cloud connection drops, messages queue locally in durable queues with persistence to SD card or eMMC. A gateway buffering 100,000 sensor readings at 100 bytes each consumes ~10 MB of queue storage — well within the capacity of any gateway-class device. When connectivity returns, the queue drains automatically.
- **Local routing and filtering** — A topic exchange can route critical alarms to both the cloud and a local alert handler, while routing routine telemetry only to the cloud. This reduces unnecessary local processing and enables edge-local responses to urgent conditions.
- **Protocol translation** — The gateway agent receives data in device-native protocols and publishes to AMQP. Cloud-side consumers see a uniform AMQP (or MQTT, via the RabbitMQ MQTT plugin) stream regardless of the underlying device protocol.
- **Rate limiting and aggregation** — A consumer on the gateway can aggregate 60 one-second temperature readings into a single one-minute average before forwarding, reducing cloud ingestion costs by 60x.

RabbitMQ on a Raspberry Pi 4 (4 GB RAM) comfortably handles 5,000–10,000 messages/sec with persistent queues. For edge deployments exceeding this throughput, an Intel NUC or equivalent x86 gateway running RabbitMQ handles 50,000+ messages/sec.

## Protocol Overhead: AMQP vs MQTT

The overhead difference between AMQP and MQTT is significant and determines which protocol is appropriate at each tier of the architecture:

### Connection Setup

| Phase | AMQP 0-9-1 | MQTT 3.1.1 |
|-------|------------|------------|
| TCP handshake | 3 packets (SYN, SYN-ACK, ACK) | Same |
| Protocol handshake | Protocol header → Connection.Start → Connection.Start-Ok → Connection.Tune → Connection.Tune-Ok → Connection.Open → Connection.Open-Ok (~7 frames, ~500 bytes) | CONNECT → CONNACK (2 packets, ~30 bytes) |
| Channel setup | Channel.Open → Channel.Open-Ok (additional ~50 bytes) | Not applicable |
| **Total before first message** | **~550+ bytes, 7+ round trips** | **~30 bytes, 1 round trip** |

### Per-Message Overhead

- **AMQP** — A minimal Basic.Publish frame with a short routing key, basic properties (delivery-mode, content-type), and a 20-byte payload totals ~60–80 bytes. The frame header alone is 8 bytes, and properties add 20–40 bytes even when mostly empty.
- **MQTT** — A minimal PUBLISH with a short topic and 20-byte payload totals ~30 bytes. The fixed header is 2 bytes, the topic is a length-prefixed string, and there are no mandatory properties.

For a device sending 1 message per minute, the overhead difference (~40 bytes per message) is irrelevant — it amounts to ~58 KB/month. For a device sending 100 messages per second, AMQP's additional overhead totals ~345 KB/day versus MQTT's ~259 KB/day — still manageable on broadband but noticeable on metered cellular connections.

### Memory and Processing

An AMQP client library (e.g., rabbitmq-c) requires ~100–200 KB flash and ~50 KB RAM minimum, not counting TLS. MQTT client libraries (Paho Embedded C) fit in ~20 KB flash and ~4 KB RAM. This makes AMQP impractical on Class 1 and Class 2 constrained devices (RFC 7228) and marginal even on microcontrollers with 256 KB flash and 64 KB RAM.

## When AMQP Makes Sense vs When It Is Overkill

### AMQP is the right choice when:

- **Complex routing is required at the edge.** Multiple consumer applications need different subsets of the same data stream, filtered by content, priority, or device class. MQTT's topic-based routing handles simple cases, but content-based routing, priority queues, and dead-letter handling require application-level logic that AMQP provides natively.
- **Store-and-forward reliability is critical.** AMQP's durable queues with disk-backed persistence provide message guarantees that survive broker restarts and power failures. MQTT brokers also offer persistence, but AMQP's queue model with explicit acknowledgment, redelivery, and dead-lettering provides more granular control over failure handling.
- **The architecture includes an edge gateway with sufficient resources.** A device with 512 MB+ RAM running Linux can host a full RabbitMQ instance. The routing, queuing, and management capabilities justify the resource cost when the gateway serves as an aggregation point for dozens or hundreds of downstream devices.
- **Integration with enterprise middleware is required.** AMQP is a native protocol for enterprise message brokers (RabbitMQ, Azure Service Bus, Apache Qpid). A manufacturing IoT system that feeds sensor data into an existing enterprise event bus benefits from end-to-end AMQP without protocol translation.

### AMQP is overkill when:

- **The device is resource-constrained.** Any MCU-class device (Cortex-M0/M3/M4, ESP32, nRF52) should use MQTT or CoAP. AMQP's memory footprint, connection overhead, and library complexity are not justified when the device's communication needs are simple publish/subscribe or request/response.
- **The routing topology is simple.** If every sensor publishes telemetry to a single cloud endpoint and receives commands on a device-specific topic, MQTT handles this with less overhead and simpler client code. AMQP's exchange/binding model adds complexity without benefit.
- **Low-power operation is a priority.** AMQP's connection setup (7+ frame handshake) and per-message overhead are hostile to sleep/wake duty cycling. A device that wakes every 15 minutes to send a single reading wastes significant energy on AMQP connection establishment compared to MQTT's 2-packet handshake or CoAP's single UDP datagram.
- **The deployment is device-to-cloud without edge processing.** When devices communicate directly with a cloud IoT platform (AWS IoT Core, Azure IoT Hub, Google Cloud IoT), these platforms speak MQTT and HTTPS natively. AMQP support varies — Azure Service Bus supports AMQP 1.0, but most device-facing IoT platform endpoints use MQTT.

## AMQP 0-9-1 vs AMQP 1.0

Two incompatible versions of AMQP exist in practice, and the distinction matters:

- **AMQP 0-9-1** — The version implemented by RabbitMQ. Defines the exchange/queue/binding model described above. Widely deployed, well-documented, and the de facto standard for RabbitMQ-based architectures.
- **AMQP 1.0** — An OASIS standard that defines a peer-to-peer messaging protocol without the exchange/queue model. AMQP 1.0 is a wire protocol for transferring messages between nodes, with routing and queuing left to the implementation. Azure Service Bus and Apache ActiveMQ Artemis implement AMQP 1.0. RabbitMQ supports AMQP 1.0 via a plugin but with reduced functionality compared to native 0-9-1.

For IoT edge gateways using RabbitMQ, AMQP 0-9-1 is the relevant version. For integration with Azure Service Bus or other AMQP 1.0 brokers, the 1.0 wire protocol is required. The two versions are not interoperable without a protocol bridge.

## Tips

- Deploy RabbitMQ on the edge gateway rather than attempting to run AMQP clients on constrained devices. The gateway translates between device-native protocols (CoAP, MQTT, BLE) and AMQP, keeping the complexity where resources are abundant.
- Use durable queues with disk-backed persistence for any data that must survive gateway reboots. RabbitMQ's default behavior is to discard queue contents on restart unless both the queue and the messages are marked as durable/persistent.
- Set per-queue TTL and max-length limits to prevent unbounded queue growth during consumer outages. A queue without limits that accumulates messages for 24 hours during a cloud outage can exhaust gateway memory or storage, crashing the broker and losing all queued messages.
- Configure dead-letter exchanges for every production queue. Messages that expire, are rejected, or exceed queue limits route to the DLX, where a monitoring consumer can alert on anomalies. Without a DLX, failed messages vanish silently.
- Use the RabbitMQ management plugin's HTTP API for monitoring queue depths, consumer counts, and message rates from a central dashboard. A queue depth that grows monotonically indicates consumers cannot keep up — a direct signal to scale consumers or reduce producer rate.
- Prefer topic exchanges over direct exchanges for IoT data streams. Topic exchanges support wildcard bindings, so adding a new consumer for a subset of data requires only a new binding rather than changes to producers or existing consumers.

## Caveats

- **AMQP's connection and channel model adds latency that is invisible on LAN but painful over high-latency links.** The 7-frame connection handshake at 200 ms RTT (typical cellular) takes ~1.4 seconds before the first message can be sent. Add TLS negotiation (~3 round trips) and the connection setup exceeds 2 seconds. Devices that connect, send a single message, and disconnect pay this cost every cycle — persistent connections are essential but conflict with low-power sleep modes.
- **RabbitMQ's memory consumption scales with queue depth, not message count.** A queue of 1 million 10-byte messages consumes far more memory than the 10 MB of payload data suggests, because each message carries routing metadata, delivery state, and index entries. RabbitMQ's guidance is to budget roughly 1 KB of RAM per queued message for memory planning.
- **Unacknowledged messages accumulate in the broker's delivery tracking structures.** If a consumer fetches messages but fails to ACK or NACK them (due to a bug or crash), those messages remain "unacked" and count against the queue depth and memory limits. A prefetch count (QoS) that is too high combined with a slow consumer can lock thousands of messages in unacked state, preventing other consumers from processing them.
- **AMQP client libraries for constrained platforms are scarce and poorly maintained.** The rabbitmq-c library targets POSIX systems with dynamic memory allocation. There is no widely-adopted AMQP client for bare-metal MCUs or RTOS environments comparable to Paho MQTT or lwMQTT. This effectively limits AMQP to Linux-class devices.
- **The exchange/binding model creates operational complexity that MQTT avoids.** Misconfigured bindings silently drop messages — a message published to an exchange with no matching binding is discarded (unless an alternate exchange is configured). Debugging message flow requires tracing through exchange types, binding keys, and queue configurations, which is significantly more complex than MQTT's direct topic matching.

## In Practice

- **Messages published to RabbitMQ that never arrive at the expected consumer** most often stem from a binding mismatch. The routing key on the published message does not match any binding on the target exchange, so the message is silently discarded. Enabling the `mandatory` flag causes the broker to return unroutable messages to the publisher, making the failure visible. Alternatively, the RabbitMQ Firehose tracer logs every message routed through every exchange, revealing where messages are dropped.
- **A RabbitMQ instance on an edge gateway that gradually consumes all available memory** is accumulating messages in one or more queues faster than consumers drain them. The management API (`GET /api/queues`) shows per-queue message counts and rates. The usual causes are a cloud connection outage (upstream consumer unreachable), a consumer that crashed without closing its channel, or a producer rate that exceeds consumer capacity. Setting `x-max-length` and `x-overflow: reject-publish` on queues prevents unbounded growth at the cost of back-pressuring producers.
- **Intermittent duplicate message delivery from RabbitMQ** occurs when a consumer processes a message but crashes before sending the ACK. The broker redelivers the message to another consumer (or the same consumer after restart) because it was never acknowledged. The `redelivered` flag on the message indicates this condition. Applications consuming from AMQP queues must be idempotent or implement deduplication using the `message-id` property.
- **An edge gateway that handles local device traffic normally but stalls when the cloud connection recovers** is experiencing queue drain contention. When the cloud consumer reconnects and begins draining a large backlog, the disk I/O and memory operations compete with ongoing message ingestion. RabbitMQ's flow control mechanism throttles publishers when the broker is under memory pressure, causing local device-to-gateway message delivery to slow down or block until the backlog clears.
- **AMQP performance on a Raspberry Pi that degrades sharply above ~5,000 messages/sec** is typically bound by Erlang's single-core queue process handling. Each RabbitMQ queue is backed by a single Erlang process that serializes all enqueue and dequeue operations. Spreading traffic across multiple queues (using consistent hashing exchange or sharded queues) distributes the load across CPU cores and restores throughput linearity.
