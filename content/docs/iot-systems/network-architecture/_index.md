---
title: "Network Architecture"
weight: 30
bookCollapseSection: true
---

# Network Architecture

Deploying IoT devices onto a network introduces security and traffic management concerns that do not exist when firmware runs in isolation on a bench. Production IoT networks separate device traffic from enterprise systems using VLANs, enforce access policies with firewalls and ACLs, and route data through edge gateways that handle protocol translation and local aggregation. Without deliberate network design, IoT devices become attack surfaces — flat networks where a compromised sensor can reach the corporate database are a well-documented failure pattern.

This section covers the network-level infrastructure that sits between embedded devices and the services they communicate with.

Network topology differs significantly depending on the [platform architecture]({{< relref "/docs/iot-systems/platform-architecture" >}}). Cloud deployments route device traffic through the public internet (or VPN tunnels) to cloud MQTT endpoints, requiring outbound firewall rules and TLS on every device connection. Self-hosted deployments can keep all MQTT traffic on the local network, with different segmentation and firewall patterns — the broker sits inside the perimeter rather than outside it.

## What This Section Covers

- **[VLAN Segmentation]({{< relref "vlan-segmentation" >}})** — IEEE 802.1Q tagging, tagged vs untagged ports, IoT traffic isolation patterns, inter-VLAN routing, and managed switch configuration for IoT deployments.
- **[Firewalls & ACLs]({{< relref "firewall-and-acls" >}})** — Firewall rules for IoT subnets, ACLs on managed switches, ingress/egress filtering, deny-by-default patterns, and micro-segmentation.
- **[Edge Gateway Topologies]({{< relref "edge-gateway-topologies" >}})** — Gateway placement patterns, protocol translation at the edge, local aggregation vs direct cloud connect, failover strategies, and store-and-forward for intermittent connectivity.
