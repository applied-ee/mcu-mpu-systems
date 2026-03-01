---
title: "Messaging Protocols"
weight: 20
bookCollapseSection: true
---

# Messaging Protocols

IoT messaging protocols define how devices exchange data with brokers, gateways, and cloud endpoints. The choice of protocol shapes everything from bandwidth consumption and latency to how well the system handles unreliable networks and constrained hardware. MQTT dominates general-purpose IoT deployments with its lightweight publish/subscribe model. CoAP brings REST-like semantics to devices too constrained for HTTP. AMQP offers enterprise-grade routing and queuing for edge gateway scenarios where message reliability and complex routing patterns matter more than minimal overhead.

Each protocol makes different tradeoffs between message size, delivery guarantees, transport requirements, and implementation complexity — and those tradeoffs determine which protocol fits a given device class and network environment.

Protocol choice is also shaped by the [platform architecture]({{< relref "/docs/iot-systems/platform-architecture" >}}). Cloud-managed brokers constrain protocol options — AWS IoT Core does not support QoS 2 and limits subscriptions to 50 per connection, while Azure IoT Hub layers its own messaging semantics over MQTT. Self-hosted brokers (Mosquitto, EMQX, HiveMQ) provide full control over protocol version, QoS levels, and broker-side features like shared subscriptions and topic aliases.

## What This Section Covers

- **[MQTT]({{< relref "mqtt" >}})** — Broker-based publish/subscribe messaging, topic hierarchy design, QoS levels, retained messages, last will and testament, and embedded client libraries.
- **[CoAP]({{< relref "coap" >}})** — Request/response over UDP for constrained devices, confirmable vs non-confirmable messages, observe pattern, block-wise transfers, and DTLS security.
- **[AMQP]({{< relref "amqp" >}})** — Exchange and queue routing model, IoT edge gateway use cases, protocol overhead considerations, and comparison with MQTT for device-to-cloud messaging.
