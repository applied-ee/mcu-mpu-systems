---
title: "Predictive Maintenance"
weight: 30
---

# Predictive Maintenance

Predictive maintenance estimates when a machine component will fail, enabling maintenance scheduling after most useful life is consumed but before failure occurs. The distinction from reactive maintenance (fix after failure) and preventive maintenance (replace on a fixed schedule regardless of condition) is that predictive maintenance uses actual sensor measurements to forecast the remaining useful life (RUL) of a component, optimizing the trade-off between maintenance cost and downtime risk.

The economic motivation is straightforward. Replacing a bearing at 50% of its useful life (preventive) wastes 50% of the bearing's value. Waiting until failure (reactive) causes unplanned downtime, potential collateral damage to adjacent components, and safety risk. Predicting failure 2–4 weeks in advance allows scheduling maintenance during a planned downtime window, consuming 80–95% of the component's useful life with near-zero unplanned downtime.

## Remaining Useful Life (RUL) Estimation

RUL estimation is a regression problem: given the current sensor data and optionally the operating history, predict the time (in hours, cycles, or operational units) until the component reaches a failure threshold. The output is a scalar — estimated hours until failure — or a probability distribution over failure time.

Two fundamental approaches:

**Physics-based models:** Derive RUL from a physical degradation equation. For bearing fatigue, the L10 life calculation from ISO 281 estimates bearing life based on load and speed. Paris' law models crack growth rate under cyclic loading. These models require accurate knowledge of operating conditions and material properties but provide interpretable, transferable predictions.

**Data-driven models:** Learn the relationship between sensor observations and RUL from historical run-to-failure data. No physics equations needed — the model learns the degradation pattern empirically. This approach requires sufficient historical failure data, and the model is only valid for operating conditions represented in the training data.

In practice, the most robust systems combine both: physics-based models provide the structural form of the degradation curve, and data-driven methods calibrate the model parameters from sensor observations.

## Condition-Based vs Predictive

Condition-based maintenance (CBM) and predictive maintenance (PdM) are related but distinct:

- **Condition-based:** Monitor a health indicator (vibration RMS, bearing temperature, oil particulate count). When the indicator crosses a threshold, schedule maintenance. This is reactive to the current condition — it tells that the component is degraded but not how quickly it is degrading or when it will fail.
- **Predictive:** Forecast when the health indicator will cross the threshold based on its trajectory. This provides lead time: "At the current degradation rate, bearing vibration will exceed the ISO 10816 alarm threshold in approximately 3 weeks." Lead time enables scheduling maintenance during the next planned shutdown rather than triggering an immediate unplanned stop.

The additional value of prediction over condition monitoring is the lead time — and the confidence interval around that estimate. A narrow confidence interval ("failure in 15–20 days") enables precise scheduling. A wide interval ("failure in 5–60 days") provides less scheduling value than simple condition monitoring.

## Degradation Modeling

Degradation modeling tracks a health indicator over the operational lifetime and fits a model to the degradation trajectory. The health indicator should be:

- Monotonically trending (at least on average) as degradation progresses
- Measurable from the available sensors
- Sensitive to the failure mode of interest
- Distinguishable from operating condition variation (load, speed, temperature effects)

Common degradation curve shapes:

**Linear degradation:** Health indicator changes at a constant rate. RUL estimation is straightforward extrapolation: RUL = (threshold - current_value) / rate. Appropriate for steady wear mechanisms like abrasive wear, corrosion, or slow thermal degradation.

**Exponential degradation:** Degradation accelerates as the component approaches failure. Common in fatigue failure (crack growth accelerates as the crack lengthens) and bearing degradation (increased vibration creates more damage, which increases vibration further). The health indicator follows:

```
H(t) = H0 * exp(beta * t)
```

where H0 is the initial health indicator value and beta is the degradation rate. RUL estimation requires estimating beta from the observed trajectory, which improves as more data points accumulate.

**Two-phase degradation:** Normal operation with minimal change, followed by accelerating degradation after a transition point. Bearings often exhibit this pattern — vibration RMS is stable for months, then increases rapidly over days to weeks as a spall develops. Detecting the transition from phase 1 to phase 2 is itself a valuable signal, as it indicates the component has entered its end-of-life region.

## Health Indicators from Sensors

### Vibration

Vibration monitoring is the most widely used and most mature technology for rotating machinery predictive maintenance. The key health indicators:

| Indicator | What It Measures | Sensitivity |
|-----------|-----------------|-------------|
| RMS acceleration | Overall vibration energy | General health — increases with any defect |
| Peak acceleration | Maximum vibration amplitude | Impulsive events — bearing defects, gear tooth damage |
| Crest factor | Peak / RMS ratio | Impulsiveness — high for early bearing faults, decreases as fault spreads |
| Kurtosis | Tailedness of amplitude distribution | Early fault detection — more sensitive than RMS for incipient defects |
| FFT spectral bands | Energy at specific frequencies | Fault-type identification from characteristic frequencies |
| Envelope spectrum | Amplitude demodulation of high-frequency resonance | Bearing defect frequency extraction — gold standard for bearing diagnostics |

Bearing defect frequencies are calculable from bearing geometry (number of rolling elements, pitch diameter, contact angle) and shaft speed:

- **BPFO** (Ball Pass Frequency Outer race): defects on outer race — most common failure mode
- **BPFI** (Ball Pass Frequency Inner race): defects on inner race
- **BSF** (Ball Spin Frequency): defects on rolling elements
- **FTF** (Fundamental Train Frequency): cage defects

These frequencies are available from bearing manufacturer datasheets or calculable from dimensions. An increase in spectral energy at BPFO, for example, specifically indicates an outer race defect.

For MCU-based vibration monitoring, an ADXL356 (±40 g, 1.5 kHz bandwidth) or ADXL1002 (±50 g, 11 kHz bandwidth) provides the raw data. The MCU samples via SPI or ADC at 12.8–25.6 kHz, computes a 1024 or 2048-point FFT using CMSIS-DSP's `arm_rfft_fast_f32` or `arm_rfft_q15`, extracts spectral features, and computes health indicators. The STM32F4 series (Cortex-M4F at 168 MHz) handles a 2048-point float32 FFT in approximately 1.5 ms.

### Temperature

Temperature monitoring provides a complementary view of component health:

- **Absolute temperature**: Bearing temperature above 80 C indicates insufficient lubrication or excessive load. Motor winding temperature above rated insulation class indicates insulation degradation risk.
- **Rate of change**: A sudden temperature rise (> 5 C/minute) indicates an acute failure event — loss of lubrication, sudden increase in friction.
- **Deviation from expected**: At a given load and ambient temperature, a component has an expected operating temperature. Deviation from this expected value (thermal model residual) isolates degradation from operating condition variation.

Temperature sensors (thermocouples, RTDs, or infrared pyrometers) sample at low rates (0.1–1 Hz). The health indicator is computed over windows of minutes to hours — temperature degradation patterns evolve on the timescale of hours to days, much slower than vibration-based indicators.

### Current Draw

Motor current signature analysis (MCSA) extracts health information from the motor supply current:

- **RMS current under load**: Increasing RMS current at constant load indicates increased mechanical resistance (bearing wear, misalignment) or electrical degradation (winding short).
- **Current spectrum**: Broken rotor bars produce sidebands at (1 ± 2s) × line frequency, where s is the motor slip. Eccentricity produces sidebands at specific frequencies related to pole count and slip.
- **Startup current profile**: The transient current during motor startup follows a characteristic shape. Changes in this shape — extended startup time, abnormal oscillation pattern — indicate mechanical issues.

Current monitoring uses Hall-effect sensors (ACS712, ACS723) or current transformers on the motor supply line. Sampling at 1–10 kHz captures the current waveform including harmonic content. An FFT of the current waveform reveals the spectral features for MCSA.

### Acoustic Emission

Ultrasonic acoustic emission sensors detect stress waves at frequencies above 20 kHz — inaudible to human hearing but produced by crack growth, friction, and impact events inside mechanical components. Acoustic emission detects faults earlier than vibration monitoring because the ultrasonic stress waves precede the low-frequency vibration that standard accelerometers measure.

Acoustic emission monitoring requires specialized sensors (piezoelectric AE sensors with frequency response up to 100 kHz or higher) and high-speed sampling (100 kHz–1 MHz). This pushes the data acquisition beyond typical MCU capabilities into FPGA or dedicated DSP territory.

## Machine Learning Approaches to RUL

### Linear and Exponential Regression on Features

The simplest ML approach: extract health indicators from sensor data at regular intervals, fit a linear or exponential regression to the trajectory, and extrapolate to the failure threshold. This requires minimal compute and fits on any MCU.

```
# Linear RUL estimation
degradation_rate = (H_current - H_initial) / (t_current - t_initial)
RUL = (H_threshold - H_current) / degradation_rate
```

For exponential degradation, a log-transform linearizes the problem:

```
log(H(t)) = log(H0) + beta * t
beta = slope of log(H) vs t regression
RUL = (log(H_threshold) - log(H_current)) / beta
```

These models require storing the regression coefficients and the health indicator history (or sufficient statistics for online regression). Total storage: less than 1 KB. Inference: a few arithmetic operations.

### Neural RUL Models

For SBC-class devices (Raspberry Pi, ESP32-S3 with PSRAM), neural network models operating on feature sequences provide more accurate RUL estimation than simple regression, particularly when the degradation pattern is nonlinear and varies across units.

**1D-CNN for RUL:** Input is a sequence of health indicator vectors — for example, the last 50 time steps of a 20-feature health indicator vector, shaped (50, 20). A 1D-CNN processes the sequence to produce a scalar RUL estimate. Model size: 50–200 KB. Inference: 5–20 ms on Cortex-A53.

**LSTM for RUL:** An LSTM processes the health indicator sequence step by step, maintaining hidden state that captures the degradation trajectory. LSTM models are well-suited to RUL because the degradation history (not just the current state) is informative. Model size: 100–500 KB. Inference: 10–50 ms depending on sequence length.

The NASA C-MAPSS (Commercial Modular Aero-Propulsion System Simulation) turbofan dataset is the standard benchmark for neural RUL models. It contains run-to-failure trajectories of simulated turbofan engines with 21 sensor channels. Published neural RUL models on C-MAPSS achieve RMSE of 12–15 cycles on the FD001 subset (single operating condition) and 20–25 cycles on FD004 (six operating conditions) — compared to 40+ cycles for simple linear regression.

### Edge vs Cloud Split

For fleet-level predictive maintenance systems, the computation is typically split between edge and cloud:

| Function | Location | Rationale |
|----------|----------|-----------|
| Sensor data acquisition | Edge (MCU) | Real-time, high-rate data collection |
| Feature extraction | Edge (MCU) | Reduces data volume by 100–1000x |
| [Anomaly detection]({{< relref "anomaly-detection" >}}) | Edge (MCU/SBC) | Low-latency safety alerts, works offline |
| Health indicator trending | Edge (SBC) | Local visualization and short-term RUL |
| Neural RUL estimation | Cloud or SBC | More compute, richer model, cross-machine data |
| Fleet analytics | Cloud | Cross-machine correlation, aggregated statistics |
| Model retraining | Cloud | GPU resources for training |

The edge device publishes health indicators and anomaly scores to the cloud via MQTT. The cloud aggregates data from the fleet, runs more computationally intensive RUL models, and identifies fleet-wide patterns (e.g., all machines in building B are degrading faster than building A — investigate environmental differences).

## MQTT Alerting Integration

MQTT is the standard messaging protocol for publishing health indicators and maintenance alerts from edge devices to a cloud or on-premises monitoring platform.

A typical MQTT topic structure for a predictive maintenance system:

```
plant/line1/machine3/bearing_DE/vibration_rms
plant/line1/machine3/bearing_DE/anomaly_score
plant/line1/machine3/bearing_DE/rul_estimate
plant/line1/machine3/bearing_DE/alert
```

The edge device publishes health indicators at regular intervals (every 1–60 seconds depending on the degradation time scale) and publishes alerts when thresholds are crossed. An MQTT broker (Mosquitto, EMQX, HiveMQ) routes messages to subscribers — a cloud dashboard (Grafana, Node-RED, custom web application), a rules engine for alert processing, and a time-series database (InfluxDB, TimescaleDB) for historical storage and trend analysis.

Alert messages include structured payloads:

```json
{
  "machine_id": "line1_machine3",
  "component": "bearing_DE",
  "timestamp_utc": "2026-02-28T14:30:00Z",
  "severity": "warning",
  "indicator": "vibration_rms",
  "value": 4.2,
  "threshold": 4.5,
  "rul_hours": 312,
  "message": "Vibration trending toward alarm threshold"
}
```

## Alert Design

Effective alerting for predictive maintenance requires more nuance than a single binary threshold.

**Multiple severity levels:**

| Level | Condition | Action |
|-------|-----------|--------|
| Normal | All indicators within baseline | No action, log data |
| Watch | Indicator trending upward, not yet at warning threshold | Increase monitoring frequency |
| Warning | Indicator above warning threshold or RUL < 30 days | Schedule maintenance during next planned shutdown |
| Alarm | Indicator above alarm threshold or RUL < 7 days | Schedule urgent maintenance |
| Danger | Indicator above danger threshold or RUL < 24 hours | Immediate shutdown recommended |

**Hysteresis:** Prevent alert flapping when an indicator oscillates near a threshold. The warning activates at vibration RMS > 4.5 mm/s but deactivates only when RMS falls below 3.6 mm/s (80% of the activation threshold). This 20% dead-band prevents rapid on/off toggling from minor fluctuations.

**Rate-of-change alerts:** In addition to absolute thresholds, alert on the degradation rate. A vibration RMS of 3.0 mm/s (below the warning threshold) that increased from 2.0 mm/s in the last week warrants attention even though the absolute value is acceptable — the trend predicts threshold crossing within 1–2 weeks.

**Alert suppression during known transients:** Suppress alerts during machine startup (first 30–60 seconds), shutdown, and planned maintenance activities. These transients produce indicator values that would trigger false alarms but are expected and benign. The suppression logic runs on the edge device or in the rules engine.

## ISO 10816 Vibration Severity

ISO 10816 provides vibration severity ranges for rotating machinery, widely used as initial alert thresholds:

| Group | Machine Type | Good (mm/s RMS) | Acceptable | Alert | Not Permissible |
|-------|-------------|-----------------|------------|-------|-----------------|
| 1 | Small machines (< 15 kW) | < 0.71 | 0.71–1.8 | 1.8–4.5 | > 4.5 |
| 2 | Medium machines (15–75 kW) | < 1.12 | 1.12–2.8 | 2.8–7.1 | > 7.1 |
| 3 | Large machines on rigid foundations | < 1.12 | 1.12–2.8 | 2.8–7.1 | > 7.1 |
| 4 | Large machines on flexible foundations | < 1.8 | 1.8–4.5 | 4.5–11.2 | > 11.2 |

These values apply to broadband velocity measured in mm/s RMS. They serve as reasonable starting thresholds for a new installation before machine-specific baselines are established from historical data.

## Tips

- Vibration RMS trending is the simplest and most effective starting point for rotating machinery predictive maintenance. A single accelerometer, an FFT for basic spectral features, and a linear trend extrapolation provide substantial value before investing in neural models. Many industrial predictive maintenance programs operate successfully on this foundation alone.
- Sample the vibration sensor at 2.5x the highest frequency of interest. For bearing analysis on a machine with shaft speed up to 3600 RPM (60 Hz), bearing defect frequencies can reach 500 Hz with harmonics to 3 kHz — a sampling rate of 8 kHz minimum, 12.8 kHz practical, 25.6 kHz generous.
- Calculate health indicators locally on the edge device and transmit only the indicators (not raw waveforms) over MQTT. A 25.6 kHz accelerometer produces 76.8 KB/s of raw data per axis. The corresponding health indicators (RMS, kurtosis, spectral band energies) are 10–50 scalar values per measurement window — a compression ratio of 1000x or more.
- Use ISO 10816 vibration severity ranges as initial alert thresholds for new installations. Machine-specific thresholds should replace these generic values after 3–6 months of baseline data collection.
- Store health indicator history on the edge device (SD card or external flash) in addition to transmitting to the cloud. This provides data continuity during network outages and enables local trend visualization for on-site maintenance technicians.

## Caveats

- Run-to-failure data is rare and expensive to collect. Machines are typically maintained before failure (by design — that is the point of maintenance), so failure events are uncommon in historical records. Simulated or accelerated life test data can supplement, but the degradation dynamics of accelerated tests may differ from field conditions. The NASA C-MAPSS dataset is widely used for research but does not represent real-world sensor noise, missing data, or variable operating conditions.
- RUL models trained on one machine type do not transfer to different machines. Even nominally identical machines exhibit different degradation patterns due to manufacturing variation, installation differences, load profiles, and environmental conditions. Transfer learning (pre-train on fleet data, fine-tune on target machine) reduces the data requirement for individual machines but does not eliminate it.
- Operating condition changes (load, speed, temperature) affect health indicators independently of degradation. A machine running at higher load has higher vibration RMS — this is normal operating variation, not degradation. Health indicators must be normalized for operating conditions, or the RUL model must include operating conditions as input features. Without this normalization, the RUL estimate fluctuates with every load change.
- Predictive maintenance ROI requires enough historical failure data to validate predictions. Demonstrating that a system predicted a failure 3 weeks in advance (enabling a planned repair that avoided $50,000 in unplanned downtime) requires that the failure actually occurs (or would have occurred without intervention). This creates a validation paradox: successful predictive maintenance prevents the failures that would validate the predictions.

## In Practice

- **Vibration RMS increases steadily over weeks, then jumps sharply.** This is the classic bearing degradation pattern — steady wear followed by accelerating failure as a spall develops and propagates. The sharp jump indicates the transition from gradual to rapid degradation. Maintenance should be scheduled immediately upon detecting the acceleration, as the time from acceleration to failure can be days rather than weeks.
- **Health indicator oscillates daily without a long-term trend.** Ambient temperature variation causes thermal expansion that shifts vibration signatures and current draw. Adding temperature as a model input or normalizing the health indicator by ambient temperature eliminates the oscillation. A common sanity check is to plot the health indicator against ambient temperature — if the correlation is high, temperature compensation is needed.
- **RUL estimate fluctuates wildly between consecutive measurements.** The input features are not stable enough for reliable extrapolation. Increasing the averaging window for health indicator computation (from 1-minute windows to 10-minute windows) smooths the inputs and stabilizes the RUL estimate. Alternatively, the RUL model itself may be overfit to the training data — a simpler model with fewer input features often produces more stable predictions.
- **MQTT alerts fire repeatedly, then stop, then fire again.** Alert hysteresis is not configured, and the health indicator is oscillating near the threshold boundary. Adding a dead-band (alert activates at threshold T, deactivates at 0.8T) prevents the toggling. If the indicator is genuinely fluctuating around the warning level, this itself is informative — the component is approaching the maintenance threshold.
- **RUL model predicts 500 hours, but component fails in 100 hours.** The model was trained on gradual degradation data and the actual failure was a sudden event (impact damage, lubrication loss, contamination) that bypasses the gradual degradation pattern. Predictive maintenance based on degradation modeling inherently cannot predict sudden failures — [anomaly detection]({{< relref "anomaly-detection" >}}) provides the complementary capability for detecting abrupt deviations from normal.
