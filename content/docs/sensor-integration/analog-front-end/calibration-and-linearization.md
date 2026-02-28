---
title: "Calibration & Linearization"
weight: 40
---

# Calibration & Linearization

Raw ADC codes are not physical measurements. Converting code 2048 on a 12-bit ADC into "25.3 C" or "101.2 kPa" requires a calibration model — a mapping from raw digital values to real-world units. The simplest sensors have a linear transfer function that needs only an offset and a gain correction. Others — NTC thermistors, photodiodes, pH probes — have nonlinear responses that require lookup tables, polynomial fits, or physics-based equations. Getting calibration right is the difference between a sensor reading that is "approximately correct" and one that is traceable to a known reference.

## Two-Point (Offset and Gain) Calibration

A linear sensor has the transfer function:

```
physical_value = gain * adc_raw + offset
```

Two-point calibration determines the gain and offset by measuring two known reference points. At each point, the true physical value and the corresponding ADC raw reading are recorded:

```
Point 1: true_low,  adc_low
Point 2: true_high, adc_high

gain   = (true_high - true_low) / (adc_high - adc_low)
offset = true_low - gain * adc_low
```

**Example: Calibrating a pressure sensor (0–100 kPa, 0.5–4.5 V output) on a 12-bit 3.3 V ADC**

Apply 0 kPa (vented to atmosphere after zeroing): sensor outputs 0.500 V, ADC reads 620.
Apply 100 kPa from a reference source: sensor outputs 4.20 V — but this exceeds the 3.3 V ADC range. With a 0.66x voltage divider: 4.20 * 0.66 = 2.77 V, ADC reads 3436.

```
gain   = (100.0 - 0.0) / (3436 - 620) = 0.03552 kPa/count
offset = 0.0 - 0.03552 * 620 = -22.02 kPa
```

The calibrated reading becomes:

```c
float pressure_kpa = 0.03552f * (float)adc_raw - 22.02f;
```

```c
/* Two-point calibration structure and application */
typedef struct {
    float gain;
    float offset;
} cal_linear_t;

static cal_linear_t cal_compute_linear(float true_low, uint16_t adc_low,
                                        float true_high, uint16_t adc_high)
{
    cal_linear_t cal;
    cal.gain   = (true_high - true_low) / (float)(adc_high - adc_low);
    cal.offset = true_low - cal.gain * (float)adc_low;
    return cal;
}

static float cal_apply_linear(const cal_linear_t *cal, uint16_t adc_raw)
{
    return cal->gain * (float)adc_raw + cal->offset;
}

/* Usage */
static cal_linear_t pressure_cal;

void calibrate_pressure(void)
{
    /* Step 1: Apply 0 kPa reference, read ADC */
    uint16_t adc_zero = adc_read_averaged(&hadc1);  /* e.g., 620 */

    /* Step 2: Apply 100 kPa reference, read ADC */
    uint16_t adc_full = adc_read_averaged(&hadc1);   /* e.g., 3436 */

    pressure_cal = cal_compute_linear(0.0f, adc_zero, 100.0f, adc_full);
}

float read_pressure_kpa(void)
{
    uint16_t raw = adc_read_averaged(&hadc1);
    return cal_apply_linear(&pressure_cal, raw);
}
```

## Multi-Point Linearization with Lookup Tables

When the sensor transfer function is nonlinear, two-point calibration leaves residual errors that grow with distance from the calibration points. Multi-point calibration samples the transfer function at several known points and stores the results in a lookup table (LUT). Between table entries, linear interpolation provides reasonable accuracy without needing to model the exact curve shape.

```c
/* Lookup table with linear interpolation */
typedef struct {
    uint16_t adc_val;    /* Raw ADC reading at this calibration point */
    float    phys_val;   /* Corresponding physical value */
} cal_point_t;

#define CAL_TABLE_SIZE  8

static const cal_point_t cal_table[CAL_TABLE_SIZE] = {
    {  200,  -20.0f },   /* -20 C */
    {  520,    0.0f },   /*   0 C */
    {  950,   25.0f },   /*  25 C */
    { 1380,   50.0f },   /*  50 C */
    { 1850,   75.0f },   /*  75 C */
    { 2400,  100.0f },   /* 100 C */
    { 3050,  130.0f },   /* 130 C */
    { 3680,  160.0f },   /* 160 C */
};

static float cal_lookup_interpolate(uint16_t adc_raw)
{
    /* Below table range: clamp to first entry */
    if (adc_raw <= cal_table[0].adc_val) {
        return cal_table[0].phys_val;
    }

    /* Above table range: clamp to last entry */
    if (adc_raw >= cal_table[CAL_TABLE_SIZE - 1].adc_val) {
        return cal_table[CAL_TABLE_SIZE - 1].phys_val;
    }

    /* Find the two surrounding entries */
    for (int i = 0; i < CAL_TABLE_SIZE - 1; i++) {
        if (adc_raw >= cal_table[i].adc_val &&
            adc_raw <  cal_table[i + 1].adc_val)
        {
            /* Linear interpolation between entries */
            float fraction = (float)(adc_raw - cal_table[i].adc_val) /
                             (float)(cal_table[i + 1].adc_val - cal_table[i].adc_val);

            return cal_table[i].phys_val +
                   fraction * (cal_table[i + 1].phys_val - cal_table[i].phys_val);
        }
    }

    /* Should not reach here */
    return cal_table[CAL_TABLE_SIZE - 1].phys_val;
}
```

The number of table entries depends on the nonlinearity. A mildly nonlinear sensor (RTD, linear thermocouple) might need 5–8 points for 0.1% accuracy. A highly nonlinear sensor (NTC thermistor over a wide range) may need 15–20 points or a different approach entirely.

## Steinhart-Hart Equation for NTC Thermistors

NTC thermistors follow a highly nonlinear resistance-temperature curve. The Steinhart-Hart equation models this relationship with three coefficients:

```
1/T = A + B * ln(R) + C * (ln(R))^3
```

where T is absolute temperature in Kelvin and R is the thermistor resistance in ohms.

**Deriving coefficients for an NTC 10K3A1 (Vishay NTCS0805E3103FMT):**

Using three calibration points from the datasheet or measured with a precision thermometer and ohmmeter:

| Temperature | Resistance  | ln(R)    |
|-------------|-------------|----------|
| 0 C (273.15 K)   | 27,218 ohm | 10.212  |
| 25 C (298.15 K)  | 10,000 ohm | 9.2103  |
| 50 C (323.15 K)  |  4,160 ohm | 8.3330  |

Solving the system of three equations yields:

```
A = 1.12764e-3
B = 2.34282e-4
C = 8.72420e-8
```

These coefficients produce accuracy within +/-0.2 C across the 0–50 C range for this specific thermistor model.

```c
#include <math.h>

/* Steinhart-Hart coefficients for NTCS0805E3103FMT (10K NTC) */
#define SH_A  1.12764e-3f
#define SH_B  2.34282e-4f
#define SH_C  8.72420e-8f

/* Series resistor in voltage divider (placed between VREF and thermistor) */
#define R_SERIES  10000.0f

static float ntc_adc_to_celsius(uint16_t adc_raw, uint16_t adc_max)
{
    /* Calculate thermistor resistance from voltage divider ratio
       Circuit: VREF --- R_SERIES --- ADC_PIN --- NTC --- GND
       V_adc = VREF * R_ntc / (R_series + R_ntc)
       R_ntc = R_series * adc_raw / (adc_max - adc_raw) */

    if (adc_raw == 0 || adc_raw >= adc_max) {
        return -999.0f;  /* Out of range */
    }

    float r_ntc = R_SERIES * (float)adc_raw / (float)(adc_max - adc_raw);
    float ln_r  = logf(r_ntc);

    /* Steinhart-Hart equation */
    float inv_t = SH_A + SH_B * ln_r + SH_C * ln_r * ln_r * ln_r;
    float temp_k = 1.0f / inv_t;

    return temp_k - 273.15f;
}
```

### Beta Equation (Simplified Alternative)

For narrow temperature ranges (+/-15 C around a reference point), the simpler Beta equation is often sufficient:

```
1/T = 1/T0 + (1/B) * ln(R/R0)
```

where T0 is the reference temperature (typically 25 C = 298.15 K), R0 is the resistance at T0 (10 kohm for a 10K NTC), and B is the Beta value from the datasheet (typically 3000–4500 K).

```c
#define NTC_BETA    3435.0f   /* Beta value (25/50) from datasheet */
#define NTC_R0      10000.0f  /* Resistance at T0 */
#define NTC_T0_K    298.15f   /* Reference temperature (25 C in Kelvin) */

static float ntc_beta_to_celsius(float r_ntc)
{
    float temp_k = 1.0f / (1.0f / NTC_T0_K + (1.0f / NTC_BETA) * logf(r_ntc / NTC_R0));
    return temp_k - 273.15f;
}
```

The Beta equation introduces +/-0.5–1.0 C error at the extremes of a 0–100 C range. Over a 20–30 C span centered on the reference temperature, accuracy is typically within +/-0.2 C — comparable to Steinhart-Hart.

## Polynomial Curve Fitting

For sensors where a physics-based model is unavailable or inconvenient, a polynomial fit maps ADC codes to physical values:

```
y = a0 + a1*x + a2*x^2 + a3*x^3 + ...
```

The coefficients are determined offline (MATLAB, Python NumPy, or Excel) using calibration data. Third-order polynomials handle most sensor nonlinearities; higher orders risk overfitting and oscillation between calibration points (Runge's phenomenon).

```c
/* Third-order polynomial calibration (coefficients from offline curve fit) */
static float poly3_calibrate(float adc_raw)
{
    const float a0 = -4.2315e+1f;
    const float a1 =  3.8842e-2f;
    const float a2 = -1.2217e-6f;
    const float a3 =  5.4410e-11f;

    float x = adc_raw;
    return a0 + a1 * x + a2 * x * x + a3 * x * x * x;
}
```

Using Horner's method for efficient evaluation:

```c
static float poly3_horner(float x)
{
    return a0 + x * (a1 + x * (a2 + x * a3));
}
```

Horner's form uses 3 multiplies and 3 adds instead of 6 multiplies and 3 adds — a meaningful difference on Cortex-M0 cores without hardware multiply-accumulate.

## Storing Calibration Constants in Flash

Calibration data must survive power cycles. On STM32, the most common approaches are:

**Option 1: Dedicated flash page.** Reserve the last page of flash (or a page in a separate flash bank) for calibration storage. STM32 flash can only be erased in whole pages (typically 2–16 KB depending on the family).

```c
/* STM32 flash calibration storage (STM32F4 example) */
#include "stm32f4xx_hal.h"

/* Place calibration data at a fixed address — last sector of flash */
#define CAL_FLASH_ADDR  0x080E0000  /* Sector 11 on STM32F407 */

typedef struct {
    uint32_t    magic;       /* Magic number to verify valid data */
    uint32_t    version;     /* Calibration format version */
    cal_linear_t pressure;   /* Pressure sensor calibration */
    float       sh_a, sh_b, sh_c;  /* NTC Steinhart-Hart coefficients */
    uint32_t    crc;         /* CRC32 of preceding fields */
} cal_storage_t;

#define CAL_MAGIC  0xCA1BDA7A

static const cal_storage_t *cal_read(void)
{
    const cal_storage_t *stored = (const cal_storage_t *)CAL_FLASH_ADDR;

    if (stored->magic != CAL_MAGIC) {
        return NULL;  /* No valid calibration data */
    }

    /* Verify CRC (implementation depends on CRC peripheral or software) */
    uint32_t expected_crc = crc32_compute((const uint8_t *)stored,
                                          offsetof(cal_storage_t, crc));
    if (stored->crc != expected_crc) {
        return NULL;  /* Corrupted data */
    }

    return stored;
}

static HAL_StatusTypeDef cal_write(const cal_storage_t *cal)
{
    HAL_StatusTypeDef status;

    HAL_FLASH_Unlock();

    /* Erase the calibration sector */
    FLASH_EraseInitTypeDef erase_cfg = {
        .TypeErase = FLASH_TYPEERASE_SECTORS,
        .Sector    = FLASH_SECTOR_11,
        .NbSectors = 1,
        .VoltageRange = FLASH_VOLTAGE_RANGE_3,
    };
    uint32_t sector_error;
    status = HAL_FLASHEx_Erase(&erase_cfg, &sector_error);
    if (status != HAL_OK) {
        HAL_FLASH_Lock();
        return status;
    }

    /* Write calibration data word by word */
    const uint32_t *src = (const uint32_t *)cal;
    uint32_t addr = CAL_FLASH_ADDR;
    for (size_t i = 0; i < sizeof(cal_storage_t) / 4; i++) {
        status = HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, addr, src[i]);
        if (status != HAL_OK) break;
        addr += 4;
    }

    HAL_FLASH_Lock();
    return status;
}
```

**Option 2: Emulated EEPROM.** STM32 provides an EEPROM emulation library (AN4894) that implements wear-leveling across two flash pages. This is preferable when calibration values are updated frequently (field recalibration).

**Option 3: External EEPROM.** A small I2C EEPROM (AT24C02 — 256 bytes, $0.10) provides byte-addressable, endurance-rated (1M cycles) storage without flash page erase constraints. Suitable for production systems with frequent recalibration.

## Factory Calibration vs Field Calibration

| Aspect            | Factory Calibration                    | Field Calibration                      |
|-------------------|---------------------------------------|---------------------------------------|
| When              | During production test                | After deployment, periodically        |
| Reference quality | Precision instruments, controlled env | Portable references, ambient conditions|
| Accuracy          | Best achievable for the hardware      | Limited by field reference quality    |
| Persistence       | Written once, rarely updated          | Updated periodically                  |
| Implementation    | Programmed via JTAG or test fixture   | Triggered by user or scheduled task   |
| Storage           | Flash (one-time write area)           | Flash with wear leveling or EEPROM    |

Many products use a two-tier approach: factory calibration for initial offset and gain, with field calibration adjusting only the offset (zero-point) — the gain is more difficult to verify in the field because it requires a known full-scale reference.

## Tips

- Always include a magic number and CRC in calibration storage — firmware that boots with corrupted calibration data and applies garbage gain/offset values produces readings that look plausible but are dangerously wrong.
- For NTC thermistors, prefer Steinhart-Hart over the Beta equation when the temperature range exceeds 30 C — the additional computation (one log, a few multiplies) costs less than 10 us on a Cortex-M4 with FPU and saves 0.5–1.0 C of error.
- Perform two-point calibration at 10% and 90% of the measurement range rather than at 0% and 100% — the endpoints are often less linear, and the calibration points should be in the region where accuracy matters most.
- Store calibration coefficients as floats (IEEE 754 single precision) rather than scaled integers — the flash space is negligible (4 bytes per coefficient), and floating-point avoids scaling errors that creep in during integer arithmetic.
- Build a calibration mode into the firmware from the start — even a simple UART command that triggers the calibration sequence and writes coefficients to flash saves hours of development time versus adding it later.

## Caveats

- **Flash endurance is limited** — STM32 flash is typically rated for 10,000 erase-program cycles per page. Recalibrating once per day exceeds this in 27 years (acceptable for most products), but recalibrating every minute would exhaust the flash in one week. Frequent writes require EEPROM emulation or external EEPROM.
- **Polynomial fits can diverge outside the calibration range** — A third-order polynomial calibrated from 0 to 100 C may produce absurd values at -10 C or 120 C. Always clamp the output to the physically meaningful range.
- **Calibration does not compensate for drift over time** — Sensor sensitivity, reference voltage, and resistor values all change with age and environmental exposure. A calibration performed at the factory may be off by 1–2% after years in the field. Critical applications schedule periodic recalibration.
- **Steinhart-Hart coefficients are specific to the thermistor model** — Using coefficients from a different NTC part number or even a different production lot can introduce errors of several degrees. Coefficients should be derived from the specific thermistor's datasheet or measured directly.
- **Writing flash during normal operation causes a brief stall** — On STM32 devices that execute from the same flash bank being programmed, the CPU stalls for the duration of the write (up to several milliseconds per word on some families). This can disrupt time-critical tasks. Writing to a separate flash bank or scheduling the write during a known idle period avoids this.

## In Practice

**A temperature reading that is accurate at 25 C but reads 2 C high at 0 C and 3 C low at 60 C** is the classic signature of using the Beta equation outside its valid range. The Beta model assumes a single exponential relationship that only holds near the reference temperature. Switching to Steinhart-Hart with three-point calibration typically collapses the error to +/-0.2 C across the full range.

**Calibration constants that appear correct after programming but return garbage on the next boot** usually indicate that the flash write did not complete successfully, or the calibration structure's memory layout changed between firmware versions. Checking the magic number and CRC on every boot catches both issues. Adding a version field to the structure allows firmware to detect and handle format changes gracefully.

**A sensor that reads correctly after calibration but drifts by 0.5–1% over several hours of operation** often reveals thermal effects on the signal conditioning circuit — not the sensor itself. Resistor dividers and op-amp offset voltages shift with temperature. Measuring the board temperature near the analog circuitry with a separate sensor and correlating it with the drift confirms whether thermal compensation or better component selection (lower TCR resistors, chopper-stabilized op-amps) is needed.

**Lookup table interpolation that produces a visible "staircase" pattern when the physical quantity changes smoothly** indicates too few table entries in a region of high curvature. Adding one or two additional calibration points in the steep part of the curve (for NTC thermistors, this is typically the low-temperature end where resistance changes rapidly) smooths the output without increasing table size significantly.

**ADC codes at the extreme ends of the lookup table (below the first entry or above the last) that produce clamped constant values** are a sign that the sensor's operating range exceeds the calibrated range. This is not necessarily an error — clamping prevents extrapolation artifacts — but it does mean the reading is unreliable in that region. Extending the calibration table or flagging out-of-range conditions in firmware makes the limitation explicit.
