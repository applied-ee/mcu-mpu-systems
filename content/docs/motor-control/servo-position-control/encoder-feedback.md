---
title: "Encoder Feedback"
weight: 20
---

# Encoder Feedback

A rotary encoder converts shaft rotation into electrical signals that the MCU can count, providing real-time position and velocity feedback. In motor control, encoders close the loop between the commanded position and the actual shaft angle — the essential ingredient for servo control, stall detection, and precision positioning. The most common type in embedded systems is the **incremental quadrature encoder**, which produces two square waves 90° out of phase.

## Quadrature Encoding

A quadrature encoder outputs two channels (A and B) that are 90° phase-shifted:

```
Channel A:  ┌──┐  ┌──┐  ┌──┐  ┌──┐
            │  │  │  │  │  │  │  │
         ───┘  └──┘  └──┘  └──┘  └──

Channel B:    ┌──┐  ┌──┐  ┌──┐  ┌──┐
              │  │  │  │  │  │  │  │
         ─────┘  └──┘  └──┘  └──┘  └──
              ◄─── Forward rotation
```

The phase relationship between A and B indicates direction:
- **A leads B** (A rises while B is low): forward rotation
- **B leads A** (B rises while A is low): reverse rotation

### Counting Modes

| Mode | Edges Counted | Counts per Revolution | Resolution |
|------|--------------|----------------------|-----------|
| 1× (single edge) | Rising A only | PPR | Lowest |
| 2× (dual edge) | Rising + falling A | 2 × PPR | Medium |
| 4× (quadrature) | All A and B edges | 4 × PPR | Highest |

A 600 PPR encoder in 4× mode produces 2400 counts per revolution — 0.15° per count.

## Timer-Based Decoder (STM32)

STM32 timers have a dedicated encoder interface mode that decodes quadrature signals entirely in hardware — no interrupts, no CPU cycles:

```c
/* TIM2 in encoder mode — PA0 (CH1) = A, PA1 (CH2) = B */
TIM_Encoder_InitTypeDef sEncoderConfig = {0};
sEncoderConfig.EncoderMode = TIM_ENCODERMODE_TI12;  /* 4× counting */
sEncoderConfig.IC1Polarity = TIM_ICPOLARITY_RISING;
sEncoderConfig.IC1Selection = TIM_ICSELECTION_DIRECTTI;
sEncoderConfig.IC1Prescaler = TIM_ICPSC_DIV1;
sEncoderConfig.IC1Filter = 0x0F;  /* Digital filter for noise */
sEncoderConfig.IC2Polarity = TIM_ICPOLARITY_RISING;
sEncoderConfig.IC2Selection = TIM_ICSELECTION_DIRECTTI;
sEncoderConfig.IC2Prescaler = TIM_ICPSC_DIV1;
sEncoderConfig.IC2Filter = 0x0F;
HAL_TIM_Encoder_Init(&htim2, &sEncoderConfig);
HAL_TIM_Encoder_Start(&htim2, TIM_CHANNEL_ALL);

/* Read position (signed, wraps at 16-bit boundary) */
int16_t position = (int16_t)__HAL_TIM_GET_COUNTER(&htim2);
```

The timer counter increments or decrements automatically based on the quadrature signal. For 32-bit timers (TIM2, TIM5 on many STM32 families), the counter handles millions of counts before wrapping.

## Index Pulse

Many encoders include a **Z (index) channel** that produces one pulse per revolution at a fixed position. This serves as an absolute reference:

```c
/* Capture index pulse on TIM3 CH1 input capture */
void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    if (htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
        /* Index pulse detected — record or reset position */
        int32_t position_at_index = (int32_t)__HAL_TIM_GET_COUNTER(&htim2);
        /* Use for homing or cumulative error correction */
    }
}
```

The index pulse allows the system to establish an absolute position reference after a homing move and to detect cumulative counting errors (missed or extra counts).

## Velocity Measurement

Two methods for calculating velocity from encoder counts:

### Period Measurement (Low Speed)

Measure the time between encoder edges using timer input capture:

```c
/* Velocity from period between edges */
float period_s = (float)captured_period / TIMER_FREQ;
float velocity_rps = 1.0f / (PPR * 4 * period_s);  /* Revolutions per second */
```

Good at low speeds (long periods = high resolution) but poor at high speeds (short periods = quantization error).

### Frequency Measurement (High Speed)

Count the number of encoder edges in a fixed time window:

```c
/* Velocity from count in fixed time window (e.g., 10 ms) */
int32_t delta_counts = current_count - prev_count;
float velocity_rps = (float)delta_counts / (PPR * 4 * SAMPLE_PERIOD_S);
```

Good at high speeds (many counts per window) but quantized at low speeds (few or zero counts per window).

### Hybrid Approach

Switch between period measurement (low speed) and frequency measurement (high speed) based on current velocity. The crossover point is where both methods have similar resolution — typically around 100–500 RPM depending on PPR.

## Encoder Specifications

| Parameter | Cheap Optical (LPD3806) | Mid-Range (Omron E6B2) | High-End (US Digital E5) |
|-----------|------------------------|----------------------|------------------------|
| PPR | 400 | 1000 | 2500 |
| 4× counts/rev | 1600 | 4000 | 10000 |
| Max speed | 5000 RPM | 6000 RPM | 10000 RPM |
| Output type | Open collector | Totem pole | Differential (RS-422) |
| Supply voltage | 5–24 V | 5–24 V | 5 V |
| Index channel | No | Yes | Yes |

## Tips

- Enable the digital input filter on the STM32 timer encoder interface (IC1Filter, IC2Filter). Values of 0x04–0x0F suppress noise glitches without adding significant latency. Without filtering, motor electrical noise can cause phantom counts.
- For 16-bit timers, handle wraparound in software by reading the counter frequently enough that it cannot wrap more than once between reads. At 1000 PPR in 4× mode and 3000 RPM, the count rate is 200,000/s — a 16-bit counter wraps every ~327 ms.
- Place a 100 nF ceramic capacitor on each encoder signal line (A, B, Z) near the MCU input. This, combined with the timer's digital filter, provides robust noise rejection.
- Use differential (RS-422) encoder signals for cable runs longer than 50 cm. Single-ended signals pick up motor noise and can produce false counts. A differential receiver (SN75179, AM26LS32) converts to logic levels at the MCU end.

## Caveats

- Encoder wires routed alongside motor power cables will pick up switching noise, producing phantom counts. The error is cumulative — each false edge permanently offsets the position counter. The only recovery is an index pulse or a homing routine.
- Optical encoders can fail intermittently when the LED ages or dust accumulates on the disc. The symptom is gradually increasing missed counts — subtle enough to appear as mechanical slip rather than sensor failure.
- The maximum count rate must not exceed the timer's input frequency capability. At 10,000 RPM with a 2500 PPR encoder in 4× mode, the edge rate is 1.67 MHz — within the capability of most STM32 timers but beyond what GPIO interrupt-based counting can handle.
- Mounting an encoder on the motor shaft (before the gearbox) gives high resolution but misses backlash in the gear train. Mounting after the gearbox captures the actual output position but at lower effective resolution.

## In Practice

- **Position counter drifts slowly over many revolutions.** Electrical noise from the motor driver injects false counts. Each noise pulse adds or subtracts one count, and the errors accumulate. Adding input filtering (RC + digital filter), separating encoder wires from motor power cables, or switching to differential signaling eliminates the drift.

- **Velocity measurement jumps between correct and zero at low speed.** The frequency-measurement method counts zero encoder edges in some sampling intervals when the motor is barely turning. Switching to period-based measurement (time between edges) at low speeds provides a stable reading.

- **Motor oscillates around the target position in a closed-loop PID system.** The encoder resolution is too coarse for the control loop's deadband. With 200 counts per revolution, each count spans 1.8° — the controller overshoots by one count, reverses, overshoots again. Increasing encoder PPR, adding a derivative term with filtering, or widening the deadband by one count resolves the oscillation.

- **Encoder reads correctly in one direction but double-counts in the other.** One channel has a poor signal (slow rise time, noise, or a cold solder joint) that crosses the logic threshold twice on each edge. The 4× counting mode registers two counts for what should be one. Checking both channels on a scope reveals the degraded signal; improving the connection or adding a Schmitt trigger input cleans it up.
