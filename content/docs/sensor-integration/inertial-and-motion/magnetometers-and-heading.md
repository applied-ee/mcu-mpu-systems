---
title: "Magnetometers & Heading"
weight: 30
---

# Magnetometers & Heading

Magnetometers measure the local magnetic field vector, which in undisturbed conditions is dominated by Earth's field — typically 25–65 µT depending on geographic location (strongest at the poles, weakest near the equator). From this vector, a compass heading can be computed. The firmware challenge is that the magnetic field seen by the sensor is almost always corrupted by nearby ferrous materials and current-carrying traces on the PCB, requiring careful calibration before the heading output is usable.

## Sensing Technologies

Two main sensing technologies appear in embedded magnetometers:

**Hall-effect sensors** — A current-carrying conductor in a magnetic field develops a voltage perpendicular to both the current and field. Hall sensors are simple and inexpensive but have higher noise and lower sensitivity. The AK8963 (inside the MPU-9250) uses a Hall-effect element.

**Anisotropic Magnetoresistive (AMR) / Giant Magnetoresistive (GMR)** — A thin-film magnetic material changes electrical resistance in response to an applied field. AMR sensors (HMC5883L, MMC5603) offer 10–100× better sensitivity than Hall sensors. GMR sensors push further for precision applications. The trade-off is higher cost and the need for periodic SET/RESET pulses to recondition the sensing element and eliminate offset drift.

## Full-Scale Range and Sensitivity

Magnetometers specify their measurement range in gauss (G) or microtesla (µT), where 1 G = 100 µT:

| Parameter | Typical Range | Note |
|-----------|---------------|------|
| Earth's field magnitude | 0.25–0.65 G (25–65 µT) | Varies by latitude and local anomalies |
| Typical FSR | ±2 G to ±16 G | Must accommodate Earth's field + hard-iron offsets |
| Sensitivity (QMC5883L) | 12,000 LSB/G at ±2 G | 0.083 mG per LSB |
| Sensitivity (HMC5883L) | 1370 LSB/G at ±1.3 G | 0.73 mG per LSB |
| Sensitivity (MMC5603) | 16,384 LSB/G at ±30 G | 0.061 mG per LSB |

For compass heading, the ±2 G to ±8 G range is standard. Higher FSR is needed only in proximity to strong magnets (motors, speakers, magnetic latches).

## Hard-Iron Distortion

Hard-iron distortion comes from permanent magnetic fields fixed to the sensor frame — magnetized components on the PCB, nearby ferrite cores, speaker magnets, or steel screws. The effect is a constant offset added to the measured field vector, shifting the circle of measurements away from the origin when the device is rotated in the horizontal plane.

Magnitude of typical hard-iron sources:
- PCB traces carrying DC current (100 mA at 5 mm): ~0.04 G
- Small ferrite bead at 3 mm: 0.1–1.0 G
- Steel screw at 10 mm: 0.2–0.5 G
- Smartphone speaker magnet at 15 mm: 1–5 G

Hard-iron offset is by far the largest error source and can easily exceed Earth's field magnitude, making raw magnetometer readings useless for heading without calibration.

## Soft-Iron Distortion

Soft-iron distortion arises from magnetically permeable materials (iron, nickel, steel brackets) that distort the local field lines without generating a permanent field. Instead of shifting the measurement circle, soft-iron distortion warps it into an ellipse — the field appears stronger along certain axes and weaker along others.

Soft-iron calibration requires fitting an ellipsoid to the 3D measurement cloud and computing a correction matrix that transforms the ellipsoid back into a sphere. For many embedded applications, correcting hard-iron alone (much simpler) provides adequate heading accuracy, and soft-iron correction is deferred unless heading error exceeds 3–5°.

## QMC5883L / HMC5883L — I2C Read Code (STM32 HAL)

The QMC5883L is a commonly available 3-axis magnetometer (frequent replacement for the discontinued HMC5883L). It communicates over I2C at address 0x0D.

```c
#include "stm32f4xx_hal.h"
#include <math.h>

#define QMC5883L_ADDR       (0x0D << 1)

/* QMC5883L registers */
#define QMC5883L_DATA_X_LSB 0x00
#define QMC5883L_STATUS     0x06
#define QMC5883L_CTRL1      0x09
#define QMC5883L_CTRL2      0x0A
#define QMC5883L_SET_RESET  0x0B

extern I2C_HandleTypeDef hi2c1;

static HAL_StatusTypeDef qmc5883l_write_reg(uint8_t reg, uint8_t val)
{
    return HAL_I2C_Mem_Write(&hi2c1, QMC5883L_ADDR, reg,
                             I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);
}

void qmc5883l_init(void)
{
    /* Recommended SET/RESET period */
    qmc5883l_write_reg(QMC5883L_SET_RESET, 0x01);

    /* CTRL2: Soft reset */
    qmc5883l_write_reg(QMC5883L_CTRL2, 0x80);
    HAL_Delay(10);

    /* SET/RESET again after reset */
    qmc5883l_write_reg(QMC5883L_SET_RESET, 0x01);

    /* CTRL1: Continuous mode, 200 Hz ODR, ±2 G range, 512 oversampling */
    qmc5883l_write_reg(QMC5883L_CTRL1, 0x0D);
}

HAL_StatusTypeDef qmc5883l_read_mag(int16_t *mx, int16_t *my, int16_t *mz)
{
    /* Check data-ready status */
    uint8_t status;
    HAL_I2C_Mem_Read(&hi2c1, QMC5883L_ADDR, QMC5883L_STATUS,
                     I2C_MEMADD_SIZE_8BIT, &status, 1, HAL_MAX_DELAY);

    if (!(status & 0x01)) {
        return HAL_BUSY;  /* No new data available */
    }

    uint8_t raw[6];
    HAL_I2C_Mem_Read(&hi2c1, QMC5883L_ADDR, QMC5883L_DATA_X_LSB,
                     I2C_MEMADD_SIZE_8BIT, raw, 6, HAL_MAX_DELAY);

    /* QMC5883L: X_LSB, X_MSB, Y_LSB, Y_MSB, Z_LSB, Z_MSB */
    *mx = (int16_t)((raw[1] << 8) | raw[0]);
    *my = (int16_t)((raw[3] << 8) | raw[2]);
    *mz = (int16_t)((raw[5] << 8) | raw[4]);

    return HAL_OK;
}
```

The HMC5883L uses address 0x1E and a different register layout (data registers start at 0x03, order is X_MSB, X_LSB, Z_MSB, Z_LSB, Y_MSB, Y_LSB — note the unusual Z-then-Y ordering). Many cheap breakout boards labeled "HMC5883L" actually contain a QMC5883L, which has an incompatible register map and I2C address. A reliable identification approach is to probe both addresses and check the chip ID registers.

## Hard-Iron Calibration Algorithm

The standard hard-iron calibration procedure collects magnetometer samples while rotating the device through all orientations, then computes the offset as the center of the measurement sphere:

```c
typedef struct {
    float offset_x;    /* Hard-iron offset in raw LSB units */
    float offset_y;
    float offset_z;
    float scale_x;     /* Soft-iron scale factors (1.0 = no correction) */
    float scale_y;
    float scale_z;
} mag_cal_t;

/**
 * Simple hard-iron calibration: collect min/max on each axis
 * during a full rotation (figure-8 pattern covering all orientations).
 *
 * Call mag_cal_collect() for each new sample during calibration,
 * then mag_cal_compute() to finalize the offsets.
 */
typedef struct {
    int16_t min_x, max_x;
    int16_t min_y, max_y;
    int16_t min_z, max_z;
    uint32_t n_samples;
} mag_cal_collector_t;

void mag_cal_collector_init(mag_cal_collector_t *c)
{
    c->min_x = INT16_MAX;  c->max_x = INT16_MIN;
    c->min_y = INT16_MAX;  c->max_y = INT16_MIN;
    c->min_z = INT16_MAX;  c->max_z = INT16_MIN;
    c->n_samples = 0;
}

void mag_cal_collect(mag_cal_collector_t *c, int16_t mx, int16_t my, int16_t mz)
{
    if (mx < c->min_x) c->min_x = mx;
    if (mx > c->max_x) c->max_x = mx;
    if (my < c->min_y) c->min_y = my;
    if (my > c->max_y) c->max_y = my;
    if (mz < c->min_z) c->min_z = mz;
    if (mz > c->max_z) c->max_z = mz;
    c->n_samples++;
}

void mag_cal_compute(mag_cal_collector_t *c, mag_cal_t *cal)
{
    /* Hard-iron offsets: center of the min/max range */
    cal->offset_x = (float)(c->max_x + c->min_x) / 2.0f;
    cal->offset_y = (float)(c->max_y + c->min_y) / 2.0f;
    cal->offset_z = (float)(c->max_z + c->min_z) / 2.0f;

    /* Soft-iron scale: normalize axis ranges to the average range */
    float range_x = (float)(c->max_x - c->min_x) / 2.0f;
    float range_y = (float)(c->max_y - c->min_y) / 2.0f;
    float range_z = (float)(c->max_z - c->min_z) / 2.0f;
    float avg_range = (range_x + range_y + range_z) / 3.0f;

    cal->scale_x = (range_x > 0.0f) ? avg_range / range_x : 1.0f;
    cal->scale_y = (range_y > 0.0f) ? avg_range / range_y : 1.0f;
    cal->scale_z = (range_z > 0.0f) ? avg_range / range_z : 1.0f;
}

void mag_apply_cal(mag_cal_t *cal, int16_t mx_raw, int16_t my_raw, int16_t mz_raw,
                   float *mx_cal, float *my_cal, float *mz_cal)
{
    *mx_cal = ((float)mx_raw - cal->offset_x) * cal->scale_x;
    *my_cal = ((float)my_raw - cal->offset_y) * cal->scale_y;
    *mz_cal = ((float)mz_raw - cal->offset_z) * cal->scale_z;
}
```

The figure-8 rotation pattern is the standard calibration gesture because it efficiently covers the full 3D orientation space. A minimum of 200–500 samples collected over 15–30 seconds of smooth rotation produces stable calibration results. The calibration data should be stored in non-volatile memory (flash or EEPROM) so it persists across power cycles — but must be invalidated if the device enclosure or PCB changes.

## Heading Calculation with Tilt Compensation

A flat (level) compass heading is simply `atan2(-my, mx)`. But when the device is tilted, the horizontal components of Earth's field project onto the sensor axes differently. Tilt-compensated heading uses accelerometer data to rotate the magnetic vector into the horizontal plane before computing the heading:

```c
#include <math.h>

/**
 * Compute tilt-compensated magnetic heading.
 *
 * ax, ay, az: calibrated accelerometer readings (in g)
 * mx, my, mz: calibrated magnetometer readings (arbitrary units, offset removed)
 * declination_deg: local magnetic declination (east positive)
 *
 * Returns heading in degrees [0, 360).
 */
float compute_heading(float ax, float ay, float az,
                      float mx, float my, float mz,
                      float declination_deg)
{
    /* Compute roll and pitch from accelerometer */
    float roll  = atan2f(ay, az);
    float pitch = atan2f(-ax, sqrtf(ay * ay + az * az));

    float sin_roll  = sinf(roll);
    float cos_roll  = cosf(roll);
    float sin_pitch = sinf(pitch);
    float cos_pitch = cosf(pitch);

    /* Rotate magnetometer vector into horizontal plane */
    float mx_h = mx * cos_pitch
               + my * sin_roll * sin_pitch
               + mz * cos_roll * sin_pitch;

    float my_h = my * cos_roll
               - mz * sin_roll;

    /* Compute heading */
    float heading_rad = atan2f(-my_h, mx_h);
    float heading_deg = heading_rad * (180.0f / (float)M_PI);

    /* Apply magnetic declination */
    heading_deg += declination_deg;

    /* Normalize to [0, 360) */
    if (heading_deg < 0.0f)   heading_deg += 360.0f;
    if (heading_deg >= 360.0f) heading_deg -= 360.0f;

    return heading_deg;
}
```

The magnetic declination is the angle between magnetic north and true north. It varies by location — for example, approximately +11° in New York, -14° in Seattle, and near 0° in parts of the central US. The value can be looked up from the World Magnetic Model (WMM) or NOAA's online calculator for the deployment location.

## Magnetic Declination and Field Strength by Region

Earth's magnetic field is not uniform. The field strength and declination angle vary significantly:

| Location | Field Strength (µT) | Declination | Inclination |
|----------|---------------------|-------------|-------------|
| Equatorial Pacific | ~25 µT | Near 0° | Near 0° |
| Central US (Kansas) | ~53 µT | ~2° E | ~65° |
| New York, USA | ~52 µT | ~11° W | ~67° |
| London, UK | ~49 µT | ~1° W | ~66° |
| Northern Canada | ~58 µT | ~15° W | ~82° |
| Singapore | ~42 µT | ~0.3° E | ~-15° |

The **inclination** (dip angle) is particularly relevant — at high latitudes, Earth's field is nearly vertical, meaning the horizontal component used for heading is small and heading resolution degrades. At 80° inclination, the horizontal component is only ~17% of the total field, amplifying noise in the heading calculation by nearly 6×.

## Tips

- Always perform hard-iron calibration after final PCB assembly — even moving a ferrite bead 2 mm closer to the magnetometer can shift the offset by several hundred LSBs.
- Store calibration data in flash/EEPROM and include a version or checksum field — if the PCB layout changes between hardware revisions, the stored calibration becomes invalid.
- Collect at least 300 samples during the figure-8 calibration gesture, ensuring the device has been rotated through a wide range of orientations — incomplete coverage results in biased offset estimates.
- Use tilt-compensated heading whenever the device may not be level — even a 10° tilt introduces several degrees of heading error without compensation.
- Place the magnetometer as far as possible from DC current paths, ferrous components, and motors on the PCB — distance is the most effective magnetic shielding.
- For applications near the magnetic poles (inclination > 75°), consider using a GPS-derived heading or dual-antenna GPS instead of a magnetometer — the horizontal field component is too small for reliable compass operation.

## Caveats

- **Magnetometers measure total local field, not just Earth's field** — Any magnetic interference (nearby magnets, current-carrying wires, steel structures) adds directly to the measurement. There is no way to distinguish Earth's field from interference in a single measurement.
- **Calibration is environment-specific** — Calibration performed on a wooden bench is invalid inside a metal enclosure or near a steel table. The calibration environment should match the deployment environment.
- **QMC5883L and HMC5883L are not register-compatible** — Despite identical pinouts on many breakout boards, the I2C addresses (0x0D vs 0x1E), register maps, and data byte ordering are different. Firmware must detect which chip is present.
- **SET/RESET pulses are required for AMR sensors** — Skipping the periodic SET/RESET on the HMC5883L or MMC5603 allows the sensing element to develop offset drift over time, particularly after exposure to strong magnetic fields.
- **Heading accuracy degrades dramatically near the magnetic poles** — The tilt-compensated heading formula divides by the horizontal field component, which approaches zero at high inclination angles, amplifying noise.
- **Soft-iron correction with min/max is an approximation** — The axis-independent scaling factors from min/max calibration correct for elliptical distortion aligned with the sensor axes but not for rotated ellipsoids. Full soft-iron correction requires a 3×3 matrix computed from an ellipsoid fit.

## In Practice

- A compass heading that reads 30° off from a known reference direction on a new PCB is almost always uncalibrated hard-iron offset — the magnitude is consistent with a ferrite inductor or steel mounting screw within 10 mm of the sensor.
- A heading that oscillates ±5° when the device tilts back and forth indicates the tilt compensation is either disabled or using stale accelerometer data — verifying synchronization between accelerometer and magnetometer reads resolves this.
- A magnetometer that reads correctly on the bench but shows erratic heading in the field is likely experiencing interference from nearby electronics, metal structures, or the operator's wristwatch — logging the raw field magnitude helps identify interference episodes (the magnitude jumps when an external field source is present).
- A calibration that produces offset values much larger than the expected Earth's field range (e.g., offsets of ±5000 LSB when the Earth's field only spans ±2000 LSB) indicates a very strong hard-iron source nearby — either the PCB layout needs revision or the device housing contains a ferrous component.
- A heading that slowly drifts over hours on a stationary device, especially after power-up, suggests the AMR sensing element has developed offset drift — issuing a SET/RESET pulse and recalibrating typically restores accuracy.
