---
title: "CAN Bit Timing & Baud Rate"
weight: 10
---

# CAN Bit Timing & Baud Rate

CAN bit timing determines whether nodes on a bus can communicate at all. Unlike UART, where baud rate mismatches produce garbled data, a CAN baud rate mismatch prevents any communication entirely -- the receiving node never sees a valid frame, and the transmitting node receives no ACK. Every node on a CAN bus must agree on the bit rate to within approximately 0.5%, and achieving that precision requires understanding how the CAN peripheral synthesizes its bit clock from the MCU's peripheral clock.

## The CAN Bit Structure

Each CAN bit is divided into four segments, measured in units called **time quanta (TQ)**:

| Segment | Purpose | Typical Length |
|---------|---------|----------------|
| SYNC_SEG | Synchronization edge expected here | Always 1 TQ |
| PROP_SEG | Compensates for physical bus delay | 1-8 TQ |
| PHASE_SEG1 (BS1) | Before the sample point | 1-16 TQ |
| PHASE_SEG2 (BS2) | After the sample point | 1-8 TQ |

The **sample point** sits at the boundary between PHASE_SEG1 and PHASE_SEG2 -- this is where the CAN controller reads the bus level and decides whether the current bit is dominant (0) or recessive (1).

The total number of TQ per bit is:

```
TQ_per_bit = SYNC_SEG + PROP_SEG + PHASE_SEG1 + PHASE_SEG2
           = 1 + PROP_SEG + BS1 + BS2
```

On STM32 bxCAN, the `PROP_SEG` and `PHASE_SEG1` fields are combined into a single `BS1` field (also called `TimeSeg1` in HAL), so the effective formula becomes:

```
TQ_per_bit = 1 + BS1 + BS2
```

where BS1 ranges from 1 to 16 TQ and BS2 ranges from 1 to 8 TQ.

## Time Quantum and Prescaler Calculation

The time quantum is derived from the CAN peripheral's input clock (APB1 on STM32F4) through a prescaler:

```
TQ = Prescaler / APB1_Clock
Baud_Rate = APB1_Clock / (Prescaler * TQ_per_bit)
```

Rearranging to find the prescaler for a desired baud rate:

```
Prescaler = APB1_Clock / (Baud_Rate * TQ_per_bit)
```

### Concrete Example: 42 MHz APB1 to 500 kbps

Target: 500 kbps with a sample point near 87.5%.

Start by choosing a total TQ count. 14 TQ per bit gives good resolution:

```
Prescaler = 42,000,000 / (500,000 * 14) = 6
```

Prescaler = 6 divides evenly. Now distribute the 14 TQ across the segments:

- SYNC_SEG = 1 TQ (fixed)
- BS1 = 11 TQ (includes propagation compensation)
- BS2 = 2 TQ

Sample point position:

```
Sample_Point = (1 + BS1) / TQ_per_bit = 12/14 = 85.7%
```

This falls within the recommended 75-87.5% range. The STM32 HAL configuration:

```c
CAN_HandleTypeDef hcan;

hcan.Instance = CAN1;
hcan.Init.Prescaler = 6;
hcan.Init.Mode = CAN_MODE_NORMAL;
hcan.Init.SyncJumpWidth = CAN_SJW_1TQ;
hcan.Init.TimeSeg1 = CAN_BS1_11TQ;
hcan.Init.TimeSeg2 = CAN_BS2_2TQ;
hcan.Init.TimeTriggeredMode = DISABLE;
hcan.Init.AutoBusOff = ENABLE;
hcan.Init.AutoWakeUp = DISABLE;
hcan.Init.AutoRetransmission = ENABLE;
hcan.Init.ReceiveFifoLocked = DISABLE;
hcan.Init.TransmitFifoPriority = DISABLE;

if (HAL_CAN_Init(&hcan) != HAL_OK) {
    Error_Handler();
}
```

## Standard Baud Rate Configurations

The following table shows common baud rate settings for a 42 MHz APB1 clock (STM32F407/F446 at 168 MHz SYSCLK with APB1 prescaler = 4):

| Baud Rate | Prescaler | BS1 | BS2 | TQ/Bit | Sample Point |
|-----------|-----------|-----|-----|--------|--------------|
| 125 kbps  | 24        | 11  | 2   | 14     | 85.7%        |
| 250 kbps  | 12        | 11  | 2   | 14     | 85.7%        |
| 500 kbps  | 6         | 11  | 2   | 14     | 85.7%        |
| 1 Mbps    | 3         | 11  | 2   | 14     | 85.7%        |

For a 45 MHz APB1 clock (STM32F446 at 180 MHz SYSCLK):

| Baud Rate | Prescaler | BS1 | BS2 | TQ/Bit | Sample Point |
|-----------|-----------|-----|-----|--------|--------------|
| 125 kbps  | 20        | 15  | 2   | 18     | 88.9%        |
| 250 kbps  | 10        | 15  | 2   | 18     | 88.9%        |
| 500 kbps  | 5         | 15  | 2   | 18     | 88.9%        |
| 1 Mbps    | 5         | 7   | 1   | 9      | 88.9%        |

The prescaler must divide evenly into the APB1 clock for the target baud rate. If no integer prescaler exists for a given TQ count, adjust TQ_per_bit until an integer solution appears.

## Sample Point Placement

The CAN specification recommends a sample point between 75% and 87.5% of the bit time. Automotive applications (CANopen, J1939) commonly target 87.5%. The CIA (CAN in Automation) recommendation for bus lengths under 40 meters is 87.5%, while longer buses benefit from a sample point closer to 75% to accommodate propagation delay.

A later sample point allows more time for the signal to propagate and settle, but reduces the tolerance for clock frequency differences between nodes. The standard 87.5% value works for most bench and vehicle-scale applications.

## Synchronization Jump Width (SJW)

The SJW parameter controls how much the CAN controller can adjust its bit timing on each resynchronization. When a node detects an edge (dominant-to-recessive or recessive-to-dominant transition) that arrives earlier or later than expected, the controller lengthens or shortens its current bit by up to SJW time quanta to realign.

```c
hcan.Init.SyncJumpWidth = CAN_SJW_1TQ;  /* Most common setting */
```

SJW ranges from 1 to 4 TQ on STM32 bxCAN. A larger SJW accommodates greater oscillator tolerance between nodes:

| SJW | Oscillator Tolerance (approx.) |
|-----|-------------------------------|
| 1 TQ | 0.5% (crystal oscillator) |
| 2 TQ | 1.0% |
| 4 TQ | 2.0% (ceramic resonator) |

For nodes using crystal oscillators (typical 20-50 ppm tolerance), SJW = 1 TQ is sufficient. For nodes with ceramic resonators or internal RC oscillators, SJW = 2 or higher is necessary. The ESP32's internal oscillator has sufficient accuracy for CAN at SJW = 1 when using the TWAI (Two-Wire Automotive Interface) driver, but only because the ESP32 derives the CAN clock from its PLL-locked APB clock, not the raw RC oscillator.

## ESP32 TWAI Bit Timing

The ESP32 CAN-compatible peripheral is called TWAI. Its bit timing configuration uses the same conceptual model but with different API structures:

```c
#include "driver/twai.h"

twai_timing_config_t t_config = TWAI_TIMING_CONFIG_500KBITS();

twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    GPIO_NUM_21,  /* TX */
    GPIO_NUM_22,  /* RX */
    TWAI_MODE_NORMAL
);

twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

ESP_ERROR_CHECK(twai_driver_install(&g_config, &t_config, &f_config));
ESP_ERROR_CHECK(twai_start());
```

ESP-IDF provides predefined timing macros (`TWAI_TIMING_CONFIG_125KBITS()`, `TWAI_TIMING_CONFIG_250KBITS()`, etc.) that encode correct prescaler, BS1, and BS2 values for the ESP32's 80 MHz APB clock. Custom bit timing requires populating the `twai_timing_config_t` structure manually, using the same TQ calculation approach as STM32.

## Verifying Bit Timing on Hardware

A logic analyzer or oscilloscope on the CAN TX pin (before the transceiver) provides a direct measurement of the bit timing. One bit at 500 kbps should measure exactly 2.0 us. At 1 Mbps, each bit is 1.0 us. Measuring the actual bit width confirms the prescaler and segment configuration are correct -- and catches errors from wrong APB1 clock assumptions.

## Tips

- Always verify the actual APB1 clock frequency in `SystemCoreClock` debug output or `HAL_RCC_GetPCLK1Freq()` before calculating CAN bit timing -- the prescaler math assumes a specific input clock, and CubeMX occasionally changes the clock tree during project regeneration.
- Keep TQ_per_bit between 8 and 25 for good segment resolution -- fewer than 8 TQ leaves too little room for SJW adjustment, while more than 25 TQ requires a smaller prescaler that may not exist.
- Use the predefined timing macros on ESP32 (`TWAI_TIMING_CONFIG_500KBITS()`) rather than computing values manually -- these are validated against the ESP32's fixed 80 MHz APB clock.
- Start with SJW = 1 TQ unless the bus includes nodes with ceramic resonators or internal oscillators, in which case SJW = 2 provides adequate tolerance.
- Target an 87.5% sample point for general-purpose CAN buses under 10 meters -- this is the most widely compatible setting across automotive and industrial nodes.

## Caveats

- **An incorrect APB1 clock assumption produces a valid but wrong baud rate** -- The CAN peripheral initializes without error at any prescaler value, so a 500 kbps configuration that actually runs at 467 kbps (due to a 45 MHz APB1 instead of 42 MHz) compiles, initializes, and silently fails to communicate with other nodes.
- **CAN baud rate mismatch is invisible without a second node** -- A single node on the bus transmits and receives its own frames during loopback testing, regardless of baud rate. The mismatch only manifests when a second node with a different rate joins the bus.
- **The STM32 HAL `CAN_BS1_11TQ` constant is 10, not 11** -- The register value is zero-indexed (BS1 field = N-1), but the macro name uses the logical value. Mixing direct register writes with HAL constants produces off-by-one errors in bit timing.
- **Changing SYSCLK or APB1 prescaler after CAN initialization invalidates bit timing** -- Low-power modes that switch from PLL to HSI change the APB1 clock, shifting the baud rate. The CAN peripheral must be reinitialized after any clock tree change.
- **The ESP32 TWAI peripheral does not support CAN-FD** -- Despite sharing the same bus, the TWAI controller only handles classic CAN (up to 1 Mbps, 8-byte payload). Attempts to decode CAN-FD frames result in error frames on the bus.

## In Practice

- A CAN bus where one node transmits but no other node acknowledges -- visible as repeating error frames on a bus analyzer -- often indicates a baud rate mismatch. The transmitting node increments its TEC (transmit error counter) with each failed attempt, eventually reaching bus-off state. Measuring the bit width on both nodes' TX pins confirms whether the rates match.
- A node that communicates correctly at 250 kbps but fails at 500 kbps, despite correct prescaler calculations, commonly traces to an APB1 clock that is not what the firmware assumes. On STM32F4, the APB1 clock is SYSCLK / APB1_prescaler, and the APB1 prescaler is often 4 (giving 42 MHz at 168 MHz SYSCLK) but may be 2 (giving 84 MHz) if the clock configuration was changed.
- Intermittent communication errors on a multi-node bus where all nodes are configured for the same baud rate sometimes point to insufficient SJW. Nodes with slightly different oscillator frequencies drift apart during long frames, and SJW = 1 cannot compensate. Increasing SJW to 2 or 3 eliminates the drift-induced errors.
- A logic analyzer capture showing bit widths that vary by 5-10% between successive bits -- rather than being uniform -- indicates the CAN peripheral clock source is jittering. This appears on designs where the APB1 clock derives from an unstable PLL or an uncalibrated internal RC oscillator.
