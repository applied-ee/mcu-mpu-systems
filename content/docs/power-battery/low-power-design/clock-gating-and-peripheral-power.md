---
title: "Clock Gating & Peripheral Power"
weight: 20
---

# Clock Gating & Peripheral Power

Sleep modes reduce current by halting the CPU, but the CPU is only part of the power budget. On an STM32L476 at 80 MHz, the CPU core draws roughly 4.5 mA while the peripheral clocks — GPIO ports, SPI controllers, timers, DMA — collectively draw another 3–4 mA even when idle. Disabling peripheral clocks when not in use, controlling power domains, and configuring GPIO pins for minimal leakage are essential techniques that can cut active-mode current by 30–50% and shave microamps from sleep current that would otherwise dominate the battery budget.

## STM32 RCC Peripheral Clock Control

Every peripheral on an STM32 is clocked through the Reset and Clock Control (RCC) block. Each peripheral has an enable bit in one of the RCC registers (`AHB1ENR`, `AHB2ENR`, `APB1ENR1`, `APB1ENR2`, `APB2ENR`). The HAL provides macros for each:

```c
/* Enable GPIO port A clock */
__HAL_RCC_GPIOA_CLK_ENABLE();

/* Disable GPIO port D clock when not needed */
__HAL_RCC_GPIOD_CLK_DISABLE();

/* Enable SPI1 clock before transfer */
__HAL_RCC_SPI1_CLK_ENABLE();

/* Disable SPI1 clock after transfer completes */
__HAL_RCC_SPI1_CLK_DISABLE();
```

On the STM32L476, each GPIO port clock adds approximately 50–100 µA when enabled. A design that enables all eight GPIO ports (A through H) but only uses three wastes 250–500 µA — a significant fraction of the active-mode budget in a low-power application.

### Sleep-Mode Clock Gating

STM32 parts also provide separate clock enable bits for Sleep and Stop modes via the `SMENR` (Sleep Mode Enable) registers. By default, all peripheral clocks remain enabled during Sleep mode. Disabling unused peripheral clocks specifically during Sleep reduces Sleep-mode current:

```c
/* Disable SPI1 clock during Sleep mode */
__HAL_RCC_SPI1_CLK_SLEEP_DISABLE();

/* Disable DMA1 clock during Sleep mode */
__HAL_RCC_DMA1_CLK_SLEEP_DISABLE();

/* Disable SRAM1 clock during Sleep (if not needed) */
__HAL_RCC_SRAM1_CLK_SLEEP_DISABLE();
```

The register addresses for the STM32L476:

| Register | Address | Controls |
|----------|---------|----------|
| `RCC_AHB1SMENR` | 0x40021068 | DMA1/2, Flash, CRC, TSC |
| `RCC_AHB2SMENR` | 0x4002106C | GPIO A–H, ADC, AES, RNG |
| `RCC_APB1SMENR1` | 0x40021078 | TIM2–7, SPI2/3, USART2–5, I2C1–3, CAN, PWR |
| `RCC_APB1SMENR2` | 0x4002107C | LPUART1, LPTIM2, I2C4 |
| `RCC_APB2SMENR` | 0x40021080 | TIM1/8/15/16/17, SPI1, USART1, SAI1/2, DFSDM |

## Disabling Unused Oscillators

MCUs often enable multiple clock sources by default or during initialization. Each oscillator has a measurable current cost:

| Oscillator | STM32L476 Current | Typical Use |
|------------|-------------------|-------------|
| HSI16 (16 MHz RC) | ~70 µA | Fast internal clock |
| HSE (8 MHz crystal) | ~200–350 µA | Accurate system clock |
| MSI (100 kHz – 48 MHz) | ~10–100 µA (freq dependent) | Default, low-power clock |
| LSE (32.768 kHz crystal) | ~0.5 µA | RTC, LPTIM |
| LSI (32 kHz RC) | ~0.5 µA | IWDG, RTC fallback |
| PLL | ~400–600 µA | High-speed system clock |

After configuring the system clock, any oscillator not actively sourcing a clock tree should be disabled:

```c
void disable_unused_oscillators(void)
{
    RCC_OscInitTypeDef osc = {0};

    /* Disable HSI if running from HSE+PLL */
    osc.OscillatorType = RCC_OSCILLATORTYPE_HSI;
    osc.HSIState = RCC_HSI_OFF;
    HAL_RCC_OscConfig(&osc);

    /* Disable LSI if using LSE for RTC */
    osc.OscillatorType = RCC_OSCILLATORTYPE_LSI;
    osc.LSIState = RCC_LSI_OFF;
    HAL_RCC_OscConfig(&osc);
}
```

Disabling HSI when running from the PLL sourced by HSE saves ~70 µA. Disabling LSI when the RTC uses LSE saves another ~0.5 µA. These small numbers compound in systems targeting single-digit microamp sleep currents.

## ESP32 Peripheral Clock Gating

The ESP32 provides per-peripheral clock gating through the `periph_module_enable()` and `periph_module_disable()` API:

```c
#include "driver/periph_ctrl.h"

/* Enable SPI2 peripheral clock */
periph_module_enable(PERIPH_HSPI_MODULE);

/* Perform SPI transfer... */

/* Disable SPI2 peripheral clock */
periph_module_disable(PERIPH_HSPI_MODULE);
```

Available peripheral modules include:

| Module Constant | Peripheral | Approximate Active Current |
|----------------|------------|---------------------------|
| `PERIPH_UART0_MODULE` | UART0 | ~1 mA |
| `PERIPH_UART1_MODULE` | UART1 | ~1 mA |
| `PERIPH_SPI_MODULE` | SPI1 (flash) | ~2 mA |
| `PERIPH_HSPI_MODULE` | SPI2 | ~2 mA |
| `PERIPH_I2C0_MODULE` | I2C controller 0 | ~0.5 mA |
| `PERIPH_LEDC_MODULE` | LED PWM controller | ~1 mA |
| `PERIPH_WIFI_MODULE` | Wi-Fi MAC/BB | ~80–120 mA |
| `PERIPH_BT_MODULE` | Bluetooth | ~50–80 mA |
| `PERIPH_RMT_MODULE` | Remote control peripheral | ~0.5 mA |

The ESP-IDF framework reference-counts these calls, so multiple drivers can enable the same peripheral independently. The clock is only gated when all consumers have called `periph_module_disable()`.

## nRF52 Power Domain Control

The nRF52 series provides fine-grained RAM power control and peripheral management through the POWER register block:

### RAM Section Power Control

The nRF52840 has 256 KB of RAM divided into 8 sections of 32 KB each, with each section split into two 16 KB sub-sections. Each sub-section can be independently powered on or off:

```c
#include "nrf_power.h"

void disable_unused_ram(void)
{
    /* Keep RAM sections 0-2 (96 KB) powered, disable sections 3-7 */
    NRF_POWER->RAM[3].POWERCLR = POWER_RAM_POWER_S0POWER_Msk |
                                  POWER_RAM_POWER_S1POWER_Msk;
    NRF_POWER->RAM[4].POWERCLR = POWER_RAM_POWER_S0POWER_Msk |
                                  POWER_RAM_POWER_S1POWER_Msk;
    NRF_POWER->RAM[5].POWERCLR = POWER_RAM_POWER_S0POWER_Msk |
                                  POWER_RAM_POWER_S1POWER_Msk;
    NRF_POWER->RAM[6].POWERCLR = POWER_RAM_POWER_S0POWER_Msk |
                                  POWER_RAM_POWER_S1POWER_Msk;
    NRF_POWER->RAM[7].POWERCLR = POWER_RAM_POWER_S0POWER_Msk |
                                  POWER_RAM_POWER_S1POWER_Msk;
}
```

Each powered-off 16 KB sub-section saves approximately 0.1 µA. Disabling 160 KB of unused RAM saves roughly 1 µA — substantial when the sleep baseline is 1.5 µA.

### Peripheral ENABLE Registers

Unlike STM32's centralized RCC, each nRF52 peripheral has its own `ENABLE` register. Disabling unused peripherals reduces current:

```c
/* Disable UART0 when not in use */
NRF_UARTE0->ENABLE = UARTE_ENABLE_ENABLE_Disabled << UARTE_ENABLE_ENABLE_Pos;

/* Disable SPI (SPIM) when not in use */
NRF_SPIM0->ENABLE = SPIM_ENABLE_ENABLE_Disabled << SPIM_ENABLE_ENABLE_Pos;

/* Disable TWI (I2C) when not in use */
NRF_TWIM0->ENABLE = TWIM_ENABLE_ENABLE_Disabled << TWIM_ENABLE_ENABLE_Pos;
```

A common oversight: the UART peripheral on nRF52 draws approximately 1 mA when enabled, even when idle, due to the high-frequency clock it requires. Disabling UART between transmissions is one of the single largest current savings available.

## GPIO Configuration for Minimal Leakage

Incorrectly configured GPIO pins are one of the most common sources of unexpected sleep current. A floating digital input can oscillate between logic levels due to noise, toggling the input buffer and the Schmitt trigger thousands of times per second, drawing 10–100 µA per pin.

### STM32: Analog Mode

On STM32, setting unused pins to Analog mode (GPIO_MODE_ANALOG) disconnects the input Schmitt trigger and disables the pull-up/pull-down resistors, reducing leakage to effectively zero:

```c
void configure_unused_gpios_low_power(void)
{
    GPIO_InitTypeDef gpio = {0};

    /* Configure all pins on port B as analog (unused port) */
    __HAL_RCC_GPIOB_CLK_ENABLE();

    gpio.Pin = GPIO_PIN_All;
    gpio.Mode = GPIO_MODE_ANALOG;
    gpio.Pull = GPIO_NOPULL;
    HAL_GPIO_Init(GPIOB, &gpio);

    /* Now disable the clock to port B entirely */
    __HAL_RCC_GPIOB_CLK_DISABLE();
}
```

The order matters: configure the GPIO pins to analog mode first, then disable the port clock. Disabling the clock first leaves the pin configuration unchanged (potentially floating), and the leakage persists through the pad circuitry even without a clock.

### ESP32: Input Disabled, No Pull

On ESP32, unused GPIO pins should be configured as inputs with the pull-up and pull-down disabled, and the input buffer should be disconnected:

```c
#include "driver/gpio.h"

void configure_unused_gpio_esp32(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << GPIO_NUM_12) | (1ULL << GPIO_NUM_14) |
                        (1ULL << GPIO_NUM_27),
        .mode = GPIO_MODE_DISABLE,     /* Disable input and output */
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}
```

For deep sleep, RTC GPIO isolation prevents current flow through GPIO pads:

```c
#include "driver/rtc_io.h"

/* Isolate all RTC GPIOs before deep sleep */
rtc_gpio_isolate(GPIO_NUM_12);
rtc_gpio_isolate(GPIO_NUM_14);
```

### nRF52: Disconnect Input Buffer

On nRF52, the lowest-leakage configuration disconnects the input buffer:

```c
/* Configure pin as disconnected — lowest leakage */
nrf_gpio_cfg(pin_number,
             NRF_GPIO_PIN_DIR_INPUT,
             NRF_GPIO_PIN_INPUT_DISCONNECT,
             NRF_GPIO_PIN_NOPULL,
             NRF_GPIO_PIN_S0S1,
             NRF_GPIO_PIN_NOSENSE);
```

## Flash Memory Power-Down Modes

Internal and external flash memory can contribute measurable standby current:

### STM32 Internal Flash

On STM32L4, the internal flash can be placed in power-down mode during Sleep and Stop to save approximately 4 µA:

```c
/* Enable flash power-down during Sleep */
__HAL_FLASH_SLEEP_POWERDOWN_ENABLE();

/* Enable flash power-down during Stop mode */
HAL_PWREx_EnableFlashPowerDown(PWR_FLASHPD_STOP);
```

The tradeoff is wake latency: flash power-down adds approximately 10 µs to the wake time as the flash bias circuitry re-stabilizes. For Stop modes where the core execution resumes from RAM or a pending interrupt, this is usually acceptable.

### External SPI Flash

External NOR flash chips (e.g., Winbond W25Q128JV, ISSI IS25LP064A) have explicit deep power-down commands:

```c
void flash_deep_power_down(SPI_HandleTypeDef *hspi, GPIO_TypeDef *cs_port, uint16_t cs_pin)
{
    uint8_t cmd = 0xB9;  /* Deep Power-Down command */

    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_RESET);
    HAL_SPI_Transmit(hspi, &cmd, 1, 100);
    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_SET);
    /* Flash now draws ~1 µA instead of ~15 µA standby */
}

void flash_release_power_down(SPI_HandleTypeDef *hspi, GPIO_TypeDef *cs_port, uint16_t cs_pin)
{
    uint8_t cmd = 0xAB;  /* Release from Deep Power-Down */

    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_RESET);
    HAL_SPI_Transmit(hspi, &cmd, 1, 100);
    HAL_GPIO_WritePin(cs_port, cs_pin, GPIO_PIN_SET);

    /* Wait tRES1 (typically 3 µs for W25Q128JV) */
    HAL_Delay(1);  /* 1 ms minimum with HAL_Delay granularity */
}
```

The W25Q128JV draws 15 µA in standby but only 1 µA in deep power-down. The release time (tRES1) is 3 µs, making this a nearly free optimization for any design with external flash.

## Startup Latency Tradeoffs

Aggressive clock and peripheral gating reduces steady-state current but increases the time to resume operation:

| Action | Save | Re-enable Penalty |
|--------|------|-------------------|
| Disable GPIO port clock | ~50–100 µA | 1 clock cycle (~12.5 ns at 80 MHz) |
| Disable SPI peripheral clock | ~200 µA | 1 clock cycle + reinit (~10 µs) |
| Disable PLL, drop to MSI | ~500 µA | PLL lock time (~1 ms for STM32L4) |
| Disable HSE crystal | ~300 µA | Crystal startup (~2–5 ms typical) |
| Disable ADC | ~250 µA | ADC calibration (~120 µs for STM32L4) |
| External flash deep power-down | ~14 µA | Release time (~3 µs) + first read latency |

For a sensor that wakes every 10 seconds, the PLL lock time of 1 ms is negligible compared to the 10-second sleep period, making aggressive oscillator gating worthwhile. For a system that must respond to an interrupt within 50 µs, running from the PLL is not possible, and the design must use MSI or HSI as the system clock source, accepting the higher clock-source current in exchange for deterministic latency.

### Peripheral Power-Cycle Pattern

A common firmware pattern wraps peripheral use in enable/disable brackets:

```c
void read_temperature_sensor(float *temp)
{
    /* Power up I2C and sensor */
    __HAL_RCC_I2C1_CLK_ENABLE();
    HAL_GPIO_WritePin(SENSOR_PWR_PORT, SENSOR_PWR_PIN, GPIO_PIN_SET);
    HAL_Delay(5);  /* Sensor startup time (TMP117: 1.5 ms typical) */

    /* Initialize I2C */
    MX_I2C1_Init();

    /* Read temperature from TMP117 at address 0x48 */
    uint8_t reg = 0x00;  /* Temperature register */
    uint8_t data[2];
    HAL_I2C_Master_Transmit(&hi2c1, 0x48 << 1, &reg, 1, 100);
    HAL_I2C_Master_Receive(&hi2c1, 0x48 << 1, data, 2, 100);

    *temp = ((int16_t)(data[0] << 8 | data[1])) * 0.0078125f;

    /* Power down I2C and sensor */
    HAL_I2C_DeInit(&hi2c1);
    __HAL_RCC_I2C1_CLK_DISABLE();
    HAL_GPIO_WritePin(SENSOR_PWR_PORT, SENSOR_PWR_PIN, GPIO_PIN_RESET);
}
```

This pattern adds approximately 6 ms of overhead per reading (sensor startup + I2C init) but saves ~300 µA continuously between readings.

## Tips

- Audit every enabled peripheral clock at system startup — STM32CubeMX enables all GPIO port clocks by default, and many projects never disable the ones that are not in use, wasting 200–500 µA
- On nRF52, disable the UART peripheral between transmissions — UARTE draws ~1 mA when enabled even with no data flowing, because it requires the HFCLK to stay active
- Place external flash into deep power-down before entering MCU sleep — a W25Q128JV in standby (15 µA) can dominate the entire sleep current budget of an nRF52 in System ON idle (1.5 µA)
- Use the STM32 `__HAL_FLASH_SLEEP_POWERDOWN_ENABLE()` macro — it saves approximately 4 µA during Sleep mode with only a 10 µs wake penalty
- Gate the PLL and drop to MSI before entering Stop mode — this happens automatically on STM32L4, but on other families the PLL current can persist into low-power states if not explicitly disabled

## Caveats

- **Disabling a GPIO port clock does not change pin state** — The physical pin retains whatever configuration it had before the clock was gated; if it was floating digital input, it still leaks, even though the software can no longer read or write the port registers
- **STM32 I2C peripheral clock disable does not release the bus** — If the I2C peripheral is disabled mid-transaction (SCL held low), external slaves may hang; always call `HAL_I2C_DeInit()` before gating the clock to ensure SDA and SCL return to idle high
- **ESP32 peripheral clock gating is reference-counted** — Calling `periph_module_disable()` once when two drivers have called `periph_module_enable()` does not actually gate the clock; both consumers must release it
- **nRF52 RAM power-off is immediate and destructive** — Writing to `POWERCLR` for a RAM section instantly discards its contents with no warning; any stack, heap, or global variables in that section become invalid
- **Re-enabling the ADC after clock gating requires recalibration** — On STM32L4, the ADC calibration factors stored in internal registers are lost when the ADC clock is disabled; skipping recalibration after re-enable introduces offset and gain errors of up to 5 LSBs

## In Practice

- A battery-powered STM32L476 design drawing 6.2 mA in active mode was reduced to 3.8 mA by disabling four unused GPIO port clocks, the DAC, and the SRAM2 clock during active mode — a 39% reduction with no functional impact
- An nRF52840 BLE sensor that left UARTE0 enabled for debug logging drew 2.5 mA in idle instead of the expected 1.5 µA — a factor of 1600x higher than necessary, caused by a single peripheral left enabled
- An ESP32 application that called `periph_module_enable(PERIPH_HSPI_MODULE)` in its SPI driver init but never called `periph_module_disable()` after transfers contributed an extra 2 mA to the modem-sleep baseline — wrapping each transfer block in enable/disable calls brought modem-sleep current from 22 mA to 20 mA
- A design using a W25Q64JV external flash that showed 18 µA in Stop 2 instead of the expected 0.8 µA traced the excess to the flash chip in standby (15 µA) plus a floating SPI MISO line (2 µA) — deep power-down command plus analog-mode configuration on the SPI pins reduced total sleep current to 1.1 µA
- A product that worked correctly in development but failed in production had its ADC readings drift by 3–4% — the root cause was a power-saving routine that disabled the ADC clock between measurements without recalibrating after re-enable, accumulating offset error from temperature variation
