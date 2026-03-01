---
title: "Firewalls & ACLs"
weight: 20
---

# Firewalls & ACLs

VLAN segmentation isolates IoT traffic at Layer 2, but without Layer 3 and Layer 4 enforcement, any device that can route between VLANs has unrestricted access. Firewalls and Access Control Lists (ACLs) enforce what traffic is permitted between IoT subnets, the enterprise network, the internet, and cloud services. The fundamental principle for IoT network security is deny-by-default: no traffic flows between VLANs unless an explicit rule permits it. This inverts the typical enterprise approach where internal networks are broadly trusted, because IoT devices — running firmware that may be months behind on patches, with limited TLS capability, and often deployed in physically accessible locations — represent a fundamentally different threat profile than managed workstations.

## Firewall Rules for IoT Subnets

A firewall positioned between IoT VLANs and the rest of the network inspects and filters traffic based on source/destination IP, port, protocol, and connection state. For IoT deployments, the firewall is typically either a dedicated appliance (pfSense, OPNsense, Fortinet) or the routing/filtering engine on a Layer 3 switch.

A baseline rule set for a three-VLAN IoT deployment (sensors on 10.100.0.0/24, actuators on 10.110.0.0/24, gateways on 10.120.0.0/24):

| # | Source | Destination | Port/Protocol | Action | Purpose |
|---|--------|-------------|---------------|--------|---------|
| 1 | 10.100.0.0/24 | 10.120.0.1 (broker) | TCP 8883 | Allow | Sensors → MQTT broker (TLS) |
| 2 | 10.110.0.0/24 | 10.120.0.1 (broker) | TCP 8883 | Allow | Actuators → MQTT broker (TLS) |
| 3 | 10.120.0.0/24 | 0.0.0.0/0 | TCP 443 | Allow | Gateways → cloud (HTTPS) |
| 4 | 10.120.0.0/24 | DNS server | UDP 53 | Allow | Gateways → DNS resolution |
| 5 | 10.100.0.0/24 | DHCP server | UDP 67-68 | Allow | Sensors → DHCP |
| 6 | 10.110.0.0/24 | DHCP server | UDP 67-68 | Allow | Actuators → DHCP |
| 7 | 10.120.0.0/24 | NTP server | UDP 123 | Allow | Gateways → time sync |
| 8 | Any IoT VLAN | Any | Any | **Deny** | Default deny — everything else blocked |

Rule order matters. Firewalls evaluate rules top-down and apply the first match. The default deny must be the last rule; placing it earlier blocks all traffic regardless of subsequent allow rules.

## ACLs on Managed Switches

Access Control Lists on Layer 3 switches provide filtering without a separate firewall appliance. Switch ACLs operate on the forwarding ASIC and filter at wire speed, unlike software firewalls that introduce latency. Two types:

- **Standard ACLs** — Filter based on source IP address only. Limited but sufficient for simple rules like "block all traffic from VLAN 100 to VLAN 200."
- **Extended ACLs** — Filter on source IP, destination IP, protocol, and port numbers. Required for rules like "allow VLAN 100 to reach 10.120.0.1 on TCP 8883 only."

```
# Extended ACL example (Cisco IOS-style)

ip access-list extended IOT-SENSORS-OUT
  permit tcp 10.100.0.0 0.0.0.255 host 10.120.0.1 eq 8883
  permit udp 10.100.0.0 0.0.0.255 host 10.100.0.1 eq 67
  deny   ip 10.100.0.0 0.0.0.255 any log

interface Vlan100
  ip access-group IOT-SENSORS-OUT in
```

The ACL is applied **inbound** on the VLAN 100 SVI, meaning it filters traffic as it leaves the sensor subnet. The `log` keyword on the deny rule generates a syslog message for every dropped packet — useful for detecting misconfigured devices or intrusion attempts, but high traffic volumes can overwhelm the switch CPU. Rate-limiting log messages to 10–50 per second prevents this.

## Ingress and Egress Filtering

- **Ingress filtering** — Applied to traffic entering a VLAN interface (from the IoT devices toward the network). This is where most IoT rules belong: restricting what IoT devices can reach.
- **Egress filtering** — Applied to traffic leaving a VLAN interface (from the network toward the IoT devices). Controls what external systems can send to IoT devices. Useful for ensuring only the MQTT broker and management station can initiate connections to actuator devices.

A complete IoT security posture requires both directions. Ingress-only filtering prevents IoT devices from reaching unauthorized destinations but does not stop an attacker on the enterprise network from scanning the IoT subnet. Egress rules on the IoT VLAN interface block inbound connection attempts from unauthorized sources.

```
# Egress ACL — restrict what can reach actuators

ip access-list extended IOT-ACTUATORS-IN
  permit tcp host 10.120.0.1 10.110.0.0 0.0.0.255 established
  permit udp host 10.110.0.1 10.110.0.0 0.0.0.255 eq 67
  deny   ip any 10.110.0.0 0.0.0.255 log

interface Vlan110
  ip access-group IOT-ACTUATORS-IN out
```

The `established` keyword permits only TCP packets that belong to an existing connection (ACK or RST flag set), meaning the actuator must initiate the connection to the broker — the broker cannot push unsolicited connections to the actuator subnet. This is a critical distinction for safety-critical actuator networks.

## Deny-by-Default Patterns

The deny-by-default model starts with all traffic blocked and adds explicit allow rules for each legitimate communication path. This is the opposite of the permit-by-default model where everything is allowed and specific threats are blocked — an approach that fails for IoT because the set of "known bad" traffic is unbounded while the set of "known good" traffic is small and well-defined.

Implementation steps:

1. **Inventory all legitimate traffic flows.** For each device class, document what it needs to communicate with, on which ports, and in which direction. A temperature sensor needs: MQTT to the broker (TCP 8883), DHCP (UDP 67-68), and optionally NTP (UDP 123). Nothing else.
2. **Write allow rules for each flow.** One rule per flow, as specific as possible — source subnet, destination host, exact port number.
3. **Add the default deny as the final rule.** With logging enabled, so rejected traffic generates visibility.
4. **Monitor denied traffic for the first 72 hours.** Firewall logs reveal legitimate flows that were missed during the inventory — firmware update checks, DNS queries, mDNS announcements, or vendor cloud connections that were not documented.

## Micro-Segmentation for IoT

Traditional VLAN-based segmentation groups devices by class (all sensors in one VLAN). Micro-segmentation pushes isolation to the individual device level:

- **Per-device ACLs** — Each switch port has a unique ACL that permits only the specific traffic that one device needs. A soil moisture sensor on port 3 is allowed to reach the MQTT broker on TCP 8883 and nothing else — not even other sensors on the same VLAN.
- **Software-defined networking (SDN)** — Platforms like Cisco DNA Center, Aruba ClearPass, or open-source solutions (OpenDaylight, ONOS) centrally manage per-device policies and push them to switches dynamically. SDN is practical for large deployments (500+ devices) where manually configuring per-port ACLs is unsustainable.
- **MAC-based VLAN assignment with RADIUS** — Devices are assigned to VLANs based on their MAC address via 802.1X MAC Authentication Bypass (MAB). Combined with per-VLAN ACLs, this provides per-device isolation without per-port configuration. Devices that fail authentication land in a quarantine VLAN with internet-only access (or no access).

Micro-segmentation is the gold standard for environments where a compromised IoT device could cause physical harm — building HVAC, industrial control, medical devices. The overhead is significant: each new device requires a policy entry, and policy databases must be maintained and audited.

## Stateful vs Stateless Filtering

- **Stateless filtering** — Each packet is evaluated independently against the ACL. A rule allowing TCP 8883 outbound also requires a corresponding rule allowing return traffic (high-numbered ephemeral ports, typically 1024–65535) inbound. Stateless ACLs are simple, fast (evaluated in hardware on managed switches), and predictable — but the need for explicit return-traffic rules makes rule sets larger and harder to maintain.
- **Stateful filtering** — The firewall tracks connection state (TCP handshake, UDP pseudo-connections). A single rule allowing outbound TCP 8883 implicitly permits the return traffic for established connections. Stateful inspection catches invalid packets (e.g., a TCP ACK with no preceding SYN), providing stronger security at the cost of maintaining a state table in memory.

For IoT deployments: use stateful filtering at the firewall (between VLANs and the internet) and stateless ACLs on managed switches (between VLANs). Switch ACLs run at wire speed in hardware; moving stateful inspection to the switch ASIC is not available on most entry-level managed switches.

**State table sizing:** A stateful firewall maintains a connection entry for each active flow. An IoT deployment with 200 sensors each maintaining one persistent MQTT connection to a broker creates 200 entries — negligible for any modern firewall. Problems arise when devices misbehave: a sensor in a reconnect loop that opens and abandons TCP connections can generate thousands of half-open entries and exhaust the firewall's state table, blocking legitimate traffic across all VLANs. Connection rate limiting (e.g., maximum 10 new connections per second per source IP) mitigates this.

## Logging and Monitoring IoT Traffic

Firewall and ACL logs are the primary visibility mechanism for IoT network behavior:

- **Denied-traffic logs** — The most immediately useful data source. Every denied packet represents either a misconfigured device (needs a rule adjustment) or an anomaly (potential compromise or malfunction). During initial deployment, denied-traffic logs are reviewed daily to refine the rule set.
- **Allowed-traffic volume baselines** — Once the rule set is stable, establishing baseline traffic volumes per device class enables anomaly detection. A temperature sensor that normally sends 500 bytes per minute suddenly transmitting 50 KB per minute indicates either a firmware bug or a compromised device exfiltrating data.
- **Syslog forwarding** — Firewall and switch logs should be forwarded to a central syslog server (rsyslog, Graylog, Elastic Stack) for aggregation and retention. Local log buffers on switches and firewalls are small (typically 512 KB–4 MB) and wrap quickly under heavy traffic.
- **NetFlow/sFlow** — For deployments with high device counts, NetFlow or sFlow records from managed switches provide per-flow traffic statistics without the overhead of full packet logging. NetFlow records include source/destination IP, ports, byte count, and timestamps — sufficient for anomaly detection and capacity planning.

A practical monitoring threshold for small-to-medium deployments: alert on any IoT device generating more than 10x its baseline traffic volume, or any IoT device attempting to contact a destination not in the allow rules.

## Common Rule Patterns

### MQTT to broker (the most common IoT firewall rule)

```
Allow  10.100.0.0/24 → 10.120.0.1 : TCP 8883  (MQTT over TLS)
Allow  10.110.0.0/24 → 10.120.0.1 : TCP 8883  (MQTT over TLS)
Deny   Any IoT       → Any         : TCP 1883  (block unencrypted MQTT)
```

Port 1883 (unencrypted MQTT) should be explicitly blocked even with a default deny rule in place. An explicit deny rule generates a log entry that identifies devices attempting unencrypted connections — usually a firmware configuration error or a device that was provisioned before TLS was enforced.

### DNS resolution

```
Allow  10.120.0.0/24 → 10.0.0.53 : UDP 53    (gateways → internal DNS)
Deny   10.100.0.0/24 → Any       : UDP 53    (sensors should not need DNS)
Deny   10.110.0.0/24 → Any       : UDP 53    (actuators should not need DNS)
```

Most constrained IoT devices use hardcoded IP addresses for broker connections and do not need DNS. Blocking DNS from sensor and actuator VLANs prevents DNS-based data exfiltration, a known attack vector where a compromised device encodes stolen data in DNS query strings.

### Firmware update access

```
Allow  10.100.0.0/24 → update.vendor.com : TCP 443  (HTTPS firmware pulls)
Allow  10.110.0.0/24 → update.vendor.com : TCP 443
```

Firmware update rules should specify the exact destination (vendor's update server IP or FQDN) rather than allowing all HTTPS traffic. Allowing unrestricted TCP 443 from IoT VLANs grants devices access to the entire internet over HTTPS — a wide-open exfiltration path.

### Management access

```
Allow  10.200.0.50 (admin workstation) → 10.100.0.0/24 : TCP 22  (SSH)
Allow  10.200.0.50 (admin workstation) → 10.110.0.0/24 : TCP 22
Deny   Any → IoT VLANs : TCP 22
```

SSH access to IoT devices should be restricted to specific management stations, not open from the entire enterprise network.

## Port-Based vs IP-Based Filtering

- **IP-based filtering** — Rules reference IP addresses and subnets. Standard approach for routed traffic between VLANs. Effective as long as devices have predictable IP addresses (static assignment or DHCP reservations). Devices that receive random DHCP addresses in a large pool can be harder to identify by IP alone.
- **Port-based filtering (Layer 4)** — Rules reference TCP/UDP port numbers. Essential for IoT because it restricts devices to specific protocols — allowing TCP 8883 and denying everything else confines a device to MQTT-over-TLS regardless of what other software might be running.
- **MAC-based filtering** — Rules reference the device's hardware MAC address. Useful at Layer 2 for pre-authentication filtering on managed switches. However, MAC addresses are trivially spoofed and should never be the sole security mechanism — they are identification, not authentication.

The strongest IoT firewall rules combine all three: source IP (subnet), destination IP (specific host), destination port (specific service), and direction. A rule like "allow 10.100.0.0/24 to 10.120.0.1 on TCP 8883 inbound on VLAN 100 SVI" is specific enough that a compromised sensor can only send MQTT packets to the broker — reducing the attack surface to MQTT-layer exploits against a single host.

## Tips

- Start with a complete deny-all rule set and add allow rules one at a time, testing each flow as it is enabled. Building rules incrementally from zero is slower than starting with permit-all and restricting, but it eliminates the class of failures where a forgotten allow-all rule buried in the rule set silently overrides every restriction.
- Use DHCP reservations (static MAC-to-IP bindings) for all IoT devices so firewall rules can reference predictable IP addresses. Without reservations, a device that gets a different IP after a DHCP renewal may fall outside the expected subnet range or match the wrong rule.
- Block outbound TCP 1883, TCP 80, and TCP 23 (Telnet) explicitly from all IoT VLANs even when a default deny exists. Explicit deny rules with logging generate alerts when a device attempts unencrypted MQTT, plaintext HTTP, or Telnet — symptoms of misconfiguration or compromise that a default deny hides.
- Keep ACL and firewall rule counts under 50 per interface for manageable auditing. Rule sets that grow beyond this threshold typically contain redundant, overlapping, or obsolete entries that create unpredictable interactions. Schedule quarterly rule reviews to prune unused rules.
- Test rules by connecting a laptop to each IoT VLAN and running `nmap` against destinations that should be blocked. Firewall rules that have never been tested with actual packets may contain errors in subnet masks, port numbers, or direction flags that only manifest when a device actually sends traffic.

## Caveats

- **Stateful firewalls that track MQTT connections may time out idle persistent connections and silently drop them.** MQTT keep-alive intervals default to 60 seconds, but many deployments set longer intervals (5–15 minutes) to conserve bandwidth on cellular links. If the firewall's TCP idle timeout (often 300–3600 seconds) is shorter than the MQTT keep-alive interval, the firewall drops the connection from its state table. The next keep-alive packet from the device is treated as an invalid packet and silently discarded. The MQTT client sees no error until the keep-alive timeout expires and triggers a reconnect — causing periodic disconnections every few minutes.
- **ACL logging on managed switches generates log traffic that consumes switch CPU.** A deny rule with logging that matches a flood of invalid traffic (e.g., a broadcast storm hitting the deny-all) can generate thousands of log entries per second. Most switch CPUs are not designed for this load, and the result is degraded forwarding performance across all VLANs — not just the one generating the denied traffic. Rate-limit log entries at the switch level.
- **Firewall rules that reference FQDNs (hostnames) instead of IP addresses resolve the hostname once and cache the result.** If the destination IP changes (e.g., a cloud broker migrating to a new IP), the firewall continues to permit traffic to the old IP and blocks traffic to the new one. DNS-based firewall rules require regular re-resolution, and the TTL behavior varies by vendor — some firewalls re-resolve every 60 seconds, others only on rule reload.
- **A device that passes all firewall rules but still cannot communicate** may be blocked by a Layer 2 ACL, port security violation, or DHCP snooping failure that operates below the firewall's visibility. Layer 2 issues do not generate firewall log entries, making them invisible to firewall-centric monitoring.

## In Practice

- **An IoT device that connects to the MQTT broker successfully for 10–20 minutes and then silently disconnects on a repeating cycle** is almost always a firewall TCP idle timeout shorter than the MQTT keep-alive interval. The fix is to either reduce the MQTT keep-alive interval to below the firewall timeout (e.g., 60 seconds) or increase the firewall's TCP idle timeout for the MQTT port.
- **A new device class deployed onto an existing IoT VLAN that works in the lab but fails in production** often indicates that the lab had a permit-all rule set while production has deny-by-default. The device needs a port or protocol that was not documented during development — commonly DNS (UDP 53) or NTP (UDP 123) — and the default deny in production blocks it.
- **A firewall rule change that was intended to affect only one IoT VLAN but disrupts traffic on an unrelated VLAN** typically results from a rule insertion at the wrong position in the rule list. Firewalls evaluate rules top-down; a broad deny rule inserted above narrower allow rules overrides them. This is the most common configuration error in IoT firewall management.
- **Traffic monitoring that shows an IoT device maintaining connections to unexpected external IP addresses** — especially on TCP 443 — indicates either an undocumented vendor cloud dependency (many commercial IoT devices phone home to vendor analytics services) or a compromised device. Capturing and analyzing a few packets with Wireshark or tcpdump on a mirror port distinguishes between the two: vendor traffic typically uses valid TLS certificates with recognizable common names, while exfiltration traffic often uses self-signed certificates or connects to IP addresses with no reverse DNS.
- **An IoT VLAN where all devices suddenly lose connectivity while the enterprise network remains unaffected** points to an ACL or firewall change that was applied to the IoT VLAN's SVI or interface. Checking the switch or firewall's configuration changelog (or running a diff against the last known-good configuration) usually identifies the offending rule within minutes.
