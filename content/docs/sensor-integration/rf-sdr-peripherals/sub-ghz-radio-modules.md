---
title: "Sub-GHz Radio Modules (LoRa, FSK)"
weight: 10
---

# Sub-GHz Radio Modules (LoRa, FSK)

Sub-GHz radios occupy the frequency bands below 1 GHz — typically 433 MHz, 868 MHz (EU), and 915 MHz (US/AU) — where RF propagation favors long range over high data rate. The dominant IC family in this space is Semtech's SX127x (SX1276, SX1278) and the newer SX1262, found on popular breakout modules like the HopeRF RFM95W and RFM96W. These devices communicate with a host MCU over SPI and support two distinct modulation schemes: LoRa (a proprietary CSS — chirp spread spectrum — modulation) and traditional FSK/OOK packet engines. The firmware integration pattern is similar across the family: configure registers over SPI, load a FIFO buffer, trigger transmission, and wait for a DIO interrupt to signal completion.

## SX1276/SX1278 Architecture

The SX1276 and SX1278 are functionally identical except for supported frequency ranges — the SX1276 covers 137-1020 MHz while the SX1278 is limited to 137-525 MHz. Both contain a LoRa modem, an FSK/OOK modem, a 256-byte FIFO, and a flexible interrupt system mapped to four DIO pins.

### Operating Modes

The radio transitions through a defined state sequence. Attempting to modify modulation parameters while the radio is in TX or RX mode produces undefined behavior.

| Mode | RegOpMode Value | Purpose |
|---|---|---|
| Sleep | 0x00 | Lowest power, ~0.2 uA, oscillator off |
| Standby | 0x01 | Registers accessible, oscillator running, ~1.5 mA |
| FSTX | 0x02 | Frequency synthesis for TX |
| TX | 0x03 | Transmitting, auto-returns to Standby on completion |
| FSRX | 0x04 | Frequency synthesis for RX |
| RX Continuous | 0x05 | Continuous receive, stays in RX |
| RX Single | 0x06 | Receives one packet, then returns to Standby |
| CAD | 0x07 | Channel Activity Detection — listens for LoRa preamble |

The correct startup sequence is: Sleep (to switch modem mode between FSK and LoRa) -> Standby -> configure all parameters -> TX or RX.

### SPI Interface and Register Access

The SX1276 uses a simple SPI protocol: the first byte is the address (bit 7 = 1 for write, 0 for read), followed by data bytes. Clock polarity is CPOL=0, CPHA=0 (SPI mode 0), and the maximum SPI clock is 10 MHz.

```c
#include "stm32f4xx_hal.h"

#define SX1276_NSS_PIN    GPIO_PIN_4
#define SX1276_NSS_PORT   GPIOA
#define SX1276_RESET_PIN  GPIO_PIN_0
#define SX1276_RESET_PORT GPIOB

static SPI_HandleTypeDef hspi1;

static void sx1276_write_reg(uint8_t addr, uint8_t value) {
    uint8_t buf[2] = { addr | 0x80, value };
    HAL_GPIO_WritePin(SX1276_NSS_PORT, SX1276_NSS_PIN, GPIO_PIN_RESET);
    HAL_SPI_Transmit(&hspi1, buf, 2, 100);
    HAL_GPIO_WritePin(SX1276_NSS_PORT, SX1276_NSS_PIN, GPIO_PIN_SET);
}

static uint8_t sx1276_read_reg(uint8_t addr) {
    uint8_t tx[2] = { addr & 0x7F, 0x00 };
    uint8_t rx[2];
    HAL_GPIO_WritePin(SX1276_NSS_PORT, SX1276_NSS_PIN, GPIO_PIN_RESET);
    HAL_SPI_TransmitReceive(&hspi1, tx, rx, 2, 100);
    HAL_GPIO_WritePin(SX1276_NSS_PORT, SX1276_NSS_PIN, GPIO_PIN_SET);
    return rx[1];
}

static void sx1276_reset(void) {
    HAL_GPIO_WritePin(SX1276_RESET_PORT, SX1276_RESET_PIN, GPIO_PIN_RESET);
    HAL_Delay(1);
    HAL_GPIO_WritePin(SX1276_RESET_PORT, SX1276_RESET_PIN, GPIO_PIN_SET);
    HAL_Delay(6);  /* Datasheet specifies 5 ms after reset release */
}
```

### RFM95W / RFM96W Module Pinout

The HopeRF RFM95W (915 MHz) and RFM96W (433 MHz) are breakout modules built around the SX1276 and SX1278 respectively. The pinout for SPI integration:

| Module Pin | Function | MCU Connection |
|---|---|---|
| SCK | SPI clock | SPI_SCK |
| MISO | SPI data out | SPI_MISO |
| MOSI | SPI data in | SPI_MOSI |
| NSS | Chip select (active low) | GPIO output |
| RESET | Hardware reset (active low) | GPIO output |
| DIO0 | Configurable interrupt | GPIO input (EXTI) |
| DIO1 | Configurable interrupt | GPIO input (EXTI) |
| DIO2 | Configurable interrupt (or FSK data) | GPIO input |
| ANT | RF antenna pad | 50-ohm antenna or SMA connector |
| GND | Ground | Common ground |
| VCC | Supply, 1.8-3.7V | 3.3V rail |

A 100 nF decoupling capacitor directly at the VCC pin is mandatory. The antenna connection must be a controlled-impedance 50-ohm trace — a random wire works for bench testing but degrades range substantially.

## LoRa Modulation Parameters

LoRa modulation uses three configurable parameters that trade range, data rate, and airtime against each other:

- **Spreading Factor (SF7-SF12)** — Higher SF increases range and sensitivity but reduces data rate exponentially. Each step up in SF roughly doubles airtime.
- **Bandwidth (125, 250, or 500 kHz)** — Lower bandwidth improves sensitivity (~3 dB per halving) but increases airtime.
- **Coding Rate (4/5, 4/6, 4/7, 4/8)** — Adds forward error correction overhead. CR 4/5 adds 25% overhead; CR 4/8 doubles the payload.

### Spreading Factor vs Performance

| SF | Bit Rate (125 kHz BW) | Sensitivity (SX1276) | Airtime (10 bytes) | Approximate Range (LoS) |
|---|---|---|---|---|
| SF7 | 5,470 bps | -123 dBm | ~36 ms | 2-3 km |
| SF8 | 3,125 bps | -126 dBm | ~62 ms | 3-5 km |
| SF9 | 1,758 bps | -129 dBm | ~113 ms | 4-6 km |
| SF10 | 977 bps | -132 dBm | ~206 ms | 5-8 km |
| SF11 | 537 bps | -134.5 dBm | ~371 ms | 7-10 km |
| SF12 | 293 bps | -137 dBm | ~682 ms | 10-15 km |

These range figures assume clear line-of-sight, a quarter-wave antenna on both ends, +20 dBm TX power, and flat terrain. Urban environments with buildings and foliage reduce effective range by 50-80%.

### Link Budget Calculation

The link budget determines whether a given transmitter-receiver pair can close a link at a given distance. For the SX1276:

```
Link budget = TX power (dBm) + TX antenna gain (dBi) + RX antenna gain (dBi)
              - path loss (dB) - cable/connector losses (dB)
              >= RX sensitivity (dBm) + required margin (dB)
```

With +20 dBm TX, 0 dBi antennas on both ends, and SF12/125 kHz (-137 dBm sensitivity):

```
Link budget = 20 + 0 + 0 - (-137) = 157 dB available
```

Free-space path loss at 915 MHz over 10 km: approximately 111 dB. This leaves 46 dB of margin — enough to tolerate significant obstruction loss. At SF7 (-123 dBm), the available margin drops to 32 dB at 10 km, which is marginal in non-line-of-sight conditions.

## LoRa TX Configuration and Transmission

The following sequence configures the SX1276 for LoRa transmission and sends a packet:

```c
/* LoRa register addresses */
#define REG_FIFO            0x00
#define REG_OP_MODE         0x01
#define REG_FR_MSB          0x06
#define REG_FR_MID          0x07
#define REG_FR_LSB          0x08
#define REG_PA_CONFIG       0x09
#define REG_FIFO_ADDR_PTR   0x0D
#define REG_FIFO_TX_BASE    0x0E
#define REG_IRQ_FLAGS       0x12
#define REG_MODEM_CONFIG_1  0x1D
#define REG_MODEM_CONFIG_2  0x1E
#define REG_PREAMBLE_MSB    0x20
#define REG_PREAMBLE_LSB    0x21
#define REG_PAYLOAD_LENGTH  0x22
#define REG_MODEM_CONFIG_3  0x26
#define REG_DIO_MAPPING_1   0x40

/* IRQ flag bits */
#define IRQ_TX_DONE         0x08

void sx1276_init_lora(void) {
    sx1276_reset();

    /* Enter sleep mode to switch to LoRa modem */
    sx1276_write_reg(REG_OP_MODE, 0x80);  /* Sleep + LoRa mode */
    HAL_Delay(10);

    /* Enter standby for configuration */
    sx1276_write_reg(REG_OP_MODE, 0x81);  /* Standby + LoRa mode */

    /* Set frequency: 915 MHz */
    /* Freq = (Frf * 32 MHz) / 2^19 -> Frf = 915 * 2^19 / 32 = 14991360 */
    sx1276_write_reg(REG_FR_MSB, 0xE4);   /* 14991360 >> 16 */
    sx1276_write_reg(REG_FR_MID, 0xC0);   /* (14991360 >> 8) & 0xFF */
    sx1276_write_reg(REG_FR_LSB, 0x00);   /* 14991360 & 0xFF */

    /* PA config: PA_BOOST pin, max power +20 dBm */
    sx1276_write_reg(REG_PA_CONFIG, 0xFF);

    /* Modem config 1: BW=125kHz, CR=4/5, implicit header off */
    sx1276_write_reg(REG_MODEM_CONFIG_1, 0x72);

    /* Modem config 2: SF=10, CRC on */
    sx1276_write_reg(REG_MODEM_CONFIG_2, 0xA4);

    /* Modem config 3: AGC auto on */
    sx1276_write_reg(REG_MODEM_CONFIG_3, 0x04);

    /* Preamble length: 8 symbols */
    sx1276_write_reg(REG_PREAMBLE_MSB, 0x00);
    sx1276_write_reg(REG_PREAMBLE_LSB, 0x08);

    /* Map DIO0 to TxDone */
    sx1276_write_reg(REG_DIO_MAPPING_1, 0x40);
}

int sx1276_transmit(const uint8_t *data, uint8_t len) {
    /* Set FIFO TX base address and pointer */
    sx1276_write_reg(REG_FIFO_TX_BASE, 0x00);
    sx1276_write_reg(REG_FIFO_ADDR_PTR, 0x00);

    /* Write payload to FIFO */
    for (uint8_t i = 0; i < len; i++) {
        sx1276_write_reg(REG_FIFO, data[i]);
    }
    sx1276_write_reg(REG_PAYLOAD_LENGTH, len);

    /* Clear IRQ flags */
    sx1276_write_reg(REG_IRQ_FLAGS, 0xFF);

    /* Enter TX mode */
    sx1276_write_reg(REG_OP_MODE, 0x83);  /* TX + LoRa mode */

    /* Wait for TxDone — poll IRQ flags (or use DIO0 EXTI) */
    uint32_t start = HAL_GetTick();
    while (!(sx1276_read_reg(REG_IRQ_FLAGS) & IRQ_TX_DONE)) {
        if (HAL_GetTick() - start > 5000) {
            return -1;  /* TX timeout */
        }
    }

    /* Clear TxDone flag */
    sx1276_write_reg(REG_IRQ_FLAGS, IRQ_TX_DONE);
    return 0;
}
```

In production firmware, the TxDone polling loop should be replaced with a DIO0 interrupt handler. The EXTI callback sets a flag or posts to an RTOS queue, and the transmit function blocks on that signal instead of busy-waiting.

## RSSI and SNR Reading

After receiving a packet in LoRa mode, the RSSI and SNR values indicate link quality:

```c
#define REG_PKT_SNR     0x19
#define REG_PKT_RSSI    0x1A

int16_t sx1276_get_packet_rssi(void) {
    /* For HF port (above 862 MHz): RSSI = -157 + RegPktRssi */
    int16_t raw = sx1276_read_reg(REG_PKT_RSSI);
    return -157 + raw;
}

int8_t sx1276_get_packet_snr(void) {
    /* SNR in 0.25 dB steps, signed */
    int8_t raw = (int8_t)sx1276_read_reg(REG_PKT_SNR);
    return raw / 4;
}
```

RSSI values below -120 dBm indicate a link operating near the noise floor — functional but with minimal margin for fading or interference. SNR below 0 dB means the signal is below the noise, which LoRa can still decode (down to about -20 dB SNR at SF12), but packet loss will increase.

## FSK Packet Engine

The SX1276 also contains a conventional FSK modem, useful when LoRa's processing gain is unnecessary and higher data rates (up to 300 kbps) are preferred. The FSK engine supports:

- Configurable deviation (600 Hz to 200 kHz)
- Preamble detection (1-3 bytes)
- Sync word matching (up to 8 bytes)
- CRC-16 computation
- Address filtering
- Manchester or whitening encoding

Switching to FSK mode requires setting bit 7 of RegOpMode to 0 while in Sleep mode. The FIFO is shared between LoRa and FSK — clearing it when switching modes avoids stale data.

## SX1262 — Next Generation

The SX1262 improves on the SX1276 in several ways:

| Parameter | SX1276 | SX1262 |
|---|---|---|
| TX power (max) | +20 dBm | +22 dBm |
| RX current | 10.3 mA (LoRa) | 4.6 mA (LoRa) |
| Sleep current | 0.2 uA | 0.16 uA |
| TCXO support | External | Integrated DIO3 control |
| DC-DC converter | External | Internal option |
| SPI interface | Register-based | Command-based (opcode + params) |
| FIFO size | 256 bytes | 256 bytes |

The SX1262's command-based SPI interface is more complex than the SX1276's register model — each operation requires sending an opcode followed by parameter bytes, then reading a status byte. Driver libraries (e.g., Semtech's reference implementation) abstract this, but bare-metal integration requires careful attention to the busy pin (BUSY must go low before each SPI transaction).

## DIO Interrupt Mapping

The SX1276 has six DIO pins (DIO0-DIO5), each configurable to signal different events depending on the modem mode. The most commonly used mappings:

| DIO Pin | LoRa Mode Mapping | Typical Use |
|---|---|---|
| DIO0 | RxDone / TxDone / CadDone | Primary interrupt for packet events |
| DIO1 | RxTimeout / FhssChangeChannel | Timeout detection |
| DIO2 | FhssChangeChannel | Frequency hopping |
| DIO3 | CadDetected / ValidHeader | Channel activity result |
| DIO4 | PllLock | Diagnostic |
| DIO5 | ClkOut | Diagnostic |

For minimal wiring, connecting only DIO0 to an MCU EXTI pin covers most use cases. DIO1 adds RX timeout detection, which is important for energy-constrained applications that cannot leave the radio in RX mode indefinitely.

## Tips

- Always verify SPI communication after reset by reading the RegVersion register (address 0x42) — the SX1276 returns 0x12, and the SX1278 returns 0x12 as well; a return of 0x00 or 0xFF indicates wiring or SPI configuration errors
- Start development at SF7 with maximum bandwidth (500 kHz) for the fastest iteration cycle, then reduce bandwidth and increase SF only when range testing demands it
- The SX1276 PA_BOOST pin supports +2 to +20 dBm output but requires the high-power PA setting (RegPaDac = 0x87) for outputs above +17 dBm — without this register write, TX power silently clips at +17 dBm
- Implement a TX timeout watchdog — if the radio fails to assert TxDone within a reasonable window (2x the calculated airtime), reset the radio and reinitialize rather than waiting indefinitely
- Use explicit header mode during development (it includes payload length and CRC enable in the header), switching to implicit header only after the packet format is finalized and both ends agree on length
- For battery-powered nodes, use RX Single mode with a timeout rather than RX Continuous — the radio returns to Standby automatically, preventing current drain if no packet arrives

## Caveats

- **LoRa spreading factors are not interoperable** — A receiver configured for SF10 cannot decode a packet sent at SF9 or SF11; both ends must agree exactly on SF, bandwidth, and coding rate, or the packet is invisible to the receiver
- **The 256-byte FIFO limits maximum packet size** — LoRa packets can be up to 255 bytes payload, but with header and CRC overhead, the practical limit is 222 bytes in explicit header mode; exceeding this silently truncates the payload
- **Duty cycle regulations apply in most sub-GHz bands** — In the EU 868 MHz band, the default duty cycle limit is 1% (36 seconds of TX per hour per sub-band); violating this is both illegal and detectable, and LoRaWAN enforces it at the protocol level
- **Antenna mismatch can reduce effective range by 80%+** — A 915 MHz quarter-wave antenna is 82 mm; cutting it to 70 mm or using a random wire introduces VSWR losses that silently degrade the link budget by 6-10 dB
- **Crystal frequency error causes packet loss at low bandwidths** — At 125 kHz bandwidth with SF12, the total frequency error between TX and RX must be below approximately 3.5 kHz; cheap modules without a TCXO can drift 5-10 kHz over temperature, making SF12/125 unreliable outdoors

## In Practice

- **A module that returns 0x00 or 0xFF from every register read** typically indicates an SPI wiring issue — MISO/MOSI swapped, NSS not toggling, or the module unpowered; reading RegVersion (0x42) as the first sanity check quickly distinguishes SPI problems from configuration errors
- **LoRa packets that decode correctly at 2 meters but fail at 50 meters** often point to an antenna problem rather than a modulation configuration issue — measuring RSSI at close range (it should be around -30 to -50 dBm at 1 meter with +20 dBm TX) reveals whether the antenna is radiating effectively
- **Received packets with valid CRC but garbled payload** at long range usually indicate frequency offset between the transmitter and receiver crystals — the LoRa demodulator can track small offsets, but beyond the bandwidth tolerance, bit errors appear even though the packet structure is detected
- **TX power measurements that read 3-5 dB below the configured value** commonly result from the PA_BOOST high-power mode not being enabled (RegPaDac not set to 0x87) or from the PA being driven into compression with inadequate supply voltage — the SX1276 needs at least 3.0V on VCC to deliver +20 dBm reliably
- **A battery-powered node that lasts days instead of months** often traces to the radio being left in RX Continuous mode (10+ mA draw) instead of duty-cycling between Sleep and RX Single with a defined listen window
