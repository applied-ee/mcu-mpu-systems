---
title: "Kalman Filtering for Embedded Systems"
weight: 30
---

# Kalman Filtering for Embedded Systems

The Kalman filter is an optimal recursive estimator that fuses a process model (how the system evolves over time) with noisy measurements to produce an estimate that is statistically better than either source alone. Unlike the complementary filter, which uses a fixed blending ratio, the Kalman filter dynamically adjusts how much it trusts the model versus the measurement based on the estimated uncertainty of each. This adaptive behavior makes it more accurate but also more complex to implement and tune.

On embedded systems, the Kalman filter is practical for 1D and 2D problems (temperature estimation, tilt from IMU, barometric altitude). Higher-dimensional problems (full 6DOF pose estimation) require the Extended Kalman Filter (EKF) or Unscented Kalman Filter (UKF), which add substantial computational cost.

## State-Space Model

The Kalman filter operates on a state-space representation of the system:

**Prediction (process model):**
```
x_predicted = F * x_previous + B * u
P_predicted = F * P_previous * F^T + Q
```

**Update (measurement incorporation):**
```
K = P_predicted * H^T * (H * P_predicted * H^T + R)^(-1)
x_updated = x_predicted + K * (z - H * x_predicted)
P_updated = (I - K * H) * P_predicted
```

Where:
- **x** — state vector (what is being estimated)
- **F** — state transition matrix (how the state evolves)
- **B** — control input matrix, **u** — control input
- **P** — error covariance matrix (confidence in the estimate)
- **Q** — process noise covariance (model uncertainty)
- **R** — measurement noise covariance (sensor uncertainty)
- **H** — observation matrix (maps state to measurement)
- **K** — Kalman gain (dynamically computed blending factor)
- **z** — actual measurement

The Kalman gain K is the key quantity: when K is large, the filter trusts the measurement more; when K is small, it trusts the prediction more. K adapts automatically as P (the estimated error) evolves.

## 1D Kalman Filter: Temperature Estimation

The simplest Kalman filter case has a scalar state, scalar measurement, and constant dynamics. A temperature sensor with Gaussian noise (e.g., an NTC thermistor read through a 12-bit ADC with ±0.5C noise) and a slowly drifting true temperature fits this model.

```c
typedef struct {
    float x;    /* State estimate (temperature in C) */
    float P;    /* Estimate error covariance */
    float Q;    /* Process noise covariance */
    float R;    /* Measurement noise covariance */
    float K;    /* Kalman gain (stored for diagnostics) */
} KalmanFilter1D;

void kf1d_init(KalmanFilter1D *kf, float initial_estimate,
               float initial_P, float Q, float R) {
    kf->x = initial_estimate;
    kf->P = initial_P;
    kf->Q = Q;
    kf->R = R;
    kf->K = 0.0f;
}

float kf1d_update(KalmanFilter1D *kf, float measurement) {
    /* --- Predict step --- */
    /* State prediction: x_pred = x (constant model, no drift) */
    /* Covariance prediction: P grows by Q each step */
    float x_pred = kf->x;
    float P_pred = kf->P + kf->Q;

    /* --- Update step --- */
    /* Kalman gain */
    kf->K = P_pred / (P_pred + kf->R);
    /* State update */
    kf->x = x_pred + kf->K * (measurement - x_pred);
    /* Covariance update */
    kf->P = (1.0f - kf->K) * P_pred;

    return kf->x;
}
```

Initialization with realistic values for an NTC thermistor through a 12-bit ADC:

```c
KalmanFilter1D temp_kf;
/* Q = 0.01: temperature changes slowly (0.01 C^2 per sample)
   R = 0.25: measurement noise variance (0.5 C standard deviation)^2
   Initial P = 1.0: moderate initial uncertainty */
kf1d_init(&temp_kf, 25.0f, 1.0f, 0.01f, 0.25f);

/* In the main loop at 10 Hz: */
float raw_temp = read_ntc_temperature();
float filtered_temp = kf1d_update(&temp_kf, raw_temp);
```

After startup, the Kalman gain K settles to a steady-state value within 10-20 iterations. For this configuration, the steady-state K is approximately 0.038, which means each new measurement moves the estimate by only 3.8% of the measurement residual — heavy smoothing, appropriate for a slow-changing temperature.

## Q and R Tuning

The ratio Q/R determines the filter's personality. Q represents how much the true state is expected to change between samples. R represents the measurement noise variance. The absolute values of Q and R matter less than their ratio for steady-state behavior, but affect the transient convergence rate.

| Q/R Ratio | Kalman Gain K | Behavior | Equivalent to |
|-----------|---------------|----------|---------------|
| Q >> R | K close to 1.0 | Trusts measurement, fast response, noisy output | Light smoothing |
| Q = R | K ~ 0.5 | Balanced | Moderate smoothing |
| Q << R | K close to 0.0 | Trusts model, slow response, very smooth output | Heavy smoothing |
| Q/R = 0.01 | K ~ 0.1 (steady state) | Typical for temperature sensors | EMA with small alpha |
| Q/R = 1.0 | K ~ 0.5 (steady state) | Tracks rapid changes, limited smoothing | Minimal filtering |

Practical tuning approach:

1. Set R from the known sensor noise — measure the sensor variance at a constant input (e.g., fixed temperature, stationary IMU). On an MPU-6050 accelerometer in ±2g mode, the noise variance is approximately 0.002 g^2.
2. Set Q from the expected rate of change of the true signal. For a temperature changing at most 0.1 C/s sampled at 10 Hz, Q ~ (0.01)^2 = 0.0001 C^2 per sample.
3. Observe the output. If too noisy, reduce Q. If too sluggish, increase Q.

## 2D Kalman Filter: Angle from Gyro + Accelerometer

Estimating tilt angle from a gyroscope and accelerometer is a natural 2D Kalman problem. The state vector contains the angle and the gyroscope bias:

```
x = [angle, gyro_bias]^T
```

The process model integrates the gyroscope rate (minus estimated bias):

```
angle_new = angle_old + (gyro_rate - gyro_bias) * dt
bias_new  = bias_old    (bias modeled as random walk)
```

The measurement is the accelerometer-derived angle.

```c
typedef struct {
    float angle;        /* Estimated angle (degrees) */
    float bias;         /* Estimated gyroscope bias (deg/s) */
    float P[2][2];      /* 2x2 error covariance matrix */
    float Q_angle;      /* Process noise for angle */
    float Q_bias;       /* Process noise for bias (random walk) */
    float R_measure;    /* Measurement noise (accelerometer) */
    float dt;           /* Sample period */
} KalmanFilter2D;

void kf2d_init(KalmanFilter2D *kf, float dt) {
    kf->angle = 0.0f;
    kf->bias = 0.0f;
    kf->dt = dt;

    /* Tuning parameters — starting point for MPU-6050 at 100 Hz */
    kf->Q_angle   = 0.001f;   /* Angle process noise */
    kf->Q_bias    = 0.003f;   /* Bias random walk noise */
    kf->R_measure = 0.03f;    /* Accelerometer measurement noise */

    /* Initial covariance: moderate uncertainty */
    kf->P[0][0] = 1.0f;  kf->P[0][1] = 0.0f;
    kf->P[1][0] = 0.0f;  kf->P[1][1] = 1.0f;
}

float kf2d_update(KalmanFilter2D *kf, float gyro_rate_dps,
                  float accel_angle_deg) {
    /* ---- Predict step ---- */
    /* State prediction */
    float rate = gyro_rate_dps - kf->bias;
    kf->angle += rate * kf->dt;

    /* Covariance prediction: P = F*P*F^T + Q */
    kf->P[0][0] += kf->dt * (kf->dt * kf->P[1][1]
                   - kf->P[0][1] - kf->P[1][0] + kf->Q_angle);
    kf->P[0][1] -= kf->dt * kf->P[1][1];
    kf->P[1][0] -= kf->dt * kf->P[1][1];
    kf->P[1][1] += kf->Q_bias;

    /* ---- Update step ---- */
    /* Innovation (measurement residual) */
    float y = accel_angle_deg - kf->angle;

    /* Innovation covariance: S = H*P*H^T + R */
    float S = kf->P[0][0] + kf->R_measure;

    /* Kalman gain: K = P*H^T / S */
    float K0 = kf->P[0][0] / S;
    float K1 = kf->P[1][0] / S;

    /* State update */
    kf->angle += K0 * y;
    kf->bias  += K1 * y;

    /* Covariance update: P = (I - K*H) * P */
    float P00_temp = kf->P[0][0];
    float P01_temp = kf->P[0][1];
    kf->P[0][0] -= K0 * P00_temp;
    kf->P[0][1] -= K0 * P01_temp;
    kf->P[1][0] -= K1 * P00_temp;
    kf->P[1][1] -= K1 * P01_temp;

    return kf->angle;
}
```

Usage in a 100 Hz timer interrupt:

```c
static KalmanFilter2D pitch_kf;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM2) {
        float ax, ay, az, gx, gy, gz;
        mpu6050_read_all(&ax, &ay, &az, &gx, &gy, &gz);

        float accel_pitch = atan2f(-ax, sqrtf(ay*ay + az*az))
                            * (180.0f / M_PI);
        float pitch = kf2d_update(&pitch_kf, gy, accel_pitch);

        /* pitch now contains the Kalman-filtered angle */
    }
}
```

The 2D Kalman filter automatically estimates and removes gyroscope bias — a significant advantage over the complementary filter, which requires manual bias calibration at startup. The bias estimate converges within 5-10 seconds of stationary data.

## Tuning Walkthrough

Starting with the 2D angle filter and an MPU-6050 at 100 Hz:

**Step 1: Measure R.** Place the sensor flat and stationary. Compute the accelerometer-derived pitch angle for 1000 samples. The variance of those samples is R_measure. Typical value: 0.03-0.1 deg^2 for the MPU-6050.

**Step 2: Set Q_angle.** This controls how fast the filter tracks true angle changes. Start with Q_angle = 0.001. If the filter response is too sluggish for step inputs, increase toward 0.01. If noisy, decrease toward 0.0001.

**Step 3: Set Q_bias.** This controls how fast the filter adapts to gyroscope bias drift. A higher value tracks bias changes faster but makes the angle estimate noisier. Start with Q_bias = 0.003. MEMS gyro bias changes slowly (thermal drift over minutes), so Q_bias should generally be smaller than Q_angle.

**Step 4: Validate.** Log the filter output alongside raw sensor data and the Kalman gain. The gain should settle to a steady value within 20-50 iterations. Abrupt jumps in K indicate that Q or R needs adjustment.

| Symptom | Likely Cause | Adjustment |
|---------|-------------|------------|
| Output too noisy | Q_angle too large | Reduce Q_angle by 10x |
| Output too sluggish, slow step response | Q_angle too small | Increase Q_angle by 10x |
| Gyro bias not converging | Q_bias too small | Increase Q_bias |
| Angle estimate wanders slowly | Q_bias too large | Decrease Q_bias |
| Filter diverges (P grows without bound) | R set too small | Increase R_measure |

## Computational Cost

The 1D Kalman filter requires approximately 5 multiplications and 5 additions per update — comparable to an EMA filter. The 2D filter requires approximately 25 multiplications and 20 additions. On a 48 MHz Cortex-M0+ without FPU, the 2D float32 update takes roughly 15-25 microseconds (using software float emulation). On a 168 MHz Cortex-M4F with FPU, the same update completes in under 2 microseconds.

For higher-dimensional state vectors (4D, 6D), the matrix operations dominate. An N-dimensional Kalman filter involves N x N matrix multiplication (O(N^3) operations per update), which limits practical real-time implementations on Cortex-M to approximately N = 6-12 states at 100 Hz.

## Fixed-Point Considerations

Running a Kalman filter in fixed-point arithmetic is possible but requires careful scaling. The covariance matrix P contains values that span many orders of magnitude as the filter converges — starting at P = 1.0 and settling to P ~ 0.001 or smaller. Q15 format (range -1 to +1) cannot represent this range without dynamic scaling.

The practical approaches:

1. **Use float32 on Cortex-M4F/M7** — the FPU makes single-precision float faster than equivalent fixed-point for matrix operations. The 2D Kalman filter fits comfortably in the cycle budget.
2. **Use Q16.16 on Cortex-M0/M3** — 16 bits of integer range and 16 bits of fractional precision cover most covariance ranges, but overflow checking is essential during the P prediction step.
3. **Use the CMSIS-DSP matrix functions** — `arm_mat_mult_f32()`, `arm_mat_inverse_f32()`, and `arm_mat_add_f32()` provide optimized building blocks for larger Kalman filters.

For the 1D and 2D filters presented here, float32 on any Cortex-M4F is the path of least resistance. Fixed-point Kalman filters become worthwhile only on Cortex-M0 targets where the software float library adds unacceptable latency.

## Tips

- Always measure R from actual sensor data rather than relying on datasheet noise specifications — the datasheet reports noise density (e.g., 300 ug/sqrt(Hz)), but the variance seen in firmware depends on the sample rate, digital filtering in the sensor, and environmental vibration.
- Log the Kalman gain K during development — it is the single best diagnostic for filter health. K should converge to a steady-state value within tens of iterations. If K keeps changing or oscillates, the Q/R ratio needs adjustment.
- Initialize P to a relatively large value (1.0 to 10.0) to allow the filter to converge quickly from an unknown initial state. Setting P = 0 effectively tells the filter it already has a perfect estimate and prevents it from incorporating new measurements.
- For the 2D angle filter, the bias estimate is valuable beyond the filter itself — logging the estimated bias over time reveals gyroscope thermal drift characteristics that inform startup calibration procedures.

## Caveats

- The standard Kalman filter assumes linear dynamics and Gaussian noise. Accelerometer-derived angle (via atan2) is a nonlinear function of the measurements, so the 2D filter presented here is technically misapplied — the measurement model is nonlinear. For moderate angles (±45 degrees), the linearization error is small. For full-range operation, an Extended Kalman Filter (EKF) with the proper Jacobian is more correct.
- Setting Q = 0 tells the filter that the model is perfect. The covariance P will monotonically decrease toward zero, and the filter will eventually ignore all measurements entirely. This is irreversible unless the filter is reset or Q is increased.
- Numerical precision issues can cause the covariance matrix P to lose symmetry or become non-positive-definite over long runs. On float32, this manifests after hours or days of continuous operation. The Joseph form of the covariance update (`P = (I - K*H)*P*(I - K*H)^T + K*R*K^T`) is more numerically stable than the simple form but costs more computation.
- Kalman filter performance degrades gracefully when noise is non-Gaussian — it remains the best linear estimator — but the optimality guarantee is lost. Heavy-tailed noise (e.g., impulse interference from motors) causes larger transient errors than Gaussian analysis predicts.

## In Practice

- **A Kalman filter that produces a very smooth output but lags behind rapid changes by several hundred milliseconds** has Q set too small relative to R. The filter trusts its prediction too much and incorporates measurements too slowly. Increasing Q_angle by a factor of 10 and observing whether the step response improves is the standard diagnostic cycle.

- **Kalman gain that starts near 1.0 and decreases to a small value over the first second of operation** is normal convergence behavior. The filter begins uncertain (large P), so it trusts measurements heavily (large K). As confidence builds (P decreases), K decreases. If K decreases to nearly zero and stays there, Q is likely too small — the filter becomes overconfident.

- **An angle estimate that slowly walks away from the true value over minutes** despite correct stationary behavior indicates that the process model does not capture a real dynamic. For the 2D angle filter, this often means Q_bias is too small to track the actual rate of gyroscope bias drift. Logging the estimated bias and comparing it to the known stationary gyro output reveals whether the bias estimate is tracking reality.

- **Spikes in the Kalman-filtered output that track transient accelerometer disturbances** (bumps, taps, brief linear acceleration) indicate that R_measure is set too small. The filter trusts the accelerometer too much during these transients. Increasing R_measure reduces sensitivity to accelerometer disturbances at the cost of slower convergence from the accelerometer reference during quiet periods.

- **The 2D angle filter output closely matching a complementary filter with alpha = 0.98** is not a coincidence. The steady-state Kalman gain for typical IMU noise parameters often produces behavior equivalent to a complementary filter with alpha in the 0.95-0.99 range. The Kalman filter's advantage is automatic bias estimation and the ability to adapt K during transients — but for many applications, the simpler complementary filter achieves comparable results with less implementation effort.
