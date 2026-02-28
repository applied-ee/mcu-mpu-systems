---
title: "Gas & Air Quality Sensors"
weight: 30
---

# Gas & Air Quality Sensors

Gas and air quality sensing in embedded systems spans a wide range of technologies — from simple heated metal-oxide elements that change resistance in the presence of volatile organic compounds, to sophisticated MEMS devices that compute air quality indices on-chip. The common thread is that all gas sensors require careful attention to warm-up time, baseline calibration, cross-sensitivity, and long-term drift. Firmware that treats a gas sensor like a simple ADC read-and-convert device produces unreliable data.

## Metal-Oxide (MQ-Series) Sensors

The MQ series from Winsen (MQ-2, MQ-3, MQ-7, MQ-135, etc.) are the most common entry point for gas detection in embedded projects. Each sensor contains a tin dioxide (SnO2) sensing element and an internal heater coil. The heater raises the element to 200-400 degrees C, at which point the SnO2 surface adsorbs target gas molecules, changing its electrical resistance.

### Heater Circuit

The heater requires 5V at approximately 150 mA (about 750 mW). This is a substantial load — a USB port can power one or two MQ sensors, but a battery-powered system needs careful power budgeting. The heater must run continuously for accurate readings; pulsed heating is possible but requires recalibration of the response curves.

### Load Resistor and Rs/Ro Ratio

The sensor output is a variable resistance (Rs) in series with a fixed load resistor (RL). The datasheet provides sensitivity curves as Rs/Ro versus gas concentration in ppm, where Ro is the sensor resistance in clean air. A common RL value is 10K-47K, chosen to place the output voltage in a readable range for the target gas concentrations.

```c
#include "stm32f4xx_hal.h"
#include <math.h>

#define ADC_RESOLUTION  4096
#define V_SUPPLY        5.0f
#define R_LOAD          10000.0f  /* 10K load resistor */
#define MQ2_RO_CLEAN    9830.0f   /* Ro measured in clean air */

static ADC_HandleTypeDef hadc1;

float mq2_read_rs(void) {
    HAL_ADC_Start(&hadc1);
    HAL_ADC_PollForConversion(&hadc1, 100);
    uint32_t adc_raw = HAL_ADC_GetValue(&hadc1);

    float v_out = (adc_raw / (float)ADC_RESOLUTION) * V_SUPPLY;
    if (v_out < 0.01f) return 999999.0f;  /* Avoid division by zero */

    /* Rs = RL * (Vsupply - Vout) / Vout */
    float rs = R_LOAD * (V_SUPPLY - v_out) / v_out;
    return rs;
}

float mq2_lpg_ppm(float rs) {
    float ratio = rs / MQ2_RO_CLEAN;
    /*
     * Approximate LPG curve from MQ-2 datasheet (log-log linear):
     * log(ppm) = (log(ratio) - b) / m
     * Coefficients derived from datasheet curve fitting:
     * m = -0.47, b = 1.30 (for LPG on MQ-2)
     */
    float log_ppm = (logf(ratio) - 1.30f) / -0.47f;
    return powf(10.0f, log_ppm);
}
```

### Ro Calibration

The Ro value must be measured in known clean air after the sensor has been heated for at least 24-48 hours (initial burn-in). The calibration procedure:

1. Power the heater continuously for 24+ hours.
2. Place the sensor in clean outdoor air (or air confirmed to be free of target gases).
3. Read Rs repeatedly and average over several minutes.
4. The averaged Rs in clean air becomes Ro.
5. Store Ro in flash/EEPROM for the specific sensor unit.

Without this calibration step, the ppm readings from the MQ-series are essentially meaningless — the Ro variation between units can be 2-3x.

## SGP40 VOC Index Sensor

The SGP40 from Sensirion is a digital metal-oxide VOC sensor that communicates over I2C (address 0x59, fixed). Unlike the MQ series, the SGP40 includes an on-chip heater driver and returns a raw signal (SRAW) that the Sensirion VOC Algorithm library converts to a VOC Index from 0 to 500 (100 = baseline "normal" air).

### I2C Measurement Sequence

The SGP40 uses a CRC-protected I2C protocol. Each command and data word is accompanied by an 8-bit CRC. Temperature and humidity compensation values are passed with each measurement command to improve accuracy.

```c
#include "stm32f4xx_hal.h"

#define SGP40_ADDR          (0x59 << 1)
#define SGP40_CMD_MEASURE   0x260F

static uint8_t sgp40_crc(uint8_t *data) {
    uint8_t crc = 0xFF;
    for (int i = 0; i < 2; i++) {
        crc ^= data[i];
        for (int b = 0; b < 8; b++) {
            crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : (crc << 1);
        }
    }
    return crc;
}

uint16_t sgp40_measure_raw(I2C_HandleTypeDef *hi2c,
                            float temp_c, float rh_percent) {
    /* Encode humidity and temperature for compensation */
    uint16_t rh_ticks = (uint16_t)((rh_percent * 65535.0f) / 100.0f);
    uint16_t t_ticks  = (uint16_t)(((temp_c + 45.0f) * 65535.0f) / 175.0f);

    uint8_t cmd[8];
    cmd[0] = 0x26;  /* Measure command MSB */
    cmd[1] = 0x0F;  /* Measure command LSB */
    cmd[2] = rh_ticks >> 8;
    cmd[3] = rh_ticks & 0xFF;
    cmd[4] = sgp40_crc(&cmd[2]);
    cmd[5] = t_ticks >> 8;
    cmd[6] = t_ticks & 0xFF;
    cmd[7] = sgp40_crc(&cmd[5]);

    HAL_I2C_Master_Transmit(hi2c, SGP40_ADDR, cmd, 8, 100);
    HAL_Delay(30);  /* Measurement takes ~30 ms */

    uint8_t response[3];
    HAL_I2C_Master_Receive(hi2c, SGP40_ADDR, response, 3, 100);

    /* Verify CRC */
    if (sgp40_crc(response) != response[2]) {
        return 0xFFFF;  /* CRC error */
    }

    return (response[0] << 8) | response[1];
}
```

The raw SRAW value is then passed to Sensirion's open-source `sensirion_gas_index_algorithm` library, which maintains an adaptive baseline and outputs the VOC Index. This algorithm requires continuous measurements at 1 Hz to function correctly — irregular or infrequent readings prevent the baseline from tracking properly.

## BME688 Gas Scanner

The BME688 from Bosch combines the BME280's temperature/humidity/pressure sensing with a gas scanner capable of discriminating between multiple gas profiles. Unlike the BME680 (which runs the heater at a single temperature), the BME688 supports a programmable heater profile — up to 10 temperature-duration steps per measurement cycle. Different gases respond differently at different heater temperatures, enabling rudimentary gas discrimination through multi-step heater scanning.

Configuration of the BME688 gas scanner requires Bosch's BSEC2 library, which runs the machine-learning-based classification on the raw sensor data. The BSEC2 library is proprietary and distributed as a precompiled binary, available for Cortex-M0+, M3, M4, and M33 targets. Integration requires providing a timer callback, an I2C read/write callback, and approximately 2 KB of RAM for the algorithm state.

## Electrochemical Sensors

Electrochemical cells (e.g., Alphasense CO-B4 for carbon monoxide, NO2-B43F for nitrogen dioxide) are the standard for precise measurement of individual toxic gases. They produce a tiny current (nanoamps to microamps) proportional to gas concentration. The front-end requires a transimpedance amplifier (TIA) or a dedicated analog front-end IC like the LMP91000 to convert the cell current to a voltage readable by an ADC.

Key characteristics:
- High selectivity to the target gas (much better than metal-oxide sensors)
- Slow response time (T90 of 15-30 seconds)
- Limited lifespan (typically 2-3 years)
- Temperature-dependent output requiring compensation
- Cross-sensitivity to other gases (documented in datasheet cross-sensitivity tables)

## CCS811 eCO2 / TVOC

The CCS811 from ScioSense (formerly AMS) is a popular I2C VOC sensor (address 0x5A or 0x5B) that reports equivalent CO2 (eCO2, 400-8192 ppm) and Total VOC (TVOC, 0-1187 ppb). The "equivalent CO2" is not a direct CO2 measurement — it is an estimate derived from VOC levels, assuming a typical indoor environment where human breath and activity are the primary VOC sources.

The CCS811 requires a 20-minute warm-up period on each power-on before readings stabilize. For consistent performance, a 48-hour burn-in period is recommended for new devices. The sensor includes a baseline register that captures the algorithm's learned environment model — saving and restoring this value across power cycles avoids the full re-learning period.

### Baseline Save and Restore

```c
#define CCS811_ADDR         (0x5A << 1)
#define CCS811_REG_BASELINE 0x11
#define CCS811_REG_ENV_DATA 0x05

uint16_t ccs811_get_baseline(I2C_HandleTypeDef *hi2c) {
    uint8_t buf[2];
    HAL_I2C_Mem_Read(hi2c, CCS811_ADDR, CCS811_REG_BASELINE,
                     I2C_MEMADD_SIZE_8BIT, buf, 2, 100);
    return (buf[0] << 8) | buf[1];
}

void ccs811_set_baseline(I2C_HandleTypeDef *hi2c, uint16_t baseline) {
    uint8_t buf[2] = { baseline >> 8, baseline & 0xFF };
    HAL_I2C_Mem_Write(hi2c, CCS811_ADDR, CCS811_REG_BASELINE,
                      I2C_MEMADD_SIZE_8BIT, buf, 2, 100);
}

void ccs811_set_env_data(I2C_HandleTypeDef *hi2c,
                         float temp_c, float rh_percent) {
    /* Encode per CCS811 datasheet: humidity and temp as fixed-point */
    uint16_t hum_enc = (uint16_t)(rh_percent * 512.0f);
    uint16_t temp_enc = (uint16_t)((temp_c + 25.0f) * 512.0f);
    uint8_t buf[4] = {
        hum_enc >> 8, hum_enc & 0xFF,
        temp_enc >> 8, temp_enc & 0xFF
    };
    HAL_I2C_Mem_Write(hi2c, CCS811_ADDR, CCS811_REG_ENV_DATA,
                      I2C_MEMADD_SIZE_8BIT, buf, 4, 100);
}
```

The baseline should be saved to flash approximately every 24 hours during operation, and restored at startup. Feeding temperature and humidity data from an external sensor (e.g., BME280) through the ENV_DATA register improves the CCS811's compensation accuracy.

## Warm-Up, Burn-In, and Drift

All gas sensors share a common operational reality: they need time to stabilize.

| Sensor | Warm-Up (per power-on) | Burn-In (new device) | Drift Rate |
|---|---|---|---|
| MQ-2 / MQ-series | 2-5 minutes (heater) | 24-48 hours | Significant (months) |
| SGP40 | ~60 seconds | Minimal | Low (self-calibrating) |
| BME688 | ~5 minutes | 48 hours (BSEC2) | Moderate |
| CCS811 | 20 minutes | 48 hours | Moderate |
| Electrochemical | Seconds | None | Slow (months to years) |

Firmware should flag readings during the warm-up period as invalid and not include them in logged data or trigger threshold alarms. A common approach is to set a `sensor_ready` flag based on elapsed time since power-on, gating all downstream processing.

## Cross-Sensitivity

Metal-oxide sensors respond to multiple gases, not just the target. The MQ-2 (marketed for LPG/methane) also responds strongly to alcohol, hydrogen, and smoke. The MQ-135 ("air quality") responds to ammonia, benzene, alcohol, and CO2 — making any single-gas ppm reading an approximation at best.

Digital sensors like the SGP40 and CCS811 report index values rather than specific gas concentrations, which is a more honest representation of what a broadband VOC sensor can actually deliver. Treating eCO2 from a CCS811 as a substitute for a real NDIR CO2 sensor (like the SCD40) leads to misleading data in environments where VOC sources do not correlate with CO2 levels.

## Tips

- Store the MQ sensor Ro calibration value in non-volatile memory per unit — the unit-to-unit variation is large enough that a single hardcoded Ro renders ppm readings meaningless across different boards
- Feed the SGP40 real temperature and humidity data from an external sensor at every measurement cycle — the compensation materially improves accuracy, and the sensor defaults to 25 degrees C / 50% RH if no compensation data is provided
- Run the CCS811 continuously rather than duty-cycling it to maintain the adaptive baseline — powering the sensor off and on resets the algorithm state unless the baseline is explicitly saved and restored
- For the BME688 gas scanner, start with Bosch's BSEC2 example configurations before attempting custom heater profiles — the interaction between heater temperature, duration, and gas response is highly nonlinear

## Caveats

- **MQ-series sensors are not safety-rated** — They are suitable for indication and trending but must not be relied upon for life-safety gas detection, which requires certified electrochemical or catalytic bead sensors with redundancy
- **eCO2 from the CCS811 is not real CO2** — It is an inference from VOC levels and can be completely wrong in environments with CO2 sources that do not produce VOCs (e.g., a room full of people with no cooking or cleaning activity)
- **The SGP40 VOC Algorithm requires 1 Hz continuous sampling** — Running it at lower rates or with gaps causes the adaptive baseline to malfunction, producing index values that oscillate or peg at the limits
- **BME688 BSEC2 is a binary blob** — Its classification accuracy depends entirely on the training data provided through Bosch's AI Studio platform, and the internal model cannot be inspected or modified outside that ecosystem
- **Electrochemical sensor lifespan depends on cumulative exposure** — A CO sensor rated for 3 years in normal air may exhaust in 6 months in a high-CO environment like a poorly ventilated garage

## In Practice

- An MQ-2 sensor that produces a stable analog voltage after 24 hours of burn-in but drifts noticeably over weeks is behaving within specification — periodic Ro recalibration in clean air (monthly or quarterly) is part of normal maintenance for metal-oxide sensors
- An SGP40 that reads VOC Index 100 (baseline) immediately after power-on and then drifts to 80-90 over the first hour is showing the adaptive algorithm finding its baseline — data logged during this initial period should be treated as unreliable
- A CCS811 that reports eCO2 of 400 ppm in a sealed room with multiple occupants is almost certainly still in its warm-up phase or has a stale baseline — the true eCO2 in that scenario should be well above 600 ppm
- An MQ-135 that triggers an air quality alarm when hand sanitizer (ethanol) is used nearby is demonstrating cross-sensitivity, not a genuine air quality event — filtering out transient spikes (e.g., requiring sustained elevation for 30+ seconds) reduces false alarms
