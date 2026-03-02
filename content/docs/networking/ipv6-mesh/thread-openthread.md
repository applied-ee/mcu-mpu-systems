---
title: "Thread & OpenThread"
weight: 30
---

# Thread & OpenThread

Thread is a mesh networking protocol built on 802.15.4 and 6LoWPAN, designed specifically for reliable, secure, low-power device-to-device communication in buildings. Where 6LoWPAN provides the compression and fragmentation layer, Thread adds mesh routing, self-healing topology management, device roles, and a complete security model. The result is an IP-based mesh network where every node has a routable IPv6 address and the network reconfigures itself when nodes join, leave, or fail.

OpenThread is Google's open-source implementation of Thread, licensed under BSD-3. It runs on all major 802.15.4 platforms (nRF52840, CC2652, EFR32, ESP32-H2) and serves as the reference implementation for Thread certification.

## Thread Network Topology

A Thread network is a mesh of routers with end devices attached to individual routers. The topology self-organizes based on link quality measurements and network needs.

### Device Roles

| Role | Description | Can Route | Can Sleep | Max per Network |
|------|-------------|-----------|-----------|-----------------|
| Leader | Elected router that manages router ID assignment and network data | Yes | No | 1 |
| Router | Full mesh participant; forwards packets for other devices | Yes | No | 32 |
| REED (Router-Eligible End Device) | End device that can promote to Router if needed | No (until promoted) | No | Unlimited |
| End Device (FED) | Full-power device attached to a single parent router | No | No | Unlimited |
| Sleepy End Device (SED) | Battery-powered device that polls its parent for messages | No | Yes | Unlimited |

The distinction between Router, REED, and End Device is critical for power budgets:

- **Routers** must keep their radios on continuously to forward messages. Current draw is 5–10 mA average (radio RX), making battery operation impractical. Routers are typically mains-powered.
- **SEDs** only wake to poll their parent router and transmit data. Average current draw of 10–50 µA is achievable with polling intervals of 2–10 seconds.
- **REEDs** operate as end devices but promote to routers when the network needs additional routing capacity (e.g., when a router fails or a new area of the building needs coverage).

### Topology Diagram

```
        ┌──────────┐
        │  Leader   │
        │ (Router)  │
        └──┬────┬───┘
           │    │
     ┌─────┘    └─────┐
     │                 │
┌────┴────┐      ┌────┴────┐
│ Router  │      │ Router  │
│         │      │         │
└─┬──┬──┬─┘      └──┬──┬───┘
  │  │  │            │  │
  │  │  └──┐    ┌────┘  │
  │  │     │    │       │
 SED FED  REED SED    ┌┴────────┐
                       │ Router  │
                       └──┬──┬───┘
                          │  │
                         SED SED
```

The maximum of 32 active routers per Thread network is an intentional design constraint. The mesh routing table grows quadratically with router count, and 32 routers provide sufficient coverage for most building-scale deployments (each router covers ~10 m radius indoors). More endpoints are accommodated as end devices attached to these 32 routers, with a practical network limit of approximately 250 total devices.

## Mesh Link Establishment (MLE)

MLE is Thread's neighbor discovery and link management protocol. It operates at the mesh layer, above 802.15.4 MAC and below IPv6 routing.

### Link Quality Assessment

Each router continuously measures link quality to its neighbors using four metrics:

| Metric | Source | Purpose |
|--------|--------|---------|
| RSSI | Radio hardware | Raw signal strength (dBm) |
| LQI | Radio hardware | Link Quality Indicator (vendor-specific, 0–255) |
| Frame error rate | MAC counters | Percentage of frames requiring retransmission |
| Link margin | Computed | RSSI minus receiver sensitivity; indicates fade margin |

Link quality is quantified as a 3-bit value (0–3):

| Link Quality | Meaning | Typical Link Margin |
|--------------|---------|-------------------|
| 0 | Unknown or unusable | < 2 dB |
| 1 | Weak | 2–10 dB |
| 2 | Good | 10–20 dB |
| 3 | Excellent | > 20 dB |

Routers prefer paths with higher link quality. A 2-hop path through quality-3 links is preferred over a 1-hop path through a quality-1 link.

### Router Selection and Promotion

When a REED determines that the network needs an additional router (based on the REED's connectivity to existing routers and the Leader's router count threshold), it sends a Router ID Request to the Leader. The Leader assigns a Router ID (RLOC16) and the REED promotes to Router status. This process takes 1–3 seconds.

Demotion works in reverse: a Router with no children and redundant connectivity may demote to REED to conserve the 32-router limit for areas that need it.

## Addressing

Thread uses several address types, all IPv6:

| Address | Format | Purpose |
|---------|--------|---------|
| RLOC16 | `fdxx:xxxx:xxxx:xxxx:0000:00ff:fe00:RLOC16` | Routing Locator; changes if device role/parent changes |
| ML-EID | `fdxx:xxxx:xxxx:xxxx:<random 64-bit IID>` | Mesh-Local Endpoint Identifier; stable per device |
| Link-local | `fe80::<EUI-64>` | Single-hop communication |
| Global unicast | Prefix from border router + IID | End-to-end routable beyond the mesh |

The RLOC16 is a 16-bit address encoding the Router ID (6 bits) and Child ID (9 bits):

```
RLOC16 = (Router_ID << 10) | Child_ID

Router:     Router_ID = 5,  Child_ID = 0  → RLOC16 = 0x1400
Child of 5: Router_ID = 5,  Child_ID = 3  → RLOC16 = 0x1403
```

The mesh-local prefix (`fdxx:xxxx:xxxx:xxxx::/64`) is a ULA prefix generated when the network is formed and shared with all devices during commissioning.

## Routing

Thread uses a distance-vector routing protocol among routers. Each router maintains a routing table with entries for every other router in the mesh (up to 32 entries). Route costs are based on link quality:

| Link Quality | Cost |
|-------------|------|
| 3 (Excellent) | 1 |
| 2 (Good) | 2 |
| 1 (Weak) | 6 |
| 0 (Unknown) | ∞ (unusable) |

Total path cost is the sum of link costs along the route. The routing table is updated via periodic MLE Advertisement messages (every ~20 seconds) and triggered updates when topology changes.

### Anycast Routing

Thread supports anycast addressing for services. The Leader, for example, is reachable via the anycast locator `fdxx::ff:fe00:fc00`. If the Leader fails and a new Leader is elected, the anycast address automatically resolves to the new Leader without any device needing to update its configuration.

## Network Formation and Commissioning

### Forming a Network

Creating a new Thread network requires choosing several parameters:

```bash
# OpenThread CLI — form a new network
> dataset init new
> dataset commit active
> ifconfig up
> thread start

# View the generated dataset
> dataset active
Active Timestamp: 1
Channel: 15
Channel Mask: 0x07fff800
Ext PAN ID: dead00beef00cafe
Mesh Local Prefix: fd3d:b50b:f96d:722d::/64
Network Key: 00112233445566778899aabbccddeeff
Network Name: OpenThread-Demo
PAN ID: 0x1234
PSKc: 3aa55f91ca47d1e4e71a08cb35e91591
Security Policy: 672 onrc 0
```

The **Network Key** is the master secret. All devices in the mesh share this 128-bit key, and it encrypts all Thread traffic (MLE frames, data frames). Compromise of the Network Key compromises the entire network.

### Commissioning

Adding a new device to an existing Thread network uses a commissioning process:

1. **Commissioner** — An authorized device (or app) that can admit new devices. Typically runs on a phone or border router.
2. **Joiner** — The new device attempting to join.
3. **Joiner Credential** — A device-specific passphrase (the PSKd, typically printed on the device or its packaging).

```bash
# On the Commissioner (existing device in the network):
> commissioner start
Commissioner: petitioning
Commissioner: active

# Allow a specific Joiner (by EUI-64) with its PSKd:
> commissioner joiner add eui64_of_joiner J01NME

# On the Joiner (new device):
> ifconfig up
> joiner start J01NME
Join success

> thread start
```

The commissioning handshake uses DTLS with the PSKd to securely transfer the Network Key and other dataset parameters to the Joiner. An eavesdropper cannot extract the Network Key from the commissioning exchange without knowing the PSKd.

## Security Model

Thread's security is mandatory — there is no unencrypted mode.

| Layer | Mechanism | Key | Protection |
|-------|-----------|-----|------------|
| MAC (802.15.4) | AES-CCM-128 | Network Key | Encryption + integrity for all data frames |
| MLE | AES-CCM-128 | Network Key (or KEK during commissioning) | Encryption + integrity for mesh management |
| Commissioning | DTLS 1.2 | PSKd (Joiner Credential) | Secure key transfer during join |
| Application | DTLS 1.2 / CoAPS | Application-specific keys | End-to-end security (optional, used by Matter) |

### Frame Counters

Each device maintains a monotonically increasing frame counter for MAC and MLE frames. The receiver rejects any frame with a counter value less than or equal to the last accepted counter. This prevents replay attacks but introduces a persistence requirement: if a device reboots and loses its frame counter, other nodes will reject its frames until the counter catches up. Thread addresses this by requiring non-volatile storage for the frame counter, typically updated every 100–1000 increments to balance write endurance against replay window.

### Key Rotation

The Network Key can be rotated by the Leader. When a new key is distributed, devices enter a transition period where they accept frames encrypted with either the old or new key. After the transition (default: 672 hours / 28 days), the old key is discarded. Key rotation limits the exposure window if a key is compromised.

## OpenThread on nRF52840

The nRF52840-DK is the most common development platform for OpenThread. The build and flash process:

### Building

```bash
# Clone OpenThread
git clone https://github.com/openthread/ot-nrf528xx.git
cd ot-nrf528xx
git submodule update --init

# Build the CLI for nRF52840
./script/build nrf52840 USB_trans -DOT_COMMISSIONER=ON -DOT_JOINER=ON

# Output binary
ls build/bin/ot-cli-ftd  # Full Thread Device
ls build/bin/ot-cli-mtd  # Minimal Thread Device (for SEDs)
```

### Flashing

```bash
# Using nrfjprog (Nordic command-line tools)
nrfjprog -f nrf52 --eraseall
nrfjprog -f nrf52 --program build/bin/ot-cli-ftd.hex
nrfjprog -f nrf52 --reset

# Alternative: using J-Link Commander
JLinkExe -device NRF52840_XXAA -if SWD -speed 4000
> loadfile build/bin/ot-cli-ftd.hex
> r
> g
```

### CLI Interaction

The OpenThread CLI runs over UART (115200 baud) or USB CDC:

```bash
# Serial connection
screen /dev/ttyACM0 115200

# Basic commands
> state
router

> ipaddr
fd3d:b50b:f96d:722d:0:ff:fe00:fc00    # Leader anycast
fd3d:b50b:f96d:722d:0:ff:fe00:1400    # RLOC
fd3d:b50b:f96d:722d:c4a2:17db:ae31:5c1b  # ML-EID
fe80:0:0:0:d4f5:2377:8e52:be8b        # Link-local

> neighbor table
| Role | RLOC16 | Age  | Avg RSSI | Last RSSI | R | D | N |
+------+--------+------+----------+-----------+---+---+---+
|  C   | 0x1401 |    3 |      -38 |       -36 | 1 | 1 | 1 |
|  R   | 0x2800 |   12 |      -52 |       -50 | 1 | 0 | 1 |

> router table
| ID | RLOC16 | Next Hop | Path Cost | LQI In | LQI Out | Age | Extended MAC     |
+----+--------+----------+-----------+--------+---------+-----+------------------+
|  5 | 0x1400 |       63 |         0 |      3 |       3 |   0 | d6f52377ae528e8b |
| 10 | 0x2800 |        5 |         1 |      2 |       2 |  12 | a4b3c2d1e0f09876 |
```

### Zephyr Integration

Zephyr includes OpenThread as a module, integrating it with Zephyr's network stack:

```kconfig
# prj.conf
CONFIG_NETWORKING=y
CONFIG_NET_L2_OPENTHREAD=y
CONFIG_OPENTHREAD_THREAD_VERSION_1_3=y
CONFIG_OPENTHREAD_NORDIC_LIBRARY_MASTER=y
CONFIG_OPENTHREAD_FTD=y
CONFIG_OPENTHREAD_COMMISSIONER=y
CONFIG_OPENTHREAD_JOINER=y
CONFIG_OPENTHREAD_SLAAC=y
CONFIG_NET_SOCKETS=y
CONFIG_NET_UDP=y
CONFIG_NET_TCP=y
```

```c
// Zephyr application using OpenThread + sockets
#include <zephyr/net/openthread.h>
#include <zephyr/net/socket.h>

void send_coap_reading(float temperature)
{
    int sock = zsock_socket(AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
    struct sockaddr_in6 addr = {
        .sin6_family = AF_INET6,
        .sin6_port = htons(5683),  // CoAP default port
    };
    zsock_inet_pton(AF_INET6, "fd3d:b50b:f96d:722d::1", &addr.sin6_addr);

    uint8_t coap_msg[32];
    int len = encode_coap_post(coap_msg, sizeof(coap_msg),
                                "temperature", temperature);
    zsock_sendto(sock, coap_msg, len, 0,
                 (struct sockaddr *)&addr, sizeof(addr));
    zsock_close(sock);
}
```

## Performance Characteristics

| Metric | Typical Value | Notes |
|--------|--------------|-------|
| Single-hop throughput | 40–80 kbps | UDP, unencrypted payload measurement |
| End-to-end throughput (4 hops) | 15–30 kbps | Throughput decreases roughly linearly with hop count |
| Single-hop latency | 5–15 ms | Includes CSMA-CA backoff and MAC ACK |
| Per-hop latency | 10–50 ms | Higher under load or weak links |
| End-to-end latency (4 hops) | 40–200 ms | Depends on hop count and congestion |
| Network formation time | 5–15 seconds | Leader election + router promotion |
| Join time (commissioning) | 8–20 seconds | DTLS handshake + dataset transfer |
| Max active routers | 32 | Protocol limit |
| Practical max nodes | ~250 | Including all end devices |
| Router RAM usage (OpenThread) | ~30–50 KB | Includes routing table, neighbor table, message buffers |
| SED RAM usage (OpenThread) | ~20–30 KB | Reduced tables, fewer buffers |

## Thread 1.3 Features

Thread 1.3 (released 2022) added several features relevant to embedded development:

| Feature | Description |
|---------|-------------|
| Service Registration Protocol (SRP) | Devices register services with a border router's SRP server; enables DNS-SD discovery from external networks |
| Multicast across border routers | Multicast messages can traverse between Thread and infrastructure networks |
| Thread Commercial Extensions (TCE) | Large-scale network management, backbone routers for multi-hop backbone links |
| Coordinated Sampled Listening (CSL) | Improved latency for sleepy devices; parent knows when child is listening |

CSL is particularly important for battery-powered devices that need responsive communication. Without CSL, a message to a SED waits until the SED polls its parent (which could be seconds). With CSL, the parent transmits at the agreed-upon schedule, reducing message delivery latency from seconds to tens of milliseconds.

## Tips

- Start with the OpenThread CLI on two nRF52840-DKs. Form a network on one, join from the other, then verify end-to-end connectivity with `ping`. This takes about 15 minutes and validates the entire stack from radio to IPv6.
- Use the nRF Connect SDK (NCS) rather than standalone OpenThread for production projects. NCS integrates OpenThread with Zephyr, provides board-specific configurations, and includes power management optimizations that standalone OpenThread lacks.
- Set the Thread channel to avoid WiFi interference. Channel 25 or 26 (802.15.4) sit above all WiFi channels and provide the cleanest RF environment. Channel 15 and 20 fall between WiFi channels 1, 6, and 11.
- Monitor the router table and neighbor table periodically in development. Unexpected topology changes (a router demoting, a child re-attaching to a different parent) often indicate marginal link quality. The `router table` and `neighbor table` CLI commands show current RSSI and link quality.
- Size the message buffer pool for the application's traffic pattern. OpenThread defaults to a conservative buffer count; increasing `OPENTHREAD_CONFIG_NUM_MESSAGE_BUFFERS` prevents message drops under burst traffic but costs ~128 bytes per buffer.

## Caveats

- **The 32-router limit is a hard protocol constraint** — A network that needs more than 32 routing devices requires either restructuring the deployment (using end devices where possible) or partitioning into multiple Thread networks bridged by backbone routers (Thread 1.3).
- **Sleepy End Devices trade latency for power** — A SED polling every 5 seconds has up to 5 seconds of message delivery latency. For actuators (door locks, light switches) that need sub-second response, either reduce the poll period (increasing power consumption) or use CSL (Thread 1.3).
- **Frame counter persistence is a real problem** — If a device loses its frame counter after a crash or power loss, its messages are rejected by all neighbors until the counter exceeds the last-seen value. OpenThread mitigates this by storing the counter in flash every N increments, but the flash write endurance (~100K cycles on most MCU flash) bounds how frequently this can occur. External FRAM (unlimited write endurance) is a robust solution for high-reliability deployments.
- **Network Key exposure compromises all traffic** — Thread uses a single network-wide key. There is no per-device encryption at the mesh layer (application-layer encryption like DTLS/CoAP provides per-device security). Physical extraction of the network key from one device (via JTAG or flash dumping) compromises the entire mesh unless the key is rotated.
- **OpenThread's RAM footprint makes it impractical on very small MCUs** — At 30–50 KB of RAM for a router, OpenThread is not viable on Cortex-M0 devices with 16–32 KB SRAM. The practical minimum is a Cortex-M4 with 64+ KB SRAM (e.g., nRF52840's 256 KB is comfortable).

## In Practice

- A Thread-based smart home deployment with 15 devices (8 light bulbs as routers, 4 door/window sensors as SEDs, 2 thermostats as end devices, 1 border router) forms a stable mesh within 30 seconds of power-on. The light bulbs are ideal routers — they are mains-powered, distributed throughout the building, and the ~6 mA continuous radio RX current is negligible compared to the LED driver's power consumption.
- Debugging a Thread network where devices intermittently lose connectivity often reveals a marginal link (link quality 1) that oscillates between usable and unusable. The `neighbor table` RSSI values show the issue: links with RSSI between -85 and -95 dBm (near receiver sensitivity of -100 dBm) are unreliable. Moving a device 1–2 meters or adding a router to shorten the path resolves the problem.
- A production firmware that uses OpenThread on nRF52840 with Zephyr typically allocates 180–220 KB flash (OpenThread + Zephyr kernel + drivers + application) and 80–120 KB RAM (OpenThread ~40 KB + Zephyr kernel ~15 KB + application ~25 KB + stack space). This leaves 800 KB flash and 130 KB RAM available on the 1 MB / 256 KB nRF52840 — ample for most applications.
- Commissioning at scale (100+ devices) requires automation. The OpenThread Commissioner API allows programmatic joiner admission. A production commissioning tool scans device QR codes (containing the EUI-64 and PSKd), connects to the Commissioner via the border router's REST API, and admits each device in sequence. The bottleneck is the DTLS handshake (~10 seconds per device).
- Power measurements on an nRF52840 SED with a 5-second poll interval show: 1.5 µA sleep current, 6 mA for ~3 ms during each poll (radio TX + RX), yielding an average of ~5 µA. On a CR2032 coin cell (225 mAh), this provides approximately 5 years of battery life — though the transmit bursts must be accounted for in cell chemistry selection (CR2032 delivers ~15 mA peak comfortably, but struggles above 30 mA).
