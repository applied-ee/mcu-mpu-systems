---
title: "Complementary Filters"
weight: 20
---

# Complementary Filters

A complementary filter fuses two sensor measurements of the same physical quantity by trusting each sensor in its reliable frequency band. The classic application is tilt estimation from a gyroscope and accelerometer: the gyroscope provides accurate short-term angle changes but drifts over time (low-frequency error), while the accelerometer provides a stable long-term gravity reference but is corrupted by vibration and linear acceleration (high-frequency error). Passing the gyroscope through a high-pass filter and the accelerometer through a low-pass filter, with the two filters summing to unity at all frequencies, produces an estimate that rejects both drift and vibration noise. The result is surprisingly effective for a filter that requires only a single tuning parameter.

## Principle: High-Pass + Low-Pass = Unity

The complementary filter is defined by:

```
angle = alpha * (angle + gyro_rate * dt) + (1 - alpha) * accel_angle
```

Breaking this apart:
- `alpha * (angle + gyro_rate * dt)` — high-pass filter on the gyroscope. The gyro integral provides the angle, but alpha < 1 means old gyro data decays exponentially, preventing drift accumulation.
- `(1 - alpha) * accel_angle` — low-pass filter on the accelerometer. Only the slowly-varying component of the accelerometer-derived angle passes through.

The two filters are complementary because their transfer functions sum to 1.0 at all frequencies:

```
H_hp(z) + H_lp(z) = 1
```

This means no signal energy is lost or gained — the filter preserves the true angle signal while rejecting the noise from each sensor in the frequency band where that sensor is unreliable.

## Derivation from Time Constant

The single tuning parameter alpha relates to a time constant tau and the sample period dt:

```
alpha = tau / (tau + dt)
```

At a 100 Hz sample rate (dt = 0.01 s) with tau = 0.5 s:

```
alpha = 0.5 / (0.5 + 0.01) = 0.98
```

The time constant tau defines the crossover frequency between the gyro and accelerometer contributions: `f_crossover = 1 / (2 * pi * tau)`. With tau = 0.5 s, the crossover is approximately 0.32 Hz. Below this frequency, the accelerometer dominates; above it, the gyroscope dominates.

Typical tau values for tilt estimation:

| Application | tau (s) | alpha at 100 Hz | Crossover Frequency |
|-------------|---------|-----------------|---------------------|
| Handheld device, gentle motion | 0.5 | 0.980 | 0.32 Hz |
| Robot balancing | 1.0 | 0.990 | 0.16 Hz |
| Slow-moving platform (gimbal) | 2.0 | 0.995 | 0.08 Hz |
| High vibration environment | 0.2 | 0.952 | 0.80 Hz |

Larger tau means more trust in the gyroscope (longer before accelerometer corrections take effect). Smaller tau means the accelerometer corrects faster but allows more vibration noise through.

## 1D Complementary Filter: Pitch from Gyro + Accelerometer

The implementation below reads an MPU-6050 accelerometer/gyroscope and computes pitch angle:

```c
#include <math.h>

typedef struct {
    float angle;       /* Current estimated angle (degrees) */
    float alpha;       /* Filter coefficient (0.9 - 0.999 typical) */
    float dt;          /* Sample period (seconds) */
} ComplementaryFilter;

void cf_init(ComplementaryFilter *cf, float tau, float sample_rate) {
    cf->dt = 1.0f / sample_rate;
    cf->alpha = tau / (tau + cf->dt);
    cf->angle = 0.0f;
}

float cf_update(ComplementaryFilter *cf, float gyro_rate_dps,
                float accel_angle_deg) {
    /* Gyro integration (high-pass path) */
    float gyro_angle = cf->angle + gyro_rate_dps * cf->dt;
    /* Complementary combination */
    cf->angle = cf->alpha * gyro_angle +
                (1.0f - cf->alpha) * accel_angle_deg;
    return cf->angle;
}
```

The accelerometer angle is computed from the raw accelerometer axes before passing it to the filter:

```c
float compute_pitch_from_accel(float ax, float ay, float az) {
    /* atan2 handles all quadrants correctly */
    return atan2f(-ax, sqrtf(ay * ay + az * az)) * (180.0f / M_PI);
}
```

A complete update cycle using STM32 HAL and an MPU-6050 on I2C:

```c
/* Read raw sensor data from MPU-6050 */
uint8_t raw[14];
HAL_I2C_Mem_Read(&hi2c1, MPU6050_ADDR << 1, 0x3B,
                 I2C_MEMADD_SIZE_8BIT, raw, 14, 100);

/* Parse accelerometer (±2g, sensitivity 16384 LSB/g) */
int16_t ax_raw = (raw[0] << 8) | raw[1];
int16_t ay_raw = (raw[2] << 8) | raw[3];
int16_t az_raw = (raw[4] << 8) | raw[5];
float ax = ax_raw / 16384.0f;
float ay = ay_raw / 16384.0f;
float az = az_raw / 16384.0f;

/* Parse gyroscope X-axis (±250 dps, sensitivity 131 LSB/dps) */
int16_t gx_raw = (raw[8] << 8) | raw[9];
float gyro_x_dps = gx_raw / 131.0f;

/* Compute accelerometer-derived pitch */
float accel_pitch = compute_pitch_from_accel(ax, ay, az);

/* Update complementary filter */
float pitch = cf_update(&pitch_filter, gyro_x_dps, accel_pitch);
```

## 2D Extension: Pitch and Roll

Extending to two axes (pitch and roll) requires two independent complementary filters — one per axis. The gyroscope axes map directly: X-axis gyro rate for roll, Y-axis gyro rate for pitch (assuming standard aerospace convention with Z pointing down).

```c
typedef struct {
    ComplementaryFilter pitch;
    ComplementaryFilter roll;
} ComplementaryFilter2D;

void cf2d_init(ComplementaryFilter2D *cf, float tau, float sample_rate) {
    cf_init(&cf->pitch, tau, sample_rate);
    cf_init(&cf->roll, tau, sample_rate);
}

void cf2d_update(ComplementaryFilter2D *cf,
                 float gx_dps, float gy_dps, float gz_dps,
                 float ax, float ay, float az,
                 float *pitch_out, float *roll_out) {
    /* Accelerometer-derived angles */
    float accel_pitch = atan2f(-ax, sqrtf(ay * ay + az * az))
                        * (180.0f / M_PI);
    float accel_roll  = atan2f(ay, az) * (180.0f / M_PI);

    /* Independent complementary filters on each axis */
    *pitch_out = cf_update(&cf->pitch, gy_dps, accel_pitch);
    *roll_out  = cf_update(&cf->roll,  gx_dps, accel_roll);
}
```

This approach works well for pitch and roll up to about ±60 degrees. Beyond that, the atan2 calculation introduces coupling between axes. For full 360-degree operation or high-dynamic applications, quaternion-based methods (Madgwick, Mahony) become necessary.

## Comparison: Raw Gyro vs. Raw Accel vs. Complementary

The performance difference is immediate when plotted. On an MPU-6050 at 100 Hz sample rate with alpha = 0.98:

| Scenario | Raw Gyro (integrated) | Raw Accelerometer | Complementary (alpha=0.98) |
|----------|-----------------------|-------------------|---------------------------|
| **Static, no vibration** | Drifts 1-5 deg/min | Stable within ±0.5 deg | Stable within ±0.5 deg |
| **Slow tilt (0.1 Hz)** | Accurate short-term, drifts | Accurate but noisy (±2 deg) | Accurate, low noise |
| **Walking/vibration** | Accurate short-term | ±10-20 deg noise | ±1-2 deg noise |
| **Fast rotation (5 Hz)** | Accurate | Severely corrupted | Accurate, slight lag |
| **After 60 seconds static** | 5-60 deg accumulated drift | Stable | Stable, no drift |

The key insight: the complementary filter inherits the gyroscope's excellent short-term accuracy and the accelerometer's long-term stability, while rejecting both gyro drift and accelerometer vibration noise.

## Yaw Limitation

The complementary filter as described has no mechanism for correcting yaw (heading) drift. The accelerometer measures gravity, which provides pitch and roll references, but gravity has no horizontal directional component. Yaw from gyroscope integration drifts without bound.

Correcting yaw requires a horizontal reference — typically a magnetometer. The same complementary filter structure can extend to yaw by fusing the Z-axis gyroscope rate with the magnetometer-derived heading:

```c
float mag_heading = atan2f(my, mx) * (180.0f / M_PI);
float yaw = cf_update(&yaw_filter, gz_dps, mag_heading);
```

However, magnetometer data brings its own problems — hard-iron and soft-iron distortion, tilt compensation requirements, and sensitivity to nearby ferromagnetic materials. For robust 3-axis orientation, the AHRS algorithms (Madgwick, Mahony) provide a more principled framework than stacking complementary filters.

## Sample Rate Sensitivity

The alpha parameter must be recalculated if the sample rate changes. Alpha = 0.98 at 100 Hz gives tau = 0.49 s. Using the same alpha at 500 Hz gives tau = 0.098 s — five times faster time constant, which makes the filter much more sensitive to accelerometer noise. The correct practice is to compute alpha from tau and the actual dt at initialization, not to hardcode alpha.

If the sample rate is not perfectly stable (common with software timers or polled loops), computing dt from the actual elapsed time each iteration improves accuracy:

```c
uint32_t now = HAL_GetTick();
float dt = (now - last_tick) * 0.001f;
last_tick = now;
cf->dt = dt;
cf->alpha = tau / (tau + dt);
```

This runtime alpha computation adds one division per update but eliminates sensitivity to timing jitter.

## Tips

- Start with alpha = 0.98 at 100 Hz (tau ~ 0.5 s) as a first estimate for general tilt sensing — this works well for the MPU-6050, ICM-20948, and similar MEMS IMUs.
- Calibrate the gyroscope bias at startup by averaging 500-1000 samples while the sensor is stationary, then subtract the bias from every reading. Uncorrected bias is the primary source of complementary filter drift before tau corrections take effect.
- Log raw gyro-integrated angle, raw accel angle, and complementary filter output simultaneously during tuning — the three traces make the filter's behavior immediately obvious and guide tau adjustment.
- Compute alpha from tau and the measured dt, never hardcode it — this prevents subtle breakage when porting between platforms with different timer resolutions.

## Caveats

- The complementary filter assumes gravity is the only significant acceleration. During linear acceleration (driving, rocket launch, elevator), the accelerometer measures gravity + motion, and the accelerometer-derived angle becomes incorrect. The filter will slowly converge to the wrong angle with a time constant of tau. Applications subject to sustained linear acceleration need either a higher alpha (trust gyro longer) or a detection mechanism that increases alpha during motion transients.
- At pitch or roll angles near ±90 degrees, the atan2-based accelerometer angle calculation loses resolution because the gravity vector becomes nearly parallel to the measurement axis. The angle noise increases dramatically near gimbal lock orientations. Quaternion-based methods avoid this singularity entirely.
- Two independent complementary filters for pitch and roll do not account for cross-axis coupling. When rolling 45 degrees, a pitch rotation also affects the roll axis and vice versa. For moderate angles (±30 degrees), this coupling is small. Beyond ±60 degrees, the errors become significant.
- Timer jitter in the sample loop directly translates to angle error in the gyroscope integration. A 10% variation in dt at 100 Hz introduces about 1% error per sample in the gyro path. Hardware timer interrupts provide more stable timing than software delay loops.

## In Practice

- **A complementary filter output that slowly drifts in one direction** despite the sensor being stationary usually indicates uncorrected gyroscope bias. The bias (typically 1-5 deg/s on MEMS gyros) integrates continuously, and the accelerometer correction can only pull back at a rate determined by (1 - alpha). With alpha = 0.98, the correction is only 2% per sample — insufficient to counteract a large bias. Subtracting the startup-calibrated bias resolves the drift.

- **Pitch or roll that oscillates between two values when the device is tapped or bumped** is the complementary filter responding correctly: the gyroscope captures the brief rotation, the accelerometer sees the vibration-corrupted gravity vector, and the filter blends them. The oscillation decays with time constant tau. If the oscillation amplitude is unacceptable, increasing alpha reduces accelerometer influence during transients at the cost of slower drift correction.

- **A filter that behaves well at 100 Hz but becomes noisy after increasing the sample rate to 500 Hz without recalculating alpha** demonstrates the coupling between alpha and dt. The same alpha value at a higher sample rate produces a shorter effective time constant, admitting more high-frequency accelerometer noise. Recomputing alpha from the original tau and the new dt restores the intended behavior.

- **Heading (yaw) angle that drifts at a constant rate** is expected behavior — the complementary filter on pitch and roll cannot correct yaw without an external heading reference. The drift rate equals the Z-axis gyroscope bias, typically 1-10 deg/s on consumer MEMS parts. A magnetometer-fused yaw complementary filter or a full AHRS algorithm is required for stable heading.
