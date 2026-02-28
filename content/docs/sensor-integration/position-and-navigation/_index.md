---
title: "Position & Navigation Sensors"
weight: 40
bookCollapseSection: true
---

# Position & Navigation Sensors

Knowing where something is — its position, distance from a target, or angle of rotation — requires a different class of sensors than those that measure environmental conditions or inertial forces. GPS/GNSS modules provide absolute position on the Earth's surface but with latency and limited indoor coverage. Encoders provide precise relative position and velocity for shafts and linear stages. Ranging sensors (time-of-flight, LIDAR, ultrasonic) measure distance to objects with millimeter to centimeter resolution. Each technology has a distinct interface pattern: UART/I²C for GNSS, quadrature pulse trains for encoders, I²C/SPI for ranging ICs.

This subsection covers the firmware integration of position and distance sensors commonly used in embedded navigation, robotics, and automation projects.

## Pages

- **[GPS/GNSS Module Integration]({{< relref "gps-gnss-module-integration" >}})** — UART-based NMEA parsing, UBX binary protocol for u-blox modules, fix quality assessment, PPS timing, and low-power GNSS strategies.
- **[Rotary & Linear Encoders]({{< relref "rotary-and-linear-encoders" >}})** — Quadrature decoding with timer hardware, index pulse handling, absolute versus incremental encoders, and velocity estimation from encoder counts.
- **[Time-of-Flight & LIDAR Ranging]({{< relref "time-of-flight-and-lidar-ranging" >}})** — VL53L0X/VL53L1X I²C integration, ranging modes and timing budgets, multi-zone sensors, and single-point LIDAR modules for longer-range measurement.
- **[Ultrasonic Distance Measurement]({{< relref "ultrasonic-distance-measurement" >}})** — HC-SR04 trigger/echo timing, temperature-compensated speed of sound, blanking distance limitations, and interrupt-based measurement patterns.
