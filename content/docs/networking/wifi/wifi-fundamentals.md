---
title: "WiFi Fundamentals for Embedded"
weight: 10
---

# WiFi Fundamentals for Embedded

WiFi on a microcontroller is a fundamentally different engineering problem than WiFi on a laptop or phone. The same 802.11 protocol runs, but the MCU operates with 256–520 KB of SRAM instead of gigabytes, a single-core processor running at 160–240 MHz instead of multi-GHz multi-core CPUs, and a power budget measured in milliamps from a coin cell or small LiPo. The result is that theoretical 802.11n throughput of 150 Mbps has no relevance — real MCU throughput ceilings sit between 2 and 20 Mbps depending on the platform, and the practical bottleneck is almost always the TCP/IP stack, TLS overhead, or available heap, not the radio.

## 802.11 Standards in the MCU Context

Most embedded WiFi chipsets support 802.11 b/g/n on the 2.4 GHz band only. A few newer modules (ESP32-C6, some Linux SBCs) add 802.11ax (WiFi 6) or 5 GHz support, but the vast majority of deployed MCU-based devices operate on 2.4 GHz with 20 MHz channel bandwidth.

| Standard | Band | Max PHY Rate (20 MHz) | Typical MCU Throughput | Notes |
|----------|------|----------------------|----------------------|-------|
| 802.11b | 2.4 GHz | 11 Mbps | 2–5 Mbps | Legacy; high airtime per frame, slows entire BSS |
| 802.11g | 2.4 GHz | 54 Mbps | 5–12 Mbps | OFDM modulation; reasonable for most MCU tasks |
| 802.11n (HT20) | 2.4 GHz | 72 Mbps (1 SS) | 8–20 Mbps | Most common mode on ESP32, Pico W |
| 802.11n (HT40) | 2.4 GHz | 150 Mbps (1 SS) | 10–25 Mbps | Rarely used on MCUs; requires two adjacent channels |
| 802.11ax | 2.4 / 5 GHz | 143 Mbps (1 SS, HE20) | 15–40 Mbps | Only on newer SoCs; OFDMA improves dense environments |

The "Typical MCU Throughput" column reflects TCP throughput measured on real hardware with standard SDK socket APIs. The gap between PHY rate and achieved throughput comes from protocol overhead (MAC headers, ACKs, backoff), TCP/IP stack processing time, memory copy overhead, and the fact that most MCUs lack hardware TCP offload.

## 2.4 GHz vs 5 GHz

The 2.4 GHz band is the default — and often only — option for embedded WiFi. The trade-offs are significant:

| Parameter | 2.4 GHz | 5 GHz |
|-----------|---------|-------|
| Range (indoor) | 30–50 m typical | 15–25 m typical |
| Wall penetration | Better (longer wavelength) | Worse |
| Channel congestion | Severe in dense environments | Generally less crowded |
| Non-overlapping channels | 3 (1, 6, 11) | 25 (varies by regulatory domain) |
| MCU support | Universal | Rare (ESP32-C6, Linux SBCs) |
| Antenna size | ~31 mm quarter-wave | ~15 mm quarter-wave |
| Power draw | Baseline | Slightly higher for same range |

For most embedded projects, 2.4 GHz is the only practical choice. The main consequence is dealing with the crowded 2.4 GHz spectrum — three non-overlapping 20 MHz channels (1, 6, and 11 in the Americas) must be shared with every other 2.4 GHz device in range, including Bluetooth, Zigbee, microwave ovens, and baby monitors.

## 2.4 GHz Channel Layout

The 2.4 GHz ISM band spans 2.400–2.4835 GHz. Each 802.11 channel is 20 MHz wide (22 MHz including spectral mask), and channels are spaced 5 MHz apart. This overlap means that only three channels can operate simultaneously without mutual interference:

```
Channel:  1       6        11
Center:  2.412   2.437    2.462 GHz
         |--20--|  |--20--|  |--20--|
    2.401      2.423    2.426      2.448    2.451      2.473
```

Channels 2–5 overlap with channel 1. Channels 7–10 overlap with channel 6. Using channel 3 or channel 9 guarantees interference with both adjacent non-overlapping channels. Access point placement tools and spectrum analyzers (even simple ones like WiFi Analyzer on Android) reveal the channel distribution in a deployment environment.

## Association Flow

Connecting an MCU to a WiFi access point follows a well-defined state machine. Understanding each stage helps diagnose connection failures — a common source of field issues.

**Probe Phase** — The station (MCU) discovers available networks. In active scanning, the station transmits probe request frames on each channel and listens for probe responses. In passive scanning, it listens for periodic beacon frames (typically every 100 ms). Active scanning is faster (~100 ms per channel) but consumes more power. Passive scanning is required on DFS channels (5 GHz radar channels where transmitting before listening is prohibited).

**Authentication** — The station sends an authentication frame to the selected AP. Under Open System authentication (used by WPA2/WPA3), this is a two-frame exchange that always succeeds. The actual security handshake happens later. Legacy Shared Key authentication (WEP) is obsolete and not supported on modern MCUs.

**Association** — The station sends an association request containing its supported rates, capabilities (HT/VHT), and any RSN (security) information elements. The AP responds with an association response containing an Association ID (AID) and the negotiated parameters. At this point, the station is associated but cannot pass data frames.

**4-Way Handshake (WPA2-PSK / WPA3-SAE)** — The station and AP derive session keys using the preshared key (PSK) or SAE exchange. The four EAPOL frames establish the Pairwise Transient Key (PTK) for unicast traffic and the Group Temporal Key (GTK) for multicast. This step takes 20–100 ms and is where wrong-password failures appear.

**DHCP** — The station broadcasts a DHCP Discover, receives an Offer, sends a Request, and gets an Acknowledge. This adds 50–500 ms depending on server response time. Some MCUs support static IP configuration to skip DHCP entirely, saving 100–300 ms of connection time.

The complete flow from scan initiation to IP address typically takes 1–5 seconds on an MCU, depending on scan duration, AP response time, and DHCP server speed.

```
   ┌──────────┐
   │   IDLE   │
   └────┬─────┘
        │ scan()
        v
   ┌──────────┐
   │ SCANNING │──── Probe Req / Listen for Beacons
   └────┬─────┘
        │ AP found
        v
   ┌──────────────┐
   │ AUTHENTICATING│──── Auth Req → Auth Resp
   └────┬─────────┘
        │ auth OK
        v
   ┌──────────────┐
   │ ASSOCIATING  │──── Assoc Req → Assoc Resp
   └────┬─────────┘
        │ assoc OK
        v
   ┌──────────────┐
   │ 4-WAY KEYING │──── EAPOL 1/4 → 2/4 → 3/4 → 4/4
   └────┬─────────┘
        │ keys installed
        v
   ┌──────────────┐
   │ DHCP         │──── Discover → Offer → Request → Ack
   └────┬─────────┘
        │ IP assigned
        v
   ┌──────────────┐
   │ CONNECTED    │──── Data frames flow
   └──────────────┘
```

## Platform Comparison

Four platforms cover most embedded WiFi use cases. Their capabilities differ dramatically in RAM, throughput, TLS support, and power characteristics.

| Feature | ESP32 (ESP-IDF) | Pico W (CYW43439) | ATWINC1500 | Linux SBC (RPi) |
|---------|----------------|--------------------|------------|-----------------|
| Architecture | Xtensa LX6 dual-core 240 MHz | Cortex-M0+ 133 MHz + external radio | Network coprocessor (Cortex-M0) | Cortex-A53/A72 1.5 GHz |
| SRAM for WiFi | ~50 KB heap used by WiFi/LWIP | ~20 KB for CYW43 driver | Offloaded to ATWINC chip | Managed by Linux kernel |
| Total SRAM | 520 KB | 264 KB | N/A (host MCU dependent) | 1–8 GB DDR |
| Max TCP Throughput | 15–20 Mbps | 5–8 Mbps | 2–4 Mbps | 50–90 Mbps |
| WiFi Standards | 802.11 b/g/n | 802.11 b/g/n | 802.11 b/g/n | 802.11 b/g/n/ac (model dependent) |
| TLS Support | mbedTLS (hardware AES) | mbedTLS (software) | On-chip TLS 1.2 | OpenSSL (hardware varies) |
| TLS Heap Cost | ~40–60 KB | ~30–50 KB | Offloaded | Negligible (OS managed) |
| SoftAP | Yes (STA+AP concurrent) | Yes (limited) | Yes | Yes (hostapd) |
| WPA3-SAE | Yes (ESP-IDF 4.3+) | No (as of SDK 1.5) | No | Yes (wpa_supplicant 2.10+) |
| Power (Active TX) | 180–240 mA | 130–180 mA | 180–230 mA (coprocessor) | 500–1200 mA (full board) |
| Power (Modem Sleep) | 20–30 mA | ~25 mA | 900 uA (standby) | N/A (OS always running) |
| Deep Sleep | 10 uA (RTC only) | 0.8 mA (dormant) | 100 uA (power-down) | N/A |
| RTOS Integration | FreeRTOS native | Bare-metal or FreeRTOS | Bare-metal callback | Linux (not RTOS) |

**ESP32 (ESP-IDF)** is the most capable MCU WiFi platform. The dual-core architecture allows dedicating one core to WiFi/networking while the application runs on the other. Hardware AES acceleration makes TLS operations significantly faster than software-only implementations. The WiFi driver consumes approximately 50 KB of heap, and a TLS connection adds another 40–60 KB — leaving roughly 200 KB for application use on a base ESP32 with 520 KB SRAM.

**Pico W (CYW43439)** uses an external Infineon radio connected via SPI. The CYW43 driver runs on the host RP2040 and handles association, security, and power management. Throughput is limited by the SPI bus speed between the RP2040 and the CYW43439 (~30 Mbps SPI clock, but protocol overhead reduces effective data rate). The Pico W is a cost-effective option (~$6 USD) for low-throughput IoT tasks.

**ATWINC1500** is a network coprocessor — the WiFi stack, TCP/IP, and even TLS run on the ATWINC chip itself. The host MCU communicates via SPI commands ("connect to this SSID", "send this HTTP request"). This offloads RAM and CPU requirements from the host but limits flexibility — custom TCP behaviors, raw sockets, and advanced TLS configurations are not possible. Maximum throughput is around 2–4 Mbps.

**Linux SBCs** (Raspberry Pi, BeagleBone) run a full `wpa_supplicant` stack with kernel WiFi drivers. This provides the most flexibility and highest throughput but at drastically higher power consumption (500–1200 mA for the full board) and cost. Appropriate for gateways, dashboards, and prototypes — not for battery-powered sensor nodes.

## Throughput Reality Check

The single most important number to internalize: **real MCU WiFi throughput is 5–15% of the PHY rate**. An 802.11n link negotiating at 72 Mbps PHY rate delivers 8–12 Mbps of TCP throughput on an ESP32. Adding TLS drops this further to 4–8 Mbps depending on cipher suite. With MQTT over TLS, effective application throughput for sensor telemetry is typically 1–3 Mbps — more than enough for most IoT workloads, but far from the headline spec.

Factors that reduce throughput from PHY rate to application throughput:

1. **MAC overhead** — Every data frame includes a 30-byte MAC header, 4-byte FCS, and requires a 10-byte ACK frame. Short payloads (sensor readings) have poor payload efficiency.
2. **TCP/IP stack processing** — LWIP on a 240 MHz Xtensa core processes packets at roughly 15–20 Mbps. This is the ceiling.
3. **Memory copies** — Data moves from radio DMA buffer to LWIP to application buffer. Each copy costs cycles and bus bandwidth.
4. **TLS encryption** — AES-128-GCM at 240 MHz (hardware accelerated) can process ~50 MB/s. Without hardware acceleration (Pico W), this drops to ~5 MB/s, becoming the bottleneck.
5. **Application serialization** — JSON encoding, CBOR packing, or protocol buffer serialization adds CPU overhead before data even reaches the network stack.

## Tips

- Match antenna type to the enclosure design early. A PCB trace antenna (inverted-F, meander) is free but needs a ground plane clearance zone. A ceramic chip antenna (2 mm x 1.2 mm) is compact but loses 2–3 dBi versus a quarter-wave whip. An external antenna with U.FL connector adds cost but allows placement outside a metal enclosure.
- Set throughput expectations based on the platform, not the PHY rate. Budget for 8–12 Mbps on ESP32, 4–6 Mbps on Pico W, and 2–3 Mbps on ATWINC1500 for TCP workloads. For TLS, halve those numbers as a starting estimate.
- Run a simple `iperf3` test between the MCU and a wired server early in the project to establish baseline throughput. ESP-IDF includes an iperf example. Compare against these baselines when debugging performance issues later.
- On the 2.4 GHz band, always configure the AP (or the MCU's SoftAP) to use channel 1, 6, or 11. Selecting any other channel creates overlapping interference with two adjacent non-overlapping channels.
- For battery-powered designs, the WiFi radio draw (150–250 mA active) dominates the power budget. Consider whether the application can tolerate a duty-cycled connection (connect, transmit, disconnect, deep-sleep) rather than maintaining a persistent link.

## Caveats

- **Advertised throughput figures from chip vendors are best-case** — Espressif's documentation cites 20 Mbps TCP throughput for ESP32, measured with iperf on a clean channel with a nearby AP. In a production environment with competing traffic, multipath reflections, and background scanning, 8–12 Mbps is more realistic.
- **Channel congestion is the dominant cause of WiFi issues in dense deployments** — In an apartment building or trade-show floor, dozens of APs and hundreds of clients share three non-overlapping channels. Retry rates climb, throughput drops, and association times increase. There is no firmware fix for a saturated RF environment.
- **The hidden node problem causes frame collisions that RTS/CTS only partially mitigates** — Two stations that cannot hear each other (behind obstacles) can transmit simultaneously, colliding at the AP. RTS/CTS handshaking adds overhead (4 extra frames per data exchange) and is not always implemented in MCU WiFi stacks.
- **Beacon loss detection is the primary cause of unexpected disconnections** — If the station misses N consecutive beacons (typically 7–10, configurable), it declares the AP unreachable and triggers a disconnection event. In noisy environments, beacon loss happens even when data frames are flowing normally because beacons are sent at the lowest data rate (1 or 6 Mbps) and can collide with other traffic.
- **Multipath and co-channel interference change with the physical environment** — A device that works reliably on the bench may fail in a metal enclosure, near a concrete wall, or on a shelf between two microwave ovens. RF site surveys with a spectrum analyzer or even a laptop WiFi diagnostic tool prevent surprises in production deployments.

## In Practice

- A device that connects reliably on the bench but drops its connection every few hours in a customer's home is likely experiencing channel congestion or beacon loss. Adding reconnection logic with exponential backoff and logging the disconnect reason code (available in ESP-IDF's `wifi_event_sta_disconnected_t`) reveals whether the cause is AP-initiated deauth, beacon timeout, or authentication failure.
- A throughput test that shows 12 Mbps with iperf but only 500 Kbps in the actual application suggests the bottleneck is in application-layer processing — JSON serialization, excessive per-message TLS handshakes (use persistent connections), or blocking socket operations on the main task.
- An ESP32 project that runs out of heap after adding a TLS connection is typically allocating the default 16 KB + 16 KB TLS input/output buffers. Reducing these to 4 KB + 4 KB (`MBEDTLS_SSL_IN_CONTENT_LEN` and `MBEDTLS_SSL_OUT_CONTENT_LEN` in sdkconfig) works for payloads under 4 KB and recovers ~24 KB of heap.
- A Pico W application that achieves lower throughput than expected should check whether the SPI clock to the CYW43439 is configured at maximum rate and whether the application is performing blocking operations that stall the CYW43 poll loop.
- A device that consistently fails to associate with a specific AP model but works with others may be encountering a rate-negotiation incompatibility. Forcing 802.11g-only mode (disabling HT capabilities) is a common workaround for compatibility issues with older or non-standard access points.
