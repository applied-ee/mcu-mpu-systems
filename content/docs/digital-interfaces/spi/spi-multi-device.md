---
title: "Multi-Device SPI Buses"
weight: 40
---

# Multi-Device SPI Buses

A single SPI peripheral can communicate with multiple devices by sharing MOSI, MISO, and SCK while providing a dedicated CS line for each device. This saves peripheral count and GPIO pins, but introduces constraints: devices with different speed requirements, different SPI modes, or conflicting MISO drive behavior must all coexist on the same three wires. Knowing when shared-bus topology works — and when separate SPI peripherals are the safer choice — prevents subtle bugs that only appear when two devices interact.

## Shared-Bus Topology

The standard multi-device SPI layout connects all devices to common MOSI, MISO, and SCK lines, with a separate CS GPIO for each device:

```
          ┌──────────┐
     MOSI─┤          ├─── CS0 → Flash (W25Q128)
     MISO─┤  STM32   ├─── CS1 → ADC (ADS1256)
      SCK─┤  SPI1    ├─── CS2 → Display (ILI9341)
          └──────────┘
```

Only one CS is asserted at a time. When CS is deasserted, the device releases MISO (tristates the output), allowing another device to drive it. This tristate behavior is what makes shared MISO possible — and its absence is what breaks shared buses.

## Per-Device Configuration: The Device Context Pattern

When devices on the same bus require different SPI settings (mode, speed, bit order), the SPI peripheral must be reconfigured before each transaction. A device context struct encapsulates per-device settings and a select/deselect pattern ensures clean bus transitions:

```c
typedef struct {
    GPIO_TypeDef *cs_port;
    uint16_t      cs_pin;
    uint32_t      clk_polarity;   /* SPI_POLARITY_LOW or _HIGH */
    uint32_t      clk_phase;      /* SPI_PHASE_1EDGE or _2EDGE */
    uint32_t      prescaler;      /* SPI_BAUDRATEPRESCALER_x */
    uint32_t      data_size;      /* SPI_DATASIZE_8BIT or _16BIT */
    uint32_t      first_bit;      /* SPI_FIRSTBIT_MSB or _LSB */
} spi_device_t;

/* Device definitions */
static const spi_device_t flash_dev = {
    .cs_port      = GPIOA,
    .cs_pin       = GPIO_PIN_4,
    .clk_polarity = SPI_POLARITY_LOW,
    .clk_phase    = SPI_PHASE_1EDGE,       /* Mode 0 */
    .prescaler    = SPI_BAUDRATEPRESCALER_4, /* 21 MHz from 84 MHz APB2 */
    .data_size    = SPI_DATASIZE_8BIT,
    .first_bit    = SPI_FIRSTBIT_MSB,
};

static const spi_device_t adc_dev = {
    .cs_port      = GPIOB,
    .cs_pin       = GPIO_PIN_0,
    .clk_polarity = SPI_POLARITY_LOW,
    .clk_phase    = SPI_PHASE_2EDGE,       /* Mode 1 */
    .prescaler    = SPI_BAUDRATEPRESCALER_32, /* 2.625 MHz */
    .data_size    = SPI_DATASIZE_8BIT,
    .first_bit    = SPI_FIRSTBIT_MSB,
};

static const spi_device_t display_dev = {
    .cs_port      = GPIOB,
    .cs_pin       = GPIO_PIN_1,
    .clk_polarity = SPI_POLARITY_LOW,
    .clk_phase    = SPI_PHASE_1EDGE,       /* Mode 0 */
    .prescaler    = SPI_BAUDRATEPRESCALER_2, /* 42 MHz */
    .data_size    = SPI_DATASIZE_8BIT,
    .first_bit    = SPI_FIRSTBIT_MSB,
};
```

The select function reconfigures the SPI peripheral and asserts CS. The deselect function deasserts CS. The SPI peripheral must be disabled before changing mode or prescaler settings:

```c
static void spi_device_select(SPI_HandleTypeDef *hspi,
                               const spi_device_t *dev) {
    /* Disable SPI before reconfiguring */
    __HAL_SPI_DISABLE(hspi);

    /* Apply per-device settings */
    hspi->Init.CLKPolarity       = dev->clk_polarity;
    hspi->Init.CLKPhase          = dev->clk_phase;
    hspi->Init.BaudRatePrescaler = dev->prescaler;
    hspi->Init.DataSize          = dev->data_size;
    hspi->Init.FirstBit          = dev->first_bit;
    HAL_SPI_Init(hspi);

    /* Assert CS */
    HAL_GPIO_WritePin(dev->cs_port, dev->cs_pin, GPIO_PIN_RESET);
}

static void spi_device_deselect(SPI_HandleTypeDef *hspi,
                                 const spi_device_t *dev) {
    /* Wait for transfer to complete */
    while (hspi->Instance->SR & SPI_SR_BSY)
        ;
    /* Deassert CS */
    HAL_GPIO_WritePin(dev->cs_port, dev->cs_pin, GPIO_PIN_SET);
}
```

Usage becomes device-agnostic:

```c
/* Read flash device ID */
spi_device_select(&hspi1, &flash_dev);
HAL_SPI_Transmit(&hspi1, &read_id_cmd, 1, HAL_MAX_DELAY);
HAL_SPI_Receive(&hspi1, id_buf, 3, HAL_MAX_DELAY);
spi_device_deselect(&hspi1, &flash_dev);

/* Read ADC sample */
spi_device_select(&hspi1, &adc_dev);
HAL_SPI_Receive(&hspi1, adc_buf, 3, HAL_MAX_DELAY);
spi_device_deselect(&hspi1, &adc_dev);
```

## Mixed-Speed Devices

The prescaler reconfiguration in the select function handles mixed-speed devices transparently. A W25Q128 flash running at 21 MHz and an ADS1256 ADC limited to 2.6 MHz coexist on the same bus — the prescaler changes between transactions.

The overhead of `HAL_SPI_Init()` on each select call is approximately 2-5 microseconds on an STM32F4 at 168 MHz. For transactions that move hundreds or thousands of bytes, this overhead is negligible. For high-frequency short transactions (e.g., reading a single ADC sample at 1 kHz), the reconfiguration overhead becomes a larger fraction of the transaction time and may warrant a dedicated SPI peripheral.

## Mixed-Mode Devices

Devices requiring different SPI modes (e.g., flash at Mode 0 and an accelerometer at Mode 3) can share a bus, but with a constraint: the idle state of SCK changes between Mode 0 (idle low) and Mode 3 (idle high). When switching from a Mode 0 device to a Mode 3 device, the SCK line transitions from low to high during reconfiguration. This transition can be misinterpreted by a device that is monitoring SCK while its CS is deasserted.

In practice, most devices ignore SCK while CS is high, so mixed-mode buses work. However, a few devices — particularly some ADCs with continuous conversion modes — sample on every clock edge regardless of CS state. These devices must be on a separate SPI bus or have their own dedicated peripheral.

Mode 0 and Mode 3 share the same data sampling relationship (data sampled on the first clock transition relative to the data output), differing only in idle clock polarity. Mixing Mode 0 with Mode 1 on the same bus is more problematic because the sampling edge changes, and the clock transition during reconfiguration is more likely to cause confusion.

## Bus Contention and MISO Conflicts

When a device's CS is deasserted, it must tristate its MISO output — stop driving the line entirely. Most SPI devices do this correctly, but certain devices hold MISO in a defined state (high or low) even when deselected. A device that continues driving MISO while another device is trying to communicate produces bus contention: two outputs fighting over the same wire.

Symptoms of MISO contention include intermittent bit errors that depend on which device was last active, and logic analyzer traces showing MISO voltages at intermediate levels (e.g., 1.4V instead of 0V or 3.3V) during another device's transaction.

The fix for a device that does not tristate MISO is to add a tri-state buffer (e.g., 74LVC1G125) on its MISO line, controlled by the device's CS signal. This adds one component per misbehaving device but eliminates contention entirely.

## When to Use Separate SPI Peripherals

A shared bus is the default choice for cost and pin savings, but separate SPI peripherals are warranted in specific situations:

- **Continuous high-throughput devices**: A display being DMA-fed at 42 MHz blocks the bus for the entire frame transfer (e.g., 153,600 bytes for a 320x240 RGB565 display = ~29 ms). Other devices cannot communicate during this window. Placing the display on SPI1 and the flash + ADC on SPI2 eliminates this bottleneck.

- **Real-time sampling requirements**: An ADC that must be read at precise intervals cannot tolerate bus arbitration delays. A dedicated SPI peripheral guarantees access without contention.

- **Mixed voltage domains**: A 1.8V device and a 3.3V device on the same bus require level shifters on all four lines (MOSI, MISO, SCK, CS). Separate peripherals allow each bus to run at its native voltage.

- **Devices that do not tristate MISO**: Rather than adding external buffers, a separate SPI peripheral avoids the contention entirely.

STM32F407 provides three SPI peripherals (SPI1, SPI2, SPI3), and STM32H743 provides six (SPI1-SPI6). The RP2040 has two (SPI0, SPI1). ESP32 has four SPI controllers, but SPI0 and SPI1 are reserved for flash; SPI2 (HSPI) and SPI3 (VSPI) are available for general use.

## Daisy-Chain Topology

An alternative to the shared-bus topology is SPI daisy-chaining, where MISO of one device connects to MOSI of the next. Data shifts through all devices in series, with a single CS asserting all devices simultaneously. This topology is used primarily with shift registers (74HC595 chains) and LED drivers (WS2811 in SPI mode, APA102/SK9822).

In a daisy chain of N devices each with M-bit registers, a single transaction transmits N*M bits. The first device receives its data last (it shifts through all downstream devices first), so the data must be ordered accordingly — the last device in the chain gets the first byte transmitted.

```c
/* Daisy-chain: 4x 74HC595 shift registers (8 bits each = 32 bits total) */
void shift_chain_write(SPI_HandleTypeDef *hspi, uint8_t data[4]) {
    /* data[0] = last device in chain (receives first byte)
       data[3] = first device in chain (receives last byte) */
    chain_cs_assert();
    HAL_SPI_Transmit(hspi, data, 4, HAL_MAX_DELAY);
    while (hspi->Instance->SR & SPI_SR_BSY)
        ;
    chain_cs_deassert();
    /* CS rising edge latches data into output registers on 74HC595 */
}
```

Daisy-chaining saves CS pins (one CS for all devices) but imposes constraints: all devices must run at the same clock speed and SPI mode, latency increases linearly with chain length, and a single device failure breaks the entire chain.

## Tips

- Use the device context struct pattern from the start of a project, even with a single SPI device — adding a second device later requires minimal code changes when the abstraction is already in place.
- Group SPI transactions by device when possible to minimize reconfiguration overhead — reading 10 ADC samples in a burst is faster than interleaving ADC reads with flash accesses.
- Place the highest-bandwidth device on the fastest SPI peripheral (SPI1 on APB2 at 84 MHz on STM32F4) and lower-bandwidth devices on SPI2/SPI3 (APB1 at 42 MHz).
- For daisy-chain topologies, verify the chain by writing a known pattern and reading it back shifted by one device position — this confirms all connections and shift register operation without needing device-specific protocol knowledge.
- Add a mutex or flag to prevent concurrent SPI access from multiple interrupt levels or RTOS tasks — bus corruption from interrupted transactions is difficult to reproduce and diagnose.

## Caveats

- **Reconfiguring SPI mode while a device is mid-transaction corrupts the bus** — The SPI peripheral must be fully idle (BSY=0) and CS deasserted for all devices before changing CPOL, CPHA, or prescaler. An interrupt-driven transaction on one device that triggers a context switch to another device's transaction causes mode corruption.
- **Not all devices tristate MISO when CS is deasserted** — Some older or low-cost SPI devices hold MISO high or low regardless of CS, causing bus contention with other devices. The datasheet MISO specification should state "tri-state" or "high-impedance" when CS is inactive.
- **Long shared SPI buses accumulate capacitance that limits maximum clock speed** — Each device adds 5-15 pF of input capacitance to the bus. Four devices plus PCB trace capacitance can total 50-80 pF, reducing the maximum reliable clock speed well below the individual device limits. The maximum data rate scales inversely with total bus capacitance.
- **DMA transfers lock the bus for the entire transfer duration** — A 4 KB DMA transfer to flash at 10 MHz takes ~3.3 ms, during which no other device can be accessed. Time-critical devices must either share a separate peripheral or use interrupt-driven transfers that can be preempted.
- **The prescaler only divides by powers of 2 on STM32** — Matching the exact maximum clock of each device is usually impossible. A device rated for 15 MHz gets either 10.5 MHz (prescaler 8 from 84 MHz APB2) or 21 MHz (prescaler 4), which exceeds its limit. Always round down to the next available prescaler value.

## In Practice

- Intermittent data corruption that appears only when two specific devices are used in quick succession commonly traces to SPI mode reconfiguration — the CPOL change causes a spurious clock edge that the second device counts as a real clock cycle, shifting all subsequent data by one bit.
- A shared-bus SPI system that works perfectly on the bench but fails in production often has a bus capacitance problem — prototype boards with short traces and one device work at 21 MHz, but production boards with longer traces and four devices need the prescaler dropped to 10.5 MHz or lower.
- A multi-device SPI bus where Device A works perfectly alone but returns corrupt data whenever Device B is also present on the bus typically indicates MISO contention — Device B is not tristating its MISO output when its CS is high. A logic analyzer shows MISO at intermediate voltage levels during Device A's transactions.
- Flash writes that occasionally fail on a shared bus often trace to another device's transaction interrupting the flash's internal write cycle — the flash requires CS to remain deasserted for the entire write/erase duration (typically 1-100 ms), but if CS management code accidentally reasserts the wrong CS, the flash aborts its operation.
- An RTOS-based system where SPI devices work individually but produce garbled data under load commonly lacks bus mutex protection — two tasks accessing different devices on the same SPI peripheral interleave their CS assertions and bus configurations, producing hybrid transactions that neither device can interpret.
