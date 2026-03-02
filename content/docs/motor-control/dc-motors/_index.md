---
title: "DC Motors"
weight: 10
bookCollapseSection: true
---

# DC Motors

Brushed DC motors are the simplest electromechanical actuators in embedded work: apply a voltage and the shaft spins, reverse polarity and it spins the other way. Speed is roughly proportional to voltage, torque is proportional to current, and the motor draws whatever current the load demands up to the stall limit. That simplicity makes them easy to prototype with — but the currents involved, the inductive voltage spikes on switching, and the need for smooth speed control quickly push the design into power-electronics territory.

Controlling a brushed DC motor from a microcontroller means generating a PWM signal at an appropriate frequency, routing it through a switching element (MOSFET, H-bridge) rated for the motor's voltage and stall current, sensing current for protection and closed-loop control, and managing the back-EMF that the motor generates when it decelerates. Every stage in this chain has failure modes that don't exist in logic-level design.

## Pages

- **[PWM Speed Control]({{< relref "pwm-speed-control" >}})** — PWM frequency selection, duty cycle to speed mapping, and low-side vs high-side switching topologies.
- **[H-Bridge Circuits]({{< relref "h-bridge-circuits" >}})** — H-bridge topologies for bidirectional control, shoot-through protection, and bootstrap gate drivers.
- **[Current Sensing & Limiting]({{< relref "current-sensing-and-limiting" >}})** — Shunt resistors, inline sense amplifiers, and current-chopping techniques for motor protection.
- **[Back-EMF & Braking]({{< relref "back-emf-and-braking" >}})** — Back-EMF measurement, regenerative braking, and dynamic braking circuits.
