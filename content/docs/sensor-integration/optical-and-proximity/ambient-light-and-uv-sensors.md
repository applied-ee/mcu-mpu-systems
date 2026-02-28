---
title: "Ambient Light & UV Sensors"
weight: 20
---

# Ambient Light & UV Sensors

Integrated ambient light sensors (ALS) combine a photodiode, amplifier, ADC, and digital interface into a single package, eliminating the need for external transimpedance amplifier design. These devices report light intensity in raw counts or calibrated lux over I2C, with automatic gain and integration time control for dynamic ranges spanning from fractions of a lux (moonlight) to over 100,000 lux (direct sunlight). UV sensors add UVA/UVB measurement for sunlight exposure monitoring, UV index calculation, and material curing applications.

## VEML7700 — High-Resolution Ambient Light Sensor

The VEML7700 from Vishay is a 16-bit ambient light sensor with I2C interface, providing a resolution of 0.0036 lux at maximum sensitivity. It features programmable gain (1×, 2×, 1/8×, 1/4×) and integration times from 25ms to 800ms, giving a measurement range from 0.0036 lux to approximately 120,000 lux.

### Register Configuration

```c
/* VEML7700 I2C driver — STM32 HAL */

#include "stm32f4xx_hal.h"

#define VEML7700_ADDR        (0x10 << 1)  /* 7-bit addr 0x10 */
#define VEML7700_ALS_CONF    0x00
#define VEML7700_ALS_WH      0x01  /* High threshold */
#define VEML7700_ALS_WL      0x02  /* Low threshold */
#define VEML7700_ALS_DATA    0x04
#define VEML7700_WHITE_DATA  0x05

/* ALS_CONF register bits */
#define ALS_GAIN_1           (0x00 << 11)
#define ALS_GAIN_2           (0x01 << 11)
#define ALS_GAIN_1_8         (0x02 << 11)
#define ALS_GAIN_1_4         (0x03 << 11)
#define ALS_IT_25MS          (0x0C << 6)
#define ALS_IT_50MS          (0x08 << 6)
#define ALS_IT_100MS         (0x00 << 6)
#define ALS_IT_200MS         (0x01 << 6)
#define ALS_IT_400MS         (0x02 << 6)
#define ALS_IT_800MS         (0x03 << 6)
#define ALS_SD_OFF           0x0001  /* Shutdown */
#define ALS_SD_ON            0x0000  /* Power on */

static I2C_HandleTypeDef *hi2c;

static HAL_StatusTypeDef veml7700_write_reg(uint8_t reg, uint16_t value)
{
    uint8_t buf[3];
    buf[0] = reg;
    buf[1] = value & 0xFF;        /* LSB first */
    buf[2] = (value >> 8) & 0xFF;
    return HAL_I2C_Master_Transmit(hi2c, VEML7700_ADDR, buf, 3, 100);
}

static uint16_t veml7700_read_reg(uint8_t reg)
{
    uint8_t buf[2];
    HAL_I2C_Master_Transmit(hi2c, VEML7700_ADDR, &reg, 1, 100);
    HAL_I2C_Master_Receive(hi2c, VEML7700_ADDR, buf, 2, 100);
    return (buf[1] << 8) | buf[0];
}

void veml7700_init(I2C_HandleTypeDef *i2c_handle)
{
    hi2c = i2c_handle;
    /* Gain 1×, integration time 100ms, power on */
    uint16_t conf = ALS_GAIN_1 | ALS_IT_100MS | ALS_SD_ON;
    veml7700_write_reg(VEML7700_ALS_CONF, conf);
    HAL_Delay(5);  /* Allow configuration to settle */
}

/**
 * Read ALS and convert to lux.
 * Resolution depends on gain and integration time.
 * At gain=1, IT=100ms: resolution = 0.0576 lux/count.
 */
float veml7700_read_lux(void)
{
    uint16_t raw = veml7700_read_reg(VEML7700_ALS_DATA);
    float resolution = 0.0576f;  /* lux per count at gain=1, IT=100ms */
    float lux = raw * resolution;

    /* Nonlinearity correction for readings above 1000 lux */
    if (lux > 1000.0f) {
        lux = 6.0135e-13f * lux * lux * lux * lux
            - 9.3924e-9f * lux * lux * lux
            + 8.1488e-5f * lux * lux
            + 1.0023f * lux;
    }
    return lux;
}
```

### Resolution Table by Gain and Integration Time

| Gain | Integration Time | Resolution (lux/count) | Max Lux |
|------|-----------------|----------------------|---------|
| 2× | 800ms | 0.0036 | 236 |
| 2× | 100ms | 0.0288 | 1,887 |
| 1× | 100ms | 0.0576 | 3,775 |
| 1/4× | 100ms | 0.2304 | 15,099 |
| 1/8× | 25ms | 1.8432 | 120,796 |

## BH1750 — Simple I2C Lux Sensor

The BH1750 from ROHM is one of the simplest digital light sensors available. It outputs calibrated lux values directly over I2C with no register configuration beyond a measurement mode command.

```c
#define BH1750_ADDR         (0x23 << 1)  /* ADDR pin low */
#define BH1750_CONT_HRES    0x10  /* Continuous high-res mode, 1 lux resolution */
#define BH1750_CONT_HRES2   0x11  /* Continuous high-res mode 2, 0.5 lux */
#define BH1750_ONE_HRES     0x20  /* One-time high-res measurement */

void bh1750_init(I2C_HandleTypeDef *i2c)
{
    uint8_t cmd = BH1750_CONT_HRES;
    HAL_I2C_Master_Transmit(i2c, BH1750_ADDR, &cmd, 1, 100);
    HAL_Delay(180);  /* First measurement takes up to 180ms */
}

float bh1750_read_lux(I2C_HandleTypeDef *i2c)
{
    uint8_t buf[2];
    HAL_I2C_Master_Receive(i2c, BH1750_ADDR, buf, 2, 100);
    uint16_t raw = (buf[0] << 8) | buf[1];  /* MSB first */
    return raw / 1.2f;  /* Convert to lux per datasheet */
}
```

## ALS Sensor Comparison

| Feature | VEML7700 | TSL2591 | BH1750 | OPT3001 |
|---|---|---|---|---|
| Interface | I2C | I2C | I2C | I2C |
| Resolution | 16-bit | 16-bit (per channel) | 16-bit | 23-bit effective |
| Lux range | 0–120k | 0–88k | 1–65535 | 0.01–83k |
| Min resolution | 0.0036 lux | 0.001 lux (computed) | 1 lux (0.5 in mode 2) | 0.01 lux |
| Channels | ALS + White | Visible + IR (2 ch) | Single | Single |
| Supply voltage | 2.5–3.6V | 3.3–5V | 2.4–3.6V | 1.6–3.6V |
| Supply current | 5 µA | 0.4 mA (active) | 0.12 mA | 1.8 µA |
| Package | QFN 4-pin | DFN-6 | SMD | USON-6 |
| Typical cost | $0.80 | $4.50 | $1.20 | $2.00 |
| Notes | Nonlinearity above 1k lux | Widest dynamic range | Simplest integration | Lowest power |

## UV Sensors

### VEML6075 — UVA/UVB Sensor

The VEML6075 provides separate UVA (365nm peak) and UVB (330nm peak) channel readings over I2C. Computing the UV index requires compensating for visible and IR light contamination using auxiliary channels.

### LTR-390 — UV + ALS Combo

The LTR-390-UV-01 combines a UV sensor (ultraviolet channel, 280–380nm) with an ambient light sensor in a single package. It offers 20-bit resolution and I2C interface with programmable gain (1×, 3×, 6×, 9×, 18×) and integration time (25ms to 400ms).

### UV Index Calculation

The UV index is a standardized scale derived from the erythemally-weighted UV irradiance. From raw sensor counts, the calculation follows:

```c
/**
 * UV Index from LTR-390 raw UV counts.
 * The sensitivity factor depends on gain and integration time.
 * At gain=3, IT=100ms: sensitivity = 2300 counts per UV index unit.
 */
float compute_uv_index(uint32_t uv_raw)
{
    const float sensitivity = 2300.0f;   /* counts per UVI at gain=3, IT=100ms */
    const float uv_coeff    = 1.0f;      /* window factor correction */

    float uvi = (uv_raw / sensitivity) * uv_coeff;
    return uvi;
}

/**
 * VEML6075 UV Index with visible/IR compensation.
 * Coefficients from Vishay application note.
 */
float veml6075_uv_index(uint16_t uva_raw, uint16_t uvb_raw,
                         uint16_t uvcomp1, uint16_t uvcomp2)
{
    /* Compensation coefficients (Vishay DN06) */
    const float a = 2.22f;
    const float b = 1.33f;
    const float c = 2.95f;
    const float d = 1.74f;

    float uva_comp = uva_raw - a * uvcomp1 - b * uvcomp2;
    float uvb_comp = uvb_raw - c * uvcomp1 - d * uvcomp2;

    if (uva_comp < 0) uva_comp = 0;
    if (uvb_comp < 0) uvb_comp = 0;

    /* Response factors for UV index */
    const float uva_resp = 0.001461f;
    const float uvb_resp = 0.002591f;

    float uvi = (uva_comp * uva_resp + uvb_comp * uvb_resp) / 2.0f;
    return uvi;
}
```

## Auto-Ranging (Gain and Integration Time)

For sensors that span several decades of lux range, a single gain/integration time setting cannot cover all conditions without either saturating in bright light or being noise-limited in dim light. Auto-ranging adjusts these parameters based on the most recent reading.

```c
typedef struct {
    uint8_t  gain_idx;
    uint8_t  it_idx;
    float    resolution;   /* lux per count */
} veml7700_range_t;

/* Ordered from most sensitive to least sensitive */
static const veml7700_range_t ranges[] = {
    { 1, 5, 0.0036f  },  /* gain=2,   IT=800ms */
    { 1, 4, 0.0072f  },  /* gain=2,   IT=400ms */
    { 0, 3, 0.0288f  },  /* gain=1,   IT=200ms */
    { 0, 2, 0.0576f  },  /* gain=1,   IT=100ms */
    { 3, 1, 0.4608f  },  /* gain=1/4, IT=50ms  */
    { 2, 0, 1.8432f  },  /* gain=1/8, IT=25ms  */
};

static int current_range = 3;  /* Start at mid-range */

float veml7700_auto_read_lux(void)
{
    uint16_t raw = veml7700_read_reg(VEML7700_ALS_DATA);

    /* If saturated (>90% of 16-bit range), shift to less sensitive range */
    if (raw > 58000 && current_range < 5) {
        current_range++;
        veml7700_apply_range(current_range);
        HAL_Delay(ranges[current_range].it_idx * 100 + 50);
        raw = veml7700_read_reg(VEML7700_ALS_DATA);
    }
    /* If too dim (<10% of range), shift to more sensitive range */
    else if (raw < 100 && current_range > 0) {
        current_range--;
        veml7700_apply_range(current_range);
        HAL_Delay(ranges[current_range].it_idx * 100 + 50);
        raw = veml7700_read_reg(VEML7700_ALS_DATA);
    }

    return raw * ranges[current_range].resolution;
}
```

## Lux Calculation Considerations

Raw sensor counts do not directly represent lux. The conversion depends on:

1. **Spectral response match** — The sensor's spectral sensitivity must approximate the CIE photopic luminosity function (V(λ)) for accurate lux readings. Sensors with separate visible and IR channels (like TSL2591) allow software correction by subtracting the IR contribution.

2. **Optical window attenuation** — Any cover glass, diffuser, or lens in front of the sensor attenuates incoming light. A clear glass window may transmit 90% at visible wavelengths but only 50% in the UV. The firmware calibration factor must account for the actual system optics.

3. **Angular response** — An ideal lux sensor follows a cosine angular response. Most integrated sensors approximate this, but readings at high incidence angles can deviate significantly. Adding a diffuser dome improves angular response at the cost of reduced peak sensitivity.

## Tips

- Use the VEML7700 or OPT3001 for battery-powered applications — their sub-10µA operating currents are an order of magnitude lower than the TSL2591
- Implement auto-ranging to cover the full dynamic range of ambient light without manual configuration — transition between gain and integration time settings based on the previous reading to avoid saturation or noise-limited measurements
- For UV index applications, always apply the visible/IR compensation formulas from the manufacturer's application notes — raw UVA/UVB readings without compensation can overestimate UV index by 2–3× under artificial lighting that contains visible and IR components
- Place the ALS sensor behind a white or translucent diffuser to improve angular response — a bare sensor recessed in an enclosure creates a narrow field of view that underestimates off-axis light
- Use the BH1750 for quick prototyping — its direct lux output with zero calibration needed makes it the fastest path to a working light measurement

## Caveats

- **VEML7700 nonlinearity above 1000 lux is significant** — Without applying the polynomial correction formula from the datasheet, readings at 10,000 lux can be 20–30% too low; the correction formula is a fourth-order polynomial that must be applied in firmware
- **BH1750 resolution is limited to 1 lux (0.5 lux in mode 2)** — For low-light applications below 10 lux, the BH1750 produces coarsely quantized readings; use the VEML7700 or TSL2591 for sub-lux resolution
- **UV sensor windows degrade over time** — Prolonged outdoor UV exposure can yellow the optical window material, reducing UV transmission and causing the UV index reading to drift downward over months
- **I2C address conflicts are common** — The VEML7700 has a fixed address (0x10), and many ALS sensors offer only one or two address options; check for conflicts when combining multiple I2C sensors on the same bus
- **Integration time affects sample rate** — At 800ms integration time (maximum sensitivity), the VEML7700 can only deliver about one reading per second, which may be too slow for responsive display backlight control

## In Practice

- A display backlight controller using the VEML7700 that works well indoors but clamps to maximum brightness outdoors is likely saturating the sensor at the current gain/integration time setting — implementing auto-ranging resolves this by switching to a less sensitive configuration in bright environments
- When a BH1750 reports 0 lux in a dimly lit room (5–10 lux actual), the 1-lux resolution is the limiting factor — switching to a higher-resolution sensor or using the BH1750's high-resolution mode 2 (0.5 lux steps) may recover the reading
- A UV index sensor that reads 2–3 UVI under indoor fluorescent lighting (which should be near zero) is showing the effect of uncompensated visible/IR contamination — applying the compensation formula brings the reading to the expected near-zero value
- Two identical ALS sensors in the same enclosure producing readings that differ by 30% typically have different angular relationships to the dominant light source — a diffuser dome over each sensor normalizes the angular response and brings the readings into closer agreement
