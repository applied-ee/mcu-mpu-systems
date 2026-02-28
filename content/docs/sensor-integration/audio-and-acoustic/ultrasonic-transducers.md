---
title: "Ultrasonic Transducers & Ranging"
weight: 40
---

# Ultrasonic Transducers & Ranging

Ultrasonic ranging measures distance by timing the round-trip of a sound pulse — the same principle as sonar and radar, scaled down to centimeter-resolution distances using 40 kHz piezoelectric transducers. The technique is conceptually simple: transmit a burst, start a timer, listen for the echo, and compute distance from the elapsed time. The implementation details, however, involve transmit driver circuits, receive amplifier chains, envelope detection, blanking intervals, and careful timing — all within firmware running on a general-purpose MCU. The HC-SR04 module hides most of this complexity behind a trigger/echo interface, but understanding the underlying signal chain is essential for building custom ranging systems with better performance, multiple channels, or integration into space-constrained designs.

## Piezoelectric Ultrasonic Transducers

The standard transducer for embedded ultrasonic ranging is a piezoelectric ceramic disc resonant at 40 kHz, housed in an aluminum can approximately 16 mm in diameter (e.g., TCT40-16T for transmit, TCT40-16R for receive, or combined T/R types). Applying an AC voltage at the resonant frequency causes the ceramic disc to vibrate mechanically, producing a pressure wave in air. Conversely, an incoming pressure wave deforms the disc and generates a voltage.

Key parameters:

| Parameter | Typical Value | Notes |
|---|---|---|
| Center frequency | 40 kHz | Some parts: 25 kHz or 58 kHz |
| Bandwidth (-6 dB) | 2-4 kHz | Narrow; 38-42 kHz passband |
| Wavelength in air | ~8.6 mm | At 20C; 343 m/s / 40 kHz |
| Beam angle (-6 dB) | 50-80 degrees | Wide; narrows with larger aperture |
| Maximum range | 2-5 m | Depends on drive voltage and target reflectivity |
| Minimum range | 2-3 cm | Limited by blanking time after TX burst |
| Transmit sensitivity | 112-120 dB SPL at 30 cm / 10 Vpp drive | Varies by part |
| Receive sensitivity | -70 to -65 dBV/ubar | Typical open-circuit sensitivity |

The narrow bandwidth of the transducer (Q ~ 10-20) means it rings for several cycles after the drive signal stops. This ringing is the primary factor limiting minimum detectable range — the receive amplifier saturates during the ring-down period, masking nearby echoes.

## Transmit Driver Circuits

### Direct GPIO Drive

The simplest transmit approach drives the transducer directly from an MCU GPIO pin toggled at 40 kHz. With a 3.3V GPIO, the peak-to-peak voltage across the transducer is 3.3V — enough for short-range detection (< 50 cm) but insufficient for longer ranges. The transducer impedance at resonance is typically 200-500 ohm, so GPIO current is 7-17 mA — within the capability of most MCU pins.

### H-Bridge Driver

Driving the transducer with an H-bridge (two GPIO pins in push-pull, switching alternately) doubles the effective voltage to 6.6 Vpp on a 3.3V supply. The two pins drive opposite ends of the transducer, alternating between [Pin A high, Pin B low] and [Pin A low, Pin B high] at 40 kHz.

```
      VCC (3.3V)           VCC (3.3V)
        |                    |
    [GPIO A]             [GPIO B]
        |                    |
        +---[TRANSDUCER]-----+
```

This is the approach used by most HC-SR04 modules and is the recommended starting point for custom designs.

### Transformer / Boost Drive

For maximum range (3-5 m), a step-up transformer or dedicated driver IC (e.g., MAX232 repurposed for its charge pump, or a dedicated ultrasonic driver like the TDC1000) boosts the drive voltage to 12-40 Vpp. Higher drive voltage increases the transmitted SPL proportionally (in dB), extending range but requiring careful attention to transducer voltage ratings and driver circuit isolation from the MCU.

## Transmit Burst Generation with PWM Timer

Rather than bit-banging the 40 kHz signal, a hardware PWM timer ensures precise frequency and burst duration:

```c
/* STM32 HAL — Generate 40 kHz burst on TIM2 CH1 for ultrasonic TX */
#include "stm32f4xx_hal.h"

extern TIM_HandleTypeDef htim2;

#define US_FREQ_HZ       40000
#define US_BURST_CYCLES   8      /* 8 cycles = 200 us burst */

/* Timer clock assumed 84 MHz (APB1 x2 for TIM2 on STM32F4) */
/* Period = 84e6 / 40000 - 1 = 2099 */
/* Pulse  = 1050 (50% duty cycle) */

static volatile uint32_t burst_count = 0;

void ultrasonic_tx_init(void)
{
    htim2.Instance = TIM2;
    htim2.Init.Prescaler = 0;
    htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim2.Init.Period = 2099;
    htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    HAL_TIM_PWM_Init(&htim2);

    TIM_OC_InitTypeDef oc_cfg = {0};
    oc_cfg.OCMode     = TIM_OCMODE_PWM1;
    oc_cfg.Pulse      = 1050;  /* 50% duty */
    oc_cfg.OCPolarity  = TIM_OCPOLARITY_HIGH;
    oc_cfg.OCFastMode  = TIM_OCFAST_DISABLE;
    HAL_TIM_PWM_ConfigChannel(&htim2, &oc_cfg, TIM_CHANNEL_1);
}

void ultrasonic_tx_burst(void)
{
    burst_count = 0;

    /* Enable update interrupt to count cycles */
    __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
    HAL_TIM_Base_Start_IT(&htim2);
    HAL_TIM_PWM_Start(&htim2, TIM_CHANNEL_1);
}

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
    if (htim->Instance == TIM2) {
        burst_count++;
        if (burst_count >= US_BURST_CYCLES) {
            HAL_TIM_PWM_Stop(&htim2, TIM_CHANNEL_1);
            HAL_TIM_Base_Stop_IT(&htim2);
            /* Burst complete — start listening for echo */
        }
    }
}
```

The burst length is a critical parameter. Too few cycles (< 4) and the transducer does not reach full amplitude — the narrow bandwidth means the envelope takes several cycles to build up. Too many cycles (> 16) and the ring-down time extends, increasing the minimum detectable range. Eight cycles (200 us at 40 kHz) is a common compromise.

### H-Bridge Burst with Complementary Channels

For H-bridge drive, configure two complementary PWM channels. On STM32, the advanced timers (TIM1, TIM8) support complementary output natively. Alternatively, two regular timer channels with opposite polarity achieve the same effect:

```c
/* Configure TIM1 CH1 and CH1N for complementary H-bridge drive */
TIM_OC_InitTypeDef oc_cfg = {0};
oc_cfg.OCMode       = TIM_OCMODE_PWM1;
oc_cfg.Pulse        = 1050;
oc_cfg.OCPolarity   = TIM_OCPOLARITY_HIGH;
oc_cfg.OCNPolarity  = TIM_OCNPOLARITY_HIGH;
oc_cfg.OCIdleState  = TIM_OCIDLESTATE_RESET;
oc_cfg.OCNIdleState = TIM_OCNIDLESTATE_RESET;
HAL_TIM_PWM_ConfigChannel(&htim1, &oc_cfg, TIM_CHANNEL_1);

/* Start both complementary outputs */
HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_1);
HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
```

## Receive Amplifier Chain

The echo signal arriving at the receive transducer is extremely small — a target at 1 m might produce 1-10 mV at the transducer terminals, and at 3 m, the signal drops to 50-500 uV. The receive chain must amplify this by 40-60 dB while rejecting out-of-band noise.

### Amplifier Architecture

A typical receive chain:

1. **Bandpass filter** — Centers on 40 kHz with 5-10 kHz bandwidth, rejecting low-frequency ambient noise and high-frequency interference
2. **First gain stage** — 20-30 dB gain (op-amp, non-inverting)
3. **Second gain stage** — 20-30 dB additional gain
4. **Envelope detector** — Extracts the amplitude envelope from the 40 kHz carrier
5. **Comparator** — Triggers when the envelope exceeds a threshold

### Bandpass Filter

A simple bandpass filter for 40 kHz uses two cascaded stages:

- **High-pass**: R = 10 kohm, C = 1 nF → f_c = 16 kHz (blocks audio-frequency noise)
- **Low-pass**: R = 10 kohm, C = 220 pF → f_c = 72 kHz (blocks high-frequency interference)

The combined passband (16-72 kHz) is wider than the transducer's bandwidth, so the transducer itself provides additional filtering. For tighter filtering, an active bandpass filter centered at 40 kHz with Q = 5-10 is preferable but adds complexity.

### Gain Stage Component Values

For a two-stage amplifier with 46 dB total gain:

| Stage | Topology | R_f | R_g | Gain | Op-Amp |
|---|---|---|---|---|---|
| 1 | Non-inverting | 47 kohm | 2.2 kohm | 22.4 (27 dB) | MCP6001 or TLV2371 |
| 2 | Non-inverting | 22 kohm | 4.7 kohm | 5.7 (15 dB) | MCP6001 or TLV2371 |
| **Total** | | | | **127 (42 dB)** | |

The gain distribution matters — placing more gain in the first stage provides better overall noise performance (the first stage's noise contribution dominates), but too much gain in a single stage risks instability. Splitting gain across two stages with moderate per-stage gain (20-27 dB each) is a proven approach.

## Envelope Detection

The amplified receive signal is a 40 kHz sine wave with an amplitude envelope that corresponds to the echo strength. Extracting this envelope converts the high-frequency signal into a slowly varying DC level suitable for threshold comparison.

### Analog Envelope Detector

```
Amplified 40 kHz signal
        |
       [D1]  Schottky diode (BAT54 or 1N5819)
        |
        +----+---- Envelope output
        |    |
      [R_env] [C_env]
        |    |
       GND  GND
```

The diode rectifies the signal (passing only positive half-cycles), and the RC network smooths the result. The time constant should be:

- Fast enough to follow the burst envelope (rise time < 100 us)
- Slow enough to filter out the 40 kHz carrier ripple

For 40 kHz: R_env = 10 kohm, C_env = 1 nF gives tau = 10 us — the envelope output tracks the burst envelope with ~25 us rise time while attenuating the 40 kHz ripple by about 14 dB. Residual ripple can be further reduced by increasing C_env to 2.2 nF (tau = 22 us) at the cost of slightly slower envelope tracking.

A Schottky diode (BAT54) is preferred over a standard silicon diode because its lower forward voltage drop (0.2-0.3V vs 0.6V) preserves more of the signal amplitude, improving sensitivity for weak echoes.

### Software Envelope Detection

On MCUs with fast ADCs (> 200 ksps), the amplified 40 kHz signal can be sampled directly and the envelope extracted in software:

```c
#define ENV_WINDOW   5   /* Samples per half-cycle at 200 ksps / 40 kHz */

static uint16_t envelope_detect(uint16_t *samples, size_t count)
{
    uint16_t peak = 0;

    for (size_t i = 0; i < count; i++) {
        /* Absolute value relative to mid-scale (2048 for 12-bit ADC) */
        int16_t centered = (int16_t)samples[i] - 2048;
        uint16_t magnitude = centered < 0 ? -centered : centered;

        if (magnitude > peak) {
            peak = magnitude;
        }
    }

    return peak;
}
```

This approach eliminates the analog envelope detector circuit but requires the ADC to sample at least 5x the carrier frequency (200 kHz for 40 kHz) to capture the peak reliably. On an STM32F4 with a 2.4 Msps ADC, this is easily achievable.

## Comparator Threshold and Echo Detection

The envelope detector output is compared against a threshold to determine when an echo has arrived. The threshold must be set above the noise floor but below the expected echo amplitude:

- **Too low**: False triggers from electrical noise or ambient ultrasonic sources
- **Too high**: Misses weak echoes from distant or poorly reflective targets

A fixed threshold of 100-200 mV above the noise floor works for controlled environments. For variable conditions, an adaptive threshold that tracks the noise floor and sets the detection level at a fixed margin above it improves reliability.

The comparator can be hardware (LM393 or MCU's built-in analog comparator) or software (comparing ADC readings to a threshold value in firmware). Hardware comparators provide faster response and can trigger input capture directly; software comparison offers more flexibility for adaptive thresholds.

## Time-of-Flight Calculation

The distance to the target is computed from the round-trip time:

```
distance = (speed_of_sound * time_of_flight) / 2
```

The factor of 2 accounts for the sound traveling to the target and back.

### Speed of Sound

The speed of sound in air varies with temperature:

```
v = 331.3 + 0.606 * T_celsius   (m/s)
```

| Temperature (C) | Speed of Sound (m/s) | Error at 343 m/s assumed |
|---|---|---|
| 0 | 331.3 | +3.5% |
| 10 | 337.3 | +1.7% |
| 20 | 343.4 | ~0% |
| 25 | 346.3 | -0.8% |
| 30 | 349.5 | -1.8% |
| 40 | 355.5 | -3.5% |

For centimeter-level accuracy over a 0-40C range, temperature compensation is necessary. A DS18B20 or similar temperature sensor near the transducer provides the correction input.

### Firmware Implementation

```c
#define SPEED_OF_SOUND_CM_US  0.0343f  /* cm per microsecond at 20C */

/* Input capture timer measures echo arrival time in microseconds */
static volatile uint32_t echo_start_us = 0;
static volatile uint32_t echo_end_us   = 0;
static volatile bool     echo_received = false;

void start_ranging(void)
{
    echo_received = false;

    /* Transmit burst (see PWM burst code above) */
    ultrasonic_tx_burst();

    /* Start blanking timer — ignore echoes for first 150 us (2.5 cm) */
    /* After blanking, enable input capture on echo comparator output */
}

/* Input capture ISR — triggered by comparator output going high */
void echo_input_capture_isr(uint32_t capture_us)
{
    if (!echo_received) {
        echo_end_us = capture_us;
        echo_received = true;
    }
}

float compute_distance_cm(float temperature_c)
{
    if (!echo_received) {
        return -1.0f;  /* No echo detected */
    }

    float speed = 331.3f + 0.606f * temperature_c;  /* m/s */
    float speed_cm_us = speed / 10000.0f;            /* cm/us */

    uint32_t tof_us = echo_end_us - echo_start_us;
    float distance = (speed_cm_us * (float)tof_us) / 2.0f;

    return distance;
}
```

### Resolution and Accuracy

At 343 m/s, sound travels 0.0343 cm per microsecond. A timer with 1 us resolution provides ~0.17 mm distance resolution (round-trip). In practice, accuracy is limited by:

- **Transducer ring-down** — The receive transducer rings for 200-500 us after the transmit burst, creating a dead zone of 3-9 cm
- **Temperature uncertainty** — 1C error causes ~0.18% distance error (~3.5 mm at 2 m)
- **Target geometry** — Angled or curved surfaces may reflect sound away from the receiver, reducing echo amplitude or producing multipath
- **Beam width** — The 50-80 degree beam angle means the echo may come from an object offset from the direct line-of-sight

## Transmit/Receive Switching

### Separate Transducers

The simplest approach uses two transducers — one dedicated transmitter and one dedicated receiver — mounted side by side (typically 10-20 mm apart). This eliminates the need for electronic T/R switching and avoids direct electrical coupling between transmit and receive paths. The HC-SR04 module uses this two-transducer configuration.

### Single Transducer with T/R Switch

For space-constrained designs, a single transducer operates in both transmit and receive modes. A T/R (transmit/receive) switch disconnects the receive amplifier during transmission (to prevent saturation) and disconnects the transmit driver during reception (to avoid loading the weak echo signal).

A simple T/R switch uses back-to-back signal diodes or an analog multiplexer (CD4053). During transmit, the high-voltage drive signal forward-biases the diodes, connecting the driver to the transducer; during receive, the diodes are reverse-biased by the weak echo signal, isolating the transmit driver.

## Blanking Time

After the transmit burst ends, the transducer and any coupling in the circuit ring down over 200-1000 us. During this period, the receive amplifier output is dominated by the ring-down signal, not by actual echoes. The firmware must ignore any comparator triggers during this blanking window.

Blanking time directly determines the minimum detectable range:

```
min_range = (speed_of_sound * blanking_time) / 2
```

| Blanking Time | Minimum Range |
|---|---|
| 150 us | ~2.6 cm |
| 300 us | ~5.1 cm |
| 500 us | ~8.6 cm |
| 1000 us | ~17.1 cm |

For the HC-SR04, the specified minimum range of 2 cm corresponds to a blanking time of approximately 116 us — achievable because the module uses separate transmit and receive transducers with good isolation.

## Tips

- Start with the HC-SR04 module to validate firmware timing and distance calculation before building a custom analog front-end — the module's trigger/echo interface maps directly to timer input capture
- Use 8 transmit cycles as a starting point — fewer cycles produce a weaker echo due to incomplete transducer excitation, while more cycles extend the dead zone
- Mount the transducers with the beam axis perpendicular to the expected target surface — glancing angles scatter the echo away from the receiver, drastically reducing range
- For multi-channel ranging (multiple transducers on one MCU), sequence the transmit bursts with enough delay between channels to avoid cross-talk — the echo from one transducer can trigger another
- Implement a median filter on consecutive distance readings (5-sample window) to reject outliers from multipath echoes or momentary obstructions

## Caveats

- **Soft and angled surfaces absorb or deflect ultrasonic energy** — Fabrics, foam, and irregular surfaces return very weak echoes or no echo at all, making them poor ranging targets. Flat, hard surfaces (walls, floors, metal plates) produce the strongest returns
- **Humidity affects speed of sound** — High humidity increases the speed of sound by 0.1-0.5%, which shifts distance readings. For centimeter-level accuracy in varying environments, humidity compensation (in addition to temperature) may be required
- **Narrow-band transducers are temperature-sensitive** — The 40 kHz resonant frequency shifts slightly with temperature (0.01-0.1%), which can move the operating point off the peak of the transducer's response curve, reducing sensitivity
- **Wind and air turbulence degrade ultrasonic ranging** — Moving air refracts the sound beam and creates phase distortion, increasing measurement noise. Outdoor ultrasonic ranging in wind is unreliable beyond ~1 m
- **Electrical noise from the transmit driver couples into the receive chain** — Even with separate transducers, the transmit burst can couple through the power supply, ground plane, or PCB traces. Adequate decoupling, physical separation, and blanking are all necessary

## In Practice

- An HC-SR04 that consistently reads 2-3% long at room temperature but is accurate in a warm room suggests the firmware is using the textbook 343 m/s speed of sound without temperature compensation — at 15C, the actual speed is 340 m/s, producing a 0.9% error
- A custom ranging system that detects targets at 1 m but fails at 2 m despite adequate receive amplifier gain likely has a transducer alignment problem — a few degrees of tilt between the TX and RX beams shifts the overlap zone, and the echo misses the receiver at longer ranges
- Intermittent false readings at a consistent distance (e.g., always 45 cm) in an empty room point to a structural echo — the ultrasonic beam is reflecting off a table edge, doorframe, or other fixed object within the beam angle
- A ranging system that works on the bench but fails when installed in an enclosure often suffers from direct acoustic coupling between the transmit and receive transducers through the enclosure walls — adding acoustic foam or baffling between the two transducer ports resolves this
- Observing the receive amplifier output on an oscilloscope reveals the actual echo waveform — the ring-down, noise floor, echo arrival, and any multipath reflections are all visible, making it the single most useful debugging tool for ultrasonic ranging systems
