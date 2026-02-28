---
title: "Environmental Sensor Bus Patterns"
weight: 40
---

# Environmental Sensor Bus Patterns

A typical environmental monitoring node integrates three to six sensors — temperature, humidity, pressure, VOC, particulate matter, light — almost all of which communicate over I2C. This concentration of devices on a single two-wire bus creates practical challenges: address collisions, bus loading, power sequencing, and the question of whether to poll continuously or sleep between measurements. The firmware architecture for multi-sensor systems follows repeating patterns that, once understood, apply to nearly any combination of environmental sensors.

## Shared I2C Bus Topology

Most environmental sensors use I2C with 7-bit addresses. A single I2C bus at 100 kHz or 400 kHz can serve many devices, but the practical limit depends on total bus capacitance (the I2C spec allows up to 400 pF), the number of pullup resistors, and the longest cable run. On a compact PCB with all sensors within 10 cm, 6-8 devices on a single bus is routine. Extending the bus beyond 30 cm or adding multiple breakout boards often requires active bus buffers (e.g., PCA9615 for differential I2C) or reducing the clock speed to 100 kHz.

### Pullup Resistor Sizing

Each device on the bus contributes input capacitance (typically 3-10 pF). The pullup resistors must be strong enough to charge the bus capacitance within the required rise time, but weak enough to stay within the sink current limit of the weakest device (typically 3 mA). For a bus with 50-100 pF total capacitance at 400 kHz, 2.2K-4.7K pullups on 3.3V are standard. With multiple breakout boards each adding their own pullups, the effective pullup resistance drops — sometimes below 1K — overloading the open-drain drivers. Removing redundant pullups on satellite boards is a routine fix.

## Common I2C Addresses

Address conflicts are the most frequent integration headache. Many sensors from different manufacturers share the same default address.

| Sensor | Default Address | Alternate Address | Notes |
|---|---|---|---|
| BME280 | 0x76 | 0x77 (SDO pin) | Shared with BMP280, BMP388 |
| BMP390 | 0x76 | 0x77 (SDO pin) | Conflicts with BME280 |
| SHT4x | 0x44 | 0x45, 0x46 (variant) | Address set at factory |
| SGP40 | 0x59 | None | Fixed address |
| CCS811 | 0x5A | 0x5B (ADDR pin) | Only two options |
| TMP117 | 0x48 | 0x49, 0x4A, 0x4B | ADD0 pin, 4 options |
| TSL2591 (light) | 0x29 | None | Fixed address |
| SCD40 (CO2) | 0x62 | None | Fixed address |
| PMSA003I (PM2.5) | 0x12 | None | Fixed address |

When two BME280 sensors are needed (e.g., indoor and outdoor), the SDO pin provides exactly one alternative (0x77). Needing a third BME280 on the same bus requires a multiplexer.

## I2C Multiplexer: TCA9548A

The TCA9548A from Texas Instruments is an 8-channel I2C multiplexer that sits between the master and up to 8 downstream buses. Each downstream channel is electrically isolated, allowing identical-address devices on different channels. The TCA9548A itself is at address 0x70-0x77 (set by A0-A2 pins), and channel selection is accomplished by writing a single byte.

```c
#include "stm32f4xx_hal.h"

#define TCA9548A_ADDR  (0x70 << 1)

/**
 * Select a single channel on the TCA9548A.
 * channel: 0-7, or 0xFF to disable all channels.
 */
HAL_StatusTypeDef tca9548a_select(I2C_HandleTypeDef *hi2c, uint8_t channel) {
    uint8_t reg;
    if (channel > 7) {
        reg = 0x00;  /* All channels off */
    } else {
        reg = 1 << channel;
    }
    return HAL_I2C_Master_Transmit(hi2c, TCA9548A_ADDR, &reg, 1, 100);
}

/**
 * Read temperature from a BME280 on a specific TCA9548A channel.
 */
float read_bme280_on_channel(I2C_HandleTypeDef *hi2c, uint8_t channel) {
    tca9548a_select(hi2c, channel);
    /* Now all I2C traffic routes to the selected channel */
    bme280_trigger_forced(hi2c);
    HAL_Delay(50);
    return bme280_read_temperature(hi2c);
}
```

A common pitfall: forgetting to select the correct channel before accessing a sensor results in either a NACK (if no device is on the currently selected channel at that address) or reading the wrong sensor (if both channels happen to have a device at the same address and the wrong channel is active). Defensive firmware verifies the channel selection before every sensor transaction in multi-channel systems.

## Polling vs. Interrupt-Driven Reads

### Periodic Polling

The simplest multi-sensor architecture uses a timer-driven polling loop. A periodic callback triggers all sensor reads in sequence:

```c
#define NUM_SENSORS  4
#define POLL_INTERVAL_MS  1000

typedef struct {
    const char *name;
    uint8_t i2c_addr;
    uint8_t mux_channel;  /* 0xFF = no mux */
    float (*read_fn)(I2C_HandleTypeDef *hi2c);
    float last_value;
    uint32_t last_read_ms;
    uint8_t valid;
} SensorSlot;

static SensorSlot sensors[NUM_SENSORS] = {
    { "BME280_indoor",  0x76, 0,    bme280_read_temperature,  0, 0, 0 },
    { "BME280_outdoor", 0x76, 1,    bme280_read_temperature,  0, 0, 0 },
    { "SGP40_voc",      0x59, 0xFF, sgp40_read_voc_index,     0, 0, 0 },
    { "SCD40_co2",      0x62, 0xFF, scd40_read_co2,           0, 0, 0 },
};

void sensor_poll_all(I2C_HandleTypeDef *hi2c) {
    for (int i = 0; i < NUM_SENSORS; i++) {
        /* Select mux channel if needed */
        if (sensors[i].mux_channel != 0xFF) {
            tca9548a_select(hi2c, sensors[i].mux_channel);
        }

        float val = sensors[i].read_fn(hi2c);
        if (!isnan(val)) {
            sensors[i].last_value = val;
            sensors[i].last_read_ms = HAL_GetTick();
            sensors[i].valid = 1;
        }
        /* On read failure, retain last valid value, set stale flag */
    }
}
```

### Interrupt-Driven (Data Ready)

Some sensors (TMP117, BME680, SCD40) provide a data-ready interrupt pin. Connecting this to a GPIO EXTI line allows the MCU to sleep between conversions and wake only when new data is available. This is the preferred pattern for battery-powered systems where every microamp of sleep current matters.

The implementation uses a flag set in the ISR and checked in the main loop:

```c
volatile uint8_t sensor_data_ready = 0;

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
    if (GPIO_Pin == SENSOR_DRDY_PIN) {
        sensor_data_ready = 1;
    }
}

void main_loop(void) {
    while (1) {
        if (sensor_data_ready) {
            sensor_data_ready = 0;
            float temp = tmp117_read_temperature(&hi2c1);
            log_data(temp);
        }
        HAL_PWR_EnterSLEEPMode(PWR_MAINREGULATOR_ON, PWR_SLEEPENTRY_WFI);
    }
}
```

## Power Cycling for Battery Life

Environmental sensors that are read once per minute or less can be powered down between readings to reduce average current. A GPIO pin driving a P-channel MOSFET or a load switch (e.g., TPS22918) controls sensor power. The firmware sequence:

1. Enable sensor power (GPIO high or load switch enable).
2. Wait for sensor power-on time (typically 1-10 ms for digital sensors, 2+ minutes for gas sensors).
3. Initialize the sensor (send configuration over I2C).
4. Trigger measurement and read result.
5. Disable sensor power.

```c
#define SENSOR_PWR_PIN    GPIO_PIN_5
#define SENSOR_PWR_PORT   GPIOB

void sensor_power_on(void) {
    HAL_GPIO_WritePin(SENSOR_PWR_PORT, SENSOR_PWR_PIN, GPIO_PIN_SET);
    HAL_Delay(5);  /* BME280 startup time: 2 ms typical */
}

void sensor_power_off(void) {
    HAL_GPIO_WritePin(SENSOR_PWR_PORT, SENSOR_PWR_PIN, GPIO_PIN_RESET);
}

void low_power_read_cycle(I2C_HandleTypeDef *hi2c) {
    sensor_power_on();
    bme280_init(hi2c);             /* Re-init after power cycle */
    bme280_trigger_forced(hi2c);
    HAL_Delay(50);
    float temp = bme280_read_temperature(hi2c);
    float pres = bme280_read_pressure(hi2c);
    sensor_power_off();

    log_to_flash(temp, pres);
    enter_stop_mode(60000);        /* Sleep 60 seconds */
}
```

This pattern is effective for temperature, humidity, and pressure sensors (which stabilize in milliseconds after power-on) but is impractical for gas sensors that require minutes of warm-up. Gas sensors in battery-powered applications are typically duty-cycled with longer on-times — e.g., 30 seconds on, 5 minutes off — accepting reduced accuracy during the warm-up portion of each cycle.

## Sensor Hub Pattern

For systems with many sensors and complex processing requirements, a dedicated sensor hub MCU (often a low-power Cortex-M0+ like the STM32L011 or an nRF52810) manages the I2C bus, aggregates sensor data, and presents a simplified interface to the main application processor. The main processor queries the hub over I2C, SPI, or UART for pre-processed sensor readings, offloading the bus management and timing-critical sensor interactions.

This architecture is common in commercial products like indoor air quality monitors, where an ESP32 handles Wi-Fi/display while a small MCU handles the sensor bus at precise timing intervals. It also provides hardware isolation — a misbehaving sensor that locks the I2C bus affects only the hub, not the application processor.

## Multi-Sensor Data Logging Structure

A practical firmware architecture for environmental data logging organizes sensor data into a timestamped record structure:

```c
typedef struct __attribute__((packed)) {
    uint32_t timestamp;       /* Unix epoch or ticks since boot */
    int16_t  temp_indoor;     /* 0.01 deg C per LSB */
    int16_t  temp_outdoor;    /* 0.01 deg C per LSB */
    uint16_t humidity;        /* 0.01 %RH per LSB */
    uint32_t pressure;        /* Pa, unsigned */
    uint16_t voc_index;       /* SGP40 VOC index (0-500) */
    uint16_t co2_ppm;         /* SCD40 CO2 in ppm */
    uint8_t  status_flags;    /* Bit field: sensor valid flags */
} EnvRecord;

#define RECORD_SIZE  sizeof(EnvRecord)  /* 21 bytes */

/* Store to external flash (e.g., W25Q128, 16 MB) */
void store_record(EnvRecord *rec) {
    static uint32_t flash_write_addr = 0;
    w25q_write(flash_write_addr, (uint8_t *)rec, RECORD_SIZE);
    flash_write_addr += RECORD_SIZE;
    if (flash_write_addr >= FLASH_SIZE) {
        flash_write_addr = 0;  /* Wrap around (ring buffer) */
    }
}
```

Scaling integer values (e.g., temperature in hundredths of a degree as int16_t) avoids floating-point storage overhead and guarantees consistent record sizes for flash logging. The status_flags byte marks which sensors produced valid readings for each record, enabling downstream processing to handle partial data gracefully.

## Tips

- Use a bus scanner function at startup to enumerate all detected I2C addresses — this catches wiring errors, missing sensors, and address conflicts before the main application loop begins
- When using a TCA9548A, disable all channels (write 0x00) after completing a sensor read to prevent crosstalk between channels from pull-up leakage
- Size I2C pullups for the total bus capacitance, not just one device — add the capacitance of every sensor, breakout board, and cable run, then select pullups that achieve compliant rise times at the target clock speed
- For battery-powered loggers, group all sensor reads into a single wake window to minimize the number of sleep-wake transitions, which each carry a fixed energy cost from regulator startup and oscillator settling

## Caveats

- **Clock stretching compatibility varies by MCU** — Some I2C peripherals (notably early STM32F1 implementations) handle clock stretching poorly, causing bus lockups when a sensor holds SCL low during conversion; verifying clock stretching support in the MCU reference manual before selecting sensors saves debugging time later
- **Power-cycling sensors resets all configuration** — After toggling sensor power, every register must be rewritten; firmware that assumes persistent configuration after a power glitch produces garbage readings from unconfigured sensors
- **I2C address conflicts may not manifest immediately** — Two devices at the same address can sometimes appear to work during casual testing because the bus protocol allows ACKs to overlap; the failure appears as corrupted data under specific read patterns
- **The TCA9548A adds latency** — Each channel switch is an I2C transaction (about 30 us at 400 kHz); in a system polling 8 sensors through a mux, the channel switching overhead adds roughly 240 us per poll cycle, which matters at high sample rates

## In Practice

- A multi-sensor board that works on the bench but produces intermittent NACK errors in the field often has bus capacitance issues from cable runs — reducing I2C speed from 400 kHz to 100 kHz or adding an active bus extender resolves the errors
- A data logger that records valid temperature and pressure but shows 0% humidity after every power cycle has a BME280 initialization bug — the humidity oversampling register (0xF2) must be written before ctrl_meas (0xF4), or the humidity channel remains disabled
- An environmental monitor with an SGP40 and a BME280 on the same I2C bus that works for hours but occasionally locks up typically has a clock stretching conflict — the SGP40 stretches SCL during its 30 ms measurement, and if the MCU times out during this period, the bus enters an unrecoverable state without a manual SCL toggle recovery sequence
- A battery-powered logger expected to last 6 months on 2xAA cells that dies in 3 weeks often has a sensor that never enters sleep mode — measuring the quiescent current with all sensors "idle" versus all sensors power-gated reveals the culprit; a single CCS811 in continuous mode draws 26 mA, dominating the power budget
