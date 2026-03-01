---
title: "Sensor-Driven ML Pipelines"
weight: 70
bookCollapseSection: true
---

# Sensor-Driven ML Pipelines

Sensors generate continuous streams of data — accelerometer samples at 100 Hz, vibration readings at 25.6 kHz, temperature measurements every second — and the challenge in edge ML is transforming these raw streams into fixed-size input tensors that a trained model can classify. The pipeline between sensor and model involves buffering, windowing, feature extraction, and normalization, all running within the memory and timing constraints of an embedded system. A missed sample, an inconsistent window stride, or a normalization mismatch between training and deployment silently degrades model accuracy without any obvious error.

Time-series classification, anomaly detection, and predictive maintenance share this pipeline structure but differ in what the model learns. A classifier maps a window of sensor data to a discrete label (walking, running, idle). An anomaly detector learns what normal looks like and flags deviations. A predictive maintenance model estimates remaining useful life from degradation patterns in vibration, temperature, or current draw. In each case, the preprocessing pipeline must exactly reproduce the feature extraction used during training — the same window size, the same overlap, the same normalization parameters — or the model's learned representations become meaningless.

## What This Section Covers

- **[Time-Series Classification]({{< relref "time-series-classification" >}})** — Sliding window design, 1D-CNNs on microcontrollers, gesture and activity recognition from IMU data, and vibration classification.
- **[Anomaly Detection]({{< relref "anomaly-detection" >}})** — Autoencoders, isolation forests, statistical baselines, predictive maintenance applications, and threshold tuning.
- **[Predictive Maintenance]({{< relref "predictive-maintenance" >}})** — Remaining useful life estimation, degradation modeling, vibration and temperature and current features, and MQTT alerting integration.
- **[Sensor Preprocessing for ML]({{< relref "sensor-preprocessing" >}})** — Ring buffers, fixed-point normalization, sliding window overlap management, and DMA-to-inference pipelines.
