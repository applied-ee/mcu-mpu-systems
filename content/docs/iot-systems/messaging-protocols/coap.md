---
title: "CoAP"
weight: 20
---

# CoAP

The Constrained Application Protocol (CoAP) is a lightweight request/response protocol designed for machine-to-machine communication on constrained networks. Specified in RFC 7252, CoAP runs over UDP instead of TCP, uses a compact binary header (4 bytes fixed, versus HTTP's variable-length text headers that commonly exceed 200 bytes), and maps naturally to REST semantics (GET, PUT, POST, DELETE). A typical CoAP request with a short URI path and small payload fits in a single UDP datagram under 100 bytes — small enough to transmit in a single IEEE 802.15.4 frame (127 bytes maximum at the link layer). This makes CoAP the protocol of choice for devices on 6LoWPAN, Thread, and other constrained networks where MQTT's TCP requirement is either impractical or impossible.

## Message Model

CoAP defines four message types that separate reliability from request/response semantics:

- **CON (Confirmable)** — Requires an acknowledgment. The sender retransmits using exponential backoff (initial timeout 2–3 seconds, up to 4 retransmissions by default) until an ACK arrives. Provides reliable delivery over unreliable UDP.
- **NON (Non-confirmable)** — Fire-and-forget. No acknowledgment, no retransmission. Suitable for periodic sensor readings where individual losses are tolerable.
- **ACK (Acknowledgment)** — Confirms receipt of a CON message. May carry a response piggy-backed onto the acknowledgment (saving a round trip) or be empty if the server needs more time to process.
- **RST (Reset)** — Indicates that a received message cannot be processed — typically because the recipient has no context for the message (e.g., after a reboot that lost state). RST serves as a lightweight error signal.

Each message carries a 16-bit **Message ID** for deduplication and matching ACKs to CON messages, plus an optional **Token** (0–8 bytes) that correlates requests with responses across separate message exchanges.

The distinction between message-layer reliability (CON/NON) and request/response semantics (GET/PUT/POST/DELETE) is fundamental. A GET request can be sent as either CON (reliable) or NON (unreliable), and the choice is independent of the application logic. This separation does not exist in HTTP, where TCP handles reliability invisibly.

## Request/Response and Response Codes

CoAP uses REST methods with semantics closely aligned to HTTP:

| CoAP Method | HTTP Equivalent | Typical Use |
|-------------|-----------------|-------------|
| GET | GET | Read a sensor value, fetch configuration |
| PUT | PUT | Update a resource (full replacement) |
| POST | POST | Create a resource, trigger an action |
| DELETE | DELETE | Remove a resource |

Response codes follow a compact `class.detail` format: `2.05` (Content) corresponds to HTTP 200, `4.04` (Not Found) to HTTP 404, `5.03` (Service Unavailable) to HTTP 503. The numeric encoding maps directly — class 2 means success, class 4 means client error, class 5 means server error.

**Content-Format** options indicate the payload encoding. Common values include `application/json` (format ID 50), `application/cbor` (format ID 60), and `application/link-format` (format ID 40, used for resource discovery). CBOR is the preferred serialization for CoAP on constrained devices due to its compact binary encoding and standardized mapping to JSON data models.

## Observe Pattern

RFC 7641 extends CoAP with an **observe** mechanism that enables server-push notifications without polling. A client sends a GET request with the Observe option set to 0 (register). The server responds with the current resource value and then sends additional notifications whenever the resource state changes.

Each notification carries a **sequence number** in the Observe option, allowing the client to detect reordering and lost notifications. The server maintains a list of observers and removes clients that fail to acknowledge CON notifications after the retry limit.

The observe pattern is analogous to MQTT subscriptions but operates per-resource rather than per-topic. A sensor node that exposes `/temperature` and `/humidity` as separate resources requires two observe registrations, whereas MQTT could serve both with a single wildcard subscription.

Observe notifications are typically sent as NON messages for high-frequency data (reducing overhead) or CON messages for critical state changes (ensuring delivery). The server decides the reliability level per notification — the client's original registration does not dictate it.

A practical consideration: observe relationships survive server reboots only if the server persists observer state. Most constrained CoAP implementations (libcoap, Zephyr's CoAP library) do not persist observer state, so clients must re-register after a server restart. The Max-Age option on responses indicates how long the client may cache the value before considering it stale — if no notification arrives within the Max-Age window, the client should issue a fresh GET.

## Block-Wise Transfers

RFC 7959 defines **block-wise transfers** for payloads that exceed the practical datagram size. CoAP messages are designed to fit in a single UDP datagram (ideally under the 6LoWPAN MTU of ~100 bytes after header compression), so transferring a 10 KB firmware manifest or configuration file requires fragmentation at the application layer.

Block-wise transfers use two options:

- **Block2** — Controls block-wise responses (server to client). The client requests successive blocks using a block number and the server responds with each block plus a "more" flag.
- **Block1** — Controls block-wise requests (client to server). The client sends the payload in sequential blocks.

Block sizes are powers of two from 16 to 1024 bytes (expressed as a 3-bit SZX value: SZX=0 is 16 bytes, SZX=6 is 1024 bytes). The actual block size is negotiated: the client proposes a size and the server may respond with a smaller size.

Transferring a 4 KB file with 256-byte blocks requires 16 round trips (for CON transfers). Over a network with 100 ms round-trip latency, this takes ~1.6 seconds — significantly slower than a single TCP stream but acceptable for infrequent large transfers on constrained networks. For bulk data movement (OTA firmware images), CoAP block transfers are practical up to roughly 100 KB; beyond that, the cumulative overhead of per-block acknowledgments and retransmissions becomes prohibitive and HTTPS with range requests is typically more efficient.

## DTLS Security

CoAP secures communication using **DTLS** (Datagram Transport Layer Security) — the UDP equivalent of TLS. DTLS 1.2 (RFC 6347) is the standard security layer, running on port 5684 (versus 5683 for plaintext CoAP).

Three security modes are defined:

- **Pre-Shared Key (PSK)** — Both sides share a symmetric key provisioned during manufacturing. The DTLS handshake is lightweight (2 round trips, ~300 bytes total) and requires minimal RAM. Suitable for constrained devices but creates key management challenges at scale — every device-to-device pair potentially needs a unique key.
- **Raw Public Key (RPK)** — Each device has an asymmetric key pair, and the peer's public key is pre-provisioned. No certificate authority infrastructure is needed. The DTLS handshake is heavier than PSK (~1 KB, ECDHE with curve P-256) but avoids the X.509 certificate overhead.
- **Certificate-based** — Full X.509 certificate validation, identical to TLS. The most scalable option but also the heaviest — a certificate chain can add 1–3 KB to the handshake, and certificate parsing requires significant code and RAM. Typically reserved for gateway-class devices.

On a Cortex-M4 at 64 MHz, a DTLS 1.2 handshake with PSK takes ~50 ms and ~5 KB RAM. With ECDHE-ECDSA certificates, the same handshake takes ~500 ms and ~15 KB RAM. These numbers determine whether DTLS is feasible on a given platform.

DTLS session resumption (using session tickets or cached sessions) avoids the full handshake on reconnection, reducing it to a single round trip. For devices that communicate periodically (wake, send data, sleep), session resumption is essential to amortize the handshake cost.

## Resource Discovery

CoAP provides a standardized **resource discovery** mechanism through the `/.well-known/core` URI (RFC 6690). A GET request to this path returns a list of resources the server exposes, encoded in CoRE Link Format:

```
</temperature>;rt="sensor";if="sensor";ct=60,
</humidity>;rt="sensor";if="sensor";ct=60,
</config>;rt="config";ct=50
```

Each link includes attributes: `rt` (resource type), `if` (interface description), and `ct` (content format). Clients and gateways use this to discover available resources without prior knowledge of the device's capabilities.

In mesh networks (Thread, 6LoWPAN), resource discovery combined with multicast enables automatic device enumeration. A gateway sends a multicast GET to `/.well-known/core` on the mesh-local multicast address, and every CoAP server responds with its resource list. This forms the basis for zero-configuration device onboarding in Thread networks.

## CoAP vs MQTT on Constrained Devices

The choice between CoAP and MQTT depends on the device class, network topology, and communication pattern:

| Dimension | CoAP | MQTT |
|-----------|------|------|
| Transport | UDP (connectionless) | TCP (connection-oriented) |
| Model | Request/response (+ observe) | Publish/subscribe |
| Header overhead | 4 bytes fixed | 2 bytes minimum |
| Minimum RAM | ~1–5 KB | ~10–20 KB (TCP stack + MQTT state) |
| Reliability | Application-layer (CON/NON per message) | TCP + QoS levels |
| NAT traversal | Problematic (UDP, no persistent connection) | Natural (TCP, persistent connection) |
| 6LoWPAN/Thread suitability | Native (designed for it) | Requires TCP over 6LoWPAN (RFC 6282) |
| Fan-out (one-to-many) | Not native (requires multicast or proxy) | Native (broker distributes to all subscribers) |

CoAP excels on Class 1 devices (RFC 7228: ~10 KB RAM, ~100 KB flash) operating on IEEE 802.15.4 mesh networks where TCP is impractical. The connectionless nature of UDP means a device can wake from sleep, send a CON message, wait for an ACK, and return to sleep without maintaining a TCP connection — saving both power and RAM.

MQTT excels when the device has a reliable TCP stack (ESP32, Linux-based gateways, cellular modems), needs fan-out to multiple consumers, or must traverse NAT/firewalls. The persistent TCP connection and broker-based routing handle NAT traversal transparently.

For hybrid architectures, a **CoAP-to-MQTT bridge** at the network edge is a common pattern. Constrained sensor nodes speak CoAP on the local mesh, and a border router or gateway translates to MQTT for cloud communication. Eclipse Californium and libcoap both support proxy/bridge modes.

## CoAP vs HTTP Overhead

A concrete comparison of a sensor reading exchange illustrates the overhead difference:

**HTTP (minimal headers):**
```
POST /api/temperature HTTP/1.1\r\n
Host: server.example.com\r\n
Content-Type: application/json\r\n
Content-Length: 18\r\n
\r\n
{"temperature":23.5}
```
Total: ~130 bytes minimum (headers alone are ~110 bytes).

**CoAP (equivalent):**
```
4-byte header + 1-byte token + ~15 bytes options (Uri-Path, Content-Format) + payload marker + 18-byte payload
```
Total: ~39 bytes.

Over a 6LoWPAN network with a 60-byte application-layer MTU after header compression, the HTTP request fragments into 3 frames while the CoAP request fits in a single frame. Fewer frames mean fewer opportunities for loss, lower latency, and lower energy consumption — on an IEEE 802.15.4 radio drawing 20 mA during TX, sending 3 frames versus 1 frame costs roughly 3x the energy per transaction.

## Tips

- Use CON messages for infrequent, important data (state changes, alerts, commands) and NON messages for periodic telemetry that can tolerate loss. A temperature sensor publishing every 10 seconds can afford to lose a few readings; a door lock state change must be confirmed.
- Set the Max-Age option on observe notifications to match the expected update interval plus a margin. If the sensor updates every 30 seconds, a Max-Age of 45 seconds lets the client detect a missed notification (stale value) without premature timeout.
- Choose the smallest block size that the network reliably delivers without fragmentation. On 6LoWPAN, 64-byte blocks typically fit within a single 802.15.4 frame after header compression. Larger blocks fragment at the adaptation layer, doubling or tripling loss probability.
- Use DTLS session resumption for devices that communicate periodically. The full DTLS handshake can consume 500 ms and significant energy on constrained devices — session resumption reduces this to a single round trip (~50 ms).
- Include an ETag option on responses to enable conditional requests. A client that GETs a configuration resource with an ETag can later send a conditional GET — if the resource has not changed, the server responds with `2.03 Valid` and an empty payload, saving bandwidth.
- Prefer CBOR over JSON for CoAP payloads. CBOR is the native content format for the CoAP ecosystem, and libraries like tinycbor have a smaller footprint than JSON parsers while producing more compact payloads.

## Caveats

- **CoAP over UDP does not traverse NAT firewalls reliably.** Without a persistent TCP connection to keep the NAT mapping alive, UDP mappings time out (often within 30–120 seconds on consumer routers). Devices behind NAT must send periodic keep-alive packets to maintain the mapping, or use a CoAP reverse proxy on the public side. This is the single largest deployment obstacle for CoAP on the public internet.
- **Observe notifications can be lost silently with NON messages.** If a NON notification is lost, the client has no way to know until the Max-Age expires and it detects a stale value. For critical resources, using CON notifications or implementing application-level sequence checking is necessary.
- **Multicast CoAP responses can overwhelm a constrained network.** A multicast GET to `/.well-known/core` on a mesh network with 200 nodes generates 200 near-simultaneous responses. Without leisure-based response spreading (RFC 7252, Section 8.2), the resulting packet storm can saturate the radio channel and cause cascading retransmissions. Leisure randomization (responses delayed by a random interval up to the group size × estimated round trip) mitigates this but adds latency.
- **DTLS connection state consumes RAM that persists for the session lifetime.** A DTLS session typically requires 5–15 KB of RAM depending on the cipher suite. A CoAP server on a Class 1 device that must maintain DTLS sessions with multiple clients simultaneously can exhaust memory with as few as 3–5 concurrent sessions.
- **Block-wise transfers have no built-in integrity check across the full payload.** Each block is acknowledged individually, but there is no protocol-level mechanism to verify that all blocks reassemble into the correct complete payload. Application-level integrity (e.g., a SHA-256 hash of the full payload sent as a separate resource or in the first block) is necessary for transfers where corruption matters.

## In Practice

- **A CoAP device that works on the local network but fails when accessed through the internet** is almost always a NAT traversal issue. The device's UDP port mapping expires between requests, and incoming packets are silently dropped by the NAT. The fix is either a persistent CoAP connection with keep-alives, a publicly-addressed CoAP proxy, or switching to CoAP over TCP (RFC 8323) for internet-facing communication.
- **Observe notifications that arrive for a few minutes and then stop** indicate that the server is pruning the observer list because CON notifications are not being acknowledged. If the client's ACK is lost repeatedly (common on lossy mesh networks), the server removes the observer after the retry limit. Increasing the server's observer timeout or switching to NON notifications for non-critical resources resolves this.
- **A block-wise transfer that succeeds on a bench test but fails in a deployed mesh network** is typically caused by the chosen block size exceeding the effective MTU after 6LoWPAN header compression. The block fragments at the adaptation layer, increasing loss probability exponentially. Reducing the block size to 64 bytes (SZX=2) so each block fits in a single 802.15.4 frame usually resolves the issue.
- **Latency spikes in CoAP request/response that appear random but average around 3–5 seconds** are caused by CON retransmission timeouts. The initial request was lost, and the client retransmitted after the default 2–3 second ACK timeout. On lossy networks, this retransmission behavior is normal but can appear as erratic response times in application logs.
- **A gateway that bridges CoAP to MQTT and gradually increases memory consumption** is likely not freeing DTLS session state for devices that disappear from the mesh without sending a RST. Setting a session timeout on the gateway (e.g., 5 minutes of inactivity triggers session cleanup) prevents unbounded memory growth.
