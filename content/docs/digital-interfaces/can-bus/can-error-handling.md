---
title: "Error Handling & Bus-Off Recovery"
weight: 30
---

# Error Handling & Bus-Off Recovery

CAN's reliability reputation comes from its built-in error detection and fault confinement. The protocol detects five distinct error types at the hardware level and uses two error counters to progressively isolate a faulty node from the bus. Understanding this state machine is essential for firmware that must recover gracefully from bus faults -- a node that enters bus-off state without automatic recovery enabled will remain silent until the MCU is reset.

## Error Counters: TEC and REC

Every CAN controller maintains two 8-bit counters:

- **TEC** (Transmit Error Counter): Incremented when a transmission error is detected. Increased by 8 on most error types.
- **REC** (Receive Error Counter): Incremented when a reception error is detected. Increased by 1 for most errors, by 8 for certain dominant-bit errors.

Both counters decrement by 1 after each successful transmission or reception, respectively. The asymmetry (increment by 8, decrement by 1) ensures that a consistently faulty node accumulates errors faster than it can recover, driving it off the bus.

On STM32 bxCAN, both counters are readable from the `CAN_ESR` (Error Status Register):

```c
uint8_t tec = (CAN1->ESR >> 16) & 0xFF;
uint8_t rec = (CAN1->ESR >> 24) & 0xFF;
```

Or through HAL:

```c
uint32_t tec = HAL_CAN_GetTxError(&hcan);
uint32_t rec = HAL_CAN_GetRxError(&hcan);
```

## Three Error States

The TEC and REC values determine the node's error state:

| State | Condition | Behavior |
|-------|-----------|----------|
| **Error-Active** | TEC <= 127 AND REC <= 127 | Normal operation. Sends active error flags (6 dominant bits) on error detection. |
| **Error-Passive** | TEC > 127 OR REC > 127 | Sends passive error flags (6 recessive bits). Must wait 8-bit times after transmitting before next attempt. |
| **Bus-Off** | TEC > 255 | Node disconnects from bus. No transmission or reception. Recovery requires 128 occurrences of 11 consecutive recessive bits. |

The transition between states is handled entirely in hardware. Firmware does not need to manage the state machine, but it must detect state changes and respond appropriately:

```c
/*
 * Poll error state from CAN_ESR register
 * Bits [1:0] = LEC (Last Error Code)
 * Bit 2 = BOFF (Bus-Off flag)
 * Bit 1 = EPVF (Error Passive flag)
 * Bit 0 = EWGF (Error Warning flag, TEC or REC >= 96)
 */
uint32_t esr = CAN1->ESR;
int is_bus_off     = (esr & CAN_ESR_BOFF) ? 1 : 0;
int is_error_passive = (esr & CAN_ESR_EPVF) ? 1 : 0;
int is_warning     = (esr & CAN_ESR_EWGF) ? 1 : 0;
```

## Five CAN Error Types

The CAN protocol defines five error detection mechanisms, each reported in the Last Error Code (LEC) field of `CAN_ESR`:

| Error Type | LEC Value | Cause |
|------------|-----------|-------|
| **Bit Error** | 1 | Transmitter reads back a different bit than sent (excluding arbitration field) |
| **Stuff Error** | 2 | More than 5 consecutive bits of same polarity detected (violates bit-stuffing rule) |
| **CRC Error** | 3 | Received CRC does not match calculated CRC |
| **Form Error** | 4 | Fixed-form bit field (delimiter, EOF, ACK delimiter) has wrong value |
| **ACK Error** | 5 | Transmitter does not see a dominant bit in the ACK slot |

The LEC field is updated on every bus error and cleared by writing 7 (LEC_UNUSED) to it. Reading LEC in a polling or interrupt handler provides real-time error classification:

```c
uint8_t lec = (CAN1->ESR & CAN_ESR_LEC) >> CAN_ESR_LEC_Pos;

const char *error_names[] = {
    "No Error", "Bit Error", "Stuff Error", "CRC Error",
    "Form Error", "ACK Error", "Reserved", "Unused"
};

if (lec != 0 && lec != 7) {
    log_error("CAN LEC: %s (code %d), TEC=%d, REC=%d",
              error_names[lec], lec,
              (CAN1->ESR >> 16) & 0xFF,
              (CAN1->ESR >> 24) & 0xFF);

    /* Clear LEC by writing 7 */
    CAN1->ESR |= (7 << CAN_ESR_LEC_Pos);
}
```

## Automatic vs Manual Bus-Off Recovery

The `ABOM` (Automatic Bus-Off Management) bit in `CAN_MCR` controls recovery behavior:

**Automatic recovery (ABOM = 1):** The CAN peripheral automatically begins recovery when it enters bus-off, counting 128 occurrences of 11 recessive bits (= 1408 bit times). At 500 kbps, this takes approximately 2.8 ms. After recovery, TEC resets to 0 and the node resumes normal operation.

```c
hcan.Init.AutoBusOff = ENABLE;   /* ABOM = 1 */
```

**Manual recovery (ABOM = 0):** The CAN peripheral remains in bus-off until firmware explicitly requests recovery by setting the `INRQ` bit in `CAN_MCR` (entering initialization mode) then clearing it (returning to normal mode). This provides firmware control over when to rejoin the bus:

```c
hcan.Init.AutoBusOff = DISABLE;   /* ABOM = 0 */

/* Manual recovery sequence */
void can_manual_recovery(CAN_HandleTypeDef *hcan)
{
    /* Enter initialization mode */
    HAL_CAN_Stop(hcan);

    /* Optional: add a delay to avoid rapid reconnect loops */
    HAL_Delay(100);

    /* Restart CAN peripheral */
    HAL_CAN_Start(hcan);

    /* Re-enable receive interrupts */
    HAL_CAN_ActivateNotification(hcan, CAN_IT_RX_FIFO0_MSG_PENDING);
}
```

Manual recovery is preferred in safety-critical applications where a faulty node should not automatically rejoin the bus. Automatic recovery is simpler and appropriate for most industrial and prototyping applications.

## Error Interrupt Configuration

The bxCAN provides a dedicated error interrupt (`CAN1_SCE_IRQn` -- Status Change / Error) that fires on state transitions and error events:

```c
/* Enable error and status change notifications */
HAL_CAN_ActivateNotification(&hcan,
    CAN_IT_ERROR_WARNING |      /* TEC or REC >= 96 */
    CAN_IT_ERROR_PASSIVE |      /* Entered error-passive state */
    CAN_IT_BUSOFF |             /* Entered bus-off state */
    CAN_IT_LAST_ERROR_CODE |    /* Any error (updates LEC) */
    CAN_IT_ERROR);              /* General error interrupt */
```

The HAL error callback provides the error code:

```c
void HAL_CAN_ErrorCallback(CAN_HandleTypeDef *hcan)
{
    uint32_t error = HAL_CAN_GetError(hcan);

    if (error & HAL_CAN_ERROR_BOF) {
        /* Bus-off detected */
        can_bus_off_count++;
        if (hcan->Init.AutoBusOff == DISABLE) {
            can_manual_recovery(hcan);
        }
    }

    if (error & HAL_CAN_ERROR_EPV) {
        /* Error-passive state entered */
        can_error_passive_count++;
    }

    if (error & HAL_CAN_ERROR_EWG) {
        /* Warning threshold (96) reached */
        can_warning_count++;
    }

    /* Log TEC/REC for diagnostics */
    uint32_t tec = (hcan->Instance->ESR >> 16) & 0xFF;
    uint32_t rec = (hcan->Instance->ESR >> 24) & 0xFF;
    log_can_error(error, tec, rec);

    /* Reset error state in HAL */
    HAL_CAN_ResetError(hcan);
}
```

## Comprehensive Error Monitoring

A practical error monitoring structure tracks error rates and state transitions:

```c
typedef struct {
    uint32_t bit_errors;
    uint32_t stuff_errors;
    uint32_t crc_errors;
    uint32_t form_errors;
    uint32_t ack_errors;
    uint32_t bus_off_events;
    uint32_t error_passive_events;
    uint32_t tx_success;
    uint32_t rx_success;
    uint8_t  current_tec;
    uint8_t  current_rec;
} can_error_stats_t;

static can_error_stats_t can_stats = {0};

void can_update_error_stats(CAN_HandleTypeDef *hcan)
{
    uint32_t esr = hcan->Instance->ESR;
    uint8_t lec = (esr & CAN_ESR_LEC) >> CAN_ESR_LEC_Pos;

    switch (lec) {
        case 1: can_stats.bit_errors++;   break;
        case 2: can_stats.stuff_errors++; break;
        case 3: can_stats.crc_errors++;   break;
        case 4: can_stats.form_errors++;  break;
        case 5: can_stats.ack_errors++;   break;
        default: break;
    }

    can_stats.current_tec = (esr >> 16) & 0xFF;
    can_stats.current_rec = (esr >> 24) & 0xFF;

    /* Clear LEC */
    hcan->Instance->ESR |= (7 << CAN_ESR_LEC_Pos);
}
```

## Single-Node Testing Pitfalls

Testing a CAN node without a second node on the bus produces ACK errors on every transmitted frame. The CAN protocol requires at least one other node to assert a dominant bit during the ACK slot. Without it, the transmitting node sees no ACK, increments TEC by 8, and eventually reaches bus-off after approximately 32 failed transmissions (32 x 8 = 256).

For single-node development, the bxCAN provides loopback mode:

```c
hcan.Init.Mode = CAN_MODE_LOOPBACK;   /* TX internally loops to RX */
```

In loopback mode, the peripheral provides its own ACK and does not require an external transceiver or second node. However, loopback mode does not exercise the physical layer -- it does not test the transceiver, bus termination, or signal integrity. Silent mode (`CAN_MODE_SILENT`) monitors bus traffic without transmitting, and combined silent-loopback mode (`CAN_MODE_SILENT_LOOPBACK`) provides internal loopback without any bus interaction.

## Tips

- Enable `AutoBusOff` (ABOM) during development and prototyping -- manual recovery adds complexity that distracts from bring-up. Switch to manual recovery only when the application requires explicit control over bus rejoining.
- Log TEC and REC values periodically (every 100 ms) during development, even when no errors are apparent -- watching the counters trend upward before reaching error thresholds provides early warning of marginal bus conditions.
- Use loopback mode for initial firmware validation (filter configuration, message parsing, callback routing) before connecting to the physical bus -- this isolates software bugs from hardware and wiring issues.
- Keep error statistics in a persistent structure that survives soft resets -- comparing pre-reset and post-reset error counts helps identify whether the error source is the node itself or external.
- Enable all five error notification types (`CAN_IT_ERROR_WARNING` through `CAN_IT_ERROR`) during development for full visibility into error state transitions.

## Caveats

- **A single CAN node on a bus will always reach bus-off within seconds** -- Without a second node to ACK frames, every transmission generates an ACK error (TEC += 8). After 32 failed frames, TEC exceeds 255 and the node enters bus-off. This is correct protocol behavior, not a firmware bug.
- **Automatic bus-off recovery with a persistent fault creates a rapid connect/disconnect cycle** -- If the underlying cause (e.g., broken termination, wrong baud rate) is not resolved, the node recovers in ~3 ms, immediately fails again, and oscillates between bus-off and error-active. This generates continuous error frames that disrupt other nodes on the bus.
- **The LEC field in CAN_ESR is not cleared automatically** -- It retains the last error code until firmware writes 7 to it. Reading LEC without clearing it can make a single error appear persistent across multiple polling cycles.
- **TEC and REC are reset to 0 on bus-off recovery, hiding the error history** -- After automatic recovery, the counters restart from zero regardless of the previous error count. Without firmware-level tracking, repeated bus-off/recovery cycles appear as normal operation.
- **The HAL error callback does not fire for every individual CAN error** -- The `CAN_IT_LAST_ERROR_CODE` interrupt triggers on LEC changes, not on every error event. Back-to-back errors of the same type generate only one interrupt. Polling LEC at a fixed rate catches errors the interrupt misses.

## In Practice

- A CAN node that reaches bus-off within seconds of starting, with TEC climbing in jumps of 8, and LEC consistently showing ACK Error (code 5), indicates the node is alone on the bus or the other node has a different baud rate. Connecting a second properly-configured node resolves the ACK errors immediately.
- A node that oscillates between error-active and error-passive -- with TEC hovering around 128 -- often indicates marginal signal integrity. The physical layer is barely functional: some frames transmit successfully (decrementing TEC) while others fail (incrementing TEC). An oscilloscope on CANH/CANL typically reveals ringing, insufficient differential voltage, or missing termination resistors.
- Intermittent stuff errors on a bus that otherwise functions correctly commonly appear when a non-CAN device or a floating wire injects spurious transitions. The CAN controller interprets the noise as bit-stuffing violations because more than five consecutive identical bits are interrupted by a glitch.
- A node that shows zero errors for hours, then suddenly accumulates CRC errors during a specific operational mode, often traces to EMI from a nearby actuator or motor driver. The CRC errors coincide with the actuator's switching events, and shielding or rerouting the CAN bus wiring eliminates the correlation.
- Bus-off recovery that takes longer than expected (hundreds of milliseconds instead of ~3 ms at 500 kbps) suggests the bus is not returning to a quiescent recessive state. The recovery counter requires 128 sequences of 11 recessive bits, and any dominant bit from another node resets the sequence. A faulty node continuously transmitting error frames can hold the bus in a dominant state, preventing other nodes from recovering.
