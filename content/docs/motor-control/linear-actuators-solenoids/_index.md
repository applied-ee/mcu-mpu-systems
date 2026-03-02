---
title: "Linear Actuators & Solenoids"
weight: 50
bookCollapseSection: true
---

# Linear Actuators & Solenoids

Not every actuator spins. Solenoids produce linear push or pull motion over short strokes (typically 5–30 mm), relays switch high-power contacts using a magnetic coil, and linear actuators extend or retract over longer distances using an internal DC motor and leadscrew. All of these are inductive loads — they store energy in a magnetic field that must be safely dissipated when the drive signal is removed. The flyback voltage spike from a de-energized solenoid or relay coil can destroy an unprotected MOSFET in a single switching event.

From the firmware perspective, solenoids and relays are on/off devices (or proportionally driven with PWM dithering), while linear actuators behave like DC motors with limit switches. The drive circuitry principles — flyback protection, current limiting, thermal management — are shared with rotary motor drives, but the mechanical constraints (end-of-travel impacts, holding force vs pull-in force, duty cycle limits) add their own failure modes.

## Pages

- **[Solenoid Drive Circuits]({{< relref "solenoid-drive-circuits" >}})** — Pull and push solenoids, flyback protection, drive transistor selection, and hold-current reduction techniques.
- **[Linear Actuator Control]({{< relref "linear-actuator-control" >}})** — DC motor-based linear actuators, limit switch integration, and position feedback options.
- **[Proportional Solenoid Control]({{< relref "proportional-solenoid-control" >}})** — PWM dithering for proportional force, valve control applications, and current regulation.
- **[Relay Drive Patterns]({{< relref "relay-drive-patterns" >}})** — Relay coil driving, contact protection, solid-state relays, and contact bounce management.
