---
title: "Critical Sections & Interrupt Masking"
weight: 40
---

# Critical Sections & Interrupt Masking

A critical section is a region of code that must execute without interruption — either to protect shared data from concurrent access or to enforce timing guarantees on a sequence of operations. On Cortex-M, critical sections are implemented by masking interrupts: temporarily preventing the processor from responding to interrupt requests while the protected code executes. The cost is interrupt latency — every cycle spent with interrupts disabled is a cycle that incoming interrupts must wait. The design challenge is making critical sections as short as possible while still protecting everything that needs protection.

## PRIMASK: Global Interrupt Disable

The simplest mechanism is PRIMASK, a single-bit register that disables all interrupts with configurable priority (everything except NMI and HardFault). CMSIS provides `__disable_irq()` and `__enable_irq()` which map to the `CPSID i` and `CPSIE i` instructions:

```c
/* Naive critical section — dangerous if interrupts were already disabled */
__disable_irq();
shared_counter++;
__enable_irq();
```

This pattern has a critical flaw: if interrupts were already disabled when this code runs (because a caller already entered a critical section), `__enable_irq()` unconditionally re-enables them, breaking the outer critical section. This leads to subtle, nesting-dependent bugs that only appear when critical sections overlap.

## The Save-and-Restore Pattern

The correct pattern saves the current PRIMASK state before disabling, then restores it afterward. This supports nesting — if interrupts were already disabled, they remain disabled after the inner critical section:

```c
static inline uint32_t critical_enter(void) {
    uint32_t primask = __get_PRIMASK();
    __disable_irq();
    return primask;
}

static inline void critical_exit(uint32_t primask) {
    __set_PRIMASK(primask);
}

/* Usage */
uint32_t state = critical_enter();
/* Protected access to shared data */
shared_counter++;
critical_exit(state);
```

This compiles to four instructions: MRS (read PRIMASK), CPSID (disable), the protected operation, and MSR (restore PRIMASK). Total overhead is approximately 4-6 cycles on Cortex-M4 at 168 MHz — roughly 24-36 nanoseconds. The pattern is safe to nest to any depth, as each level saves and restores independently.

A common macro formulation found in many embedded projects:

```c
#define ENTER_CRITICAL()    uint32_t __irq_state = __get_PRIMASK(); __disable_irq()
#define EXIT_CRITICAL()     __set_PRIMASK(__irq_state)

void update_shared_state(void) {
    ENTER_CRITICAL();
    timestamp = new_timestamp;
    sequence_number++;
    EXIT_CRITICAL();
}
```

## BASEPRI: Selective Interrupt Masking

PRIMASK is a sledgehammer — it disables all maskable interrupts, including ones that have nothing to do with the data being protected. **BASEPRI** (available on Cortex-M3/M4/M7, but **not** Cortex-M0/M0+) provides finer control: it masks all interrupts with a priority value equal to or greater than the threshold, while allowing higher-priority interrupts to continue firing.

```c
/* Mask interrupts with priority >= 4 (on STM32 with 4-bit priority, upper nibble) */
static inline uint32_t critical_enter_basepri(uint32_t priority) {
    uint32_t old_basepri = __get_BASEPRI();
    __set_BASEPRI(priority << 4);  /* Shift to upper nibble for 4-bit implementation */
    return old_basepri;
}

static inline void critical_exit_basepri(uint32_t old_basepri) {
    __set_BASEPRI(old_basepri);
}

/* Usage: protect against interrupts at priority 4 and below,
   but allow priorities 0-3 to continue firing */
uint32_t saved = critical_enter_basepri(4);
update_motor_state();
critical_exit_basepri(saved);
```

Setting BASEPRI to 0 disables the masking (allows all interrupts). Setting it to N masks all interrupts with priority N or lower (remember: lower numeric priority = higher urgency, so BASEPRI masks the **less urgent** interrupts).

The advantage is that time-critical interrupts — a motor commutation timer at priority 1 or a safety shutdown at priority 0 — continue to be serviced even while the critical section protects data shared with a UART ISR at priority 6. The worst-case latency for the high-priority interrupt is unaffected by the critical section.

## BASEPRI vs PRIMASK: When to Use Each

| Criterion | PRIMASK | BASEPRI |
|---|---|---|
| Availability | All Cortex-M (M0, M0+, M3, M4, M7) | Cortex-M3, M4, M7 only |
| Masking scope | All maskable interrupts | Only interrupts at or below threshold |
| High-priority interrupt latency | Blocked for full critical section duration | Unaffected (if above threshold) |
| Implementation complexity | Minimal (save/restore one register) | Requires understanding of priority scheme |
| FreeRTOS usage | `taskENTER_CRITICAL()` uses BASEPRI | `taskENTER_CRITICAL_FROM_ISR()` uses BASEPRI |

For RP2040 (Cortex-M0+), BASEPRI is unavailable, and PRIMASK is the only option. On STM32F4/H7, BASEPRI is preferred for any system where interrupt latency matters.

## FreeRTOS Critical Sections

FreeRTOS provides its own critical section API that uses BASEPRI (on Cortex-M3+) rather than PRIMASK. `taskENTER_CRITICAL()` sets BASEPRI to `configMAX_SYSCALL_INTERRUPT_PRIORITY` (typically priority 5 on STM32 with 4-bit priority), which masks all interrupts that are allowed to call FreeRTOS API functions while leaving higher-priority interrupts (0-4) unmasked:

```c
/* Task-level critical section */
taskENTER_CRITICAL();
/* Access shared resource — all FreeRTOS-managed interrupts are masked */
shared_data.field1 = value1;
shared_data.field2 = value2;
taskEXIT_CRITICAL();
```

For use inside an ISR, the save-and-restore variant is required:

```c
void USART1_IRQHandler(void) {
    UBaseType_t saved = taskENTER_CRITICAL_FROM_ISR();
    /* Access shared data safely */
    shared_data.field1 = new_value;
    taskEXIT_CRITICAL_FROM_ISR(saved);
}
```

FreeRTOS supports nesting — `taskENTER_CRITICAL()` increments an internal nesting counter, and interrupts are only re-enabled when the outermost `taskEXIT_CRITICAL()` decrements it back to zero. The `_FROM_ISR` variant uses the BASEPRI save-and-restore pattern directly.

A critical architectural requirement: interrupts at priorities 0 through `configMAX_SYSCALL_INTERRUPT_PRIORITY - 1` (the "above FreeRTOS" range) must **never** call any FreeRTOS API function, and FreeRTOS critical sections do not protect against them. Data shared with these high-priority ISRs requires separate protection — either its own BASEPRI-based critical section with a higher threshold or PRIMASK.

## Measuring Critical Section Impact

The interrupt latency added by a critical section equals its worst-case execution time. Measuring this follows the same approach as ISR timing — toggle a GPIO at entry and exit, or use DWT->CYCCNT:

```c
volatile uint32_t max_critical_cycles = 0;

uint32_t state = critical_enter();
uint32_t start = DWT->CYCCNT;

/* Protected operations */
update_shared_buffer();

uint32_t elapsed = DWT->CYCCNT - start;
if (elapsed > max_critical_cycles) {
    max_critical_cycles = elapsed;
}
critical_exit(state);
```

On a 168 MHz STM32F407, 100 cycles of critical section duration adds ~0.6 microseconds of worst-case latency. For a system with a 10 kHz control loop interrupt (100 microsecond period), critical sections under 500 cycles (3 microseconds) are generally acceptable. For USB full-speed operation, the SOF interrupt must be serviced within 1 microsecond, setting a hard ceiling on critical section duration in USB-active firmware.

## SVC and PendSV for Deferred Processing

When an ISR needs to trigger complex processing that is too long for ISR context but cannot wait for the main loop, PendSV provides a hardware-supported deferred execution mechanism. PendSV is typically configured at the lowest interrupt priority, so it runs only after all other pending interrupts are serviced:

```c
/* Set PendSV priority to lowest level */
NVIC_SetPriority(PendSV_IRQn, 15);

/* Inside a high-priority ISR — request deferred processing */
void TIM1_UP_TIM10_IRQHandler(void) {
    __HAL_TIM_CLEAR_FLAG(&htim1, TIM_FLAG_UPDATE);
    capture_adc_sample();  /* Fast — copy one value */
    SCB->ICSR |= SCB_ICSR_PENDSVSET_Msk;  /* Trigger PendSV */
}

/* PendSV runs at lowest priority — safe for longer processing */
void PendSV_Handler(void) {
    process_adc_batch();   /* Filter, average, update control loop */
}
```

This pattern is how FreeRTOS implements context switching — the scheduler sets PendSV pending, and the actual stack swap happens in the PendSV handler after all higher-priority ISRs have completed. In bare-metal designs, PendSV serves the same purpose: a hardware-enforced deferred processing context that runs at a known priority level.

SVC (Supervisor Call) is a synchronous exception triggered by the `SVC` instruction. It is less commonly used for deferred processing and more typically used in RTOS kernels for system calls (switching from unprivileged to privileged mode). In bare-metal designs, PendSV is the preferred mechanism for interrupt-triggered deferred work.

## Nested Critical Section Pitfalls

Even with save-and-restore, critical sections can interact poorly when they involve different masking strategies. A function that uses BASEPRI-based masking called from within a PRIMASK-based critical section works correctly (the PRIMASK already blocks everything, and restoring BASEPRI inside does not re-enable anything). The reverse — a PRIMASK critical section inside a BASEPRI critical section — also works but briefly escalates to full interrupt disable, which may violate the intent of using BASEPRI.

The worst case is mixing `taskENTER_CRITICAL()` (which uses BASEPRI) with `__disable_irq()` (PRIMASK) in the same call chain. If code within a FreeRTOS critical section calls a library function that uses `__disable_irq()` / `__enable_irq()` internally, the `__enable_irq()` clears PRIMASK, but BASEPRI is still set — interrupts above the BASEPRI threshold become active, which may be correct or may violate assumptions the calling code makes about atomicity.

## Tips

- Use the save-and-restore pattern (`__get_PRIMASK()` / `__set_PRIMASK()`) exclusively — never pair `__disable_irq()` with `__enable_irq()` directly, as this breaks nesting.
- Prefer BASEPRI over PRIMASK on Cortex-M3+ whenever time-critical interrupts exist — motor control, safety shutdowns, and high-speed communication should never be blocked by a critical section protecting low-priority data.
- Keep critical sections under 50 instructions; if more work is needed, copy the shared data inside the critical section and process the copy outside.
- In FreeRTOS projects, use `taskENTER_CRITICAL()` / `taskEXIT_CRITICAL()` for all shared-data protection — these properly track nesting and use BASEPRI, maintaining the RTOS interrupt contract.
- Use PendSV for deferred processing in bare-metal systems rather than trying to signal the main loop — PendSV has deterministic timing and does not depend on main-loop polling rate.

## Caveats

- **`__disable_irq()` followed by `__enable_irq()` breaks nested critical sections** — The inner `__enable_irq()` re-enables interrupts unconditionally, even if an outer critical section expects them to remain disabled; this produces intermittent data corruption that depends on call nesting depth.
- **BASEPRI is not available on Cortex-M0/M0+** — Firmware written for STM32F4 using BASEPRI-based critical sections faults or silently fails when ported to RP2040; the only option on M0 is PRIMASK.
- **FreeRTOS critical sections do not protect against interrupts above `configMAX_SYSCALL_INTERRUPT_PRIORITY`** — Data shared with an ISR at priority 2 (above the FreeRTOS threshold of 5) is not protected by `taskENTER_CRITICAL()` and requires a separate BASEPRI or PRIMASK guard.
- **Long critical sections cause missed interrupts, not dropped interrupts** — The NVIC latches pending interrupts while masked, so they fire on exit; but if the same interrupt fires multiple times during the critical section, all but the last occurrence are lost because only one pending bit exists per source.
- **Measuring critical section duration with DWT inside the section adds measurement overhead** — The DWT reads add 2-4 cycles; for very short critical sections (< 10 cycles), this is a significant fraction of the measurement and skews the result.

## In Practice

- A system that exhibits occasional data corruption — a shared structure with fields that sometimes contain values from different update cycles — commonly traces to a missing critical section around multi-word writes that an ISR can interrupt between individual stores.
- An RTOS-based design where a high-priority motor control ISR occasionally misses its deadline, despite having the highest interrupt priority, often reveals `__disable_irq()` calls buried in a third-party library (sensor driver, file system) that block the ISR for the duration of a flash write or SPI transaction.
- A bare-metal system that sporadically loses encoder counts under heavy communication load typically has a shared counter incremented by the encoder ISR and read by the main loop without protection — the main loop's non-atomic read-modify-write overwrites the ISR's increment. Adding a 4-cycle critical section around the main-loop access resolves it.
- Firmware that works when a single peripheral is active but fails when multiple peripherals generate interrupts simultaneously often has critical sections implemented with `__disable_irq()` / `__enable_irq()` pairs that break when a higher-priority ISR calls into the same protected function — switching to save-and-restore eliminates the issue.
- A system with USB communication that drops packets under CPU load commonly has critical sections exceeding the USB SOF tolerance (~1 microsecond) — profiling with DWT->CYCCNT reveals a 200-cycle memcpy inside a PRIMASK-guarded section; moving the copy outside and protecting only the pointer swap reduces the critical section to 8 cycles.
