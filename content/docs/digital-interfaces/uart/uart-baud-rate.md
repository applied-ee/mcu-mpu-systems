---
title: "Baud Rate Generation & Accuracy"
weight: 10
---

# Baud Rate Generation & Accuracy

Every UART frame is clocked by the baud rate generator inside the USART peripheral. Unlike SPI or I2C, UART has no shared clock line — both transmitter and receiver must independently generate the same bit timing from their own clocks. The baud rate register (BRR) divides the peripheral clock down to the target rate, and the accuracy of that division determines whether communication works or produces garbled data. A mismatch beyond roughly 3% between transmitter and receiver causes bit-sampling errors that corrupt every frame.

## BRR Calculation

The fundamental formula on STM32 is:

```
USARTDIV = f_ck / baud_rate
```

where `f_ck` is the USART peripheral's input clock (APB1 or APB2, depending on which USART instance). The BRR register holds this value in a fixed-point format: the upper 12 bits are the mantissa (integer part), and the lower 4 bits are the fraction (when oversampling by 16).

Concrete example: USART2 on STM32F407, clocked from APB1 at 42 MHz, targeting 115200 baud:

```
USARTDIV = 42,000,000 / 115,200 = 364.583...
Mantissa = 364 = 0x16C
Fraction = 0.583 * 16 = 9.33 → round to 9 = 0x9
BRR = (364 << 4) | 9 = 0x16C9
```

The actual baud rate produced is 42,000,000 / 364.5625 = 115,176 baud, an error of -0.02%. This is well within tolerance.

A less favorable example: 42 MHz targeting 921600 baud:

```
USARTDIV = 42,000,000 / 921,600 = 45.573...
Mantissa = 45
Fraction = 0.573 * 16 = 9.17 → round to 9
BRR = (45 << 4) | 9 = 0x2D9
Actual baud = 42,000,000 / 45.5625 = 921,659 → error = +0.006%
```

Still fine. But at 42 MHz targeting 2 Mbaud:

```
USARTDIV = 42,000,000 / 2,000,000 = 21.0
BRR = (21 << 4) | 0 = 0x150
Actual = 2,000,000 exactly — 0% error
```

Not every combination works out cleanly. The STM32 HAL performs this calculation in `UART_SetConfig()`:

```c
/* STM32 HAL internal — simplified */
uint32_t pclk = HAL_RCC_GetPCLK1Freq();
uint16_t usartdiv = (uint16_t)(pclk / huart->Init.BaudRate);
huart->Instance->BRR = usartdiv;
```

The HAL handles the rounding and oversampling mode automatically, but understanding the underlying division is essential for diagnosing baud rate errors.

## Oversampling: 16x vs 8x

By default, the USART samples each bit 16 times. The receiver uses the middle samples (7th, 8th, 9th) to determine the bit value by majority vote. This provides noise immunity but limits the maximum baud rate to `f_ck / 16`.

Setting the OVER8 bit in USART_CR1 switches to 8x oversampling. The BRR format changes: the fraction field uses only 3 bits (0-7) instead of 4. The maximum achievable baud rate doubles to `f_ck / 8`. On a 42 MHz APB1 clock, 16x oversampling caps out at 2.625 Mbaud; 8x oversampling extends to 5.25 Mbaud.

The trade-off: 8x oversampling reduces the noise rejection margin. In electrically noisy environments or with long cable runs, 16x oversampling is more robust.

```c
/* Enable 8x oversampling for higher baud rates */
huart2.Init.OverSampling = UART_OVERSAMPLING_8;
```

## Common Clock / Baud Rate Error Table

| Peripheral Clock | Target Baud | USARTDIV | Actual Baud | Error % |
|-----------------|-------------|----------|-------------|---------|
| 42 MHz (APB1)   | 9600       | 4375.0   | 9600        | 0.00%   |
| 42 MHz (APB1)   | 115200     | 364.583  | 115,176     | -0.02%  |
| 84 MHz (APB2)   | 115200     | 729.167  | 115,191     | -0.01%  |
| 16 MHz (HSI)    | 115200     | 138.889  | 115,108     | -0.08%  |
| 16 MHz (HSI)    | 9600       | 1666.667 | 9600        | 0.00%   |
| 40 MHz (ESP32)  | 115200     | 347.222  | 115,200     | 0.00%*  |
| 48 MHz (RP2040) | 115200     | 416.667  | 115,207     | +0.006% |

*ESP32 uses a fractional divider with higher resolution than STM32.

## Crystal vs Internal RC Oscillator

The BRR calculation assumes the input clock frequency is exact. With an HSE crystal (8 MHz, 25 MHz), the frequency accuracy is typically +/-20 ppm — negligible for UART purposes. With the HSI internal RC oscillator, accuracy varies dramatically by family:

- **STM32F4 HSI**: 16 MHz +/- 1% (factory trimmed). At 115200 baud, 1% clock error plus 0.02% divider error stays under the 3% threshold, but barely — especially if the other end also has 1% clock error.
- **STM32H7 HSI**: 64 MHz +/- 1% — same percentage issue at a higher base frequency.
- **ESP32**: uses a 40 MHz crystal by default; the internal 8 MHz RC oscillator is calibrated against it. UART from the RC oscillator alone is unreliable.
- **RP2040**: the internal ring oscillator (ROSC) runs at roughly 6.5 MHz with +/- 50% variation across temperature and voltage. It is not usable for UART. The crystal oscillator (XOSC) at 12 MHz is required for any baud rate communication.

Two devices both running from uncalibrated RC oscillators can accumulate a combined error exceeding 3%, causing persistent framing errors.

## LPUART for Very Low Baud Rates

The STM32 LPUART (Low-Power UART) peripheral uses a 256x oversampling factor internally, allowing baud rates as low as 9600 from a 32.768 kHz LSE clock. This enables UART communication in Stop modes where the main oscillators are shut down. The BRR calculation is different:

```
LPUART_BRR = (256 * f_ck) / baud_rate
```

At 32.768 kHz targeting 9600 baud: LPUART_BRR = 256 * 32768 / 9600 = 874.0 — exactly representable, producing 0% error. The LPUART peripheral is available on STM32L4, STM32U5, and STM32H7 families.

## The 3% Error Threshold

The UART receiver samples each bit near the center of the bit period. Over a 10-bit frame (1 start + 8 data + 1 stop), cumulative timing drift from a baud rate mismatch shifts the sampling point away from the bit center. At approximately 3% total error (sum of transmitter and receiver error), the sampling point for the last data bit drifts past the bit boundary, sampling the wrong bit. At 4-5% error, multiple bits per frame are corrupted. The 3% figure assumes 16x oversampling with center-sample voting; 8x oversampling reduces the margin slightly.

## Tips

- Verify the actual peripheral clock frequency with `HAL_RCC_GetPCLK1Freq()` or by reading the RCC prescaler registers before trusting baud rate calculations — incorrect APB prescaler assumptions are a common source of baud rate errors
- Prefer HSE-derived clocks for UART peripherals when communicating with external devices — the +/- 1% tolerance of HSI is workable but leaves almost no margin when the other end also uses an internal oscillator
- At baud rates above 1 Mbaud, switch to 8x oversampling explicitly — 16x oversampling cannot reach those rates, and the HAL may silently clamp to a lower baud rate
- When using LPUART for low-power wake-up, confirm the LSE is running before entering Stop mode — if the LSE fails to start, the LPUART peripheral has no clock and incoming data is lost entirely
- Standard "safe" baud rates (9600, 19200, 38400, 57600, 115200) divide cleanly from most common clock frequencies — 76800 and 230400 are more prone to rounding error on certain clocks

## Caveats

- **Changing the system clock without recalculating BRR silently corrupts UART** — If the PLL configuration changes at runtime (e.g., entering a low-power clock mode), all UART baud rate registers become invalid. The UART continues transmitting at the wrong rate with no error flag or interrupt
- **HSI drift over temperature degrades baud rate accuracy** — The +/- 1% HSI spec is measured at 25 degC. At -40 degC or +85 degC, the actual frequency can drift further, pushing total error past the 3% threshold
- **Two HSI-clocked devices communicating with each other double the error** — Each side contributes up to 1% independently. If both drift in opposite directions, the combined mismatch reaches 2%, leaving only 1% margin for the divider rounding
- **The HAL does not warn about unachievable baud rates** — Requesting 3 Mbaud on a 42 MHz APB1 clock with 16x oversampling is impossible, but `HAL_UART_Init()` returns `HAL_OK` and programs the closest achievable rate, which may be far from the target
- **8x oversampling reduces noise immunity** — In environments with electrical noise (motors, relays, long cables), the reduced sampling window makes bit errors more likely even when the baud rate itself is correct

## In Practice

- Garbled output that produces occasional readable characters mixed with garbage typically indicates a baud rate mismatch in the 2-5% range — the receiver catches some bits correctly but drifts out of alignment by the end of each frame. A logic analyzer measurement of the actual bit period on TX confirms whether the transmitter's baud rate matches the intended value.

- A UART link that works reliably at room temperature but fails in a cold chamber or hot enclosure often traces to HSI clock drift — the RC oscillator frequency shifts with temperature, pushing the baud rate error past the 3% threshold. Switching to an HSE-derived clock eliminates the temperature dependence.

- Communication that works at 9600 baud but fails at 921600 baud on the same hardware pair suggests the divider rounding error is amplified at higher rates. Lower USARTDIV values have larger percentage steps between adjacent BRR settings. Computing the actual error percentage for the target rate on the specific peripheral clock frequency reveals whether the error exceeds 1-2%.

- A UART peripheral that appears completely dead — no output on the TX pin — after a clock tree change is not a GPIO or UART configuration issue. The peripheral clock enable bit in RCC is still set, but the underlying APB clock frequency changed, making BRR produce a rate so far from the target that the receiver cannot synchronize at all.
