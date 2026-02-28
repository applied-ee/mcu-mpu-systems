---
title: "SPI Mode Configuration & Clock Polarity"
weight: 10
---

# SPI Mode Configuration & Clock Polarity

SPI communication hinges on two clock parameters — polarity and phase — that together define four operating modes. Every SPI device datasheet specifies which mode the device expects, and a mismatch by even one bit produces garbled data or complete silence. The mode must be set before the first clock edge leaves the master, and once a transfer is in progress, the mode cannot change until the bus returns to idle.

## CPOL and CPHA: The Four Modes

The two configuration bits that define SPI timing are:

- **CPOL** (Clock Polarity): the idle state of the clock line. CPOL=0 means SCK idles low; CPOL=1 means SCK idles high.
- **CPHA** (Clock Phase): which clock edge captures data. CPHA=0 means data is sampled on the first (leading) edge and shifted out on the second (trailing) edge. CPHA=1 means data is shifted out on the first edge and sampled on the second edge.

These combine into four modes:

| Mode | CPOL | CPHA | Clock Idle | Sample Edge | Shift Edge |
|------|------|------|------------|-------------|------------|
| 0    | 0    | 0    | Low        | Rising      | Falling    |
| 1    | 0    | 1    | Low        | Falling     | Rising     |
| 2    | 1    | 0    | High       | Falling     | Rising     |
| 3    | 1    | 1    | High       | Rising      | Falling    |

Mode 0 (CPOL=0, CPHA=0) is by far the most common default. SD cards, most NOR flash chips (W25Q series, IS25LP series), and many display controllers (ILI9341, ST7789) use mode 0. Some ADCs like the ADS1256 use mode 1 (CPOL=0, CPHA=1). Mode 3 (CPOL=1, CPHA=1) appears in certain accelerometers (ADXL345 supports both mode 0 and mode 3) and some RF transceivers. Mode 2 is rare in practice.

## Reading a Device Datasheet for SPI Mode

Device datasheets often do not state "Mode 0" explicitly. Instead, they provide a timing diagram showing the clock waveform relative to data transitions. The reliable method for extracting the mode:

1. Look at where SCK sits before CS is asserted — this determines CPOL. If SCK is low before the first edge, CPOL=0.
2. Identify which edge the datasheet labels as the data capture point — the edge where MISO is stable and valid. If capture happens on the first edge after CS assertion, CPHA=0.
3. Cross-reference with the mode table above.

Some datasheets use alternative terminology: "clock polarity" and "clock phase" map directly to CPOL and CPHA. Older Motorola documentation uses "CPOL" and "CPHA" while some TI-convention datasheets refer to the capture edge directly.

## STM32 SPI Mode Configuration

On STM32, the SPI mode is configured through the `SPI_InitTypeDef` structure. The relevant fields map directly to CPOL and CPHA:

```c
SPI_HandleTypeDef hspi1;

hspi1.Instance               = SPI1;
hspi1.Init.Mode              = SPI_MODE_MASTER;
hspi1.Init.Direction         = SPI_DIRECTION_2LINES;
hspi1.Init.DataSize          = SPI_DATASIZE_8BIT;
hspi1.Init.CLKPolarity       = SPI_POLARITY_LOW;   /* CPOL = 0 */
hspi1.Init.CLKPhase          = SPI_PHASE_1EDGE;    /* CPHA = 0 → Mode 0 */
hspi1.Init.NSS               = SPI_NSS_SOFT;
hspi1.Init.BaudRatePrescaler = SPI_BAUDRATEPRESCALER_8;
hspi1.Init.FirstBit          = SPI_FIRSTBIT_MSB;
hspi1.Init.TIMode            = SPI_TIMODE_DISABLE;
hspi1.Init.CRCCalculation    = SPI_CRCCALCULATION_DISABLE;

if (HAL_SPI_Init(&hspi1) != HAL_OK) {
    Error_Handler();
}
```

The STM32 HAL constants map as follows: `SPI_POLARITY_LOW` = CPOL=0, `SPI_POLARITY_HIGH` = CPOL=1, `SPI_PHASE_1EDGE` = CPHA=0, `SPI_PHASE_2EDGE` = CPHA=1. The naming of `1EDGE` and `2EDGE` refers to the first and second clock transitions after the clock leaves its idle state.

On ESP-IDF, the equivalent configuration uses the `spi_device_interface_config_t` struct, where the mode is specified as a single integer (0-3):

```c
spi_device_interface_config_t dev_cfg = {
    .mode           = 0,             /* SPI Mode 0: CPOL=0, CPHA=0 */
    .clock_speed_hz = 10 * 1000000,  /* 10 MHz */
    .spics_io_num   = GPIO_NUM_5,
    .queue_size     = 4,
};
```

## MSB-First vs LSB-First

The vast majority of SPI devices transmit MSB-first (most significant bit first). STM32 defaults to MSB-first via `SPI_FIRSTBIT_MSB`. A few specialty devices — some shift registers and certain sensor ICs — use LSB-first. When the bit order is wrong, the received data appears bit-reversed: sending 0xC0 arrives as 0x03. The SPI peripheral on STM32 can handle either direction in hardware via the `LSBFIRST` bit in `SPI_CR1`. On ESP32, the `SPI_DEVICE_BIT_LSBFIRST` flag in `spi_device_interface_config_t.flags` controls this. On the RP2040, the PL022 SPI peripheral is always MSB-first; LSB-first must be handled in software by bit-reversing each byte before transmission and after reception.

## Data Frame Size: 8-bit vs 16-bit

STM32 SPI peripherals support both 8-bit and 16-bit data frames via the `DataSize` field. The STM32F4 supports `SPI_DATASIZE_8BIT` and `SPI_DATASIZE_16BIT`. The STM32H7 extends this to arbitrary frame sizes from 4 to 32 bits via the `SPI_CR2.DS` field.

Most SPI devices use 8-bit frames, but some ADCs and DACs use 16-bit or 24-bit word sizes. For 24-bit devices on an 8-bit SPI, three consecutive 8-bit transfers compose one data word. Using 16-bit frame size for a 16-bit ADC eliminates the need to manually combine two 8-bit reads:

```c
/* 16-bit SPI frame for reading a 16-bit ADC like MCP3201 */
hspi1.Init.DataSize = SPI_DATASIZE_16BIT;
HAL_SPI_Init(&hspi1);

uint16_t adc_raw;
HAL_SPI_Receive(&hspi1, (uint8_t *)&adc_raw, 1, HAL_MAX_DELAY);
/* Note: count=1 means one 16-bit frame, not one byte */
```

When switching between 8-bit and 16-bit modes to talk to different devices, the SPI peripheral must be disabled (`SPI_CR1.SPE = 0`), the data size changed, then re-enabled. The HAL handles this through `HAL_SPI_Init()`, but direct register manipulation requires this sequence.

## Clock Frequency and Prescaler Calculation

The SPI clock frequency is derived from the peripheral bus clock through a prescaler. On STM32F4, SPI1 sits on APB2 (84 MHz at 168 MHz SYSCLK) and SPI2/SPI3 sit on APB1 (42 MHz). The prescaler divides the APB clock by powers of 2: 2, 4, 8, 16, 32, 64, 128, or 256.

For SPI1 on STM32F407 at 168 MHz SYSCLK (APB2 = 84 MHz):

| Prescaler | SPI Clock |
|-----------|-----------|
| 2         | 42 MHz    |
| 4         | 21 MHz    |
| 8         | 10.5 MHz  |
| 16        | 5.25 MHz  |
| 32        | 2.625 MHz |
| 64        | 1.3125 MHz|
| 128       | 656 kHz   |
| 256       | 328 kHz   |

The target clock must not exceed the device's maximum SPI frequency. A W25Q128 flash chip specifies 104 MHz maximum for fast-read commands but only 50 MHz for standard read. An SD card in SPI mode requires an initial clock of 100-400 kHz during initialization, then can be raised to up to 25 MHz. The prescaler selection must satisfy the device's maximum clock constraint — choosing the largest clock that stays at or below the device limit.

On ESP32, the SPI clock is specified directly in Hz through the `clock_speed_hz` field, and the driver computes the prescaler internally. The maximum practical SPI clock on ESP32 is 80 MHz for the dedicated SPI2/SPI3 peripherals, though most devices are configured at 10-40 MHz.

On RP2040, the SPI peripheral clock divider is a 16-bit value configured through `spi_set_baudrate()`, allowing fine-grained frequency control from the 125 MHz system clock.

## Tips

- Default to Mode 0 (CPOL=0, CPHA=0) when prototyping with a new device — the majority of SPI peripherals use this mode, and it serves as a safe starting point before consulting the datasheet.
- Start with a conservative prescaler (low clock speed, e.g., 1 MHz) when bringing up a new SPI device — confirm correct communication before increasing the clock to the device's maximum.
- Keep the prescaler table for the target MCU handy during development — the power-of-2 constraint means the exact target frequency is rarely achievable, and the nearest lower frequency should be selected.
- When sharing a bus between 8-bit and 16-bit devices, group transactions by data size to minimize SPI reconfiguration overhead.

## Caveats

- **CPHA=0 and CPHA=1 are not interchangeable "close enough" settings** — A CPHA mismatch does not produce noise or partial data; it shifts the entire bit alignment, causing every byte to be wrong in a systematic, non-obvious pattern.
- **STM32 HAL `SPI_PHASE_1EDGE` does not mean "first rising edge"** — It means the first clock transition from idle, which is a falling edge when CPOL=1. Confusing edge direction with edge count is a common misconfiguration.
- **Changing SPI mode while the peripheral is enabled corrupts the current transfer** — The SPI peripheral must be fully disabled (SPE=0) and the transmit FIFO drained before modifying CPOL or CPHA bits in `SPI_CR1`.
- **Some devices tolerate both Mode 0 and Mode 3 but not Mode 1 or Mode 2** — This is because Mode 0 and Mode 3 share the same sampling edge (first clock transition relative to data), differing only in idle polarity. Assuming all four modes are equally likely leads to wasted debugging time.
- **The RP2040 PL022 SPI does not support LSB-first in hardware** — Firmware must bit-reverse data manually, which adds overhead per byte and is easy to forget when porting code from STM32.

## In Practice

- An SPI device that returns 0xFF for every byte regardless of command often indicates a mode mismatch — the device is not recognizing the clock edges and keeps its MISO line idle (pulled high), producing all-ones data.
- A device that returns shifted or rotated data (e.g., 0x68 instead of 0x34) suggests a CPHA error — the data is being sampled one half-clock-period off, capturing the previous bit's value instead of the current one.
- An SD card that fails to respond during initialization but works at lower clock speeds commonly points to the initial 100-400 kHz clock requirement not being met — the card ignores commands sent at full bus speed before completing its power-up sequence.
- SPI communication that works on one STM32 board but fails on another with the same code often traces to a different APB clock frequency — if SYSCLK or the APB prescaler differs, the SPI prescaler produces a different clock speed that may exceed the device limit.
- A logic analyzer capture showing data transitions on the wrong clock edge, with the clock idling high instead of low, confirms a CPOL mismatch — the fix is to toggle `CLKPolarity` in the SPI init structure.
