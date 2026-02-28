---
title: "PWM Generation Patterns"
weight: 20
---

# PWM Generation Patterns

PWM output is the most common timer application in embedded systems — LED dimming, motor speed control, servo positioning, and switch-mode power supply gate drive all rely on precisely timed high/low transitions. The STM32 timer peripheral generates hardware PWM without CPU intervention once configured: the counter free-runs, the output compare unit toggles the pin, and the CPU only intervenes to change the duty cycle. Getting from "a PWM signal exists" to "a production-quality PWM driver" requires understanding output compare modes, complementary outputs, dead-time insertion, and the break input — all of which live in timer registers, not software loops.

## Output Compare Modes: PWM Mode 1 and 2

Each timer channel has a Capture/Compare Register (CCRx) that sets the duty cycle threshold. In PWM Mode 1 (the most common), the output is active (high) when CNT < CCRx and inactive (low) when CNT >= CCRx. PWM Mode 2 inverts this: active when CNT >= CCRx.

| Mode | Output when CNT < CCR | Output when CNT >= CCR |
|------|----------------------|----------------------|
| PWM Mode 1 | Active (high) | Inactive (low) |
| PWM Mode 2 | Inactive (low) | Active (high) |

Duty cycle is simply `CCR / (ARR + 1)` for edge-aligned PWM. With ARR = 999 and CCR = 250, duty = 25.0%. Setting CCR = 0 produces 0% duty (output always low), and CCR > ARR produces 100% duty (output always high).

```c
/* 1 kHz PWM on TIM3 CH1 (PA6), 84 MHz timer clock */
__HAL_RCC_TIM3_CLK_ENABLE();
__HAL_RCC_GPIOA_CLK_ENABLE();

GPIO_InitTypeDef gpio = {0};
gpio.Pin       = GPIO_PIN_6;
gpio.Mode      = GPIO_MODE_AF_PP;
gpio.Pull      = GPIO_NOPULL;
gpio.Speed     = GPIO_SPEED_FREQ_HIGH;
gpio.Alternate = GPIO_AF2_TIM3;
HAL_GPIO_Init(GPIOA, &gpio);

TIM_HandleTypeDef htim3 = {0};
htim3.Instance               = TIM3;
htim3.Init.Prescaler         = 84 - 1;     /* 1 MHz tick */
htim3.Init.CounterMode       = TIM_COUNTERMODE_UP;
htim3.Init.Period            = 1000 - 1;    /* 1 kHz */
htim3.Init.ClockDivision     = TIM_CLOCKDIVISION_DIV1;
htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;
HAL_TIM_PWM_Init(&htim3);

TIM_OC_InitTypeDef oc = {0};
oc.OCMode     = TIM_OCMODE_PWM1;
oc.Pulse      = 500;              /* 50% duty */
oc.OCPolarity = TIM_OCPOLARITY_HIGH;
oc.OCFastMode = TIM_OCFAST_DISABLE;
HAL_TIM_PWM_ConfigChannel(&htim3, &oc, TIM_CHANNEL_1);
HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);
```

Changing the duty cycle at runtime requires only a CCR write:

```c
/* Update duty cycle to 75% without stopping the timer */
__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, 750);
```

The CCR register is double-buffered by default in PWM mode (preload enabled via OCxPE bit). The new value takes effect at the next update event, preventing glitches mid-cycle.

## PWM Resolution

The ARR value directly determines the number of discrete duty cycle steps. With ARR = 99, only 100 duty levels exist (0% to 100% in 1% steps). For LED dimming where human perception is logarithmic, coarse resolution produces visible stepping at low brightness. For power converters, coarse resolution increases output ripple.

| ARR | Duty steps | Resolution | Max PWM freq at 84 MHz (PSC=0) |
|-----|-----------|------------|-------------------------------|
| 99 | 100 | 1.0% | 840 kHz |
| 999 | 1000 | 0.1% | 84 kHz |
| 4199 | 4200 | ~0.024% | 20 kHz |
| 65535 | 65536 | ~0.0015% | 1.28 kHz |

A tradeoff exists between PWM frequency and duty cycle resolution — higher frequency requires a smaller ARR, reducing the number of available duty steps.

## Edge-Aligned vs Center-Aligned PWM

In edge-aligned (count-up) mode, the counter resets to 0 at overflow, producing a single switching edge per period. In center-aligned mode, the counter counts up to ARR then back down to 0, producing two compare matches per cycle — one on the way up, one on the way down. The output is naturally symmetric around the center of the period.

Center-aligned PWM is standard for three-phase motor control because:
- Switching events across phases are staggered, reducing DC bus current ripple
- The symmetric waveform has lower harmonic distortion
- ADC sampling at the counter peak or valley coincides with the midpoint of the current waveform, improving measurement accuracy

```c
/* Center-aligned PWM for motor control on TIM1 */
htim1.Init.CounterMode = TIM_COUNTERMODE_CENTERALIGNED1;
htim1.Init.Period      = 4200 - 1;  /* 168 MHz / 4200 / 2 = 20 kHz */
```

Note: in center-aligned mode, the effective PWM frequency is `f_clk / ((PSC+1) * 2 * ARR)` because the counter traverses ARR twice per period (up and down).

## Complementary Outputs and Dead-Time Insertion

Advanced timers (TIM1 and TIM8 on STM32F4/H7) provide complementary output pairs: CH1/CH1N, CH2/CH2N, CH3/CH3N. These drive half-bridge configurations where an N-channel high-side MOSFET and an N-channel low-side MOSFET must never conduct simultaneously.

The Break and Dead-Time Register (BDTR) controls dead-time insertion — a brief interval where both outputs are inactive, preventing shoot-through. The dead-time generator (DTG field, 8 bits) specifies the delay in timer clock cycles, with a nonlinear encoding:

| DTG[7:5] | Dead-time formula | Range at 168 MHz |
|-----------|------------------|-------------------|
| 0xx | DTG[6:0] × t_DTS | 0–762 ns |
| 10x | (64 + DTG[5:0]) × 2 × t_DTS | 762 ns–1.52 µs |
| 110 | (32 + DTG[4:0]) × 8 × t_DTS | 1.52–3.02 µs |
| 111 | (32 + DTG[4:0]) × 16 × t_DTS | 3.02–6.0 µs |

where `t_DTS` depends on the CKD (clock division) bits in TIMx_CR1.

```c
/* TIM1 complementary PWM with 500 ns dead-time at 168 MHz */
TIM_BreakDeadTimeConfigTypeDef bdt = {0};
bdt.DeadTime        = 84;                  /* 84 × (1/168 MHz) ≈ 500 ns */
bdt.BreakState      = TIM_BREAK_ENABLE;
bdt.BreakPolarity   = TIM_BREAKPOLARITY_HIGH;
bdt.AutomaticOutput = TIM_AUTOMATICOUTPUT_ENABLE;
bdt.OffStateRunMode = TIM_OSSR_ENABLE;
bdt.OffStateIDLEMode = TIM_OSSI_ENABLE;
HAL_TIMEx_ConfigBreakDeadTime(&htim1, &bdt);

/* Start complementary PWM on CH1 and CH1N */
HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_1);
HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_1);
```

## Break Input: Emergency Shutdown

The break input (BKIN pin) provides a hardware path to disable all timer outputs within one clock cycle — no interrupt latency, no software involvement. When the break input activates, all outputs transition to a predefined safe state (configured via OSSR and OSSI bits).

Typical applications:
- Overcurrent detection from a comparator output drives BKIN
- Motor controller fault (e.g., gate driver FAULT output)
- External emergency stop signal

```c
/* Break input on PA6 (BKIN of TIM1) — active high */
bdt.BreakState    = TIM_BREAK_ENABLE;
bdt.BreakPolarity = TIM_BREAKPOLARITY_HIGH;
bdt.BreakFilter   = 0xF;  /* Maximum input filter for noise rejection */
```

After a break event, the MOE (Main Output Enable) bit in BDTR is cleared. With `AutomaticOutput = TIM_AUTOMATICOUTPUT_ENABLE`, MOE re-asserts automatically at the next update event after the break input de-asserts. Without automatic output, firmware must explicitly set MOE to resume operation.

## MOSFET Drive Patterns

PWM outputs ultimately drive power transistors. The polarity and dead-time requirements depend on the bridge topology:

**Low-side N-channel MOSFET**: Direct drive from a push-pull timer output. PWM Mode 1 with active-high polarity drives the gate high to turn on. No complementary output needed.

**Half-bridge (high-side + low-side N-channel)**: Requires complementary outputs with dead-time. The high-side MOSFET needs a bootstrap or charge pump gate driver (e.g., IR2110, DRV8301). The timer drives the gate driver inputs; the driver handles level shifting.

**Full H-bridge**: Two complementary channel pairs (CH1/CH1N for one leg, CH2/CH2N for the other). Direction control comes from swapping which channel pair is PWM-modulated and which is held static.

## Tips

- Set CCR preload enable (OCxPE) in PWM mode — this is automatic when using `HAL_TIM_PWM_ConfigChannel()`, but when writing registers directly, forgetting to set CCMRx.OCxPE causes duty cycle changes to take effect mid-cycle, producing output glitches.
- For LED dimming, use ARR >= 1000 to get at least 10-bit equivalent resolution — human eyes detect brightness steps below about 8-bit resolution, especially at low duty cycles.
- Calculate dead-time from the MOSFET gate driver's turn-off propagation delay plus the MOSFET's turn-off time — adding 20–50% margin covers temperature variation and component tolerance. Typical dead-time for low-voltage MOSFETs is 100–500 ns.
- On ESP32, the MCPWM (Motor Control PWM) peripheral provides hardware dead-time and complementary outputs — use `mcpwm_deadtime_enable()` rather than implementing dead-time in software.

## Caveats

- **MOE (Main Output Enable) defaults to 0 on advanced timers** — TIM1 and TIM8 outputs remain tristated until MOE is set; `HAL_TIM_PWM_Start()` sets MOE automatically, but direct register code that forgets `TIM1->BDTR |= TIM_BDTR_MOE` produces no output with no error indication.
- **Dead-time encoding is nonlinear** — the DTG field does not map linearly to nanoseconds; a DTG value of 200 does not produce twice the dead-time of DTG=100. The four encoding ranges in BDTR must be consulted, or `HAL_TIMEx_ConfigBreakDeadTime()` used for correct computation.
- **Complementary outputs require GPIO AF configuration for both CHx and CHxN pins** — configuring only the main channel pin while forgetting the complementary pin is a common omission that leaves CHxN floating.
- **Break filter introduces latency** — setting BreakFilter to maximum (0xF) adds up to 32 timer clock cycles of input delay; for overcurrent protection, this delay (190 ns at 168 MHz) must be short enough to protect the power stage.
- **PWM duty cycle of exactly 0% and 100% behave differently across modes** — in PWM Mode 1, CCR=0 produces a constant low output, but CCR=ARR+1 (not CCR=ARR) is needed for true 100% duty; CCR=ARR produces a brief low pulse at the counter overflow.

## In Practice

- A motor driver that exhibits shoot-through (both high-side and low-side conducting simultaneously) on startup, blowing the fuse or tripping the protection, typically results from MOE being set before the dead-time configuration is applied — configure BDTR completely before enabling outputs.
- A PWM signal that appears correct on the scope but has a narrow glitch at the duty cycle transition point indicates the CCR preload is not enabled — the new CCR value takes effect immediately rather than at the update event, causing a partial cycle.
- An LED that flickers visibly at low brightness despite a stable CCR value often traces to insufficient PWM frequency — below 200 Hz, human flicker perception is engaged; increasing the timer frequency to 1 kHz or above while maintaining adequate ARR resolution resolves the flicker.
- A complementary output that measures 0 V on CHxN despite correct CH output typically reveals a missing GPIO alternate function configuration on the complementary pin — both the main and N-channel pins must be configured as AF push-pull with the correct AF number.
- A half-bridge that runs normally but fails under heavy load commonly indicates insufficient dead-time — the MOSFET turn-off time increases with temperature and load current, and marginal dead-time values that work on the bench fail at operating temperature.
