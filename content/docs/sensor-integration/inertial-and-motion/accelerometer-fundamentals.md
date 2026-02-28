---
title: "Accelerometer Fundamentals"
weight: 10
---

# Accelerometer Fundamentals

MEMS accelerometers are the most common inertial sensor in embedded systems — found in everything from wearable step counters and drone flight controllers to industrial vibration monitors. At the firmware level, the challenge is not merely reading a value but configuring the device for the right balance of noise floor, bandwidth, power consumption, and data rate. A poorly configured accelerometer can produce data that looks plausible but is dominated by noise, aliased vibration, or gravitational offset errors that corrupt downstream algorithms.

## MEMS Capacitive Sensing Principle

Most MEMS accelerometers use a differential capacitive sensing element: a proof mass suspended by silicon springs between two fixed plates. When acceleration displaces the proof mass, the capacitance gap on one side decreases while the other increases. An ASIC measures the differential capacitance change and converts it to a digital output via an internal sigma-delta ADC.

The key parameters that fall out of this mechanical structure:

- **Sensitivity** — the change in output per unit acceleration (LSB/g or mg/LSB), determined by proof mass geometry and ADC resolution
- **Noise density** — typically 100–300 µg/√Hz for consumer MEMS, 20–50 µg/√Hz for industrial/high-performance parts
- **Cross-axis sensitivity** — motion along one axis leaking into another, typically 1–2% for consumer parts
- **Resonant frequency** — the mechanical bandwidth limit of the proof mass, usually 2–10 kHz

## Full-Scale Range Selection

The full-scale range (FSR) sets the maximum measurable acceleration and directly determines sensitivity (resolution per LSB). Most accelerometers offer selectable ranges:

| FSR | Sensitivity (typical 12-bit) | Use Case |
|------|------------------------------|----------|
| ±2g | 1 mg/LSB | Tilt sensing, orientation detection |
| ±4g | 2 mg/LSB | Wearable motion tracking, pedometry |
| ±8g | 4 mg/LSB | Drone stabilization, gesture recognition |
| ±16g | 12 mg/LSB | Impact detection, vibration monitoring |

Selecting ±2g for a vibration application that regularly sees ±10g peaks results in clipped data. Selecting ±16g for a tilt sensor wastes 3 bits of resolution on range that is never used. A common sanity check is to verify that the expected signal amplitude uses at least 25% of the full-scale range.

## Output Data Rate and Bandwidth

The output data rate (ODR) controls how frequently the accelerometer produces a new sample. The analog bandwidth is typically ODR/2 (Nyquist), though some parts apply an internal digital low-pass filter that can be configured independently.

Common ODR settings and their applications:

| ODR | Bandwidth (~) | Application |
|------|--------------|-------------|
| 1 Hz | 0.5 Hz | Ultra-low-power tilt monitoring |
| 25 Hz | 12.5 Hz | Pedometer, orientation |
| 100 Hz | 50 Hz | Human motion tracking |
| 400 Hz | 200 Hz | Drone stabilization |
| 1.6 kHz | 800 Hz | Vibration analysis |
| 5 kHz+ | 2.5 kHz+ | High-frequency structural monitoring |

Higher ODR means more current draw. The LIS2DH12 consumes 2 µA at 1 Hz ODR but 185 µA at 5.376 kHz. For battery-powered applications, running at the lowest ODR that satisfies the application bandwidth requirement is essential.

## Data-Ready Interrupt

Polling the accelerometer wastes CPU cycles and risks missing samples at high ODR. The standard approach is to configure the data-ready (DRDY) interrupt:

1. Configure the interrupt pin (INT1 or INT2) to assert on new data
2. Connect the interrupt output to a GPIO configured as EXTI (external interrupt)
3. In the ISR, set a flag or post to a semaphore
4. In the main loop or task, read the sensor data when the flag is set

This guarantees every sample is captured at exact ODR intervals and allows the MCU to sleep between measurements.

## ADXL345 — SPI Initialization and Read (STM32 HAL)

The ADXL345 is a 3-axis, ±16g, 13-bit resolution digital accelerometer from Analog Devices. SPI mode is selected by driving CS low. The device uses SPI mode 3 (CPOL=1, CPHA=1) and supports clock rates up to 5 MHz.

```c
#include "stm32f4xx_hal.h"

#define ADXL345_CS_PIN       GPIO_PIN_4
#define ADXL345_CS_PORT      GPIOA
#define ADXL345_SPI          hspi1

/* ADXL345 register addresses */
#define ADXL345_DEVID        0x00
#define ADXL345_BW_RATE      0x2C
#define ADXL345_POWER_CTL    0x2D
#define ADXL345_DATA_FORMAT  0x31
#define ADXL345_DATAX0       0x32
#define ADXL345_INT_ENABLE   0x2E
#define ADXL345_INT_MAP      0x2F

/* SPI read/write flags */
#define ADXL345_READ         0x80
#define ADXL345_MULTI        0x40

extern SPI_HandleTypeDef hspi1;

static void adxl345_cs_low(void)  { HAL_GPIO_WritePin(ADXL345_CS_PORT, ADXL345_CS_PIN, GPIO_PIN_RESET); }
static void adxl345_cs_high(void) { HAL_GPIO_WritePin(ADXL345_CS_PORT, ADXL345_CS_PIN, GPIO_PIN_SET); }

static void adxl345_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    adxl345_cs_low();
    HAL_SPI_Transmit(&ADXL345_SPI, buf, 2, HAL_MAX_DELAY);
    adxl345_cs_high();
}

static uint8_t adxl345_read_reg(uint8_t reg)
{
    uint8_t tx = reg | ADXL345_READ;
    uint8_t rx = 0;
    adxl345_cs_low();
    HAL_SPI_Transmit(&ADXL345_SPI, &tx, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&ADXL345_SPI, &rx, 1, HAL_MAX_DELAY);
    adxl345_cs_high();
    return rx;
}

static void adxl345_read_multi(uint8_t reg, uint8_t *buf, uint16_t len)
{
    uint8_t tx = reg | ADXL345_READ | ADXL345_MULTI;
    adxl345_cs_low();
    HAL_SPI_Transmit(&ADXL345_SPI, &tx, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&ADXL345_SPI, buf, len, HAL_MAX_DELAY);
    adxl345_cs_high();
}

void adxl345_init(void)
{
    /* Verify device ID (expected: 0xE5) */
    uint8_t id = adxl345_read_reg(ADXL345_DEVID);
    if (id != 0xE5) {
        /* Handle ID mismatch — wrong device or wiring error */
        return;
    }

    /* Set data rate to 100 Hz (code 0x0A) */
    adxl345_write_reg(ADXL345_BW_RATE, 0x0A);

    /* Set data format: full resolution, ±4g range */
    adxl345_write_reg(ADXL345_DATA_FORMAT, 0x09);

    /* Enable DATA_READY interrupt on INT1 */
    adxl345_write_reg(ADXL345_INT_MAP, 0x00);     /* All interrupts to INT1 */
    adxl345_write_reg(ADXL345_INT_ENABLE, 0x80);   /* Enable DATA_READY */

    /* Start measurement */
    adxl345_write_reg(ADXL345_POWER_CTL, 0x08);
}

void adxl345_read_accel(int16_t *x, int16_t *y, int16_t *z)
{
    uint8_t raw[6];
    adxl345_read_multi(ADXL345_DATAX0, raw, 6);

    *x = (int16_t)((raw[1] << 8) | raw[0]);
    *y = (int16_t)((raw[3] << 8) | raw[2]);
    *z = (int16_t)((raw[5] << 8) | raw[4]);
}
```

At ±4g with full resolution mode, the ADXL345 provides 3.9 mg/LSB. The multi-byte read (MB bit set) auto-increments the register address, reading all 6 data bytes in a single SPI transaction.

## LIS2DH12 — I2C Configuration

The LIS2DH12 from STMicroelectronics is a popular ultra-low-power 3-axis accelerometer (2 µA at 1 Hz). It communicates over I2C at address 0x18 or 0x19 depending on the SDO/SA0 pin.

```c
#define LIS2DH12_ADDR       (0x19 << 1)  /* SA0 = high */

#define LIS2DH12_WHO_AM_I   0x0F
#define LIS2DH12_CTRL_REG1  0x20
#define LIS2DH12_CTRL_REG3  0x22
#define LIS2DH12_CTRL_REG4  0x23
#define LIS2DH12_OUT_X_L    0x28

extern I2C_HandleTypeDef hi2c1;

void lis2dh12_init(void)
{
    uint8_t id = 0;
    HAL_I2C_Mem_Read(&hi2c1, LIS2DH12_ADDR, LIS2DH12_WHO_AM_I,
                     I2C_MEMADD_SIZE_8BIT, &id, 1, HAL_MAX_DELAY);
    /* Expected WHO_AM_I: 0x33 */

    uint8_t val;

    /* CTRL_REG1: 100 Hz ODR, all axes enabled, normal mode */
    val = 0x57;  /* ODR=100Hz (0101), LPen=0, XYZ enable */
    HAL_I2C_Mem_Write(&hi2c1, LIS2DH12_ADDR, LIS2DH12_CTRL_REG1,
                      I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);

    /* CTRL_REG3: DRDY interrupt on INT1 */
    val = 0x10;
    HAL_I2C_Mem_Write(&hi2c1, LIS2DH12_ADDR, LIS2DH12_CTRL_REG3,
                      I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);

    /* CTRL_REG4: ±4g range, high-resolution mode, BDU enabled */
    val = 0x98;  /* BDU=1, FS=±4g (01), HR=1 */
    HAL_I2C_Mem_Write(&hi2c1, LIS2DH12_ADDR, LIS2DH12_CTRL_REG4,
                      I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);
}
```

The Block Data Update (BDU) bit is critical: without it, reading the high byte of X may return data from a different sample than the low byte, producing sporadic spikes in the output.

## Gravity Vector and Tilt Angle Calculation

When the accelerometer is stationary (or nearly so), the only acceleration measured is gravity. The tilt angle relative to each axis can be extracted directly:

```c
#include <math.h>

/* Convert raw counts to g (example: LIS2DH12, ±4g, 12-bit, 2 mg/LSB) */
#define SENSITIVITY_MG_PER_LSB  2.0f

void compute_tilt(int16_t ax_raw, int16_t ay_raw, int16_t az_raw,
                  float *roll_deg, float *pitch_deg)
{
    /* Right-shift by 4 for 12-bit left-justified data (LIS2DH12) */
    float ax = (float)(ax_raw >> 4) * SENSITIVITY_MG_PER_LSB / 1000.0f;
    float ay = (float)(ay_raw >> 4) * SENSITIVITY_MG_PER_LSB / 1000.0f;
    float az = (float)(az_raw >> 4) * SENSITIVITY_MG_PER_LSB / 1000.0f;

    /* Two-axis tilt (roll and pitch) from gravity vector */
    *roll_deg  = atan2f(ay, az) * (180.0f / M_PI);
    *pitch_deg = atan2f(-ax, sqrtf(ay * ay + az * az)) * (180.0f / M_PI);
}
```

The `atan2f` formulation avoids singularities at ±90° that plague single-axis `asinf` approaches. The pitch formula uses the vector magnitude of ay and az in the denominator to remain stable across all orientations.

## High-Pass Filter for Vibration Detection

Most accelerometers include a configurable high-pass filter (HPF) that removes the DC gravity component, passing only dynamic acceleration (vibration, shock, motion). On the ADXL345, the HPF is enabled via the DATA_FORMAT register. On the LIS2DH12, CTRL_REG2 configures HPF mode and cutoff frequency.

The HPF is useful for:
- **Activity/inactivity detection** — triggering a wake interrupt only on motion, ignoring gravity
- **Vibration RMS measurement** — extracting AC vibration amplitude without manual gravity subtraction
- **Tap/double-tap detection** — isolating transient impulses from the static gravity vector

The cutoff frequency is typically ODR-dependent (e.g., ODR/50 to ODR/400), so changing the ODR also shifts the HPF corner frequency — a detail that often causes confusion when tuning vibration thresholds.

## Popular Accelerometers Compared

| Parameter | ADXL345 | LIS2DH12 | MMA8452Q | ADXL355 |
|-----------|---------|----------|----------|---------|
| Manufacturer | Analog Devices | STMicroelectronics | NXP | Analog Devices |
| Axes | 3 | 3 | 3 | 3 |
| FSR options | ±2/4/8/16g | ±2/4/8/16g | ±2/4/8g | ±2.048/4.096/8.192g |
| Resolution | 10–13 bit | 8/10/12 bit | 8/12 bit | 20 bit |
| Noise density | 290 µg/√Hz | 220 µg/√Hz | 126 µg/√Hz | 25 µg/√Hz |
| Max ODR | 3200 Hz | 5376 Hz | 800 Hz | 4000 Hz |
| Interface | SPI / I2C | SPI / I2C | I2C | SPI / I2C |
| Supply current (100 Hz) | 140 µA | 10 µA | 24 µA | 200 µA |
| FIFO depth | 32 samples | 32 samples | None | 96 samples |
| Package | 3×5 mm LGA | 2×2 mm LGA | 3×3 mm QFN | 6×5 mm LGA |
| Typical use | Prototyping, general | Low-power wearable | Consumer electronics | Seismic, structural |

The ADXL355 stands out for precision applications — its 25 µg/√Hz noise density and 20-bit resolution make it suitable for structural health monitoring and seismic sensing where consumer-grade parts fall short.

## Tips

- Always enable Block Data Update (BDU) on STMicroelectronics parts — without it, reading multi-byte output registers can return data from two different samples, producing random spikes that are difficult to diagnose.
- Verify the WHO_AM_I register during initialization to catch wiring errors and SPI/I2C mode misconfigurations before attempting configuration writes.
- For tilt sensing, use the lowest FSR (±2g) to maximize sensitivity and resolution — the gravity vector is always 1g, so higher ranges waste dynamic range.
- Configure the data-ready interrupt instead of polling — this eliminates the risk of reading stale data and allows the MCU to sleep between samples, reducing system power consumption.
- When using the high-pass filter, record the cutoff frequency at each ODR setting — changing ODR without re-evaluating the HPF cutoff can shift detection thresholds and cause false triggers or missed events.
- Apply a simple moving average or low-pass IIR filter in firmware after reading tilt data to smooth out vibration-induced jitter: `filtered = alpha * new_sample + (1 - alpha) * filtered` with alpha between 0.05 and 0.2 works well for orientation sensing.

## Caveats

- **Self-test does not guarantee calibration** — The ADXL345 self-test applies an electrostatic force to the proof mass and shifts the output by a specified amount (typically 50–540 mg on Z). This verifies the sensor is functional but does not correct offset or sensitivity errors.
- **Gravity is always present in the output** — Without a high-pass filter or explicit subtraction, the Z-axis reads approximately ±1g (depending on orientation), which masks small dynamic accelerations if the FSR is large.
- **Left-justified vs right-justified data** — The LIS2DH12 outputs data left-justified in a 16-bit register, requiring a right-shift before applying the sensitivity constant. Missing this shift results in values 16× too large, which looks correct at first glance but produces wildly wrong g values.
- **SPI mode must match exactly** — The ADXL345 requires SPI mode 3 (CPOL=1, CPHA=1). Using mode 0 (the STM32 HAL default) results in all reads returning 0x00 or 0xFF, which is easily mistaken for a wiring fault.
- **Accelerometers cannot distinguish tilt from linear acceleration** — A horizontal acceleration of 0.5g produces the same output change as a 30° tilt. Dynamic environments require a gyroscope or complementary filter to separate the two.

## In Practice

- A tilt sensor that drifts by 2–3° over a few seconds on a stationary surface is likely picking up building vibrations or HVAC rumble — adding a low-pass filter with a 0.5 Hz cutoff typically stabilizes the reading.
- An ADXL345 that returns the correct device ID but reads 0 on all axes usually has POWER_CTL not set to measurement mode — the device powers up in standby.
- A LIS2DH12 producing acceleration values that are exactly 16× too large indicates the left-justified shift has been omitted in the data conversion code.
- An accelerometer mounted at an angle on the PCB produces a constant offset on the X and Y axes even when level — this is normal and must be calibrated out by recording the offset at a known orientation and subtracting it.
- A vibration monitoring application that shows different RMS values depending on the ODR setting likely has the HPF cutoff shifting with ODR, changing which frequency content passes through to the output.
