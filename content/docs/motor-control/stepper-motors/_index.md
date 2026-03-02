---
title: "Stepper Motors"
weight: 20
bookCollapseSection: true
---

# Stepper Motors

Stepper motors convert discrete electrical pulses into fixed angular steps — typically 1.8° (200 steps per revolution) for the most common NEMA-frame hybrid steppers. Each pulse advances the rotor by one step, making open-loop position control possible without an encoder. This predictability makes steppers the default choice for CNC machines, 3D printers, camera sliders, and any application where position accuracy matters more than continuous speed.

The trade-off is that steppers demand more from the drive electronics and firmware than brushed DC motors. Coil currents must be actively regulated (not just switched), acceleration profiles must respect torque-speed curves to avoid stalling, and microstepping — while essential for smooth motion — introduces its own set of accuracy limitations. Modern stepper driver ICs handle much of this complexity in silicon, but selecting and configuring them correctly still requires understanding the underlying physics.

## Pages

- **[Stepper Types & Wiring]({{< relref "stepper-types-and-wiring" >}})** — Unipolar vs bipolar construction, coil identification techniques, and holding torque vs detent torque.
- **[Step/Direction Interface]({{< relref "step-direction-interface" >}})** — Step and direction protocol, pulse timing requirements, and enable/disable behavior.
- **[Microstepping]({{< relref "microstepping" >}})** — Microstepping principles, current waveforms, and the gap between electrical resolution and mechanical reality.
- **[Acceleration Profiles]({{< relref "acceleration-profiles" >}})** — Trapezoidal and S-curve ramp generation, stall avoidance, and maximum start rate.
- **[Stepper Driver ICs]({{< relref "stepper-driver-ics" >}})** — A4988, DRV8825, and TMC2209: feature comparison, configuration, and advanced diagnostics.
