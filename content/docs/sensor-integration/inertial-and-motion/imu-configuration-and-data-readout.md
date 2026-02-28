---
title: "IMU Configuration & Data Readout"
weight: 40
---

# IMU Configuration & Data Readout

An Inertial Measurement Unit (IMU) combines multiple inertial sensors — typically a 3-axis accelerometer and a 3-axis gyroscope — into a single package with shared registers, clocking, and data output. The firmware benefits are significant: a single bus transaction can read all 6 axes, the sensors share a common sample clock (eliminating synchronization issues), and the package count drops from 2–3 to 1. The trade-off is more complex register maps, multi-sensor FIFO management, and vendor-specific initialization sequences that must be followed precisely.

## Common IMU Devices

Three IMUs dominate embedded projects today:

- **MPU-6050** (TDK InvenSense) — The most widely documented 6-axis IMU, found on nearly every hobbyist breakout board. I2C-only (up to 400 kHz), ±16g / ±2000 dps, 1 kHz max sample rate. Discontinued but still abundantly available and extremely well-documented.
- **ICM-42688-P** (TDK InvenSense) — High-performance successor with SPI support up to 24 MHz, ±16g / ±2000 dps, up to 32 kHz ODR for the gyroscope, and significantly lower noise. The go-to part for drone flight controllers and precision motion tracking.
- **BMI270** (Bosch) — Optimized for wearable and low-power applications with hardware step counter, gesture recognition, and a complex multi-phase initialization sequence requiring a binary configuration blob.

## Register Map Navigation

IMU register maps are large — the ICM-42688-P has over 200 registers organized into four banks. Navigating them efficiently requires understanding the standard structure:

| Register Group | Typical Address Range | Purpose |
|----------------|----------------------|---------|
| Device ID / WHO_AM_I | 0x75 (MPU-6050), 0x75 (ICM-42688) | Chip identification |
| Power management | 0x6B–0x6C (MPU-6050) | Wake/sleep, clock source |
| Configuration | 0x1A–0x1D (MPU-6050) | DLPF, sample rate divider |
| Accel/gyro config | 0x1B–0x1C (MPU-6050) | Full-scale range selection |
| Interrupt config | 0x37–0x38 (MPU-6050) | INT pin behavior, enable |
| FIFO config | 0x23, 0x6A (MPU-6050) | FIFO enable, which sensors |
| Data output | 0x3B–0x48 (MPU-6050) | Accel XYZ, Temp, Gyro XYZ |
| FIFO count/data | 0x72–0x74 (MPU-6050) | FIFO sample count and read port |

For bank-switched devices like the ICM-42688-P, the BANK_SEL register must be written before accessing registers in a different bank. A common mistake is forgetting to switch back to bank 0 after configuring a register in bank 1, causing subsequent reads from the data registers to fail.

## MPU-6050 Full Initialization Sequence

The MPU-6050 powers up in sleep mode and requires a specific wake-up sequence:

```c
#include "stm32f4xx_hal.h"

#define MPU6050_ADDR         (0x68 << 1)  /* AD0 = low */

/* Key registers */
#define MPU6050_WHO_AM_I     0x75
#define MPU6050_PWR_MGMT_1   0x6B
#define MPU6050_PWR_MGMT_2   0x6C
#define MPU6050_SMPLRT_DIV   0x19
#define MPU6050_CONFIG       0x1A
#define MPU6050_GYRO_CONFIG  0x1B
#define MPU6050_ACCEL_CONFIG 0x1C
#define MPU6050_INT_PIN_CFG  0x37
#define MPU6050_INT_ENABLE   0x38
#define MPU6050_FIFO_EN      0x23
#define MPU6050_USER_CTRL    0x6A
#define MPU6050_FIFO_COUNT_H 0x72
#define MPU6050_FIFO_R_W     0x74
#define MPU6050_ACCEL_XOUT_H 0x3B

extern I2C_HandleTypeDef hi2c1;

static HAL_StatusTypeDef mpu6050_write_reg(uint8_t reg, uint8_t val)
{
    return HAL_I2C_Mem_Write(&hi2c1, MPU6050_ADDR, reg,
                             I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);
}

static uint8_t mpu6050_read_reg(uint8_t reg)
{
    uint8_t val;
    HAL_I2C_Mem_Read(&hi2c1, MPU6050_ADDR, reg,
                     I2C_MEMADD_SIZE_8BIT, &val, 1, HAL_MAX_DELAY);
    return val;
}

int mpu6050_init(void)
{
    /* Step 1: Verify device identity */
    uint8_t id = mpu6050_read_reg(MPU6050_WHO_AM_I);
    if (id != 0x68) {
        return -1;  /* Wrong device or wiring error */
    }

    /* Step 2: Wake up — clear SLEEP bit, select PLL with X-axis gyro ref */
    mpu6050_write_reg(MPU6050_PWR_MGMT_1, 0x01);
    HAL_Delay(50);  /* Wait for PLL to stabilize */

    /* Step 3: Enable all accel and gyro axes */
    mpu6050_write_reg(MPU6050_PWR_MGMT_2, 0x00);

    /* Step 4: Set sample rate = 1 kHz / (1 + divider) = 200 Hz */
    mpu6050_write_reg(MPU6050_SMPLRT_DIV, 4);

    /* Step 5: DLPF config — bandwidth 44 Hz (accel), 42 Hz (gyro) */
    mpu6050_write_reg(MPU6050_CONFIG, 0x03);

    /* Step 6: Gyro full-scale ±500 dps */
    mpu6050_write_reg(MPU6050_GYRO_CONFIG, 0x08);

    /* Step 7: Accel full-scale ±4g */
    mpu6050_write_reg(MPU6050_ACCEL_CONFIG, 0x08);

    /* Step 8: INT pin config — active high, push-pull, pulse, clear on read */
    mpu6050_write_reg(MPU6050_INT_PIN_CFG, 0x30);

    /* Step 9: Enable data-ready interrupt */
    mpu6050_write_reg(MPU6050_INT_ENABLE, 0x01);

    return 0;
}

/**
 * Read all 6 axes (accel + gyro) plus temperature in a single burst.
 * Registers 0x3B–0x48: AXH AXL AYH AYL AZH AZL TH TL GXH GXL GYH GYL GZH GZL
 */
void mpu6050_read_all(int16_t *ax, int16_t *ay, int16_t *az,
                      int16_t *gx, int16_t *gy, int16_t *gz,
                      int16_t *temp_raw)
{
    uint8_t buf[14];
    HAL_I2C_Mem_Read(&hi2c1, MPU6050_ADDR, MPU6050_ACCEL_XOUT_H,
                     I2C_MEMADD_SIZE_8BIT, buf, 14, HAL_MAX_DELAY);

    /* MPU-6050 data is big-endian (MSB first) */
    *ax = (int16_t)((buf[0]  << 8) | buf[1]);
    *ay = (int16_t)((buf[2]  << 8) | buf[3]);
    *az = (int16_t)((buf[4]  << 8) | buf[5]);
    *temp_raw = (int16_t)((buf[6]  << 8) | buf[7]);
    *gx = (int16_t)((buf[8]  << 8) | buf[9]);
    *gy = (int16_t)((buf[10] << 8) | buf[11]);
    *gz = (int16_t)((buf[12] << 8) | buf[13]);
}
```

The clock source selection in PWR_MGMT_1 is critical: value 0x01 selects the PLL referenced to the X-axis gyroscope oscillator, which is significantly more accurate and stable than the default 8 MHz internal oscillator. Leaving the clock at 0x00 (internal RC) results in noticeable sample rate jitter.

## FIFO Buffer Configuration

The FIFO buffer decouples sensor sampling from firmware read timing. The MPU-6050 has a 1024-byte FIFO that can store accel, gyro, and temperature data. At 12 bytes per sample (6 axes × 2 bytes, no temp), the FIFO holds 85 samples — 425 ms at 200 Hz.

```c
void mpu6050_fifo_init(void)
{
    /* Reset FIFO */
    mpu6050_write_reg(MPU6050_USER_CTRL, 0x44);  /* FIFO_EN + FIFO_RESET */
    HAL_Delay(10);

    /* Select which sensors write to FIFO: accel + gyro (no temp) */
    mpu6050_write_reg(MPU6050_FIFO_EN, 0x78);  /* ACCEL + GYRO_XYZ */

    /* Enable FIFO and set FIFO overflow interrupt */
    mpu6050_write_reg(MPU6050_USER_CTRL, 0x40);     /* FIFO_EN */
    mpu6050_write_reg(MPU6050_INT_ENABLE, 0x11);     /* DATA_RDY + FIFO_OFLOW */
}

/**
 * Read all available FIFO samples.
 * Returns number of complete samples read.
 */
uint16_t mpu6050_fifo_read(int16_t (*accel)[3], int16_t (*gyro)[3],
                           uint16_t max_samples)
{
    /* Read FIFO count */
    uint8_t count_buf[2];
    HAL_I2C_Mem_Read(&hi2c1, MPU6050_ADDR, MPU6050_FIFO_COUNT_H,
                     I2C_MEMADD_SIZE_8BIT, count_buf, 2, HAL_MAX_DELAY);
    uint16_t fifo_count = (count_buf[0] << 8) | count_buf[1];

    uint16_t sample_size = 12;  /* 6 axes × 2 bytes */
    uint16_t n_samples = fifo_count / sample_size;
    if (n_samples > max_samples) n_samples = max_samples;

    for (uint16_t i = 0; i < n_samples; i++) {
        uint8_t buf[12];
        HAL_I2C_Mem_Read(&hi2c1, MPU6050_ADDR, MPU6050_FIFO_R_W,
                         I2C_MEMADD_SIZE_8BIT, buf, sample_size, HAL_MAX_DELAY);

        /* FIFO data order matches register order: AX AY AZ GX GY GZ (big-endian) */
        accel[i][0] = (int16_t)((buf[0]  << 8) | buf[1]);
        accel[i][1] = (int16_t)((buf[2]  << 8) | buf[3]);
        accel[i][2] = (int16_t)((buf[4]  << 8) | buf[5]);
        gyro[i][0]  = (int16_t)((buf[6]  << 8) | buf[7]);
        gyro[i][1]  = (int16_t)((buf[8]  << 8) | buf[9]);
        gyro[i][2]  = (int16_t)((buf[10] << 8) | buf[11]);
    }

    return n_samples;
}
```

The FIFO overflow condition is important: when the FIFO fills completely, subsequent samples are dropped. If the overflow interrupt fires, the firmware must reset the FIFO (set FIFO_RESET in USER_CTRL) and accept the gap in data. An alternative is to use the FIFO watermark interrupt (available on newer IMUs like the ICM-42688-P) to trigger a read before the FIFO fills.

## ICM-42688-P — SPI FIFO Burst Read

The ICM-42688-P supports SPI clock rates up to 24 MHz and provides a 2048-byte FIFO with watermark interrupt. SPI burst reads are the highest-throughput readout method.

```c
#include "stm32f4xx_hal.h"

#define ICM42688_CS_PIN      GPIO_PIN_4
#define ICM42688_CS_PORT     GPIOA
#define ICM42688_SPI         hspi1

/* Bank 0 registers */
#define ICM42688_WHO_AM_I    0x75
#define ICM42688_PWR_MGMT0   0x4E
#define ICM42688_GYRO_CONFIG0  0x4F
#define ICM42688_ACCEL_CONFIG0 0x50
#define ICM42688_FIFO_CONFIG   0x16
#define ICM42688_FIFO_CONFIG1  0x5F
#define ICM42688_FIFO_CONFIG2  0x60  /* Watermark low byte */
#define ICM42688_FIFO_CONFIG3  0x61  /* Watermark high byte */
#define ICM42688_INT_CONFIG    0x14
#define ICM42688_INT_SOURCE0   0x65
#define ICM42688_FIFO_COUNTH   0x2E
#define ICM42688_FIFO_DATA     0x30
#define ICM42688_INTF_CONFIG0  0x4C
#define ICM42688_BANK_SEL      0x76

#define ICM42688_READ        0x80

extern SPI_HandleTypeDef hspi1;

static void icm42688_cs_low(void)  { HAL_GPIO_WritePin(ICM42688_CS_PORT, ICM42688_CS_PIN, GPIO_PIN_RESET); }
static void icm42688_cs_high(void) { HAL_GPIO_WritePin(ICM42688_CS_PORT, ICM42688_CS_PIN, GPIO_PIN_SET); }

static void icm42688_write_reg(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg & 0x7F, val };
    icm42688_cs_low();
    HAL_SPI_Transmit(&ICM42688_SPI, buf, 2, HAL_MAX_DELAY);
    icm42688_cs_high();
}

static uint8_t icm42688_read_reg(uint8_t reg)
{
    uint8_t tx[2] = { reg | ICM42688_READ, 0x00 };
    uint8_t rx[2];
    icm42688_cs_low();
    HAL_SPI_TransmitReceive(&ICM42688_SPI, tx, rx, 2, HAL_MAX_DELAY);
    icm42688_cs_high();
    return rx[1];
}

int icm42688_init(void)
{
    /* Verify device ID (expected: 0x47) */
    uint8_t id = icm42688_read_reg(ICM42688_WHO_AM_I);
    if (id != 0x47) return -1;

    /* Ensure bank 0 */
    icm42688_write_reg(ICM42688_BANK_SEL, 0x00);

    /* Gyro config: ±500 dps, 1 kHz ODR */
    icm42688_write_reg(ICM42688_GYRO_CONFIG0, 0x27);

    /* Accel config: ±4g, 1 kHz ODR */
    icm42688_write_reg(ICM42688_ACCEL_CONFIG0, 0x27);

    /* FIFO config: stream-to-FIFO mode */
    icm42688_write_reg(ICM42688_FIFO_CONFIG, 0x40);

    /* FIFO config1: enable accel + gyro + temperature in FIFO packets */
    icm42688_write_reg(ICM42688_FIFO_CONFIG1, 0x07);

    /* Set FIFO watermark to 480 bytes (30 packets × 16 bytes) */
    icm42688_write_reg(ICM42688_FIFO_CONFIG2, 0xE0);  /* Low byte: 480 & 0xFF = 0xE0 */
    icm42688_write_reg(ICM42688_FIFO_CONFIG3, 0x01);  /* High byte: 480 >> 8 = 0x01 */

    /* INT1 config: active low, push-pull, pulsed */
    icm42688_write_reg(ICM42688_INT_CONFIG, 0x18);

    /* INT_SOURCE0: FIFO watermark interrupt on INT1 */
    icm42688_write_reg(ICM42688_INT_SOURCE0, 0x04);

    /* Power on accel + gyro in low-noise mode */
    icm42688_write_reg(ICM42688_PWR_MGMT0, 0x0F);
    HAL_Delay(50);  /* Wait for sensors to stabilize */

    return 0;
}

/**
 * ICM-42688-P FIFO packet structure (16 bytes, header byte = 0x68):
 *   [0]    Header
 *   [1:2]  Accel X (big-endian)
 *   [3:4]  Accel Y
 *   [5:6]  Accel Z
 *   [7:8]  Gyro X
 *   [9:10] Gyro Y
 *   [11:12] Gyro Z
 *   [13]   Temperature (8-bit)
 *   [14:15] Timestamp (optional, depends on config)
 */
#define ICM42688_FIFO_PACKET_SIZE  16

uint16_t icm42688_fifo_read(int16_t (*accel)[3], int16_t (*gyro)[3],
                            uint16_t max_samples)
{
    /* Read FIFO count (bytes) */
    uint8_t count_h = icm42688_read_reg(ICM42688_FIFO_COUNTH);
    uint8_t count_l = icm42688_read_reg(ICM42688_FIFO_COUNTH + 1);
    uint16_t fifo_bytes = (count_h << 8) | count_l;

    uint16_t n_packets = fifo_bytes / ICM42688_FIFO_PACKET_SIZE;
    if (n_packets > max_samples) n_packets = max_samples;
    if (n_packets == 0) return 0;

    /* SPI burst read: send register address, then clock out all data */
    uint16_t read_len = n_packets * ICM42688_FIFO_PACKET_SIZE;
    uint8_t tx_addr = ICM42688_FIFO_DATA | ICM42688_READ;
    uint8_t rx_buf[2048];  /* Max FIFO size */

    icm42688_cs_low();
    HAL_SPI_Transmit(&ICM42688_SPI, &tx_addr, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(&ICM42688_SPI, rx_buf, read_len, HAL_MAX_DELAY);
    icm42688_cs_high();

    /* Parse packets */
    for (uint16_t i = 0; i < n_packets; i++) {
        uint8_t *p = &rx_buf[i * ICM42688_FIFO_PACKET_SIZE];

        /* Verify header byte */
        if ((p[0] & 0xFC) != 0x68) {
            /* Invalid header — FIFO may be misaligned, reset required */
            return i;
        }

        accel[i][0] = (int16_t)((p[1] << 8) | p[2]);
        accel[i][1] = (int16_t)((p[3] << 8) | p[4]);
        accel[i][2] = (int16_t)((p[5] << 8) | p[6]);
        gyro[i][0]  = (int16_t)((p[7] << 8) | p[8]);
        gyro[i][1]  = (int16_t)((p[9] << 8) | p[10]);
        gyro[i][2]  = (int16_t)((p[11] << 8) | p[12]);
    }

    return n_packets;
}
```

The burst read is critical for high ODR applications: reading 30 packets of 16 bytes (480 bytes) in a single SPI transaction at 10 MHz takes ~384 µs, whereas reading them one register at a time would require 30 separate CS assertions and take 5–10× longer.

## Data Alignment and Endianness

Different IMU families use different byte ordering:

| Device | Endianness | Data Justification | Notes |
|--------|------------|-------------------|-------|
| MPU-6050 | Big-endian (MSB first) | Right-justified, 16-bit | Straightforward: `(buf[0] << 8) \| buf[1]` |
| ICM-42688-P | Big-endian (MSB first) | Right-justified, 16-bit | Same as MPU-6050 |
| BMI270 | Little-endian (LSB first) | Right-justified, 16-bit | Reversed: `(buf[1] << 8) \| buf[0]` |
| LSM6DSO | Little-endian (LSB first) | Right-justified, 16-bit | Same as BMI270 |
| LIS2DH12 | Little-endian (LSB first) | Left-justified, 16-bit | Requires right-shift: `raw >> 4` for 12-bit |

Getting the endianness wrong produces values that are correct in magnitude but appear as noise — the symptom is output values that change wildly between adjacent samples because the MSB and LSB are swapped.

## Sample Synchronization Between Accel and Gyro

In a multi-sensor IMU, the accelerometer and gyroscope may sample at different internal rates or with different group delays due to their independent digital filter chains. Proper synchronization is handled differently by each device:

- **MPU-6050** — Both sensors share the same sample rate divider when DLPF is enabled, guaranteeing synchronous output. Reading all 14 bytes in a single I2C burst captures a consistent snapshot.
- **ICM-42688-P** — Accel and gyro can run at independent ODRs. When FIFO is configured with both sensors, the FIFO packet contains synchronized samples. Using direct register reads without FIFO risks reading accel from one instant and gyro from the next.
- **BMI270** — Provides a data synchronization feature that aligns the accelerometer data to the gyroscope timestamp by interpolating the lower-ODR sensor to match the higher-ODR sensor.

For sensor fusion algorithms (complementary filter, Kalman filter), accel-gyro synchronization within ±0.5 ms is typically sufficient. FIFO-based readout inherently provides this.

## IMU Comparison

| Parameter | MPU-6050 | ICM-42688-P | BMI270 | LSM6DSO |
|-----------|----------|-------------|--------|---------|
| Manufacturer | TDK InvenSense | TDK InvenSense | Bosch | STMicroelectronics |
| Sensors | Accel + Gyro | Accel + Gyro | Accel + Gyro | Accel + Gyro |
| Interface | I2C (400 kHz) | SPI (24 MHz) / I2C | SPI (10 MHz) / I2C | SPI (10 MHz) / I2C |
| Accel FSR | ±2/4/8/16g | ±2/4/8/16g | ±2/4/8/16g | ±2/4/8/16g |
| Gyro FSR | ±250/500/1000/2000 dps | ±15.6 to ±2000 dps | ±125 to ±2000 dps | ±125 to ±2000 dps |
| Accel noise | 400 µg/√Hz | 70 µg/√Hz | 160 µg/√Hz | 70 µg/√Hz |
| Gyro noise | 0.005 dps/√Hz | 0.0028 dps/√Hz | 0.007 dps/√Hz | 0.004 dps/√Hz |
| Max ODR (gyro) | 8 kHz | 32 kHz | 6.4 kHz | 6.66 kHz |
| FIFO size | 1024 bytes | 2048 bytes | 6144 bytes | 9 KB |
| Current (6-axis) | 3.9 mA | 0.97 mA | 0.68 mA | 0.55 mA |
| Package | 4×4 mm QFN | 2.5×3 mm LGA | 2.5×3 mm LGA | 2.5×3 mm LGA |
| Status | Discontinued | Active | Active | Active |
| Typical cost | $1.50 | $3.50 | $3.00 | $3.00 |

The MPU-6050 remains useful for learning and prototyping, but its high noise, I2C-only interface, and discontinued status make it a poor choice for new production designs. The ICM-42688-P offers the best raw performance, the BMI270 offers the lowest power with built-in motion features, and the LSM6DSO provides an excellent balance with the largest FIFO and ST's extensive software ecosystem.

## BMI270 Initialization Note

The BMI270 requires uploading a binary configuration file (~8 KB) during initialization — without this blob, the sensor outputs are invalid. The configuration data is provided by Bosch in a C array and must be written to the INIT_DATA register in bursts after issuing a prepare command. This is unlike any other common IMU and catches firmware engineers off guard:

```c
/* Pseudo-code for BMI270 initialization (simplified) */
#include "bmi270_config.h"  /* Bosch-provided binary blob as C array */

void bmi270_init(void)
{
    /* Soft reset */
    bmi270_write_reg(BMI2_CMD_REG, 0xB6);
    HAL_Delay(2);

    /* Disable advanced power save to allow configuration upload */
    bmi270_write_reg(BMI2_PWR_CONF, 0x00);
    HAL_Delay(1);

    /* Prepare for config load */
    bmi270_write_reg(BMI2_INIT_CTRL, 0x00);

    /* Write configuration blob in 256-byte bursts to INIT_DATA register */
    for (uint16_t offset = 0; offset < sizeof(bmi270_config_file); offset += 256) {
        uint16_t chunk = sizeof(bmi270_config_file) - offset;
        if (chunk > 256) chunk = 256;

        /* Set burst write offset */
        bmi270_write_reg(BMI2_INIT_ADDR_0, (offset / 2) & 0x0F);
        bmi270_write_reg(BMI2_INIT_ADDR_1, (offset / 2) >> 4);

        /* Write data chunk */
        bmi270_write_burst(BMI2_INIT_DATA, &bmi270_config_file[offset], chunk);
    }

    /* Complete initialization */
    bmi270_write_reg(BMI2_INIT_CTRL, 0x01);
    HAL_Delay(20);

    /* Verify init status */
    uint8_t status = bmi270_read_reg(BMI2_INTERNAL_STATUS);
    /* Bit 0 should be 1 (init OK) */
}
```

Skipping this step results in all-zero sensor output with no error indication in the status registers — a particularly frustrating failure mode to debug without prior knowledge of this requirement.

## Tips

- Always read the WHO_AM_I register first and verify the expected value before attempting any configuration — this catches wiring errors, wrong I2C addresses, and SPI mode mismatches before they cause cryptic failures.
- Use FIFO-based readout for any ODR above 100 Hz — direct register polling at high rates wastes CPU time and risks missing samples during other interrupt processing.
- Set the FIFO watermark interrupt to trigger at 50–75% capacity, leaving margin for firmware latency before overflow occurs.
- When using SPI, perform a dummy read after initialization to flush the SPI shift register — some IMUs latch the first SPI byte incorrectly after power-up.
- On the MPU-6050, always select PLL clock source (CLKSEL = 0x01) instead of the internal 8 MHz oscillator — the internal oscillator has ±5% frequency error that causes sample rate drift.
- For the BMI270, include the Bosch configuration blob as a const array in flash and verify the init status register after upload — a partial upload produces subtle data corruption that is difficult to distinguish from sensor noise.

## Caveats

- **MPU-6050 is I2C-only and limited to 400 kHz** — Reading 14 bytes at 400 kHz takes ~0.35 ms per transaction. At 1 kHz ODR, this consumes 35% of the available time budget just for bus transactions, leaving little margin for processing.
- **FIFO overflow silently drops data** — Most IMUs do not generate an error when the FIFO overflows; they either drop new samples or overwrite old ones depending on the configuration. The only indication is a gap in the integrated angle or a jump in the FIFO count.
- **Bank switching on ICM-42688-P is stateful** — Forgetting to switch back to bank 0 after configuring registers in bank 1 or 2 causes all subsequent register reads to return wrong values. A defensive pattern is to always set bank 0 at the start of every read function.
- **BMI270 requires a vendor binary blob** — The ~8 KB configuration file must be programmed into the device at every power-up. Without it, the sensor powers on but produces all-zero output with no fault indication.
- **Temperature interleaving in the MPU-6050 data block** — The temperature registers (0x41–0x42) sit between the accelerometer and gyroscope output registers, so a 14-byte burst read includes 2 bytes of temperature data in the middle. Skipping these bytes during parsing is a common source of axis-swap bugs.

## In Practice

- An MPU-6050 that returns WHO_AM_I = 0x98 instead of 0x68 is likely an MPU-9250 or ICM-20948 — the register map is similar but not identical, and the magnetometer access requires additional I2C pass-through configuration.
- A FIFO that periodically returns one extra or one fewer byte than expected indicates a miscount in the FIFO packet size — double-check whether temperature or timestamp fields are enabled in the FIFO configuration, as each adds 1–2 bytes per packet.
- An ICM-42688-P that works at 1 kHz ODR but produces garbage at 8 kHz likely has an SPI clock that is too slow — at 16 bytes per packet at 8 kHz, the burst read must complete 128 KB/s of transfers without stalling. SPI clock rates below 4 MHz are insufficient.
- A BMI270 that passes WHO_AM_I verification but outputs all zeros has almost certainly not received the configuration blob upload — this is the single most common BMI270 integration failure.
- An IMU application that shows occasional spikes of ±32768 in one axis is reading data across a sample boundary (BDU not enabled or not supported), catching the MSB from one sample and the LSB from the next. Enabling FIFO readout eliminates this because the FIFO stores complete, atomic samples.
