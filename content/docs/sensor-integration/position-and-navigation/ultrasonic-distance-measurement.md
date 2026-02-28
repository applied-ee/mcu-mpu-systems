---
title: "Ultrasonic Distance Measurement"
weight: 40
---

# Ultrasonic Distance Measurement

Ultrasonic distance sensors measure the round-trip time of a burst of sound pulses to determine the distance to a reflective surface. The HC-SR04 is the ubiquitous ultrasonic ranging module in embedded projects — inexpensive (~$1-2), simple to interface (two GPIO pins), and effective over a 2 cm to 400 cm range. The sensor emits an 8-cycle burst of 38 kHz ultrasound from one transducer and listens for the echo on a paired receiver transducer. The module handles all the analog signal processing internally, presenting the MCU with a single digital echo pulse whose width is proportional to distance. More capable variants like the JSN-SR04T provide waterproof operation for outdoor and liquid-level sensing applications.

## Operating Principle

The measurement cycle follows a fixed sequence:

1. The MCU drives the TRIG pin high for at least 10 µs, then low
2. The module emits 8 pulses of 38 kHz ultrasound from the transmitter
3. The module drives the ECHO pin high immediately after the burst
4. The ECHO pin goes low when the first reflected signal is detected
5. The MCU measures the ECHO pulse width — this is the round-trip time

The distance is calculated from the echo duration and the speed of sound:

```
distance = (echo_time_us × speed_of_sound_m_s) / 2,000,000
```

The division by 2 accounts for the round-trip (sound travels to the target and back). At 20°C, the speed of sound is approximately 343.2 m/s, giving:

```
distance_cm = echo_time_us / 58.2
```

This constant (58.2 µs/cm) is valid only at ~20°C. Temperature variations shift the speed of sound and introduce measurement error if uncompensated.

## Speed of Sound Temperature Compensation

The speed of sound in air varies with temperature according to:

```
v = 331.3 + 0.606 × T   (m/s, where T is in °C)
```

| Temperature (°C) | Speed of Sound (m/s) | µs per cm (round-trip) |
|-------------------|---------------------|----------------------|
| 0 | 331.3 | 60.4 |
| 10 | 337.4 | 59.3 |
| 20 | 343.5 | 58.2 |
| 30 | 349.5 | 57.2 |
| 40 | 355.6 | 56.2 |

Over a 0-40°C range, the speed of sound changes by ~7%, which translates directly to a 7% distance error if temperature is not accounted for. At a target distance of 200 cm, this represents a 14 cm error — significant for many applications.

### Temperature-Compensated Distance Calculation

```c
#include <stdint.h>

/* Calculate distance in mm from echo pulse duration and temperature */
int32_t ultrasonic_distance_mm(uint32_t echo_duration_us, float temperature_c) {
    /* Speed of sound: v = 331.3 + 0.606 * T (m/s) */
    float speed_mps = 331.3f + 0.606f * temperature_c;

    /* distance = (time * speed) / 2 */
    /* Convert: us -> seconds (/1e6), m -> mm (*1000) */
    /* Simplifies to: distance_mm = echo_us * speed_mps / 2000 */
    float distance_mm = (float)echo_duration_us * speed_mps / 2000.0f;

    return (int32_t)(distance_mm + 0.5f);  /* Round to nearest mm */
}
```

For applications that do not have a temperature sensor, using the constant 343 m/s (20°C assumption) is acceptable if the operating environment stays between 15-25°C, keeping the error below 1.5%.

## Range Limits and Blanking Distance

| Parameter | HC-SR04 | JSN-SR04T |
|-----------|---------|-----------|
| Minimum range | ~2 cm | ~20 cm |
| Maximum range | ~400 cm | ~600 cm |
| Maximum echo time | ~23.2 ms (400 cm) | ~34.9 ms (600 cm) |
| Transducer frequency | 38 kHz | 40 kHz |
| Beam angle | ~15° cone | ~45-75° cone |
| Supply voltage | 5 V | 5 V (3.3V tolerant echo on some models) |
| Trigger pulse | ≥ 10 µs | ≥ 10 µs |

The minimum range (blanking distance) exists because the receiver cannot distinguish the emitted burst from a near-field echo. The transmitter ring-down takes approximately 300-500 µs to decay below the receiver threshold, setting the minimum detectable echo at roughly 2 cm for the HC-SR04. The JSN-SR04T's single shared transducer (used for both transmit and receive) has a longer ring-down, pushing its minimum range to ~20 cm.

If no echo is received within ~38 ms, the HC-SR04 times out and drops the ECHO pin low. This 38 ms timeout corresponds to roughly 650 cm round-trip — beyond the sensor's reliable range. A timeout echo should be treated as "no target detected" rather than a maximum-distance reading.

## Interrupt-Based Echo Timing with Input Capture

Polling-based measurement (spinning in a loop waiting for the ECHO pin to go low) blocks the MCU for up to 38 ms per measurement — unacceptable in most applications. The proper approach uses a timer input capture to timestamp both the rising and falling edges of the ECHO pulse.

### STM32 Timer Input Capture Implementation

```c
/* HC-SR04 measurement using TIM2 input capture on PA0 (TIM2_CH1) */
/* TRIG connected to PB0 (GPIO output) */
/* ECHO connected to PA0 (TIM2_CH1 input capture) */
/* Note: HC-SR04 requires 5V supply; ECHO is 5V logic.            */
/* Use a voltage divider (1k + 2k) on ECHO for 3.3V MCU inputs.   */

#include "stm32f4xx_hal.h"

static TIM_HandleTypeDef htim2;
static volatile uint32_t echo_rising  = 0;
static volatile uint32_t echo_falling = 0;
static volatile uint8_t  echo_done    = 0;
static volatile uint8_t  capture_edge = 0;  /* 0 = waiting rising, 1 = waiting falling */

void ultrasonic_timer_init(void) {
    __HAL_RCC_TIM2_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();

    /* Configure TRIG pin (PB0) as GPIO output */
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin   = GPIO_PIN_0;
    gpio.Mode  = GPIO_MODE_OUTPUT_PP;
    gpio.Pull  = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOB, &gpio);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);

    /* Configure ECHO pin (PA0) as TIM2_CH1 alternate function */
    gpio.Pin       = GPIO_PIN_0;
    gpio.Mode      = GPIO_MODE_AF_PP;
    gpio.Pull      = GPIO_NOPULL;
    gpio.Speed     = GPIO_SPEED_FREQ_HIGH;
    gpio.Alternate = GPIO_AF1_TIM2;
    HAL_GPIO_Init(GPIOA, &gpio);

    /* Configure TIM2 for input capture with 1 µs resolution */
    htim2.Instance               = TIM2;
    htim2.Init.Prescaler         = (HAL_RCC_GetPCLK1Freq() * 2 / 1000000) - 1;
    htim2.Init.CounterMode       = TIM_COUNTERMODE_UP;
    htim2.Init.Period            = 0xFFFFFFFF;  /* 32-bit free-running */
    htim2.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
    htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
    HAL_TIM_IC_Init(&htim2);

    /* Configure Channel 1 for rising edge capture initially */
    TIM_IC_InitTypeDef ic_config = {0};
    ic_config.ICPolarity  = TIM_ICPOLARITY_RISING;
    ic_config.ICSelection = TIM_ICSELECTION_DIRECTTI;
    ic_config.ICPrescaler = TIM_ICPSC_DIV1;
    ic_config.ICFilter    = 0x04;  /* Light filtering for noise rejection */
    HAL_TIM_IC_ConfigChannel(&htim2, &ic_config, TIM_CHANNEL_1);

    /* Enable TIM2 CH1 interrupt */
    HAL_NVIC_SetPriority(TIM2_IRQn, 2, 0);
    HAL_NVIC_EnableIRQ(TIM2_IRQn);

    HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1);
}

void TIM2_IRQHandler(void) {
    HAL_TIM_IRQHandler(&htim2);
}

void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance != TIM2 || htim->Channel != HAL_TIM_ACTIVE_CHANNEL_1) {
        return;
    }

    if (capture_edge == 0) {
        /* Rising edge: echo pulse started */
        echo_rising = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);
        capture_edge = 1;

        /* Reconfigure for falling edge */
        __HAL_TIM_SET_CAPTUREPOLARITY(htim, TIM_CHANNEL_1,
                                       TIM_INPUTCHANNELPOLARITY_FALLING);
    } else {
        /* Falling edge: echo pulse ended */
        echo_falling = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);
        capture_edge = 0;
        echo_done = 1;

        /* Reconfigure for rising edge (next measurement) */
        __HAL_TIM_SET_CAPTUREPOLARITY(htim, TIM_CHANNEL_1,
                                       TIM_INPUTCHANNELPOLARITY_RISING);
    }
}

/* Trigger a measurement and return echo duration in µs */
/* Returns 0 if timeout (no echo within ~60 ms) */
uint32_t ultrasonic_measure_us(void) {
    echo_done    = 0;
    capture_edge = 0;

    /* Ensure rising edge capture is configured */
    __HAL_TIM_SET_CAPTUREPOLARITY(&htim2, TIM_CHANNEL_1,
                                   TIM_INPUTCHANNELPOLARITY_RISING);

    /* Generate 10 µs trigger pulse */
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_SET);
    /* Busy-wait ~10 µs (DWT cycle counter or timer-based delay) */
    uint32_t start = DWT->CYCCNT;
    while ((DWT->CYCCNT - start) < (SystemCoreClock / 100000)) {}
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0, GPIO_PIN_RESET);

    /* Wait for echo measurement to complete */
    uint32_t timeout = HAL_GetTick() + 60;  /* 60 ms timeout */
    while (!echo_done && HAL_GetTick() < timeout) {
        /* Could yield to RTOS scheduler here */
    }

    if (!echo_done) {
        return 0;  /* Timeout: no target in range */
    }

    /* Calculate pulse width in µs (timer runs at 1 MHz) */
    uint32_t duration = echo_falling - echo_rising;
    return duration;
}

/* Complete measurement: trigger, capture, compute distance */
int32_t ultrasonic_read_mm(float temperature_c) {
    uint32_t echo_us = ultrasonic_measure_us();
    if (echo_us == 0 || echo_us > 25000) {
        return -1;  /* No echo or out of range */
    }
    return ultrasonic_distance_mm(echo_us, temperature_c);
}
```

The timer prescaler is set to produce 1 µs ticks, giving 1 µs resolution on the echo measurement. With a 32-bit timer, this allows measurement up to ~4295 seconds before overflow — far beyond the 38 ms echo timeout. The DWT cycle counter provides a precise 10 µs trigger pulse without consuming a second timer.

## Voltage Level Considerations

The HC-SR04 operates on 5V and its ECHO output swings to 5V, which exceeds the 3.3V maximum for STM32 GPIO inputs. Two common solutions:

1. **Voltage divider**: A resistive divider (1 kΩ + 2 kΩ) on the ECHO line scales 5V down to 3.3V. The 3 kΩ total impedance is low enough that the timer input capacitance does not significantly affect edge timing
2. **Level shifter**: A bidirectional level shifter (BSS138-based or TXS0102) provides clean translation. Necessary for I2C-based ultrasonic modules but overkill for a simple ECHO line

The TRIG input accepts 3.3V logic on most HC-SR04 modules (the threshold is typically ~1.5V), so driving TRIG directly from a 3.3V GPIO works reliably. However, some clone modules have higher thresholds — if the trigger fails to produce a measurement, driving TRIG through a level shifter or from a 5V-tolerant open-drain output with a pull-up to 5V resolves the issue.

## Multiple Sensor Multiplexing

Running multiple HC-SR04 sensors simultaneously causes acoustic cross-talk — Sensor A's ultrasonic burst reflects off a surface and reaches Sensor B's receiver, producing a false reading. Two mitigation strategies:

### Sequential Triggering

Trigger each sensor in sequence, waiting for the echo to complete (or timeout) before triggering the next:

```c
#define SENSOR_COUNT  4

typedef struct {
    GPIO_TypeDef *trig_port;
    uint16_t      trig_pin;
    /* All sensors share one echo capture channel via multiplexer,
       or each gets a separate timer channel */
} ultrasonic_sensor_t;

static ultrasonic_sensor_t sensors[SENSOR_COUNT] = {
    {GPIOB, GPIO_PIN_0},
    {GPIOB, GPIO_PIN_1},
    {GPIOB, GPIO_PIN_2},
    {GPIOB, GPIO_PIN_3},
};

/* Round-robin measurement: ~60 ms per sensor worst case */
/* 4 sensors = ~240 ms full cycle = ~4 Hz update rate */
void ultrasonic_scan_all(int32_t *distances_mm, float temp_c) {
    for (int i = 0; i < SENSOR_COUNT; i++) {
        /* Trigger sensor i */
        HAL_GPIO_WritePin(sensors[i].trig_port, sensors[i].trig_pin,
                          GPIO_PIN_SET);
        /* 10 µs delay */
        uint32_t start = DWT->CYCCNT;
        while ((DWT->CYCCNT - start) < (SystemCoreClock / 100000)) {}
        HAL_GPIO_WritePin(sensors[i].trig_port, sensors[i].trig_pin,
                          GPIO_PIN_RESET);

        /* Wait for echo (implementation depends on per-sensor capture) */
        uint32_t echo_us = /* ... capture echo for sensor i ... */ 0;
        distances_mm[i] = ultrasonic_distance_mm(echo_us, temp_c);

        /* Wait minimum inter-measurement gap to avoid echo residue */
        HAL_Delay(60);
    }
}
```

Sequential triggering limits the update rate: with 4 sensors and a 60 ms cycle per sensor, the full scan takes 240 ms (~4 Hz). For faster updates, sensors pointing in sufficiently different directions (e.g., front and rear) can be triggered simultaneously without cross-talk risk, while adjacent sensors must remain sequential.

### Group Triggering

Sensors with non-overlapping acoustic coverage (pointing > 90° apart) can be triggered simultaneously:

```c
/* Trigger front and rear simultaneously, then left and right */
/* Group 1: Front (sensor 0) + Rear (sensor 2) */
/* Group 2: Left (sensor 1) + Right (sensor 3) */
/* Total cycle: 2 × 60 ms = 120 ms = ~8 Hz update rate */
```

## JSN-SR04T Waterproof Variant

The JSN-SR04T uses a single piezoelectric transducer in a sealed housing connected to the electronics board via a cable. The same transducer transmits and receives, which increases the blanking distance to ~20 cm but enables IP67-rated operation for outdoor installations, liquid level sensing, and industrial applications.

| Parameter | HC-SR04 | JSN-SR04T (Mode 1) |
|-----------|---------|---------------------|
| Min range | 2 cm | 20 cm |
| Max range | 400 cm | 600 cm |
| Beam angle | ~15° | ~45-75° |
| Waterproof | No | Yes (transducer only) |
| Interface | Trigger/Echo | Trigger/Echo (same protocol) |
| Supply | 5V, 15 mA | 5V, 30 mA |
| Operating temp | 0-60°C | -20 to 70°C |

The JSN-SR04T supports multiple operating modes selectable via a resistor on the board: Mode 1 (trigger/echo, same as HC-SR04), Mode 2 (continuous serial output), and Mode 3 (low-power trigger/serial). Mode 1 is the most common choice because existing HC-SR04 firmware works without modification.

## Beam Pattern and Target Geometry

The HC-SR04's 38 kHz ultrasonic beam has approximately a 15-degree half-angle cone. At 200 cm distance, this cone illuminates a circular area roughly 100 cm in diameter. The sensor reports the distance to the nearest reflective surface within this cone — not necessarily the surface directly in front of it.

Narrow cylindrical objects (pipes, posts) reflect poorly because the curved surface scatters the sound wave. Flat surfaces perpendicular to the beam axis produce the strongest echoes. Surfaces angled more than ~45° from perpendicular deflect the echo away from the receiver, causing detection failure.

Soft or porous materials (fabric, foam, acoustic panels) absorb ultrasound and produce weak or no echoes. Rough surfaces scatter the sound, reducing effective range. These characteristics make ultrasonic sensors poorly suited for detecting soft obstacles like people wearing thick clothing at maximum range.

## Tips

- Always include a minimum 60 ms delay between consecutive measurements on the same sensor — residual echoes from the previous measurement can produce false short-distance readings if the next burst is emitted too soon
- Add temperature compensation using a thermistor or digital temperature sensor (DS18B20, BME280) co-located with the ultrasonic sensor — the 7% speed-of-sound variation over a 0-40°C range translates directly to 7% distance error
- Use the timer input capture approach rather than polling — polling blocks the MCU for up to 38 ms per measurement and makes it impossible to handle other real-time tasks
- Apply a median filter (3 or 5 samples) to ultrasonic readings to reject spurious echoes — occasional phantom readings from multipath reflections or acoustic noise are common in cluttered environments
- Mount the sensor with the transducer face perpendicular to the measurement axis and clear of any obstructions within 5 cm — the transducer housing itself can cause near-field reflections that add noise

## Caveats

- **The blanking distance is a hard limit** — Objects closer than 2 cm (HC-SR04) or 20 cm (JSN-SR04T) produce no valid echo, and the sensor either returns zero or times out. There is no firmware workaround; the physics of transducer ring-down dictate the minimum range
- **Acoustic cross-talk between adjacent sensors is guaranteed** — Two HC-SR04 modules mounted 10 cm apart and triggered simultaneously will detect each other's echoes. Sequential triggering with adequate inter-measurement gaps is the only reliable mitigation
- **Soft or angled surfaces are invisible** — Fabric, foam, hair, and surfaces angled beyond ~45° from perpendicular absorb or deflect ultrasound, producing no detectable echo. The sensor reports "no target" (timeout) even when an obstacle is present
- **Humidity has minimal effect, but wind does** — Wind creates turbulence that bends the sound beam path, particularly outdoors at ranges above 2 meters. Indoor measurements are far more stable than outdoor ones for this reason
- **The ECHO pin is 5V on most HC-SR04 modules** — Connecting it directly to a 3.3V-only GPIO input without a voltage divider or level shifter risks damaging the MCU. Some 3.3V-compatible modules exist, but the majority of clones output a full 5V echo pulse

## In Practice

- An ultrasonic sensor that returns consistent readings at short range (< 50 cm) but increasingly noisy readings at long range (> 200 cm) is operating near the limit of its signal-to-noise ratio — the echo amplitude falls off with the fourth power of distance (inverse square for both outgoing and return paths)
- A sensor that alternates between a plausible distance and a much larger value on consecutive readings is detecting multipath echoes — the primary echo and a secondary reflection off a nearby wall arrive at different times, and the sensor latches onto whichever arrives first on each measurement cycle
- Measurements that drift slowly over the course of an hour, despite a stationary target, correlate with room temperature changes — a 10°C temperature swing causes a ~1.8% shift in the speed of sound, which at 200 cm produces a 3.6 cm apparent drift
- An HC-SR04 that reports exactly zero (or timeout) on every measurement despite being pointed at a wall 1 meter away typically has the TRIG and ECHO pins swapped, or the TRIG pulse is shorter than 10 µs — a logic analyzer on the TRIG pin revealing a 2-3 µs pulse confirms that the GPIO toggle is too fast without an explicit delay
- Two sensors mounted side by side on a robot chassis that produce correlated noise (both readings jump simultaneously) are experiencing acoustic cross-talk, even when triggered sequentially — increasing the inter-measurement delay from 60 ms to 100 ms typically eliminates residual echo interference
