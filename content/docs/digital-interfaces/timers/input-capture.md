---
title: "Input Capture & Frequency Measurement"
weight: 30
---

# Input Capture & Frequency Measurement

Input capture mode turns a timer into a measurement instrument: on each selected edge of an input signal, the hardware latches the current counter value (CNT) into the Capture/Compare Register (CCRx). No interrupt latency affects the measurement — the capture happens in hardware at the timer clock resolution. By comparing successive captures, firmware can compute the period, frequency, or duty cycle of an external signal. The technique applies to tachometer pulses, ultrasonic echo timing, infrared decoder protocols, and any application where the timing of external events matters.

## Input Capture Basics

When a timer channel is configured in input capture mode, an edge on the input pin (TIx) triggers the hardware to copy CNT into CCRx and optionally generate an interrupt or DMA request. The captured value represents the exact timer count at the moment of the edge.

For frequency measurement, two consecutive rising-edge captures give the period in timer ticks:

```
period_ticks = capture_2 - capture_1
frequency = f_counter / period_ticks
```

where `f_counter = f_timer_clk / (PSC + 1)`.

```c
/* TIM2 CH1 input capture on PA0 — STM32F4, 84 MHz timer clock */
__HAL_RCC_TIM2_CLK_ENABLE();
__HAL_RCC_GPIOA_CLK_ENABLE();

GPIO_InitTypeDef gpio = {0};
gpio.Pin       = GPIO_PIN_0;
gpio.Mode      = GPIO_MODE_AF_PP;
gpio.Pull      = GPIO_NOPULL;
gpio.Alternate = GPIO_AF1_TIM2;
HAL_GPIO_Init(GPIOA, &gpio);

TIM_HandleTypeDef htim2 = {0};
htim2.Instance           = TIM2;
htim2.Init.Prescaler     = 84 - 1;    /* 1 MHz counter (1 µs resolution) */
htim2.Init.CounterMode   = TIM_COUNTERMODE_UP;
htim2.Init.Period        = 0xFFFFFFFF; /* TIM2 is 32-bit: max period */
htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
HAL_TIM_IC_Init(&htim2);

TIM_IC_InitTypeDef ic = {0};
ic.ICPolarity  = TIM_ICPOLARITY_RISING;
ic.ICSelection = TIM_ICSELECTION_DIRECTTI;
ic.ICPrescaler = TIM_ICPSC_DIV1;
ic.ICFilter    = 0x03;    /* Light input filtering */
HAL_TIM_IC_ConfigChannel(&htim2, &ic, TIM_CHANNEL_1);
HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1);
```

## Frequency Measurement With Overflow Counting

When measuring low-frequency signals with a 16-bit timer, the counter may overflow between captures. The solution is to count overflows in the update interrupt and incorporate them into the period calculation:

```c
static volatile uint32_t overflow_count = 0;
static volatile uint32_t last_capture = 0;
static volatile uint32_t measured_period = 0;

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM3) {
        overflow_count++;
    }
}

void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM3 && htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
        uint32_t current_capture = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);

        measured_period = (overflow_count * (htim->Init.Period + 1))
                        + current_capture - last_capture;

        last_capture    = current_capture;
        overflow_count  = 0;
    }
}
```

With a 16-bit timer at 1 MHz counter rate, each overflow represents 65.536 ms. For a 10 Hz signal (100 ms period), approximately 1–2 overflows occur between captures. The 32-bit `measured_period` accommodates signals down to fractions of a hertz.

Using a 32-bit timer (TIM2 or TIM5 on STM32F4) eliminates overflow handling entirely for most practical frequency ranges. At 1 MHz counter rate, a 32-bit counter overflows after ~4295 seconds (~71 minutes), making overflow counting unnecessary for any signal above ~0.004 Hz.

## Duty Cycle Measurement: Two Channels, One Input

Measuring both frequency and duty cycle of a signal requires capturing both rising and falling edges with timestamps. STM32 timers support this using two channels configured on the same input (TI1):

- Channel 1: captures on rising edge via TI1FP1 (direct input)
- Channel 2: captures on falling edge via TI1FP2 (indirect input, crosswired to TI1)

```c
/* Channel 1: rising edge, direct connection to TI1 */
TIM_IC_InitTypeDef ic_rising = {0};
ic_rising.ICPolarity  = TIM_ICPOLARITY_RISING;
ic_rising.ICSelection = TIM_ICSELECTION_DIRECTTI;
ic_rising.ICPrescaler = TIM_ICPSC_DIV1;
ic_rising.ICFilter    = 0x03;
HAL_TIM_IC_ConfigChannel(&htim2, &ic_rising, TIM_CHANNEL_1);

/* Channel 2: falling edge, indirect connection to TI1 */
TIM_IC_InitTypeDef ic_falling = {0};
ic_falling.ICPolarity  = TIM_ICPOLARITY_FALLING;
ic_falling.ICSelection = TIM_ICSELECTION_INDIRECTTI;
ic_falling.ICPrescaler = TIM_ICPSC_DIV1;
ic_falling.ICFilter    = 0x03;
HAL_TIM_IC_ConfigChannel(&htim2, &ic_falling, TIM_CHANNEL_2);

HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1);
HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_2);
```

In the capture callback:

```c
static volatile uint32_t rise_capture = 0;
static volatile uint32_t period_ticks = 0;
static volatile uint32_t high_ticks   = 0;

void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    if (htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
        /* Rising edge — period measurement */
        uint32_t current = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);
        period_ticks = current - rise_capture;
        rise_capture = current;
    }
    else if (htim->Channel == HAL_TIM_ACTIVE_CHANNEL_2) {
        /* Falling edge — high-time measurement */
        uint32_t fall = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_2);
        high_ticks = fall - rise_capture;
    }
}
/* Duty cycle = (float)high_ticks / (float)period_ticks * 100.0 */
```

This technique works because both captures reference the same free-running counter, so the subtraction yields the exact duration regardless of absolute counter position.

## Direct Frequency vs Period Measurement

Two fundamentally different approaches exist for frequency measurement:

**Period measurement** (described above): Capture the time between two edges of the signal under test. Accuracy improves with lower frequencies (longer periods = more counter ticks = finer resolution). At high frequencies the period becomes only a few counter ticks, and quantization error dominates.

**Direct frequency measurement**: Count the number of signal edges within a fixed time window (gate time). A second timer provides the gate. Accuracy improves with higher frequencies (more edges per gate = finer resolution).

| Method | Best for | Resolution at 1 MHz counter | 1-second gate |
|--------|---------|----------------------------|---------------|
| Period measurement | < 10 kHz | 1 µs resolution on period | N/A |
| Direct frequency counting | > 1 kHz | N/A | ±1 Hz resolution |

For a 100 Hz signal, period measurement with a 1 MHz counter yields 10,000 ticks — 0.01% resolution. Direct counting over 1 second yields 100 ±1 counts — 1% resolution. For a 1 MHz signal, period measurement yields 1 tick (useless), while direct counting yields 1,000,000 ±1 counts (0.0001%).

The crossover point where both methods give similar accuracy is typically in the 1–10 kHz range at a 1 MHz counter frequency.

## DMA-Assisted Capture for High-Frequency Signals

At high signal frequencies, interrupt-based capture fails because the ISR execution time exceeds the signal period. DMA solves this by transferring captured values directly to a memory buffer without CPU intervention:

```c
/* DMA capture: store 256 successive captures in a buffer */
uint32_t capture_buffer[256];

HAL_TIM_IC_Start_DMA(&htim2, TIM_CHANNEL_1,
                     capture_buffer, 256);
```

After the DMA transfer completes (half-transfer or transfer-complete callback), firmware processes the buffer offline — computing differences between successive entries to derive period statistics (mean, min, max, jitter).

This approach handles signals up to `f_counter / 2` reliably, limited only by DMA bandwidth. On STM32F4, DMA can sustain one 32-bit transfer per timer clock cycle, so captures at the full 84 MHz counter rate are theoretically possible, though practical limits arise from memory bandwidth contention with other DMA channels.

## Input Filter Configuration

The input capture filter (ICF bits in TIMx_CCMR1/CCMR2) provides hardware noise rejection by requiring the input to remain stable for a configurable number of samples before a capture triggers. The filter uses a sampling clock derived from either the timer clock or the DTS (dead-time and sampling) clock:

| ICF value | Sampling frequency | Samples required | Effective filter |
|-----------|-------------------|-----------------|-----------------|
| 0x0 | No filter | 1 | None |
| 0x1 | f_CK_INT | 2 | Light |
| 0x3 | f_CK_INT / 2 | 8 | Moderate |
| 0xF | f_DTS / 32 | 8 | Heavy |

For signals from open-collector sensors with long wire runs (e.g., a hall-effect tachometer on a 1-meter cable), ICF = 0x03 to 0x05 rejects bounce and ringing without introducing significant measurement delay. For clean signals from logic-level outputs, ICF = 0 or 0x01 minimizes latency.

```c
/* Heavy input filtering for a noisy tachometer signal */
ic.ICFilter = 0x0F;
```

The filter adds a fixed delay to the capture timestamp — this delay is deterministic and constant, so it introduces an offset but no jitter. For period measurement (difference between two captures), the offset cancels out.

## Tips

- Use a 32-bit timer (TIM2 or TIM5) for input capture whenever available — the elimination of overflow handling simplifies the code and removes an entire class of race conditions between the capture and update interrupts.
- Set PSC to give the finest resolution that does not overflow within the expected measurement range — for a tachometer measuring 100–10,000 RPM, a 1 MHz counter (1 µs resolution) provides 600,000 to 6,000 ticks per revolution, well within 32-bit range with excellent resolution.
- Enable the input filter (ICF >= 1) for any signal that travels more than a few centimeters on a PCB trace — crosstalk and ground bounce cause false edges that produce spurious short-period captures.
- For signals faster than ~100 kHz, switch from interrupt-based capture to DMA-based capture — the interrupt overhead (entry, handler, exit) on Cortex-M4 is typically 1–3 µs, which becomes a significant fraction of the signal period.

## Caveats

- **Overflow race condition on 16-bit timers**: If the counter overflows between the last update interrupt and the next capture, the overflow count may be off by one. The classic fix is to check the update interrupt flag (UIF) inside the capture ISR — if UIF is set and the captured value is small (near zero), an overflow occurred before the capture, and `overflow_count` needs incrementing.
- **ICSelection crosswiring is not obvious** — `TIM_ICSELECTION_INDIRECTTI` on Channel 2 connects it to TI1 (Channel 1's input), not to TI2; this mapping is fixed in hardware and swapping channel assignments does not work as expected.
- **DMA capture buffer alignment matters on Cortex-M7** — on STM32H7, the DMA buffer must be in a non-cacheable memory region or cache maintenance (SCB_CleanDCache / SCB_InvalidateDCache) must be performed; otherwise, the CPU reads stale data from the D-cache while DMA writes directly to SRAM.
- **Input capture prescaler (ICPSC) reduces interrupt rate but discards intermediate edges** — setting ICPSC to DIV4 captures every 4th edge, which reduces CPU load but means the measured period spans 4 signal cycles, not 1; this is useful for high-frequency signals but incorrect if single-cycle jitter measurement is required.
- **Floating input pins generate captures from noise** — an unconnected timer input with no pull resistor toggles randomly due to EMI pickup, producing a stream of spurious capture interrupts that consume CPU time and corrupt measurements.

## In Practice

- A frequency measurement that returns wildly varying values on a clean signal typically reveals a missing or insufficient input filter — noise on the input triggers extra captures at very short intervals, producing alternating short and long period readings.
- A tachometer reading that is exactly half or double the expected frequency indicates either a rising/falling edge polarity mismatch (capturing once per cycle instead of once per pulse) or an ICF setting that filters out legitimate edges on fast signals.
- DMA capture buffers that contain correct values for the first few entries but zeros or repeated values thereafter typically indicate the DMA stream is not configured for the correct data width — a 32-bit timer capture requires word-size DMA transfers; half-word transfers capture only the lower 16 bits and zero-extend.
- A duty cycle measurement that reads 0% or 100% regardless of the actual signal often traces to both channels being configured as DIRECTTI instead of one as INDIRECTTI — both channels then capture from their own respective input pins rather than sharing TI1.
- An input capture system that works on the bench but misses edges in the field, especially on long cable runs with motor drives nearby, needs increased ICF filtering and possibly an external RC filter (100 pF + 1 kΩ) at the MCU input pin to attenuate high-frequency EMI below the Schmitt trigger hysteresis.
