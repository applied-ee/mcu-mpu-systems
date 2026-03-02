---
title: "⚙️ Motors & Actuators"
weight: 10
bookCollapseSection: true
---

# Motors & Actuators

Turning electrical energy into mechanical motion — or holding a position against an external force — is the core job of motors, solenoids, and linear actuators. The hardware spans milliwatt piezo buzzers to kilowatt BLDC spindles, but the embedded engineering discipline is consistent: a microcontroller generates control signals, a power stage amplifies them to levels the load demands, and feedback (current, position, velocity, temperature) closes the loop. Getting this right means understanding the electrical characteristics of inductive loads, the timing constraints of commutation and PWM, and the failure modes that destroy FETs and burn traces.

The gap between blinking an LED and spinning a motor at a controlled speed is larger than it looks. Motors draw currents that dwarf logic-level signals, generate voltage spikes when switched, inject noise into every ground and supply rail on the board, and produce back-EMF that can damage unprotected drivers. Solenoids and relays share the same inductive-load hazards. Linear actuators add mechanical end-stop forces that stall motors and spike current. Every section here treats the power stage and its protection circuitry as inseparable from the control algorithm — because on real hardware, they are.

This section covers the major motor types used in embedded systems (DC brushed, stepper, brushless), position-control techniques (encoders, PID, closed-loop steppers), linear actuators and solenoids, and the drive circuitry and thermal management common to all high-current inductive loads.

## Sections

- **[DC Motors]({{< relref "dc-motors" >}})** — Brushed DC motor control: PWM speed regulation, H-bridge direction switching, current sensing, and back-EMF braking.
- **[Stepper Motors]({{< relref "stepper-motors" >}})** — Open-loop positioning with step/direction interfaces, microstepping, acceleration profiles, and dedicated driver ICs.
- **[Brushless Motors]({{< relref "brushless-motors" >}})** — Three-phase BLDC and PMSM control: six-step commutation, field-oriented control, ESC integration, and sensorless startup.
- **[Servo & Position Control]({{< relref "servo-position-control" >}})** — RC servos, encoder feedback, PID tuning for position and velocity loops, and closed-loop stepper systems.
- **[Linear Actuators & Solenoids]({{< relref "linear-actuators-solenoids" >}})** — Solenoid drive circuits, linear actuator control, proportional solenoid techniques, and relay drive patterns.
- **[Drive Circuitry & Power Stages]({{< relref "drive-circuitry" >}})** — MOSFET selection and gate drive, flyback and snubber protection, current sensing, thermal management, and power layout for motor drives.
