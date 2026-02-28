---
title: "Timer & Counter Peripherals"
weight: 70
bookCollapseSection: true
---

# Timer & Counter Peripherals

Timers are the most versatile peripherals on any MCU — the same hardware block that generates a PWM waveform can also measure an input frequency, decode a rotary encoder, or trigger an ADC conversion at precise intervals. On STM32, the timer peripheral family ranges from basic timers (TIM6/TIM7, count-up only, no outputs) through general-purpose timers (TIM2-TIM5, 4 channels, capture/compare) to advanced-control timers (TIM1/TIM8, complementary outputs, dead-time insertion, break input for motor control). Understanding the prescaler, auto-reload, and capture/compare registers is the foundation for every timer application.

This section covers timer configuration and application patterns: prescaler and auto-reload arithmetic for precise timing, PWM generation with duty cycle control, input capture for frequency and pulse-width measurement, and encoder mode for quadrature decoding.

## Pages

- **[Timer Prescaler & Auto-Reload Arithmetic]({{< relref "timer-prescaler-arithmetic" >}})** — How PSC and ARR determine timer frequency and period, the tradeoff between resolution and range, and worked examples for common timing requirements.
- **[PWM Generation Patterns]({{< relref "pwm-generation" >}})** — Output compare modes, duty cycle calculation, center-aligned vs edge-aligned PWM, complementary outputs, and dead-time insertion for motor drive.
- **[Input Capture & Frequency Measurement]({{< relref "input-capture" >}})** — Capturing timer values on input edges, measuring frequency and duty cycle, overflow handling, and DMA-assisted capture for high-frequency signals.
- **[Encoder Mode & Quadrature Decoding]({{< relref "encoder-mode" >}})** — Hardware quadrature decoding using timer encoder mode, counting direction detection, index pulse handling, and position tracking patterns.
