---
title: "Interrupt-Driven UART Reception"
weight: 20
---

# Interrupt-Driven UART Reception

Polling the UART receive register works for bench demos but fails in production. Data arrives asynchronously, and if the firmware is busy doing anything else when a byte lands in the data register, the next byte overwrites it — silently. Interrupt-driven reception solves this by responding to each received byte immediately, copying it into a buffer that the main loop can process at its own pace. The gap between "polling works" and "interrupt-driven works" is the gap between a demo and a product.

## RXNE Interrupt Basics

The RXNE (Receive Not Empty) flag in USART_SR (STM32F4) or USART_ISR (STM32H7) is set when a complete byte has been shifted into the receive data register (RDR). Enabling the RXNE interrupt (RXNEIE bit in USART_CR1) causes the USART IRQ to fire each time a byte arrives. The ISR must read the data register to clear the RXNE flag — if the read is skipped, the interrupt fires repeatedly.

Direct register-level RXNE handling on STM32F4:

```c
/* Enable RXNE interrupt */
USART2->CR1 |= USART_CR1_RXNEIE;
NVIC_EnableIRQ(USART2_IRQn);
NVIC_SetPriority(USART2_IRQn, 5);
```

## Ring Buffer Implementation

A ring buffer (circular buffer) decouples the ISR producer from the main-loop consumer. The ISR writes bytes at the head; the main loop reads from the tail. No mutex is needed when there is exactly one producer and one consumer, provided the head and tail indices are updated atomically (which single-word writes on Cortex-M are).

```c
#define UART_RX_BUF_SIZE 256  /* Must be power of 2 */

static volatile uint8_t rx_buf[UART_RX_BUF_SIZE];
static volatile uint32_t rx_head = 0;  /* Written by ISR */
static volatile uint32_t rx_tail = 0;  /* Written by main loop */

void USART2_IRQHandler(void) {
    uint32_t sr = USART2->SR;

    /* --- Error flags: must be cleared before reading DR --- */
    if (sr & (USART_SR_ORE | USART_SR_FE | USART_SR_NE | USART_SR_PE)) {
        /* Read SR then DR to clear error flags (F4 sequence) */
        volatile uint32_t dummy = USART2->DR;
        (void)dummy;
        return;
    }

    if (sr & USART_SR_RXNE) {
        uint8_t byte = (uint8_t)USART2->DR;  /* Clears RXNE */
        uint32_t next_head = (rx_head + 1) & (UART_RX_BUF_SIZE - 1);

        if (next_head != rx_tail) {
            /* Buffer not full — store byte */
            rx_buf[rx_head] = byte;
            rx_head = next_head;
        }
        /* If buffer full, byte is silently dropped */
    }
}
```

The power-of-2 buffer size enables the `& (SIZE - 1)` mask trick instead of a modulo operation, which saves cycles inside the ISR. On Cortex-M, this single-instruction mask is important at high baud rates where ISR overhead matters.

## Main-Loop Consumer

The consumer side checks for available data by comparing head and tail:

```c
uint32_t uart_rx_available(void) {
    return (rx_head - rx_tail) & (UART_RX_BUF_SIZE - 1);
}

int uart_rx_read(uint8_t *buf, uint32_t max_len) {
    uint32_t count = 0;
    while (count < max_len && rx_tail != rx_head) {
        buf[count++] = rx_buf[rx_tail];
        rx_tail = (rx_tail + 1) & (UART_RX_BUF_SIZE - 1);
    }
    return count;
}
```

No critical section is needed because `rx_head` is only written by the ISR and only read by the consumer, while `rx_tail` is only written by the consumer and only read by the ISR. This single-producer / single-consumer pattern is inherently safe on architectures with atomic aligned word writes.

## IDLE Line Interrupt for Packet Boundaries

Raw RXNE handling gives individual bytes with no indication of when a message ends. The IDLE line interrupt (IDLEIE in USART_CR1) fires when the RX line has been idle for one frame duration after the last received byte. This marks the boundary between bursts of data — exactly what protocol parsers need.

```c
/* Enable IDLE interrupt alongside RXNE */
USART2->CR1 |= USART_CR1_RXNEIE | USART_CR1_IDLEIE;

void USART2_IRQHandler(void) {
    uint32_t sr = USART2->SR;

    if (sr & USART_SR_RXNE) {
        /* ... ring buffer write as above ... */
    }

    if (sr & USART_SR_IDLE) {
        /* Clear IDLE flag: read SR then DR (F4 sequence) */
        volatile uint32_t dummy = USART2->DR;
        (void)dummy;

        /* Signal main loop that a complete packet is available */
        packet_ready_flag = 1;
    }
}
```

The main loop checks `packet_ready_flag`, reads all available bytes from the ring buffer, and processes them as a complete message. This pattern handles variable-length protocols without needing to know the message length in advance.

## HAL_UART_Receive_IT Limitations

The STM32 HAL provides `HAL_UART_Receive_IT(&huart2, buf, len)`, which sets up an RXNE interrupt internally and copies exactly `len` bytes into `buf`, then calls `HAL_UART_RxCpltCallback()`. This has significant limitations for production use:

- **Fixed-length only**: the reception length must be known in advance. Variable-length protocols (Modbus RTU, NMEA, custom framing) cannot use this directly.
- **Gap between completions**: after the callback fires, there is a window before `HAL_UART_Receive_IT()` is called again during which incoming bytes are lost.
- **No IDLE detection**: the HAL RXNE path does not integrate IDLE line detection, so packet boundaries must be determined by other means.
- **Single-buffer**: only one reception can be active at a time; double-buffering requires manual management.

For these reasons, production firmware frequently bypasses the HAL receive path and implements direct RXNE + ring buffer handling while still using the HAL for transmit (which has fewer pitfalls).

## Error Flag Handling

UART reception generates four error flags that must be handled in the ISR to prevent lockups:

| Flag | Name | Cause | Consequence if Ignored |
|------|------|-------|----------------------|
| ORE  | Overrun Error | New byte arrived before previous was read | RXNE stops firing; all subsequent data lost |
| FE   | Framing Error | Stop bit not detected | Corrupted byte delivered |
| NE   | Noise Error | Noise detected during sampling | Byte may be incorrect |
| PE   | Parity Error | Parity check failed | Byte is corrupted |

On STM32F4, error flags are cleared by reading SR followed by DR — the same read that retrieves the data byte. On STM32H7/G4/L4, each error flag has a dedicated clear bit in USART_ICR (e.g., `USART_ICR_ORECF`), and the error flags do not require reading the data register to clear.

ORE is the most dangerous: once set, the USART stops generating RXNE interrupts until ORE is cleared. A common production bug is an ISR that only handles RXNE — if an overrun occurs (even once), reception permanently stops with no visible error.

```c
/* STM32H7 / G4 / L4 error clearing */
if (USART2->ISR & USART_ISR_ORE) {
    USART2->ICR = USART_ICR_ORECF;  /* Clear overrun */
    /* Log or count the error */
    overrun_count++;
}
```

## Buffer Sizing

The ring buffer must be large enough to hold all bytes that arrive between main-loop processing cycles. The calculation depends on baud rate and worst-case main-loop latency:

```
bytes_per_second = baud_rate / 10  (8 data + 1 start + 1 stop)
buffer_size = bytes_per_second * max_processing_delay_seconds
```

At 115200 baud with a main loop that may stall for 50 ms (e.g., an SPI flash write):

```
11,520 bytes/sec * 0.050 sec = 576 bytes → round up to 1024 (next power of 2)
```

At 921600 baud with a 10 ms worst-case delay:

```
92,160 bytes/sec * 0.010 sec = 922 bytes → round up to 1024
```

Under-sizing the buffer does not produce an error — bytes are silently dropped when the buffer overflows, which appears as missing data in the protocol layer.

## Tips

- Always size the ring buffer as a power of 2 — this enables the bitmask index wrapping and avoids a division inside the ISR
- Handle ORE in every UART ISR, even during early development — an unhandled overrun permanently disables RXNE interrupts, and the symptom (reception stops) looks identical to a hardware wiring fault
- Set the UART interrupt priority lower (higher number) than timing-critical interrupts like motor control or ADC — UART can tolerate a few microseconds of latency; a missed motor commutation step cannot
- Use the IDLE interrupt for packet boundary detection in any variable-length protocol — it eliminates the need for byte-level timeouts in the main loop
- Declare the ring buffer indices as `volatile` — the compiler may otherwise optimize away reads of `rx_head` in the main loop, since it does not see the ISR modifying the variable

## Caveats

- **ORE permanently stops RXNE if not cleared** — This is the single most common UART interrupt bug. The overrun flag gates further RXNE interrupts, so a single missed byte (during a higher-priority interrupt, for example) disables reception entirely until firmware explicitly clears ORE
- **HAL_UART_Receive_IT has a reception gap** — Between the completion callback and the next call to `HAL_UART_Receive_IT()`, any arriving bytes trigger ORE because no reception is active. At 115200 baud, a single byte arrives every 87 us — a tight window that is easily missed
- **Ring buffer overflow is silent** — When the buffer is full, new bytes are discarded with no error flag, no interrupt, and no indication. The protocol layer sees truncated or missing messages with no explanation
- **IDLE fires once per gap, not once per packet** — If the transmitter pauses mid-packet (e.g., due to its own interrupt latency), the IDLE interrupt fires at the pause, splitting one logical packet into two IDLE events. Protocol framing must tolerate this
- **Clearing error flags incorrectly on STM32F4 can lose a data byte** — The F4 clears error flags by reading SR then DR, which also consumes the pending data byte. On H7/G4/L4 families with separate ICR clear registers, this problem does not exist

## In Practice

- UART reception that works for minutes and then permanently stops — with no further RXNE interrupts — almost always indicates an unhandled ORE condition. The overrun typically occurs during a brief period of high interrupt load (DMA completion, timer burst), where the UART ISR is delayed long enough for two bytes to arrive. A diagnostic counter on ORE events reveals the exact moment reception fails.

- Missing bytes at the start of a message, while the rest of the message arrives correctly, often points to the HAL `Receive_IT` gap. The first 1-2 bytes of a new packet arrive before the firmware re-arms reception in the completion callback. Switching to a persistent ring buffer with continuous RXNE handling eliminates this symptom.

- A protocol parser that occasionally receives messages split into two fragments — each fragment parsed independently and rejected — is likely seeing spurious IDLE events caused by transmitter-side jitter. Adding a minimum inter-packet gap check (e.g., ignore IDLE if fewer than N bytes have arrived since the last IDLE) filters these false boundaries.

- At high baud rates (1 Mbaud+), increasing the ring buffer size beyond what the rate calculation suggests is often necessary because main-loop jitter introduces unpredictable delays. A buffer that handles the average case but not the worst case produces intermittent data loss that appears random and is difficult to reproduce.
