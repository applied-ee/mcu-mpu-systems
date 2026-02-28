---
title: "Temperature Sensing (NTC, RTD, Digital)"
weight: 10
---

# Temperature Sensing (NTC, RTD, Digital)

Temperature is the most commonly measured physical quantity in embedded systems. The sensor choices span a wide range — from a 5-cent NTC thermistor read through an ADC to a calibrated digital IC reporting millidegree resolution over I2C. Each technology carries distinct tradeoffs in accuracy, cost, interface complexity, and self-heating. Selecting the right sensor for a given application depends on understanding these tradeoffs at the hardware level, not just the headline accuracy number from a datasheet.

## NTC Thermistors

An NTC (negative temperature coefficient) thermistor is a resistive element whose resistance drops as temperature rises. The most common variant is the 10K NTC, which presents 10 kohms at 25 degrees C. These devices are inexpensive (often under $0.10 in quantity), physically small, and require no digital bus — just a voltage divider and an ADC channel.

### Voltage Divider Circuit

The standard front-end places the NTC in a voltage divider with a fixed precision resistor (typically matching the NTC's nominal resistance — 10K for a 10K NTC). The midpoint voltage feeds an MCU ADC input:

```
VCC (3.3V)
  |
 [10K fixed resistor]
  |
  +--- ADC input
  |
 [10K NTC]
  |
 GND
```

With this topology, the ADC voltage at 25 degrees C sits at VCC/2 (1.65V with a 3.3V supply), providing maximum sensitivity near room temperature. The fixed resistor value can be shifted to bias the sensitivity window toward a different temperature range — using a 4.7K fixed resistor shifts peak sensitivity to higher temperatures.

### ADC Reading and Steinhart-Hart Conversion

Raw ADC counts must be converted to resistance, then to temperature using the Steinhart-Hart equation. The three-coefficient form provides accuracy within 0.02 degrees C across a wide range when coefficients are derived from three calibration points.

```c
#include "stm32f4xx_hal.h"
#include <math.h>

#define ADC_RESOLUTION  4096
#define V_REF           3.3f
#define R_FIXED         10000.0f

/* Steinhart-Hart coefficients for Murata NCP15XH103F03RC */
#define SH_A  1.009249522e-03f
#define SH_B  2.378405444e-04f
#define SH_C  2.019202697e-07f

static ADC_HandleTypeDef hadc1;

float ntc_read_temperature(void) {
    HAL_ADC_Start(&hadc1);
    HAL_ADC_PollForConversion(&hadc1, 100);
    uint32_t adc_raw = HAL_ADC_GetValue(&hadc1);

    /* Convert ADC counts to NTC resistance */
    float v_adc = (adc_raw / (float)ADC_RESOLUTION) * V_REF;
    float r_ntc = R_FIXED * (v_adc / (V_REF - v_adc));

    /* Steinhart-Hart equation */
    float log_r = logf(r_ntc);
    float t_kelvin = 1.0f / (SH_A + SH_B * log_r + SH_C * log_r * log_r * log_r);
    return t_kelvin - 273.15f;
}
```

The simplified Beta equation (`1/T = 1/T0 + (1/B) * ln(R/R0)`) is faster to compute but sacrifices accuracy outside a narrow range. For applications requiring better than 1 degree C accuracy across more than 30 degrees C span, the full Steinhart-Hart form is necessary.

### Self-Heating

Passing current through the thermistor for the voltage divider measurement dissipates power in the NTC element itself, raising its temperature above the true ambient. With a 10K NTC in a 3.3V divider at 25 degrees C, the current is approximately 165 uA, dissipating about 0.27 mW — negligible in free air. In still air with poor thermal coupling, or at high excitation voltages, self-heating can introduce 0.1-0.5 degrees C of error. Pulsing the excitation (enabling the divider only during ADC conversion) eliminates this effect entirely.

## RTD Sensors (PT100 / PT1000)

Resistance Temperature Detectors use a pure metal element (almost always platinum) whose resistance increases linearly with temperature. The PT100 presents 100 ohms at 0 degrees C; the PT1000 presents 1000 ohms. RTDs offer superior accuracy and long-term stability compared to thermistors, at the cost of higher price and more complex front-end circuitry.

### Wire Configurations

Lead wire resistance introduces measurement error in RTD circuits. Several wiring configurations address this:

| Configuration | Wires | Lead Compensation | Typical Use |
|---|---|---|---|
| 2-wire | 2 | None — lead resistance adds directly to reading | Short runs, low-accuracy |
| 3-wire | 3 | Assumes equal lead resistance, subtracts one lead | Industrial standard, moderate accuracy |
| 4-wire (Kelvin) | 4 | Full compensation — separate sense and excitation pairs | Laboratory, highest accuracy |

A PT100 has a sensitivity of approximately 0.385 ohms per degree C. A 1-meter cable run with 26 AWG copper wire adds roughly 0.27 ohms of lead resistance — equivalent to a 0.7 degree C offset in a 2-wire configuration. The 3-wire approach cancels most of this; 4-wire eliminates it entirely.

### Bridge Circuit and Amplification

A Wheatstone bridge with the RTD in one arm converts the small resistance change to a differential voltage suitable for amplification. For a PT100 spanning 0-100 degrees C, the resistance changes from 100 to 138.5 ohms — a differential voltage swing of only a few millivolts across the bridge. An instrumentation amplifier (e.g., INA126 or AD620) with a gain of 50-100 brings this into the ADC's input range.

### MAX31865 RTD-to-Digital Converter

The MAX31865 integrates the excitation source, ADC, and digital filtering into a single SPI-connected IC, eliminating the need for discrete bridge and amplifier components. It supports 2, 3, and 4-wire PT100/PT1000 configurations and provides 15-bit resolution (approximately 0.03 degrees C with a PT100).

Configuration involves writing to a single control register to select wire mode, filter frequency (50 or 60 Hz rejection), and conversion mode (one-shot or continuous).

```c
#include "stm32f4xx_hal.h"

#define MAX31865_CS_PORT  GPIOA
#define MAX31865_CS_PIN   GPIO_PIN_4

#define MAX31865_REG_CONFIG  0x00
#define MAX31865_REG_RTD_MSB 0x01
#define MAX31865_REG_FAULT   0x07

/* Config: Vbias on, auto-convert off, 1-shot, 3-wire, fault clear, 60Hz */
#define MAX31865_CONFIG_3WIRE  0xD0

static SPI_HandleTypeDef hspi1;

static void max31865_write(uint8_t reg, uint8_t val) {
    uint8_t tx[2] = { reg | 0x80, val };  /* Bit 7 = write */
    HAL_GPIO_WritePin(MAX31865_CS_PORT, MAX31865_CS_PIN, GPIO_PIN_RESET);
    HAL_SPI_Transmit(&hspi1, tx, 2, 100);
    HAL_GPIO_WritePin(MAX31865_CS_PORT, MAX31865_CS_PIN, GPIO_PIN_SET);
}

static uint8_t max31865_read(uint8_t reg) {
    uint8_t tx[2] = { reg & 0x7F, 0x00 };
    uint8_t rx[2];
    HAL_GPIO_WritePin(MAX31865_CS_PORT, MAX31865_CS_PIN, GPIO_PIN_RESET);
    HAL_SPI_TransmitReceive(&hspi1, tx, rx, 2, 100);
    HAL_GPIO_WritePin(MAX31865_CS_PORT, MAX31865_CS_PIN, GPIO_PIN_SET);
    return rx[1];
}

float max31865_read_temperature(void) {
    /* Enable Vbias, then trigger one-shot */
    max31865_write(MAX31865_REG_CONFIG, 0xC0);  /* Vbias on */
    HAL_Delay(10);  /* Wait for bias voltage to settle */
    max31865_write(MAX31865_REG_CONFIG, MAX31865_CONFIG_3WIRE);

    HAL_Delay(70);  /* 60 Hz filter: 65 ms conversion */

    uint8_t msb = max31865_read(MAX31865_REG_RTD_MSB);
    uint8_t lsb = max31865_read(MAX31865_REG_RTD_MSB + 1);
    uint16_t rtd_raw = ((msb << 8) | lsb) >> 1;  /* 15-bit ADC value */

    /* Check fault bit */
    if (lsb & 0x01) {
        uint8_t fault = max31865_read(MAX31865_REG_FAULT);
        /* Handle fault: open RTD, short, over/under voltage */
        max31865_write(MAX31865_REG_CONFIG, 0x02);  /* Clear fault */
        return -999.0f;
    }

    /* Convert to resistance: Rrtd = (raw / 32768) * Rref */
    float r_ref = 430.0f;   /* 430 ohm reference for PT100 */
    float r_rtd = (rtd_raw / 32768.0f) * r_ref;

    /* Callendar-Van Dusen approximation (0 to +850 C range) */
    float a = 3.9083e-3f;
    float b = -5.775e-7f;
    float temp = (-a + sqrtf(a * a - 4.0f * b * (1.0f - r_rtd / 100.0f)))
                 / (2.0f * b);
    return temp;
}
```

The reference resistor value (Rref) must match the board hardware: 430 ohms is standard for PT100, 4300 ohms for PT1000. The MAX31865 also provides built-in fault detection — open RTD, shorted RTD, and over/under voltage conditions — accessible through the fault status register.

## Digital Temperature Sensors

### DS18B20 (1-Wire)

The DS18B20 from Maxim/Analog Devices communicates over a single data line using the 1-Wire protocol. Each device has a unique 64-bit ROM code, allowing multiple sensors on one bus without address conflicts. Resolution is configurable from 9 to 12 bits (0.5 to 0.0625 degrees C), with conversion time ranging from 93.75 ms (9-bit) to 750 ms (12-bit).

```c
/* DS18B20 temperature conversion sequence (bit-banged 1-Wire) */
#include "onewire.h"

float ds18b20_read_temperature(OneWire_HandleTypeDef *ow) {
    uint8_t scratchpad[9];

    /* Reset bus, skip ROM (single device), start conversion */
    onewire_reset(ow);
    onewire_write_byte(ow, 0xCC);  /* Skip ROM */
    onewire_write_byte(ow, 0x44);  /* Convert T */

    /* Wait for conversion — 750ms worst case at 12-bit */
    HAL_Delay(750);

    /* Reset bus, skip ROM, read scratchpad */
    onewire_reset(ow);
    onewire_write_byte(ow, 0xCC);
    onewire_write_byte(ow, 0xBE);  /* Read Scratchpad */

    for (int i = 0; i < 9; i++) {
        scratchpad[i] = onewire_read_byte(ow);
    }

    /* Bytes 0-1: temperature LSB/MSB in 1/16 degree C */
    int16_t raw = (scratchpad[1] << 8) | scratchpad[0];
    return raw / 16.0f;
}
```

The 1-Wire protocol requires precise timing (1 us resolution for bit slots), making it sensitive to interrupt latency. A hardware UART peripheral can be repurposed to generate 1-Wire timing, freeing the CPU from bit-bang constraints.

### TMP117 (I2C, High Accuracy)

The TMP117 from Texas Instruments provides 0.1 degrees C accuracy from -20 to +50 degrees C without calibration, and 0.3 degrees C across its full -55 to +150 degrees C range. It communicates over I2C at address 0x48 (configurable to 0x49, 0x4A, or 0x4B via the ADD0 pin). The 16-bit temperature register provides 0.0078125 degrees C resolution.

```c
#include "stm32f4xx_hal.h"

#define TMP117_ADDR       (0x48 << 1)
#define TMP117_REG_TEMP   0x00
#define TMP117_REG_CONFIG 0x01

float tmp117_read_temperature(I2C_HandleTypeDef *hi2c) {
    uint8_t buf[2];
    HAL_I2C_Mem_Read(hi2c, TMP117_ADDR, TMP117_REG_TEMP,
                     I2C_MEMADD_SIZE_8BIT, buf, 2, 100);

    int16_t raw = (buf[0] << 8) | buf[1];
    return raw * 0.0078125f;  /* 7.8125 mdeg C per LSB */
}
```

The TMP117 includes an internal averaging filter (configurable 1 to 64 samples) that reduces noise at the expense of update rate. At 64 averages, the noise drops below 0.003 degrees C RMS, approaching laboratory-grade performance from a $2 sensor.

### Choosing Between Digital Sensors

The DS18B20 excels in multi-point temperature measurement — its unique 64-bit address allows dozens of sensors on a single GPIO pin with no address management. The typical application is a string of temperature probes along a pipe, in a refrigeration unit, or across a building HVAC system. The TMP117, by contrast, is optimized for single-point high-accuracy measurement where I2C is already available and the extra accuracy justifies the slightly higher cost.

For applications requiring both high accuracy and multi-point measurement, a combination approach works well: TMP117 for the critical reference point (e.g., the control temperature in a thermal chamber) and DS18B20 sensors for the distributed measurement points where +/-0.5 degrees C is acceptable.

### Thermocouple Interfaces

For temperatures above 150 degrees C (kiln monitoring, exhaust gas measurement, soldering station control), thermocouples are the standard. Type K thermocouples cover -200 to +1350 degrees C. The MAX31855 (SPI) and MAX6675 (SPI) provide cold-junction-compensated thermocouple-to-digital conversion. The raw thermocouple voltage is only 41 uV per degree C, making the integrated cold-junction sensor and amplifier essential — attempting to read a thermocouple directly with an MCU ADC produces unusable results without significant external signal conditioning.

## Sensor Comparison

| Parameter | 10K NTC | PT100 (4-wire) | DS18B20 | TMP117 |
|---|---|---|---|---|
| Accuracy (typical) | +/- 1-2 deg C | +/- 0.1-0.3 deg C | +/- 0.5 deg C | +/- 0.1 deg C |
| Range | -40 to +125 deg C | -200 to +850 deg C | -55 to +125 deg C | -55 to +150 deg C |
| Interface | Analog (ADC) | Analog (bridge + ADC) | 1-Wire digital | I2C |
| Resolution | ADC-limited | ADC-limited | 0.0625 deg C (12-bit) | 0.0078 deg C |
| Self-heating risk | Low-moderate | Low (constant current excitation) | Negligible | Negligible |
| Cost (qty 1) | $0.05-0.30 | $3-15 | $2-4 | $1.50-3 |
| Linearization needed | Yes (Steinhart-Hart) | Mild (Callendar-Van Dusen) | No — digital output | No — digital output |

## Tips

- When using NTC thermistors, average 16-64 ADC samples before applying the Steinhart-Hart equation — ADC noise of +/-2 LSB at 12-bit resolution translates to roughly +/-0.3 degrees C of temperature noise near 25 degrees C
- Match the fixed resistor in an NTC divider to the NTC's nominal resistance at the center of the target measurement range, not necessarily at 25 degrees C
- For the DS18B20, verify the CRC (byte 8 of the scratchpad) before using the temperature value — corrupted 1-Wire reads are common on long cable runs and produce wildly incorrect temperatures
- The TMP117's ALERT pin can generate a hardware interrupt when temperature crosses a programmable threshold, eliminating the need for continuous polling in thermostat-style applications
- PT1000 sensors (1000 ohms at 0 degrees C) produce 10x the signal swing of PT100 for the same temperature change, relaxing amplifier gain and noise requirements

## Caveats

- **NTC resistance curves are highly nonlinear** — Using a simple linear approximation instead of the Steinhart-Hart equation introduces errors of 5-10 degrees C at the extremes of the measurement range
- **DS18B20 parasitic power mode is fragile** — While the datasheet describes powering the device through the data line with a strong pullup, this mode fails under long cable runs or when multiple devices convert simultaneously, causing incomplete conversions that read as 85.0 degrees C (the power-on reset value)
- **RTD excitation current must be limited** — Pushing more than 1 mA through a PT100 to improve signal-to-noise causes self-heating that exceeds the sensor's specified accuracy; 0.5 mA or less is standard practice
- **Cheap NTC thermistors have wide tolerance** — A "10K" NTC with 5% tolerance can read 9.5K to 10.5K at 25 degrees C, introducing up to 1.3 degrees C of unit-to-unit variation without individual calibration

## In Practice

- A DS18B20 returning exactly 85.0 degrees C is almost always reporting its power-on default rather than an actual measurement — the conversion either did not complete or the bus communication failed after the convert command
- NTC readings that jump erratically by several degrees between consecutive samples typically indicate insufficient ADC settling time or a noisy power rail rather than actual temperature changes; adding a 100 nF capacitor at the ADC input pin and increasing sample time resolves most cases
- RTD measurements that drift upward over minutes after power-on suggest excessive excitation current causing self-heating in the sensing element — reducing excitation or switching to pulsed measurement mode corrects the drift
- Two TMP117 sensors mounted 5 mm apart on the same PCB that disagree by more than 0.2 degrees C often reveal a thermal gradient from a nearby power regulator or processor — the sensors are correct, the board has a hot spot
