---
title: "Chip-Select Management"
weight: 20
---

# Chip-Select Management

The chip-select (CS) line determines which device on a shared SPI bus is active for a given transaction. CS is active-low by convention — asserting CS means driving the pin low, and deasserting means driving it high. Getting CS timing right is the difference between clean SPI communication and intermittent data corruption that only appears under load or at higher clock speeds. Most SPI bugs that appear random are actually CS timing issues.

## Hardware NSS vs Software-Managed CS

STM32 SPI peripherals provide a hardware NSS (Slave Select) pin that can be driven automatically by the SPI peripheral. In theory, hardware NSS simplifies firmware by removing manual GPIO toggling. In practice, STM32 hardware NSS in master mode has significant limitations that make it unsuitable for most real applications.

The primary problem: STM32 hardware NSS in output mode (`SPI_NSS_HARD_OUTPUT`) deasserts CS between every data frame. For a multi-byte transfer, CS goes high between each byte, which violates the protocol requirements of nearly every SPI device. Flash chips, ADCs, and display controllers all require CS to stay asserted for the entire command-response sequence.

The STM32H7 series introduced NSS pulse mode (`SPI_CR2.NSSP`), which inserts a one-clock-cycle CS pulse between frames in Motorola SPI mode. This is useful for devices that expect per-frame CS toggling (certain DACs and shift registers) but is still wrong for devices requiring sustained CS assertion.

The standard approach is software-managed CS: configure a regular GPIO as push-pull output, and toggle it explicitly around each transaction:

```c
/* Software CS management — the standard pattern */
#define FLASH_CS_PIN    GPIO_PIN_4
#define FLASH_CS_PORT   GPIOA

static inline void flash_cs_assert(void) {
    HAL_GPIO_WritePin(FLASH_CS_PORT, FLASH_CS_PIN, GPIO_PIN_RESET);
}

static inline void flash_cs_deassert(void) {
    HAL_GPIO_WritePin(FLASH_CS_PORT, FLASH_CS_PIN, GPIO_PIN_SET);
}

/* Read status register from W25Q flash: CS stays low for entire sequence */
uint8_t flash_read_status(SPI_HandleTypeDef *hspi) {
    uint8_t cmd = 0x05;  /* READ STATUS REGISTER-1 */
    uint8_t status;

    flash_cs_assert();
    HAL_SPI_Transmit(hspi, &cmd, 1, HAL_MAX_DELAY);
    HAL_SPI_Receive(hspi, &status, 1, HAL_MAX_DELAY);
    flash_cs_deassert();

    return status;
}
```

The SPI init structure uses `SPI_NSS_SOFT` to disable hardware NSS, and the `SSI` bit must be set high (the HAL handles this) to prevent the peripheral from entering slave mode:

```c
hspi1.Init.NSS = SPI_NSS_SOFT;
```

On ESP-IDF, CS management is automatic by default — the driver asserts CS before each transaction and deasserts it after. The `spics_io_num` field in the device configuration specifies which GPIO to use as CS. For manual control (needed for multi-part transactions), set `spics_io_num = -1` and manage the GPIO directly:

```c
spi_device_interface_config_t dev_cfg = {
    .mode           = 0,
    .clock_speed_hz = 10 * 1000000,
    .spics_io_num   = -1,   /* Manual CS management */
    .queue_size     = 4,
};
```

## CS Timing Requirements

Two critical timing parameters govern CS behavior:

**Setup time (t_CSS)**: The minimum delay between CS assertion (going low) and the first SCK edge. Most devices require 5-50 ns. The W25Q128 specifies 5 ns minimum. At SPI clock rates below 20 MHz, the GPIO write plus the SPI peripheral startup latency exceeds this requirement naturally. At higher clock speeds or on faster MCUs (STM32H7 at 480 MHz), an explicit delay or NOP sequence may be needed between `cs_assert()` and the first SPI transfer call.

**Hold time (t_CSH)**: The minimum delay between the last SCK edge and CS deassertion (going high). Similarly small (5-10 ns typically), but violating it can cause the device to miss the last bit of a transaction. The SPI busy flag (`SPI_SR.BSY`) must be checked before deasserting CS to ensure the last byte has fully shifted out:

```c
/* Safe CS deassertion — wait for the last byte to complete */
static void spi_wait_complete(SPI_HandleTypeDef *hspi) {
    /* Wait until TXE=1 (transmit buffer empty) */
    while (!(hspi->Instance->SR & SPI_SR_TXE))
        ;
    /* Wait until BSY=0 (SPI not busy — last bit shifted out) */
    while (hspi->Instance->SR & SPI_SR_BSY)
        ;
}

void flash_write_enable(SPI_HandleTypeDef *hspi) {
    uint8_t cmd = 0x06;  /* WRITE ENABLE */
    flash_cs_assert();
    HAL_SPI_Transmit(hspi, &cmd, 1, HAL_MAX_DELAY);
    spi_wait_complete(hspi);
    flash_cs_deassert();
}
```

## CS Must Stay Asserted During Multi-Byte Transfers

This is the most violated CS rule and the most common source of SPI bugs. Many SPI devices treat CS deassertion as a transaction boundary — the command and its response are one atomic unit. For a W25Q flash "Read Data" command (0x03 followed by a 24-bit address followed by N data bytes), CS must remain low from the command byte through the last received data byte. Deasserting CS mid-sequence aborts the transaction and the device resets its internal state machine.

Similarly, a display controller like the ILI9341 expects CS to remain asserted through a command byte and all of its parameter bytes. Deasserting between the command and its parameters causes the controller to interpret parameter bytes as new commands, producing erratic display behavior.

```c
/* W25Q flash: read N bytes starting at a 24-bit address */
void flash_read(SPI_HandleTypeDef *hspi, uint32_t addr,
                uint8_t *buf, uint16_t len) {
    uint8_t cmd[4];
    cmd[0] = 0x03;                   /* READ DATA command */
    cmd[1] = (addr >> 16) & 0xFF;    /* Address byte 2 (MSB) */
    cmd[2] = (addr >> 8) & 0xFF;     /* Address byte 1 */
    cmd[3] = addr & 0xFF;            /* Address byte 0 (LSB) */

    flash_cs_assert();
    HAL_SPI_Transmit(hspi, cmd, 4, HAL_MAX_DELAY);
    HAL_SPI_Receive(hspi, buf, len, HAL_MAX_DELAY);
    spi_wait_complete(hspi);
    flash_cs_deassert();
}
```

## Per-Device CS Pins

Each device on a shared SPI bus needs its own CS pin. Only one CS should be asserted at a time — asserting multiple CS lines simultaneously causes bus contention on the MISO line (both devices try to drive it), which can produce incorrect data or, in the worst case, damage output drivers. A typical multi-device bus uses one GPIO per device:

| Device         | CS Pin | Port  |
|---------------|--------|-------|
| W25Q128 Flash | PA4    | GPIOA |
| ILI9341 LCD   | PB0    | GPIOB |
| ADS1256 ADC   | PB1    | GPIOB |

All CS pins must be initialized high (deasserted) before enabling the SPI peripheral. A CS pin left floating or low at startup can latch a device into an unexpected state that persists until the device is power-cycled.

```c
/* Initialize all CS pins high before SPI init */
static void cs_pins_init(void) {
    GPIO_InitTypeDef gpio = {0};
    gpio.Mode  = GPIO_MODE_OUTPUT_PP;
    gpio.Pull  = GPIO_NOPULL;
    gpio.Speed = GPIO_SPEED_FREQ_HIGH;

    __HAL_RCC_GPIOA_CLK_ENABLE();
    __HAL_RCC_GPIOB_CLK_ENABLE();

    /* Set all CS pins high before configuring as outputs */
    HAL_GPIO_WritePin(GPIOA, GPIO_PIN_4, GPIO_PIN_SET);
    HAL_GPIO_WritePin(GPIOB, GPIO_PIN_0 | GPIO_PIN_1, GPIO_PIN_SET);

    gpio.Pin = GPIO_PIN_4;
    HAL_GPIO_Init(GPIOA, &gpio);

    gpio.Pin = GPIO_PIN_0 | GPIO_PIN_1;
    HAL_GPIO_Init(GPIOB, &gpio);
}
```

Setting the output data register before configuring the pin direction ensures the CS line never glitches low during initialization. On STM32, writing `BSRR` (via `HAL_GPIO_WritePin`) before `MODER` accomplishes this.

## Tips

- Always use software-managed CS (`SPI_NSS_SOFT`) for master-mode SPI on STM32 — hardware NSS in master mode creates more problems than it solves and is unsuitable for nearly all multi-byte protocols.
- Initialize all CS pins to the deasserted (high) state before configuring the SPI peripheral — this prevents glitching that can latch devices into unexpected states.
- Check the SPI busy flag (`BSY` in `SPI_SR`) before deasserting CS — this ensures the last bit has fully clocked out and the device has captured it.
- Use `static inline` wrapper functions for CS assert/deassert rather than raw GPIO calls — this centralizes the pin assignment and makes multi-device buses easier to manage.
- On ESP-IDF, use the built-in CS management (`spics_io_num`) for single-transaction devices; switch to manual CS only when multi-part transactions (command + response) require sustained assertion.

## Caveats

- **STM32 hardware NSS in master mode deasserts between every byte** — This breaks nearly every SPI device protocol. The NSS pulse mode on H7 does not fix this for devices that require sustained CS assertion across multiple bytes.
- **A floating CS pin can latch a device into an active state at power-up** — If the CS GPIO is configured after the SPI peripheral starts clocking, the device may interpret noise on the bus as valid commands. External pull-up resistors (10k to 3.3V) on CS lines provide a safe default.
- **Deasserting CS too early truncates the last bit** — The SPI transmit buffer may report "empty" while the shift register is still clocking out the final bit. Only the BSY flag reliably indicates that the transfer is fully complete.
- **Multiple CS lines asserted simultaneously causes MISO contention** — Two devices driving MISO in opposite directions creates an indeterminate logic level and can source enough current to damage output stages, especially on 3.3V parts with limited current sinking.
- **Some devices require a minimum CS high time between transactions** — The W25Q series needs 50 ns minimum CS high time (t_CSHH) between consecutive commands. Back-to-back transactions without this gap can cause command misinterpretation.

## In Practice

- An SPI device that responds correctly to single-byte commands but returns garbage during multi-byte reads often indicates that CS is being deasserted between bytes — a logic analyzer trace shows CS toggling high between each byte boundary.
- A flash chip that accepts write-enable commands but never actually enables writes commonly has a CS hold time violation — the last bit of the WREN (0x06) command did not clock in before CS went high, so the device received an incomplete command.
- Random data corruption that appears only at higher SPI clock speeds and disappears below 1 MHz typically traces to CS setup time violations — the first clock edge arrives before the device has recognized CS assertion, causing it to miss the first bit of the command.
- A multi-device SPI bus where one device works perfectly in isolation but returns corrupt data when other devices are also connected often has a CS initialization problem — one of the other device's CS pins is floating low, causing MISO contention.
- An ILI9341 display that shows random pixels or incorrect colors despite correct initialization code commonly results from CS deassertion between the command byte and its parameter bytes — the controller interprets parameter data as new commands.
