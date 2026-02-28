---
title: "In-Circuit Current Monitoring"
weight: 40
---

# In-Circuit Current Monitoring

External power analyzers provide detailed captures during development, but many applications need continuous current and power measurement in the deployed product — battery fuel gauging, over-current protection, load profiling, and energy budgeting across subsystems. The INA219 and INA226 from Texas Instruments are the standard I2C-based current and power monitors for this purpose. Each integrates a programmable-gain ADC, a multiplexer for shunt and bus voltage, and on-chip calibration and power calculation registers, providing milliwatt-resolution power data through a two-wire bus with no external amplifier.

## INA219 Overview

The INA219 is a bidirectional, high-side current and power monitor with an I2C interface. It measures the voltage across an external shunt resistor and the bus voltage (load side of the shunt), then computes power on-chip.

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Bus voltage range | 0 to 26V |
| Shunt voltage range | ±40mV, ±80mV, ±160mV, ±320mV (PGA selectable) |
| ADC resolution | 12-bit |
| Shunt voltage LSB | 10µV |
| Bus voltage LSB | 4mV |
| Supply voltage | 3.0V to 5.5V |
| Quiescent current | 1mA max |
| I2C address | 16 addresses via A0, A1 pins |
| Package | SOT-23-8, SOIC-8 |

The INA219's programmable gain amplifier (PGA) selects the full-scale shunt voltage range. Lower PGA settings provide better resolution for small currents but clip at lower shunt voltages:

| PGA Setting | Full-Scale Shunt Voltage | Resolution (LSB) |
|-------------|--------------------------|-------------------|
| /1 (gain 1) | ±40mV | 10µV |
| /2 (gain 2) | ±80mV | 20µV |
| /4 (gain 4) | ±160mV | 40µV |
| /8 (gain 8) | ±320mV | 80µV |

## INA226 Overview

The INA226 is the higher-performance successor, with a 16-bit ADC, wider bus voltage range, and an alert output pin for hardware-triggered over-current or under-voltage events.

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Bus voltage range | 0 to 36V |
| Shunt voltage range | ±81.92mV (fixed) |
| ADC resolution | 16-bit |
| Shunt voltage LSB | 2.5µV |
| Bus voltage LSB | 1.25mV |
| Supply voltage | 2.7V to 5.5V |
| Quiescent current | 330µA typical |
| I2C address | 16 addresses via A0, A1 pins |
| Alert output | Open-drain, programmable threshold |
| Package | MSOP-10 |

The INA226's fixed ±81.92mV shunt voltage range with 2.5µV resolution provides better precision than the INA219 for low-current measurements. The 16-bit ADC delivers 32,768 counts across the full-scale range, compared to the INA219's 4,096 counts.

## Register Map

Both the INA219 and INA226 share a similar register structure, though the bit fields differ.

### INA219 Registers

| Address | Register | Description |
|---------|----------|-------------|
| 0x00 | Configuration | Operating mode, PGA gain, ADC resolution, bus/shunt voltage range |
| 0x01 | Shunt Voltage | Measured shunt voltage (read-only) |
| 0x02 | Bus Voltage | Measured bus voltage (read-only) |
| 0x03 | Power | Calculated power (read-only) |
| 0x04 | Current | Calculated current (read-only) |
| 0x05 | Calibration | Calibration value (read-write) |

**Configuration Register (0x00) — INA219:**

```
Bit 15:    RST     — Write 1 to reset all registers to defaults
Bit 14:   (reserved)
Bit 13:   BRNG    — Bus voltage range: 0 = 16V, 1 = 32V
Bit 12-11: PGA     — Shunt voltage PGA gain: 00=/1(±40mV), 01=/2, 10=/4, 11=/8(±320mV)
Bit 10-7:  BADC    — Bus ADC resolution/averaging
Bit 6-3:   SADC    — Shunt ADC resolution/averaging
Bit 2-0:   MODE    — Operating mode
```

**ADC resolution and averaging (BADC/SADC fields):**

| Value | Resolution / Averaging | Conversion Time |
|-------|------------------------|-----------------|
| 0000 | 9-bit | 84µs |
| 0001 | 10-bit | 148µs |
| 0010 | 11-bit | 276µs |
| 0011 | 12-bit (default) | 532µs |
| 1001 | 12-bit, 2 samples averaged | 1.06ms |
| 1010 | 12-bit, 4 samples averaged | 2.13ms |
| 1011 | 12-bit, 8 samples averaged | 4.26ms |
| 1100 | 12-bit, 16 samples averaged | 8.51ms |
| 1101 | 12-bit, 32 samples averaged | 17.02ms |
| 1110 | 12-bit, 64 samples averaged | 34.05ms |
| 1111 | 12-bit, 128 samples averaged | 68.10ms |

**Operating modes (MODE field):**

| Value | Mode |
|-------|------|
| 000 | Power-down |
| 001 | Shunt voltage, triggered |
| 010 | Bus voltage, triggered |
| 011 | Shunt + bus voltage, triggered |
| 100 | ADC off (disabled) |
| 101 | Shunt voltage, continuous |
| 110 | Bus voltage, continuous |
| 111 | Shunt + bus voltage, continuous (default) |

### INA226 Registers

| Address | Register | Description |
|---------|----------|-------------|
| 0x00 | Configuration | Operating mode, conversion time, averaging |
| 0x01 | Shunt Voltage | Measured shunt voltage (read-only) |
| 0x02 | Bus Voltage | Measured bus voltage (read-only) |
| 0x03 | Power | Calculated power (read-only) |
| 0x04 | Current | Calculated current (read-only) |
| 0x05 | Calibration | Calibration value (read-write) |
| 0x06 | Mask/Enable | Alert configuration and status flags |
| 0x07 | Alert Limit | Threshold value for the selected alert function |
| 0xFE | Manufacturer ID | Reads 0x5449 ("TI") |
| 0xFF | Die ID | Reads 0x2260 |

**Configuration Register (0x00) — INA226:**

```
Bit 15:    RST     — Write 1 to reset
Bit 14-12: (reserved)
Bit 11-9:  AVG     — Averaging mode: 000=1, 001=4, 010=16, 011=64,
                      100=128, 101=256, 110=512, 111=1024
Bit 8-6:   VBUSCT  — Bus voltage conversion time
Bit 5-3:   VSHCT   — Shunt voltage conversion time
Bit 2-0:   MODE    — Operating mode (same encoding as INA219)
```

**Conversion time (VBUSCT/VSHCT fields):**

| Value | Conversion Time |
|-------|-----------------|
| 000 | 140µs |
| 001 | 204µs |
| 010 | 332µs |
| 011 | 588µs |
| 100 | 1.1ms (default) |
| 101 | 2.116ms |
| 110 | 4.156ms |
| 111 | 8.244ms |

## Calibration Register Calculation

The calibration register value determines how the INA219/INA226 converts raw shunt voltage readings into current and power values in the Current (0x04) and Power (0x03) registers.

### INA219 Calibration

```
Cal = trunc(0.04096 / (Current_LSB × R_SHUNT))
```

Where:
- `Current_LSB` is the desired current resolution in amps per bit
- `R_SHUNT` is the shunt resistance in ohms
- `0.04096` is a fixed internal scaling factor

The minimum `Current_LSB` is `Maximum_Expected_Current / 32768`. Choosing a round value simplifies firmware calculations.

**Example**: R_SHUNT = 0.1Ω, maximum current = 3.2A:

```
Current_LSB_min = 3.2 / 32768 = 0.00009766 A
Choose Current_LSB = 0.0001 A = 100µA per bit

Cal = trunc(0.04096 / (0.0001 × 0.1)) = trunc(4096) = 4096 = 0x1000
```

The Power register LSB is automatically 20 × Current_LSB = 2mW per bit.

### INA226 Calibration

```
Cal = trunc(0.00512 / (Current_LSB × R_SHUNT))
```

**Example**: R_SHUNT = 0.01Ω, maximum current = 8A:

```
Current_LSB_min = 8 / 32768 = 0.000244 A
Choose Current_LSB = 0.00025 A = 250µA per bit

Cal = trunc(0.00512 / (0.00025 × 0.01)) = trunc(2048) = 2048 = 0x0800
```

The INA226 Power register LSB = 25 × Current_LSB = 6.25mW per bit.

## I2C Address Selection

Both devices use two address pins (A0, A1), each of which can be connected to GND, VS (supply), SDA, or SCL, providing 16 unique addresses:

| A1 | A0 | INA219 Address | INA226 Address |
|----|-----|----------------|----------------|
| GND | GND | 0x40 | 0x40 |
| GND | VS | 0x41 | 0x41 |
| GND | SDA | 0x42 | 0x42 |
| GND | SCL | 0x43 | 0x43 |
| VS | GND | 0x44 | 0x44 |
| VS | VS | 0x45 | 0x45 |
| VS | SDA | 0x46 | 0x46 |
| VS | SCL | 0x47 | 0x47 |
| SDA | GND | 0x48 | 0x48 |
| SDA | VS | 0x49 | 0x49 |
| SDA | SDA | 0x4A | 0x4A |
| SDA | SCL | 0x4B | 0x4B |
| SCL | GND | 0x4C | 0x4C |
| SCL | VS | 0x4D | 0x4D |
| SCL | SDA | 0x4E | 0x4E |
| SCL | SCL | 0x4F | 0x4F |

This allows up to 16 INA226 devices on a single I2C bus, enabling per-rail monitoring of complex multi-supply systems (VDD_CORE, VDD_IO, VDD_RF, VDD_SENSOR, etc.).

## Alert and Limit Registers (INA226)

The INA226's Mask/Enable register (0x06) configures which condition triggers the ALERT pin (active-low, open-drain):

```
Bit 15: SOL  — Shunt voltage Over-Limit
Bit 14: SUL  — Shunt voltage Under-Limit
Bit 13: BOL  — Bus voltage Over-Limit
Bit 12: BUL  — Bus voltage Under-Limit
Bit 11: POL  — Power Over-Limit
Bit 10: CNVR — Conversion Ready flag
Bit 4:  AFF  — Alert Function Flag (read-only, indicates alert triggered)
Bit 3:  CVRF — Conversion Ready Flag (read-only)
Bit 2:  OVF  — Math Overflow Flag (read-only)
Bit 1:  APOL — Alert Polarity: 0 = active-low (default), 1 = active-high
Bit 0:  LEN  — Alert Latch Enable: 0 = transparent, 1 = latched
```

The Alert Limit register (0x07) holds the threshold value in the same format as the corresponding measurement register. For a shunt over-limit alert:

```
Alert_Limit = desired_shunt_voltage_µV / 2.5

Example: Alert at 1A through a 10mΩ shunt (shunt voltage = 10mV = 10,000µV):
Alert_Limit = 10000 / 2.5 = 4000 = 0x0FA0
```

## Firmware Driver Example

A complete I2C driver for the INA226 on an STM32 using HAL:

```c
#include "stm32f4xx_hal.h"

#define INA226_ADDR       (0x40 << 1)  /* 7-bit address shifted for HAL */
#define REG_CONFIG        0x00
#define REG_SHUNT_VOLTAGE 0x01
#define REG_BUS_VOLTAGE   0x02
#define REG_POWER         0x03
#define REG_CURRENT       0x04
#define REG_CALIBRATION   0x05
#define REG_MASK_ENABLE   0x06
#define REG_ALERT_LIMIT   0x07

static I2C_HandleTypeDef *hi2c;

static HAL_StatusTypeDef ina226_write_reg(uint8_t reg, uint16_t value)
{
    uint8_t buf[3];
    buf[0] = reg;
    buf[1] = (value >> 8) & 0xFF;  /* MSB first */
    buf[2] = value & 0xFF;
    return HAL_I2C_Master_Transmit(hi2c, INA226_ADDR, buf, 3, 100);
}

static HAL_StatusTypeDef ina226_read_reg(uint8_t reg, uint16_t *value)
{
    uint8_t buf[2];
    HAL_StatusTypeDef status;

    status = HAL_I2C_Master_Transmit(hi2c, INA226_ADDR, &reg, 1, 100);
    if (status != HAL_OK) return status;

    status = HAL_I2C_Master_Receive(hi2c, INA226_ADDR, buf, 2, 100);
    if (status != HAL_OK) return status;

    *value = ((uint16_t)buf[0] << 8) | buf[1];
    return HAL_OK;
}

/**
 * Initialize INA226 with specified shunt resistance and max current.
 *
 * @param i2c       Pointer to I2C handle
 * @param r_shunt_mohm  Shunt resistance in milliohms
 * @param max_current_ma  Maximum expected current in milliamps
 */
void ina226_init(I2C_HandleTypeDef *i2c, uint32_t r_shunt_mohm,
                 uint32_t max_current_ma)
{
    hi2c = i2c;

    /* Reset the device */
    ina226_write_reg(REG_CONFIG, 0x8000);
    HAL_Delay(1);

    /* Configuration: 16 averages, 1.1ms conversion for both bus and shunt,
     * continuous shunt + bus voltage mode
     *
     * AVG = 010 (16 averages)
     * VBUSCT = 100 (1.1ms)
     * VSHCT = 100 (1.1ms)
     * MODE = 111 (continuous shunt + bus)
     *
     * Register value: 0b0100_0010_0100_0111 = 0x4247
     */
    ina226_write_reg(REG_CONFIG, 0x4247);

    /* Calculate calibration register
     *
     * Current_LSB = max_current_ma / 32768 (mA per bit)
     * Round up to a convenient value.
     *
     * Cal = 5120 / (Current_LSB_mA * R_shunt_mohm)
     *     = 5120000 / (max_current_ma_rounded * r_shunt_mohm / 32768)
     *
     * Simplified: Cal = 5120 * 32768 / (max_current_ma * r_shunt_mohm)
     *           = 167,772,160 / (max_current_ma * r_shunt_mohm)
     */
    uint32_t cal = 167772160UL / ((uint64_t)max_current_ma * r_shunt_mohm
                                   / 32768);
    /* Clamp to 16-bit */
    if (cal > 0xFFFF) cal = 0xFFFF;

    ina226_write_reg(REG_CALIBRATION, (uint16_t)cal);
}

/**
 * Read bus voltage in millivolts.
 */
int32_t ina226_read_bus_voltage_mv(void)
{
    uint16_t raw;
    ina226_read_reg(REG_BUS_VOLTAGE, &raw);
    /* LSB = 1.25mV */
    return (int32_t)raw * 125 / 100;
}

/**
 * Read shunt voltage in microvolts.
 */
int32_t ina226_read_shunt_voltage_uv(void)
{
    uint16_t raw;
    ina226_read_reg(REG_SHUNT_VOLTAGE, &raw);
    /* LSB = 2.5µV, value is signed (two's complement) */
    int16_t signed_raw = (int16_t)raw;
    return (int32_t)signed_raw * 25 / 10;
}

/**
 * Read current in milliamps (requires calibration register set).
 */
int32_t ina226_read_current_ma(void)
{
    uint16_t raw;
    ina226_read_reg(REG_CURRENT, &raw);
    int16_t signed_raw = (int16_t)raw;
    /* The current register value depends on the calibration and Current_LSB.
     * With the calibration above, the LSB corresponds to
     * max_current_ma / 32768 mA per bit.
     * For a 8A max with 10mΩ shunt: LSB ≈ 0.244 mA
     */
    /* This returns the raw register value; scale in application code
     * based on the chosen Current_LSB */
    return (int32_t)signed_raw;
}

/**
 * Read power in milliwatts (requires calibration register set).
 */
uint32_t ina226_read_power_mw(void)
{
    uint16_t raw;
    ina226_read_reg(REG_POWER, &raw);
    /* Power LSB = 25 × Current_LSB */
    return (uint32_t)raw;
}

/**
 * Configure over-current alert on the ALERT pin.
 *
 * @param shunt_limit_uv  Shunt voltage threshold in microvolts
 */
void ina226_set_overcurrent_alert(int32_t shunt_limit_uv)
{
    /* Alert Limit register value = shunt_limit_uv / 2.5 */
    int16_t limit = (int16_t)(shunt_limit_uv * 10 / 25);

    ina226_write_reg(REG_ALERT_LIMIT, (uint16_t)limit);

    /* Enable Shunt Over-Limit alert, latched, active-low */
    uint16_t mask = (1 << 15)  /* SOL: shunt over-limit */
                  | (1 << 0);  /* LEN: latch enable */
    ina226_write_reg(REG_MASK_ENABLE, mask);
}
```

## Continuous vs Triggered Measurement

In **continuous mode** (MODE = 0b111), the INA226 converts shunt and bus voltage back-to-back in an endless loop. The conversion ready flag (CVRF in Mask/Enable register, bit 3) sets after each conversion pair completes. The total conversion time per sample is:

```
T_total = (T_shunt + T_bus) × AVG_count

Example: 1.1ms shunt + 1.1ms bus, 16 averages:
T_total = (1.1 + 1.1) × 16 = 35.2ms per reading (~28 readings/sec)
```

In **triggered mode** (MODE = 0b011), the device performs a single shunt + bus conversion when the configuration register is written, then enters a low-power idle state. This is useful for battery-powered data loggers that wake the INA226 only when a measurement is needed, reducing average current consumption.

A firmware pattern for triggered measurement with the INA226:

```c
void ina226_trigger_and_read(int32_t *current_ma, int32_t *voltage_mv)
{
    /* Write config with triggered mode (MODE = 011) to start conversion */
    ina226_write_reg(REG_CONFIG, 0x4243);  /* Same settings, mode = triggered */

    /* Wait for conversion ready */
    uint16_t mask;
    do {
        ina226_read_reg(REG_MASK_ENABLE, &mask);
    } while (!(mask & (1 << 3)));  /* Poll CVRF bit */

    *current_ma = ina226_read_current_ma();
    *voltage_mv = ina226_read_bus_voltage_mv();
}
```

## Averaging Configuration

The INA226's hardware averaging reduces noise by averaging multiple ADC conversions internally before updating the output registers. Higher averaging counts produce cleaner readings at the cost of longer update rates:

| AVG Setting | Samples Averaged | Update Period (1.1ms conv time) |
|-------------|------------------|---------------------------------|
| 000 | 1 | 2.2ms |
| 001 | 4 | 8.8ms |
| 010 | 16 | 35.2ms |
| 011 | 64 | 140.8ms |
| 100 | 128 | 281.6ms |
| 101 | 256 | 563.2ms |
| 110 | 512 | 1.13s |
| 111 | 1024 | 2.25s |

For monitoring steady-state current (e.g., tracking battery discharge over hours), 64 or 128 averages produce stable readings. For capturing current transients during firmware state changes, 1 or 4 averages provide faster updates at the cost of more noise.

## Practical Wiring

A complete INA226 high-side measurement circuit:

```
V_SUPPLY (e.g., 3.3V LDO output)
    │
    ├──── 100nF ──── GND          (supply bypass for INA226)
    │
    ├──── VS pin (INA226 power supply)
    │
    ├──── R_SHUNT (10mΩ, 1%, 2512)
    │         │
    │     INP pin ──┐
    │               │  INA226
    │     INN pin ──┘
    │         │
    └─────────┴──── LOAD VCC
                        │
                      LOAD
                        │
                       GND ──── GND pin (INA226)

    SDA ───── SDA pin ────┬──── 4.7kΩ ──── 3.3V
    SCL ───── SCL pin ────┬──── 4.7kΩ ──── 3.3V
    A0 ────── GND
    A1 ────── GND         (address = 0x40)
    ALERT ─── MCU GPIO ──── 10kΩ ──── 3.3V   (open-drain, needs pullup)
```

**Shunt resistor**: A 10mΩ ±1% resistor in a 2512 package handles up to 1W (10A peak). For most embedded loads drawing up to 500mA, a 100mΩ ±0.5% resistor in a 1206 package provides better resolution (2.5µV LSB corresponds to 25µA with 100mΩ vs 250µA with 10mΩ).

**Bypass capacitor**: A 100nF MLCC directly at the VS and GND pins of the INA226 is mandatory. A 10µF bulk capacitor within 10mm is recommended for stability during bus voltage transients.

**I2C pullups**: Standard 4.7kΩ pullups to 3.3V for 100kHz or 400kHz I2C. For buses with multiple INA226 devices (adding capacitive load), 2.2kΩ pullups may be necessary to maintain rise time compliance at 400kHz.

**ALERT pin**: Open-drain output requires an external pullup resistor (10kΩ typical). Connect to an MCU GPIO configured as an interrupt input for real-time over-current response.

## Tips

- Start with a 100mΩ shunt for loads up to 500mA — the INA226's 2.5µV LSB provides 25µA resolution, sufficient for most embedded power profiling
- Use the INA226's manufacturer ID register (0xFE, reads 0x5449) as a connectivity check during initialization — a read that returns any other value indicates an address error, wiring fault, or missing device
- Configure the ALERT pin for conversion-ready interrupts rather than polling the CVRF bit — this frees the MCU to perform other tasks between measurements
- For multi-channel monitoring, assign sequential I2C addresses and read all devices in a single I2C burst to minimize bus overhead
- When logging power over time, read both the bus voltage and current registers in a single I2C transaction (or read the power register directly) to avoid skew between voltage and current samples from different conversion cycles
- Set the INA226 averaging to 16 or 64 samples for steady-state monitoring and drop to 1 sample when profiling transient events — the configuration register can be rewritten at any time without resetting the device

## Caveats

- **The INA219's 12-bit ADC limits resolution to 10µV per LSB on the shunt** — With a 10mΩ shunt, the minimum detectable current is 1mA; for microamp-level sleep current monitoring, the INA226 with its 2.5µV LSB (250µA per bit with 10mΩ) is the minimum, and even then, sub-100µA measurements require a larger shunt value
- **The calibration register accepts only integer values** — Rounding errors in the calibration calculation produce a systematic offset in the current and power register readings; compensating in firmware by multiplying the raw register value by a floating-point correction factor improves accuracy
- **Writing to the configuration register resets the averaging accumulator** — Changing any configuration field (even the operating mode) during a measurement cycle discards partially accumulated averages and restarts the count, which can cause a stale reading on the next register read
- **The INA219's bus voltage register includes a 3-bit status field in the lower bits** — The actual bus voltage value occupies bits 15 through 3; failing to right-shift by 3 before applying the 4mV LSB produces a reading 8x larger than the actual voltage
- **I2C address pins connected to SDA or SCL change the device address dynamically during bus transitions** — This is intentional per the datasheet for achieving 16 addresses, but if a pin is left floating, it may oscillate between addresses, causing intermittent communication failures
- **The ALERT pin is open-drain and requires an external pullup** — Without the pullup, the pin floats when not asserted, and the MCU's internal weak pullup (40–100kΩ) may be too slow for reliable interrupt triggering in noise-sensitive environments

## In Practice

- A battery-powered sensor node using an INA226 to log its own power consumption writes averaged current readings to flash every 60 seconds — the 16-average, 1.1ms conversion time setting produces a new reading every 35ms, so the firmware reads and filters multiple samples per log interval for better accuracy
- An INA226 configured with a 10mΩ shunt that reports 0mA at idle when the DMM reads 800µA is hitting the resolution limit — the 250µA per bit resolution with 10mΩ rounds 800µA to 3 LSBs, which is within the noise floor; switching to a 100mΩ shunt provides 25µA per bit and resolves the idle current clearly
- A multi-rail monitoring system with 8 INA226 devices on one I2C bus at 400kHz polls all devices in 4ms (each register read takes ~500µs at 400kHz including addressing overhead) — fast enough for 100Hz update rates across all channels
- An over-current alert configured on the INA226 ALERT pin fires within one conversion cycle (2.2ms with no averaging) of the current exceeding the threshold — the MCU's interrupt handler disables the load MOSFET within 50µs of the alert, providing sub-3ms total response time from fault to shutdown
- A product that passes power testing on the bench but fails in the field often has INA226 calibration values calculated for room temperature — the shunt resistor's TCR shifts the effective resistance at temperature extremes, and the calibration register does not compensate automatically; periodic recalibration against a known reference or using a shunt with ≤50 ppm/°C TCR eliminates the drift
