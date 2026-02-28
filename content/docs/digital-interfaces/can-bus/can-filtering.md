---
title: "Message Filtering & FIFO Management"
weight: 20
---

# Message Filtering & FIFO Management

A busy CAN bus carries hundreds of distinct message IDs at rates exceeding 5,000 frames per second. Without hardware filtering, firmware must inspect every frame in software, consuming CPU cycles and risking FIFO overruns during high-load bursts. The STM32 bxCAN peripheral provides configurable hardware filter banks that discard irrelevant messages before they reach the receive FIFOs, ensuring the CPU only processes frames the application actually needs.

## Filter Banks on STM32 bxCAN

The STM32F4 bxCAN peripheral provides **28 filter banks** (numbered 0-27). On dual-CAN devices (STM32F405, F407, F427, F429), filter banks are shared between CAN1 and CAN2. The `CAN_FMR.CAN2SB` field sets the split point -- banks below `CAN2SB` serve CAN1, banks at or above serve CAN2. The default split is bank 14 (14 for CAN1, 14 for CAN2).

Single-CAN devices (STM32F446, STM32F103) still have 14 filter banks, all assigned to CAN1.

Each filter bank can operate in one of four configurations:

| Scale | Mode | Filters per Bank | Match Type |
|-------|------|-------------------|------------|
| 32-bit | Mask | 1 filter | ID & mask pair |
| 32-bit | List | 2 filters | Exact ID match |
| 16-bit | Mask | 2 filters | ID & mask pair (standard frames only) |
| 16-bit | List | 4 filters | Exact ID match (standard frames only) |

## Mask Mode: Accepting a Range of IDs

In mask mode, a filter bank contains an ID value and a mask. The mask determines which bits of the incoming message ID must match the filter ID. A mask bit of 1 means "this bit must match," and a mask bit of 0 means "don't care."

To accept all standard IDs from 0x200 to 0x2FF (a common range for sensor data in automotive applications):

```c
CAN_FilterTypeDef filter;

filter.FilterBank           = 0;
filter.FilterMode           = CAN_FILTERMODE_IDMASK;
filter.FilterScale          = CAN_FILTERSCALE_32BIT;
filter.FilterIdHigh         = (0x200 << 5);   /* ID shifted into position */
filter.FilterIdLow          = 0x0000;
filter.FilterMaskIdHigh     = (0x700 << 5);   /* Match upper 3 bits: 0b010 */
filter.FilterMaskIdLow      = 0x0000;
filter.FilterFIFOAssignment = CAN_FILTER_FIFO0;
filter.FilterActivation     = ENABLE;
filter.SlaveStartFilterBank = 14;

if (HAL_CAN_ConfigFilter(&hcan, &filter) != HAL_OK) {
    Error_Handler();
}
```

The shift-by-5 in `FilterIdHigh` accounts for the bxCAN register layout: the standard 11-bit CAN ID occupies bits [15:5] of the high register, with bits [4:0] containing RTR, IDE, and EXID[17:15] fields.

The mask `0x700 << 5` means only bits 10, 9, and 8 of the ID must match the filter value `0x200` (binary `010_0000_0000`). Any ID where bits [10:8] = `010` passes the filter: 0x200 through 0x2FF.

## List Mode: Accepting Specific IDs

List mode configures the filter bank with exact IDs to accept -- no wildcards. In 32-bit list mode, each bank holds two exact-match entries. This is useful when only a few specific messages matter:

```c
CAN_FilterTypeDef filter;

filter.FilterBank           = 1;
filter.FilterMode           = CAN_FILTERMODE_IDLIST;
filter.FilterScale          = CAN_FILTERSCALE_32BIT;
filter.FilterIdHigh         = (0x181 << 5);   /* First accepted ID */
filter.FilterIdLow          = 0x0000;
filter.FilterMaskIdHigh     = (0x281 << 5);   /* Second accepted ID */
filter.FilterMaskIdLow      = 0x0000;
filter.FilterFIFOAssignment = CAN_FILTER_FIFO1;
filter.FilterActivation     = ENABLE;
filter.SlaveStartFilterBank = 14;

HAL_CAN_ConfigFilter(&hcan, &filter);
```

In list mode, the `FilterMaskIdHigh`/`FilterMaskIdLow` fields do not function as masks -- they hold the second ID in the pair. The field names are inherited from the register layout and are misleading in list mode.

## 16-Bit Filter Scale

The 16-bit scale mode is limited to standard (11-bit) CAN identifiers but doubles the number of filters per bank. In 16-bit list mode, a single bank holds four exact-match IDs:

```c
CAN_FilterTypeDef filter;

filter.FilterBank           = 2;
filter.FilterMode           = CAN_FILTERMODE_IDLIST;
filter.FilterScale          = CAN_FILTERSCALE_16BIT;
filter.FilterIdHigh         = (0x100 << 5);  /* ID #1 */
filter.FilterIdLow          = (0x101 << 5);  /* ID #2 */
filter.FilterMaskIdHigh     = (0x200 << 5);  /* ID #3 */
filter.FilterMaskIdLow      = (0x201 << 5);  /* ID #4 */
filter.FilterFIFOAssignment = CAN_FILTER_FIFO0;
filter.FilterActivation     = ENABLE;
filter.SlaveStartFilterBank = 14;

HAL_CAN_ConfigFilter(&hcan, &filter);
```

For applications that need to accept a moderate number of exact IDs (10-50), 16-bit list mode maximizes filter density: 28 banks x 4 IDs = 112 individual IDs.

## Filter-to-FIFO Assignment

The bxCAN peripheral has two receive FIFOs (FIFO0 and FIFO1), each three messages deep. Every filter bank is assigned to one FIFO via `FilterFIFOAssignment`. Strategic FIFO assignment prevents high-priority messages from being blocked by lower-priority traffic:

```c
/* High-priority safety messages → FIFO0 (higher interrupt priority) */
filter_safety.FilterFIFOAssignment = CAN_FILTER_FIFO0;

/* Diagnostic and status messages → FIFO1 */
filter_diag.FilterFIFOAssignment = CAN_FILTER_FIFO1;
```

A common strategy splits filters across both FIFOs by message criticality. Safety-critical frames (brake status, airbag triggers) go to FIFO0 with a high-priority interrupt, while housekeeping messages (temperature readings, odometer) go to FIFO1 with a lower-priority interrupt. This prevents a burst of diagnostic messages from delaying safety message processing.

## Receive Interrupts and Message Retrieval

The bxCAN provides separate interrupts for each FIFO: `CAN1_RX0_IRQn` (FIFO0 message pending) and `CAN1_RX1_IRQn` (FIFO1 message pending). Activation and retrieval through the HAL:

```c
/* Enable FIFO0 message pending interrupt */
HAL_CAN_ActivateNotification(&hcan, CAN_IT_RX_FIFO0_MSG_PENDING);

/* Start the CAN peripheral */
HAL_CAN_Start(&hcan);
```

The receive callback:

```c
void HAL_CAN_RxFifo0MsgPendingCallback(CAN_HandleTypeDef *hcan)
{
    CAN_RxHeaderTypeDef rx_header;
    uint8_t rx_data[8];

    if (HAL_CAN_GetRxMessage(hcan, CAN_RX_FIFO0, &rx_header, rx_data) == HAL_OK) {
        /* rx_header.StdId contains the 11-bit identifier */
        /* rx_header.DLC contains the data length (0-8) */
        /* rx_header.FilterMatchIndex identifies which filter matched */
        process_can_message(rx_header.StdId, rx_data, rx_header.DLC);
    }
}
```

The `FilterMatchIndex` field in the receive header indicates which filter bank accepted the message. This allows a single callback to route messages to different handlers without re-parsing the ID:

```c
void process_can_message(uint32_t id, uint8_t *data, uint8_t len)
{
    switch (id) {
        case 0x181:
            handle_sensor_a(data, len);
            break;
        case 0x281:
            handle_sensor_b(data, len);
            break;
        default:
            /* Unrecognized ID -- should not reach here if filters are correct */
            break;
    }
}
```

## FIFO Overrun Handling

Each FIFO holds three messages. If firmware does not read messages quickly enough, the fourth incoming message triggers an overrun. The bxCAN provides two overrun policies:

- **FIFO unlocked** (`ReceiveFifoLocked = DISABLE`): The newest message overwrites the oldest. This is the default HAL behavior. Latest data is always available, but intermediate frames are lost.
- **FIFO locked** (`ReceiveFifoLocked = ENABLE`): New messages are discarded when the FIFO is full. This preserves message ordering but drops the most recent data.

Overrun notifications:

```c
/* Enable FIFO0 overrun interrupt */
HAL_CAN_ActivateNotification(&hcan,
    CAN_IT_RX_FIFO0_MSG_PENDING | CAN_IT_RX_FIFO0_OVERRUN);

void HAL_CAN_RxFifo0FullCallback(CAN_HandleTypeDef *hcan)
{
    /* FIFO0 has 3 pending messages -- read all immediately */
    overrun_warning_flag = 1;
}
```

## Filter Bank Assignment Strategy

For a typical automotive or industrial node that monitors 5-20 message IDs:

1. **One mask filter for the node's primary ID range** -- covers the bulk of expected traffic (e.g., all IDs from 0x100-0x1FF for a sensor cluster).
2. **List-mode filters for specific out-of-range IDs** -- individual IDs that fall outside the masked range (e.g., 0x7DF for OBD-II diagnostic requests).
3. **Split FIFOs by priority class** -- safety/control messages to FIFO0, telemetry/diagnostics to FIFO1.
4. **Leave unused banks disabled** -- disabled filter banks do not consume power, but enabled banks with incorrect masks can admit unwanted traffic that fills the FIFO.

For a node that must accept all traffic (a bus analyzer or gateway), a single mask filter with mask = 0x000 passes every ID:

```c
filter.FilterMode       = CAN_FILTERMODE_IDMASK;
filter.FilterScale      = CAN_FILTERSCALE_32BIT;
filter.FilterIdHigh     = 0x0000;
filter.FilterIdLow      = 0x0000;
filter.FilterMaskIdHigh = 0x0000;  /* All bits "don't care" */
filter.FilterMaskIdLow  = 0x0000;
```

## Tips

- Always configure at least one filter bank before calling `HAL_CAN_Start()` -- the bxCAN peripheral will not receive any messages if all filter banks are disabled, and no error is reported.
- Use `FilterMatchIndex` in the receive callback to route messages by filter rather than re-parsing the CAN ID -- this is faster and avoids duplicating the filter logic in software.
- Assign safety-critical messages and high-frequency messages to separate FIFOs -- a burst of 100 Hz telemetry frames filling FIFO0 can cause a 10 Hz safety message to be dropped if both share the same FIFO.
- For dual-CAN configurations on STM32F4, set `SlaveStartFilterBank` explicitly rather than relying on the default -- the default split of 14/14 may not match the application's filter count requirements.
- On ESP32, the TWAI driver's `twai_filter_config_t` provides a single acceptance filter (one code/mask pair) that covers the entire ID space -- for multi-ID filtering, the remaining filtering must be done in software within the receive task.

## Caveats

- **The `FilterMaskIdHigh` field functions as a second ID in list mode, not as a mask** -- The field name is inherited from the hardware register and does not change meaning based on mode. Treating it as a mask in list mode causes the filter to accept an unintended ID.
- **A mask of 0xFFFF does not mean "accept all"** -- In mask mode, a mask of all ones requires every bit to match, meaning only a single exact ID passes. All-zeros means "don't care" and accepts everything. This is the opposite of a network subnet mask convention.
- **Enabled filter banks with stale configurations silently accept wrong messages** -- Reusing filter bank numbers without disabling them first leaves the old configuration active. When changing filters at runtime, disable the bank, reconfigure, then re-enable.
- **FIFO overrun in unlocked mode discards the oldest message without any error flag** -- The application has no indication that data was lost unless the overrun interrupt is explicitly enabled. Time-critical protocols that depend on message ordering (e.g., segmented ISO-TP transfers) can fail silently.
- **16-bit filter scale does not support extended (29-bit) CAN identifiers** -- Extended frames bypass 16-bit filters entirely. An application using both standard and extended IDs must use 32-bit scale for the extended ID filters.

## In Practice

- A node that initializes without error but never receives any messages -- despite confirmed bus traffic on a logic analyzer -- almost always has no filter banks enabled. The bxCAN peripheral defaults to all filters disabled, and without at least one active filter, every incoming frame is silently discarded.
- Intermittent message loss under high bus load, where frames arrive correctly at low rates but drop when traffic exceeds roughly 3,000 frames per second, typically points to FIFO overrun. The three-deep FIFO provides less than 1 ms of buffering at high message rates. Enabling the overrun interrupt and logging its frequency confirms the diagnosis; splitting traffic across both FIFOs and increasing interrupt priority usually resolves the issue.
- A filter configured to accept IDs 0x200-0x2FF that also passes 0x300-0x3FF indicates a mask error. The mask `0x600 << 5` instead of `0x700 << 5` leaves bit 8 as "don't care," doubling the accepted range. Printing the actual register values (`CAN1->FA1R`, `CAN1->sFilterRegister[n]`) and comparing against the intended mask catches this class of error.
- Messages arriving in the wrong FIFO callback -- `RxFifo1MsgPendingCallback` firing for messages expected in FIFO0 -- commonly results from a `FilterFIFOAssignment` mismatch. When multiple filter banks are configured in separate function calls, a copy-paste error in the FIFO assignment field routes traffic to the unintended FIFO. Checking each filter bank's FIFO assignment in the `CAN_FFA1R` register confirms the routing.
- On dual-CAN STM32 devices, CAN2 receiving no messages despite correct filter configuration often traces to the `SlaveStartFilterBank` value assigning all 28 banks to CAN1, leaving CAN2 with zero filters.
