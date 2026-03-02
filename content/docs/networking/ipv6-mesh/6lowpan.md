---
title: "6LoWPAN: IPv6 over 802.15.4"
weight: 20
---

# 6LoWPAN: IPv6 over 802.15.4

The fundamental problem is arithmetic. An IPv6 header is 40 bytes. A UDP header is 8 bytes. That is 48 bytes of protocol overhead before a single byte of application data. An IEEE 802.15.4 frame has a maximum size of 127 bytes, and after the MAC header (9–23 bytes depending on addressing mode), frame check sequence (2 bytes), and optional security headers (5–14 bytes), the remaining payload is typically 72–102 bytes. Fitting a 48-byte IPv6+UDP header into an 80-byte payload leaves only 32 bytes for application data — barely enough for a sensor reading.

6LoWPAN (IPv6 over Low-Power Wireless Personal Area Networks, RFC 4944 and RFC 6282) solves this with aggressive header compression and a fragmentation scheme that spans the gap between 1280-byte IPv6 minimum MTU and the ~80-byte 802.15.4 frame payload.

## IEEE 802.15.4 Radio Fundamentals

Before understanding 6LoWPAN's compression, the underlying radio layer deserves attention.

### Physical Layer

| Parameter | Value |
|-----------|-------|
| Frequency band (most common) | 2.4 GHz ISM |
| Modulation | O-QPSK with DSSS |
| Data rate | 250 kbps |
| Channels | 16 (channels 11–26), 5 MHz spacing |
| TX power (typical) | 0 to +8 dBm |
| Receiver sensitivity | -95 to -100 dBm |
| Range (indoor) | 10–30 m |
| Range (outdoor, line of sight) | 100–300 m |

The 250 kbps data rate is gross; actual application throughput is typically 30–80 kbps after MAC overhead, CSMA-CA backoff, and ACK frames.

Sub-GHz bands (868 MHz in Europe, 915 MHz in Americas) are also defined in 802.15.4 at 20–40 kbps. These offer longer range (1–3 km outdoor) but are less commonly used with 6LoWPAN.

### MAC Layer

802.15.4 uses a CSMA-CA (Carrier Sense Multiple Access with Collision Avoidance) mechanism:

1. Wait a random backoff period (0–2^BE slots, where BE = backoff exponent starting at 3)
2. Perform Clear Channel Assessment (CCA) — listen for energy above threshold
3. If channel is clear, transmit
4. If channel is busy, increment BE (up to max 5) and repeat
5. After `macMaxCSMABackoffs` failures (default 4), report channel access failure

Each backoff slot is 320 µs (20 symbol periods at 62.5 ksymbols/s). The worst-case channel access delay before the first CCA is ~5 ms; with retries, up to ~25 ms.

### Addressing

802.15.4 supports two address types:

| Address Type | Length | Usage |
|-------------|--------|-------|
| Short address | 16-bit | Assigned by coordinator; saves frame space |
| Extended address | 64-bit (EUI-64) | Globally unique; derived from manufacturer-assigned MAC |

Short addresses save 12 bytes per frame (6 bytes each for source and destination) compared to extended addresses. This savings matters when the frame payload is only 80–100 bytes.

### Frame Structure

```
┌────────────────── 127 bytes maximum ──────────────────┐
│ FCF │ Seq │ Dest PAN │ Dest Addr │ Src Addr │ Payload │ FCS │
│ 2B  │ 1B  │  2B      │ 2-8B      │ 2-8B     │  var    │ 2B  │
└───────────────────────────────────────────────────────┘

Payload capacity:
  Short/Short addressing:  127 - 2 - 1 - 2 - 2 - 2 - 2 = 116 bytes
  Extended/Extended:       127 - 2 - 1 - 2 - 8 - 8 - 2 = 104 bytes
  With AES-CCM-128 security: subtract 21 bytes (5 aux + 16 MIC)
```

## 6LoWPAN Header Compression

6LoWPAN's key contribution is IPHC (IP Header Compression, RFC 6282) and NHC (Next Header Compression). Together they reduce a 48-byte IPv6+UDP header to as few as 4 bytes in the best case.

### IPHC — IPv6 Header Compression

The standard IPv6 header contains fields that are often redundant or derivable from the link layer:

| IPv6 Header Field | Size | IPHC Treatment |
|-------------------|------|----------------|
| Version (always 6) | 4 bits | Elided (always 6 in 6LoWPAN context) |
| Traffic Class | 8 bits | Compressed or elided (typically 0) |
| Flow Label | 20 bits | Compressed or elided (typically 0) |
| Payload Length | 16 bits | Elided (derived from 802.15.4 frame length) |
| Next Header | 8 bits | Compressed via NHC or carried inline |
| Hop Limit | 8 bits | Carried inline (1 byte) |
| Source Address | 128 bits | Compressed using link-layer address context |
| Destination Address | 128 bits | Compressed using link-layer address context |

**Address compression** is where the largest savings occur. If the source IPv6 address is a link-local address with an IID derived from the 802.15.4 extended address, it is fully elided — the receiver reconstructs it from the `fe80::` prefix and the source MAC address in the 802.15.4 header. A 16-byte address becomes 0 bytes.

Compression levels for source/destination addresses:

| Scenario | Compressed Size | Savings |
|----------|----------------|---------|
| Link-local, IID from EUI-64 | 0 bytes | 16 bytes saved |
| Link-local, IID from short address | 0 bytes (2-byte short addr in MAC) | 16 bytes saved |
| Link-local, arbitrary IID | 8 bytes (IID inline) | 8 bytes saved |
| Global, prefix from context, IID from EUI-64 | 0 bytes | 16 bytes saved |
| Global, prefix from context, arbitrary IID | 8 bytes | 8 bytes saved |
| Global, full address inline | 16 bytes | 0 saved |

**Best case**: Both source and destination are link-local with EUI-64 IIDs. The IPHC dispatch byte (2 bytes) plus hop limit (1 byte) = **3 bytes** for the entire IPv6 header (down from 40 bytes).

**Typical case**: One link-local, one global address with context-based prefix compression. IPHC uses **6–10 bytes**.

### NHC — Next Header Compression

NHC compresses the UDP header from 8 bytes:

| UDP Field | Size | NHC Treatment |
|-----------|------|---------------|
| Source Port | 16 bits | Compressed if in range 61616–61631 (4 bits) or 0–255 (8 bits) |
| Destination Port | 16 bits | Same compression as source |
| Length | 16 bits | Elided (derived from 802.15.4 frame length) |
| Checksum | 16 bits | May be elided (RFC 6282 allows it; 802.15.4 FCS provides integrity) |

**Best case**: Both ports in the 61616–61631 range, checksum elided = **2 bytes** (1 NHC byte + 1 byte for both ports).

**Typical case**: One full port, one compressed = **4 bytes**.

### Combined Compression Example

```
Uncompressed IPv6 + UDP:
  IPv6 header:  40 bytes
  UDP header:    8 bytes
  Total:        48 bytes

Compressed (best case):
  IPHC dispatch: 2 bytes
  Hop Limit:     1 byte
  NHC + ports:   2 bytes
  Total:         5 bytes → 43 bytes saved

Compressed (typical link-local to link-local, CoAP):
  IPHC dispatch: 2 bytes
  Hop Limit:     1 byte
  NHC:           1 byte
  Src port:      1 byte (compressed)
  Dst port:      2 bytes (CoAP = 5683, inline)
  Total:         7 bytes → 41 bytes saved
```

With typical compression, the 80-byte 802.15.4 payload yields 73 bytes for application data — enough for most sensor readings, CoAP messages, and control commands.

## Fragmentation and Reassembly

IPv6 mandates a minimum MTU of 1280 bytes, but 802.15.4 frames carry at most ~100 bytes of payload. 6LoWPAN bridges this gap with its own fragmentation layer (distinct from IPv6 fragmentation, which is end-to-end).

### Fragment Structure

The first fragment carries the FRAG1 dispatch header:

```
FRAG1: [Dispatch (2B)] [Datagram Size (11 bits)] [Datagram Tag (16 bits)]
       followed by compressed IPv6 header + payload start

FRAGN: [Dispatch (2B)] [Datagram Size (11 bits)] [Datagram Tag (16 bits)]
       [Datagram Offset (8 bits, in 8-byte units)]
       followed by payload continuation
```

A 256-byte CoAP response requires approximately 4 fragments:

| Fragment | Payload Bytes | Contents |
|----------|--------------|----------|
| FRAG1 | ~80 bytes | IPHC header + first 73 bytes of data |
| FRAGN #2 | ~90 bytes | Next 90 bytes of data |
| FRAGN #3 | ~90 bytes | Next 90 bytes of data |
| FRAGN #4 | ~3 bytes | Final 3 bytes of data |

### Reassembly Buffer

The receiving node must buffer all fragments until the complete datagram is assembled. This requires a reassembly buffer of at least 1280 bytes (the minimum IPv6 MTU). On a node with 32 KB SRAM, a single reassembly buffer consumes 4% of total RAM. Supporting two concurrent reassemblies doubles this cost.

Contiki-NG defaults to `SICSLOWPAN_CONF_FRAG_MAX_SIZE=1280` and `SICSLOWPAN_CONF_REASS_MAXAGE=20` (20 seconds). If any fragment is lost, the entire datagram must be retransmitted — there is no per-fragment ACK at the 6LoWPAN layer.

## Hardware Platforms

Several SoC families support 802.15.4 with integrated radios:

| SoC | Vendor | Core | Flash | RAM | Radio | TX Current | RX Current | Sleep |
|-----|--------|------|-------|-----|-------|-----------|-----------|-------|
| nRF52840 | Nordic | Cortex-M4F @ 64 MHz | 1 MB | 256 KB | 802.15.4 + BLE | 6.2 mA (0 dBm) | 6.1 mA | 1.5 µA |
| CC2652R | TI | Cortex-M4F @ 48 MHz | 352 KB | 80 KB | 802.15.4 + BLE | 6.9 mA (0 dBm) | 5.4 mA | 0.85 µA |
| EFR32MG12 | SiLabs | Cortex-M4F @ 40 MHz | 1 MB | 256 KB | 802.15.4 + BLE | 8.2 mA (0 dBm) | 8.8 mA | 1.3 µA |
| KW41Z | NXP | Cortex-M0+ @ 48 MHz | 512 KB | 128 KB | 802.15.4 + BLE | 8.5 mA (0 dBm) | 7.5 mA | 0.9 µA |
| ESP32-H2 | Espressif | RISC-V @ 96 MHz | 4 MB | 320 KB | 802.15.4 + BLE | 9.0 mA (0 dBm) | 9.5 mA | 7 µA |

All of these support both 802.15.4 and BLE, enabling Thread+BLE commissioning or Zigbee+BLE concurrent operation. The nRF52840 and CC2652R are the most widely deployed in Thread/OpenThread products.

### Development Boards

| Board | SoC | Price (approx.) | JTAG/SWD | Notes |
|-------|-----|-----------------|----------|-------|
| nRF52840-DK | nRF52840 | $40 | On-board J-Link | Best OpenThread dev experience |
| CC2652R LaunchPad | CC2652R | $30 | On-board XDS110 | TI Thread/Zigbee SDK |
| WSTK + EFR32MG12 | EFR32MG12 | $50 | On-board J-Link | SiLabs Simplicity Studio |
| ESP32-H2-DevKitM | ESP32-H2 | $10 | USB-JTAG | ESP-IDF + OpenThread |

## Border Router Architecture

A border router bridges the 6LoWPAN mesh network to a standard IPv6 (or IPv4) network. It performs three critical functions:

**1. Header compression/decompression** — Packets entering the 802.15.4 network get IPHC-compressed headers. Packets leaving get full IPv6 headers restored.

**2. Fragmentation/reassembly** — Large packets from the Ethernet/WiFi side are fragmented into 802.15.4-sized frames. Fragments arriving from the mesh are reassembled.

**3. IPv6 routing** — The border router maintains a routing table mapping destination IPv6 addresses (or prefixes) to 802.15.4 link-layer addresses. It advertises the mesh network's prefix on the external interface and routes packets between the two interfaces.

```
 ┌─────────────┐     Ethernet/WiFi      ┌───────────────────┐
 │  Cloud /    │◄── Full IPv6 packets ──►│   Border Router   │
 │  LAN hosts  │    (1500-byte MTU)      │                   │
 └─────────────┘                         │  ┌─────────────┐  │
                                         │  │ 6LoWPAN     │  │
                                         │  │ compression │  │
                                         │  │ + fragment  │  │
                                         │  └──────┬──────┘  │
                                         └─────────┼─────────┘
                                                   │ 802.15.4
                                          ┌────────┼────────┐
                                          │        │        │
                                       ┌──┴─┐  ┌──┴─┐  ┌──┴─┐
                                       │Node│  │Node│  │Node│
                                       └────┘  └────┘  └────┘
```

### Border Router Implementations

| Implementation | Platform | Notes |
|---------------|----------|-------|
| OpenThread Border Router (OTBR) | Raspberry Pi + nRF52840 (RCP) | Reference implementation; most mature |
| Contiki-NG border router | Native 802.15.4 SoC | Runs directly on MCU; simpler but less featured |
| Zephyr border router sample | Any Zephyr-supported 802.15.4 board | In-tree sample; good for custom deployments |

OTBR uses a Radio Co-Processor (RCP) architecture: the nRF52840 runs only the 802.15.4 MAC layer and streams raw frames to the Raspberry Pi over UART or SPI. The Pi runs the 6LoWPAN, Thread, and IP routing stack in user space. This separation allows the Linux host to handle complex routing, DNS-SD, and NAT64 while the radio MCU handles timing-critical MAC operations.

## 6LoWPAN Stacks

### Contiki-NG

Contiki-NG's `sicslowpan` module is the reference 6LoWPAN implementation. Configuration is compile-time:

```c
// contiki-conf.h or project-conf.h
#define SICSLOWPAN_CONF_COMPRESSION    SICSLOWPAN_COMPRESSION_IPHC
#define SICSLOWPAN_CONF_FRAG           1
#define SICSLOWPAN_CONF_FRAG_MAX_SIZE  1280
#define UIP_CONF_BUFFER_SIZE           1280
#define NBR_TABLE_CONF_MAX_NEIGHBORS   16
#define NETSTACK_CONF_MAC              csma_driver
#define NETSTACK_CONF_RADIO            nrf_ieee_driver
```

### Zephyr

Zephyr's 6LoWPAN layer is integrated into the network stack:

```kconfig
# prj.conf
CONFIG_NET_L2_IEEE802154=y
CONFIG_NET_6LO=y
CONFIG_NET_6LO_CONTEXT=y
CONFIG_IEEE802154_NRF5=y
CONFIG_NET_IPV6=y
CONFIG_NET_UDP=y
CONFIG_NET_CONFIG_MY_IPV6_ADDR="2001:db8::1"
```

### RIOT OS

RIOT uses the GNRC network stack with 6LoWPAN:

```makefile
# Makefile
USEMODULE += gnrc_netdev_default
USEMODULE += auto_init_gnrc_netif
USEMODULE += gnrc_ipv6_default
USEMODULE += gnrc_sixlowpan
USEMODULE += gnrc_sixlowpan_iphc
USEMODULE += gnrc_sixlowpan_frag
```

## Tips

- Start development with two 802.15.4 nodes and a sniffer. Wireshark with the TI CC2531 USB dongle (or nRF52840-DK in sniffer mode) decodes 6LoWPAN headers, showing both the compressed and decompressed views side by side. This makes compression behavior visible and verifiable.
- Use CoAP (not HTTP) as the application protocol over 6LoWPAN. CoAP is designed for constrained networks: binary headers (4 bytes minimum), confirmable/non-confirmable message types, and built-in content negotiation. A typical CoAP GET request fits in a single 802.15.4 frame.
- Keep application payloads under 60 bytes whenever possible to avoid fragmentation entirely. A sensor reading encoded as CBOR (e.g., `{temperature: 23.5, humidity: 45}`) fits in approximately 20 bytes. JSON encoding of the same data uses ~40 bytes.
- Select 802.15.4 channels that do not overlap with WiFi. 802.15.4 channels 15, 20, 25, and 26 fall in the gaps between WiFi channels 1, 6, and 11. Channel 26 is entirely above the WiFi band.
- Configure the reassembly timeout to match the expected fragment delivery time. On a multi-hop mesh, fragments may take 100–500 ms to traverse the network. A 2-second reassembly timeout is a reasonable starting point; the default 20 seconds wastes buffer memory on lost-cause reassemblies.

## Caveats

- **Fragment loss is catastrophic** — If any single fragment of a datagram is lost, all fragments must be retransmitted. There is no selective retransmission at the 6LoWPAN layer. Link-layer ACKs (802.15.4 frame ACKs) help, but they only cover single-hop reliability. On a multi-hop mesh, an intermediate node might successfully receive and forward fragment 1 but drop fragment 3 due to congestion.
- **Reassembly buffers are prime targets for memory exhaustion** — A malicious or misconfigured node that sends first fragments without completing the datagram ties up reassembly buffers on the receiver. With only 2–4 reassembly slots, this effectively denies service. Aggressive reassembly timeouts (2–5 seconds) and rate limiting mitigate the risk.
- **Compression context must be consistent across all nodes** — If the border router uses compression context ID 0 for prefix `2001:db8:1::/48` but a node has a different mapping, packets will be decompressed with the wrong prefix. Context provisioning is manual in most stacks and must be synchronized during commissioning.
- **Not all 802.15.4 radios expose the same features** — Some radios support automatic CCA and ACK generation in hardware; others require software handling. Frame pending bit behavior (critical for sleepy end device polling) varies by radio. The choice of radio silicon affects 6LoWPAN stack performance more than the stack software itself.
- **The 250 kbps data rate is shared among all nodes** — With CSMA-CA, effective network capacity drops as node count increases. A network of 50 nodes each sending a 100-byte reading every 10 seconds uses ~4 kbps aggregate — well within capacity. But firmware updates (100 KB images) sent to all nodes sequentially can saturate the network for minutes.

## In Practice

- A 6LoWPAN temperature sensor network with 20 nodes reporting every 60 seconds generates minimal traffic — roughly 40 bytes per reading (IPHC-compressed CoAP with CBOR payload). At 250 kbps, each transmission occupies the channel for ~1.3 ms. Channel utilization stays below 0.1%, leaving ample capacity for retransmissions and management traffic.
- Wireshark packet captures from a 6LoWPAN network show the compression working in real time: the 802.15.4 frame carries a 5–7 byte 6LoWPAN header, and Wireshark's protocol dissector displays the reconstructed full IPv6 header alongside. Comparing the two makes the compression savings concrete.
- Deploying firmware updates over 6LoWPAN requires careful fragmentation management. A 100 KB firmware image at 80 bytes per fragment generates ~1,250 fragments per node. With link-layer retransmissions and CSMA-CA backoff, a single node update takes 30–120 seconds. Updating 50 nodes sequentially takes 25–100 minutes. Multicast block transfer (RFC 7959 blockwise CoAP) can parallelize this but increases collision probability.
- Border router placement determines network performance. The border router should be centrally located to minimize hop count. Each additional hop adds 5–15 ms latency and increases the probability of fragment loss. A 4-hop path has roughly 4x the latency and packet loss rate of a 1-hop path.
- Power consumption on a 6LoWPAN sleepy end device is dominated by the radio RX window during polling. An nRF52840 polling its parent every 5 seconds (200 ms RX window at 6 mA) plus transmitting one 100-byte reading every 60 seconds (2 ms TX at 6 mA) averages ~250 µA — yielding approximately 4 years on a 2000 mAh coin cell.
