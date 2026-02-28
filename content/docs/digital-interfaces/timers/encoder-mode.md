---
title: "Encoder Mode & Quadrature Decoding"
weight: 40
---

# Encoder Mode & Quadrature Decoding

Rotary encoders are the primary position feedback device in motor control, CNC machines, robotic joints, and manual input knobs. A quadrature encoder outputs two square waves (Channel A and Channel B) with a 90° phase offset — the phase relationship between the two signals encodes both position and direction. STM32 timers include a dedicated encoder mode that decodes these signals entirely in hardware: the timer's CNT register tracks absolute position, incrementing or decrementing on each edge, with no CPU involvement per edge. This eliminates the interrupt overhead and timing sensitivity that software-based quadrature decoding requires.

## Quadrature Encoder Signals

A quadrature encoder with N pulses per revolution (PPR) generates N complete cycles on each channel per revolution. The two channels are offset by 90° (one quarter cycle):

```
Direction: Forward (CW)
  A: __|‾‾|__|‾‾|__|‾‾|__
  B: ___|‾‾|__|‾‾|__|‾‾|_

Direction: Reverse (CCW)
  A: ___|‾‾|__|‾‾|__|‾‾|_
  B: __|‾‾|__|‾‾|__|‾‾|__
```

When Channel A leads Channel B, the encoder rotates in one direction. When B leads A, the direction reverses. A 1000 PPR encoder produces 1000 cycles per channel per revolution.

Many encoders also provide a Z (index) channel — a single pulse per revolution that marks a reference position. The Z pulse is used for homing and absolute position calibration.

## STM32 Encoder Mode Configuration

STM32 general-purpose timers (TIM2–TIM5) and advanced timers (TIM1, TIM8) support encoder interface mode. Two timer channels (CH1 and CH2) serve as the A and B inputs. The timer automatically:

1. Detects edges on both channels
2. Determines count direction from the phase relationship
3. Increments or decrements CNT accordingly

Three encoder modes exist:

| Mode | Edges counted | Counts per encoder cycle | HAL constant |
|------|--------------|------------------------|-------------|
| TI1 | CH1 edges only | 2 (rising + falling) | `TIM_ENCODERMODE_TI1` |
| TI2 | CH2 edges only | 2 (rising + falling) | `TIM_ENCODERMODE_TI2` |
| TI12 | Both CH1 and CH2 edges | 4 (all edges) | `TIM_ENCODERMODE_TI12` |

TI12 mode (4x counting) is the standard choice — it extracts the maximum resolution from the encoder. A 1000 PPR encoder in TI12 mode produces 4000 counts per revolution.

```c
/* TIM2 encoder mode: PA0 (CH1) = A, PA1 (CH2) = B */
__HAL_RCC_TIM2_CLK_ENABLE();
__HAL_RCC_GPIOA_CLK_ENABLE();

GPIO_InitTypeDef gpio = {0};
gpio.Pin       = GPIO_PIN_0 | GPIO_PIN_1;
gpio.Mode      = GPIO_MODE_AF_PP;
gpio.Pull      = GPIO_PULLUP;
gpio.Speed     = GPIO_SPEED_FREQ_HIGH;
gpio.Alternate = GPIO_AF1_TIM2;
HAL_GPIO_Init(GPIOA, &gpio);

TIM_HandleTypeDef htim2 = {0};
htim2.Instance           = TIM2;
htim2.Init.Prescaler     = 0;
htim2.Init.CounterMode   = TIM_COUNTERMODE_UP;
htim2.Init.Period        = 0xFFFFFFFF;  /* 32-bit: full range */
htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;

TIM_Encoder_InitTypeDef enc = {0};
enc.EncoderMode  = TIM_ENCODERMODE_TI12;    /* 4x counting */
enc.IC1Polarity  = TIM_ICPOLARITY_RISING;
enc.IC1Selection = TIM_ICSELECTION_DIRECTTI;
enc.IC1Prescaler = TIM_ICPSC_DIV1;
enc.IC1Filter    = 0x05;                     /* Input filter */
enc.IC2Polarity  = TIM_ICPOLARITY_RISING;
enc.IC2Selection = TIM_ICSELECTION_DIRECTTI;
enc.IC2Prescaler = TIM_ICPSC_DIV1;
enc.IC2Filter    = 0x05;
HAL_TIM_Encoder_Init(&htim2, &enc);
HAL_TIM_Encoder_Start(&htim2, TIM_CHANNEL_ALL);
```

Reading the position requires only a register read:

```c
int32_t position = (int32_t)__HAL_TIM_GET_COUNTER(&htim2);
```

The count direction is visible in the DIR bit of TIMx_CR1:

```c
uint8_t direction = __HAL_TIM_IS_TIM_COUNTING_DOWN(&htim2);
/* 0 = counting up (forward), 1 = counting down (reverse) */
```

## 4x Counting Resolution

In TI12 mode, the timer counts on every transition of both channels — rising edge of A, falling edge of A, rising edge of B, falling edge of B. This quadruples the native PPR:

| Encoder PPR | Mode | Counts per revolution | Angular resolution |
|-------------|------|----------------------|-------------------|
| 100 | TI12 (4x) | 400 | 0.90° |
| 600 | TI12 (4x) | 2400 | 0.15° |
| 1000 | TI12 (4x) | 4000 | 0.09° |
| 2500 | TI12 (4x) | 10000 | 0.036° |

A 1000 PPR encoder in 4x mode provides 4000 counts per revolution — 0.09° per count. For a 2 mm pitch leadscrew driven directly, each count represents 0.5 µm of linear travel.

## Overflow Handling for Multi-Turn Encoders

A 16-bit timer (ARR = 65535) in 4x mode overflows after 65536 / 4000 = ~16.4 revolutions with a 1000 PPR encoder. For multi-turn applications (e.g., a motor that spins hundreds of revolutions), overflow tracking is essential.

**32-bit timer approach** (preferred): TIM2 or TIM5 on STM32F4 provide a 32-bit counter, allowing 4,294,967,296 / 4000 = ~1,073,741 revolutions before overflow. For most applications this is effectively infinite.

**16-bit timer with software extension**: Track overflows and underflows in the update interrupt:

```c
static volatile int32_t overflow_turns = 0;
static volatile uint16_t last_count = 0;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM3) {
        uint16_t current = __HAL_TIM_GET_COUNTER(htim);
        /* Overflow: counter wrapped from high to low (forward) */
        if (current < 0x4000 && last_count > 0xC000) {
            overflow_turns++;
        }
        /* Underflow: counter wrapped from low to high (reverse) */
        else if (current > 0xC000 && last_count < 0x4000) {
            overflow_turns--;
        }
        last_count = current;
    }
}

int32_t get_absolute_position(void) {
    uint16_t cnt = __HAL_TIM_GET_COUNTER(&htim3);
    return (overflow_turns * 65536) + (int32_t)cnt;
}
```

The threshold-based approach (checking whether the count is in the upper or lower quarter of the range) avoids the ambiguity of the direction bit, which can change between the update event and the interrupt handler.

## Index Pulse (Z Channel) Handling

The index pulse marks one specific angular position per revolution. It is used for:
- **Homing**: Establishing an absolute reference at startup
- **Error detection**: Verifying the count matches the expected value each revolution
- **Drift correction**: Resetting the counter to a known value on each index pulse

The Z channel is typically handled via a GPIO external interrupt or a third timer channel in input capture mode:

```c
/* Z channel on PA2 — EXTI interrupt */
gpio.Pin  = GPIO_PIN_2;
gpio.Mode = GPIO_MODE_IT_RISING;
gpio.Pull = GPIO_PULLUP;
HAL_GPIO_Init(GPIOA, &gpio);

HAL_NVIC_SetPriority(EXTI2_IRQn, 1, 0);
HAL_NVIC_EnableIRQ(EXTI2_IRQn);
```

```c
static volatile uint32_t index_position = 0;
static volatile uint8_t  index_seen = 0;

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin) {
    if (GPIO_Pin == GPIO_PIN_2) {
        index_position = __HAL_TIM_GET_COUNTER(&htim2);
        index_seen = 1;

        /* Optional: reset counter to known reference */
        /* __HAL_TIM_SET_COUNTER(&htim2, 0); */
    }
}
```

For homing sequences, the motor rotates slowly until the index pulse fires, then the counter resets to zero. Subsequent index pulses serve as a consistency check — if the count at each index deviates from the expected counts-per-revolution, the encoder has missed edges or the mechanical coupling has slipped.

## Velocity Estimation from Position

Encoder position data yields velocity through differentiation. A timer interrupt at a fixed rate samples the counter and computes the difference:

```c
#define SAMPLE_RATE_HZ  1000
#define COUNTS_PER_REV  4000

static volatile int32_t last_position = 0;
static volatile float   velocity_rpm  = 0.0f;

/* Called from a 1 kHz timer interrupt */
void velocity_update(void) {
    int32_t current = (int32_t)__HAL_TIM_GET_COUNTER(&htim2);
    int32_t delta   = current - last_position;
    last_position   = current;

    /* Convert: counts/sample → revolutions/minute */
    velocity_rpm = (float)delta * SAMPLE_RATE_HZ * 60.0f
                 / (float)COUNTS_PER_REV;
}
```

For low-speed applications where the count difference per sample is small (1–5 counts), quantization noise dominates the velocity estimate. Increasing the sample interval (e.g., 100 Hz instead of 1 kHz) increases the count difference and reduces quantization noise, at the cost of delayed response. A moving average filter over 4–8 samples provides a practical compromise.

## Tips

- Always use TIM_ENCODERMODE_TI12 (4x counting) unless there is a specific reason to reduce resolution — the 4x mode extracts maximum information from the encoder and provides the smoothest velocity estimates.
- Enable input filtering (ICFilter = 3–5) on both channels — encoder signals, especially from mechanical encoders on long cables, carry ringing and bounce that produce spurious counts in both directions.
- Use a 32-bit timer (TIM2 or TIM5) to avoid overflow handling entirely — the code simplification and elimination of race conditions outweigh the cost of "using up" a 32-bit timer.
- Set GPIO pull-ups on both encoder inputs — open-collector encoder outputs (common in industrial encoders) require pull-ups to VCC, and the internal MCU pull-ups (typically 30–50 kΩ) work for short cable runs at moderate speeds.
- Sample the counter at a fixed rate for velocity calculation rather than computing velocity in the update interrupt — the update interrupt fires at the overflow rate, which varies with speed and does not provide a uniform time base.

## Caveats

- **Encoder mode uses CH1 and CH2, consuming two timer channels** — the remaining channels (CH3, CH4) are still available for other functions (e.g., input capture for the Z pulse), but CH1 and CH2 cannot be used for PWM or output compare while encoder mode is active.
- **ICPolarity setting inverts the count direction, not the edge sensitivity** — setting IC1Polarity to `TIM_ICPOLARITY_FALLING` does not mean "capture on falling edge"; it inverts the effective signal polarity, reversing the count direction. Both rising and falling edges are always counted in encoder mode.
- **Electrical noise causes position drift over time** — a single noise spike that produces one extra edge adds a permanent +1 or -1 offset to the position count; unlike analog noise that averages out, encoder count errors are cumulative and only correctable via the index pulse.
- **High-speed encoders can exceed the timer input frequency limit** — the STM32F4 timer input can handle edges up to roughly `f_timer_clk / 4` in encoder mode; a 10,000 PPR encoder at 6000 RPM produces 40,000 × 10,000 / 60 = 6.67 MHz on each channel, which approaches the limit at 84 MHz timer clock and fails with insufficient filtering.
- **The counter value at startup is indeterminate** — CNT initializes to 0 at reset, but the motor position is unknown; a homing sequence using the Z pulse or a limit switch is required before the counter value represents meaningful absolute position.

## In Practice

- An encoder position that drifts slowly in one direction when the motor is stationary indicates electrical noise coupling into the A or B channel — increasing the input filter (ICFilter from 0 to 5) or adding a 100 pF capacitor to ground on each signal line typically resolves the drift.
- A motor that reports exactly half the expected position change per revolution is configured in TI1 or TI2 mode (2x counting) instead of TI12 (4x counting) — switching to `TIM_ENCODERMODE_TI12` doubles the resolution and corrects the scaling.
- A velocity estimate that oscillates between two values at low speed (e.g., alternating between 15 RPM and 0 RPM) results from quantization — the count difference per sample period alternates between 1 and 0; increasing the sample interval or applying a low-pass filter smooths the estimate.
- An encoder that counts correctly at low speed but loses counts at high speed, causing the position to fall behind, typically indicates the input filter is set too aggressively — the filter rejects legitimate edges when the signal period approaches the filter time constant. Reducing ICFilter from 0x0F to 0x03 restores correct counting while still rejecting noise.
- A position reading that jumps by thousands of counts on a single Z pulse indicates the counter reset (`__HAL_TIM_SET_COUNTER(&htim2, 0)`) is executing while the motor is moving — the correct approach is to record the count at the index pulse and apply the offset in software rather than resetting the hardware counter, avoiding a discontinuity in the position stream.
