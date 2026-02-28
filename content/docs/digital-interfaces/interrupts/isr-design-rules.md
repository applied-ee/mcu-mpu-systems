---
title: "ISR Design Rules"
weight: 20
---

# ISR Design Rules

An interrupt service routine (ISR) runs in exception context with elevated privileges and a hard constraint: every cycle spent inside the handler is a cycle that no other equal-or-lower-priority interrupt can execute. The fundamental design rule is to do the minimum work necessary — capture the event, copy the data, clear the flag — and defer everything else to the main loop or an RTOS task. Violating this rule produces systems that appear to work on the bench but fail under load, miss deadlines, or corrupt shared state in ways that only surface weeks into deployment.

## The Flag-and-Defer Pattern

The most reliable ISR architecture on bare-metal Cortex-M systems is flag-and-defer: the ISR sets a flag or copies data into a buffer, and the main loop polls the flag and performs the actual processing. This minimizes ISR execution time and keeps complex logic — parsing, state machines, protocol handling — in a context where blocking, allocation, and full library calls are safe.

```c
/* Shared flag — must be volatile */
volatile uint8_t uart_rx_ready = 0;
volatile uint8_t uart_rx_byte;

void USART1_IRQHandler(void) {
    if (USART1->SR & USART_SR_RXNE) {
        uart_rx_byte = (uint8_t)(USART1->DR & 0xFF);  /* Read clears RXNE flag */
        uart_rx_ready = 1;
    }
}

int main(void) {
    /* ... init ... */
    while (1) {
        if (uart_rx_ready) {
            uart_rx_ready = 0;
            process_received_byte(uart_rx_byte);
        }
        /* Other main loop work */
    }
}
```

For higher-throughput peripherals, a ring buffer replaces the single-byte variable. The ISR writes to the head, the main loop reads from the tail, and no lock is required as long as the head and tail indices are updated atomically (single 32-bit write on Cortex-M3/M4, naturally atomic):

```c
#define RX_BUF_SIZE 128
volatile uint8_t rx_buf[RX_BUF_SIZE];
volatile uint32_t rx_head = 0;
uint32_t rx_tail = 0;  /* Only accessed from main loop — no volatile needed */

void USART1_IRQHandler(void) {
    if (USART1->SR & USART_SR_RXNE) {
        uint32_t next = (rx_head + 1) % RX_BUF_SIZE;
        if (next != rx_tail) {  /* Buffer not full */
            rx_buf[rx_head] = (uint8_t)(USART1->DR & 0xFF);
            rx_head = next;
        } else {
            (void)USART1->DR;  /* Discard byte, but still read DR to clear RXNE */
        }
    }
}
```

## What Never Belongs in an ISR

Certain operations are incompatible with exception context. **`HAL_Delay()`** spins on the SysTick counter, but if the ISR runs at a priority equal to or higher than SysTick, the tick never increments and the delay becomes an infinite loop. **`printf()`** and formatted I/O use heap allocation, are non-reentrant, and can take milliseconds to execute — a single `printf` in a 1 kHz timer ISR consumes the entire CPU budget. **`malloc()` and `free()`** are not reentrant; calling them from an ISR while the main loop is mid-allocation corrupts the heap metadata. **Floating-point math** on Cortex-M4F triggers automatic FPU context stacking (lazy stacking), adding up to 72 bytes of stack usage and additional cycles; on Cortex-M0 (no FPU), soft-float operations in an ISR can take hundreds of cycles.

```c
/* BAD — every one of these calls is unsafe in ISR context */
void TIM2_IRQHandler(void) {
    HAL_TIM_IRQHandler(&htim2);
    printf("Timer fired at %lu ms\n", HAL_GetTick());  /* Non-reentrant, slow */
    HAL_Delay(1);                                        /* Deadlocks if TIM2 >= SysTick prio */
    char *buf = malloc(64);                              /* Heap corruption risk */
    free(buf);
}

/* GOOD — set a flag, process in main loop */
volatile uint8_t tim2_flag = 0;

void TIM2_IRQHandler(void) {
    if (__HAL_TIM_GET_FLAG(&htim2, TIM_FLAG_UPDATE)) {
        __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
        tim2_flag = 1;
    }
}
```

## Clearing Interrupt Flags

Interrupt flags must be cleared inside the ISR, and on most STM32 peripherals, clearing should happen **before** performing any processing. Peripheral interrupt flags (in the peripheral's status register) are distinct from the NVIC pending bit. The peripheral flag is what originally triggered the NVIC pending bit, and if the peripheral flag is still set when the ISR returns, the NVIC re-pends the interrupt and the ISR fires again immediately. On STM32, many status flags are cleared by writing 1 to the corresponding bit in a clear register, or by reading the data register (e.g., USART DR read clears RXNE).

```c
void EXTI0_IRQHandler(void) {
    /* Clear the EXTI pending bit FIRST */
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_0);

    /* Now set the flag for main loop processing */
    exti0_event = 1;
}
```

A subtle timing issue arises from the write buffer on Cortex-M3/M4/M7: the write to clear the flag enters the write buffer but may not reach the peripheral register before the ISR's return instruction. The NVIC checks the pending state during exception return, and if the clear has not propagated, the ISR re-enters. A Data Synchronization Barrier (`__DSB()`) after the clear forces the write to complete before proceeding. This issue is documented in several STM32 errata sheets and ARM application notes:

```c
void EXTI0_IRQHandler(void) {
    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_0);
    __DSB();  /* Ensure flag clear reaches peripheral before ISR exit */
    exti0_event = 1;
}
```

## Tail-Chaining

Cortex-M processors implement tail-chaining: when one ISR completes and another interrupt of equal or higher priority is pending, the processor skips the full unstacking/restacking sequence and enters the next handler directly. This saves 12 cycles on Cortex-M3/M4 (compared to ~24 cycles for a full exception entry). Tail-chaining is automatic and invisible to firmware, but it means that a burst of interrupts at the same priority executes back-to-back with no main-loop execution in between. If the main loop is responsible for watchdog refresh, a sustained burst of interrupts at the same priority can starve the main loop and trigger a watchdog reset.

## ISR Execution Time Measurement

Measuring actual ISR duration is critical for validating timing budgets. The simplest method uses a GPIO pin toggled at ISR entry and exit, observed with an oscilloscope or logic analyzer:

```c
void TIM2_IRQHandler(void) {
    GPIOA->BSRR = GPIO_PIN_5;           /* Set PA5 high — ISR entry */
    __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
    /* ... ISR work ... */
    GPIOA->BSRR = GPIO_PIN_5 << 16;     /* Set PA5 low — ISR exit */
}
```

On Cortex-M3/M4/M7, the DWT cycle counter (DWT->CYCCNT) provides cycle-accurate measurement without external instruments. Enable it once at startup, then sample it inside the ISR:

```c
/* Enable DWT cycle counter — once at startup */
CoreDebug->DEMCR |= CoreDebug_DEMCR_TRCENA_Msk;
DWT->CYCCNT = 0;
DWT->CTRL |= DWT_CTRL_CYCCNTENA_Msk;

/* Inside ISR */
volatile uint32_t isr_cycles;

void TIM2_IRQHandler(void) {
    uint32_t start = DWT->CYCCNT;
    __HAL_TIM_CLEAR_FLAG(&htim2, TIM_FLAG_UPDATE);
    /* ... ISR work ... */
    isr_cycles = DWT->CYCCNT - start;
}
```

At 168 MHz (STM32F407), 1000 cycles is approximately 6 microseconds. A general guideline: ISRs should complete in under 1 microsecond for high-frequency interrupts (100 kHz+), under 10 microseconds for medium-frequency interrupts (1-10 kHz), and under 100 microseconds for low-frequency interrupts (< 100 Hz). These are starting points — the real constraint is whether the ISR meets its deadline without starving lower-priority handlers.

## RTOS Considerations

In a FreeRTOS environment, the flag-and-defer pattern uses RTOS primitives instead of bare flags. `xSemaphoreGiveFromISR()` unblocks a waiting task, and `xQueueSendFromISR()` passes data from the ISR to a task. Both functions accept a `pxHigherPriorityTaskWoken` parameter that must be checked to request a context switch if the unblocked task has higher priority than the currently running task:

```c
void USART1_IRQHandler(void) {
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

    if (USART1->SR & USART_SR_RXNE) {
        uint8_t byte = (uint8_t)(USART1->DR & 0xFF);
        xQueueSendFromISR(uart_rx_queue, &byte, &xHigherPriorityTaskWoken);
    }

    portYIELD_FROM_ISR(xHigherPriorityTaskWoken);
}
```

The non-`FromISR` variants (`xSemaphoreGive`, `xQueueSend`) must never be called from ISR context — they check and manipulate scheduler internals that assume task-level execution and will corrupt the scheduler state.

## Tips

- Target a maximum ISR body of 10-20 lines of C; if the handler needs more, it is doing too much — move the logic to a deferred handler.
- Always clear the peripheral interrupt flag before doing any work in the ISR, and add `__DSB()` after the clear on Cortex-M3/M4/M7 to prevent re-entry from write-buffer latency.
- Use DWT->CYCCNT to profile ISR duration during development — what feels short in source code can be surprisingly long after compiler expansion and HAL overhead.
- In FreeRTOS, always check `xHigherPriorityTaskWoken` and call `portYIELD_FROM_ISR()` at the end of the ISR — omitting this delays the unblocked task until the next tick, adding up to 1 ms of latency.
- Name ISR functions exactly as defined in the startup assembly file (e.g., `USART1_IRQHandler`, `TIM2_IRQHandler`) — a typo creates a new function that is never called, while the default weak handler (infinite loop) silently remains linked.

## Caveats

- **`HAL_Delay()` in an ISR deadlocks if the ISR priority is >= SysTick priority** — The SysTick handler cannot preempt, so `HAL_GetTick()` never increments and the delay spins forever.
- **The full HAL IRQ handlers (e.g., `HAL_UART_IRQHandler`) call callbacks that may execute substantial code** — Registering a callback that performs parsing or protocol handling puts that work inside ISR context, defeating the flag-and-defer principle.
- **A misspelled ISR name compiles and links without error** — The weak default handler in the startup file absorbs the undefined symbol, so the custom handler never executes and the interrupt either hangs in the default loop or is silently ignored.
- **Ring buffer overflow without consuming the DR register causes persistent RXNE** — If the buffer-full path does not read the data register, the RXNE flag stays set and the ISR fires continuously, starving all lower-priority execution.
- **FPU operations in ISRs on Cortex-M4F trigger lazy context save** — The first floating-point instruction in an ISR causes the processor to stack 18 additional registers (S0-S15 plus FPSCR), adding ~72 bytes of stack usage and significant latency to that exception entry.

## In Practice

- A system that hangs hard when a particular UART message arrives often traces to `HAL_Delay()` or a blocking wait inside the UART receive callback, which deadlocks at ISR priority.
- An ISR that appears to fire twice on every event — observable as double-counted encoder ticks or duplicate entries in a ring buffer — commonly results from the interrupt flag not being cleared before the ISR exits, causing immediate re-entry.
- A FreeRTOS task that responds to interrupts with an extra millisecond of jitter, despite correct priority assignment, is often missing the `portYIELD_FROM_ISR()` call, so the task only wakes on the next SysTick instead of immediately.
- A GPIO debug pin showing 50 microseconds of ISR duration on what should be a simple flag-set handler typically reveals that the `HAL_TIM_IRQHandler()` wrapper is doing callback dispatch, flag checking, and multiple register reads behind the scenes — replacing it with direct register access reduces the time to under 1 microsecond.
- Firmware that works in the debugger but watchdog-resets in free-running mode often has an ISR burst that starves the main loop for longer than the watchdog timeout — the debugger masks this by halting interrupts during single-stepping.
