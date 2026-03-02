---
title: "Brushless Motors"
weight: 30
bookCollapseSection: true
---

# Brushless Motors

Brushless DC (BLDC) and permanent-magnet synchronous motors (PMSM) eliminate the commutator and brushes of their brushed counterparts, replacing mechanical contact switching with electronic commutation. The result is higher efficiency, longer lifespan, and better power density — at the cost of significantly more complex drive electronics and firmware. A three-phase inverter must energize the correct stator windings at exactly the right rotor angle, which requires either position sensors (Hall effect) or sensorless algorithms that estimate rotor position from back-EMF.

The spectrum of BLDC control techniques ranges from simple six-step (trapezoidal) commutation — adequate for fans, pumps, and propellers — to full field-oriented control (FOC) that delivers smooth torque at all speeds and is essential for precision servo applications. Off-the-shelf ESCs abstract much of this away for hobby and drone use, but custom motor control on an STM32 or ESP32 opens the door to tighter integration, custom tuning, and cost optimization in production designs.

## Pages

- **[BLDC Fundamentals]({{< relref "bldc-fundamentals" >}})** — Three-phase topology, electrical vs mechanical degrees, KV rating, and the relationship between voltage, speed, and torque.
- **[Six-Step Commutation]({{< relref "six-step-commutation" >}})** — Trapezoidal commutation sequence, Hall sensor placement and timing, and commutation lookup tables.
- **[Field-Oriented Control]({{< relref "field-oriented-control" >}})** — FOC/vector control: Clarke and Park transforms, current control loops, and why sinusoidal commutation outperforms trapezoidal.
- **[ESC Integration]({{< relref "esc-integration" >}})** — Off-the-shelf electronic speed controllers, PWM/OneShot/DShot protocol differences, and ESC calibration.
- **[Sensorless Back-EMF]({{< relref "sensorless-back-emf" >}})** — Zero-crossing detection, comparator-based sensing, and startup strategies without position sensors.
