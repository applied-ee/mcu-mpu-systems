---
title: "Gyroscopes & Angular Rate"
weight: 20
---

# Gyroscopes & Angular Rate

MEMS gyroscopes measure angular rate — degrees per second (dps) — rather than absolute angle. This distinction is the central firmware challenge: to obtain an angle, the angular rate must be integrated over time, and every integration step accumulates error from bias drift, noise, and timing jitter. Understanding gyroscope error sources and their magnitudes is essential before attempting any orientation estimation, whether for a drone flight controller, a robotic arm, or an inertial navigation unit.

## MEMS Coriolis Effect Sensing

MEMS gyroscopes exploit the Coriolis effect: a vibrating proof mass, when rotated, experiences a force perpendicular to both the vibration direction and the rotation axis. The device maintains a proof mass in constant oscillation (the drive axis) using electrostatic comb drives. When rotation occurs, Coriolis force deflects the mass along the sense axis, and capacitive electrodes measure the deflection amplitude, which is proportional to angular rate.

The drive oscillation frequency is typically 10–30 kHz, well above the measurement bandwidth. This separation allows the sense electronics to use synchronous demodulation (lock-in detection) to extract the rotation signal from mechanical and electrical noise — the same principle as a lock-in amplifier.

Key consequences of this sensing method:
- **Vibration sensitivity** — External vibration near the drive frequency can inject false rotation signals (vibration rectification error)
- **Quadrature error** — Mechanical imperfections cause the drive motion to leak into the sense axis, producing a constant offset
- **Scale factor nonlinearity** — The relationship between actual rotation rate and output is not perfectly linear, typically ±0.1% to ±1% of FSR

## Full-Scale DPS Range

The full-scale range determines the maximum measurable angular rate and the sensitivity (LSB/dps or mdps/LSB):

| FSR | Sensitivity (typical 16-bit) | Use Case |
|------|------------------------------|----------|
| ±125 dps | 3.8 mdps/LSB | Precision pointing, optical stabilization |
| ±250 dps | 7.6 mdps/LSB | Slow rotational tracking, robotics |
| ±500 dps | 15.3 mdps/LSB | Wearable motion, gaming controllers |
| ±1000 dps | 30.5 mdps/LSB | Drone stabilization |
| ±2000 dps | 61.0 mdps/LSB | Aggressive drone maneuvers, sports |

A drone performing a fast yaw snap at 800 dps clips at the ±500 dps range, corrupting the integrated heading angle for the duration of the clip. For aggressive flight, ±2000 dps is standard even though most of the time the rotation rate stays below 200 dps.

## Bias, Drift, and Stability

The single most important gyroscope specification for firmware engineers is **bias** — the output that the gyroscope reports when it is perfectly stationary:

- **Zero-rate offset (ZRO)** — The initial bias at power-up, typically ±1 to ±10 dps for consumer MEMS. This can be measured and subtracted during a stationary calibration period at boot.
- **Bias drift over temperature** — The ZRO shifts as temperature changes, typically 0.005 to 0.05 dps/°C. A 40°C temperature swing (cold start to steady-state) can shift the bias by 0.2–2 dps.
- **Bias instability** — The fundamental minimum drift floor of the gyroscope, measured via Allan variance. Consumer MEMS: 3–20 °/hr. Tactical MEMS (ADIS16490): 0.3–1 °/hr. Navigation-grade fiber optic: <0.01 °/hr.
- **Angular random walk (ARW)** — The noise density of the rate output, expressed as °/√hr. It determines how fast the integrated angle uncertainty grows with time. Typical MEMS: 0.1–1 °/√hr.

For a gyroscope with a bias instability of 10 °/hr, integrating the rate output for 60 seconds accumulates approximately 0.17° of error from bias alone — on top of any ARW contribution. After 10 minutes, the error can exceed 1.7°. This is why standalone gyroscope integration is unusable for long-term orientation without correction from an accelerometer, magnetometer, or external reference.

## L3GD20H — SPI Configuration (STM32 HAL)

The L3GD20H from STMicroelectronics is a 3-axis gyroscope with selectable ±245/±500/±2000 dps ranges and up to 800 Hz ODR. SPI mode 3 is used (CPOL=1, CPHA=1).

```c
#include "stm32f4xx_hal.h"

#define L3GD20H_CS_PIN      GPIO_PIN_3
#define L3GD20H_CS_PORT     GPIOE
#define L3GD20H_SPI         hspi1

/* Register addresses */
#define L3GD20H_WHO_AM_I    0x0F
#define L3GD20H_CTRL1       0x20
#define L3GD20H_CTRL2       0x21
#define L3GD20H_CTRL3       0x22
#define L3GD20H_CTRL4       0x23
#define L3GD20H_CTRL5       0x24
#define L3GD20H_OUT_TEMP    0x26
#define L3GD20H_OUT_X_L     0x28

#define L3GD20H_READ        0x80
#define L3GD20H_AUTO_INC    0x40

extern SPI_HandleTypeDef hspi1;

static void l3gd20h_cs_low(void)  { HAL_GPIO_WritePin(L3GD20H_CS_PORT, L3GD20H_CS_PIN, GPIO_PIN_RESET); }
static void l3gd20h_cs_high(void) { HAL_GPIO_WritePin(L3GD20H_CS_PORT, L3GD20H_CS_PIN, GPIO_PIN_SET); }

static void l3gd20h_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    l3gd20h_cs_low();
    HAL_SPI_Transmit(&L3GD20H_SPI, buf, 2, HAL_MAX_DELAY);
    l3gd20h_cs_high();
}

static void l3gd20h_read_multi(uint8_t reg, uint8_t *buf, uint16_t len)
{
    uint8_t tx = reg | L3GD20H_READ | L3GD20H_AUTO_INC;
    l3gd20h_cs_low();
    HAL_SPI_Transmit(&L3GD20H_SPI, &tx, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&L3GD20H_SPI, buf, len, HAL_MAX_DELAY);
    l3gd20h_cs_high();
}

void l3gd20h_init(void)
{
    uint8_t tx = L3GD20H_WHO_AM_I | L3GD20H_READ;
    uint8_t id = 0;
    l3gd20h_cs_low();
    HAL_SPI_Transmit(&L3GD20H_SPI, &tx, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&L3GD20H_SPI, &id, 1, HAL_MAX_DELAY);
    l3gd20h_cs_high();
    /* Expected: 0xD7 */

    /* CTRL1: 200 Hz ODR, 50 Hz BW cutoff, all axes enabled */
    l3gd20h_write_reg(L3GD20H_CTRL1, 0x6F);

    /* CTRL2: High-pass filter normal mode, cutoff 8 Hz at 200 Hz ODR */
    l3gd20h_write_reg(L3GD20H_CTRL2, 0x00);

    /* CTRL3: Data-ready interrupt on INT2 */
    l3gd20h_write_reg(L3GD20H_CTRL3, 0x08);

    /* CTRL4: ±500 dps, BDU enabled */
    l3gd20h_write_reg(L3GD20H_CTRL4, 0x90);

    /* CTRL5: FIFO disabled, HPF disabled */
    l3gd20h_write_reg(L3GD20H_CTRL5, 0x00);
}

void l3gd20h_read_gyro(int16_t *gx, int16_t *gy, int16_t *gz)
{
    uint8_t raw[6];
    l3gd20h_read_multi(L3GD20H_OUT_X_L, raw, 6);

    *gx = (int16_t)((raw[1] << 8) | raw[0]);
    *gy = (int16_t)((raw[3] << 8) | raw[2]);
    *gz = (int16_t)((raw[5] << 8) | raw[4]);
}

int8_t l3gd20h_read_temp(void)
{
    uint8_t tx = L3GD20H_OUT_TEMP | L3GD20H_READ;
    uint8_t raw = 0;
    l3gd20h_cs_low();
    HAL_SPI_Transmit(&L3GD20H_SPI, &tx, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&L3GD20H_SPI, &raw, 1, HAL_MAX_DELAY);
    l3gd20h_cs_high();
    return (int8_t)raw;  /* 1 °C/LSB, relative to reference (not absolute) */
}
```

At ±500 dps with 16-bit output, the sensitivity is 17.5 mdps/LSB. The temperature register provides relative temperature change from an internal reference — useful for compensation but not for absolute temperature measurement.

## Angular Rate to Angle Integration

Converting angular rate (dps) to angle requires numerical integration. The simplest approach is rectangular (Euler) integration:

```c
typedef struct {
    float angle_x;     /* Accumulated angle, degrees */
    float angle_y;
    float angle_z;
    float bias_x;      /* Estimated bias, dps */
    float bias_y;
    float bias_z;
    float sensitivity;  /* dps per LSB */
} gyro_integrator_t;

void gyro_integrator_init(gyro_integrator_t *gi, float sensitivity_dps_per_lsb)
{
    gi->angle_x = 0.0f;
    gi->angle_y = 0.0f;
    gi->angle_z = 0.0f;
    gi->bias_x = 0.0f;
    gi->bias_y = 0.0f;
    gi->bias_z = 0.0f;
    gi->sensitivity = sensitivity_dps_per_lsb;
}

/**
 * Calibrate bias by averaging N samples while stationary.
 * Typical N = 500–2000 at 200 Hz (2.5–10 seconds).
 */
void gyro_calibrate_bias(gyro_integrator_t *gi,
                         int16_t *gx_buf, int16_t *gy_buf, int16_t *gz_buf,
                         uint32_t n_samples)
{
    float sx = 0.0f, sy = 0.0f, sz = 0.0f;
    for (uint32_t i = 0; i < n_samples; i++) {
        sx += (float)gx_buf[i];
        sy += (float)gy_buf[i];
        sz += (float)gz_buf[i];
    }
    gi->bias_x = (sx / (float)n_samples) * gi->sensitivity;
    gi->bias_y = (sy / (float)n_samples) * gi->sensitivity;
    gi->bias_z = (sz / (float)n_samples) * gi->sensitivity;
}

/**
 * Update integrated angle with a new gyro sample.
 * dt_s = time since last sample in seconds (e.g., 0.005 for 200 Hz).
 */
void gyro_integrator_update(gyro_integrator_t *gi,
                            int16_t gx_raw, int16_t gy_raw, int16_t gz_raw,
                            float dt_s)
{
    float rate_x = (float)gx_raw * gi->sensitivity - gi->bias_x;
    float rate_y = (float)gy_raw * gi->sensitivity - gi->bias_y;
    float rate_z = (float)gz_raw * gi->sensitivity - gi->bias_z;

    gi->angle_x += rate_x * dt_s;
    gi->angle_y += rate_y * dt_s;
    gi->angle_z += rate_z * dt_s;
}
```

The accuracy of this integration depends critically on:
- **Bias subtraction** — A 0.5 dps residual bias accumulates 30° of error per minute
- **Timing accuracy** — Using a hardware timer for dt rather than a software estimate reduces jitter-induced error
- **Sample rate** — Higher ODR reduces discretization error from fast rotations

## Temperature Compensation Lookup

Bias drift over temperature is often the dominant error source in applications that experience thermal transients. A practical compensation approach is a piecewise-linear lookup table built from a thermal sweep calibration:

```c
#define TEMP_CAL_POINTS  5

typedef struct {
    int8_t  temp_c;       /* Temperature in °C */
    float   bias_x_dps;   /* Measured bias at this temperature */
    float   bias_y_dps;
    float   bias_z_dps;
} temp_cal_point_t;

/* Populated during factory/bench calibration thermal sweep */
static const temp_cal_point_t temp_cal[TEMP_CAL_POINTS] = {
    { -10, -1.20f,  0.85f,  0.43f },
    {  10, -0.62f,  0.51f,  0.21f },
    {  25, -0.30f,  0.28f,  0.10f },
    {  40,  0.05f,  0.08f, -0.02f },
    {  60,  0.55f, -0.22f, -0.18f },
};

void temp_compensate_bias(int8_t current_temp,
                          float *bias_x, float *bias_y, float *bias_z)
{
    /* Clamp to calibration range */
    if (current_temp <= temp_cal[0].temp_c) {
        *bias_x = temp_cal[0].bias_x_dps;
        *bias_y = temp_cal[0].bias_y_dps;
        *bias_z = temp_cal[0].bias_z_dps;
        return;
    }
    if (current_temp >= temp_cal[TEMP_CAL_POINTS - 1].temp_c) {
        *bias_x = temp_cal[TEMP_CAL_POINTS - 1].bias_x_dps;
        *bias_y = temp_cal[TEMP_CAL_POINTS - 1].bias_y_dps;
        *bias_z = temp_cal[TEMP_CAL_POINTS - 1].bias_z_dps;
        return;
    }

    /* Linear interpolation between bracketing points */
    for (int i = 0; i < TEMP_CAL_POINTS - 1; i++) {
        if (current_temp >= temp_cal[i].temp_c &&
            current_temp <  temp_cal[i + 1].temp_c) {
            float frac = (float)(current_temp - temp_cal[i].temp_c) /
                         (float)(temp_cal[i + 1].temp_c - temp_cal[i].temp_c);
            *bias_x = temp_cal[i].bias_x_dps +
                      frac * (temp_cal[i + 1].bias_x_dps - temp_cal[i].bias_x_dps);
            *bias_y = temp_cal[i].bias_y_dps +
                      frac * (temp_cal[i + 1].bias_y_dps - temp_cal[i].bias_y_dps);
            *bias_z = temp_cal[i].bias_z_dps +
                      frac * (temp_cal[i + 1].bias_z_dps - temp_cal[i].bias_z_dps);
            return;
        }
    }
}
```

Building this table requires placing the device in a thermal chamber (or using a heat gun and a reference thermometer) and collecting bias samples at 5–10 temperature points while the gyroscope is stationary. The investment pays off significantly for any application that operates across a wide temperature range.

## Gyroscope Specifications Compared

| Parameter | L3GD20H | BMI270 (gyro) | ICM-42688-P (gyro) |
|-----------|---------|---------------|---------------------|
| Manufacturer | STMicroelectronics | Bosch | TDK InvenSense |
| FSR options | ±245/500/2000 dps | ±125/250/500/1000/2000 dps | ±15.6 to ±2000 dps |
| Resolution | 16-bit | 16-bit | 16-bit |
| Noise density | 0.011 dps/√Hz | 0.007 dps/√Hz | 0.0028 dps/√Hz |
| Bias instability | 10 °/hr | 3 °/hr | 2.8 °/hr |
| Max ODR | 800 Hz | 6400 Hz | 32 kHz |
| Interface | SPI / I2C | SPI / I2C | SPI / I2C |
| Supply current | 5.0 mA | 0.9 mA (normal) | 0.97 mA |
| Temperature sensor | Yes (1 °C/LSB) | Yes (8 LSB/°C) | Yes (132.48 LSB/°C) |
| Package | 3×3 mm LGA | 2.5×3 mm LGA | 2.5×3 mm LGA |

The ICM-42688-P offers the lowest noise density and highest ODR in this comparison, making it the preferred choice for high-performance applications like precision drone flight control. The BMI270 targets wearable applications where low current draw is paramount.

## Tips

- Perform a stationary bias calibration at every power-up — collect 1000–2000 samples with the device motionless and average them. This removes the bulk of the zero-rate offset and dramatically improves short-term integration accuracy.
- Use a hardware timer interrupt (not a software delay) to drive the integration loop — jitter in dt accumulates as angle error over time.
- For applications with significant thermal transients (outdoor robotics, drones), implement temperature compensation using the on-chip temperature sensor and a calibration lookup table.
- Select the smallest FSR that accommodates the expected peak rotation rate plus a 20% margin — lower FSR means more bits of resolution on the actual signal.
- Monitor the gyroscope output variance during the bias calibration period — if the variance is unusually high, vibration is present and the calibration should be deferred or the mount isolated.
- When combining gyroscope data with an accelerometer in a complementary or Kalman filter, use the gyroscope for short-term attitude and the accelerometer for long-term correction — this is the standard approach for canceling gyroscope drift.

## Caveats

- **Integration drift is unavoidable with MEMS gyroscopes** — Even after bias calibration, a consumer MEMS gyroscope accumulates 1–5° of error per minute under ideal conditions. Standalone gyroscope integration is only suitable for short-duration measurements (seconds to tens of seconds).
- **Vibration rectification causes false rotation** — Mechanical vibration near the drive frequency injects a DC offset into the rate output. This is visible as a slowly growing angle when the device is stationary but mounted on a vibrating surface.
- **Bias calibration requires true stillness** — A calibration performed while the device is being held by hand (typical human tremor: 0.2–0.5 dps) corrupts the bias estimate and worsens integration accuracy.
- **Full-scale clipping is silent** — When the rotation rate exceeds the FSR, the output saturates at the maximum value. Unlike a flag or interrupt, the gyroscope does not signal that clipping has occurred. The integrated angle is corrupted, and the error persists permanently.
- **Temperature step response lag** — The internal temperature sensor responds faster than the MEMS element reaches thermal equilibrium. Compensating bias with the instantaneous temperature reading during a rapid thermal transient can overcorrect.

## In Practice

- A drone that slowly rotates (yaws) even when the commanded yaw rate is zero has residual gyroscope bias on the Z-axis that the flight controller is integrating — improving the boot calibration duration from 1 second to 5 seconds often eliminates this.
- A gyroscope-based heading that drifts 3° per minute indoors but 0.5° per minute in a temperature-stable lab is dominated by temperature-dependent bias drift, not random walk — temperature compensation is the correct fix.
- A gyroscope reading that shows a slowly oscillating pattern (~0.1 Hz) when stationary on a desk is likely picking up building sway or HVAC vibration — not a sensor fault.
- An angular rate that jumps by 0.2 dps when a nearby motor turns on suggests electromagnetic interference or vibration coupling — shielding the sensor or isolating the mount resolves it.
- A bias calibration that produces different values each time the device is power-cycled (spread of ±2 dps) is normal for consumer MEMS — this is the turn-on-to-turn-on bias repeatability specification, and it is why calibration at every boot is necessary.
