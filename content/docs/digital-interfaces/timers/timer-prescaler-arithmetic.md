---
title: "Timer Prescaler & Auto-Reload Arithmetic"
weight: 10
---

# Timer Prescaler & Auto-Reload Arithmetic

Every timer application on an MCU — whether generating a 50 Hz servo pulse, triggering a 1 ms systick interrupt, or counting encoder edges — begins with two registers: the prescaler (PSC) and the auto-reload (ARR). Together with the timer clock source, these two values determine the timer's overflow frequency. Getting the arithmetic wrong produces timing errors that compile cleanly, run without faults, and silently generate the wrong frequency.

## Timer Clock Source

On STM32F4, timers do not run directly from the system clock. Each timer is clocked from an APB (Advanced Peripheral Bus) timer clock, and the relationship between the system clock and the timer clock depends on the APB prescaler setting:

| APB Prescaler | Timer Clock Multiplier | Example (SYSCLK = 168 MHz) |
|---------------|----------------------|---------------------------|
| 1 (no division) | 1x | APB1 = 42 MHz → Timer = 42 MHz |
| 2 | 2x | APB1 = 42 MHz → Timer = 84 MHz |
| 4 | 2x | APB1 = 21 MHz → Timer = 42 MHz |

The critical rule: **when the APB prescaler is greater than 1, the timer clock is 2x the APB bus clock**. The STM32CubeMX clock tree visualizes this, but it is easy to misread. On a typical STM32F407 at 168 MHz with APB1 prescaler = 4, APB1 bus clock is 42 MHz, but TIM2-TIM7 (APB1 timers) receive 84 MHz. APB2 timers (TIM1, TIM8-TIM11) with APB2 prescaler = 2 receive 168 MHz.

On ESP32, the timer base clock defaults to APB_CLK (80 MHz). On RP2040, the system clock (typically 125 MHz) feeds the timer peripheral directly, with a fractional divider per timer.

## PSC and ARR: The Core Formula

The timer counter (CNT) increments at a frequency determined by the prescaler:

```
f_counter = f_timer_clk / (PSC + 1)
```

The counter counts from 0 up to ARR, then generates an update event and resets to 0. The overflow frequency is:

```
f_overflow = f_timer_clk / ((PSC + 1) * (ARR + 1))
```

The `+1` on both terms exists because the hardware counts inclusively — a PSC value of 0 means divide-by-1, and an ARR value of 999 means the counter counts 1000 ticks (0 through 999) before overflow.

## Worked Example: 1 ms Interrupt at 84 MHz

Target: 1 kHz update interrupt from TIM2 on STM32F407 (timer clock = 84 MHz).

The equation to satisfy: `84,000,000 / ((PSC+1) * (ARR+1)) = 1000`

This means `(PSC+1) * (ARR+1) = 84,000`. Multiple PSC/ARR pairs work:

| PSC | ARR | Counter frequency | Notes |
|-----|-----|------------------|-------|
| 83 | 999 | 1 MHz | Clean 1 µs tick, 1000 counts to overflow |
| 839 | 99 | 100 kHz | Coarser tick, fewer counts |
| 0 | 83999 | 84 MHz | Maximum resolution, large ARR |

The PSC=83, ARR=999 choice is conventional — it produces a 1 µs counter tick, which is convenient for sub-millisecond timing and easy to reason about.

```c
/* TIM2: 1 ms update interrupt on STM32F4 (84 MHz timer clock) */
__HAL_RCC_TIM2_CLK_ENABLE();

TIM_HandleTypeDef htim2 = {0};
htim2.Instance               = TIM2;
htim2.Init.Prescaler         = 84 - 1;    /* 84 MHz / 84 = 1 MHz tick */
htim2.Init.CounterMode       = TIM_COUNTERMODE_UP;
htim2.Init.Period            = 1000 - 1;   /* 1 MHz / 1000 = 1 kHz */
htim2.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
HAL_TIM_Base_Init(&htim2);
HAL_TIM_Base_Start_IT(&htim2);
```

## Worked Example: 50 Hz Servo PWM at 168 MHz

Target: 50 Hz PWM for a hobby servo from TIM1 on STM32F407 (timer clock = 168 MHz).

`168,000,000 / ((PSC+1) * (ARR+1)) = 50` → `(PSC+1) * (ARR+1) = 3,360,000`

A useful choice: PSC = 167, ARR = 19999.

- Counter ticks at `168 MHz / 168 = 1 MHz` (1 µs resolution)
- 20,000 counts × 1 µs = 20 ms period (50 Hz)
- Servo pulse of 1.5 ms corresponds to CCR = 1500

```c
/* TIM1: 50 Hz servo PWM (168 MHz timer clock) */
htim1.Init.Prescaler = 168 - 1;   /* 1 µs tick */
htim1.Init.Period    = 20000 - 1;  /* 20 ms period */
/* CCR1 = 1500 for 1.5 ms pulse (servo center) */
__HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_1, 1500);
```

## 16-Bit vs 32-Bit Timers

Most STM32 timers have 16-bit PSC and ARR registers, limiting each to 0–65535. On STM32F4, TIM2 and TIM5 are 32-bit timers — their ARR and CNT registers extend to 0–4,294,967,295. This distinction matters when long periods or fine resolution are needed simultaneously:

| Timer | ARR Width | Max period at 1 µs tick | Max period at 84 MHz (PSC=0) |
|-------|-----------|------------------------|------------------------------|
| TIM3 (16-bit) | 16 bits | 65.536 ms | 780 µs |
| TIM2 (32-bit) | 32 bits | ~4295 seconds | ~51.1 seconds |

For applications requiring both long period and fine resolution — such as a precision stopwatch or low-frequency capture — the 32-bit timers eliminate the need to handle software overflow counting.

## Counting Modes

STM32 general-purpose timers support three counting modes:

**Count-up** (default): CNT counts from 0 to ARR, generates update event, resets to 0. The update interrupt fires once per period.

**Count-down**: CNT counts from ARR down to 0, generates update event, reloads ARR. Functionally equivalent to count-up for frequency generation.

**Center-aligned**: CNT counts from 0 up to ARR, then back down to 0. The update event fires at both the top (ARR) and bottom (0), producing a PWM frequency that is half the overflow rate of an equivalent edge-aligned configuration. Center-aligned mode is essential for motor control (symmetric PWM reduces current ripple) and is the default mode for complementary PWM on TIM1/TIM8.

```c
/* Center-aligned mode 1: update interrupt on count-down only */
htim1.Init.CounterMode = TIM_COUNTERMODE_CENTERALIGNED1;

/* Center-aligned mode 3: update interrupt on both count-up and count-down */
htim1.Init.CounterMode = TIM_COUNTERMODE_CENTERALIGNED3;
```

In center-aligned mode, the effective PWM frequency is `f_timer_clk / ((PSC+1) * 2 * ARR)` — note the factor of 2 and the absence of `+1` on ARR because the counter visits ARR once per up-down cycle.

## Update Event Generation and Preloading

The auto-reload preload (ARPE bit in TIMx_CR1) controls when a new ARR value takes effect. With preload enabled, writing a new value to ARR loads it into a shadow register; the active ARR updates only at the next update event. With preload disabled, the new ARR value takes effect immediately, which can cause the counter to miss an overflow if the new ARR is less than the current CNT value.

```c
/* Enable ARR preload — recommended for any application that changes period */
htim2.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
```

A software-triggered update event (setting UG bit in TIMx_EGR) forces an immediate reload of all shadow registers without waiting for the counter to overflow. This is useful for initializing a timer to known state:

```c
/* Force update event to load PSC and ARR immediately */
TIM2->EGR = TIM_EGR_UG;
/* Clear the update interrupt flag set by UG */
__HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
```

## Tips

- Choose PSC to produce a round counter frequency (1 MHz, 10 MHz) — this makes ARR values and CCR duty calculations human-readable and reduces arithmetic errors during development.
- Always use the `- 1` form explicitly in code (`Prescaler = 84 - 1`) rather than writing the raw value (`Prescaler = 83`) — the intent is clearer and matches the datasheet formula.
- Enable auto-reload preload (ARPE) whenever the period might change at runtime — without it, glitches appear as shortened or skipped cycles when ARR is updated mid-count.
- On RP2040, the `hardware_pwm` SDK provides `pwm_set_clkdiv()` with an 8.4 fixed-point fractional divider — fractional division enables frequencies that integer-only prescalers cannot hit exactly.

## Caveats

- **The 2x timer clock multiplier only applies when the APB prescaler is greater than 1** — assuming the timer always runs at 2x APB leads to a factor-of-2 frequency error on configurations where APB prescaler = 1 (common in low-power modes or custom clock trees).
- **PSC is itself buffered by default** — writing a new prescaler value does not take effect until the next update event; calling `TIM->EGR = TIM_EGR_UG` forces an immediate load, but also resets CNT to 0 and sets the update interrupt flag.
- **CubeMX displays PSC and ARR with the +1 already applied in some views** — the "Counter Period" field in CubeMX shows the raw register value (e.g., 999), not the count (1000); misreading this produces off-by-one errors that shift the frequency by 0.1% at ARR=999 but by 50% at ARR=1.
- **16-bit overflow is silent** — writing 100,000 to the Period field of a 16-bit timer's HAL init structure truncates to the low 16 bits (34,464) without warning at compile time; the resulting frequency is wrong but the timer runs normally.
- **Center-aligned frequency is half of edge-aligned for the same ARR** — forgetting the factor of 2 doubles the PWM frequency, which can push a motor driver's switching losses outside the safe operating area.

## In Practice

- A timer interrupt firing at half the expected rate on STM32F4 usually traces to a wrong assumption about the APB timer clock multiplier — checking `HAL_RCC_GetPCLK1Freq()` and comparing it against the timer input clock in CubeMX's clock tree confirms the actual source frequency.
- A 16-bit timer that works perfectly at short periods but produces wildly wrong frequencies at longer periods typically reveals an ARR value that silently overflowed the 16-bit register — switching to TIM2 or TIM5 (32-bit) resolves the issue without firmware changes beyond the timer instance.
- A servo that jitters at its endpoints despite stable CCR values often comes from choosing a low ARR value (coarse resolution) — with ARR = 999 at 50 Hz, each count is 20 µs, and the 1000–2000 µs servo range spans only 50 steps; increasing ARR to 19999 provides 1 µs resolution and eliminates quantization jitter.
- A system tick that drifts by a few ppm relative to an external reference clock usually indicates that the PSC/ARR product does not divide evenly into the timer clock — the remainder accumulates as a frequency error that is constant but nonzero.
