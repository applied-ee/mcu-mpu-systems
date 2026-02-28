---
title: "Inertial & Motion Sensors"
weight: 30
bookCollapseSection: true
---

# Inertial & Motion Sensors

Accelerometers, gyroscopes, and magnetometers form the backbone of motion-aware embedded systems — from drone flight controllers and wearable step counters to industrial vibration monitors and robotic joint controllers. These sensors are almost always MEMS devices communicating over SPI or I²C, with configuration registers that control measurement range, output data rate, digital filtering, and interrupt generation. The firmware challenge is less about reading a single value and more about configuring the sensor for the right tradeoff between noise, bandwidth, and power consumption, then streaming data at rates that can exceed 1 kHz per axis.

This subsection covers the three fundamental inertial sensor types individually, then addresses the combined IMU devices that integrate multiple sensors into a single package with shared configuration and data readout.

## Pages

- **[Accelerometer Fundamentals]({{< relref "accelerometer-fundamentals" >}})** — MEMS sensing principles, full-scale range selection, output data rate and bandwidth, interrupt-driven data-ready patterns, and gravity vector extraction.
- **[Gyroscopes & Angular Rate]({{< relref "gyroscopes-and-angular-rate" >}})** — Angular rate measurement, full-scale DPS selection, bias drift and zero-rate offset, temperature compensation, and integration to angle.
- **[Magnetometers & Heading]({{< relref "magnetometers-and-heading" >}})** — Magnetic field sensing, hard-iron and soft-iron calibration, tilt-compensated heading calculation, and interference from nearby components.
- **[IMU Configuration & Data Readout]({{< relref "imu-configuration-and-data-readout" >}})** — Multi-sensor IMU devices (MPU-6050, ICM-42688, BMI270), register map navigation, FIFO readout, and SPI burst-read patterns for high-rate data acquisition.
