---
title: "Error Recovery & Bus Reset"
weight: 30
---

# Error Recovery & Bus Reset

I²C errors fall into two categories: protocol-level errors that the hardware peripheral detects (NACK, arbitration loss, bus error) and bus-level failures that the peripheral cannot self-recover from (stuck SDA, phantom busy flag). The first category is handled by error callbacks and retry logic. The second requires manual intervention — toggling GPIOs, resetting the peripheral, or power-cycling the bus. Firmware that does not handle both categories will eventually lock up in the field, because every I²C bus will eventually encounter a stuck condition, and no amount of software reset will clear a slave device that is holding SDA low mid-byte.

## Common I²C Error Conditions

| Error | Flag (STM32) | Cause | Recoverable? |
|-------|-------------|-------|--------------|
| Address NACK | AF (Acknowledge Failure) | Device not present, wrong address, device busy | Yes — retry |
| Data NACK | AF | Device rejected data (write protect, invalid register) | Yes — check data |
| Bus Error | BERR | START/STOP at illegal position, noise glitch | Yes — peripheral reset |
| Arbitration Lost | ARLO | Another master won arbitration | Yes — retry later |
| Bus Busy | BUSY flag stuck | Slave holding SDA low, incomplete transaction | Requires bus recovery |
| Overrun/Underrun | OVR | DMA or interrupt latency | Yes — peripheral reset |

## NACK Detection and Handling

A NACK on the address byte means the slave did not respond — the device is missing, powered down, or the address is wrong. A NACK on a data byte means the slave received the address but rejected the data. The STM32 HAL reports both through `HAL_I2C_ERROR_AF`:

```c
void HAL_I2C_ErrorCallback(I2C_HandleTypeDef *hi2c) {
    uint32_t err = hi2c->ErrorCode;

    if (err & HAL_I2C_ERROR_AF) {
        // Acknowledge failure — device did not respond
        // Check: is the device address correct? Is it powered?
        i2c_nack_count++;
    }
    if (err & HAL_I2C_ERROR_BERR) {
        // Bus error — reset the peripheral
        HAL_I2C_DeInit(hi2c);
        HAL_I2C_Init(hi2c);
    }
    if (err & HAL_I2C_ERROR_ARLO) {
        // Arbitration lost — retry after delay
        i2c_arb_lost_count++;
    }
    if (err & HAL_I2C_ERROR_OVR) {
        // Overrun — reset peripheral, increase interrupt priority
        HAL_I2C_DeInit(hi2c);
        HAL_I2C_Init(hi2c);
    }
}
```

## The Stuck SDA Problem

The most notorious I²C failure mode occurs when a slave device holds SDA low indefinitely. This happens when a transaction is interrupted mid-byte — for example, by a master reset during a read transfer. The slave was sending a data byte with SDA low (a zero bit), saw the clock stop, and is now waiting for SCL transitions to finish the byte. From the slave's perspective, the transaction is still active. From the master's perspective (after reset), the bus is busy and cannot be used.

The I²C specification defines a recovery procedure: the master must toggle SCL manually (as a GPIO, not through the I²C peripheral) to clock the slave through the remainder of its byte. After at most 9 clock pulses, the slave will have shifted out all remaining bits and released SDA. At that point, the master can generate a STOP condition to reset the bus.

## Bus Recovery Implementation

A complete bus recovery function for STM32:

```c
#define I2C_SCL_PIN    GPIO_PIN_6
#define I2C_SDA_PIN    GPIO_PIN_7
#define I2C_GPIO_PORT  GPIOB

void i2c_bus_recovery(I2C_HandleTypeDef *hi2c) {
    GPIO_InitTypeDef gpio = {0};

    // Step 1: Disable the I2C peripheral
    HAL_I2C_DeInit(hi2c);

    // Step 2: Configure SCL as push-pull output, SDA as input
    gpio.Pin   = I2C_SCL_PIN;
    gpio.Mode  = GPIO_MODE_OUTPUT_PP;
    gpio.Pull  = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;
    HAL_GPIO_Init(I2C_GPIO_PORT, &gpio);

    gpio.Pin  = I2C_SDA_PIN;
    gpio.Mode = GPIO_MODE_INPUT;
    gpio.Pull = GPIO_PULLUP;
    HAL_GPIO_Init(I2C_GPIO_PORT, &gpio);

    // Step 3: Toggle SCL up to 9 times, checking SDA after each
    for (int i = 0; i < 9; i++) {
        HAL_GPIO_WritePin(I2C_GPIO_PORT, I2C_SCL_PIN, GPIO_PIN_RESET);
        HAL_Delay(1);  // ~1 ms half-period (well below 100 kHz)
        HAL_GPIO_WritePin(I2C_GPIO_PORT, I2C_SCL_PIN, GPIO_PIN_SET);
        HAL_Delay(1);

        // Check if SDA is released
        if (HAL_GPIO_ReadPin(I2C_GPIO_PORT, I2C_SDA_PIN) == GPIO_PIN_SET) {
            break;
        }
    }

    // Step 4: Generate a STOP condition (SDA low->high while SCL high)
    gpio.Pin  = I2C_SDA_PIN;
    gpio.Mode = GPIO_MODE_OUTPUT_PP;
    HAL_GPIO_Init(I2C_GPIO_PORT, &gpio);

    HAL_GPIO_WritePin(I2C_GPIO_PORT, I2C_SDA_PIN, GPIO_PIN_RESET);
    HAL_Delay(1);
    HAL_GPIO_WritePin(I2C_GPIO_PORT, I2C_SCL_PIN, GPIO_PIN_SET);
    HAL_Delay(1);
    HAL_GPIO_WritePin(I2C_GPIO_PORT, I2C_SDA_PIN, GPIO_PIN_SET);  // STOP
    HAL_Delay(1);

    // Step 5: Reconfigure pins as I2C alternate function and reinit
    HAL_I2C_Init(hi2c);
}
```

The `HAL_Delay(1)` calls produce timing well below the 100 kHz I²C maximum, which is intentional — the recovery sequence needs to be slow enough for any slave to track. Faster toggling risks missing a slave that is in an unknown internal state.

## Timeout-Based Error Detection

The HAL's built-in timeout (the last parameter in `HAL_I2C_Mem_Read` and similar functions) is the first layer of defense. But the timeout only catches the case where the bus goes idle — it does not catch the case where the bus is continuously busy from the start.

A second layer checks the BUSY flag before initiating any transaction:

```c
#define I2C_BUSY_TIMEOUT_MS  50

HAL_StatusTypeDef i2c_wait_until_ready(I2C_HandleTypeDef *hi2c) {
    uint32_t start = HAL_GetTick();

    while (__HAL_I2C_GET_FLAG(hi2c, I2C_FLAG_BUSY)) {
        if ((HAL_GetTick() - start) > I2C_BUSY_TIMEOUT_MS) {
            return HAL_TIMEOUT;
        }
    }
    return HAL_OK;
}
```

When this function returns `HAL_TIMEOUT`, the bus recovery procedure should be triggered.

## Retry Logic with Backoff

A single NACK or bus error often resolves on its own — the device was temporarily busy, or a noise glitch caused a bus error. A simple retry with linear backoff handles these transient conditions:

```c
#define I2C_MAX_RETRIES    5
#define I2C_RETRY_BASE_MS  2

HAL_StatusTypeDef i2c_read_with_retry(I2C_HandleTypeDef *hi2c,
                                       uint16_t dev_addr,
                                       uint16_t reg_addr,
                                       uint8_t *data,
                                       uint16_t len) {
    HAL_StatusTypeDef status;

    for (int attempt = 0; attempt < I2C_MAX_RETRIES; attempt++) {
        // Check bus availability
        if (i2c_wait_until_ready(hi2c) != HAL_OK) {
            i2c_bus_recovery(hi2c);
            continue;
        }

        status = HAL_I2C_Mem_Read(hi2c, dev_addr, reg_addr,
                                  I2C_MEMADD_SIZE_8BIT,
                                  data, len, 100);

        if (status == HAL_OK) {
            return HAL_OK;
        }

        // Delay before retry: 2, 4, 8, 16, 32 ms
        HAL_Delay(I2C_RETRY_BASE_MS << attempt);

        // Reset peripheral on bus error
        if (hi2c->ErrorCode & (HAL_I2C_ERROR_BERR | HAL_I2C_ERROR_OVR)) {
            HAL_I2C_DeInit(hi2c);
            HAL_I2C_Init(hi2c);
        }
    }

    // All retries exhausted — attempt full bus recovery
    i2c_bus_recovery(hi2c);
    return HAL_ERROR;
}
```

Exponential backoff is sometimes recommended but rarely necessary for I²C — the failure modes are typically either transient (resolved in 1-2 retries) or persistent (requiring bus recovery, not longer delays). Linear or power-of-two backoff up to about 32 ms is sufficient. Delays beyond 50 ms indicate a stuck bus condition that no amount of waiting will resolve.

## Peripheral Software Reset

The STM32 I2C peripheral has a software reset bit (SWRST in I2C_CR1 on F4, or the RCC peripheral reset register) that resets the internal state machine without affecting GPIO configuration:

```c
// Method 1: SWRST bit (STM32F4)
I2C1->CR1 |= I2C_CR1_SWRST;
HAL_Delay(1);
I2C1->CR1 &= ~I2C_CR1_SWRST;
// Must reconfigure all I2C registers after SWRST

// Method 2: RCC reset (works on all STM32)
__HAL_RCC_I2C1_FORCE_RESET();
HAL_Delay(1);
__HAL_RCC_I2C1_RELEASE_RESET();
// Must reconfigure all I2C registers after RCC reset

// Method 3: HAL DeInit/Init (safest, handles all cleanup)
HAL_I2C_DeInit(&hi2c1);
HAL_I2C_Init(&hi2c1);
```

The RCC reset method is the most thorough — it resets every register in the peripheral to its default value. The SWRST method resets the state machine but may leave some configuration registers intact depending on the silicon revision. `HAL_I2C_DeInit` followed by `HAL_I2C_Init` is the safest approach from application code.

## ESP-IDF Error Recovery

On ESP32, the I2C driver provides timeout handling internally, but bus recovery requires manual intervention:

```c
esp_err_t i2c_bus_recover(i2c_port_t port) {
    // Uninstall the driver to release GPIO control
    i2c_driver_delete(port);

    // Configure SCL as GPIO output
    gpio_set_direction(GPIO_NUM_22, GPIO_MODE_OUTPUT);
    gpio_set_direction(GPIO_NUM_21, GPIO_MODE_INPUT);
    gpio_set_pull_mode(GPIO_NUM_21, GPIO_PULLUP_ONLY);

    // Clock out up to 9 pulses
    for (int i = 0; i < 9; i++) {
        gpio_set_level(GPIO_NUM_22, 0);
        esp_rom_delay_us(5);
        gpio_set_level(GPIO_NUM_22, 1);
        esp_rom_delay_us(5);

        if (gpio_get_level(GPIO_NUM_21) == 1) {
            break;
        }
    }

    // Generate STOP condition
    gpio_set_direction(GPIO_NUM_21, GPIO_MODE_OUTPUT);
    gpio_set_level(GPIO_NUM_21, 0);
    esp_rom_delay_us(5);
    gpio_set_level(GPIO_NUM_22, 1);
    esp_rom_delay_us(5);
    gpio_set_level(GPIO_NUM_21, 1);

    // Reinstall the I2C driver
    i2c_config_t conf = { /* ... original config ... */ };
    i2c_param_config(port, &conf);
    return i2c_driver_install(port, conf.mode, 0, 0, 0);
}
```

The pattern is identical to the STM32 approach: take GPIO control away from the peripheral, clock out the stuck byte, generate STOP, then reinitialize.

## Tips

- Always implement a bus recovery function — even if the bus works perfectly during development, field conditions (power glitches, ESD events, connector vibration) will eventually produce a stuck bus condition
- Keep the BUSY flag timeout short (25-50 ms) — a genuinely busy bus with a single master resolves in under 10 ms at 100 kHz for the longest possible transaction. A BUSY flag that persists beyond 50 ms is a stuck condition, not a legitimate transfer
- Limit retries to 3-5 attempts before escalating to bus recovery — infinite retry loops mask real hardware problems and make the firmware appear to hang
- Maintain error counters (NACK count, bus error count, recovery count) and expose them through a debug interface — these counters provide early warning of degrading bus health before hard failures occur
- After bus recovery, re-read any cached sensor configuration registers — some devices reset their internal configuration when they see the recovery STOP condition, reverting to power-on defaults

## Caveats

- **A software reset of the I²C peripheral does not release a stuck slave** — The peripheral reset clears the master's state machine, but the slave is a separate device still holding SDA low. Bus recovery (SCL toggling) is required to unstick the slave. Calling `HAL_I2C_Init` repeatedly without GPIO-level recovery is a common mistake that never resolves the stuck condition
- **The STM32F4 BUSY flag can become permanently set due to a silicon bug** — Errata sheet ES0182 documents that certain interrupt sequences can leave the BUSY flag asserted even with no activity on the bus. The only workaround is the GPIO-level SCL toggle sequence followed by a peripheral reset via the RCC register
- **Bus recovery while other slaves are mid-transaction can corrupt their state** — The 9 SCL pulses that unstick one device look like valid clock transitions to every other device on the bus. Devices that were idle are unaffected, but any device that was in the middle of a transaction (e.g., an EEPROM write in progress) may interpret the recovery clocks as data. In multi-device systems, bus recovery should be followed by re-reading the status of all devices
- **HAL_I2C_ErrorCallback is only called in interrupt/DMA mode** — In polling mode (which `HAL_I2C_Mem_Read` uses by default), errors are reported only through the return value and `hi2c->ErrorCode`. Code that relies on the error callback for polling-mode error handling will never see it fire
- **Timeout values in milliseconds hide the real timing** — A 100 ms timeout at 400 kHz allows over 40,000 clock cycles of bus activity. Genuine timeouts should be 2-5x the expected transaction duration, not an order of magnitude larger

## In Practice

- A bus that works for hours and then locks up permanently — requiring a power cycle to recover — is the classic stuck SDA symptom. The logic analyzer shows SDA held low with no SCL activity. This commonly appears after a firmware update or debugging session that reset the master while a sensor was mid-read
- **Intermittent NACK errors that correlate with a specific device** on a multi-device bus usually indicate that the failing device is slow to release clock stretching. The master's timeout expires before the device releases SCL, and the master interprets the incomplete transfer as a NACK. Increasing the timeout or reducing the I²C clock speed resolves this, but the root cause is insufficient clock-stretch tolerance in the master configuration
- A bus that shows continuous traffic on the logic analyzer — repeating START conditions every few milliseconds — without ever completing a transaction indicates a firmware retry loop that is not escalating to bus recovery. Each retry encounters the same stuck condition, fails, and retries immediately. This shows up as 100% bus utilization with zero successful transactions
- **An I2C peripheral that reports BUSY immediately after initialization** — before any transaction is attempted — indicates that SDA or SCL is being held low by external hardware. The most common cause is a missing pull-up resistor: with no pull-up, the open-drain bus floats low, and the peripheral sees a continuous bus-busy condition. Checking SDA and SCL levels with a multimeter (both should read close to VCC with pull-ups) is the fastest diagnostic
