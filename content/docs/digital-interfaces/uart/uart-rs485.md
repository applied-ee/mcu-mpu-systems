---
title: "RS-485 Half-Duplex & Driver Enable"
weight: 40
---

# RS-485 Half-Duplex & Driver Enable

RS-485 uses differential signaling on a twisted pair, allowing multi-drop communication over distances up to 1200 meters with up to 32 standard-load nodes on a single bus. Unlike RS-232, which is point-to-point, RS-485 is a shared bus where only one transmitter drives the line at a time. The firmware challenge is controlling the transceiver direction — switching between transmit and receive at precisely the right moment to avoid data corruption and bus contention. STM32 parts with hardware Driver Enable (DE) support automate this timing in silicon. Parts without it require careful GPIO management in firmware.

## Transceiver Basics

An RS-485 transceiver (MAX485, SP485E, ISL3178E, MAX13487E) sits between the MCU's UART TX/RX pins and the differential bus (A/B lines). The transceiver has two control pins:

- **DE** (Driver Enable) — active high; enables the transmitter. When DE is low, the transmitter output is high-impedance.
- **RE** (Receiver Enable) — active low; enables the receiver. When RE is high, the receiver output is high-impedance.

In half-duplex operation, DE and ~RE are typically tied together to a single GPIO or the USART DE output. When the pin is high, the transceiver transmits; when low, it receives. The critical timing requirement is that DE must be asserted before the first bit of a frame and deasserted after the last bit (including the stop bit) — but before the next node on the bus needs to respond.

## STM32 Hardware Driver Enable

STM32F7, H7, L4, G4, and newer families include a hardware DE output on the USART peripheral. Setting the DEM (Driver Enable Mode) bit in USART_CR3 causes the USART to automatically assert a designated GPIO pin before each transmission and deassert it after the last stop bit. The timing is controlled by two fields in USART_CR1:

- **DEAT[4:0]** (Driver Enable Assertion Time) — number of bit periods to assert DE before the start bit
- **DEDT[4:0]** (Driver Enable Deassertion Time) — number of bit periods to hold DE after the last stop bit

```c
/* STM32 HAL configuration for hardware DE on USART3 */
huart3.Instance = USART3;
huart3.Init.BaudRate = 115200;
huart3.Init.WordLength = UART_WORDLENGTH_8B;
huart3.Init.StopBits = UART_STOPBITS_1;
huart3.Init.Parity = UART_PARITY_NONE;
huart3.Init.Mode = UART_MODE_TX_RX;
huart3.Init.HwFlowCtl = UART_HWCONTROL_NONE;
huart3.Init.OverSampling = UART_OVERSAMPLING_16;

/* RS-485 DE configuration */
huart3.AdvancedInit.AdvFeatureInit = UART_ADVFEATURE_TXINVERT_INIT;

HAL_RS485Ex_Init(&huart3,
    UART_DE_POLARITY_HIGH,  /* DE active high (matches MAX485) */
    16,    /* DEAT: 16 sample times assertion before TX */
    16);   /* DEDT: 16 sample times hold after TX */
```

The DE pin is configured as an alternate function output — the USART peripheral drives it directly. No GPIO toggling in firmware is needed. The DEAT/DEDT values of 16 correspond to one bit period at 16x oversampling, which satisfies the timing requirements of most transceivers (MAX485 requires ~0.2 us, which is well under one bit period at 115200 baud = 8.68 us).

### Register-Level Hardware DE Setup

```c
/* Direct register configuration — STM32H7 USART3 */
/* Enable DEM (Driver Enable Mode) */
USART3->CR3 |= USART_CR3_DEM;

/* Set DE polarity: 0 = active high (default, matches MAX485) */
USART3->CR3 &= ~USART_CR3_DEP;

/* DEAT[4:0] = 8 sample times, DEDT[4:0] = 8 sample times */
USART3->CR1 &= ~(USART_CR1_DEAT_Msk | USART_CR1_DEDT_Msk);
USART3->CR1 |= (8 << USART_CR1_DEAT_Pos)
             |  (8 << USART_CR1_DEDT_Pos);

/* Configure DE pin as USART3 alternate function */
/* PB14 AF7 on STM32H743 — check datasheet for pin mapping */
GPIOB->MODER &= ~GPIO_MODER_MODE14_Msk;
GPIOB->MODER |= (2 << GPIO_MODER_MODE14_Pos);  /* AF mode */
GPIOB->AFR[1] &= ~GPIO_AFRH_AFSEL14_Msk;
GPIOB->AFR[1] |= (7 << GPIO_AFRH_AFSEL14_Pos); /* AF7 */
```

## Software DE Control

On MCUs without hardware DE support (STM32F4, ESP32, RP2040), firmware must toggle a GPIO manually. The critical requirement is asserting DE before `USART->DR` is written and deasserting it only after the last byte has fully shifted out — not just written to the transmit register.

```c
/* Software DE control — STM32F4 */
#define DE_PORT GPIOB
#define DE_PIN  GPIO_PIN_14

void rs485_transmit(uint8_t *data, uint32_t len) {
    /* Assert DE — enable transmitter */
    HAL_GPIO_WritePin(DE_PORT, DE_PIN, GPIO_PIN_SET);

    /* Small delay for transceiver enable time (~100 ns for MAX485) */
    __NOP(); __NOP(); __NOP(); __NOP();

    /* Transmit data */
    HAL_UART_Transmit(&huart2, data, len, HAL_MAX_DELAY);

    /* Wait for transmission to fully complete (shift register empty) */
    while (!(USART2->SR & USART_SR_TC));

    /* Deassert DE — release bus, enable receiver */
    HAL_GPIO_WritePin(DE_PORT, DE_PIN, GPIO_PIN_RESET);
}
```

The crucial detail is waiting for the TC (Transmission Complete) flag, not just TXE (Transmit Empty). TXE indicates the transmit data register is empty, meaning it can accept another byte — but the shift register may still be clocking out the current byte. Deasserting DE on TXE instead of TC cuts off the last byte mid-transmission.

### ESP-IDF Software DE

ESP-IDF provides built-in RS-485 half-duplex support:

```c
uart_config_t uart_config = {
    .baud_rate = 115200,
    .data_bits = UART_DATA_8_BITS,
    .parity    = UART_PARITY_DISABLE,
    .stop_bits = UART_STOP_BITS_1,
    .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    .source_clk = UART_SCLK_DEFAULT,
};
uart_param_config(UART_NUM_1, &uart_config);
uart_set_pin(UART_NUM_1, TX_PIN, RX_PIN, DE_PIN, UART_PIN_NO_CHANGE);

/* Enable RS-485 half-duplex mode — ESP-IDF handles DE toggling */
uart_set_mode(UART_NUM_1, UART_MODE_RS485_HALF_DUPLEX);
```

The ESP-IDF driver manages DE assertion/deassertion timing internally using the UART peripheral's built-in RS-485 mode, similar to the STM32 hardware DE approach.

## Multi-Drop Addressing

On a shared RS-485 bus with multiple nodes, each node needs an address. Two common approaches exist in firmware:

### 9-Bit Mode (Address Mark Detection)

STM32 USART supports 9-bit data mode where the 9th bit distinguishes address bytes (bit 9 = 1) from data bytes (bit 9 = 0). Each node configures its address in USART_CR2 (ADD field) and enables the mute mode receiver (RWU bit). The USART hardware ignores all incoming data until an address byte matching its configured address arrives, then wakes up and receives subsequent data bytes until the next address byte.

```c
/* Configure multi-processor mode with 7-bit address matching */
USART3->CR2 &= ~USART_CR2_ADD_Msk;
USART3->CR2 |= (0x05 << USART_CR2_ADD_Pos);  /* Node address = 5 */
USART3->CR2 |= USART_CR2_ADDM7;               /* 7-bit address match */

/* Enable mute mode — USART ignores data until address match */
USART3->CR1 |= USART_CR1_MME;  /* Mute mode enable */
USART3->CR1 |= USART_CR1_WAKE; /* Wake on address mark */
```

### Software Address Matching

A simpler approach uses standard 8N1 framing with a protocol-level address byte. The first byte of every message contains the destination node address. Every node receives all bytes but only processes messages addressed to it. This wastes CPU on non-addressed nodes but works with any UART hardware and any baud rate.

## Bus Termination and Biasing

Firmware does not control the termination resistor directly — it is a physical 120-ohm resistor between A and B at each end of the bus. However, some designs use GPIO-controlled termination: a MOSFET or analog switch connects the termination resistor when enabled. This allows firmware to enable termination on end-of-line nodes and disable it on middle nodes, or to reconfigure dynamically in systems where the bus topology changes.

Bias resistors (typically 470-680 ohm pull-up on A, pull-down on B) define the idle bus state. Without biasing, an idle bus floats and the receiver sees noise as valid data. Firmware cannot compensate for missing bias — the receiver generates framing errors or random bytes whenever no node is transmitting.

```c
/* GPIO-controlled termination — enable on end-of-line nodes */
#define TERM_EN_PORT  GPIOC
#define TERM_EN_PIN   GPIO_PIN_8

void rs485_set_termination(bool enable) {
    HAL_GPIO_WritePin(TERM_EN_PORT, TERM_EN_PIN,
                      enable ? GPIO_PIN_SET : GPIO_PIN_RESET);
}
```

## Turn-Around Time

After a node finishes transmitting and deasserts DE, a minimum time must elapse before another node can begin transmitting. This turn-around time accounts for:

- Transceiver DE-to-output-disable propagation delay (~100-500 ns for MAX485)
- Line settling time (depends on cable length and capacitance)
- Receiver enable propagation delay on the new transmitter (~100-500 ns)

At 115200 baud, one bit period is 8.68 us. A typical turn-around time of 3-5 bit periods (26-43 us) is sufficient for most transceivers and cable lengths under 100 meters. In firmware, this manifests as a required delay between receiving the last byte of a request and beginning to transmit a response:

```c
/* Modbus-style turn-around: minimum 3.5 character times */
uint32_t turnaround_us = (35 * 1000000) / (huart->Init.BaudRate);
delay_us(turnaround_us);
```

Modbus RTU defines this precisely: 3.5 character times of silence delimit frames. At 9600 baud, 3.5 characters = 3.646 ms. At 115200 baud, it shrinks to 304 us.

## Tips

- Use hardware DE on STM32F7/H7/L4/G4 whenever possible — it eliminates an entire class of timing bugs and removes the need for TC polling in the transmit path
- Set DEAT/DEDT to at least one bit period (16 sample times at 16x oversampling) — this exceeds the enable/disable propagation time of all common transceivers and costs almost nothing in throughput
- For software DE control, always wait for the TC flag, never TXE — deasserting DE on TXE corrupts the last transmitted byte every time
- Place a Modbus-standard 3.5-character silence between receiving the last request byte and transmitting a response — this gives all nodes time to switch from transmit to receive mode
- Use the ESP-IDF `UART_MODE_RS485_HALF_DUPLEX` mode rather than manual GPIO toggling — the driver handles timing edge cases that are easy to miss in application code

## Caveats

- **Deasserting DE on TXE instead of TC corrupts the last byte** — TXE means the data register is empty and can accept a new byte, but the shift register is still clocking out the current byte. Releasing the bus at TXE cuts off the final stop bit (or even data bits), producing a framing error at the receiver. This is the single most common RS-485 firmware bug
- **Missing bus bias resistors cause garbage reception when idle** — Without pull-up on A and pull-down on B, the differential voltage during idle is undefined. The receiver interprets bus noise as start bits and generates a stream of framing errors or random byte values. Firmware cannot distinguish this from a malfunctioning transmitter
- **Two nodes transmitting simultaneously destroys data and may damage transceivers** — RS-485 has no collision detection (unlike CAN). If the protocol layer fails to prevent simultaneous transmission, both messages are corrupted, and excessive current flows through the competing drivers. Repeated bus contention can thermally damage transceiver output stages
- **9-bit mode is incompatible with standard 8N1 tools** — Terminal emulators, USB-UART adapters, and most test equipment expect 8-bit data. Multi-processor address mark mode using the 9th bit cannot be debugged with standard serial tools, making development significantly harder
- **Cable length and baud rate are inversely related** — The commonly cited 1200-meter limit applies at 100 kbaud. At 1 Mbaud, maximum cable length drops to approximately 50-100 meters depending on cable quality. Exceeding this produces intermittent bit errors that worsen with temperature as cable impedance shifts

## In Practice

- A node that transmits correctly but never receives responses on an RS-485 bus usually has DE stuck high — the transceiver remains in transmit mode and drives the bus, preventing the responding node's data from reaching the receiver. Checking the DE pin with an oscilloscope after transmission should show it returning low within one bit period of the last stop bit.

- Random byte values appearing on a bus with no active transmitters — especially values like 0x00 or 0xFF — indicate missing or incorrect bus biasing. The receiver input floats near the switching threshold and interprets noise as valid frames. Adding 470-ohm bias resistors (A to VCC, B to GND) defines the idle state and eliminates the phantom traffic.

- A Modbus RTU slave that responds correctly to some masters but produces CRC errors with others often has a turn-around time problem. The slave begins transmitting before the master has fully released the bus, causing the first byte of the response to collide with the master's trailing stop bit. Increasing the response delay to 3.5 character times resolves the CRC errors.

- Intermittent communication failures that correlate with cable routing near motors, relays, or power converters point to insufficient differential noise margin. RS-485 tolerates +/- 7V of common-mode voltage, but radiated EMI can exceed this on long runs adjacent to power cables. Rerouting the RS-485 cable or switching to a transceiver with higher common-mode rejection (e.g., ISO3082 with 2500V isolation) eliminates the intermittent errors.

- A multi-drop bus where one specific node causes all other nodes to lose communication — even when that node is idle — typically has a damaged transceiver with a stuck driver output. Disconnecting the suspect node from the bus and verifying that communication resumes between the remaining nodes confirms the diagnosis.
