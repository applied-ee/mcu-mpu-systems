---
title: "CAN-FD & Extended Frames"
weight: 40
---

# CAN-FD & Extended Frames

CAN-FD (Flexible Data-Rate) extends classic CAN in two directions: larger payloads (up to 64 bytes per frame versus 8) and a faster data-phase bit rate (up to 5 Mbps or higher, versus the 1 Mbps ceiling of classic CAN). These improvements address the growing bandwidth demands of automotive ECUs and industrial systems without replacing the CAN physical layer or arbitration mechanism. The tradeoff is increased peripheral complexity -- dual bit-rate configuration, message RAM management, and careful attention to transceiver and bus topology limitations.

## CAN-FD Frame Structure

A CAN-FD frame modifies the classic CAN frame in three key ways:

| Feature | Classic CAN | CAN-FD |
|---------|------------|--------|
| Max payload | 8 bytes | 64 bytes |
| Data bit rate | Same as arbitration | Switchable (higher) |
| DLC encoding | Linear (0-8) | Non-linear above 8 (12, 16, 20, 24, 32, 48, 64) |
| FDF bit | Not present | 1 = FD frame |
| BRS bit | Not present | 1 = bit rate switch enabled |

The **FDF** (FD Format) bit distinguishes CAN-FD frames from classic CAN frames. The **BRS** (Bit Rate Switch) bit enables the higher data-phase bit rate for the payload portion. When BRS = 0, the entire frame uses the nominal (arbitration) bit rate -- effectively a classic-rate CAN-FD frame with extended payload.

The DLC field in CAN-FD encodes payload sizes non-linearly above 8 bytes:

| DLC | Bytes (Classic) | Bytes (CAN-FD) |
|-----|-----------------|----------------|
| 0-8 | 0-8 | 0-8 |
| 9 | -- | 12 |
| 10 | -- | 16 |
| 11 | -- | 20 |
| 12 | -- | 24 |
| 13 | -- | 32 |
| 14 | -- | 48 |
| 15 | -- | 64 |

## Dual Bit-Rate Configuration

CAN-FD uses two separate bit rates:

- **Nominal bit rate**: Used during arbitration, ACK, and control fields. This rate must be compatible with all nodes on the bus, including classic CAN nodes (if present). Typically 500 kbps or 1 Mbps.
- **Data bit rate**: Used during the data payload and CRC field when BRS = 1. Can be 2 Mbps, 4 Mbps, 5 Mbps, or even 8 Mbps on short buses with high-quality transceivers.

The bit rate switches at the BRS bit boundary: the arbitration phase runs at the nominal rate, then the clock accelerates to the data rate for the payload, then returns to the nominal rate for the ACK and end-of-frame fields.

## STM32 FDCAN Peripheral

The FDCAN peripheral is available on STM32G4, STM32H7, STM32L5, and STM32U5 families. It replaces the older bxCAN peripheral found on STM32F1/F2/F3/F4 families. Key differences:

| Feature | bxCAN (F4) | FDCAN (H7/G4) |
|---------|-----------|----------------|
| CAN-FD support | No | Yes |
| Max data rate | 1 Mbps | 5+ Mbps |
| Max payload | 8 bytes | 64 bytes |
| Filter banks | 28 (shared) | Configurable in message RAM |
| Message RAM | 3-deep FIFOs | Configurable (up to 2560 words on H7) |
| Tx buffering | 3 mailboxes | Up to 32 Tx buffers |
| Rx buffering | 3 per FIFO | Up to 64 Rx FIFO elements |

## FDCAN Initialization with Dual Bit Rates

The following configuration sets up FDCAN1 on STM32H743 for 500 kbps nominal / 2 Mbps data rate. The FDCAN kernel clock on STM32H7 is typically sourced from PLL1Q (typically 80 MHz) or HSE:

```c
FDCAN_HandleTypeDef hfdcan1;

hfdcan1.Instance = FDCAN1;
hfdcan1.Init.FrameFormat        = FDCAN_FRAME_FD_BRS;    /* FD with bit rate switching */
hfdcan1.Init.Mode               = FDCAN_MODE_NORMAL;
hfdcan1.Init.AutoRetransmission = ENABLE;
hfdcan1.Init.TransmitPause      = ENABLE;
hfdcan1.Init.ProtocolException  = DISABLE;

/* Nominal bit timing: 500 kbps from 80 MHz kernel clock
 * Prescaler=10, NomTimeSeg1=13, NomTimeSeg2=2 → 16 TQ/bit
 * 80 MHz / (10 * 16) = 500 kbps
 * Sample point = (1 + 13) / 16 = 87.5%
 */
hfdcan1.Init.NominalPrescaler   = 10;
hfdcan1.Init.NominalSyncJumpWidth = 1;
hfdcan1.Init.NominalTimeSeg1    = 13;
hfdcan1.Init.NominalTimeSeg2    = 2;

/* Data bit timing: 2 Mbps from 80 MHz kernel clock
 * Prescaler=2, DataTimeSeg1=15, DataTimeSeg2=4 → 20 TQ/bit
 * 80 MHz / (2 * 20) = 2 Mbps
 * Sample point = (1 + 15) / 20 = 80%
 */
hfdcan1.Init.DataPrescaler      = 2;
hfdcan1.Init.DataSyncJumpWidth  = 1;
hfdcan1.Init.DataTimeSeg1       = 15;
hfdcan1.Init.DataTimeSeg2       = 4;

/* Message RAM configuration */
hfdcan1.Init.StdFiltersNbr      = 8;    /* 8 standard ID filters */
hfdcan1.Init.ExtFiltersNbr      = 4;    /* 4 extended ID filters */
hfdcan1.Init.RxFifo0ElmtsNbr   = 8;    /* 8 elements in Rx FIFO 0 */
hfdcan1.Init.RxFifo0ElmtSize   = FDCAN_DATA_BYTES_64;
hfdcan1.Init.RxFifo1ElmtsNbr   = 4;
hfdcan1.Init.RxFifo1ElmtSize   = FDCAN_DATA_BYTES_64;
hfdcan1.Init.TxFifoQueueElmtsNbr = 4;
hfdcan1.Init.TxFifoQueueMode   = FDCAN_TX_FIFO_OPERATION;
hfdcan1.Init.TxElmtSize        = FDCAN_DATA_BYTES_64;

if (HAL_FDCAN_Init(&hfdcan1) != HAL_OK) {
    Error_Handler();
}
```

## Message RAM Configuration

Unlike bxCAN's fixed 3-deep FIFOs, the FDCAN peripheral uses a configurable **message RAM** that is partitioned at initialization time. On STM32H7, the FDCAN message RAM is 2560 32-bit words (10 KB) shared among all FDCAN instances (FDCAN1, FDCAN2, FDCAN3 on H743).

Each message RAM element has a variable size depending on the configured payload length:

| Element Size Setting | Words per Element | Bytes Payload |
|---------------------|-------------------|---------------|
| `FDCAN_DATA_BYTES_8` | 4 (header) + 2 (data) | 8 |
| `FDCAN_DATA_BYTES_16` | 4 + 4 | 16 |
| `FDCAN_DATA_BYTES_32` | 4 + 8 | 32 |
| `FDCAN_DATA_BYTES_64` | 4 + 16 | 64 |

The total RAM consumed is the sum of all configured elements. Exceeding the available message RAM causes `HAL_FDCAN_Init()` to return an error. A practical sizing calculation for the configuration above:

```
Standard filters:   8 × 1 word   =   8 words
Extended filters:   4 × 2 words  =   8 words
Rx FIFO 0:          8 × 18 words = 144 words  (64-byte elements)
Rx FIFO 1:          4 × 18 words =  72 words
Tx FIFO:            4 × 18 words =  72 words
Total:              304 words (of 2560 available)
```

For memory-constrained configurations, reducing the element size to `FDCAN_DATA_BYTES_8` when CAN-FD payloads are not needed cuts RAM usage by approximately 70%.

## FDCAN Filter Configuration

FDCAN filters are stored in message RAM rather than dedicated filter bank registers. The API mirrors the bxCAN approach but with different structures:

```c
FDCAN_FilterTypeDef filter;

filter.IdType       = FDCAN_STANDARD_ID;
filter.FilterIndex  = 0;
filter.FilterType   = FDCAN_FILTER_MASK;        /* Mask mode */
filter.FilterConfig = FDCAN_FILTER_TO_RXFIFO0;
filter.FilterID1    = 0x200;                     /* ID value */
filter.FilterID2    = 0x7F0;                     /* Mask: match 0x200-0x20F */

HAL_FDCAN_ConfigFilter(&hfdcan1, &filter);

/* Reject all non-matching frames */
HAL_FDCAN_ConfigGlobalFilter(&hfdcan1,
    FDCAN_REJECT, FDCAN_REJECT,
    FDCAN_FILTER_REMOTE, FDCAN_FILTER_REMOTE);
```

The `ConfigGlobalFilter` call is important on FDCAN -- unlike bxCAN where unmatched frames are silently dropped, the FDCAN peripheral can be configured to accept non-matching frames into a FIFO, which is useful for bus analysis but harmful for production filtering.

## Transmitting a CAN-FD Frame

```c
FDCAN_TxHeaderTypeDef tx_header;
uint8_t tx_data[32];

tx_header.Identifier          = 0x123;
tx_header.IdType              = FDCAN_STANDARD_ID;
tx_header.TxFrameType         = FDCAN_DATA_FRAME;
tx_header.DataLength          = FDCAN_DLC_BYTES_32;    /* 32-byte payload */
tx_header.ErrorStateIndicator = FDCAN_ESI_ACTIVE;
tx_header.BitRateSwitch       = FDCAN_BRS_ON;          /* Use data-phase bit rate */
tx_header.FDFormat            = FDCAN_FD_CAN;          /* CAN-FD frame */
tx_header.TxEventFifoControl  = FDCAN_NO_TX_EVENTS;
tx_header.MessageMarker       = 0;

memset(tx_data, 0xAA, 32);

if (HAL_FDCAN_AddMessageToTxFifoQ(&hfdcan1, &tx_header, tx_data) != HAL_OK) {
    Error_Handler();
}
```

Setting `FDFormat = FDCAN_CLASSIC_CAN` and `BitRateSwitch = FDCAN_BRS_OFF` transmits a classic CAN frame through the FDCAN peripheral, maintaining backward compatibility.

## Backward Compatibility with Classic CAN Nodes

CAN-FD is designed to coexist with classic CAN nodes on the same physical bus, with important constraints:

- Classic CAN nodes **cannot receive CAN-FD frames**. They detect the FDF bit as an error and generate error frames.
- CAN-FD nodes **can receive and transmit classic CAN frames**. The FDCAN peripheral handles both frame types transparently.
- A mixed bus (classic + FD nodes) can only use classic CAN frames for messages that classic nodes need to receive.

The practical approach for mixed buses: use CAN-FD frames only for communication between FD-capable nodes, and classic frames for broadcast or messages involving legacy nodes. The FDCAN peripheral's filter and FIFO system handles both frame types simultaneously without firmware intervention.

## When CAN-FD Justifies the Complexity

CAN-FD adds configuration complexity (dual bit timing, message RAM sizing, transceiver selection) that is not always justified. A decision framework:

**CAN-FD is worth considering when:**
- Payload exceeds 8 bytes per message (eliminates multi-frame segmentation protocols like ISO-TP)
- Bus bandwidth at 1 Mbps classic CAN is insufficient (firmware flashing over CAN, high-rate sensor fusion)
- New designs where all nodes can be specified as CAN-FD capable
- The MCU already has FDCAN (STM32H7, G4) and classic bxCAN is not available

**Classic CAN remains sufficient when:**
- All messages fit in 8 bytes (most sensor data, simple actuator commands)
- The bus has legacy nodes that cannot be upgraded
- Bus utilization at 500 kbps or 1 Mbps is below 50%
- The application uses a higher-layer protocol (CANopen, J1939) that already handles multi-frame transport

A common middle-ground approach: configure the FDCAN peripheral for classic CAN operation (8-byte payload, single bit rate) during initial bring-up, then enable FD features incrementally once the basic bus communication is verified.

## Tips

- Start with `FrameFormat = FDCAN_FRAME_CLASSIC` during FDCAN peripheral bring-up, then switch to `FDCAN_FRAME_FD_BRS` after verifying basic transmit and receive -- this isolates FDCAN configuration issues from CAN-FD protocol issues.
- Size message RAM elements to the actual maximum payload needed, not `FDCAN_DATA_BYTES_64` by default -- an application using only 16-byte payloads wastes 60% of message RAM with 64-byte elements.
- Set `ConfigGlobalFilter` to reject non-matching frames in production firmware -- the default behavior of accepting unfiltered frames into FIFO can cause overruns on a busy bus.
- Use the data-phase sample point at 70-80% rather than the 87.5% common for nominal rates -- the higher data rate leaves less margin for signal propagation, and a slightly earlier sample point improves reliability.
- Verify the FDCAN kernel clock source in the clock tree configuration -- on STM32H7, FDCAN can be clocked from PLL1Q, PLL2Q, or HSE, and the HAL does not validate that the selected source produces achievable bit timing.

## Caveats

- **Classic CAN nodes on a mixed bus generate error frames when they see CAN-FD frames** -- A single classic-only node on a bus will corrupt every CAN-FD transmission by sending error flags during the FDF/BRS fields. All nodes that share bus access to CAN-FD traffic must support CAN-FD.
- **The STM32 bxCAN peripheral (F1/F2/F3/F4) cannot be upgraded to CAN-FD through firmware** -- CAN-FD requires hardware support for dual clock domains and extended payload handling. The bxCAN controller treats FDF frames as errors. A hardware change to an STM32G4 or H7 is required.
- **Message RAM overflow during `HAL_FDCAN_Init()` fails silently on some HAL versions** -- The total configured RAM may exceed the available 2560 words without a clear error indication. Calculating the total manually before initialization catches this before runtime.
- **CAN-FD data-phase bit rates above 2 Mbps require CAN-FD-capable transceivers** -- Standard CAN transceivers (MCP2551, SN65HVD230) do not meet the loop delay requirements for data rates above 2 Mbps. CAN-FD transceivers like MCP2542FD or TCAN1042V are required, and even then, bus length must be kept under 5 meters at 5 Mbps.
- **DLC values 9-15 encode non-linear byte counts in CAN-FD** -- Firmware that treats DLC as a direct byte count above 8 (e.g., DLC=12 meaning 12 bytes) produces buffer overflows or truncated data. The DLC-to-bytes mapping (9->12, 10->16, ..., 15->64) must be applied explicitly.

## In Practice

- A CAN-FD bus that works in a bench setup (two nodes, 20 cm cable) but fails at data rates above 2 Mbps in a production enclosure typically indicates transceiver propagation delay or bus topology issues. The data phase at 5 Mbps allows only 200 ns per bit, and a round-trip propagation delay exceeding 100 ns (common with cables over 1 meter) pushes the sample point past the valid window.
- An FDCAN peripheral that returns `HAL_ERROR` from `HAL_FDCAN_Init()` without an obvious configuration mistake often traces to message RAM exhaustion. Adding up all configured element counts (filters + Rx FIFO 0 + Rx FIFO 1 + Tx buffers + Tx event FIFO) and multiplying by the per-element word count confirms whether the total exceeds 2560 words.
- A mixed classic/CAN-FD bus where classic nodes intermittently reset or enter bus-off commonly results from CAN-FD frames being transmitted on the bus. The classic nodes interpret the FDF bit as a protocol error, generate error frames, and accumulate TEC counts. Isolating FD traffic to a separate bus segment or restricting all shared traffic to classic frames resolves the issue.
- Received CAN-FD frames with correct headers but corrupted payload data -- where the first 8 bytes are correct but bytes 9-64 are garbage -- sometimes indicate that the Rx FIFO element size is configured smaller than the incoming payload. The FDCAN peripheral truncates the data to the configured element size without setting an error flag.
- An FDCAN node that successfully transmits classic CAN frames but fails when switching to `FDCAN_FD_CAN` with BRS enabled, while the TEC counter climbs rapidly, usually indicates the receiving node does not support CAN-FD or the data-phase bit timing is incorrect. Disabling BRS (`FDCAN_BRS_OFF`) while keeping `FDCAN_FD_CAN` isolates whether the issue is the FD frame format or the bit-rate switching specifically.
