---
title: "I²C Initialization & Clock Configuration"
weight: 10
---

# I²C Initialization & Clock Configuration

Every I²C transaction depends on the peripheral being correctly initialized: GPIO pins configured as open-drain with alternate function, the I²C clock enabled via RCC, and the timing registers set to produce the desired SCL frequency. Getting any of these wrong produces symptoms that range from no activity on the bus to intermittent NACKs that appear device-dependent but are actually timing violations. The initialization code is typically short — 10 to 20 lines — but the details inside those lines determine whether the bus works reliably at 400 kHz or silently falls back to unpredictable behavior.

## GPIO Configuration for I²C

I²C requires open-drain outputs with external pull-ups. Both SDA and SCL must be configured as alternate function, open-drain, with no internal pull-up (external resistors are almost always preferred). On STM32, each I²C peripheral maps to specific pins through the alternate function matrix.

For STM32F4 using I2C1 (PB6 = SCL, PB7 = SDA):

```c
// Enable clocks for GPIOB and I2C1
RCC->AHB1ENR |= RCC_AHB1ENR_GPIOBEN;
RCC->APB1ENR |= RCC_APB1ENR_I2C1EN;

// Configure PB6 and PB7: AF mode, open-drain, high speed
GPIOB->MODER   &= ~(GPIO_MODER_MODER6 | GPIO_MODER_MODER7);
GPIOB->MODER   |=  (0x02 << GPIO_MODER_MODER6_Pos) |
                    (0x02 << GPIO_MODER_MODER7_Pos);  // AF mode
GPIOB->OTYPER  |=  GPIO_OTYPER_OT6 | GPIO_OTYPER_OT7;  // Open-drain
GPIOB->OSPEEDR |=  (0x03 << GPIO_OSPEEDR_OSPEED6_Pos) |
                    (0x03 << GPIO_OSPEEDR_OSPEED7_Pos);  // High speed
GPIOB->PUPDR   &= ~(GPIO_PUPDR_PUPD6 | GPIO_PUPDR_PUPD7);  // No pull-up
GPIOB->AFR[0]  |=  (4 << GPIO_AFRL_AFSEL6_Pos) |
                    (4 << GPIO_AFRL_AFSEL7_Pos);  // AF4 = I2C1
```

The alternate function number varies by MCU family and pin. On STM32F4, I2C1/2/3 all use AF4. On STM32H7, I2C1/2/3 use AF4 and I2C4 uses AF6. The reference manual's alternate function mapping table is the authoritative source — relying on memory or copying from a different chip family is a common source of silent failure.

## STM32F4 I²C Clock Configuration (CCR Register)

The STM32F4 I2C peripheral uses the I2C_CCR (Clock Control Register) to set the SCL frequency. The peripheral clock source is APB1. At a typical 42 MHz APB1 clock:

```c
// Standard mode (100 kHz): CCR = APB1_CLK / (2 * I2C_CLK)
// CCR = 42000000 / (2 * 100000) = 210
I2C1->CR2 = 42;              // APB1 frequency in MHz
I2C1->CCR = 210;             // Standard mode, duty cycle 50%
I2C1->TRISE = 42 + 1;       // Max rise time: 1000ns / (1/42MHz) + 1

// Fast mode (400 kHz): CCR = APB1_CLK / (3 * I2C_CLK) with DUTY=0
// CCR = 42000000 / (3 * 400000) = 35
I2C1->CCR = I2C_CCR_FS | 35;  // Fast mode, duty 2:1
I2C1->TRISE = 13 + 1;         // Max rise time: 300ns for fast mode
```

The TRISE register encodes the maximum rise time of the SDA/SCL lines in units of the APB1 period. Standard mode allows 1000 ns rise time; fast mode allows 300 ns. Incorrect TRISE values cause timing violations that may work on short buses but fail when cable length increases.

Using STM32 HAL, the same configuration becomes:

```c
I2C_HandleTypeDef hi2c1;

hi2c1.Instance             = I2C1;
hi2c1.Init.ClockSpeed      = 400000;          // 400 kHz
hi2c1.Init.DutyCycle        = I2C_DUTYCYCLE_2; // Tlow/Thigh = 2:1
hi2c1.Init.OwnAddress1      = 0x00;
hi2c1.Init.AddressingMode    = I2C_ADDRESSINGMODE_7BIT;
hi2c1.Init.DualAddressMode   = I2C_DUALADDRESS_DISABLE;
hi2c1.Init.GeneralCallMode   = I2C_GENERALCALL_DISABLE;
hi2c1.Init.NoStretchMode     = I2C_NOSTRETCH_DISABLE;

if (HAL_I2C_Init(&hi2c1) != HAL_OK) {
    Error_Handler();
}
```

## STM32H7 TIMINGR Register

The STM32H7 (and L4, G4, U5 families) replaces the CCR approach with a single 32-bit TIMINGR register. TIMINGR encodes four fields — PRESC, SCLDEL, SDADEL, SCLH, SCLL — in a format that is not intuitive to calculate by hand.

For 400 kHz fast mode on STM32H743 with a 100 MHz I2C kernel clock:

```c
// TIMINGR value from STM32CubeMX: 0x00B01A4B
// PRESC=0x0, SCLDEL=0xB, SDADEL=0x0, SCLH=0x1A, SCLL=0x4B
I2C1->TIMINGR = 0x00B01A4B;
```

The recommended approach is to use STM32CubeMX or the AN4235 application note spreadsheet to generate the TIMINGR value. Manual calculation requires accounting for analog and digital filter delays, rise/fall times, and the I2C specification timing parameters (tSU:DAT, tHD:DAT, tHIGH, tLOW). The formula for SCL frequency is approximately:

```
t_SCL = t_SYNC1 + t_SYNC2 + (SCLH + 1) * t_PRESC + (SCLL + 1) * t_PRESC
where t_PRESC = (PRESC + 1) / f_I2CCLK
```

The TIMINGR approach provides finer control over setup and hold times, which matters for fast-mode plus (1 MHz) operation where timing margins are tight.

## ESP32 I²C Initialization

The ESP32 I2C driver in ESP-IDF uses `i2c_config_t` for configuration. The ESP32 has two I2C controllers (I2C_NUM_0 and I2C_NUM_1), each mappable to any GPIO through the IO MUX.

```c
#include "driver/i2c.h"

i2c_config_t conf = {
    .mode             = I2C_MODE_MASTER,
    .sda_io_num       = GPIO_NUM_21,
    .scl_io_num       = GPIO_NUM_22,
    .sda_pullup_en    = GPIO_PULLUP_ENABLE,   // Internal pull-ups
    .scl_pullup_en    = GPIO_PULLUP_ENABLE,
    .master.clk_speed = 400000,               // 400 kHz
};

ESP_ERROR_CHECK(i2c_param_config(I2C_NUM_0, &conf));
ESP_ERROR_CHECK(i2c_driver_install(I2C_NUM_0, conf.mode, 0, 0, 0));
```

The internal pull-ups on the ESP32 are weak — approximately 45 kOhm — which is sufficient for short-distance prototyping but inadequate for any production bus. External 4.7 kOhm pull-ups are standard for 100 kHz, and 2.2 kOhm for 400 kHz operation. On ESP-IDF v5.x and later, the newer `i2c_master` API (`i2c_new_master_bus`) replaces this legacy driver with better error handling and DMA support.

## RP2040 I²C Setup

The RP2040 has two I2C controllers, each supporting standard (100 kHz), fast (400 kHz), and fast-mode plus (1 MHz). Using the Pico SDK:

```c
#include "hardware/i2c.h"
#include "hardware/gpio.h"

// Initialize I2C0 at 400 kHz
i2c_init(i2c0, 400 * 1000);

// Configure GPIO pins
gpio_set_function(4, GPIO_FUNC_I2C);  // SDA
gpio_set_function(5, GPIO_FUNC_I2C);  // SCL
gpio_pull_up(4);
gpio_pull_up(5);
```

The `i2c_init` function returns the actual baud rate achieved, which may differ slightly from the requested value due to integer divider rounding. Checking the return value is a good sanity check.

## Clock Speed Selection

| Mode | Speed | Pull-up | Typical Use |
|------|-------|---------|-------------|
| Standard | 100 kHz | 4.7 kOhm | EEPROMs, RTCs, most sensors |
| Fast | 400 kHz | 2.2 kOhm | IMUs, high-rate sensors, OLEDs |
| Fast-mode Plus | 1 MHz | 1 kOhm | High-bandwidth sensors, LED drivers |

The achievable I²C speed depends on bus capacitance. The I²C specification limits bus capacitance to 400 pF for standard and fast modes. Each device adds 5-10 pF of input capacitance, and wiring adds roughly 50 pF per meter. A bus with five devices on 20 cm of wire totals approximately 150-200 pF — well within spec for 400 kHz. A bus with long ribbon cables can easily exceed 400 pF, at which point only 100 kHz is reliable.

## Tips

- Run STM32CubeMX to generate TIMINGR values rather than calculating them by hand — the interaction between filter delays, rise times, and prescalers makes manual calculation error-prone and fragile across silicon revisions
- Always enable the peripheral clock via RCC before writing any I2C registers — writes to a clock-gated peripheral are silently discarded
- For fast mode (400 kHz), use 2.2 kOhm pull-ups on 3.3V buses — the 4.7 kOhm value common in tutorials produces rise times that are marginal at 400 kHz with more than two devices
- Use the actual returned baud rate from initialization functions (RP2040 `i2c_init`, ESP-IDF `i2c_param_config`) to verify the speed matches expectations — rounding can produce unexpected values
- Configure GPIO speed to "High" or "Very High" on STM32 for fast mode and fast-mode plus — the default low-speed setting adds slew rate limiting that can violate timing at 400 kHz

## Caveats

- **Wrong alternate function number produces no bus activity at all** — The GPIO pin operates as a general-purpose output instead of routing through the I2C peripheral. The logic analyzer shows nothing, and no error flag is set. Always verify the AF number against the datasheet's alternate function mapping table for the exact pin and package
- **Internal pull-ups are too weak for anything beyond bench testing** — The STM32 internal pull-ups are 30-50 kOhm, and ESP32 internal pull-ups are approximately 45 kOhm. These produce rise times that exceed the I²C specification at 400 kHz, resulting in intermittent NACKs that appear device-specific but are actually edge-rate failures
- **Changing APB1 clock speed invalidates the I²C timing configuration** — If the system clock is reconfigured (e.g., entering a low-power mode that switches from PLL to HSI), the I²C timing registers must be recalculated. The bus runs at the wrong speed with no error indication
- **STM32F4 CCR register minimum value is 4 in standard mode** — Setting CCR below 4 is explicitly prohibited by the reference manual but produces no hardware fault. The bus runs at an undefined speed, causing intermittent communication failures
- **Forgetting to configure the pin as open-drain is the most common initialization bug** — Push-pull output mode causes bus contention when the slave tries to pull SDA low during an ACK, producing glitchy waveforms and random NACKs

## In Practice

- A bus that shows a flat-high SCL line with no transitions on the logic analyzer — despite firmware calling `HAL_I2C_Master_Transmit` without error — almost always indicates the GPIO alternate function is misconfigured or the peripheral clock is not enabled. The HAL function returns `HAL_OK` because it never checks whether the GPIO is actually routed to the peripheral
- Intermittent NACKs that appear only when a third device is added to the bus often trace to pull-up resistors that are too weak for the increased bus capacitance. The additional capacitive load slows the rising edge beyond the timing window, and the master samples SDA before it has fully risen. Switching from 4.7 kOhm to 2.2 kOhm pull-ups typically resolves the issue
- A bus running at an unexpected speed — visible as incorrect SCL period on an oscilloscope — commonly appears when the APB1 prescaler was changed after the I²C peripheral was initialized. The CCR or TIMINGR value was calculated for the original APB1 frequency and is now wrong. Reinitializing the I²C peripheral after any clock tree change eliminates this class of bug
- An STM32H7 I2C peripheral that works at 100 kHz but fails at 400 kHz, while the same code works on STM32F4, usually indicates a TIMINGR value that was copied from an example targeting a different kernel clock frequency. The H7 I2C kernel clock source is configurable (HSI, CSI, PLL, APB) and may not match the example's assumption
