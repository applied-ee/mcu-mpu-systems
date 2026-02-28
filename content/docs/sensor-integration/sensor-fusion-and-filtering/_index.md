---
title: "Sensor Fusion & Filtering"
weight: 70
bookCollapseSection: true
---

# Sensor Fusion & Filtering

Raw sensor data is noisy, drifts over time, and often tells only part of the story. A gyroscope gives angular rate but accumulates drift; an accelerometer gives tilt but is corrupted by vibration; a magnetometer gives heading but is distorted by nearby iron. Combining these imperfect measurements into a stable, accurate estimate of orientation or position is the domain of sensor fusion. Before fusion can work, each sensor stream typically needs filtering — removing high-frequency noise, compensating for known biases, and matching sample rates across sensors with different update cadences.

This subsection covers the firmware-side techniques for cleaning and combining sensor data: basic digital filters for noise reduction, complementary filters for quick two-source fusion, Kalman filters for optimal estimation under uncertainty, and full AHRS algorithms that fuse accelerometer, gyroscope, and magnetometer data into a stable orientation reference.

## Pages

- **[Digital Filtering Basics (Moving Average, IIR, FIR)]({{< relref "digital-filtering-basics" >}})** — Moving average, exponential smoothing, first-order IIR, and simple FIR filters implemented in fixed-point C for resource-constrained MCUs.
- **[Complementary Filters]({{< relref "complementary-filters" >}})** — High-pass/low-pass fusion of gyroscope and accelerometer data, time constant selection, and the single-parameter filter that works surprisingly well for tilt estimation.
- **[Kalman Filtering for Embedded Systems]({{< relref "kalman-filtering" >}})** — State-space model basics, the predict-update cycle, tuning Q and R matrices, and a practical single-axis Kalman filter implementation in C.
- **[AHRS & Multi-Sensor Fusion]({{< relref "ahrs-and-multi-sensor-fusion" >}})** — Madgwick and Mahony AHRS algorithms, quaternion representation, magnetic distortion compensation, and real-time orientation output on Cortex-M.
