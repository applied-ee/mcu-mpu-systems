---
title: "Servo & Position Control"
weight: 40
bookCollapseSection: true
---

# Servo & Position Control

Moving a motor to a specific position — and holding it there — requires closing a feedback loop. Open-loop stepper control works when missed steps are unlikely, but any application with variable loads, high accelerations, or precision requirements needs real-time position or velocity feedback driving a control algorithm. This is the domain of servo systems: a motor (any type), a sensor (encoder, potentiometer, Hall), and a controller (PID or more advanced) working together to track a commanded trajectory.

The term "servo" spans a wide range in embedded work. Hobby RC servos are self-contained units with built-in feedback and a PWM command interface — useful for light-duty positioning. Industrial servo drives pair brushless motors with high-resolution encoders and tuned PID loops for sub-degree accuracy at high speeds. Closing the loop on a stepper motor — turning it into a servo stepper — combines the positional certainty of step counting with the stall recovery and efficiency of feedback control. The control theory is the same across all of these; the differences are in resolution, bandwidth, and power level.

## Pages

- **[RC Servo Fundamentals]({{< relref "rc-servo-fundamentals" >}})** — PWM pulse widths, analog vs digital servos, torque and speed specifications, and power supply considerations.
- **[Encoder Feedback]({{< relref "encoder-feedback" >}})** — Quadrature encoders, index pulses, timer-based decoding, and resolution calculation.
- **[PID for Motor Control]({{< relref "pid-for-motor-control" >}})** — PID tuning for position and velocity loops, integral windup, derivative filtering, and cascaded control.
- **[Closed-Loop Stepper & Servo]({{< relref "closed-loop-stepper-and-servo" >}})** — Adding feedback to steppers, servo vs stepper trade-offs, and hybrid closed-loop architectures.
