---
title: "IR Proximity & Gesture Detection"
weight: 30
---

# IR Proximity & Gesture Detection

IR proximity sensors work by emitting infrared light from an LED and measuring the reflected intensity with a co-located photodiode. The closer the target object, the stronger the reflected signal. Integrated proximity sensor ICs combine the IR emitter driver, photodiode receiver, ADC, ambient light cancellation, and I2C interface in a single package. More sophisticated devices like the APDS-9960 add a multi-directional photodiode array and onboard gesture engine that can detect swipe directions without host processor intervention.

## Proximity Sensing Principle

The basic IR proximity measurement involves:

1. **IR LED pulse** — The sensor drives an IR LED (typically 940nm or 850nm) with a short current pulse (10–200mA, 10–400µs duration)
2. **Reflected light capture** — A photodiode (with optical filter to reject visible light) measures the intensity of IR light reflected from nearby objects
3. **Ambient light subtraction** — The sensor takes a reading with the LED off, then subtracts it from the LED-on reading to remove ambient IR contamination
4. **Digital output** — The compensated proximity value is presented as an N-bit digital count (8-bit to 16-bit depending on the sensor)

Proximity readings are not calibrated to a physical distance — the returned value depends on the target's reflectivity, size, color, and angle. A white sheet of paper at 50mm may produce the same reading as a black surface at 15mm. For distance estimation, per-target calibration is required.

## VCNL4040 — Proximity + ALS Combo

The VCNL4040 from Vishay is a widely used I2C proximity and ambient light sensor combining a 16-bit proximity channel with programmable IR LED current (50–200mA) and a 16-bit ALS channel.

### Register Map Highlights

| Register | Address | Description |
|---|---|---|
| ALS_CONF | 0x00 | ALS integration time, interrupt |
| ALS_THDH | 0x01 | ALS high threshold |
| ALS_THDL | 0x02 | ALS low threshold |
| PS_CONF1/2 | 0x03 | Proximity config (duty, IT, persistence) |
| PS_CONF3/MS | 0x04 | Proximity config (smart persistence, active force, sunlight cancel) |
| PS_CANC | 0x05 | Proximity cancellation level |
| PS_THDL | 0x06 | Proximity low threshold |
| PS_THDH | 0x07 | Proximity high threshold |
| PS_DATA | 0x08 | Proximity output data |
| ALS_DATA | 0x09 | ALS output data |
| WHITE_DATA | 0x0A | White channel data |
| INT_FLAG | 0x0B | Interrupt flags (PS and ALS) |

### Driver Implementation

```c
/* VCNL4040 proximity sensor driver — STM32 HAL */

#include "stm32f4xx_hal.h"

#define VCNL4040_ADDR         (0x60 << 1)
#define VCNL4040_PS_CONF12    0x03
#define VCNL4040_PS_CONF3_MS  0x04
#define VCNL4040_PS_CANC      0x05
#define VCNL4040_PS_THDL      0x06
#define VCNL4040_PS_THDH      0x07
#define VCNL4040_PS_DATA      0x08
#define VCNL4040_INT_FLAG     0x0B

static I2C_HandleTypeDef *hi2c;

static void vcnl4040_write16(uint8_t reg, uint16_t val)
{
    uint8_t buf[3] = { reg, val & 0xFF, (val >> 8) & 0xFF };
    HAL_I2C_Master_Transmit(hi2c, VCNL4040_ADDR, buf, 3, 100);
}

static uint16_t vcnl4040_read16(uint8_t reg)
{
    uint8_t buf[2];
    HAL_I2C_Master_Transmit(hi2c, VCNL4040_ADDR, &reg, 1, 100);
    HAL_I2C_Master_Receive(hi2c, VCNL4040_ADDR, buf, 2, 100);
    return (buf[1] << 8) | buf[0];
}

void vcnl4040_init(I2C_HandleTypeDef *i2c_handle)
{
    hi2c = i2c_handle;

    /*
     * PS_CONF1 (lower byte):
     *   [3:2] PS_DUTY = 0b01 (1/80)
     *   [5:4] PS_IT   = 0b10 (4T integration)
     *   [1]   PS_SD   = 0     (power on)
     *
     * PS_CONF2 (upper byte):
     *   [3]   PS_HD   = 1     (16-bit output)
     *   [1:0] PS_INT  = 0b00  (interrupt disabled initially)
     */
    uint16_t conf12 = 0x0824;  /* 16-bit, 4T IT, 1/80 duty, PS on */
    vcnl4040_write16(VCNL4040_PS_CONF12, conf12);

    /*
     * PS_CONF3 (lower byte):
     *   [5] PS_SC_EN   = 1  (sunlight cancellation enabled)
     *   [4] PS_SMART_PERS = 0
     *
     * PS_MS (upper byte):
     *   [6:5] LED_I = 0b11 (200mA IR LED current)
     */
    uint16_t conf3_ms = 0x6020;  /* 200mA LED, sunlight cancel on */
    vcnl4040_write16(VCNL4040_PS_CONF3_MS, conf3_ms);

    /* Crosstalk cancellation — set from calibration */
    vcnl4040_write16(VCNL4040_PS_CANC, 0x0000);

    HAL_Delay(10);
}

uint16_t vcnl4040_read_proximity(void)
{
    return vcnl4040_read16(VCNL4040_PS_DATA);
}
```

### Interrupt-Driven Proximity Detection

```c
/**
 * Configure proximity interrupt thresholds.
 * Interrupt fires when proximity exceeds high threshold
 * or drops below low threshold.
 */
void vcnl4040_configure_interrupt(uint16_t low_thr, uint16_t high_thr)
{
    vcnl4040_write16(VCNL4040_PS_THDL, low_thr);
    vcnl4040_write16(VCNL4040_PS_THDH, high_thr);

    /* Enable PS interrupt: PS_INT = 0b01 (close interrupt) */
    uint16_t conf12 = 0x0924;  /* Same config + PS_INT[0] = 1 */
    vcnl4040_write16(VCNL4040_PS_CONF12, conf12);
}

/* GPIO EXTI callback — INT pin from VCNL4040 */
void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == PROX_INT_Pin) {
        uint16_t flags = vcnl4040_read16(VCNL4040_INT_FLAG);
        if (flags & (1 << 9)) {
            /* PS entered close range — object detected */
            proximity_event_close();
        }
        if (flags & (1 << 8)) {
            /* PS exited close range — object removed */
            proximity_event_away();
        }
    }
}
```

## Crosstalk Cancellation

Crosstalk occurs when IR light from the emitter reaches the receiver directly (through internal reflections in the sensor package or off nearby mechanical structures) without bouncing off an external target. This creates a permanent baseline offset in the proximity reading.

The VCNL4040 includes a hardware crosstalk cancellation register (`PS_CANC`) that subtracts a programmable value from every proximity reading. Calibration procedure:

1. Remove all objects from the sensor's field of view (>30cm clear)
2. Take 50–100 proximity readings and average them
3. Write this average to the `PS_CANC` register
4. Store the value in non-volatile memory for future power cycles

```c
uint16_t vcnl4040_calibrate_crosstalk(void)
{
    uint32_t sum = 0;
    const int n_samples = 64;

    /* Ensure cancellation is zeroed during calibration */
    vcnl4040_write16(VCNL4040_PS_CANC, 0x0000);
    HAL_Delay(50);

    for (int i = 0; i < n_samples; i++) {
        sum += vcnl4040_read_proximity();
        HAL_Delay(10);
    }

    uint16_t xtalk = (uint16_t)(sum / n_samples);
    vcnl4040_write16(VCNL4040_PS_CANC, xtalk);
    return xtalk;
}
```

## APDS-9960 — Proximity + Gesture + RGB + ALS

The APDS-9960 from Broadcom is a multi-function sensor combining proximity detection, gesture recognition, and RGB+ALS measurement. The gesture engine uses four directional photodiodes (UP, DOWN, LEFT, RIGHT) arranged around the central IR LED to detect the direction and speed of a hand swipe.

### Gesture Engine Architecture

The gesture detection subsystem operates independently from the host processor:

1. **Entry trigger** — When the proximity reading exceeds a programmable threshold (`GPENTH`), the gesture engine activates
2. **FIFO accumulation** — The four directional photodiodes (U/D/L/R) are sampled and stored in a 32-entry FIFO at a programmable rate
3. **Exit trigger** — When the proximity drops below the exit threshold (`GEXTH`) or the FIFO overflows, the gesture dataset is ready
4. **Host decode** — The host processor reads the FIFO and computes gesture direction from the U/D and L/R differential signals

### Initialization and Gesture Decode

```c
/* APDS-9960 gesture engine — STM32 HAL */

#include "stm32f4xx_hal.h"

#define APDS9960_ADDR        (0x39 << 1)

/* Key registers */
#define APDS_ENABLE          0x80
#define APDS_GPENTH          0xA0  /* Gesture proximity entry threshold */
#define APDS_GEXTH           0xA1  /* Gesture exit threshold */
#define APDS_GCONF1          0xA2  /* Gesture config 1 */
#define APDS_GCONF2          0xA3  /* Gesture config 2 (gain, LED drive) */
#define APDS_GOFFSET_U       0xA4
#define APDS_GOFFSET_D       0xA5
#define APDS_GOFFSET_L       0xA7
#define APDS_GOFFSET_R       0xA9
#define APDS_GPULSE          0xA6  /* Gesture pulse count and length */
#define APDS_GCONF4          0xAB  /* Gesture config 4 (int enable, mode) */
#define APDS_GFLVL           0xAE  /* Gesture FIFO level */
#define APDS_GSTATUS         0xAF  /* Gesture status */
#define APDS_GFIFO_U         0xFC  /* Gesture FIFO data (U/D/L/R) */

typedef enum {
    GESTURE_NONE  = 0,
    GESTURE_UP    = 1,
    GESTURE_DOWN  = 2,
    GESTURE_LEFT  = 3,
    GESTURE_RIGHT = 4,
} gesture_t;

static I2C_HandleTypeDef *hi2c;

static void apds_write(uint8_t reg, uint8_t val)
{
    uint8_t buf[2] = { reg, val };
    HAL_I2C_Master_Transmit(hi2c, APDS9960_ADDR, buf, 2, 100);
}

static uint8_t apds_read(uint8_t reg)
{
    uint8_t val;
    HAL_I2C_Master_Transmit(hi2c, APDS9960_ADDR, &reg, 1, 100);
    HAL_I2C_Master_Receive(hi2c, APDS9960_ADDR, &val, 1, 100);
    return val;
}

void apds9960_gesture_init(I2C_HandleTypeDef *i2c_handle)
{
    hi2c = i2c_handle;

    /* Disable everything during configuration */
    apds_write(APDS_ENABLE, 0x00);
    HAL_Delay(10);

    /* Gesture proximity thresholds */
    apds_write(APDS_GPENTH, 40);   /* Enter gesture mode when prox > 40 */
    apds_write(APDS_GEXTH, 30);    /* Exit gesture mode when prox < 30 */

    /* Gesture config 1: FIFO threshold = 4 datasets, exit mask = none */
    apds_write(APDS_GCONF1, 0x40);

    /* Gesture config 2: gain = 4×, LED drive = 100mA, wait time = 0 */
    apds_write(APDS_GCONF2, 0x49);

    /* Gesture pulse: 9 pulses, 16µs pulse length */
    apds_write(APDS_GPULSE, 0x89);

    /* Gesture direction offsets (calibrate per-unit for crosstalk) */
    apds_write(APDS_GOFFSET_U, 0);
    apds_write(APDS_GOFFSET_D, 0);
    apds_write(APDS_GOFFSET_L, 0);
    apds_write(APDS_GOFFSET_R, 0);

    /* Enable gesture engine + proximity + power on */
    /* ENABLE: GEN=1, PEN=1, PON=1 */
    apds_write(APDS_GCONF4, 0x02);  /* GIEN = 1 (gesture interrupt enable) */
    apds_write(APDS_ENABLE, 0x45);   /* GEN | PEN | PON */
}

/**
 * Read gesture FIFO and decode direction.
 * The FIFO contains 4-byte entries: [U, D, L, R].
 * Direction is determined by analyzing the temporal pattern
 * of (U-D) and (L-R) differentials.
 */
gesture_t apds9960_read_gesture(void)
{
    uint8_t fifo_level = apds_read(APDS_GFLVL);
    if (fifo_level == 0) return GESTURE_NONE;

    int16_t ud_first = 0, ud_last = 0;
    int16_t lr_first = 0, lr_last = 0;
    int valid_count = 0;

    for (int i = 0; i < fifo_level; i++) {
        uint8_t data[4];
        uint8_t reg = APDS_GFIFO_U;
        HAL_I2C_Master_Transmit(hi2c, APDS9960_ADDR, &reg, 1, 100);
        HAL_I2C_Master_Receive(hi2c, APDS9960_ADDR, data, 4, 100);

        /* Skip entries where all channels are below noise threshold */
        if (data[0] < 10 && data[1] < 10 && data[2] < 10 && data[3] < 10)
            continue;

        int16_t ud = (int16_t)data[0] - (int16_t)data[1];  /* Up - Down */
        int16_t lr = (int16_t)data[2] - (int16_t)data[3];  /* Left - Right */

        if (valid_count == 0) {
            ud_first = ud;
            lr_first = lr;
        }
        ud_last = ud;
        lr_last = lr;
        valid_count++;
    }

    if (valid_count < 4) return GESTURE_NONE;  /* Too few samples */

    int16_t ud_delta = ud_last - ud_first;
    int16_t lr_delta = lr_last - lr_first;

    /* Determine dominant axis */
    if (abs(ud_delta) > abs(lr_delta)) {
        if (abs(ud_delta) > 20) {
            return (ud_delta > 0) ? GESTURE_UP : GESTURE_DOWN;
        }
    } else {
        if (abs(lr_delta) > 20) {
            return (lr_delta > 0) ? GESTURE_LEFT : GESTURE_RIGHT;
        }
    }

    return GESTURE_NONE;
}
```

## IR Proximity Sensor Comparison

| Feature | VCNL4040 | APDS-9960 | VL6180X | TMD2772 |
|---|---|---|---|---|
| Sensing method | IR reflective | IR reflective | Time-of-Flight | IR reflective |
| Proximity range | ~200mm | ~100mm (gesture ~300mm) | 0–100mm (calibrated distance) | ~100mm |
| Proximity resolution | 16-bit | 8-bit | 1mm (actual distance) | 10-bit |
| Extra functions | ALS | Gesture, RGB, ALS | ALS | ALS |
| Gesture detection | No | Yes (U/D/L/R) | No | No |
| IR LED current | 50–200mA | 12.5–100mA | Internal VCSEL | 25–200mA |
| Interface | I2C (0x60) | I2C (0x39) | I2C (0x29) | I2C (0x39) |
| Supply voltage | 2.5–3.6V | 2.4–3.6V | 2.6–3.3V | 2.0–3.6V |
| Typical cost | $1.50 | $3.50 | $3.00 | $2.00 |
| Notes | Best general-purpose | Feature-rich combo | True distance, not intensity | Legacy part |

## Sunlight Cancellation

Strong ambient sunlight contains significant IR energy that can overwhelm the reflected LED signal. Sensors like the VCNL4040 include active sunlight cancellation circuitry that subtracts the ambient IR component before the proximity ADC conversion. Enabling this feature (PS_SC_EN bit in PS_CONF3) is essential for outdoor applications — without it, proximity detection range shrinks dramatically in direct sunlight and the sensor may report false object presence.

## Tips

- Always calibrate crosstalk cancellation after final mechanical assembly — the enclosure, lens cover, and any aperture surrounding the sensor contribute reflections that vary from design to design
- Set the IR LED current to the minimum that provides reliable detection at the required range — higher LED current increases power consumption proportionally and can cause optical crosstalk in adjacent sensors
- Use interrupt-driven proximity with hysteresis (separate high/low thresholds) rather than polling — this reduces I2C bus traffic and MCU wake-ups in battery-powered applications
- For gesture detection with the APDS-9960, ensure the sensor aperture allows at least a 120-degree field of view — a recessed sensor in a deep enclosure limits the gesture detection cone and produces unreliable results
- Apply a software debounce (100–200ms holdoff after each gesture event) to prevent a single slow hand movement from registering as multiple gestures

## Caveats

- **Proximity readings are not calibrated distances** — A reading of "200 counts" has no fixed relationship to millimeters; the value depends on target reflectivity, color, and size. Black surfaces may be undetectable beyond 20mm while white surfaces register at 100mm+
- **APDS-9960 gesture detection is orientation-sensitive** — The U/D/L/R photodiode layout has a fixed mapping to physical directions; rotating the sensor 90 degrees on the PCB swaps the UP/DOWN and LEFT/RIGHT axes
- **Direct sunlight can saturate the proximity photodiode** — Even with sunlight cancellation enabled, direct sun incident on the sensor at normal angles can push the receiver into saturation, producing either constant maximum or unpredictable proximity readings
- **IR LED emitter degradation** — The integrated IR LED loses optical power over time (typically 10–20% over 10,000 hours at maximum current); this gradually reduces detection range without any obvious firmware error indication
- **Cover glass material matters** — The glass or plastic window over the sensor must be transparent at the IR LED wavelength (940nm). Dark-tinted or UV-coated glasses that appear opaque to the eye may also block IR, killing proximity detection entirely

## In Practice

- A proximity sensor that works on the bench but fails in the final product enclosure almost always has a crosstalk problem — the IR LED light is bouncing off the inside of the enclosure directly into the receiver; adding an optical barrier (opaque wall between LED and receiver apertures) and recalibrating crosstalk cancellation resolves this
- The APDS-9960 gesture engine that recognizes left/right swipes reliably but misses up/down gestures is typically a field-of-view problem — the sensor's vertical viewing angle is obstructed by the enclosure or cover glass edges
- A VCNL4040 that suddenly reports maximum proximity count (65535) and stays there has likely lost I2C communication — checking the I2C bus with a logic analyzer usually reveals that SDA is held low by the sensor, requiring a bus recovery sequence (9 clock pulses on SCL)
- Proximity sensors that work indoors but produce erratic readings outdoors are experiencing ambient IR saturation — reducing the integration time, enabling sunlight cancellation, and increasing the IR LED pulse current helps, but extreme direct sunlight conditions may still exceed the sensor's cancellation capability
