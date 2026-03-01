---
title: "Distributed Tracing"
weight: 50
---

# Distributed Tracing

Distributed tracing tracks a single request or event as it flows through multiple services in a pipeline. In traditional microservice architectures, a trace follows an HTTP request from API gateway through authentication, business logic, and database layers. In IoT, the "request" is a telemetry message or command that traverses a fundamentally different path: from a constrained device through an MQTT broker, a message router or rule engine, a cloud function, and into a time-series database or command-and-control service. When a sensor reading fails to appear in a dashboard, the question is: did the device fail to publish, did the broker drop the message, did the rule engine misroute it, did the cloud function error, or did the database reject the write? Without distributed tracing, answering this question requires manually correlating logs across 4–6 independent systems.

## OpenTelemetry Concepts

OpenTelemetry (OTel) is the vendor-neutral standard for distributed tracing, metrics, and logging. Its tracing model consists of:

- **Trace** — A directed acyclic graph of spans representing the full journey of a single operation. In IoT, a trace might represent a sensor reading's path from device publish to dashboard render.
- **Span** — A named, timed operation within a trace. Each span has a start time, duration, status (OK, ERROR), attributes (key-value metadata), and events (timestamped annotations). Examples: "mqtt_publish" (device publishes to broker), "rule_engine_eval" (rule engine evaluates message), "tsdb_write" (write to InfluxDB).
- **Span context** — The propagation payload that links spans across service boundaries. Contains the trace ID (identifies the trace), span ID (identifies the parent span), and trace flags (sampling decision). Span context must be propagated with the message as it flows through the pipeline.
- **Baggage** — Key-value pairs propagated alongside span context for cross-cutting concerns. In IoT, baggage might carry `device_id`, `firmware_version`, or `deployment_site` so that every span in the trace carries this context without each service looking it up independently.

### Trace Context Propagation via MQTT

The central challenge of IoT distributed tracing is propagating trace context through an MQTT broker. HTTP-based microservices propagate context in headers (`traceparent`, `tracestate`). MQTT v3.1.1 has no header mechanism — the only payload is the message body.

**MQTT v5 user properties** solve this cleanly. User properties are arbitrary key-value string pairs attached to PUBLISH packets:

```
PUBLISH
  Topic: devices/sensor-0042/telemetry
  User Properties:
    traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
    tracestate: vendor=value
  Payload: {"battery_voltage": 3.82, "cpu_usage": 34.2}
```

The `traceparent` header follows the W3C Trace Context specification:
- `00` — Version
- `4bf92f...` — Trace ID (16 bytes, hex-encoded)
- `00f067...` — Parent span ID (8 bytes, hex-encoded)
- `01` — Trace flags (01 = sampled)

MQTT v5 brokers (EMQX, HiveMQ, Mosquitto 2.x) preserve user properties across publish/subscribe delivery. A subscriber receives the same `traceparent` that the publisher attached, enabling the downstream service to create a child span linked to the device's span.

**For MQTT v3.1.1** (no user properties), trace context must be embedded in the message payload:

```json
{
  "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  "battery_voltage": 3.82,
  "cpu_usage": 34.2
}
```

This approach works but pollutes the application payload with tracing metadata. Every consumer must understand and strip (or ignore) the tracing fields. On bandwidth-constrained devices, the 55-byte `traceparent` string adds measurable overhead to every message.

### Device-Side Instrumentation

Full OpenTelemetry instrumentation on a constrained MCU is impractical — the OTel SDK requires more memory and CPU than most embedded targets can spare. Lightweight alternatives:

- **Trace ID generation only** — The device generates a random 16-byte trace ID and 8-byte span ID per telemetry publish, attaching them as MQTT v5 user properties or payload fields. The device does not maintain a span tree, export traces, or perform sampling decisions. The trace ID simply provides a correlation handle that backend services use to link their spans.
- **Monotonic sequence number** — For devices that cannot generate cryptographic-quality random numbers efficiently, a monotonic 32-bit sequence number per device serves as a simpler correlation key. The first backend service that receives the message generates a proper trace ID and maps the sequence number to it.
- **No device instrumentation** — The MQTT broker or the first subscriber in the pipeline creates the root span. The trace begins at the backend boundary, not at the device. This misses device-side latency (time from sensor read to MQTT publish) but eliminates all tracing overhead on the device.

## Jaeger Architecture

Jaeger is the most widely deployed open-source distributed tracing backend, originally developed at Uber and now a CNCF graduated project:

- **Agent** — A lightweight daemon that receives spans over UDP (port 6831) and batches them to the collector. In IoT pipelines, the agent typically runs on the same host as the MQTT subscriber or rule engine, not on the device itself.
- **Collector** — Receives spans from agents (or directly from instrumented services via HTTP/gRPC), validates them, and writes them to storage.
- **Storage** — Elasticsearch, Cassandra, or Kafka (for streaming). Elasticsearch is the most common choice for IoT deployments already running an ELK stack for log aggregation — trace storage shares the same cluster.
- **Query** — Serves the Jaeger UI and API. Supports trace search by service name, operation name, tags, duration, and time range.
- **UI** — Visualizes traces as a timeline of spans, showing parent-child relationships, duration, and span attributes. For IoT pipeline traces, the UI displays the full path from broker receipt to database write, highlighting which span contributed the most latency.

A minimal Jaeger deployment for IoT pipeline tracing: one collector (receives spans from all instrumented services), Elasticsearch for storage (shared with log aggregation), and one query instance for the UI. This runs comfortably on a single 4-core, 8 GB machine for fleets under 50,000 devices.

## Instrumenting the IoT Pipeline

A typical IoT telemetry pipeline with tracing instrumented at each stage:

```
Device          → MQTT Broker      → Rule Engine      → Lambda/Function  → TSDB Write
[device_publish]  [broker_forward]   [rule_evaluate]    [transform_store]   [db_write]
   Span 1            Span 2             Span 3              Span 4           Span 5
```

### Span 1: Device Publish

Created on the device (if instrumented) or at the broker's ingestion point. Attributes:
- `device.id`: sensor-0042
- `device.firmware`: 2.3.1
- `mqtt.topic`: devices/sensor-0042/telemetry
- `mqtt.qos`: 1

### Span 2: Broker Forward

Created by a broker plugin or the subscribing bridge service. Records the time between message receipt by the broker and delivery to the subscriber. Attributes:
- `mqtt.broker`: emqx-cluster-01
- `mqtt.delivery_latency_ms`: 3

### Span 3: Rule Engine Evaluate

Created by the message routing or rule evaluation service (AWS IoT Rules, custom rule engine). Records which rules matched the message and what actions were triggered. Attributes:
- `rule.name`: store_telemetry
- `rule.action`: write_to_timestream
- `rule.matched`: true

### Span 4: Transform and Store

Created by the cloud function (AWS Lambda, Azure Function) that transforms the raw telemetry into the TSDB's write format. Attributes:
- `function.name`: iot-telemetry-processor
- `function.cold_start`: false
- `transform.fields_extracted`: 8

### Span 5: Database Write

Created by the TSDB client library. Records write latency and success/failure. Attributes:
- `db.system`: influxdb
- `db.operation`: write
- `db.write_latency_ms`: 12
- `db.status`: success

The complete trace, viewable in Jaeger, shows the end-to-end latency from device publish to database write and identifies which stage introduced the most delay. A trace showing 3 ms for broker forwarding, 2 ms for rule evaluation, 800 ms for Lambda cold start, and 12 ms for database write immediately identifies Lambda cold starts as the latency bottleneck.

## Sampling Strategies

Tracing every message in a fleet of 10,000 devices producing 480,000 messages per minute generates an enormous volume of trace data — far more than necessary for operational insight and expensive to store. Sampling selects which messages receive full tracing:

- **Probabilistic sampling** — Trace 1% of messages randomly. At 480,000 messages/minute, this produces 4,800 traces/minute — enough for statistical analysis of latency distributions and error rates. Implementation: the trace ID's low bits determine the sampling decision, ensuring all spans in a trace agree on whether it is sampled.

- **Rate-limited sampling** — Trace at most N messages per second regardless of total throughput. Ensures a consistent trace volume (and storage cost) as the fleet grows. A limit of 10 traces/second produces 864,000 traces/day — sufficient for debugging without overwhelming storage.

- **Error-biased sampling** — Trace 100% of messages that result in errors (rule engine failure, database write timeout, cloud function exception) and 1% of successful messages. This ensures every failure path is captured in full detail while keeping storage costs manageable for the dominant success path.

- **Device-targeted sampling** — Trace 100% of messages from specific devices under investigation (temporarily elevated via a device shadow command or configuration flag) and 0.1% from the rest of the fleet. This provides full pipeline visibility for a problematic device without the overhead of fleet-wide tracing.

- **Head sampling vs. tail sampling** — Head sampling (decision made at trace start, on the device or at the broker) is simple but cannot know if the trace will encounter an error downstream. Tail sampling (decision made after the trace completes, at the collector) can select all error traces but requires buffering complete traces before making the decision — adding latency and memory overhead at the collector.

## Tips

- Start tracing at the first backend service (MQTT subscriber or broker plugin), not at the device. Device-side instrumentation adds code complexity, memory overhead, and bandwidth cost for a single span that can be approximated from the broker's receipt timestamp minus the device's reported timestamp.
- Use Jaeger's tag-based search to build operational workflows. Searching for traces with `db.status=error` across the last hour surfaces all database write failures. Searching for `function.cold_start=true AND function.duration_ms > 500` identifies Lambda cold start latency spikes.
- Correlate trace IDs with log entries by including the trace ID in structured log output. When investigating a failed trace in Jaeger, the trace ID can be copied into a Kibana or Loki search to retrieve the corresponding log entries from every service in the pipeline.
- Store traces in the same Elasticsearch cluster used for log aggregation when possible. Sharing infrastructure reduces operational overhead, and Jaeger's Elasticsearch storage backend is production-grade. Separate indices (`jaeger-span-*`, `jaeger-service-*`) keep trace data isolated from log data while sharing cluster resources.

## Caveats

- **MQTT v3.1.1 brokers strip user properties, making trace context propagation impossible without embedding context in the payload.** Upgrading to MQTT v5 may not be feasible if the device fleet's MQTT client libraries do not support v5 or if the broker infrastructure is managed by a third party. In these cases, payload-embedded trace context is the only option, with the associated payload size overhead.
- **Jaeger's default storage configuration does not include retention management.** Traces stored in Elasticsearch accumulate indefinitely unless an index lifecycle policy is applied to `jaeger-span-*` indices. A fleet producing 10,000 traces per minute at 1 KB per span generates approximately 14 GB of trace data per day. Without retention policies, storage fills within weeks.
- **Trace context propagation breaks at any service boundary that does not forward the context.** A rule engine or message router that consumes an MQTT message, processes it, and publishes a new message without copying the `traceparent` from the original creates a new trace — the link between device publish and downstream processing is lost. Every service in the pipeline must be instrumented to extract and propagate trace context.
- **Lambda/serverless function cold starts introduce variable latency that appears as outliers in trace analysis.** A cold start adds 500 ms–2 seconds to the function span. In a fleet producing thousands of traces per minute, cold starts affect a small percentage of traces but dominate the p99 latency metric. Filtering traces by `function.cold_start=true` isolates cold-start latency from steady-state performance.

## In Practice

- **A Jaeger trace showing a 3-second gap between the broker forwarding span and the rule engine evaluation span** typically indicates message queuing at the subscriber. The MQTT subscriber has received the message from the broker but is backlogged processing previous messages. This manifests as increasing end-to-end latency during traffic spikes (many devices reconnecting simultaneously after a network outage). Scaling the subscriber horizontally or increasing its consumer concurrency resolves the bottleneck.
- **Traces consistently showing `db.status=error` on the TSDB write span with an error message referencing "field type conflict"** indicates the TSDB is receiving a metric value with a different type than previously recorded. A firmware bug that sends `battery_voltage` as a string ("3.82") instead of a float (3.82) triggers this error. The trace identifies exactly which device and which firmware version produced the malformed data — information that would require correlating logs from multiple systems without tracing.
- **A sudden increase in trace count without a corresponding increase in device message count** suggests the tracing infrastructure is double-counting — likely a subscriber that creates a new trace instead of continuing an existing one when it receives a message. This happens when the trace context extraction code fails to parse the `traceparent` and falls back to creating a new root span. The symptom is Jaeger showing many short, single-span traces instead of multi-span pipeline traces.
- **Device-targeted 100% sampling enabled for debugging a specific sensor node, but Jaeger showing no traces for that device** usually means the sampling decision is being made at the backend (head sampling at the broker or collector), not at the device. If the broker's sampler is set to 1% probabilistic, only 1% of the targeted device's messages are traced regardless of the device-side flag. Moving the sampling decision to the collector (tail sampling) or configuring the broker to respect a device-level sampling flag resolves this.
