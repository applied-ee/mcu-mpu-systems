---
title: "Time-of-Flight & LIDAR Ranging"
weight: 30
---

# Time-of-Flight & LIDAR Ranging

Time-of-Flight (ToF) sensors measure distance by timing the round-trip of emitted light — either a modulated IR signal (phase-detection ToF) or a laser pulse (direct ToF / LIDAR). The ST VL53L0X and VL53L1X are the most widely used phase-detection ToF sensors in embedded projects, communicating over I2C and providing millimeter-resolution ranging in a tiny package. For longer ranges (2-12 meters), single-point LIDAR modules like the Benewake TFmini and TF-Luna use direct time-of-flight with a pulsed laser. Both classes of sensor offload all the optical signal processing internally — the MCU simply requests a measurement and reads back a distance value.

## SPAD Array Architecture

The VL53L0X and VL53L1X use a SPAD (Single-Photon Avalanche Diode) array as their detector. Each SPAD is a photodiode biased above its breakdown voltage, producing a large current pulse from a single detected photon. The sensor's internal histogram processor counts photon arrivals across time bins and fits the return signal to determine distance.

The SPAD array in the VL53L1X is a 16x16 grid (256 SPADs), from which a subset is selected as the active Region of Interest (ROI). Reducing the ROI narrows the sensor's field of view — useful for avoiding cross-talk from adjacent surfaces or for targeting a specific area within the sensor's native 27-degree FoV.

## VL53L1X I2C Integration

The VL53L1X communicates over I2C at a default address of 0x29 (7-bit). The ST Ultra-Lite Driver (ULD) provides a thin API layer that abstracts the roughly 80 register transactions needed for initialization and measurement. The ULD is provided as a set of C source files (~10 files) that compile into any MCU project.

### VL53L1X Initialization and Single-Shot Ranging

```c
#include "VL53L1X_api.h"

#define VL53L1X_I2C_ADDR  0x52  /* 8-bit address (0x29 << 1) */

static I2C_HandleTypeDef *hi2c;

int tof_init(I2C_HandleTypeDef *i2c_handle) {
    hi2c = i2c_handle;
    uint8_t  boot_state = 0;
    uint16_t sensor_id  = 0;
    int status;

    /* Wait for device to boot (XSHUT must be high) */
    while (boot_state == 0) {
        status = VL53L1X_BootState(VL53L1X_I2C_ADDR, &boot_state);
        if (status != 0) return status;
        HAL_Delay(2);
    }

    /* Verify sensor ID */
    VL53L1X_GetSensorId(VL53L1X_I2C_ADDR, &sensor_id);
    if (sensor_id != 0xEACC) {
        return -1;  /* Wrong sensor or I2C issue */
    }

    /* Initialize with default configuration */
    status = VL53L1X_SensorInit(VL53L1X_I2C_ADDR);
    if (status != 0) return status;

    /* Configure for long-range mode (up to 4 m) */
    VL53L1X_SetDistanceMode(VL53L1X_I2C_ADDR, 2);  /* 1=Short, 2=Long */

    /* Set timing budget: 50 ms (range: 20-1000 ms) */
    VL53L1X_SetTimingBudgetInMs(VL53L1X_I2C_ADDR, 50);

    /* Inter-measurement period must be >= timing budget */
    VL53L1X_SetInterMeasurementInMs(VL53L1X_I2C_ADDR, 55);

    return 0;
}

/* Perform a single measurement, return distance in mm */
int tof_read_distance_mm(uint16_t *distance_mm) {
    uint8_t  data_ready = 0;
    uint8_t  range_status;
    int      status;

    /* Start a single ranging measurement */
    status = VL53L1X_StartRanging(VL53L1X_I2C_ADDR);
    if (status != 0) return status;

    /* Poll for data ready (or use GPIO1 interrupt) */
    while (data_ready == 0) {
        VL53L1X_CheckForDataReady(VL53L1X_I2C_ADDR, &data_ready);
        HAL_Delay(1);
    }

    /* Read range status and distance */
    VL53L1X_GetRangeStatus(VL53L1X_I2C_ADDR, &range_status);
    VL53L1X_GetDistance(VL53L1X_I2C_ADDR, distance_mm);

    /* Clear interrupt to allow next measurement */
    VL53L1X_ClearInterrupt(VL53L1X_I2C_ADDR);
    VL53L1X_StopRanging(VL53L1X_I2C_ADDR);

    /* range_status: 0=valid, 1=sigma fail, 2=signal fail,
       4=out of bounds, 7=wraparound */
    if (range_status != 0) {
        return -2;  /* Measurement not reliable */
    }

    return 0;
}
```

The range status field is critical — a return of 0 indicates a valid measurement, while status 2 (signal fail) means insufficient reflected photons (target too far or too dark), and status 7 (wraparound) indicates phase ambiguity at extreme range. Ignoring range status leads to phantom distance readings.

## Ranging Modes and Timing Budget

The VL53L1X supports two distance modes and a configurable timing budget that trades measurement speed for accuracy:

| Distance Mode | Max Range | Ambient Light Immunity | Best For |
|---------------|-----------|----------------------|----------|
| Short (mode 1) | 1.3 m | Better | Indoor close-range |
| Long (mode 2) | 4.0 m | Lower | General purpose |

| Timing Budget | Repeatability (σ) at 1.2 m | Notes |
|---------------|---------------------------|-------|
| 20 ms | ~25 mm | Minimum, noisiest |
| 50 ms | ~10 mm | Good balance |
| 100 ms | ~6 mm | Low noise |
| 200 ms | ~4 mm | Very stable |
| 500 ms | ~3 mm | Near-limit precision |

The timing budget controls how long the SPAD array integrates photons — longer integration captures more signal photons relative to ambient noise, improving accuracy. The inter-measurement period sets the interval between consecutive ranging cycles in continuous mode and must be greater than or equal to the timing budget.

## ROI Configuration

The VL53L1X allows selecting a rectangular sub-region of its 16x16 SPAD array as the active ROI. The ROI is defined by its center coordinates and minimum size of 4x4 SPADs.

```c
/* Set a narrow ROI centered on the array */
/* ROI center: (8, 8) = center of 16x16 array */
/* ROI size: 4x4 = narrowest FoV (~15 degrees) */
VL53L1X_SetROI(VL53L1X_I2C_ADDR, 4, 4);        /* Width, Height */
VL53L1X_SetROICenter(VL53L1X_I2C_ADDR, 199);    /* Center SPAD number */
```

Narrowing the ROI is useful when measuring through an aperture, avoiding cross-talk from nearby walls, or when the target is small relative to the sensor's native field of view. The trade-off is reduced signal — fewer SPADs means fewer collected photons, reducing maximum range.

## Multi-Zone Sensing: VL53L5CX

The VL53L5CX extends the ToF concept to a full 8x8 zone grid (64 zones), each reporting independent distance and signal strength data. This creates a low-resolution depth map suitable for gesture detection, obstacle avoidance, and simple object tracking.

Each zone has its own distance, signal rate, and status, read in a single I2C burst transfer of approximately 800 bytes per frame. Update rates reach 15 Hz at 8x8 resolution and 60 Hz at 4x4 resolution (16 zones).

The integration of the VL53L5CX follows the same ULD driver pattern as the VL53L1X but with substantially more data per frame. Processing 64 distance values per frame at 15 Hz requires efficient data handling — DMA-based I2C and frame-buffer double-buffering are typical patterns.

## Single-Point LIDAR Modules (TFmini, TF-Luna)

For ranges beyond 4 meters, single-point LIDAR modules use a pulsed laser (905 nm) and direct time-of-flight measurement. These modules are self-contained — they include the laser, optics, detector, and signal processing, outputting distance over UART or I2C.

### TFmini Plus / TF-Luna Comparison

| Feature | TFmini Plus | TF-Luna | VL53L1X (for reference) |
|---------|-------------|---------|------------------------|
| Range | 0.1-12 m | 0.2-8 m | 0.04-4 m |
| Resolution | 1 cm | 1 cm | 1 mm |
| Accuracy | ±1% (typical) | ±2% (typical) | ±3% or ±3 mm |
| Update rate | 1-1000 Hz | 1-250 Hz | Up to 50 Hz |
| Interface | UART (115200), I2C | UART (115200), I2C | I2C |
| Wavelength | 905 nm | 905 nm | 940 nm (VCSEL) |
| Power | 110 mA average | 70 mA average | 20 mA ranging |
| Size | 42×15×16 mm | 35×21×13.5 mm | 4.9×2.5×1.56 mm |
| Price | $25-35 | $15-25 | $3-5 |

### TFmini UART Frame Parsing

The TFmini Plus outputs a 9-byte data frame at 115200 baud:

```c
/* TFmini Plus UART frame format:
 * Byte 0: 0x59 (header)
 * Byte 1: 0x59 (header)
 * Byte 2: Distance low byte (cm)
 * Byte 3: Distance high byte (cm)
 * Byte 4: Signal strength low byte
 * Byte 5: Signal strength high byte
 * Byte 6: Temperature low byte (°C / 8 + 25 encoded)
 * Byte 7: Temperature high byte
 * Byte 8: Checksum (low byte of sum of bytes 0-7)
 */

typedef struct {
    uint16_t distance_cm;
    uint16_t signal_strength;
    float    temperature_c;
    uint8_t  valid;
} tfmini_data_t;

/* Ring buffer fed by UART DMA or interrupt */
#define TFMINI_BUF_SIZE 64
static uint8_t rx_buf[TFMINI_BUF_SIZE];
static uint16_t rx_head = 0;

int tfmini_parse_frame(const uint8_t *buf, uint16_t len, tfmini_data_t *data) {
    /* Search for frame header 0x59 0x59 */
    for (uint16_t i = 0; i + 8 < len; i++) {
        if (buf[i] != 0x59 || buf[i + 1] != 0x59) {
            continue;
        }

        /* Verify checksum */
        uint8_t checksum = 0;
        for (int j = 0; j < 8; j++) {
            checksum += buf[i + j];
        }
        if (checksum != buf[i + 8]) {
            continue;  /* Checksum mismatch, try next position */
        }

        /* Extract distance (cm) */
        data->distance_cm = buf[i + 2] | (buf[i + 3] << 8);

        /* Extract signal strength */
        data->signal_strength = buf[i + 4] | (buf[i + 5] << 8);

        /* Extract temperature */
        uint16_t temp_raw = buf[i + 6] | (buf[i + 7] << 8);
        data->temperature_c = (float)temp_raw / 8.0f - 256.0f;

        /* Signal strength < 100 indicates unreliable reading */
        data->valid = (data->signal_strength >= 100) ? 1 : 0;

        return 0;  /* Success */
    }
    return -1;  /* No valid frame found */
}
```

The TFmini reports a signal strength value that directly indicates measurement confidence. Values below 100 indicate weak returns (target too far, too dark, or at extreme angles). Values of 0 or 65535 for distance indicate out-of-range or error conditions.

## Ambient Light Rejection

ToF sensors must distinguish their own reflected light from ambient illumination. The VL53L0X/L1X uses a 940 nm VCSEL (Vertical Cavity Surface-Emitting Laser) and a bandpass filter over the SPAD array to reject most ambient light. However, direct sunlight contains significant 940 nm energy and can saturate the detector.

Typical ambient light immunity:

| Condition | VL53L1X Long Mode | TFmini Plus |
|-----------|-------------------|-------------|
| Indoor fluorescent | Full range | Full range |
| Cloudy outdoor | 80% of max range | Full range |
| Direct sunlight | 50% of max range | 70% of max range |
| Direct sunlight on target | 30% of max range | 50% of max range |

The TFmini and TF-Luna use 905 nm lasers with higher peak power (tens of watts pulsed), giving them better ambient rejection at longer ranges. The VL53L1X's VCSEL operates at milliwatt levels, which limits its performance in bright sunlight.

## ToF Sensor Comparison

| Feature | VL53L0X | VL53L1X | VL53L5CX | TFmini Plus |
|---------|---------|---------|----------|-------------|
| Range | 2 m | 4 m | 4 m | 12 m |
| Resolution | 1 mm | 1 mm | 1 mm per zone | 1 cm |
| Zones | 1 | 1 | 8×8 (64) | 1 |
| FoV | 25° | 27° | 63° (total) | 3.6° |
| Interface | I2C | I2C | I2C (SPI) | UART, I2C |
| Update rate | 50 Hz | 50 Hz | 15 Hz (8×8) | 1000 Hz |
| Supply voltage | 2.6-3.5 V | 2.6-3.5 V | 2.6-3.5 V | 5 V |
| Package | LGA 4.4×2.4 mm | LGA 4.9×2.5 mm | LGA 6.4×3.0 mm | Module 42×15 mm |
| I2C address | 0x29 | 0x29 | 0x29 | 0x10 |
| Typical price | $2-4 | $3-5 | $8-12 | $25-35 |

All ST VL53Lxx sensors share the same default I2C address (0x29). When using multiple sensors on the same bus, each sensor's XSHUT pin must be used to bring sensors online one at a time, assigning a unique address to each via software before enabling the next.

## Multiple Sensors on One Bus

```c
/* Multi-sensor address assignment using XSHUT pins */
#define SENSOR_COUNT  3
#define BASE_ADDR     0x52  /* 8-bit: 0x29 << 1 */

static GPIO_TypeDef *xshut_port[SENSOR_COUNT] = {GPIOB, GPIOB, GPIOB};
static uint16_t      xshut_pin[SENSOR_COUNT]  = {GPIO_PIN_0, GPIO_PIN_1, GPIO_PIN_2};
static uint16_t      sensor_addr[SENSOR_COUNT];

void tof_multi_init(void) {
    /* Hold all sensors in reset */
    for (int i = 0; i < SENSOR_COUNT; i++) {
        HAL_GPIO_WritePin(xshut_port[i], xshut_pin[i], GPIO_PIN_RESET);
    }
    HAL_Delay(10);

    /* Bring each sensor online and assign unique address */
    for (int i = 0; i < SENSOR_COUNT; i++) {
        HAL_GPIO_WritePin(xshut_port[i], xshut_pin[i], GPIO_PIN_SET);
        HAL_Delay(5);  /* Boot time */

        sensor_addr[i] = BASE_ADDR + (i * 2);  /* 0x52, 0x54, 0x56 */
        VL53L1X_SetI2CAddress(BASE_ADDR, sensor_addr[i]);

        /* Initialize this sensor */
        VL53L1X_SensorInit(sensor_addr[i]);
        VL53L1X_SetDistanceMode(sensor_addr[i], 2);
        VL53L1X_SetTimingBudgetInMs(sensor_addr[i], 33);
        VL53L1X_SetInterMeasurementInMs(sensor_addr[i], 36);
    }
}
```

## Tips

- Use the GPIO1 interrupt output instead of polling `CheckForDataReady` — the VL53L1X drives GPIO1 low when data is ready, allowing the MCU to sleep between measurements and react immediately when a new reading is available
- Set the timing budget based on the application, not on the maximum update rate — a 20 ms budget at 50 Hz produces noisy data that requires heavy filtering, while a 100 ms budget at 10 Hz gives cleaner readings with less post-processing
- When using multiple VL53Lxx sensors, stagger their measurement start times to avoid optical cross-talk — simultaneous measurements from adjacent sensors can corrupt each other's returns
- For the TFmini/TF-Luna, use UART with DMA into a ring buffer and scan for the 0x59 0x59 header — the continuous output mode produces frames back-to-back with no explicit framing beyond the header bytes
- Cover the VL53Lxx sensor with a protective window that transmits 940 nm — standard glass or polycarbonate may attenuate the signal. IR-transparent materials (certain grades of polycarbonate, PMMA) or a small aperture with no cover are the safe options

## Caveats

- **Glass and transparent surfaces are invisible to ToF sensors** — The 940 nm VCSEL light passes through glass, producing either no return (reading = max range) or a return from whatever is behind the glass. Window detection in ToF is an unsolved problem for most applications
- **Surface reflectivity affects range** — A white target at 4 meters returns to the VL53L1X reliably, but a black target at the same distance may produce a signal-fail status. Datasheet range specifications assume a white (88% reflectance) target
- **Crosstalk from cover glass** — Mounting the VL53Lxx behind a cover window introduces internal reflections that add a constant offset to all readings. ST provides crosstalk calibration routines in the ULD that must be run with the actual cover glass installed
- **TFmini reports incorrect distance at very close range** — Below 0.1 m (TFmini Plus) or 0.2 m (TF-Luna), the return signal saturates the detector, producing either a stuck reading or an erroneously large value. The dead zone cannot be reduced
- **Phase-detection ToF has range ambiguity** — The VL53L1X uses modulated light with a finite unambiguous range. Targets beyond the maximum specified range can produce wraparound errors, reporting a short distance when the actual distance is beyond the maximum. The range status byte reports this as status 7

## In Practice

- A VL53L1X reading that fluctuates between two values approximately 20 mm apart is operating near the edge of its repeatability at the current timing budget — increasing the timing budget from 20 ms to 50 ms typically stabilizes the reading
- A TFmini that reports signal strength of 0 or very low values despite a close target usually has a contaminated optical window — dust, condensation, or fingerprints on the lens aperture attenuate both the outgoing laser and the return signal
- Multiple VL53L1X sensors on the same I2C bus that all return identical readings despite pointing in different directions were not properly address-reassigned during initialization — the XSHUT sequence must bring sensors online one at a time, and the I2C address change must be confirmed before releasing the next XSHUT
- A ToF sensor mounted behind a glass panel that reads consistently 50-100 mm short of the actual target distance is exhibiting crosstalk from internal reflections in the cover glass — running the ST crosstalk calibration routine removes this offset
- Distance readings that are accurate indoors but become wildly unstable outdoors indicate ambient light saturation — the signal-to-noise ratio collapses under direct sunlight, and switching to short-range mode or increasing the timing budget partially compensates
