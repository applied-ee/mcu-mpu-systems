---
title: "AHRS & Multi-Sensor Fusion"
weight: 40
---

# AHRS & Multi-Sensor Fusion

An AHRS (Attitude and Heading Reference System) fuses accelerometer, gyroscope, and magnetometer data to produce a continuous, drift-free estimate of 3D orientation — pitch, roll, and yaw. While complementary and Kalman filters handle one or two axes well, full 3D orientation requires algorithms that operate on quaternion representations to avoid the singularities (gimbal lock) inherent in Euler angles. The two most widely used open-source AHRS algorithms for embedded systems are the Madgwick filter and the Mahony filter, both designed to run efficiently on Cortex-M microcontrollers.

## Why Quaternions, Not Euler Angles

Euler angles (pitch, roll, yaw) are intuitive for display but problematic for computation. At ±90 degrees pitch, the yaw and roll axes align — a singularity called gimbal lock — and the representation loses one degree of freedom. Interpolation between orientations is discontinuous, and the order of rotations matters (there are 12 possible Euler angle conventions).

A quaternion `q = [w, x, y, z]` represents orientation as a single rotation about an arbitrary axis. It has four components but only three degrees of freedom (the quaternion must have unit norm: w^2 + x^2 + y^2 + z^2 = 1). Quaternion advantages:

| Property | Euler Angles | Quaternion |
|----------|-------------|------------|
| Gimbal lock | Present at ±90 deg pitch | None |
| Interpolation | Discontinuous | Smooth (SLERP) |
| Composition | 3 sequential rotations, order-dependent | Single quaternion multiply |
| Singularity-free | No | Yes |
| Storage | 3 floats | 4 floats |
| Computational cost to rotate a vector | ~20 trig ops | ~24 multiply + add |

All AHRS algorithms operate internally on quaternions and convert to Euler angles only for output.

## Quaternion to Euler Conversion

The conversion from unit quaternion to aerospace-convention Euler angles (ZYX rotation order):

```c
typedef struct {
    float w, x, y, z;
} Quaternion;

typedef struct {
    float pitch;   /* Rotation about Y axis (degrees) */
    float roll;    /* Rotation about X axis (degrees) */
    float yaw;     /* Rotation about Z axis (degrees) */
} EulerAngles;

EulerAngles quaternion_to_euler(const Quaternion *q) {
    EulerAngles e;
    float sinr_cosp = 2.0f * (q->w * q->x + q->y * q->z);
    float cosr_cosp = 1.0f - 2.0f * (q->x * q->x + q->y * q->y);
    e.roll = atan2f(sinr_cosp, cosr_cosp) * (180.0f / M_PI);

    float sinp = 2.0f * (q->w * q->y - q->z * q->x);
    if (fabsf(sinp) >= 1.0f)
        e.pitch = copysignf(90.0f, sinp);  /* Clamp at ±90 */
    else
        e.pitch = asinf(sinp) * (180.0f / M_PI);

    float siny_cosp = 2.0f * (q->w * q->z + q->x * q->y);
    float cosy_cosp = 1.0f - 2.0f * (q->y * q->y + q->z * q->z);
    e.yaw = atan2f(siny_cosp, cosy_cosp) * (180.0f / M_PI);

    return e;
}
```

This conversion should only be performed for output (display, telemetry, logging). Internal computations — rotating vectors, composing rotations, computing error signals — should remain in quaternion form.

## Madgwick Filter

The Madgwick filter (Sebastian Madgwick, 2010) uses gradient descent to find the orientation that aligns the measured gravity and magnetic field vectors with their expected directions. The gradient descent step provides the correction signal, which is blended with gyroscope integration.

The key tuning parameter is **beta**, which controls the magnitude of the gradient descent correction. Higher beta produces faster convergence but more noise; lower beta trusts the gyroscope more and responds to reference vectors more slowly.

| Beta Value | Behavior |
|------------|----------|
| 0.01 | Very smooth, slow convergence, trusts gyro heavily |
| 0.041 | Default — good balance for MPU-9250 at 100 Hz |
| 0.1 | Fast convergence, noisier, suitable for high-vibration |
| 0.5 | Essentially follows accelerometer/magnetometer directly |

Simplified Madgwick AHRS update (6-axis, accelerometer + gyroscope, no magnetometer):

```c
typedef struct {
    float q0, q1, q2, q3;  /* Quaternion (w, x, y, z) */
    float beta;             /* Gradient descent step size */
    float sample_period;    /* dt in seconds */
} MadgwickAHRS;

void madgwick_init(MadgwickAHRS *ahrs, float beta, float sample_rate) {
    ahrs->q0 = 1.0f;
    ahrs->q1 = 0.0f;
    ahrs->q2 = 0.0f;
    ahrs->q3 = 0.0f;
    ahrs->beta = beta;
    ahrs->sample_period = 1.0f / sample_rate;
}

void madgwick_update_imu(MadgwickAHRS *ahrs,
                         float gx, float gy, float gz,
                         float ax, float ay, float az) {
    float q0 = ahrs->q0, q1 = ahrs->q1;
    float q2 = ahrs->q2, q3 = ahrs->q3;
    float dt = ahrs->sample_period;

    /* Normalize accelerometer measurement */
    float norm = sqrtf(ax*ax + ay*ay + az*az);
    if (norm < 1e-6f) return;  /* Freefall — skip correction */
    ax /= norm; ay /= norm; az /= norm;

    /* Gradient descent corrective step
       Objective: minimize error between measured gravity
       and expected gravity rotated by quaternion */
    float f1 = 2.0f*(q1*q3 - q0*q2) - ax;
    float f2 = 2.0f*(q0*q1 + q2*q3) - ay;
    float f3 = 2.0f*(0.5f - q1*q1 - q2*q2) - az;

    /* Jacobian^T * f (gradient) */
    float s0 = -2.0f*q2*f1 + 2.0f*q1*f2;
    float s1 =  2.0f*q3*f1 + 2.0f*q0*f2 - 4.0f*q1*f3;
    float s2 = -2.0f*q0*f1 + 2.0f*q3*f2 - 4.0f*q2*f3;
    float s3 =  2.0f*q1*f1 + 2.0f*q2*f2;

    /* Normalize gradient step */
    norm = sqrtf(s0*s0 + s1*s1 + s2*s2 + s3*s3);
    if (norm > 1e-6f) {
        s0 /= norm; s1 /= norm; s2 /= norm; s3 /= norm;
    }

    /* Apply gyroscope quaternion derivative */
    float qDot0 = 0.5f * (-q1*gx - q2*gy - q3*gz);
    float qDot1 = 0.5f * ( q0*gx + q2*gz - q3*gy);
    float qDot2 = 0.5f * ( q0*gy - q1*gz + q3*gx);
    float qDot3 = 0.5f * ( q0*gz + q1*gy - q2*gx);

    /* Fuse: gyro integration minus gradient correction */
    q0 += (qDot0 - ahrs->beta * s0) * dt;
    q1 += (qDot1 - ahrs->beta * s1) * dt;
    q2 += (qDot2 - ahrs->beta * s2) * dt;
    q3 += (qDot3 - ahrs->beta * s3) * dt;

    /* Normalize quaternion */
    norm = sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    ahrs->q0 = q0/norm; ahrs->q1 = q1/norm;
    ahrs->q2 = q2/norm; ahrs->q3 = q3/norm;
}
```

Gyroscope inputs (gx, gy, gz) must be in **radians per second**, not degrees per second. Forgetting this conversion is one of the most common integration errors — the filter will appear to work but with incorrect scaling, producing angles that overshoot or undershoot by a factor of pi/180.

The full 9-axis Madgwick update (with magnetometer) adds approximately 50% more computation and requires magnetic field normalization and compensation for magnetic inclination angle. The reference implementation by Madgwick is publicly available and widely ported to STM32 HAL, ESP-IDF, and Arduino.

## Mahony Filter

The Mahony filter (Robert Mahony, 2008) uses a proportional-integral (PI) controller on the orientation error rather than gradient descent. The error is computed as the cross product between the measured gravity/magnetic field vectors and the expected vectors rotated by the current orientation estimate.

```c
typedef struct {
    float q0, q1, q2, q3;  /* Quaternion */
    float Kp;               /* Proportional gain */
    float Ki;               /* Integral gain */
    float ex_int, ey_int, ez_int;  /* Integral error terms */
    float sample_period;
} MahonyAHRS;

void mahony_init(MahonyAHRS *ahrs, float Kp, float Ki,
                 float sample_rate) {
    ahrs->q0 = 1.0f;
    ahrs->q1 = 0.0f;
    ahrs->q2 = 0.0f;
    ahrs->q3 = 0.0f;
    ahrs->Kp = Kp;
    ahrs->Ki = Ki;
    ahrs->ex_int = 0.0f;
    ahrs->ey_int = 0.0f;
    ahrs->ez_int = 0.0f;
    ahrs->sample_period = 1.0f / sample_rate;
}

void mahony_update_imu(MahonyAHRS *ahrs,
                       float gx, float gy, float gz,
                       float ax, float ay, float az) {
    float q0 = ahrs->q0, q1 = ahrs->q1;
    float q2 = ahrs->q2, q3 = ahrs->q3;
    float dt = ahrs->sample_period;

    /* Normalize accelerometer */
    float norm = sqrtf(ax*ax + ay*ay + az*az);
    if (norm < 1e-6f) return;
    ax /= norm; ay /= norm; az /= norm;

    /* Estimated direction of gravity from current quaternion */
    float vx = 2.0f*(q1*q3 - q0*q2);
    float vy = 2.0f*(q0*q1 + q2*q3);
    float vz = q0*q0 - q1*q1 - q2*q2 + q3*q3;

    /* Error is cross product between measured and estimated gravity */
    float ex = ay*vz - az*vy;
    float ey = az*vx - ax*vz;
    float ez = ax*vy - ay*vx;

    /* Integral feedback (if Ki > 0) */
    if (ahrs->Ki > 0.0f) {
        ahrs->ex_int += ahrs->Ki * ex * dt;
        ahrs->ey_int += ahrs->Ki * ey * dt;
        ahrs->ez_int += ahrs->Ki * ez * dt;
        gx += ahrs->ex_int;
        gy += ahrs->ey_int;
        gz += ahrs->ez_int;
    }

    /* Proportional feedback */
    gx += ahrs->Kp * ex;
    gy += ahrs->Kp * ey;
    gz += ahrs->Kp * ez;

    /* Integrate quaternion rate */
    float qDot0 = 0.5f * (-q1*gx - q2*gy - q3*gz);
    float qDot1 = 0.5f * ( q0*gx + q2*gz - q3*gy);
    float qDot2 = 0.5f * ( q0*gy - q1*gz + q3*gx);
    float qDot3 = 0.5f * ( q0*gz + q1*gy - q2*gx);

    q0 += qDot0 * dt;
    q1 += qDot1 * dt;
    q2 += qDot2 * dt;
    q3 += qDot3 * dt;

    /* Normalize */
    norm = sqrtf(q0*q0 + q1*q1 + q2*q2 + q3*q3);
    ahrs->q0 = q0/norm; ahrs->q1 = q1/norm;
    ahrs->q2 = q2/norm; ahrs->q3 = q3/norm;
}
```

Typical starting values: Kp = 2.0, Ki = 0.005 at 100 Hz. The integral term compensates for persistent gyroscope bias, similar to the bias estimation in the 2D Kalman filter. Setting Ki = 0 degrades the Mahony filter to a proportional-only correction, which functions similarly to a complementary filter with quaternion representation.

## Magnetic Distortion Compensation

Magnetometer data is corrupted by two types of distortion:

**Hard-iron distortion** — constant offsets from permanently magnetized materials near the sensor (e.g., speaker magnets, battery contacts, PCB ground planes with DC current). The magnetometer output is shifted from the origin. Compensation requires subtracting the offset vector, determined by rotating the sensor through all orientations and finding the center of the resulting sphere (or ellipsoid):

```c
/* Hard-iron calibration offsets (determined offline) */
float mag_offset_x = 125.0f;   /* Typical offset in LSB */
float mag_offset_y = -42.0f;
float mag_offset_z = 88.0f;

mx_cal = mx_raw - mag_offset_x;
my_cal = my_raw - mag_offset_y;
mz_cal = mz_raw - mag_offset_z;
```

**Soft-iron distortion** — scaling and rotation from nearby ferromagnetic materials that distort the field non-uniformly. The sphere of magnetometer readings becomes an ellipsoid. Compensation requires a 3x3 correction matrix, typically computed offline from a full-rotation calibration dataset using least-squares ellipsoid fitting.

Without calibration, the magnetometer heading error ranges from 5 to 30 degrees in typical indoor environments. With hard-iron calibration only, the error reduces to 2-5 degrees. With both hard- and soft-iron calibration, sub-2-degree heading accuracy is achievable.

## Sensor Frame Alignment

The accelerometer, gyroscope, and magnetometer axes must be expressed in the same coordinate frame before fusion. Many IMU modules (MPU-9250, ICM-20948, LSM9DS1) have the magnetometer in a different orientation than the accel/gyro. The MPU-9250, for example, has the AK8963 magnetometer with X and Y axes swapped and Y axis inverted relative to the MPU-6500 accel/gyro:

```c
/* MPU-9250: remap magnetometer axes to match accel/gyro frame */
float mx_aligned =  my_raw;   /* Mag Y -> body X */
float my_aligned =  mx_raw;   /* Mag X -> body Y */
float mz_aligned = -mz_raw;   /* Mag Z -> body -Z */
```

Incorrect axis mapping produces an AHRS output that appears to work for pitch and roll but gives incorrect or unstable yaw. The heading may rotate in the wrong direction or at the wrong rate.

## AHRS Algorithm Comparison

| Property | Madgwick | Mahony | Extended Kalman Filter |
|----------|----------|--------|----------------------|
| **CPU cost (Cortex-M4F, 9-axis)** | ~300 cycles | ~250 cycles | ~5000-15000 cycles |
| **RAM usage** | 4 floats + 1 param | 4 floats + 5 params | 50-200 floats (state + covariance) |
| **Tuning parameters** | 1 (beta) | 2 (Kp, Ki) | Q and R matrices (6-20 values) |
| **Tuning complexity** | Low | Low-medium | High |
| **Gyro bias estimation** | Implicit (gradient) | Explicit (integral term) | Explicit (state vector) |
| **Convergence from rest** | 1-3 seconds | 1-5 seconds | 5-15 seconds |
| **Accuracy (static, calibrated)** | <1 deg pitch/roll, <3 deg heading | <1 deg pitch/roll, <3 deg heading | <0.5 deg pitch/roll, <2 deg heading |
| **Dynamic accuracy** | Good | Good | Best |
| **Implementation complexity** | Moderate | Moderate | High |
| **License** | GPL (original) / MIT (ports) | BSD | N/A (custom) |

For most embedded applications on Cortex-M4 targets — drones, robots, wearables, motion controllers — the Madgwick or Mahony filters provide sufficient accuracy at a fraction of the EKF's computational cost. The EKF becomes worthwhile when sensor noise characteristics are well-characterized and when the additional accuracy justifies the development and tuning effort.

## Performance on Cortex-M4 with FPU

On an STM32F407 at 168 MHz with single-precision FPU enabled:

| Operation | Time |
|-----------|------|
| Madgwick 6-axis update (no mag) | 1.8 us |
| Madgwick 9-axis update (with mag) | 3.2 us |
| Mahony 6-axis update | 1.5 us |
| Mahony 9-axis update | 2.8 us |
| Quaternion to Euler conversion | 0.9 us (includes atan2f, asinf) |
| Full pipeline: read IMU + AHRS + Euler output | 15-25 us (dominated by I2C/SPI read) |

At 100 Hz (10 ms period), the AHRS computation consumes less than 0.1% of the CPU budget. Even at 1 kHz, the computational overhead is under 1%. The I2C or SPI bus transfer time for reading 9 axes of sensor data (18 bytes) typically exceeds the AHRS computation time by 5-10x.

## Tips

- Start with the Madgwick filter at beta = 0.041 and 100 Hz sample rate — this is the default from the original paper and works well with MPU-9250 and ICM-20948 sensors as a baseline before any tuning.
- Always normalize the quaternion after each update. Accumulated floating-point errors cause the quaternion norm to drift from 1.0 over thousands of iterations, producing scaling distortion in the output angles. The normalization (4 multiplies, 1 sqrt, 4 divides) is cheap and essential.
- Calibrate the magnetometer before enabling 9-axis fusion — an uncalibrated magnetometer introduces more heading error than it corrects. Running 6-axis (accel + gyro) without magnetometer produces stable pitch and roll with drifting yaw, which is often preferable to incorrect yaw from an uncalibrated magnetometer.
- Convert gyroscope readings to radians per second before passing them to any AHRS function. Most IMU libraries return degrees per second. A missing deg-to-rad conversion produces angles that are wrong by a factor of 57.3.
- Use SPI rather than I2C for the IMU at sample rates above 200 Hz — I2C at 400 kHz takes approximately 500 us to read 14 bytes (accel + gyro), which limits the maximum effective sample rate and adds jitter.

## Caveats

- The Madgwick filter's gradient descent step assumes that the accelerometer measures only gravity. During sustained linear acceleration (accelerating vehicle, centripetal force in turns), the accelerometer-derived gravity reference is incorrect, and the filter will tilt the estimated orientation toward the resultant acceleration vector. Some implementations add acceleration magnitude detection to reduce beta during non-gravity accelerations.
- Magnetometer readings are sensitive to any change in the local magnetic environment. Walking past a steel desk, turning on a motor, or even changes in DC current through nearby traces on the PCB can shift the heading by 10-30 degrees. AHRS heading in indoor environments should be treated as approximate unless the magnetic environment has been carefully characterized.
- Quaternion initialization matters. Starting with q = [1, 0, 0, 0] assumes the sensor starts level and facing north. If the actual starting orientation is far from this, the filter may take several seconds to converge, during which the output orientation is incorrect. Initializing the quaternion from the first accelerometer and magnetometer readings (using TRIAD or similar methods) eliminates this startup transient.
- The Mahony integral term can wind up if the sensor is stationary for extended periods with persistent accelerometer noise. In extreme cases, the accumulated integral drives the gyroscope correction in one direction continuously. Adding integral anti-windup (clamping the integral terms to a maximum value) prevents this.

## In Practice

- **AHRS pitch and roll that are stable but yaw drifts at a constant rate** indicates the magnetometer is either not connected, not calibrated, or its axes are incorrectly mapped. Running in 6-axis mode (no magnetometer) produces this exact behavior. Checking the magnetometer raw output while rotating the sensor 360 degrees around the Z axis — the X and Y readings should trace a circle (after calibration). If the trace is a point, an offset line, or an ellipse far from centered, calibration is needed.

- **Yaw that snaps to a different value when tilting the sensor** is the signature of missing tilt compensation in the magnetometer heading calculation. The magnetometer measures field strength in the sensor frame, not the earth frame. Without rotating the magnetometer vector by the current pitch and roll estimate before computing heading, any tilt mixes the vertical field component into the horizontal heading calculation. All proper AHRS algorithms handle this internally, but custom heading calculations outside the AHRS often miss this step.

- **Oscillation in the pitch or roll output at a frequency of 1-5 Hz** with the Madgwick filter usually indicates beta is too large. The gradient descent correction overshoots, and the gyroscope integration then corrects back, creating a limit cycle. Reducing beta by a factor of 2-4 eliminates the oscillation at the cost of slower convergence.

- **A Mahony filter that works well at startup but develops a slow drift after 10-30 minutes** often points to thermal drift in the gyroscope exceeding the integral term's correction rate. Increasing Ki allows faster bias tracking, or running a background gyroscope bias recalibration during detected stationary periods provides a more robust solution.

- **AHRS output that is smooth and stable in a lab environment but becomes erratic on a drone or robot** typically reflects either vibration coupling through the PCB (mechanical isolation with foam or rubber grommets helps) or electromagnetic interference from motors and ESCs corrupting the magnetometer. Logging raw sensor data in both environments and comparing noise floors reveals which sensor is affected.
