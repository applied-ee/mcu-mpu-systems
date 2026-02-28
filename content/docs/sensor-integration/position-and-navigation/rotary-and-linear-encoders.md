---
title: "Rotary & Linear Encoders"
weight: 20
---

# Rotary & Linear Encoders

Encoders convert mechanical motion into digital signals that an MCU can count, enabling precise measurement of position, angle, and velocity. Incremental encoders produce a stream of pulses as the shaft or carriage moves — the MCU counts pulses for position and measures pulse timing for velocity. Absolute encoders report the current angle or position directly as a digital word, requiring no power-on homing cycle. The interface ranges from simple quadrature pulse trains (two GPIO pins) to SPI/SSI serial buses for multi-turn absolute encoders. STM32 timers have dedicated encoder mode hardware that handles quadrature decoding entirely in hardware, eliminating software overhead and missed-count risks at high speeds.

## Incremental Quadrature Encoding

An incremental encoder produces two square wave outputs, Channel A and Channel B, offset by 90 degrees in phase. This phase relationship — called quadrature — encodes both motion magnitude (pulse count) and direction (which channel leads). When A leads B, the shaft rotates in one direction; when B leads A, the shaft rotates in the other direction.

The number of transitions per revolution determines the encoder's resolution. A 1000 CPR (counts per revolution) encoder produces 1000 complete cycles of each channel per revolution. In 4x decoding mode (counting every edge of both A and B), this yields 4000 countable edges per revolution — 0.09 degrees per count.

| Decoding Mode | Edges Counted | Effective Resolution |
|---------------|---------------|---------------------|
| 1x | Rising edges of A only | 1 × CPR |
| 2x | Rising and falling edges of A | 2 × CPR |
| 4x | All edges of A and B | 4 × CPR |

4x decoding is the standard choice because it maximizes resolution at no hardware cost. The only reason to use 1x or 2x is when the MCU cannot process edges fast enough at maximum shaft speed, which is rarely a constraint with hardware decoder peripherals.

## Index Pulse (Z Channel)

Many encoders include a third output, the Z or index channel, which produces a single pulse once per revolution at a fixed angular position. The index pulse serves as an absolute reference point — on power-up, the system can rotate the shaft until the index pulse is detected, establishing a known angular position without an external homing sensor.

The index pulse is typically used in one of two ways:
1. **Homing**: Rotate until Z is detected, then reset the counter to zero
2. **Error detection**: On every subsequent Z pulse, verify the counter equals the expected full-revolution count — any discrepancy indicates missed counts

## STM32 Timer Encoder Mode

STM32 timers include a dedicated encoder interface mode that connects two timer input channels directly to the quadrature signals. The timer counter automatically increments or decrements based on the phase relationship, with no CPU intervention required. The hardware handles debouncing via configurable input filters.

### STM32 HAL Encoder Configuration

```c
TIM_HandleTypeDef       htim3;
TIM_Encoder_InitTypeDef encoder_config;

void encoder_init(void) {
    __HAL_RCC_TIM3_CLK_ENABLE();
    __HAL_RCC_GPIOA_CLK_ENABLE();

    /* Configure PA6 (TIM3_CH1) and PA7 (TIM3_CH2) as AF */
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin       = GPIO_PIN_6 | GPIO_PIN_7;
    gpio.Mode      = GPIO_MODE_AF_PP;
    gpio.Pull      = GPIO_PULLUP;       /* Pullups prevent floating inputs */
    gpio.Speed     = GPIO_SPEED_FREQ_HIGH;
    gpio.Alternate = GPIO_AF2_TIM3;
    HAL_GPIO_Init(GPIOA, &gpio);

    htim3.Instance               = TIM3;
    htim3.Init.Prescaler         = 0;
    htim3.Init.CounterMode       = TIM_COUNTERMODE_UP;
    htim3.Init.Period            = 0xFFFF;   /* 16-bit counter, wraps at 65535 */
    htim3.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
    htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;

    encoder_config.EncoderMode  = TIM_ENCODERMODE_TI12;  /* 4x decoding */
    encoder_config.IC1Polarity  = TIM_ICPOLARITY_RISING;
    encoder_config.IC1Selection = TIM_ICSELECTION_DIRECTTI;
    encoder_config.IC1Prescaler = TIM_ICPSC_DIV1;
    encoder_config.IC1Filter    = 0x0F;  /* Max digital filter for debounce */
    encoder_config.IC2Polarity  = TIM_ICPOLARITY_RISING;
    encoder_config.IC2Selection = TIM_ICSELECTION_DIRECTTI;
    encoder_config.IC2Prescaler = TIM_ICPSC_DIV1;
    encoder_config.IC2Filter    = 0x0F;

    HAL_TIM_Encoder_Init(&htim3, &encoder_config);
    HAL_TIM_Encoder_Start(&htim3, TIM_CHANNEL_ALL);
}

/* Read current position (signed, handling wraparound) */
int32_t encoder_read_position(void) {
    return (int16_t)__HAL_TIM_GET_COUNTER(&htim3);
}
```

The `IC1Filter` and `IC2Filter` fields set the digital input filter, which requires a configurable number of consecutive stable samples before registering an edge. A filter value of 0x0F provides maximum debouncing (15 clock cycles of stable input), which is important for mechanical encoders that produce contact bounce on each transition.

Setting `Period` to the encoder's full-revolution count minus one (e.g., 3999 for a 1000 CPR encoder in 4x mode) causes the counter to wrap cleanly at revolution boundaries, making absolute-within-one-revolution position tracking automatic.

## Velocity Estimation from Encoder Data

Two fundamental methods exist for computing velocity from encoder counts:

### M-Method (Frequency Measurement)

Count the number of encoder edges in a fixed time window. Best at high speeds where many pulses arrive per measurement window.

```c
/* M-Method: count pulses over fixed interval */
volatile int32_t last_position = 0;

/* Called from a fixed-rate timer ISR, e.g., every 10 ms */
float velocity_m_method(float dt_seconds) {
    int32_t current = encoder_read_position();
    int32_t delta   = current - last_position;
    last_position   = current;

    /* Convert counts to revolutions per second */
    /* For 1000 CPR encoder in 4x mode: 4000 counts/rev */
    float counts_per_rev = 4000.0f;
    float velocity_rps   = (float)delta / (counts_per_rev * dt_seconds);
    return velocity_rps;
}
```

### T-Method (Period Measurement)

Measure the time between consecutive encoder edges using a timer input capture. Best at low speeds where individual pulse periods are long enough to measure accurately.

```c
/* T-Method: measure time between encoder edges using input capture */
volatile uint32_t last_capture = 0;
volatile float    velocity_rps = 0.0f;

/* Called from input capture ISR on encoder Channel A rising edge */
void encoder_capture_callback(uint32_t capture_value, uint32_t timer_freq_hz) {
    uint32_t period_ticks = capture_value - last_capture;
    last_capture = capture_value;

    if (period_ticks > 0) {
        float edge_freq    = (float)timer_freq_hz / (float)period_ticks;
        float counts_per_rev = 4000.0f;
        velocity_rps       = edge_freq / counts_per_rev;
    }
}
```

### Method Selection Guide

| Condition | Preferred Method | Reason |
|-----------|-----------------|--------|
| High speed (> 100 RPM) | M-Method | Many pulses per window, good averaging |
| Low speed (< 10 RPM) | T-Method | Long pulse periods measured precisely |
| Variable speed | Hybrid M/T | Switch method based on speed range |
| Stationary detection | M-Method | T-Method gives no update when stopped |

The M-method has a blind spot at very low speeds where zero or one pulse arrives per measurement window, producing a quantized 0-or-minimum-speed output. The T-method fails when the shaft is stationary because no edges arrive to trigger a measurement — a timeout mechanism is needed to report zero velocity.

## Debouncing Considerations

Mechanical (brush-contact) encoders generate contact bounce on each transition — a single physical edge produces multiple electrical edges over a span of 1-5 ms. Without debouncing, the counter accumulates extra counts during each transition.

Hardware debouncing approaches:
- **STM32 input filter** — The `ICFilter` parameter in encoder mode samples the input at a divided clock rate and requires N consecutive identical samples. This is the preferred approach as it requires no external components
- **RC filter** — A 10 kΩ resistor in series with a 10-100 nF capacitor to ground on each channel, producing a time constant of 0.1-1 ms. Simple but adds propagation delay that limits maximum counting frequency
- **Schmitt trigger buffer** — An IC like the 74HC14 cleans up slow or noisy edges. Useful when cable runs exceed 30 cm or when operating in electrically noisy environments

Optical encoders produce clean, bounce-free edges and generally do not require debouncing. Magnetic encoders (Hall-effect) also produce clean signals but may have slower edge rates.

## Absolute Encoders

Absolute encoders output the current angular position as a digital word immediately upon power-up, with no homing sequence required. Resolution is specified in bits — a 12-bit absolute encoder provides 4096 discrete positions per revolution (0.088 degrees).

| Interface | Protocol | Typical Parts | Resolution |
|-----------|----------|---------------|------------|
| SPI | Standard SPI read | AS5048A (ams OSRAM) | 14-bit |
| SSI | Synchronous serial, clock-driven | Kübler F3663 | 12-25 bit |
| Analog | 0-5V or 0-10V proportional | Bourns EMS22A | 10-bit effective |
| BiSS-C | Bidirectional serial | RLS Orbis | 18-bit |

### SPI Absolute Encoder Read (AS5048A)

```c
/* AS5048A: 14-bit magnetic absolute encoder, SPI interface */
/* SPI Mode 1 (CPOL=0, CPHA=1), max 10 MHz */

#define AS5048A_CMD_ANGLE   0x3FFF  /* Read angle register */

uint16_t as5048a_read_angle(SPI_HandleTypeDef *hspi) {
    uint16_t tx = AS5048A_CMD_ANGLE;
    uint16_t rx = 0;

    /* Add even parity bit (bit 15) */
    uint16_t parity = tx;
    parity ^= parity >> 8;
    parity ^= parity >> 4;
    parity ^= parity >> 2;
    parity ^= parity >> 1;
    if (parity & 1) tx |= 0x8000;

    /* First transfer: send read command */
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
    HAL_SPI_TransmitReceive(hspi, (uint8_t *)&tx, (uint8_t *)&rx, 1, 100);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET);

    /* Second transfer: clock out the result */
    tx = AS5048A_CMD_ANGLE;  /* NOP or repeat command */
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_RESET);
    HAL_SPI_TransmitReceive(hspi, (uint8_t *)&tx, (uint8_t *)&rx, 1, 100);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_12, GPIO_PIN_SET);

    /* Mask to 14-bit angle value */
    return rx & 0x3FFF;
}

/* Convert to degrees */
float as5048a_angle_degrees(uint16_t raw) {
    return (float)raw * 360.0f / 16384.0f;
}
```

The AS5048A uses a pipeline — the angle data returned in the current SPI transaction corresponds to the previous read command. The first read after power-up returns stale or zero data; the second read returns the actual angle.

## Linear Encoders

Linear encoders operate on the same principles as rotary encoders but measure displacement along a straight axis. The read head moves along a graduated scale, producing quadrature signals proportional to linear displacement. Resolutions of 1-5 µm are common in CNC and metrology applications.

Linear encoder scales come in two forms:
- **Glass scale** — Chrome gratings on glass, 1-20 µm pitch, high accuracy (±3 µm/m), fragile
- **Magnetic scale** — Magnetized tape or rod, 1-2 mm pole pitch, interpolated to µm resolution, robust in dirty/oily environments

The firmware interface for a linear encoder is identical to a rotary encoder — the same STM32 timer encoder mode counts quadrature pulses, with the count multiplied by the scale resolution (µm/count) to obtain displacement.

## Encoder Types Compared

| Type | Mechanism | Resolution | Max Speed | Durability | Cost |
|------|-----------|-----------|-----------|------------|------|
| **Optical (transmissive)** | LED + phototransistor + slotted disc | 100-10000 CPR | Very high (100k RPM) | Good (no contact) | Medium |
| **Optical (reflective)** | LED + photodetector + printed pattern | 32-512 CPR | High | Good | Low |
| **Magnetic (Hall effect)** | Hall sensors + magnetized ring/disc | 4-4096 positions | High (50k RPM) | Excellent (sealed, no wear) | Medium-High |
| **Magnetic (MR/GMR)** | Magnetoresistive + magnetic scale | Up to 1 µm | Medium | Excellent | High |
| **Capacitive** | Capacitance change between rotor/stator plates | 2048-65536 positions | Medium | Good (non-contact) | High |
| **Mechanical (brush)** | Brush contacts on conductive pattern | 12-128 CPR | Low (< 500 RPM) | Poor (contact wear) | Very low |

Mechanical brush encoders (common in cheap rotary knob controls) are the only type that requires debouncing. Optical and magnetic encoders produce clean, well-defined edges suitable for direct connection to MCU inputs.

## Tips

- Use STM32 timer encoder mode rather than GPIO interrupts for quadrature decoding — the hardware decoder handles 4x counting, direction detection, and input filtering with zero CPU load, and cannot miss edges even at maximum timer input frequency
- Set the timer auto-reload value to (4 × CPR - 1) so the counter wraps at exact revolution boundaries — this simplifies absolute angle calculation within one revolution and makes index pulse validation trivial
- Enable pull-up resistors on encoder inputs — open-collector encoder outputs left floating during power-up can produce spurious counts before the encoder driver IC initializes
- For velocity measurement, use the M-method at the control loop rate (typically 1-10 kHz) and add a low-pass filter to the velocity estimate — raw differentiation of position amplifies quantization noise, especially at low speeds
- When using long cables (> 1 meter) between encoder and MCU, use differential line drivers (RS-422/AM26LS31) or ensure the cable is shielded — single-ended quadrature signals are vulnerable to capacitive coupling from nearby motor power cables

## Caveats

- **Counter overflow at high speed** — A 16-bit timer counter wraps at 65535. A 10000 CPR encoder at 3000 RPM in 4x mode produces 2 million edges per second; at 84 MHz timer clock the counter itself is fine, but the position overflows every 0.033 seconds if not handled. Using a 32-bit timer (TIM2 or TIM5 on STM32F4) avoids this entirely
- **Missed counts are silent** — Unlike communication protocols with checksums, a missed encoder edge produces no error flag. The position simply drifts. The only detection mechanism is the index pulse: if the count at each index pulse deviates from the expected CPR × 4, edges are being lost
- **Velocity estimation diverges at near-zero speed** — The T-method produces a division-by-zero-like condition when no edges arrive, and the M-method quantizes to zero. A timeout-based zero-speed detection is required to avoid stale velocity readings
- **Electrical noise from motors couples into encoder cables** — Running encoder wires alongside motor power leads induces noise that can generate phantom counts. Shielding and physical separation are essential in motor control applications
- **Mechanical encoders need debouncing** — Cheap rotary knob encoders (e.g., KY-040 module) produce severe bounce that can cause double or triple counting per detent. The STM32 input filter at maximum setting (0x0F) usually handles this, but extremely noisy encoders may require external RC filtering as well

## In Practice

- A motor that overshoots its target position by a consistent percentage has a velocity loop gain issue, not an encoder issue — but a motor that drifts slowly in one direction even when commanded to hold position suggests missed encoder counts, often due to EMI from the motor's own PWM drive
- Reading the timer counter and observing that it increases when rotating clockwise but decreases when rotating counterclockwise confirms correct wiring — swapped A and B channels reverse the direction sense, which can be corrected either by swapping wires or inverting one channel's polarity in the timer configuration
- A position value that jumps by several hundred counts intermittently (without corresponding physical motion) is the hallmark of electrical noise on the encoder lines — adding a 100 nF capacitor from each channel to ground typically eliminates this
- The detent feel on a mechanical rotary encoder does not always correspond to one electrical cycle — many KY-040 style encoders produce two or four quadrature counts per detent, requiring division in firmware to match the physical click count
- Absolute encoders (SPI/SSI) that return correct values at standstill but incorrect values while the shaft is spinning quickly are experiencing read-during-update errors — latching the position before reading (supported by most absolute encoder ICs) eliminates this
