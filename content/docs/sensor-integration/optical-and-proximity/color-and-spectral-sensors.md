---
title: "Color & Spectral Sensors"
weight: 40
---

# Color & Spectral Sensors

Color sensors measure the spectral composition of light by splitting it across filtered channels — typically red, green, blue, and clear (unfiltered). Spectral sensors extend this concept to 8 or more channels spanning the visible and near-IR spectrum, enabling applications beyond simple color matching: plant health monitoring, material identification, skin tone measurement, and precise colorimetry. The firmware challenge lies in configuring gain and integration time for the lighting conditions, then converting raw channel counts into meaningful color coordinates or spectral power distributions.

## TCS34725 — RGB + Clear Channel Sensor

The TCS34725 from ams-OSRAM is a widely used 4-channel color sensor with I2C interface. It provides separate red, green, blue, and clear (unfiltered) channel readings with programmable gain (1×, 4×, 16×, 60×) and integration time (2.4ms to 700ms). An onboard IR-blocking filter reduces the near-IR contribution that would otherwise distort color measurements under incandescent or sunlight illumination.

### Register Map

| Register | Address | Description |
|---|---|---|
| ENABLE | 0x80 | Power on, AEN (ADC enable), interrupt enable |
| ATIME | 0x81 | Integration time (2.4ms steps, 0xFF = 2.4ms, 0x00 = 700ms) |
| WTIME | 0x83 | Wait time between cycles |
| AILTL/AILTH | 0x84/0x85 | Clear channel low threshold |
| AIHTL/AIHTH | 0x86/0x87 | Clear channel high threshold |
| PERS | 0x8C | Interrupt persistence filter |
| CONFIG | 0x8D | Wait long enable |
| CONTROL | 0x8F | Gain (1×/4×/16×/60×) |
| ID | 0x92 | Device ID (0x44 or 0x4D) |
| STATUS | 0x93 | AINT (interrupt), AVALID (data valid) |
| CDATAL/CDATAH | 0x94/0x95 | Clear channel data |
| RDATAL/RDATAH | 0x96/0x97 | Red channel data |
| GDATAL/GDATAH | 0x98/0x99 | Green channel data |
| BDATAL/BDATAH | 0x9A/0x9B | Blue channel data |

### Driver Implementation

```c
/* TCS34725 color sensor driver — STM32 HAL */

#include "stm32f4xx_hal.h"

#define TCS34725_ADDR        (0x29 << 1)
#define TCS_COMMAND_BIT      0x80
#define TCS_COMMAND_AUTO     0xA0  /* Auto-increment for multi-byte reads */

#define TCS_ENABLE           0x00
#define TCS_ATIME            0x01
#define TCS_CONTROL          0x0F
#define TCS_ID               0x12
#define TCS_STATUS           0x13
#define TCS_CDATAL           0x14

/* ENABLE register bits */
#define TCS_ENABLE_PON       0x01
#define TCS_ENABLE_AEN       0x02

/* Gain values for CONTROL register */
#define TCS_GAIN_1X          0x00
#define TCS_GAIN_4X          0x01
#define TCS_GAIN_16X         0x02
#define TCS_GAIN_60X         0x03

typedef struct {
    uint16_t clear;
    uint16_t red;
    uint16_t green;
    uint16_t blue;
} tcs34725_rgbc_t;

static I2C_HandleTypeDef *hi2c;

static void tcs_write(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { TCS_COMMAND_BIT | reg, val };
    HAL_I2C_Master_Transmit(hi2c, TCS34725_ADDR, buf, 2, 100);
}

static uint8_t tcs_read(uint8_t reg)
{
    uint8_t cmd = TCS_COMMAND_BIT | reg;
    uint8_t val;
    HAL_I2C_Master_Transmit(hi2c, TCS34725_ADDR, &cmd, 1, 100);
    HAL_I2C_Master_Receive(hi2c, TCS34725_ADDR, &val, 1, 100);
    return val;
}

static uint16_t tcs_read16(uint8_t reg)
{
    uint8_t cmd = TCS_COMMAND_AUTO | reg;
    uint8_t buf[2];
    HAL_I2C_Master_Transmit(hi2c, TCS34725_ADDR, &cmd, 1, 100);
    HAL_I2C_Master_Receive(hi2c, TCS34725_ADDR, buf, 2, 100);
    return (buf[1] << 8) | buf[0];
}

void tcs34725_init(I2C_HandleTypeDef *i2c_handle)
{
    hi2c = i2c_handle;

    /* Verify device ID */
    uint8_t id = tcs_read(TCS_ID);
    if (id != 0x44 && id != 0x4D) {
        return;  /* Wrong device or not connected */
    }

    /* Integration time: 0xC0 = 154ms (64 cycles × 2.4ms) */
    tcs_write(TCS_ATIME, 0xC0);

    /* Gain: 4× — good balance for indoor lighting */
    tcs_write(TCS_CONTROL, TCS_GAIN_4X);

    /* Power on + ADC enable */
    tcs_write(TCS_ENABLE, TCS_ENABLE_PON);
    HAL_Delay(3);  /* Power-on stabilization */
    tcs_write(TCS_ENABLE, TCS_ENABLE_PON | TCS_ENABLE_AEN);

    /* Wait for first integration cycle */
    HAL_Delay(160);
}

tcs34725_rgbc_t tcs34725_read_rgbc(void)
{
    tcs34725_rgbc_t color;
    color.clear = tcs_read16(TCS_CDATAL);
    color.red   = tcs_read16(TCS_CDATAL + 2);
    color.green = tcs_read16(TCS_CDATAL + 4);
    color.blue  = tcs_read16(TCS_CDATAL + 6);
    return color;
}
```

## Color Temperature Calculation

Correlated Color Temperature (CCT) describes the apparent warmth or coolness of a light source in Kelvin. The TCS34725 application note provides a formula based on the chromaticity coordinates derived from RGB readings.

```c
/**
 * Calculate correlated color temperature (CCT) from RGB values.
 * Uses McCamy's approximation based on CIE 1931 chromaticity.
 *
 * Returns: CCT in Kelvin (1000K = very warm, 6500K = daylight, 10000K+ = blue sky)
 */
float tcs34725_calculate_cct(tcs34725_rgbc_t *c)
{
    /* Prevent division by zero */
    if (c->red == 0 || c->clear == 0) return 0.0f;

    /* Chromaticity coordinates */
    float X = -0.14282f * c->red + 1.54924f * c->green - 0.95641f * c->blue;
    float Y = -0.32466f * c->red + 1.57837f * c->green - 0.73191f * c->blue;
    float Z = -0.68202f * c->red + 0.77073f * c->green + 0.56332f * c->blue;

    float sum = X + Y + Z;
    if (sum < 1.0f) return 0.0f;

    float x_chrom = X / sum;
    float y_chrom = Y / sum;

    /* McCamy's formula: CCT = 449n³ + 3525n² + 6823.3n + 5520.33 */
    /* where n = (x - 0.3320) / (0.1858 - y) */
    float n = (x_chrom - 0.3320f) / (0.1858f - y_chrom);
    float cct = 449.0f * n * n * n + 3525.0f * n * n + 6823.3f * n + 5520.33f;

    return cct;
}

/**
 * Compute illuminance (lux) from the clear channel.
 * Approximate — depends on the light source spectrum.
 * Integration time and gain affect the scaling factor.
 */
float tcs34725_calculate_lux(tcs34725_rgbc_t *c)
{
    /* Empirical formula from ams application note DN40 */
    /* At ATIME=0xC0 (154ms), GAIN=4× */
    float lux = (-0.32466f * c->red + 1.57837f * c->green - 0.73191f * c->blue);

    /* Scale by integration time and gain */
    float atime_ms = 154.0f;
    float gain = 4.0f;
    float cpl = (atime_ms * gain) / 310.0f;  /* Counts per lux */
    lux = lux / cpl;

    return (lux > 0) ? lux : 0.0f;
}
```

## AS7341 — 11-Channel Spectral Sensor

The AS7341 from ams-OSRAM is an 11-channel spectral sensor covering the visible and near-IR spectrum. It uses a nano-optic interference filter array to create 8 visible channels, one clear channel, one near-IR channel, and one flicker detection channel. The sensor cannot measure all channels simultaneously — it uses a SMUX (Spectral MUX) configuration to route 6 channels at a time to its 6 ADCs, requiring two measurement cycles to read all channels.

### Spectral Channel Map

| Channel | Label | Center Wavelength (nm) | FWHM (nm) | Typical Application |
|---|---|---|---|---|
| F1 | Violet | 415 | 26 | Water quality |
| F2 | Indigo/Violet | 445 | 30 | Blue LED characterization |
| F3 | Blue | 480 | 36 | Color rendering index |
| F4 | Cyan | 515 | 39 | Vegetation reflectance |
| F5 | Green | 555 | 39 | Photopic (human eye peak) |
| F6 | Yellow | 590 | 40 | Color matching |
| F7 | Orange | 630 | 50 | Fruit ripeness |
| F8 | Red | 680 | 52 | Chlorophyll absorption |
| Clear | — | Broadband | — | Total intensity reference |
| NIR | Near-IR | 910 | 50 | Material classification |
| Flicker | — | — | — | Light flicker detection |

### SMUX Configuration and Measurement Sequence

The AS7341 requires configuring the SMUX to map spectral channels to the 6 available ADCs. Two standard configurations cover all channels:

- **SMUX Config 1**: F1, F2, F3, F4, Clear, NIR
- **SMUX Config 2**: F5, F6, F7, F8, Clear, NIR

```c
/* AS7341 spectral sensor driver — STM32 HAL */

#include "stm32f4xx_hal.h"

#define AS7341_ADDR          (0x39 << 1)
#define AS7341_ENABLE        0x80
#define AS7341_ATIME         0x81  /* Integration time: (ATIME+1)×2.78µs×(ASTEP+1) */
#define AS7341_WTIME         0x83
#define AS7341_AUXID         0x90
#define AS7341_REVID         0x91
#define AS7341_ID            0x92  /* Should read 0x09 (AS7341) */
#define AS7341_STATUS        0x93
#define AS7341_ASTATUS       0x94
#define AS7341_CH0_DATA_L    0x95  /* Channel 0 (ADC0) data */
#define AS7341_CFG0          0xA9
#define AS7341_CFG1          0xAA  /* AGAIN (gain) */
#define AS7341_CFG6          0xAF
#define AS7341_STATUS2       0xA3
#define AS7341_ASTEP_L       0xCA  /* Integration step size */
#define AS7341_ASTEP_H       0xCB

/* Enable register bits */
#define AS7341_EN_PON        0x01
#define AS7341_EN_SP_EN      0x02  /* Spectral measurement enable */
#define AS7341_EN_SMUXEN     0x10  /* SMUX enable */

typedef struct {
    uint16_t f1_415nm;
    uint16_t f2_445nm;
    uint16_t f3_480nm;
    uint16_t f4_515nm;
    uint16_t f5_555nm;
    uint16_t f6_590nm;
    uint16_t f7_630nm;
    uint16_t f8_680nm;
    uint16_t clear;
    uint16_t nir;
} as7341_spectral_t;

static I2C_HandleTypeDef *hi2c;

static void as7341_write(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    HAL_I2C_Master_Transmit(hi2c, AS7341_ADDR, buf, 2, 100);
}

static uint8_t as7341_read(uint8_t reg)
{
    uint8_t val;
    HAL_I2C_Master_Transmit(hi2c, AS7341_ADDR, &reg, 1, 100);
    HAL_I2C_Master_Receive(hi2c, AS7341_ADDR, &val, 1, 100);
    return val;
}

static uint16_t as7341_read16(uint8_t reg)
{
    uint8_t buf[2];
    uint8_t cmd = reg;
    HAL_I2C_Master_Transmit(hi2c, AS7341_ADDR, &cmd, 1, 100);
    HAL_I2C_Master_Receive(hi2c, AS7341_ADDR, buf, 2, 100);
    return (buf[1] << 8) | buf[0];
}

/**
 * Write a SMUX configuration to route channels to ADCs.
 * The SMUX config is written to a RAM bank starting at 0x00
 * while the CFG6 register has bit 4 set to select SMUX RAM.
 */
static void as7341_set_smux_low_channels(void)
{
    /* Select register bank for SMUX configuration */
    as7341_write(AS7341_CFG0, 0x10);  /* REG_BANK = 1 (SMUX config) */

    /* SMUX configuration for F1-F4 + Clear + NIR */
    /* Each byte maps a photodiode to an ADC channel */
    /* This configuration is from the ams application note */
    as7341_write(0x00, 0x30);  /* F3 left → ADC2 */
    as7341_write(0x01, 0x01);  /* F1 left → ADC0 */
    as7341_write(0x02, 0x00);
    as7341_write(0x03, 0x00);
    as7341_write(0x04, 0x00);
    as7341_write(0x05, 0x42);  /* F4 left → ADC3, NIR → ADC4 */
    as7341_write(0x06, 0x00);
    as7341_write(0x07, 0x00);
    as7341_write(0x08, 0x50);  /* F2 left → ADC1, Clear → ADC5 */
    as7341_write(0x09, 0x00);
    as7341_write(0x0A, 0x00);
    as7341_write(0x0B, 0x00);
    as7341_write(0x0C, 0x20);
    as7341_write(0x0D, 0x04);
    as7341_write(0x0E, 0x00);
    as7341_write(0x0F, 0x30);
    as7341_write(0x10, 0x01);
    as7341_write(0x11, 0x50);
    as7341_write(0x12, 0x00);
    as7341_write(0x13, 0x06);

    /* Return to normal register bank */
    as7341_write(AS7341_CFG0, 0x00);
}

static void as7341_set_smux_high_channels(void)
{
    as7341_write(AS7341_CFG0, 0x10);

    /* SMUX configuration for F5-F8 + Clear + NIR */
    as7341_write(0x00, 0x00);
    as7341_write(0x01, 0x00);
    as7341_write(0x02, 0x00);
    as7341_write(0x03, 0x40);
    as7341_write(0x04, 0x02);
    as7341_write(0x05, 0x00);
    as7341_write(0x06, 0x10);
    as7341_write(0x07, 0x03);
    as7341_write(0x08, 0x50);
    as7341_write(0x09, 0x10);
    as7341_write(0x0A, 0x03);
    as7341_write(0x0B, 0x00);
    as7341_write(0x0C, 0x00);
    as7341_write(0x0D, 0x00);
    as7341_write(0x0E, 0x24);
    as7341_write(0x0F, 0x00);
    as7341_write(0x10, 0x00);
    as7341_write(0x11, 0x50);
    as7341_write(0x12, 0x00);
    as7341_write(0x13, 0x06);

    as7341_write(AS7341_CFG0, 0x00);
}

/**
 * Trigger a SMUX command and wait for completion.
 */
static void as7341_smux_command(void)
{
    /* Enable SMUX command */
    uint8_t enable_val = as7341_read(AS7341_ENABLE);
    as7341_write(AS7341_ENABLE, enable_val | AS7341_EN_SMUXEN);

    /* Wait for SMUX operation to complete (SMUXEN clears automatically) */
    int timeout = 100;
    while (timeout-- > 0) {
        if (!(as7341_read(AS7341_ENABLE) & AS7341_EN_SMUXEN)) break;
        HAL_Delay(1);
    }
}

/**
 * Start a spectral measurement and wait for completion.
 */
static void as7341_start_measure(void)
{
    uint8_t enable_val = as7341_read(AS7341_ENABLE);
    as7341_write(AS7341_ENABLE, enable_val | AS7341_EN_SP_EN);

    /* Wait for data ready (AVALID in STATUS2) */
    int timeout = 1000;
    while (timeout-- > 0) {
        uint8_t status = as7341_read(AS7341_STATUS2);
        if (status & 0x40) break;  /* AVALID bit */
        HAL_Delay(1);
    }

    /* Disable spectral measurement */
    enable_val = as7341_read(AS7341_ENABLE);
    as7341_write(AS7341_ENABLE, enable_val & ~AS7341_EN_SP_EN);
}

void as7341_init(I2C_HandleTypeDef *i2c_handle)
{
    hi2c = i2c_handle;

    /* Power on */
    as7341_write(AS7341_ENABLE, AS7341_EN_PON);
    HAL_Delay(10);

    /* Integration time: ATIME=29, ASTEP=599 → ~50ms total */
    as7341_write(AS7341_ATIME, 29);
    as7341_write(AS7341_ASTEP_L, 599 & 0xFF);
    as7341_write(AS7341_ASTEP_H, (599 >> 8) & 0xFF);

    /* Gain: 8× (index 5 in gain table) */
    as7341_write(AS7341_CFG1, 0x05);
}

/**
 * Read all spectral channels. Requires two SMUX configurations.
 */
as7341_spectral_t as7341_read_all_channels(void)
{
    as7341_spectral_t data = {0};

    /* Phase 1: F1–F4 + Clear + NIR */
    as7341_set_smux_low_channels();
    as7341_smux_command();
    as7341_start_measure();

    data.f1_415nm = as7341_read16(AS7341_CH0_DATA_L);      /* ADC0 */
    data.f2_445nm = as7341_read16(AS7341_CH0_DATA_L + 2);  /* ADC1 */
    data.f3_480nm = as7341_read16(AS7341_CH0_DATA_L + 4);  /* ADC2 */
    data.f4_515nm = as7341_read16(AS7341_CH0_DATA_L + 6);  /* ADC3 */
    /* ADC4 = NIR (phase 1), ADC5 = Clear (phase 1) — can average with phase 2 */

    /* Phase 2: F5–F8 + Clear + NIR */
    as7341_set_smux_high_channels();
    as7341_smux_command();
    as7341_start_measure();

    data.f5_555nm = as7341_read16(AS7341_CH0_DATA_L);
    data.f6_590nm = as7341_read16(AS7341_CH0_DATA_L + 2);
    data.f7_630nm = as7341_read16(AS7341_CH0_DATA_L + 4);
    data.f8_680nm = as7341_read16(AS7341_CH0_DATA_L + 6);
    data.nir      = as7341_read16(AS7341_CH0_DATA_L + 8);
    data.clear    = as7341_read16(AS7341_CH0_DATA_L + 10);

    return data;
}
```

## Applications

### Plant Health Monitoring (NDVI)

The Normalized Difference Vegetation Index (NDVI) uses the ratio of red and near-IR reflectance to assess plant vigor. Healthy vegetation strongly absorbs red light (680nm, chlorophyll absorption) and reflects near-IR (910nm). The AS7341's F8 (680nm) and NIR (910nm) channels map directly to this measurement:

```c
float calculate_ndvi(as7341_spectral_t *s)
{
    float nir = (float)s->nir;
    float red = (float)s->f8_680nm;

    if (nir + red == 0) return 0.0f;
    return (nir - red) / (nir + red);
    /* NDVI: -1 to +1. Healthy vegetation: 0.6–0.9 */
}
```

### Light Source Classification

Different light sources have distinct spectral signatures. By comparing the relative intensities across the AS7341's channels, firmware can distinguish fluorescent, LED, incandescent, and natural daylight:

- **Incandescent**: Strong red/NIR, weak blue — monotonically increasing from F1 to NIR
- **Cool white LED**: Spike at F2 (445nm, blue LED pump), broad phosphor peak at F5-F7
- **Fluorescent (CFL)**: Sharp peaks at specific wavelengths (mercury emission lines at 436nm, 546nm, 578nm)
- **Daylight**: Relatively flat spectrum with UV content

## Integration Time and Noise Tradeoff

The total integration time for the AS7341 is calculated as:

```
T_int = (ATIME + 1) × (ASTEP + 1) × 2.78 µs
```

Longer integration accumulates more photons, improving signal-to-noise ratio by roughly √N (where N is the number of integration steps). However, longer integration also increases the risk of ADC saturation under bright light. A typical auto-ranging strategy:

1. Start at medium integration (50ms, gain 8×)
2. If any channel exceeds 90% of the 16-bit range (>58,000), reduce gain or integration time
3. If the maximum channel is below 10% of range (<6,500), increase gain or integration time
4. Re-measure after each adjustment

## Tips

- Use the clear channel as a saturation indicator — if the clear channel is near 65535, all color channels are likely clipped and the readings are unreliable; reduce gain or integration time before trusting the RGB values
- For accurate color temperature measurements, illuminate the target with a known white LED and measure the reflected light — ambient mixed-source lighting produces CCT values that do not correspond to any single source
- The AS7341 SMUX configuration is fragile — writing incorrect values can route the wrong photodiode to an ADC, producing silent data errors; verify each configuration against the datasheet SMUX tables
- Normalize spectral readings by dividing each channel by the clear channel to remove the effect of overall brightness and isolate spectral shape — this makes material identification more robust across varying illumination levels
- Perform dark offset calibration by reading all channels with the sensor fully covered — subtract these offsets from every subsequent measurement to remove ADC baseline and leakage current contributions

## Caveats

- **TCS34725 color accuracy depends heavily on the light source spectrum** — The RGB filters do not match CIE color matching functions exactly; under narrow-band LED illumination, the reported RGB ratios can differ significantly from what a calibrated colorimeter measures
- **AS7341 requires two measurement cycles for all channels** — The SMUX reconfiguration between cycles introduces a gap of several milliseconds; if the light source is rapidly changing (e.g., pulsed LED), the two halves of the spectrum may be measured under different conditions
- **Gain settings above 16× on the TCS34725 introduce measurable nonlinearity** — At 60× gain, channel crosstalk increases and the blue channel can show elevated readings even with no blue content in the source
- **Optical path contamination affects color measurements more than intensity measurements** — A thin layer of dust, condensation, or fingerprint oil on the sensor window shifts the spectral transmission, biasing color readings while leaving overall brightness readings approximately correct
- **The IR-blocking filter on the TCS34725 is not perfect** — It attenuates near-IR by roughly 90%, but the remaining 10% contribution can shift red channel readings upward under incandescent or sunlight illumination; for precision colorimetry, external IR-cut filters are preferred

## In Practice

- A TCS34725 reporting a color temperature of 2700K under office fluorescent lighting (which is actually 4000K) is typically suffering from IR contamination — the residual IR leakage through the onboard filter inflates the red channel, pulling the CCT calculation toward warmer values
- When AS7341 spectral readings show a suspicious spike in only one channel that does not correlate with the known source spectrum, the SMUX configuration is likely incorrect for that measurement phase — re-verifying the SMUX byte sequence against the datasheet reference configuration usually reveals a mapping error
- A color-sorting application that works reliably under controlled LED illumination but produces inconsistent classifications under daylight is being affected by the spectral variation of natural light — adding a dedicated illumination LED and measuring only reflected light (rejecting ambient contribution via pulsed measurement) stabilizes the results
- Plant health monitoring with NDVI that shows all readings clustered near 0.2–0.3 (suggesting stressed vegetation) when the plants are visually healthy often indicates that the sensor's field of view includes soil or pot material — narrowing the optical aperture or using a collimating tube to restrict the view to leaf surfaces brings NDVI into the expected 0.6–0.9 range
