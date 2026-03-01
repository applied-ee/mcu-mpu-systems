---
title: "Anomaly Detection"
weight: 20
---

# Anomaly Detection

Anomaly detection learns what "normal" looks like and flags deviations. Unlike classification, which requires labeled examples of every category, anomaly detection requires only normal data for training — a form of one-class learning. The model builds a representation of normal operating conditions, and anything that falls outside that representation is flagged as anomalous. This property makes anomaly detection particularly valuable for industrial and embedded applications where collecting labeled fault data is expensive, dangerous, or impossible (a machine cannot be intentionally run to failure just to collect training data).

The core principle is simple: define a boundary around normal behavior, assign an anomaly score based on distance from that boundary, and trigger an alert when the score exceeds a threshold. The implementation ranges from elementary statistics (mean plus three standard deviations) to neural autoencoders — the right choice depends on the complexity of the "normal" pattern, the available compute budget, and the cost of false positives versus missed detections.

## Why Anomaly Detection at the Edge

Running anomaly detection on the edge device (MCU or SBC) rather than in the cloud provides several advantages:

- **Latency**: Detection happens in milliseconds, not seconds. For safety-critical applications (motor overcurrent, bearing seizure), cloud round-trip latency is unacceptable.
- **Bandwidth**: Sending raw sensor data to the cloud for analysis requires significant bandwidth. An accelerometer at 25.6 kHz × 3 axes × 16 bits = 153.6 KB/s continuous. Detecting anomalies locally and sending only alerts and summary statistics reduces bandwidth by orders of magnitude.
- **Offline operation**: Edge anomaly detection works without network connectivity. Industrial environments often have unreliable or nonexistent wireless coverage.
- **Privacy**: Sensor data from manufacturing processes may be proprietary. Processing at the edge keeps raw data on-premises.

The trade-off is limited compute and memory for the anomaly detection model itself. This constrains the model complexity and pushes toward simpler, more efficient detection methods.

## Statistical Baselines

The simplest anomaly detection methods require no machine learning at all. They establish a statistical description of normal behavior and flag deviations.

**Fixed threshold:** The most basic approach. A sensor value above or below a predefined limit triggers an alert. Effective for single-value monitoring (temperature must stay below 80 C, current draw must stay below 5 A) but cannot capture multivariate or temporal patterns.

**Mean plus N standard deviations:** Compute the mean (mu) and standard deviation (sigma) of a sensor value during normal operation. Any reading outside mu plus or minus N*sigma is flagged. N = 3 is the most common choice (99.7% of Gaussian data falls within 3 sigma). This requires storing only two floating-point values per sensor channel — trivial on any MCU.

**Exponentially Weighted Moving Average (EWMA):** Tracks a smoothed version of the signal:

```
ewma[t] = alpha * x[t] + (1 - alpha) * ewma[t-1]
```

The smoothing factor alpha (typically 0.01–0.1) controls how quickly the average responds to new data. Anomalies are detected when the raw value deviates significantly from the EWMA. EWMA adapts to slow drift (seasonal temperature changes, gradual wear) while still flagging sudden deviations. This adaptivity is both an advantage and a risk — if the system drifts toward failure gradually, the EWMA tracks the drift and may not flag the degradation until it accelerates.

**Control charts (Shewhart, CUSUM, EWMA chart):** Statistical process control methods from manufacturing quality control. CUSUM (Cumulative Sum) is particularly useful for detecting small persistent shifts that individual sample thresholds miss. CUSUM accumulates deviations from the expected mean:

```
S[t] = max(0, S[t-1] + x[t] - mu - k)
```

When S exceeds a decision threshold h, a shift is detected. The sensitivity parameter k (typically 0.5 sigma) and threshold h (typically 4–5 sigma) are tuned to balance detection speed against false alarm rate. CUSUM requires only three stored values (S, mu, k) and a single comparison per sample — it runs on any MCU with negligible resource impact.

## Mahalanobis Distance

For multivariate sensor data (multiple correlated sensor channels), the Mahalanobis distance extends the univariate z-score to account for correlations between channels. The Mahalanobis distance of a sample x from the normal distribution with mean mu and covariance matrix Sigma is:

```
D = sqrt((x - mu)^T * Sigma^(-1) * (x - mu))
```

This measures how many "standard deviations" a sample is from the mean, accounting for the shape and orientation of the normal data distribution. Two sensor channels that are normally correlated (e.g., temperature and current draw — higher current produces more heat) have a narrow elliptical distribution. A sample where temperature is high but current is low lies far from the distribution in Mahalanobis space even if each individual value is within its univariate normal range.

For MCU deployment, the covariance matrix inverse (precision matrix) is precomputed offline from the training data and stored as a constant array. For P sensor channels, the precision matrix has P x P entries. A 6-channel sensor system requires storing 36 float values (or 21 unique values exploiting symmetry). The runtime computation is a matrix-vector multiply and a dot product — feasible on any Cortex-M with a few microseconds of compute.

Mahalanobis distance assumes the normal data distribution is approximately Gaussian. For non-Gaussian distributions (multimodal operating conditions, skewed sensor responses), more flexible methods are needed.

## Isolation Forests

Isolation forests detect anomalies based on the principle that anomalous points are easier to isolate than normal points. The algorithm builds an ensemble of random binary trees (typically 100–256 trees). Each tree recursively splits the data by randomly selecting a feature and a random split value within that feature's range. Anomalous points, being rare and different from the majority, are isolated in fewer splits — they have shorter average path lengths across the ensemble.

The anomaly score is derived from the average path length across all trees. A normalization factor converts path length to a score between 0 and 1, where scores close to 1 indicate anomalies.

Training an isolation forest in scikit-learn:

```python
from sklearn.ensemble import IsolationForest

model = IsolationForest(n_estimators=100, contamination=0.01, random_state=42)
model.fit(normal_features)  # Train on normal data only

# Export tree structure for MCU deployment
# Each tree is a binary tree with split_feature, split_value, left_child, right_child
```

For MCU deployment, each tree is serialized as an array of nodes, where each node stores the feature index, split threshold, and child indices. A forest of 100 trees with average depth 10 and 20 input features occupies approximately 50–100 KB of flash depending on the serialization format. Inference traverses each tree from root to leaf, computing the average path length — approximately 1,000 comparisons total, completing in well under 1 ms on a Cortex-M4.

Fixed-point inference is straightforward: the split thresholds are pre-quantized to the same fixed-point format as the input features. Only comparisons and additions are needed — no multiplications.

## Autoencoders for Anomaly Detection

An autoencoder is a neural network trained to reconstruct its input. The architecture has an encoder that compresses the input to a lower-dimensional latent representation, and a decoder that reconstructs the input from the latent representation. When trained on normal data, the autoencoder learns to reconstruct normal patterns faithfully. Anomalous inputs, which differ from the training distribution, are reconstructed poorly — the reconstruction error serves as the anomaly score.

Architecture for MCU deployment:

```
Input:   128 features (e.g., statistical features from a sensor window)
Encoder: Dense(128→64, ReLU) → Dense(64→32, ReLU) → Dense(32→16, ReLU)
Latent:  16 dimensions
Decoder: Dense(16→32, ReLU) → Dense(32→64, ReLU) → Dense(64→128, Sigmoid)
Output:  128 reconstructed features
```

This architecture has approximately 20,000 parameters:
- 128×64 + 64 = 8,256 (first encoder layer)
- 64×32 + 32 = 2,080 (second encoder layer)
- 32×16 + 16 = 528 (third encoder layer)
- 16×32 + 32 = 544 (first decoder layer)
- 32×64 + 64 = 2,112 (second decoder layer)
- 64×128 + 128 = 8,320 (third decoder layer)
- Total: ~21,840 parameters → ~22 KB at int8 quantization

The anomaly score is the mean squared error (MSE) between input and reconstruction:

```
anomaly_score = (1/N) * sum((input[i] - reconstruction[i])^2)
```

On a Cortex-M4 at 80 MHz, inference (forward pass through encoder and decoder plus MSE computation) takes approximately 0.5–1.5 ms using CMSIS-NN int8 kernels.

### Bottleneck Size Selection

The bottleneck (latent dimension) size critically determines the autoencoder's sensitivity. The bottleneck must be small enough that the autoencoder cannot simply pass all information through (which would reconstruct everything, including anomalies, perfectly), but large enough that the autoencoder can faithfully reconstruct the variety of normal operating conditions.

Guidelines:
- Start with a bottleneck that is 10–25% of the input dimension
- If the reconstruction error on normal validation data is consistently high, the bottleneck is too small
- If the reconstruction error on known anomalies is not significantly higher than on normal data, the bottleneck is too large
- The ratio of anomaly reconstruction error to normal reconstruction error should be at least 2–3x for reliable detection

### Convolutional Autoencoders for Time Series

For anomaly detection directly on raw time-series windows (rather than extracted features), a convolutional autoencoder replaces the dense layers with 1D convolutions:

```
Encoder: Conv1D(16, k=7) → MaxPool(2) → Conv1D(32, k=5) → MaxPool(2) → Conv1D(8, k=3)
Decoder: Conv1D(32, k=3) → UpSample(2) → Conv1D(16, k=5) → UpSample(2) → Conv1D(input_channels, k=7)
```

This preserves temporal structure in the latent representation and can detect temporal anomalies (unusual sequences of events) that a feature-based autoencoder might miss. The trade-off is a larger model (40–80 KB) and longer inference time (2–5 ms on Cortex-M4).

## Threshold Tuning

Setting the anomaly score threshold is the most consequential decision in anomaly detection system design. The threshold directly determines the false positive rate (normal operations flagged as anomalous) and the detection rate (actual anomalies correctly flagged).

**Percentile-based thresholds:** Set the threshold at the Nth percentile of the anomaly score distribution computed on normal validation data. The 99th percentile means approximately 1% of normal windows will trigger a false alarm. The 99.9th percentile reduces false alarms to 0.1% but may miss subtle anomalies. This approach requires no anomaly examples — only a sufficiently large set of normal validation data (at least 1,000 windows to estimate the 99.9th percentile reliably).

**ROC-based thresholds:** When some anomaly examples are available (even a small number from historical records), a Receiver Operating Characteristic (ROC) curve plots the true positive rate against the false positive rate across all possible thresholds. The threshold is chosen based on the application's cost balance — a safety-critical system may accept a 5% false positive rate to achieve a 99% detection rate, while a notification system may tolerate a 10% miss rate to keep false positives below 0.1%.

**Adaptive thresholds:** Rather than a fixed threshold, some systems compute the threshold as a function of operating conditions. A machine under heavy load has higher vibration than under light load — a fixed threshold tuned for heavy load misses anomalies under light load. Operating-condition-dependent thresholds require a lookup table or simple model that maps current operating parameters (load, speed, temperature) to the expected anomaly score range.

**Hysteresis:** A single threshold causes alert flapping when the anomaly score oscillates around the threshold value. Adding hysteresis — an "alarm on" threshold higher than the "alarm off" threshold — prevents rapid toggling. Typical hysteresis: alarm activates at score > T, deactivates at score < 0.8T.

## Sliding Window for Temporal Anomaly Detection

Rather than detecting anomalies in individual sensor samples, the standard approach computes features over a rolling window and detects anomalies in the feature space. This captures temporal patterns that sample-level detection misses — a gradual drift over 10 seconds, an unusual sequence of events, a change in variability.

The pipeline:

1. Collect a window of N sensor samples
2. Extract features from the window (RMS, standard deviation, spectral features, peak count)
3. Compute the anomaly score on the feature vector (Mahalanobis distance, autoencoder reconstruction error, isolation forest score)
4. Advance the window by stride S
5. Repeat

The window length determines the time resolution of anomaly detection. A 1-second window at 1 kHz sampling captures fast transients. A 60-second window captures slow trends. For predictive maintenance applications, multiple time scales are often used simultaneously — a short window (1 second) for detecting sudden failures and a long window (5–10 minutes) for detecting gradual degradation.

## Online Learning and Baseline Adaptation

Normal operating conditions change over time. Seasonal temperature variations shift sensor baselines. Gradual mechanical wear changes vibration signatures. A fixed anomaly detection model trained on initial conditions produces increasing false positives as the system drifts from the training distribution.

Approaches to baseline adaptation:

- **Periodic retraining:** Collect normal data over a recent period (e.g., last 7 days) and retrain the model. This is feasible on SBC-class devices or with cloud-assisted training. The risk is that if a slow degradation is occurring, the retrained model incorporates the degradation as "normal."
- **Running statistics:** Update mean and standard deviation incrementally using Welford's algorithm. This adapts naturally to slow drift but, like EWMA, can mask gradual degradation.
- **Dual-threshold approach:** Maintain both a fixed baseline (from commissioning) and an adaptive baseline. Flag deviations from the adaptive baseline as short-term anomalies, and flag deviations from the fixed baseline as long-term drift. This distinguishes between sudden events and gradual degradation.

The stability-plasticity dilemma is fundamental: a model that adapts quickly to new conditions will fail to detect slow degradation (it adapts to the degradation), while a model that maintains a rigid baseline will produce false positives as normal conditions drift. The appropriate balance depends on the application — condition monitoring of a bearing (where gradual degradation is the signal of interest) requires a stable baseline, while environmental monitoring (where seasonal drift is expected) requires an adaptive baseline.

## Applications

**Vibration anomaly for bearing degradation:** Accelerometer mounted on bearing housing, sampling at 12.8–25.6 kHz. Features: RMS acceleration, kurtosis, spectral energy at bearing defect frequencies. Autoencoder or Mahalanobis distance on feature vector. Early-stage bearing degradation manifests as increased kurtosis (impulsive vibration) before RMS increases, so kurtosis-sensitive detection catches faults earlier than simple RMS thresholds.

**Current draw anomaly for motor faults:** Hall-effect current sensor on motor supply line, sampling at 1–10 kHz. Features: RMS current, harmonic content of current waveform (motor current signature analysis — MCSA), startup current profile shape. Anomalies: winding short (elevated current), broken rotor bar (specific harmonic pattern), load imbalance (current fluctuation at shaft frequency).

**Temperature anomaly for thermal systems:** Thermocouple or RTD sensor, sampling at 0.1–1 Hz. Features: absolute temperature, rate of change, deviation from expected temperature at current operating point. Anomalies: coolant system failure (rapid temperature rise), insulation degradation (slow upward drift), sensor fault (sudden step change).

**Network traffic anomaly:** Packet counters and flow statistics at 1-second intervals. Features: packets per second, bytes per second, connection count, protocol distribution. Anomalies: DDoS (sudden traffic spike), data exfiltration (unusual outbound volume), port scan (connection count spike with low data volume). Isolation forests and autoencoders both work well on network traffic feature vectors.

## Tips

- Start with a statistical baseline (mean plus 3 sigma, EWMA, or Mahalanobis distance) before investing in neural approaches. Statistical methods are simpler to implement, easier to interpret, require less flash and RAM, and are often sufficient for single-sensor or low-dimensional monitoring. Only move to autoencoders or isolation forests when the normal operating envelope is too complex for statistical methods to capture.
- Collect normal data over the full operating range — different loads, temperatures, speeds, and environmental conditions. A model trained on normal data from a single operating point will flag every other operating point as anomalous. For rotating machinery, this means collecting data at multiple shaft speeds and load levels.
- The autoencoder bottleneck size determines sensitivity. A bottleneck that is too large allows anomalies to pass through with low reconstruction error. A bottleneck that is too small produces high reconstruction error on normal data, increasing false positives. Start at 10–15% of input dimension and adjust based on the normal-to-anomaly reconstruction error ratio.
- Log anomaly scores over time rather than using only a single-point threshold. Trending the anomaly score reveals gradual degradation that a fixed threshold misses until the final stage. Plotting anomaly score versus time is one of the most informative diagnostic views for a [predictive maintenance]({{< relref "predictive-maintenance" >}}) system.
- When deploying on an MCU, precompute all model parameters offline and store as constants in flash. The Mahalanobis precision matrix, the autoencoder weights, the isolation forest tree structures — none of these change at runtime. Only the anomaly score threshold may need runtime adjustment.

## Caveats

- Anomaly detection cannot identify the type of fault — only that something is abnormal. A high anomaly score from a vibration autoencoder indicates that the vibration pattern has changed but does not specify whether the cause is a bearing fault, misalignment, imbalance, or a loose bolt. Fault identification (diagnosis) requires either a classification model trained on labeled fault data or domain-expert interpretation of the feature vector that triggered the anomaly.
- Normal operating conditions change over time (seasonal temperature variation, component wear, lubricant aging), causing threshold drift. A fixed threshold tuned at commissioning will produce increasing false positives as the system ages. Periodic threshold recalibration — quarterly or after maintenance events — is necessary for long-term systems.
- Insufficient training data variety causes false positives on rare-but-normal operating modes. A machine that runs at full load only one day per week will appear anomalous on those days if the training data was collected primarily at partial load. The training data must cover the full range of expected operating conditions, including infrequent ones.
- An autoencoder trained on data from one machine may not transfer directly to nominally identical machines. Manufacturing variation, installation differences (foundation stiffness, alignment), and environmental factors (ambient temperature, nearby equipment) cause machine-to-machine baseline variation. The typical approach is to train a base model on fleet data and fine-tune on each individual machine's normal data.
- Autoencoder reconstruction error is not a probability — it has no inherent scale or meaning beyond the relative comparison between normal and anomalous inputs. Comparing reconstruction errors across different autoencoders or different input feature sets is not meaningful without normalization.

## In Practice

- **Anomaly score gradually increases over weeks, then accelerates.** This is the classic degradation curve — exactly the pattern that anomaly detection should capture. The gradual increase indicates wear progressing, and the acceleration indicates the component entering the failure region. This pattern is actionable information for [predictive maintenance]({{< relref "predictive-maintenance" >}}) scheduling, not a false alarm.
- **Sudden spike in anomaly score followed by return to normal within minutes.** This pattern indicates a transient event — machine startup, load change, material feed variation — that falls outside the training data distribution. If these transients are expected and benign, adding transient data to the normal training set resolves the false alarm. Alternatively, applying a temporal filter (anomaly must persist for N consecutive windows to trigger an alert) suppresses transient false positives.
- **Anomaly detector triggers every morning at the same time.** Ambient temperature changes at shift start (building HVAC activates, doors open) shift the sensor baseline enough to trigger the detector. The training data was collected during a narrow temperature range. Retraining with data from the full daily temperature cycle, or adding ambient temperature as an input feature, eliminates the time-of-day false positive pattern.
- **Autoencoder reconstruction error is always high, even on training data.** The bottleneck is too small — the autoencoder cannot learn to reconstruct even normal data faithfully. Increase the bottleneck dimension or reduce the input feature dimension. A common sanity check is to verify that the autoencoder reconstruction error on the training set is low (indicating successful learning) before evaluating on new data.
- **Isolation forest flags too many normal points as anomalous.** The `contamination` parameter was set too high (e.g., 0.1 means the model assumes 10% of the training data is anomalous). When training on purely normal data, set contamination to a small value (0.001–0.01) or use the `score_samples` method with a manually chosen threshold instead of the built-in `predict` method.
