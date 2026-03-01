---
title: "VLAN Segmentation"
weight: 10
---

# VLAN Segmentation

Virtual LANs (VLANs) partition a single physical network into multiple isolated broadcast domains at Layer 2. For IoT deployments, VLAN segmentation is the primary mechanism for keeping device traffic separate from enterprise systems, guest networks, and management infrastructure. Without segmentation, every device on the network shares a single broadcast domain — a compromised temperature sensor can ARP-scan the entire subnet and reach file servers, printers, and databases. IEEE 802.1Q is the standard that makes this isolation possible by inserting a 4-byte tag into Ethernet frames to identify which VLAN each frame belongs to.

## IEEE 802.1Q Tagging

The 802.1Q standard inserts a tag between the source MAC address and the EtherType field in an Ethernet frame:

| Field | Size | Purpose |
|-------|------|---------|
| TPID (Tag Protocol Identifier) | 16 bits | Always `0x8100` — identifies the frame as 802.1Q-tagged |
| PCP (Priority Code Point) | 3 bits | QoS priority level (0–7), used for traffic prioritization |
| DEI (Drop Eligible Indicator) | 1 bit | Marks frames eligible for discard under congestion |
| VID (VLAN Identifier) | 12 bits | VLAN ID, range 0–4095 (0 and 4095 reserved, usable range 1–4094) |

The 4-byte tag increases the maximum Ethernet frame size from 1518 to 1522 bytes. Network equipment that does not understand 802.1Q may drop tagged frames or misinterpret the VLAN tag as part of the payload — a common source of silent failures when mixing managed and unmanaged switches.

## Tagged vs Untagged Ports

Every port on a managed switch has a VLAN membership configuration that determines how frames are handled:

- **Access (untagged) ports** — Assigned to exactly one VLAN. Incoming frames arrive without a VLAN tag; the switch internally associates them with the port's configured VLAN. Outgoing frames have the tag stripped before transmission. IoT devices — sensors, actuators, gateways — almost always connect to access ports because most embedded Ethernet stacks do not generate 802.1Q tags.
- **Trunk (tagged) ports** — Carry traffic for multiple VLANs simultaneously. Each frame on the trunk retains its 802.1Q tag so the receiving switch can sort traffic into the correct VLAN. Trunks connect switches to other switches, routers, or hypervisors that need visibility into multiple VLANs.

**PVID (Port VLAN Identifier)** is the default VLAN assigned to untagged frames arriving on a port. On an access port, the PVID matches the port's assigned VLAN. On a trunk port, the PVID determines which VLAN receives any untagged frames that arrive on the trunk — a misconfigured PVID on a trunk is a frequent cause of traffic leaking into the wrong VLAN.

## Trunk vs Access Port Configuration

A typical managed switch (e.g., Cisco Catalyst, TP-Link TL-SG3428, Netgear GS724Tv4) exposes per-port VLAN settings:

```
# Cisco IOS-style configuration (conceptual)

# Access port — IoT sensor VLAN
interface GigabitEthernet0/1
  switchport mode access
  switchport access vlan 100

# Trunk port — uplink to core switch
interface GigabitEthernet0/24
  switchport mode trunk
  switchport trunk allowed vlan 1,100,110,120,200
  switchport trunk native vlan 1
```

On lower-cost managed switches (TP-Link, Netgear), the configuration happens through a web UI with a VLAN membership table where each port is marked as Tagged (T), Untagged (U), or Not Member (–) for each VLAN ID.

**Key rule:** A port should be Untagged in exactly one VLAN (its PVID) and Tagged in zero or more additional VLANs. A port that is Untagged in two VLANs creates ambiguity about where to place incoming untagged frames — switch behavior in this case is vendor-dependent and unreliable.

## VLAN ID Planning

A deliberate VLAN numbering scheme prevents confusion as the network grows. The following ranges represent a common planning convention for small-to-medium IoT installations:

| VLAN ID | Subnet | Purpose |
|---------|--------|---------|
| 1 | (default) | Management — switch consoles, AP management interfaces. Many switches assign all ports to VLAN 1 by default; best practice is to move production traffic off VLAN 1 entirely. |
| 100 | 10.100.0.0/24 | IoT sensors — temperature, humidity, occupancy, environmental |
| 110 | 10.110.0.0/24 | IoT actuators — relays, motor controllers, valve controllers |
| 120 | 10.120.0.0/24 | IoT gateways — protocol translators, edge aggregators |
| 200 | 10.200.0.0/24 | Enterprise / office network |
| 300 | 10.300.0.0/24 | Guest WiFi — completely isolated |
| 999 | — | Quarantine — unrecognized or misbehaving devices |

Grouping VLAN IDs by function (100-series for IoT, 200-series for enterprise) makes ACL rules and firewall policies readable. Reserving VLAN 999 for quarantine provides a safe dumping ground for devices that fail network authentication (802.1X MAC bypass failure, unknown MAC address).

## IoT Traffic Isolation Patterns

### Per-device-class segmentation

The most effective IoT VLAN strategy assigns one VLAN per device class rather than one VLAN for all IoT traffic. The rationale is lateral movement containment: if a compromised sensor shares a VLAN with actuators, the attacker can directly manipulate physical outputs.

```
VLAN 100 — Sensors (read-only devices, publish telemetry)
VLAN 110 — Actuators (receive commands, safety-critical)
VLAN 120 — Gateways (bridge between IoT VLANs and cloud)
```

Sensors on VLAN 100 publish data to an MQTT broker on VLAN 120. Actuators on VLAN 110 subscribe to command topics from the broker on VLAN 120. The firewall between VLANs enforces that sensors can only reach the broker on port 8883 (MQTT over TLS), actuators can only receive from the broker, and no direct sensor-to-actuator communication exists.

### Single IoT VLAN (simple deployments)

For deployments under 50 devices with uniform trust levels, a single IoT VLAN is simpler to manage. All IoT devices share VLAN 100 and communicate through a central broker or gateway. The tradeoff is that any compromised device has Layer 2 adjacency with every other IoT device — acceptable for a small building automation deployment, not acceptable for a hospital or industrial plant.

## Inter-VLAN Routing

Devices on different VLANs cannot communicate without a Layer 3 device (router or Layer 3 switch) that routes between the subnets. Two common approaches:

- **Router on a stick** — A single router interface connects to the switch via a trunk port. The router creates sub-interfaces, one per VLAN, and routes between them. This works for small deployments but the single trunk link becomes a bandwidth bottleneck. A trunk carrying four VLANs each generating 10 Mbps of traffic saturates a 100 Mbps link.
- **Layer 3 switch** — The switch itself performs routing between VLANs using SVI (Switched Virtual Interfaces). Each SVI is assigned an IP address that serves as the default gateway for that VLAN. Layer 3 switches route at wire speed using hardware forwarding tables (ASICs), making them the standard choice for any deployment beyond a handful of VLANs. A Cisco Catalyst 2960-L or equivalent can route between VLANs at full line rate.

```
# Layer 3 switch — SVI configuration (conceptual)

interface Vlan100
  ip address 10.100.0.1 255.255.255.0
  description IoT-Sensors

interface Vlan110
  ip address 10.110.0.1 255.255.255.0
  description IoT-Actuators

interface Vlan120
  ip address 10.120.0.1 255.255.255.0
  description IoT-Gateways
```

The SVI IP address (e.g., `10.100.0.1`) becomes the default gateway for all devices on that VLAN. DHCP scopes for each VLAN should advertise the corresponding SVI as the gateway.

## Managed Switch Configuration for IoT

Most IoT deployments use entry-level managed switches in the $100–$500 range. Configuration priorities:

1. **Disable unused ports** — Every active port is a potential entry point. Administratively shut down ports with no connected devices.
2. **Enable port security** — Limit each port to a single MAC address (or a small number for multi-port devices). Port security prevents an attacker from plugging a rogue switch into an IoT port and bridging into the VLAN.
3. **Enable DHCP snooping** — Prevents rogue DHCP servers on IoT VLANs from distributing malicious gateway addresses. Only the trusted DHCP server port is allowed to send DHCP offers.
4. **Set storm control thresholds** — IoT devices that malfunction can flood the network with broadcast traffic. Storm control at 10–20% of port bandwidth drops excess broadcast/multicast frames before they saturate the VLAN.
5. **Enable LLDP or CDP** — Link Layer Discovery Protocol helps identify what device is connected to each port, which is valuable when managing hundreds of IoT endpoints across multiple switches.

## Typical VLAN Layouts

### Small installation (1 building, <50 devices)

- 1 managed switch (24-port, e.g., TP-Link TL-SG3428)
- 2 VLANs: IoT (VLAN 100, 10.100.0.0/24) + Enterprise (VLAN 200, 10.200.0.0/24)
- Inter-VLAN routing on the firewall/router (router-on-a-stick)
- DHCP and DNS on the router or a Raspberry Pi running dnsmasq

### Medium installation (1 campus, 50–500 devices)

- Core Layer 3 switch + 2–4 edge managed switches connected via trunks
- 4–6 VLANs: sensors, actuators, gateways, enterprise, management, guest
- Inter-VLAN routing on the core Layer 3 switch
- Dedicated DHCP server with per-VLAN scopes
- 802.1X or MAC authentication bypass (MAB) for device onboarding — devices that fail authentication land on VLAN 999 (quarantine)

### Large installation (multi-site, 500+ devices)

- Stacked or chassis-based core switches with redundant trunks
- 10–20+ VLANs segmented by device type, building, and security zone
- VLAN trunking protocol (VTP) or manual VLAN provisioning across switches
- Network management system (NMS) for monitoring VLAN membership and port status
- NAC (Network Access Control) for automated VLAN assignment based on device identity

## Tips

- Assign all IoT devices static VLAN membership on access ports rather than relying on dynamic VLAN assignment from 802.1X for the initial deployment. Dynamic VLAN assignment adds complexity that is not justified until the device count exceeds what can be tracked in a spreadsheet — typically around 100–200 devices.
- Keep the default VLAN (VLAN 1) empty of production traffic. Many switches send management and control plane traffic (STP BPDUs, CDP/LLDP) on VLAN 1. Mixing IoT device traffic with control plane traffic creates unnecessary exposure.
- Use /24 subnets (254 usable addresses) for IoT VLANs unless there is a demonstrated need for more addresses. Larger subnets (/16 or /20) increase the broadcast domain size, and broadcast storms from a misbehaving IoT device affect more endpoints.
- Document the VLAN-to-subnet mapping and port assignments before deploying. A spreadsheet or network diagram that maps switch port numbers to VLAN IDs and physical device locations prevents troubleshooting sessions where half the time is spent figuring out which port a device is plugged into.
- Test VLAN isolation before connecting production devices by plugging a laptop into each VLAN and verifying that it can reach only the intended destinations. A misconfigured trunk that leaks VLAN 100 traffic into VLAN 200 is invisible until explicitly tested.

## Caveats

- **VLAN hopping attacks (802.1Q double-tagging) are possible if the native VLAN on trunk ports matches an IoT VLAN.** An attacker crafts a frame with two 802.1Q tags; the first switch strips the outer tag (matching the native VLAN), and the inner tag routes the frame to the target VLAN. Mitigation: set the native VLAN on all trunks to an unused VLAN ID (e.g., VLAN 999) that carries no production traffic.
- **Unmanaged switches inserted between a managed switch and IoT devices silently break VLAN isolation.** An unmanaged switch does not understand 802.1Q tags — it forwards all frames regardless of VLAN membership. If someone plugs an unmanaged 5-port switch into an access port to add more connections, all devices behind it share the same VLAN, but the managed switch's port security and per-port VLAN assignments no longer apply at the device level.
- **VLAN configuration drift is the most common cause of "the network was working yesterday" failures in IoT deployments.** A firmware update on the managed switch, an accidental port reconfiguration, or a cable moved to the wrong port can silently shift a device to the wrong VLAN. Without monitoring (SNMP traps, syslog alerts on VLAN changes), these issues are only discovered when devices stop reporting data.
- **Spanning Tree Protocol (STP) topology changes caused by IoT devices that rapidly cycle their Ethernet link can destabilize an entire VLAN.** Some low-power IoT devices drop the Ethernet link during sleep cycles. Each link-state change triggers an STP recalculation, which temporarily blocks ports and can cause packet loss across the VLAN. Enabling PortFast (or equivalent) on access ports connected to IoT devices suppresses STP recalculation for edge ports.

## In Practice

- **An IoT device that intermittently loses connectivity but works fine when plugged into a different port** often indicates a VLAN misconfiguration where the original port is assigned to the wrong VLAN. The device gets a DHCP address from the wrong subnet, obtains a gateway it cannot reach, and times out on every connection attempt. Moving to a correctly configured port resolves the issue immediately.
- **A deployment where all sensors report data normally but actuators never receive commands** typically points to a firewall or ACL rule that permits traffic from the sensor VLAN to the broker but blocks traffic from the broker to the actuator VLAN. The sensor-to-broker path works because it was tested, but the return path (broker-to-actuator) was never validated.
- **Broadcast storms that bring down an entire IoT VLAN but leave the enterprise network unaffected** demonstrate VLAN isolation working as intended — the storm is contained within the IoT broadcast domain. The root cause is usually a device in a boot loop that floods ARP requests or DHCP discovers every few seconds. Storm control thresholds or locating and disconnecting the offending device resolves the issue.
- **A newly installed managed switch where all IoT devices work on ports 1–12 but none work on ports 13–24** is almost always a partial VLAN configuration — the administrator configured the first 12 ports and either forgot or misconfigured the remaining ports. The ports default to VLAN 1, which has no DHCP scope and no route to the IoT broker.
