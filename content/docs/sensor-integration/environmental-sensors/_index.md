---
title: "Environmental Sensors"
weight: 20
bookCollapseSection: true
---

# Environmental Sensors

Temperature, humidity, barometric pressure, and air quality are the most frequently measured quantities in embedded systems — from HVAC controllers and weather stations to cold-chain monitors and indoor air quality devices. The sensors themselves range from simple analog thermistors to complex multi-parameter digital ICs that report temperature, humidity, and pressure over I²C in a single transaction. Despite the variety, the integration patterns repeat: configure the sensor's measurement mode and resolution, trigger or wait for a conversion, read the raw data over a serial bus, and apply the manufacturer's compensation formula to get physical units.

This subsection covers the major environmental sensor families, their bus-level integration, and the firmware patterns that apply across dozens of similar devices.

## Pages

- **[Temperature Sensing (NTC, RTD, Digital)]({{< relref "temperature-sensing" >}})** — Thermistor front-end circuits, RTD bridge configurations, and digital sensors (DS18B20, TMP117) with their bus protocols and accuracy tradeoffs.
- **[Humidity & Barometric Pressure]({{< relref "humidity-and-barometric-pressure" >}})** — Capacitive humidity sensors, MEMS barometric pressure devices (BME280, BMP390), compensation algorithms, and altitude estimation from pressure.
- **[Gas & Air Quality Sensors]({{< relref "gas-and-air-quality" >}})** — Metal-oxide (MQ-series), electrochemical, and MEMS gas sensors (SGP40, BME688), baseline calibration, and interpreting air quality indices.
- **[Environmental Sensor Bus Patterns]({{< relref "environmental-sensor-bus-patterns" >}})** — Shared I²C bus topologies, address conflicts, multi-sensor polling strategies, and power management for battery-operated environmental loggers.
