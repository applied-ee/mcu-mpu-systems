---
title: "Sleep Modes & Wake Sources"
weight: 10
---

# Sleep Modes & Wake Sources

Modern microcontrollers offer a hierarchy of sleep modes, each trading off recovery time and peripheral availability against current draw. An STM32L4 running at 80 MHz draws roughly 100 µA/MHz in Run mode — around 8 mA — but can drop below 1 µA in Standby and under 30 nA in Shutdown. An ESP32-S3 consuming 240 mA during Wi-Fi TX settles to 8 µA in deep sleep and 5 µA in hibernation. An nRF52840 pulling 4.6 mA at 64 MHz in active mode drops to 1.5 µA in System ON idle with RAM retained, and 0.4 µA in System OFF. The key to a power-optimized design is selecting the deepest sleep mode that still preserves enough state to resume quickly when a wake event arrives.

## STM32 Sleep Mode Hierarchy

The STM32L4/L4+ family defines six power modes below Run. Each disables progressively more of the chip:

| Mode | Core | SRAM | Peripherals | Regulator | Typical Current (STM32L476) | Wake Latency |
|------|------|------|-------------|-----------|----------------------------|--------------|
| Sleep | Stopped (WFI/WFE) | Retained | Running | Main on | ~1.2 mA | < 1 µs |
| Low-Power Sleep | Stopped | Retained | Running (MSI only) | Main on, low-freq | ~28 µA @ 100 kHz MSI | < 1 µs |
| Stop 0 | Off | Retained | Frozen, some wake-capable | Main on | ~1.3 µA | ~5 µs |
| Stop 1 | Off | Retained | Frozen, some wake-capable | Low-power | ~0.8 µA | ~5 µs |
| Stop 2 | Off | Retained | Most off, LPUART/LPTIM/RTC | Low-power | ~0.6 µA | ~6 µs |
| Standby | Off | Lost (except SRAM2 optional) | Off, RTC optional | Off | ~0.3 µA | ~50 µs (full reset) |
| Shutdown | Off | Lost | All off | Off | ~30 nA | ~50 µs (full reset) |

Stop 2 is the most commonly used mode for battery-powered applications because it retains all SRAM contents while achieving sub-microamp current. Standby loses RAM but can optionally retain 64 KB of SRAM2 at the cost of slightly higher current (~0.4 µA).

### Entering Stop 2 on STM32L4

```c
#include "stm32l4xx_hal.h"

void enter_stop2_mode(void)
{
    /* Disable SysTick interrupt to prevent immediate wake */
    HAL_SuspendTick();

    /* Clear all wake-up flags */
    __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);

    /* Configure lowest regulator setting for Stop 2 */
    HAL_PWREx_EnterSTOP2Mode(PWR_STOPENTRY_WFI);

    /* Execution resumes here after wake-up */

    /* Reconfigure system clock — Stop exits on MSI at 4 MHz */
    SystemClock_Config();

    HAL_ResumeTick();
}
```

After exiting Stop 2, the system clock reverts to the MSI oscillator at 4 MHz. The application must reconfigure the PLL and switch back to the desired clock source. Failing to call `SystemClock_Config()` after wake results in the firmware running at 4 MHz instead of the intended 80 MHz.

### Standby with SRAM2 Retention

```c
void enter_standby_with_sram2(void)
{
    /* Enable SRAM2 retention in Standby */
    HAL_PWREx_EnableSRAM2ContentRetention();

    /* Clear wake-up flags */
    __HAL_PWR_CLEAR_FLAG(PWR_FLAG_WU);

    /* Enable WKUP pin 1 (PA0) rising edge */
    HAL_PWR_EnableWakeUpPin(PWR_WAKEUP_PIN1_HIGH);

    HAL_PWR_EnterSTANDBYMode();
    /* Execution does not continue here — MCU resets on wake */
}
```

On wake from Standby, the MCU performs a full reset. The application detects a Standby wake versus a power-on reset by checking the SBF flag in `PWR->SR1`:

```c
if (__HAL_PWR_GET_FLAG(PWR_FLAG_SBF)) {
    __HAL_PWR_CLEAR_FLAG(PWR_FLAG_SBF);
    /* Woke from Standby — recover state from retained SRAM2 */
}
```

## ESP32 Sleep Modes

The ESP32 (original and S2/S3 variants) provides four distinct power-saving modes:

| Mode | Wi-Fi | CPU | ULP | RTC Memory | GPIO State | Typical Current (ESP32-S3) |
|------|-------|-----|-----|------------|------------|---------------------------|
| Modem Sleep | Off (auto) | Running | — | Available | Maintained | ~20 mA |
| Light Sleep | Off | Paused | Available | Retained | Maintained | ~0.8 mA |
| Deep Sleep | Off | Off | Running | Retained (8 KB) | Reset (except RTC GPIOs) | ~8 µA |
| Hibernation | Off | Off | Off | Lost | Reset | ~5 µA |

### Deep Sleep Entry and Wake

```c
#include "esp_sleep.h"
#include "driver/rtc_io.h"

void enter_deep_sleep_gpio_wake(void)
{
    /* Configure GPIO 4 (RTC GPIO 10) as wake source, active high */
    esp_sleep_enable_ext0_wakeup(GPIO_NUM_4, 1);

    /* Hold RTC GPIO state through deep sleep */
    rtc_gpio_hold_en(GPIO_NUM_2);

    /* Optional: also wake on timer after 30 seconds */
    esp_sleep_enable_timer_wakeup(30 * 1000000ULL);

    /* Enter deep sleep — does not return */
    esp_deep_sleep_start();
}
```

After deep sleep wake, the ESP32 boots from the beginning of `app_main()`. The wake cause is retrieved with:

```c
esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
switch (cause) {
    case ESP_SLEEP_WAKEUP_EXT0:
        /* GPIO wake */
        break;
    case ESP_SLEEP_WAKEUP_TIMER:
        /* RTC timer wake */
        break;
    default:
        /* Power-on or other reset */
        break;
}
```

### ULP Coprocessor Wake

The ESP32 includes an Ultra-Low-Power (ULP) coprocessor that runs during deep sleep, drawing approximately 150 µA when active (cycling on and off brings the average much lower). It can read ADC channels, monitor GPIO pins, and wake the main CPU only when a threshold is crossed:

```c
#include "esp32/ulp.h"
#include "ulp_main.h"

void configure_ulp_adc_wake(void)
{
    /* Load ULP program */
    ulp_load_binary(0, ulp_main_bin_start,
                    (ulp_main_bin_end - ulp_main_bin_start) / sizeof(uint32_t));

    /* Set ULP wakeup period: 100 ms between measurements */
    ulp_set_wakeup_period(0, 100000);

    /* Enable ULP wake-up of main CPU */
    esp_sleep_enable_ulp_wakeup();

    /* Start ULP program */
    ulp_run(&ulp_entry - RTC_SLOW_MEM);

    esp_deep_sleep_start();
}
```

This pattern is effective for sensor threshold monitoring — the ULP samples an ADC input every 100 ms at ~1 µA average, waking the main CPU only when the reading exceeds a programmed threshold.

## nRF52 Power Modes

The nRF52 series (nRF52832, nRF52840) uses two primary power modes:

| Mode | CPU | RAM | Peripherals | BLE | Current (nRF52840) |
|------|-----|-----|-------------|-----|-------------------|
| System ON — Active | Running | Retained | Running | Available | 4.6 mA @ 64 MHz |
| System ON — Idle | WFE/WFI | Retained | Running if enabled | Advertising possible | 1.5 µA (all RAM) |
| System OFF | Off | Optional partial retention | Off | Off | 0.4 µA |

### System ON Idle (Low-Power Wait)

In nRF52 System ON mode, calling `__WFE()` (Wait For Event) halts the CPU while peripherals continue running. The RTOS idle hook in Zephyr and the SoftDevice power manager in the nRF5 SDK automatically enter this state when no tasks are ready:

```c
#include "nrf_pwr_mgmt.h"

/* In main loop — SDK power management */
void main(void)
{
    /* Initialize system, peripherals, SoftDevice... */

    while (1) {
        nrf_pwr_mgmt_run();  /* Enters WFE until next event */
    }
}
```

### System OFF

System OFF provides the deepest sleep at 0.4 µA. The only wake sources are GPIO DETECT, LPCOMP, NFC field, and a reset pin:

```c
#include "nrf_power.h"
#include "nrf_gpio.h"

void enter_system_off(void)
{
    /* Configure P0.13 (Button 1) as wake source via DETECT */
    nrf_gpio_cfg_sense_input(13,
                             NRF_GPIO_PIN_PULLUP,
                             NRF_GPIO_PIN_SENSE_LOW);

    /* Enter System OFF */
    nrf_power_system_off(NRF_POWER);
    /* Does not return — wake causes full reset */
}
```

The LPCOMP peripheral can also wake the system, useful for analog threshold detection without the main CPU. LPCOMP draws approximately 3 µA when active and can monitor an analog input against an internal reference or external pin.

## Wake Source Comparison

| Wake Source | STM32L4 (Stop 2) | STM32L4 (Standby) | ESP32 (Deep Sleep) | nRF52 (System OFF) |
|-------------|-------------------|--------------------|--------------------|-------------------|
| GPIO / EXTI | EXTI lines 0–15, any edge | WKUP pins 1–5 only | RTC GPIOs only (ext0/ext1) | Any GPIO via DETECT |
| RTC Alarm | RTC Alarm A/B | RTC Alarm A/B | RTC timer (µs resolution) | Not available |
| UART | LPUART1 (address match) | Not available | UART (light sleep only) | Not available |
| Timer | LPTIM1, LPTIM2 | Not available | ULP timer | Not available |
| Touch | Not available | Not available | Touch pad (10 pads) | Not available |
| Analog | COMP1/COMP2 | Not available | ULP ADC threshold | LPCOMP |
| Radio | Not available | Not available | Not available | NFC field detect |
| Watchdog | IWDG (if running) | IWDG (if running) | Not available | Not available |

## RAM Retention Across Modes

RAM retention determines whether the firmware can resume execution or must restart from scratch:

- **STM32L4 Stop 0/1/2** — All SRAM retained (up to 320 KB on STM32L4+). The CPU resumes at the instruction following WFI.
- **STM32L4 Standby** — All SRAM lost by default. SRAM2 (up to 64 KB) can be retained by setting `RRS` bits in `PWR_CR3`, adding approximately 0.1 µA.
- **ESP32 Deep Sleep** — Main SRAM lost. RTC slow memory (8 KB) retained and accessible via `RTC_DATA_ATTR` / `RTC_NOINIT_ATTR` attributes. Variables placed there persist across deep sleep cycles.
- **nRF52 System ON** — All RAM retained. RAM sections can be individually powered off via `POWER.RAM[n].POWER` registers to save ~0.2 µA per 4 KB section that is not needed.
- **nRF52 System OFF** — All RAM lost by default. One RAM section can be retained by setting `POWER.RAM[0].POWERSET` before entering System OFF, at the cost of ~0.5 µA additional.

### ESP32 RTC Memory Usage

```c
/* Persists through deep sleep */
RTC_DATA_ATTR int boot_count = 0;

void app_main(void)
{
    boot_count++;
    printf("Boot count: %d\n", boot_count);

    /* Read sensor, transmit if threshold, then sleep */
    esp_sleep_enable_timer_wakeup(60 * 1000000ULL);
    esp_deep_sleep_start();
}
```

## Wake Latency Comparison

Wake latency determines the minimum response time from an external event to firmware execution:

| Platform | Mode | Wake Latency | Notes |
|----------|------|-------------|-------|
| STM32L4 | Stop 0 | ~5 µs | MSI clock ready immediately |
| STM32L4 | Stop 2 | ~6 µs | Slightly longer regulator startup |
| STM32L4 | Standby | ~50 µs | Full reset, BOR and POR checks |
| STM32L4 | Shutdown | ~50 µs | Same as Standby, plus voltage ramp |
| ESP32 | Light Sleep | ~1 ms | CPU cache restore |
| ESP32 | Deep Sleep | ~200 ms | Full boot, app_main() re-entry |
| nRF52 | System ON (WFE) | < 1 µs | Immediate resume on event |
| nRF52 | System OFF | ~600 µs | Full reset, flash boot |

For applications requiring sub-millisecond response to external events, STM32 Stop modes or nRF52 System ON idle are the only viable options. ESP32 deep sleep's ~200 ms boot time makes it unsuitable for latency-sensitive wake events.

## Configuring EXTI Wake on STM32

Setting up a GPIO as a wake source for Stop mode requires configuring the EXTI line before entering sleep:

```c
void configure_wakeup_gpio(void)
{
    GPIO_InitTypeDef gpio = {0};

    __HAL_RCC_GPIOA_CLK_ENABLE();

    /* PA0 as input with pull-down, rising edge interrupt */
    gpio.Pin = GPIO_PIN_0;
    gpio.Mode = GPIO_MODE_IT_RISING;
    gpio.Pull = GPIO_PULLDOWN;
    gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(GPIOA, &gpio);

    /* Enable EXTI0 interrupt in NVIC */
    HAL_NVIC_SetPriority(EXTI0_IRQn, 0, 0);
    HAL_NVIC_EnableIRQ(EXTI0_IRQn);
}

void EXTI0_IRQHandler(void)
{
    HAL_GPIO_EXTI_IRQHandler(GPIO_PIN_0);
}

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    if (GPIO_Pin == GPIO_PIN_0) {
        /* Handle wake event */
    }
}
```

This configuration works for all Stop modes. For Standby mode, only the dedicated WKUP pins (PA0/WKUP1, PC13/WKUP2, etc.) are available, configured through the PWR peripheral rather than EXTI.

## Tips

- Select Stop 2 as the default sleep mode for STM32L4 battery designs — it offers sub-microamp current with full RAM retention and fast wake, covering the majority of use cases without the complexity of Standby
- Use `RTC_DATA_ATTR` on ESP32 to store state machine variables, sensor thresholds, and boot counters across deep sleep cycles — this avoids the 200 ms penalty of reading configuration from flash on every wake
- On nRF52, disable unused RAM sections before entering System ON idle — each 4 KB section that is powered off saves approximately 0.2 µA, and many applications use far less than the full 256 KB
- Always clear wake-up flags before entering any sleep mode — stale flags from a previous wake event cause the MCU to wake immediately, appearing as though sleep mode does not work
- Configure unused GPIO pins before entering sleep — floating inputs can oscillate and draw 10–100 µA per pin, dominating the sleep current budget

## Caveats

- **STM32 Stop mode exits on MSI at 4 MHz** — Forgetting to call `SystemClock_Config()` after wake results in the application running at one-twentieth of the expected speed, causing timing-dependent peripherals (UART baud rate, SPI clock) to produce garbage
- **ESP32 deep sleep resets all non-RTC peripherals** — SPI bus configuration, I2C addresses, and GPIO modes are lost; every peripheral must be reinitialized in `app_main()` on each wake cycle
- **nRF52 System OFF wake is a full reset** — The program counter does not resume; it restarts from the reset vector, meaning any unsaved state in SRAM is lost
- **IWDG on STM32 continues running in Stop mode** — If the independent watchdog is enabled, its timeout must be long enough to cover the expected sleep duration, or it will reset the MCU during sleep
- **ESP32 ext0 wakeup only works with RTC-capable GPIOs** — Attempting to configure a non-RTC GPIO (e.g., GPIO 6–11 on the original ESP32) as a deep sleep wake source silently fails, and the device never wakes on that pin

## In Practice

- A sensor node that wakes every 60 seconds to sample a temperature sensor and transmit via BLE draws ~8 µA average on an nRF52840 in System ON idle, achieving 2+ years on a 230 mAh CR2032 — but only if the BLE advertising interval is tuned to 1–2 seconds rather than the default 100 ms
- An STM32L476 data logger using Stop 2 with RTC alarm wake every 10 minutes draws 0.65 µA in sleep but spikes to 12 mA for ~50 ms during wake, sample, and flash write — the average current over the cycle is approximately 1.6 µA, yielding 3+ years on a 1200 mAh AAA cell
- An ESP32-based environmental monitor that uses the ULP to check a soil moisture sensor every 5 seconds and only wakes the main CPU when the soil is dry achieves 45 days on a 2000 mAh LiPo, compared to 3 days when polling from the main CPU in modem sleep
- A design that shows 0.3 µA in sleep on the bench but draws 15 µA in production often has a debug LED or pull-up resistor on an I2C bus that was disconnected during bench testing — always measure sleep current with the full production circuit populated
