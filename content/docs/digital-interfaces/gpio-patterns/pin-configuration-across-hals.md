---
title: "Pin Configuration Across HALs"
weight: 10
---

# Pin Configuration Across HALs

Every GPIO pin on every MCU needs at least three decisions before it does anything useful: direction (input or output), output type (push-pull or open-drain), and pull resistor state (up, down, or none). Some families add speed class and alternate function mapping. The register layouts differ wildly across vendors, and the HAL abstractions differ even more. Understanding what each layer actually configures — and what it silently defaults — prevents the class of bugs where a pin "should work" but the mode register is wrong.

## STM32 GPIO Registers: The Underlying Hardware

On STM32F4 and STM32H7, each GPIO port (GPIOA through GPIOK) exposes a consistent set of configuration registers. Every pin occupies 2 bits in the mode and speed registers, 1 bit in the type and pull registers:

| Register | Width per pin | Function |
|----------|--------------|----------|
| MODER    | 2 bits       | 00 = Input, 01 = Output, 10 = Alternate Function, 11 = Analog |
| OTYPER   | 1 bit        | 0 = Push-pull, 1 = Open-drain |
| OSPEEDR  | 2 bits       | 00 = Low (2 MHz), 01 = Medium (25 MHz), 10 = Fast (50 MHz), 11 = High (100 MHz) |
| PUPDR    | 2 bits       | 00 = None, 01 = Pull-up, 10 = Pull-down |
| AFR[0/1] | 4 bits       | Alternate function selection (AF0-AF15) |

Speed values are approximate and vary by supply voltage and load capacitance — the STM32F4 datasheet specifies exact rise/fall times per speed class. On reset, most pins default to analog mode (MODER = 0x11) except for debug pins (PA13/PA14 default to AF for SWD) and a few others.

Direct register access for configuring PA5 as push-pull output, high speed, no pull:

```c
// Enable GPIOA clock
RCC->AHB1ENR |= RCC_AHB1ENR_GPIOAEN;

// Set PA5 to output mode (MODER bits [11:10] = 01)
GPIOA->MODER &= ~(0x3 << (5 * 2));
GPIOA->MODER |=  (0x1 << (5 * 2));

// Push-pull output type (OTYPER bit 5 = 0)
GPIOA->OTYPER &= ~(1 << 5);

// High speed (OSPEEDR bits [11:10] = 11)
GPIOA->OSPEEDR |= (0x3 << (5 * 2));

// No pull-up/pull-down (PUPDR bits [11:10] = 00)
GPIOA->PUPDR &= ~(0x3 << (5 * 2));
```

For alternate function mode (e.g., PA5 as SPI1_SCK, which is AF5 on STM32F4):

```c
// Set PA5 to alternate function mode (MODER = 10)
GPIOA->MODER &= ~(0x3 << (5 * 2));
GPIOA->MODER |=  (0x2 << (5 * 2));

// Select AF5 in AFR[0] (pins 0-7 use AFRL, pins 8-15 use AFRH)
GPIOA->AFR[0] &= ~(0xF << (5 * 4));
GPIOA->AFR[0] |=  (0x5 << (5 * 4));
```

The alternate function number is fixed per pin per peripheral — the mapping table lives in the MCU datasheet, not the reference manual. Getting the AF number wrong produces no error; the pin simply connects to the wrong peripheral or nothing.

## STM32 HAL Configuration

The STM32 HAL wraps all of this into `GPIO_InitTypeDef`:

```c
__HAL_RCC_GPIOA_CLK_ENABLE();

GPIO_InitTypeDef gpio = {0};
gpio.Pin   = GPIO_PIN_5;
gpio.Mode  = GPIO_MODE_OUTPUT_PP;     // Push-pull output
gpio.Pull  = GPIO_NOPULL;
gpio.Speed = GPIO_SPEED_FREQ_HIGH;
HAL_GPIO_Init(GPIOA, &gpio);
```

For alternate function:

```c
gpio.Pin       = GPIO_PIN_5;
gpio.Mode      = GPIO_MODE_AF_PP;
gpio.Pull      = GPIO_NOPULL;
gpio.Speed     = GPIO_SPEED_FREQ_VERY_HIGH;
gpio.Alternate = GPIO_AF5_SPI1;
HAL_GPIO_Init(GPIOA, &gpio);
```

The HAL handles the MODER, OTYPER, OSPEEDR, PUPDR, and AFR writes internally. The `Mode` field encodes both direction and output type (e.g., `GPIO_MODE_AF_OD` for alternate function open-drain). Interrupt modes like `GPIO_MODE_IT_RISING` configure EXTI in addition to the GPIO registers.

## ESP-IDF GPIO Configuration

ESP32 GPIO configuration uses `gpio_config_t`, which can configure multiple pins simultaneously via a bitmask:

```c
gpio_config_t io_conf = {
    .pin_bit_mask = (1ULL << GPIO_NUM_18) | (1ULL << GPIO_NUM_19),
    .mode         = GPIO_MODE_OUTPUT,
    .pull_up_en   = GPIO_PULLUP_DISABLE,
    .pull_down_en = GPIO_PULLDOWN_DISABLE,
    .intr_type    = GPIO_INTR_DISABLE,
};
gpio_config(&io_conf);
```

For input with pull-up and rising-edge interrupt:

```c
gpio_config_t btn_conf = {
    .pin_bit_mask = (1ULL << GPIO_NUM_0),
    .mode         = GPIO_MODE_INPUT,
    .pull_up_en   = GPIO_PULLUP_ENABLE,
    .pull_down_en = GPIO_PULLDOWN_DISABLE,
    .intr_type    = GPIO_INTR_POSEDGE,
};
gpio_config(&btn_conf);
```

ESP32 does not have a speed register — output drive strength is controlled separately via `gpio_set_drive_capability()` with four levels (0 = ~5 mA through 3 = ~40 mA). The alternate function concept on ESP32 works through the GPIO matrix, which is more flexible than STM32: most peripheral signals can be routed to most GPIO pins using `gpio_iomux_out()` or the automatic routing in peripheral driver init functions. Some pins (e.g., GPIO 6-11 on base ESP32) are connected to the internal SPI flash and must not be used.

## Zephyr Devicetree GPIO Configuration

Zephyr decouples pin configuration from C code by defining GPIO usage in the devicetree overlay:

```dts
/ {
    leds {
        compatible = "gpio-leds";
        status_led: led_0 {
            gpios = <&gpioa 5 GPIO_ACTIVE_HIGH>;
            label = "Status LED";
        };
    };

    buttons {
        compatible = "gpio-keys";
        user_btn: button_0 {
            gpios = <&gpioc 13 (GPIO_PULL_UP | GPIO_ACTIVE_LOW)>;
            label = "User Button";
        };
    };
};
```

In C code, the pin is referenced through `gpio_dt_spec`:

```c
static const struct gpio_dt_spec led =
    GPIO_DT_SPEC_GET(DT_NODELABEL(status_led), gpios);

static const struct gpio_dt_spec btn =
    GPIO_DT_SPEC_GET(DT_NODELABEL(user_btn), gpios);

void init_gpio(void) {
    gpio_pin_configure_dt(&led, GPIO_OUTPUT_ACTIVE);
    gpio_pin_configure_dt(&btn, GPIO_INPUT);
}
```

The `gpio_pin_configure_dt()` call merges the flags from the devicetree (pull-up, active-low) with the runtime flags (input/output direction). The active-low flag (`GPIO_ACTIVE_LOW`) inverts the logical sense automatically — `gpio_pin_set_dt(&led, 1)` drives the pin low if the devicetree specifies active-low. Pin mux for alternate functions lives in the board-level pinctrl devicetree node, not in the GPIO configuration.

## Cross-Platform Comparison

The same logical operation — configure PA5 as push-pull output, no pull — across all four approaches:

| Aspect | Register Direct | STM32 HAL | ESP-IDF | Zephyr |
|--------|----------------|-----------|---------|--------|
| Clock enable | Manual RCC write | `__HAL_RCC_GPIOx_CLK_ENABLE()` | Automatic | Automatic |
| Pin selection | Bit shift math | `GPIO_PIN_5` enum | `GPIO_NUM_x` enum | Devicetree node |
| Direction | MODER write | `Mode` field | `mode` field | `GPIO_OUTPUT` flag |
| Output type | OTYPER write | Encoded in `Mode` | Not applicable | `GPIO_PUSH_PULL` flag |
| Speed | OSPEEDR write | `Speed` field | `gpio_set_drive_capability()` | Board pinctrl |
| Pull resistor | PUPDR write | `Pull` field | `pull_up_en`/`pull_down_en` | Devicetree flags |
| AF selection | AFR write | `Alternate` field | GPIO matrix / IOMUX | Pinctrl node |

## Tips

- Always enable the GPIO port clock before writing any configuration register — on STM32, writes to GPIO registers without the clock enabled are silently ignored, producing no error and no effect.
- Set the speed register to the lowest setting that meets timing requirements — higher speed classes increase EMI and current consumption with no benefit for slow-toggling signals like LEDs or relay controls.
- When using STM32 HAL, zero-initialize `GPIO_InitTypeDef` with `= {0}` — uninitialized fields contain stack garbage that can configure unexpected alternate functions or interrupt modes.
- On ESP32, check the pin's IOMUX default before routing through the GPIO matrix — IOMUX-native assignments (e.g., HSPI pins on GPIO 12-15) have lower latency and deterministic timing compared to matrix-routed signals.
- In Zephyr, use `gpio_pin_configure_dt()` instead of `gpio_pin_configure()` to automatically apply devicetree flags — calling the non-`_dt` variant ignores active-low and pull settings defined in the overlay.

## Caveats

- **STM32 debug pins reset to alternate function mode, not analog** — PA13 (SWDIO) and PA14 (SWCLK) default to AF0 after reset; reconfiguring these pins as GPIO disables the debug port, making the chip unprogrammable until a reset-and-connect sequence is used.
- **ESP32 GPIO 34-39 are input-only with no internal pull resistors** — Configuring pull-up or pull-down on these pins via `gpio_config()` returns ESP_OK but has no effect; external pull resistors are required.
- **Speed setting affects more than edge rate** — On STM32F4, GPIO_SPEED_FREQ_VERY_HIGH (100 MHz) increases dynamic current draw per pin by 2-5 mA compared to low speed; for battery-powered designs with many outputs, this adds up.
- **Zephyr devicetree flags silently override C flags in unexpected ways** — If the devicetree specifies `GPIO_PULL_UP` but the C code passes `GPIO_PULL_DOWN` to `gpio_pin_configure_dt()`, the devicetree flag wins for some drivers and the C flag wins for others, depending on the vendor HAL underneath.
- **Analog mode on STM32 is not just "high impedance"** — Setting MODER to analog disconnects the Schmitt trigger input, which means reading IDR in analog mode always returns 0 regardless of pin voltage; this catches code that tries to read ADC-capable pins digitally without switching mode first.

## In Practice

- A pin that reads constant 0 despite a known signal on the physical pad often shows up as a missed clock enable — the GPIO port register reads back all zeros when the bus clock is gated off.
- An SPI peripheral that sends nothing on MOSI despite correct SPI register configuration typically traces to the wrong alternate function number — the AF table in CubeMX and the datasheet sometimes use different naming (e.g., AF5 vs AF6 for SPI3 depending on the specific STM32F4 variant).
- An ESP32 output that drives weaker than expected, failing to pull an LED to full brightness, commonly appears when the drive strength defaults to level 0 (~5 mA) — calling `gpio_set_drive_capability(pin, GPIO_DRIVE_CAP_2)` increases it to ~20 mA.
- A Zephyr application where `gpio_pin_set_dt(&led, 1)` turns the LED off instead of on indicates the devicetree `GPIO_ACTIVE_LOW` flag is missing or inverted — the `_dt` API respects the active-level flag, so the logical sense and physical polarity must agree in the overlay.
- A pin that unexpectedly oscillates or rings on a scope after reconfiguration from alternate function back to output often results from OSPEEDR being left at high-speed from the peripheral driver's init — lowering the speed class eliminates the overshoot.
