---
title: "IPv6 on Embedded Devices"
weight: 10
---

# IPv6 on Embedded Devices

IPv4 was never designed for billions of endpoints, and the workarounds — NAT, port forwarding, application-layer gateways — impose complexity that embedded devices should not carry. IPv6 eliminates NAT entirely. Every device gets a globally routable 128-bit address, end-to-end reachability becomes the default, and Stateless Address Autoconfiguration (SLAAC) removes the dependency on a DHCP server. For a sensor node behind three layers of NAT, the difference is fundamental: IPv6 means the device is addressable from anywhere without tunneling hacks.

The cost is not trivial on constrained hardware. A dual-stack IPv4/IPv6 implementation adds 5–10 KB of RAM to the TCP/IP stack, and the larger header (40 bytes vs 20 bytes for IPv4) reduces payload efficiency on every frame. But the trade-off increasingly favors IPv6 as cloud platforms, Thread networks, and 6LoWPAN all assume native IPv6 operation.

## IPv6 Address Architecture

Every IPv6 address is 128 bits, written as eight groups of four hex digits separated by colons. Leading zeros within a group are omitted, and a single contiguous run of all-zero groups collapses to `::`.

### Address Types

| Type | Prefix | Scope | Purpose |
|------|--------|-------|---------|
| Link-local | `fe80::/10` | Single link only | Neighbor discovery, router solicitation; always present |
| Global unicast (GUA) | `2000::/3` | Internet-wide | Routable address assigned via SLAAC or DHCPv6 |
| Unique local (ULA) | `fd00::/8` | Site-local (not routed globally) | Private networks, similar role to 10.x.x.x in IPv4 |
| Multicast | `ff00::/8` | Varies by scope bits | Group communication; replaces broadcast |
| Loopback | `::1/128` | Host only | Same role as 127.0.0.1 |

Link-local addresses deserve special attention on embedded devices. Every IPv6-capable interface automatically generates a link-local address — no router needed, no configuration required. Two devices on the same Ethernet segment or 802.15.4 PAN can exchange packets using only their `fe80::` addresses. This makes link-local the reliable fallback for commissioning, debugging, and local control.

### Multicast Addresses Used on Embedded Networks

| Address | Name | Usage |
|---------|------|-------|
| `ff02::1` | All nodes | Replaces IPv4 broadcast |
| `ff02::2` | All routers | Router discovery |
| `ff02::1:ff00:0/104` | Solicited-node | Neighbor discovery (replaces ARP) |
| `ff02::fb` | mDNS | Service discovery |
| `ff05::fd` | All MLDv2 routers | Multicast listener reports |

## Interface Identifier Generation

The 64-bit interface identifier (IID) that forms the lower half of an IPv6 address can be derived from the hardware MAC address or generated randomly.

### EUI-64 from MAC Address

A 48-bit MAC address is converted to a 64-bit EUI-64 by inserting `FF:FE` in the middle and flipping the universal/local (U/L) bit:

```
MAC:    AA:BB:CC:DD:EE:FF
        ↓
Insert: AA:BB:CC:FF:FE:DD:EE:FF
        ↓
Flip U/L bit (bit 1 of first byte):
        A8:BB:CC:FF:FE:DD:EE:FF
        ↓
Link-local: fe80::a8bb:ccff:fedd:eeff
```

EUI-64 makes addresses deterministic and predictable — useful for embedded devices that need stable addresses across reboots without persistent storage. The downside is that the MAC address is embedded in every packet, enabling device tracking.

### Privacy Extensions (RFC 4941)

Privacy extensions generate random interface identifiers that change periodically. On Linux SBCs and some RTOS stacks (Zephyr with `CONFIG_NET_IPV6_PE_ENABLED=y`), this is the default for global addresses. On constrained MCUs, the RAM cost of maintaining multiple addresses (one stable, one temporary) and the complexity of address rotation typically make EUI-64 the better choice.

## Stateless Address Autoconfiguration (SLAAC)

SLAAC eliminates the need for a DHCP server. The process involves four steps:

1. **Link-local generation** — The interface creates a `fe80::` address from its MAC (EUI-64) or a random IID.
2. **Duplicate Address Detection (DAD)** — The node sends a Neighbor Solicitation to its own tentative address. If no response arrives within ~1 second, the address is unique.
3. **Router Solicitation (RS)** — The node sends an RS to `ff02::2` (all routers).
4. **Router Advertisement (RA)** — A router responds with prefix information (e.g., `2001:db8:1::/64`), the default gateway address, MTU, and flags indicating whether DHCPv6 is available for additional configuration.

The node combines the advertised prefix with its interface ID to form a global unicast address. No server state, no lease renewals, no DHCP relay agents.

```
Router Advertisement:
  Prefix: 2001:db8:abcd:1::/64
  Flags:  A=1 (autonomous), L=1 (on-link)

Node generates:
  GUA: 2001:db8:abcd:1:a8bb:ccff:fedd:eeff/64
```

### SLAAC vs DHCPv6 on Embedded

| Aspect | SLAAC | DHCPv6 |
|--------|-------|--------|
| Address assignment | Automatic from RA prefix + IID | Server assigns specific address |
| DNS configuration | Via RA (RDNSS option, RFC 8106) | Via DHCPv6 options |
| RAM cost | Minimal (part of NDP) | Additional client state (~2–4 KB) |
| Server required | No (just a router) | Yes |
| Typical embedded use | Default on most RTOS stacks | Rare; used when central address management is required |

## Neighbor Discovery Protocol (NDP)

NDP replaces ARP, ICMP Router Discovery, and ICMP Redirect from IPv4. It runs over ICMPv6 and uses five message types:

| Message | ICMPv6 Type | Purpose |
|---------|-------------|---------|
| Router Solicitation (RS) | 133 | Node requests router information |
| Router Advertisement (RA) | 134 | Router announces prefixes and parameters |
| Neighbor Solicitation (NS) | 135 | Address resolution (replaces ARP) + DAD |
| Neighbor Advertisement (NA) | 136 | Response to NS |
| Redirect | 137 | Router informs node of a better next hop |

On constrained devices, the NDP neighbor cache size directly affects RAM usage. Each entry stores a 128-bit address, a 48-bit MAC, state flags, and timers — roughly 40–60 bytes per neighbor. Zephyr defaults to `CONFIG_NET_IPV6_MAX_NEIGHBORS=8`, which is sufficient for most embedded scenarios but may need increasing on a border router handling many mesh nodes.

## RAM and Flash Cost of IPv6

Adding IPv6 to an embedded TCP/IP stack is not free. The costs vary by implementation:

| Stack | IPv4-only Flash | IPv6-added Flash | IPv4-only RAM | IPv6-added RAM |
|-------|----------------|-----------------|---------------|----------------|
| lwIP (ESP32) | ~80 KB | +25–35 KB | ~30 KB | +5–10 KB |
| Zephyr net stack | ~60 KB | +20–30 KB | ~20 KB | +8–12 KB |
| RIOT GNRC | ~40 KB | +15–25 KB | ~15 KB | +6–8 KB |
| Linux (kernel) | N/A (always present) | N/A | N/A | ~2 KB per socket |

The additional RAM comes from the neighbor cache, prefix list, router list, multicast group memberships, and the larger address structures (128-bit vs 32-bit). On a device with 256 KB SRAM, the 5–10 KB IPv6 overhead is manageable. On a device with 32 KB SRAM, it may be the deciding factor.

### Dual-Stack vs IPv6-Only

Dual-stack (running both IPv4 and IPv6 simultaneously) is the safe default when the network infrastructure supports both protocols. The cost is additive — both stacks consume RAM and flash independently. On highly constrained devices (< 64 KB SRAM), running IPv6-only eliminates IPv4 overhead entirely, but requires that all network peers and cloud endpoints support IPv6.

Thread and 6LoWPAN networks are IPv6-only by design. A border router handles translation to IPv4 networks if needed.

## Practical IPv6 on Common Platforms

### ESP32 with ESP-IDF (lwIP)

IPv6 is enabled in `menuconfig` under Component config → LWIP → Enable IPv6:

```c
// sdkconfig settings
CONFIG_LWIP_IPV6=y
CONFIG_LWIP_IPV6_AUTOCONFIG=y
CONFIG_LWIP_IPV6_NUM_ADDRESSES=3

// Application code — wait for IPv6 address
static void event_handler(void *arg, esp_event_base_t event_base,
                          int32_t event_id, void *event_data)
{
    if (event_base == IP_EVENT && event_id == IP_EVENT_GOT_IP6) {
        ip_event_got_ip6_t *event = (ip_event_got_ip6_t *)event_data;
        ESP_LOGI(TAG, "Got IPv6 address: " IPV6STR,
                 IPV62STR(event->ip6_info.ip));
    }
}

// Create an IPv6 TCP socket
int sock = socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP);
struct sockaddr_in6 dest = {
    .sin6_family = AF_INET6,
    .sin6_port = htons(8080),
};
inet6_pton(AF_INET6, "2001:db8::1", &dest.sin6_addr);
connect(sock, (struct sockaddr *)&dest, sizeof(dest));
```

ESP32 obtains a link-local address automatically after WiFi station mode connects. A global address requires a router advertising a prefix via RA. The `IP_EVENT_GOT_IP6` event fires for each address (link-local and global).

### STM32 with Ethernet (lwIP)

STM32 parts with built-in Ethernet MAC (STM32F4x7, STM32F7xx, STM32H7xx) use lwIP through STM32CubeMX integration:

```c
// In lwipopts.h
#define LWIP_IPV6                   1
#define LWIP_IPV6_AUTOCONFIG        1
#define LWIP_IPV6_MLD               1
#define LWIP_ICMP6                  1
#define LWIP_IPV6_NUM_ADDRESSES     3
#define MEMP_NUM_MLD6_GROUP         4

// After netif is up, create link-local address
netif_create_ip6_linklocal_address(&gnetif, 1); // 1 = from MAC
netif_ip6_addr_set_state(&gnetif, 0, IP6_ADDR_TENTATIVE);

// ping6 from a Linux host to verify
// $ ping6 -I eth0 fe80::xxxx:xxff:fexx:xxxx
```

The link-local address is usable for bench testing immediately. Connecting to the broader IPv6 internet requires a router or manually assigning a global address.

### Zephyr RTOS

Zephyr has first-class IPv6 support, often used with 802.15.4 and Thread:

```kconfig
# prj.conf
CONFIG_NETWORKING=y
CONFIG_NET_IPV6=y
CONFIG_NET_IPV6_NBR_CACHE=y
CONFIG_NET_IPV6_MAX_NEIGHBORS=8
CONFIG_NET_IPV6_MLD=y
CONFIG_NET_CONFIG_MY_IPV6_ADDR="2001:db8::1"
CONFIG_NET_SOCKETS=y
```

```c
// Zephyr BSD socket API — IPv6 UDP sender
#include <zephyr/net/socket.h>

int sock = zsock_socket(AF_INET6, SOCK_DGRAM, IPPROTO_UDP);
struct sockaddr_in6 addr = {
    .sin6_family = AF_INET6,
    .sin6_port = htons(4242),
};
zsock_inet_pton(AF_INET6, "2001:db8::2", &addr.sin6_addr);
zsock_sendto(sock, payload, len, 0,
             (struct sockaddr *)&addr, sizeof(addr));
```

Zephyr's network shell (`net iface show`, `net ipv6`, `net nbr`) provides real-time visibility into addresses, neighbors, and routing — invaluable during bring-up.

## IPv6 Addressing Pitfalls on Embedded

### Zone ID for Link-Local

Link-local addresses are ambiguous on multi-interface devices. A border router with both Ethernet and 802.15.4 has two `fe80::` addresses on different interfaces. The zone ID (written as `%` suffix) disambiguates:

```bash
# From a Linux host, ping a link-local address on eth0
ping6 fe80::a8bb:ccff:fedd:eeff%eth0

# Without %eth0, the kernel does not know which interface to use
ping6 fe80::a8bb:ccff:fedd:eeff
# Error: connect: Invalid argument
```

Embedded firmware that accepts link-local addresses as configuration parameters must also accept or infer the interface scope.

### DAD Failures

Duplicate Address Detection can fail if two devices generate the same interface identifier — unlikely with EUI-64 (based on unique MAC) but possible with manual configuration or cloned firmware images that hardcode addresses. A DAD failure leaves the interface without a valid address, silently breaking connectivity. Logging DAD state transitions during development catches this early.

### RA Flood Attacks

On an open network, a rogue device can send Router Advertisements with arbitrary prefixes, causing nodes to autoconfigure with attacker-controlled addresses. RA Guard (a switch feature) or SEND (Secure Neighbor Discovery, rarely implemented on MCUs) mitigate this. On controlled embedded networks, the risk is lower, but awareness matters when deploying on shared infrastructure.

## Tips

- Start with link-local addresses for bench testing. A direct Ethernet connection between a development host and an STM32 board provides immediate IPv6 connectivity without any router or infrastructure — just use `fe80::` addresses and specify the interface.
- Enable IPv6 in lwIP's `lwipopts.h` from the start of a project, even if the application only uses IPv4 initially. Retrofitting IPv6 later often uncovers buffer-size assumptions (20-byte IP header hardcoded) and socket API differences that are easier to address early.
- On ESP32, monitor heap usage before and after enabling IPv6. The `esp_get_free_heap_size()` call reveals the actual RAM cost on the running system, which may differ from the tabulated estimates depending on configuration options.
- Use `ping6` with the `-s` flag to test path MTU. Sending 1280-byte payloads (the IPv6 minimum MTU) verifies that the embedded stack handles the minimum correctly. Sending 1500-byte payloads tests fragmentation handling.
- Keep the neighbor cache small on leaf nodes. A sensor that communicates only with a border router needs `MAX_NEIGHBORS=2` (the router + one spare). Over-provisioning wastes RAM on entries that will never be populated.

## Caveats

- **IPv6 headers are twice the size of IPv4 headers** — 40 bytes vs 20 bytes. On a 127-byte 802.15.4 frame, this overhead is devastating; 6LoWPAN header compression exists specifically to address this. On Ethernet (1500-byte MTU), the extra 20 bytes are negligible.
- **Not all cloud services fully support IPv6** — While AWS IoT Core, Azure IoT Hub, and Google Cloud IoT all support IPv6, some third-party services, custom MQTT brokers, and corporate networks still operate IPv4-only. Verify IPv6 reachability to the target endpoint before committing to IPv6-only operation.
- **Multicast is not free on embedded networks** — Every `ff02::` multicast packet is received and processed by every node on the link. On a busy network with frequent NDP traffic, this creates a background processing load that affects sleep efficiency on battery-powered devices.
- **SLAAC does not provide DNS server addresses by default on older routers** — The RDNSS option (RFC 8106) was added later and not all routers advertise it. If the embedded device needs to resolve hostnames, verify that the RA includes RDNSS or configure DNS statically.
- **lwIP's IPv6 implementation has known limitations** — Flow labels are typically set to zero, extension header support is minimal, and IPsec is not implemented. For basic connectivity (TCP/UDP over IPv6), lwIP works well. For advanced IPv6 features, a full OS stack (Linux, Zephyr) is more appropriate.

## In Practice

- An ESP32 project that connects to AWS IoT Core over IPv6 sees identical MQTT performance compared to IPv4, but eliminates the NAT traversal issues that cause intermittent connection failures when the device is behind carrier-grade NAT (common in cellular deployments). The only firmware change is using an IPv6 address or AAAA DNS record for the endpoint.
- A Zephyr-based sensor network using 802.15.4 radios operates IPv6-only by design. Each sensor has a `2001:db8::/64` global address assigned via SLAAC from the border router's RA. Adding a new sensor requires no address management — it joins the PAN, receives an RA, autoconfigures, and begins transmitting CoAP readings.
- Debugging IPv6 connectivity on an STM32 board with Ethernet typically starts with verifying the link-local address (`fe80::`) is reachable from the development host via `ping6`. If that works but global addresses fail, the issue is in RA processing or router configuration, not the embedded stack itself.
- A production deployment that switches from dual-stack to IPv6-only on the device side recovers 3–5 KB of RAM (the IPv4 stack, ARP cache, and DHCP client state) — meaningful on a 128 KB SRAM part running close to its memory limit.
- Border routers that bridge 6LoWPAN mesh nodes to an Ethernet backbone need careful attention to prefix delegation. The border router must advertise the same /64 prefix on the mesh side that it routes on the Ethernet side, and it must perform NDP proxying for mesh nodes that are not directly visible to Ethernet hosts.
