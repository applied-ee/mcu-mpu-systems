---
title: "NVIC Configuration & Priority Grouping"
weight: 10
---

# NVIC Configuration & Priority Grouping

The Nested Vectored Interrupt Controller (NVIC) is the hardware block on every ARM Cortex-M processor that arbitrates between interrupt sources, determines which handler runs next, and manages preemption. On STM32F4 and STM32H7 devices, the NVIC implements 4 priority bits per interrupt, yielding 16 priority levels (0-15). Understanding how those bits divide between preemption priority and sub-priority — and what that division means for real-time behavior — is essential to building firmware that responds deterministically under load.

## Vector Table and IRQn_Type

The vector table is an array of 32-bit function pointers stored at the base of flash (typically 0x08000000 on STM32). The first two entries are the initial stack pointer and the Reset_Handler address. Entries 16 onward correspond to vendor-specific peripheral interrupts. Each interrupt source has an IRQ number defined in the device header as an `IRQn_Type` enum — for example, `USART1_IRQn` is 37 on STM32F407, `TIM2_IRQn` is 28, and `EXTI0_IRQn` is 6. System exceptions (SysTick, PendSV, SVCall) use negative IRQ numbers in CMSIS convention.

The vector table can be relocated at runtime by writing a new base address to the VTOR register (SCB->VTOR). This is common when a bootloader hands off to an application stored at an offset in flash — the application must set VTOR to its own vector table address before enabling any interrupts:

```c
/* Relocate vector table for application starting at 0x08010000 */
SCB->VTOR = 0x08010000;
__DSB();
__ISB();
```

## Priority Bits and Levels

ARM Cortex-M defines up to 8 priority bits per interrupt, but silicon vendors implement only a subset. STM32F4, STM32H7, and most STM32 families implement 4 bits, stored in the upper nibble of the 8-bit priority field. This gives 16 usable priority levels: 0 (highest priority) through 15 (lowest priority). The RP2040 (dual Cortex-M0+) implements only 2 bits, giving 4 priority levels (0, 64, 128, 192 in the raw register, or 0-3 when expressed as logical levels). The ESP32 uses a Xtensa or RISC-V core with a different interrupt architecture entirely and does not use the NVIC.

**Lower numeric value means higher priority.** Priority 0 preempts everything; priority 15 yields to all others. This convention catches many developers off guard, especially those coming from RTOS task priority schemes where higher numbers typically mean higher priority.

## Priority Grouping

The 4 implemented priority bits can be split between **preemption priority** (group priority) and **sub-priority**. Preemption priority determines whether one interrupt can interrupt another that is already executing. Sub-priority only breaks ties when two interrupts of the same preemption priority are pending simultaneously — the one with the lower sub-priority runs first, but neither can preempt the other.

The grouping is set globally via `NVIC_SetPriorityGrouping()` or `HAL_NVIC_SetPriorityGrouping()` and applies to all interrupts. On STM32 with 4 implemented bits, the practical configurations are:

| Grouping Constant | Preemption Bits | Sub-Priority Bits | Preemption Levels | Sub-Priority Levels |
|---|---|---|---|---|
| `NVIC_PRIORITYGROUP_4` | 4 | 0 | 16 | 1 |
| `NVIC_PRIORITYGROUP_3` | 3 | 1 | 8 | 2 |
| `NVIC_PRIORITYGROUP_2` | 2 | 2 | 4 | 4 |
| `NVIC_PRIORITYGROUP_1` | 1 | 3 | 2 | 8 |
| `NVIC_PRIORITYGROUP_0` | 0 | 4 | 1 | 16 |

STM32 HAL defaults to `NVIC_PRIORITYGROUP_4` (all 4 bits as preemption priority, no sub-priority), and FreeRTOS on STM32 requires this configuration. Changing the grouping after interrupts are enabled produces unpredictable behavior because existing priority values are reinterpreted under the new split.

```c
/* Set priority grouping — do this once, early in main(), before enabling interrupts */
HAL_NVIC_SetPriorityGrouping(NVIC_PRIORITYGROUP_4);
```

## Setting Interrupt Priority

CMSIS provides `NVIC_SetPriority()` and `NVIC_EncodePriority()`. The STM32 HAL wraps these as `HAL_NVIC_SetPriority()`:

```c
/* CMSIS direct — set USART1 to preemption priority 5, sub-priority 0 */
NVIC_SetPriority(USART1_IRQn, NVIC_EncodePriority(NVIC_GetPriorityGrouping(), 5, 0));
NVIC_EnableIRQ(USART1_IRQn);

/* HAL equivalent */
HAL_NVIC_SetPriority(USART1_IRQn, 5, 0);
HAL_NVIC_EnableIRQ(USART1_IRQn);
```

With `NVIC_PRIORITYGROUP_4`, the sub-priority parameter is ignored — passing anything other than 0 has no effect but is not flagged as an error. The priority value is written to the upper nibble of the interrupt priority register, so a logical priority of 5 becomes 0x50 in the raw register on a 4-bit implementation.

## Preemption Behavior

When a higher-priority interrupt fires while a lower-priority ISR is executing, the processor stacks the current context and immediately enters the higher-priority handler. The preempted ISR resumes only after the higher-priority handler completes. This nesting is automatic and limited only by available stack space — each nested exception pushes an additional 32 bytes (8 registers) onto the stack, plus any additional stacking for FPU context (an extra 72 bytes on Cortex-M4F if the lazy stacking threshold is exceeded).

Interrupts at the same preemption priority level never preempt each other, regardless of sub-priority. If both are pending, sub-priority determines the order of execution. If both preemption and sub-priority are equal, the interrupt with the lower IRQ number runs first (lower IRQn has higher hardware-level tie-breaking priority).

## Priority Inversion Scenarios

Priority inversion in the interrupt context occurs when a high-priority ISR is effectively blocked by lower-priority code. The classic case involves shared resources: a low-priority ISR acquires a resource (holds a lock flag), gets preempted by a medium-priority ISR that runs for a long time, and the high-priority ISR must wait for the low-priority ISR to release the resource — but the low-priority ISR cannot resume because the medium-priority ISR is running. Unlike RTOS tasks where priority inheritance can mitigate inversion, bare-metal ISR priority inversion has no automatic solution. The defense is structural: avoid sharing resources between ISRs at different priority levels, or protect them with interrupt masking using BASEPRI.

Another subtle form occurs when too many interrupts are assigned the same preemption priority. With `NVIC_PRIORITYGROUP_4`, assigning priority 5 to both a time-critical motor commutation interrupt and a slow UART receive interrupt means neither can preempt the other — a burst of UART data can delay motor commutation by the full execution time of the UART ISR.

## Enabling and Disabling Interrupts

`NVIC_EnableIRQ()` and `HAL_NVIC_EnableIRQ()` set the corresponding bit in the NVIC_ISER register. `NVIC_DisableIRQ()` sets the bit in NVIC_ICER. A pending interrupt that arrives while disabled is latched and fires immediately upon re-enable. Clearing a pending interrupt without servicing it requires `NVIC_ClearPendingIRQ()`:

```c
/* Disable EXTI0, clear any pending flag, then re-enable */
NVIC_DisableIRQ(EXTI0_IRQn);
NVIC_ClearPendingIRQ(EXTI0_IRQn);
/* ... reconfigure the EXTI trigger ... */
NVIC_EnableIRQ(EXTI0_IRQn);
```

Failing to clear the pending bit after disabling an interrupt is a common source of unexpected ISR entry — the interrupt fires the instant it is re-enabled, even if the original trigger condition is gone.

## Tips

- Set the priority grouping once at the top of `main()`, before `HAL_Init()` if possible — changing it after interrupts are configured silently reinterprets all existing priority values.
- Use `NVIC_PRIORITYGROUP_4` (all preemption, no sub-priority) unless there is a specific need for tie-breaking behavior; this is the simplest model and the one FreeRTOS requires.
- Reserve priority 0 for only the most critical interrupt (e.g., a motor commutation timer or safety shutdown) — if everything is priority 0, nothing can preempt anything.
- Assign priorities in bands: safety-critical at 0-1, time-sensitive peripherals at 2-5, communication at 6-10, and background housekeeping at 11-15.
- When using FreeRTOS on STM32, all interrupts that call any FreeRTOS `FromISR` API must have a priority value equal to or numerically greater than `configMAX_SYSCALL_INTERRUPT_PRIORITY` (typically 5) — interrupts at 0-4 must never call FreeRTOS functions.

## Caveats

- **Priority 0 assigned by default can mask real priority schemes** — Uninitialized NVIC priority registers read as 0 (highest priority), so any interrupt enabled without an explicit `NVIC_SetPriority()` call runs at the highest level and can preempt everything.
- **Sub-priority does not enable preemption** — Two interrupts with the same preemption priority but different sub-priorities never preempt each other; sub-priority only affects pending-order when both are waiting.
- **FreeRTOS asserts fire on wrong priority grouping** — If the grouping is not `NVIC_PRIORITYGROUP_4`, FreeRTOS `configASSERT` macros in `port.c` trigger during scheduler start, producing a fault that looks unrelated to interrupt configuration.
- **Priority values on Cortex-M0/M0+ use only 2 bits** — Code that works on STM32F4 with priority 12 fails on RP2040 because only values 0-3 (in 2-bit logical terms) are valid; higher values are silently truncated.
- **Changing priority of an active interrupt is undefined** — Modifying the priority of an interrupt whose ISR is currently executing produces implementation-defined behavior on Cortex-M; disable the interrupt first, change priority, then re-enable.

## In Practice

- A system where every interrupt appears to run at the same priority — motor control, UART, ADC, and SysTick all preempting each other unpredictably — often traces back to never calling `NVIC_SetPriority()` and relying on the default of 0 for all sources.
- A FreeRTOS application that hard-faults on `xQueueSendFromISR()` with no obvious memory corruption is commonly caused by calling that function from an ISR with priority 0-4 (above `configMAX_SYSCALL_INTERRUPT_PRIORITY`), violating the FreeRTOS interrupt priority contract.
- An interrupt that fires immediately after being re-enabled, even though the external trigger is no longer asserted, indicates a latched pending bit in the NVIC that was not cleared with `NVIC_ClearPendingIRQ()` before re-enabling.
- A motor control ISR that occasionally misses its deadline under heavy UART traffic, despite having a higher priority number, often results from both interrupts sharing the same preemption priority — the higher number does not mean higher priority; it means lower priority.
- Firmware that works on an STM32F407 Nucleo but faults on an RP2040-based board after porting often shows priority values above 3, which exceed the 2-bit priority range on Cortex-M0+ — the truncated values create an unintended priority map.
