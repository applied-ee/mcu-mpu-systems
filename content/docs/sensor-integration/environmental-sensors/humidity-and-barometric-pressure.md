---
title: "Humidity & Barometric Pressure"
weight: 20
---

# Humidity & Barometric Pressure

Humidity and barometric pressure sensors share a common integration story: a MEMS sensing element bonded to a small ASIC that handles excitation, digitization, and compensation, all accessible over I2C or SPI. The BME280 from Bosch is the de facto standard for combined temperature/humidity/pressure measurement in hobbyist and commercial designs alike. Understanding its configuration registers, compensation algorithm, and measurement modes is essential — the same patterns reappear across dozens of similar devices from Sensirion, TE Connectivity, and others.

## Capacitive Humidity Sensing Principle

Most MEMS humidity sensors use a capacitive element: a thin polymer dielectric layer between two electrodes. As water vapor is absorbed into the polymer, the dielectric constant changes, altering the capacitance. The ASIC measures this capacitance change and converts it to a digital humidity value after applying factory-calibrated compensation.

The polymer layer introduces a time constant — the sensor does not respond instantaneously to humidity changes. Typical response times (tau 63%) range from 1-8 seconds depending on airflow. Placing the sensor behind a PTFE membrane (common in outdoor housings) increases this to 10-30 seconds. For applications requiring fast response (e.g., breath detection), sensors with exposed die like the SHT4x are preferred.

## BME280 Configuration and Operation

The BME280 integrates pressure, temperature, and humidity sensing in a 2.5 x 2.5 mm LGA package. It communicates over I2C (address 0x76 or 0x77, selected by the SDO pin) or SPI (up to 10 MHz). Configuration centers on three concepts: measurement mode, oversampling, and IIR filtering.

### Measurement Modes

| Mode | Register Value | Behavior | Use Case |
|---|---|---|---|
| Sleep | 0b00 | No measurements, lowest power (0.1 uA) | Between infrequent reads |
| Forced | 0b01 or 0b10 | Single measurement, returns to sleep | Battery-powered, periodic logging |
| Normal | 0b11 | Continuous measurements at standby interval | Continuous monitoring |

Forced mode is the standard choice for battery-powered environmental loggers. The controller writes the configuration, triggers a measurement, waits for completion (typically 10-40 ms depending on oversampling), reads the result, and the sensor returns to sleep automatically.

### Oversampling

Each measurement channel (temperature, pressure, humidity) supports independent oversampling from 1x to 16x. Higher oversampling reduces noise at the cost of longer conversion time and higher current consumption.

| Oversampling | Pressure Noise (Pa) | Temperature Noise (deg C) | Conversion Time (ms) |
|---|---|---|---|
| 1x | 2.62 | 0.005 | ~6.5 |
| 2x | 1.85 | 0.0035 | ~8.7 |
| 4x | 1.31 | 0.0025 | ~13.3 |
| 8x | 0.93 | 0.0018 | ~22.5 |
| 16x | 0.66 | 0.0013 | ~40.8 |

A common configuration for weather station use: pressure at 16x, temperature at 2x, humidity at 1x. This prioritizes pressure resolution (critical for altitude or weather trending) while keeping total conversion time reasonable.

### IIR Filter

The BME280 includes a built-in IIR low-pass filter on the pressure and temperature outputs (not humidity). The filter coefficient ranges from 0 (off) to 16. Higher coefficients smooth short-term fluctuations — useful for removing the pressure artifact from opening a door — but introduce lag in the response to real environmental changes.

### I2C Init and Read Sequence

```c
#include "stm32f4xx_hal.h"

#define BME280_ADDR        (0x76 << 1)
#define BME280_REG_ID      0xD0
#define BME280_REG_CTRL_HUM   0xF2
#define BME280_REG_STATUS     0xF3
#define BME280_REG_CTRL_MEAS  0xF4
#define BME280_REG_CONFIG     0xF5
#define BME280_REG_DATA       0xF7  /* 8 bytes: press[3], temp[3], hum[2] */
#define BME280_REG_CALIB00    0x88  /* Calibration block 1: 26 bytes */
#define BME280_REG_CALIB26    0xE1  /* Calibration block 2: 7 bytes */

typedef struct {
    uint16_t dig_T1;
    int16_t  dig_T2, dig_T3;
    uint16_t dig_P1;
    int16_t  dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
    uint8_t  dig_H1, dig_H3;
    int16_t  dig_H2, dig_H4, dig_H5;
    int8_t   dig_H6;
    int32_t  t_fine;  /* Shared between temp and pressure compensation */
} BME280_Calib;

static BME280_Calib cal;

void bme280_init(I2C_HandleTypeDef *hi2c) {
    uint8_t id;
    HAL_I2C_Mem_Read(hi2c, BME280_ADDR, BME280_REG_ID,
                     I2C_MEMADD_SIZE_8BIT, &id, 1, 100);
    /* id should be 0x60 for BME280 */

    /* Read calibration data */
    uint8_t calib1[26], calib2[7];
    HAL_I2C_Mem_Read(hi2c, BME280_ADDR, BME280_REG_CALIB00,
                     I2C_MEMADD_SIZE_8BIT, calib1, 26, 100);
    HAL_I2C_Mem_Read(hi2c, BME280_ADDR, BME280_REG_CALIB26,
                     I2C_MEMADD_SIZE_8BIT, calib2, 7, 100);

    /* Parse calibration — temperature */
    cal.dig_T1 = (calib1[1] << 8) | calib1[0];
    cal.dig_T2 = (calib1[3] << 8) | calib1[2];
    cal.dig_T3 = (calib1[5] << 8) | calib1[4];

    /* Parse calibration — pressure */
    cal.dig_P1 = (calib1[7]  << 8) | calib1[6];
    cal.dig_P2 = (calib1[9]  << 8) | calib1[8];
    cal.dig_P3 = (calib1[11] << 8) | calib1[10];
    cal.dig_P4 = (calib1[13] << 8) | calib1[12];
    cal.dig_P5 = (calib1[15] << 8) | calib1[14];
    cal.dig_P6 = (calib1[17] << 8) | calib1[16];
    cal.dig_P7 = (calib1[19] << 8) | calib1[18];
    cal.dig_P8 = (calib1[21] << 8) | calib1[20];
    cal.dig_P9 = (calib1[23] << 8) | calib1[22];

    /* Parse calibration — humidity */
    cal.dig_H1 = calib1[25];
    cal.dig_H2 = (calib2[1] << 8) | calib2[0];
    cal.dig_H3 = calib2[2];
    cal.dig_H4 = (calib2[3] << 4) | (calib2[4] & 0x0F);
    cal.dig_H5 = (calib2[5] << 4) | (calib2[4] >> 4);
    cal.dig_H6 = (int8_t)calib2[6];

    /* Configure: humidity 1x OS, pressure 16x OS, temp 2x OS, forced mode */
    uint8_t ctrl_hum = 0x01;  /* humidity oversampling 1x */
    HAL_I2C_Mem_Write(hi2c, BME280_ADDR, BME280_REG_CTRL_HUM,
                      I2C_MEMADD_SIZE_8BIT, &ctrl_hum, 1, 100);

    uint8_t config = 0x00;  /* No standby, no IIR filter, SPI off */
    HAL_I2C_Mem_Write(hi2c, BME280_ADDR, BME280_REG_CONFIG,
                      I2C_MEMADD_SIZE_8BIT, &config, 1, 100);
}

void bme280_trigger_forced(I2C_HandleTypeDef *hi2c) {
    /* temp OS 2x | press OS 16x | forced mode */
    uint8_t ctrl_meas = (0x02 << 5) | (0x05 << 2) | 0x01;
    HAL_I2C_Mem_Write(hi2c, BME280_ADDR, BME280_REG_CTRL_MEAS,
                      I2C_MEMADD_SIZE_8BIT, &ctrl_meas, 1, 100);
}
```

### Compensation Algorithm

The BME280 outputs raw 20-bit pressure, 20-bit temperature, and 16-bit humidity values. These must be run through the manufacturer's compensation formulas using the factory-calibrated coefficients. The temperature compensation is computed first because it produces the `t_fine` value that feeds into both pressure and humidity compensation.

```c
float bme280_compensate_temperature(int32_t adc_T) {
    int32_t var1 = ((((adc_T >> 3) - ((int32_t)cal.dig_T1 << 1)))
                    * ((int32_t)cal.dig_T2)) >> 11;
    int32_t var2 = (((((adc_T >> 4) - ((int32_t)cal.dig_T1))
                    * ((adc_T >> 4) - ((int32_t)cal.dig_T1))) >> 12)
                    * ((int32_t)cal.dig_T3)) >> 14;
    cal.t_fine = var1 + var2;
    return ((cal.t_fine * 5 + 128) >> 8) / 100.0f;
}

float bme280_compensate_pressure(int32_t adc_P) {
    int64_t var1 = ((int64_t)cal.t_fine) - 128000;
    int64_t var2 = var1 * var1 * (int64_t)cal.dig_P6;
    var2 = var2 + ((var1 * (int64_t)cal.dig_P5) << 17);
    var2 = var2 + (((int64_t)cal.dig_P4) << 35);
    var1 = ((var1 * var1 * (int64_t)cal.dig_P3) >> 8)
           + ((var1 * (int64_t)cal.dig_P2) << 12);
    var1 = (((((int64_t)1) << 47) + var1)) * ((int64_t)cal.dig_P1) >> 33;
    if (var1 == 0) return 0.0f;

    int64_t p = 1048576 - adc_P;
    p = (((p << 31) - var2) * 3125) / var1;
    var1 = (((int64_t)cal.dig_P9) * (p >> 13) * (p >> 13)) >> 25;
    var2 = (((int64_t)cal.dig_P8) * p) >> 19;
    p = ((p + var1 + var2) >> 8) + (((int64_t)cal.dig_P7) << 4);
    return (float)p / 25600.0f;  /* Result in hPa */
}
```

## BMP390 for High-Precision Pressure

The BMP390 is Bosch's successor to the BMP280/BMP388 line, optimized for barometric pressure accuracy. It achieves a relative accuracy of +/-3 Pa (roughly +/-0.25 m altitude equivalent) and an absolute accuracy of +/-50 Pa. The interface mirrors the BME280 pattern — I2C/SPI, oversampling, IIR filter — but adds a FIFO buffer (up to 512 bytes) that allows burst reads of accumulated measurements, reducing bus traffic in power-constrained systems.

## Altitude from Pressure (Barometric Formula)

The relationship between atmospheric pressure and altitude follows the barometric formula. Given the sea-level reference pressure (P0, typically 1013.25 hPa), the altitude in meters is:

```
altitude = 44330.0 * (1.0 - pow(pressure / P0, 1.0 / 5.255))
```

```c
float pressure_to_altitude(float pressure_hpa, float sea_level_hpa) {
    return 44330.0f * (1.0f - powf(pressure_hpa / sea_level_hpa, 0.190295f));
}
```

This formula is sensitive to the reference pressure. A 1 hPa error in the sea-level reference produces approximately 8.4 m of altitude error. Weather-related pressure changes of 20-30 hPa over a day can shift the calculated altitude by 170-250 m. For applications requiring stable altitude (e.g., drone altitude hold), the reference must be set at a known altitude before each session, or differential pressure from a recent baseline must be used instead of absolute altitude.

## Sensor Comparison

| Parameter | BME280 | BMP390 | SHT4x |
|---|---|---|---|
| Measures | T, H, P | T, P | T, H |
| Pressure accuracy | +/- 1 hPa | +/- 0.5 hPa (relative +/-3 Pa) | N/A |
| Humidity accuracy | +/- 3% RH | N/A | +/- 1.8% RH |
| Temperature accuracy | +/- 1 deg C | +/- 0.5 deg C | +/- 0.2 deg C |
| Interface | I2C / SPI | I2C / SPI | I2C |
| Supply current (1 Hz) | 3.6 uA | 3.2 uA | 0.4 uA (single shot) |
| Package | 2.5 x 2.5 mm LGA | 2.0 x 2.0 mm LGA | 1.5 x 1.5 mm DFN |
| Cost (qty 1) | $3-5 | $4-6 | $3-5 |

The SHT4x from Sensirion is worth noting for humidity-focused applications: its +/-1.8% RH accuracy and fast response time (tau < 2 s) outperform the BME280's humidity channel. Combining an SHT4x for humidity with a BMP390 for pressure yields better accuracy than a single BME280, at the cost of an additional I2C device.

## Tips

- Always read calibration data from the BME280 at startup and store it in RAM — the compensation coefficients are unique per device and must not be hardcoded from a single sample
- In forced mode, poll the status register (bit 3, measuring) rather than using a fixed delay — conversion time varies with oversampling settings and the datasheet's worst-case figures include margin
- Set the humidity oversampling register (0xF2) before writing ctrl_meas (0xF4) — the BME280 only latches humidity configuration when ctrl_meas is written
- For altitude trending (e.g., floor detection in a building), use the IIR filter at coefficient 4-8 to smooth door-opening and HVAC pressure transients while preserving the slower signal of actual elevation changes
- Place the sensor away from heat sources on the PCB — even 1 degree C of board-level heating shifts the humidity reading by roughly 3-5% RH due to the temperature dependence of relative humidity

## Caveats

- **The BME280 humidity channel drifts after prolonged exposure to high humidity** — Extended operation above 80% RH can shift readings by 3% or more, and Bosch recommends a "bake-out" procedure (holding the sensor at 100-120 degrees C for several hours) to recover, which is impractical in most fielded products
- **Confusing the BMP280 and BME280 causes silent failures** — The BMP280 (no humidity) has chip ID 0x58; the BME280 has chip ID 0x60. Firmware that does not check the chip ID may attempt to read a humidity register that does not exist, returning stale or undefined data
- **The barometric altitude formula assumes a standard atmosphere** — In real conditions, local temperature, humidity, and weather fronts shift the actual pressure-altitude relationship, introducing errors of tens of meters without real-time reference correction
- **I2C clock stretching on the BME280 can stall a bus** — During conversion, the BME280 holds SCL low for up to 1 ms. Bus masters that do not support clock stretching (some bit-banged implementations) interpret this as a bus error

## In Practice

- A BME280 mounted directly next to an ESP32 module consistently reads 2-4 degrees C above ambient because the Wi-Fi radio dissipates 200-300 mW — routing the sensor to the board edge or onto a breakout with a thermal isolation slot corrects this
- Altitude readings from a BMP390 that oscillate by +/-1 m at rest with IIR filter off stabilize to +/-0.2 m with IIR coefficient 8, but the response to riding an elevator becomes noticeably sluggish — the tradeoff is application-specific
- A humidity sensor behind a PTFE membrane that responds slowly to breath tests but tracks daily humidity cycles correctly is behaving as designed — the membrane protects against condensation and dust at the expense of response time
- Pressure readings that show a steady 0.5 hPa offset compared to a nearby weather station are within the BME280's absolute accuracy spec — for trending applications, the offset is irrelevant; for absolute altitude, a one-time offset calibration is necessary
