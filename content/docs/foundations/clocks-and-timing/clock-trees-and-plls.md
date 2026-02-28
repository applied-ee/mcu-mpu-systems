---
title: "Clock Trees & PLL Configuration"
weight: 20
---

# Clock Trees & PLL Configuration

The clock tree is the distribution network that transforms a base oscillator frequency into the various clock domains an MCU needs: a fast system clock for the CPU core, slower bus clocks for peripherals, and dedicated clocks for USB, ADC, and other subsystems. At the center of most clock trees sits a PLL (Phase-Locked Loop) that multiplies the input frequency up to the desired system clock speed. Getting the clock tree wrong produces symptoms ranging from peripherals running at the wrong speed to hard faults from flash access violations.

## PLL Structure and Configuration

A typical STM32 PLL takes an input clock (HSI or HSE), divides it by M, multiplies by N, then divides by P (for the system clock) or Q (for USB/SDIO). The formula is: PLL output = (input / M) * N / P.

Concrete example on STM32F407 with 8 MHz HSE: M=8, N=336, P=2 yields (8/8) * 336 / 2 = 168 MHz SYSCLK. The Q divider set to 7 produces (8/8) * 336 / 7 = 48 MHz for USB, which is the exact frequency USB Full Speed requires.

Second example on STM32H743 with 25 MHz HSE: the H7 series has three independent PLLs (PLL1, PLL2, PLL3), each with its own M/N/P/Q/R dividers. A typical PLL1 configuration uses M=5, N=192, P=2 to produce (25/5) * 192 / 2 = 480 MHz SYSCLK. PLL2 can independently generate 48 MHz for USB, and PLL3 can drive SAI audio peripherals at a precise audio sample rate clock. Having multiple PLLs eliminates the constraint of deriving every clock domain from a single VCO frequency — each PLL's VCO can target a different frequency optimized for its output domain.

On the ESP32, the PLL configuration follows a different model. The ESP32 uses a 40 MHz crystal input and an internal PLL that generates 320 MHz or 480 MHz, from which the CPU clock (80/160/240 MHz) is derived by fixed dividers. The configuration is simpler than STM32 — selecting a CPU frequency in the SDK implicitly sets the PLL — but the underlying PLL lock and stability requirements are the same.

The VCO (Voltage-Controlled Oscillator) inside the PLL has a valid frequency range — on the STM32F4, this is 100-432 MHz. The input to the VCO after the M divider must fall within 1-2 MHz. Violating either constraint results in an unstable or non-starting PLL, which often manifests as the MCU falling back to the HSI silently.

## Bus Clock Domains and Prescalers

Below the system clock, prescalers divide SYSCLK into bus domains. The hierarchy flows: SYSCLK feeds HCLK (the AHB bus clock) through the AHB prescaler. HCLK then feeds the APB1 and APB2 buses through their own prescalers. On the STM32F4 at 168 MHz: AHB/HCLK runs at SYSCLK (168 MHz max), APB1 (low-speed peripherals like USART2/3, SPI2/3, I2C, basic timers) runs at SYSCLK/4 = 42 MHz max, and APB2 (high-speed peripherals like USART1/6, SPI1, ADC, advanced timers) runs at SYSCLK/2 = 84 MHz max. The DMA controllers, GPIO ports, and flash interface all sit on the AHB bus and run at the full HCLK frequency.

Timers on APB1 and APB2 get a 2x multiplier when the APB prescaler is not 1, so APB1 timers actually clock at 84 MHz and APB2 timers at 168 MHz. The rule is precise: if the APB prescaler equals 1, the timer clock equals the APB bus clock. If the APB prescaler is anything other than 1 (2, 4, 8, or 16), the timer input clock is doubled relative to the APB bus clock. This means APB1 timers at 42 MHz x 2 = 84 MHz, and APB2 timers at 84 MHz x 2 = 168 MHz. The doubling exists because timer peripherals are designed to run faster than the bus interface that configures them.

This timer clock doubling is a frequent source of confusion — a timer configured for a 1 ms period using the APB1 clock frequency of 42 MHz will actually run at half the expected period because the timer input clock is 84 MHz.

## Flash Wait States

The flash memory cannot be read as fast as the CPU can execute. At 168 MHz on STM32F4 with 3.3V supply, 5 wait states are required. At 100 MHz, 3 wait states suffice. The flash access control register (FLASH_ACR) must be configured before or simultaneously with the clock speed increase — setting the clock to 168 MHz with 0 wait states causes immediate hard faults as the CPU tries to fetch instructions faster than flash can deliver them.

The correct sequence is: increase wait states first, then switch to the faster clock. When reducing clock speed, the reverse order applies: switch to the slower clock first, then reduce wait states.

## Peripheral Clock Gating

Every peripheral clock is gated by an enable bit in the RCC (Reset and Clock Control) registers. A peripheral accessed with its clock disabled returns zero on reads and ignores writes — with no error or fault generated. This is one of the most common "my peripheral doesn't work" issues: forgetting `RCC->APB1ENR |= RCC_APB1ENR_USART2EN` (or the HAL equivalent `__HAL_RCC_USART2_CLK_ENABLE()`) before configuring USART2 results in silent failure. Every register write lands in a void.

Clock gating is also the primary mechanism for reducing power consumption: disabling unused peripheral clocks saves measurable current, particularly on APB2 peripherals running at higher frequencies.

## Clock Tree Configuration Sequence

The correct order for configuring a clock tree from reset is critical and follows a fixed pattern:

1. Enable the HSE and wait for the HSERDY flag (or timeout and fall back to HSI)
2. Set flash wait states for the target SYSCLK frequency
3. Configure the PLL (M, N, P, Q dividers) with the HSE as source
4. Enable the PLL and wait for the PLLRDY flag
5. Set AHB, APB1, and APB2 prescalers
6. Switch the system clock source to PLL (SW bits in RCC_CFGR) and confirm via the SWS status bits

Reversing steps 2 and 4 — enabling the PLL before setting flash wait states — causes a hard fault the moment the clock switch occurs. Omitting the PLLRDY check risks switching to an unlocked PLL, producing an unstable or incorrect system clock. HAL initialization functions handle this sequence automatically, but bare-metal clock setup requires following these steps precisely.

## Tips

- Always configure flash wait states before increasing the system clock — the penalty for getting this wrong is an immediate hard fault with no recovery except a reset
- Use STM32CubeMX or similar clock tree visualization tools to verify PLL settings before writing configuration code — manual calculation of M/N/P/Q values is error-prone
- Enable the Clock Security System (CSS) when using HSE — if the external crystal fails, the CSS automatically switches to HSI and generates an NMI, allowing graceful degradation instead of a silent lockup
- On parts with multiple PLLs (STM32H7, STM32U5), dedicate separate PLLs to domains with incompatible frequency requirements — trying to derive both 480 MHz SYSCLK and 11.2896 MHz audio MCLK from a single PLL is usually impossible without fractional-N support
- Remember the timer clock doubling rule: when the APB prescaler is greater than 1, timers on that bus run at 2x the APB frequency
- When debugging peripheral issues, check the RCC enable bit first — a peripheral with its clock disabled reads as all zeros and gives no indication of the problem

## Caveats

- **PLL VCO frequency has strict bounds** — Setting N too low or M too high can place the VCO below its minimum frequency, causing the PLL to fail to lock. The system falls back to HSI with no obvious error unless the PLL ready flag is checked
- **APB prescaler affects peripheral register access** — Some peripherals require specific minimum bus clock frequencies to operate correctly; running APB1 at an unusually low prescaler can cause subtle peripheral misbehavior
- **Changing clock speed without updating peripheral baud rate generators breaks communication** — Switching from 168 MHz to 84 MHz SYSCLK halves the actual UART baud rate if the BRR register is not recalculated, producing garbled output
- **Power consumption scales with clock frequency** — Running at 168 MHz when 48 MHz is sufficient wastes significant current. On battery-powered designs, this directly impacts runtime
- **Some peripherals require exact clock frequencies** — USB Full Speed requires exactly 48 MHz; even 47.9 MHz causes enumeration failures. The PLL Q divider must produce this value precisely

## In Practice

- A peripheral that reads back all zeros from its configuration registers almost always has its RCC clock enable bit unset — this is the single most common clock tree configuration error
- A timer interrupt firing at twice the expected rate on an APB1 peripheral indicates the timer clock doubling was not accounted for — the timer is running at 2x the APB1 bus frequency because the prescaler is greater than 1
- A system that hard-faults immediately after switching to PLL as the system clock source has insufficient flash wait states — the CPU outran the flash before executing even a single instruction at the new speed
- USB enumeration that fails consistently despite correct USB driver code often traces to a PLL Q divider that does not produce exactly 48.000 MHz — even a small deviation from 48 MHz is rejected by the USB host
