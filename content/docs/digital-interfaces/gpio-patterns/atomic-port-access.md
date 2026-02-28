---
title: "Atomic Port Access & Bit-Banding"
weight: 20
---

# Atomic Port Access & Bit-Banding

Setting or clearing a GPIO pin seems trivial — until an interrupt fires between the read and the write. The read-modify-write pattern that every C programmer reaches for (`GPIOA->ODR |= (1 << 5)`) is a concurrency hazard on any system where interrupts can touch the same port. ARM Cortex-M provides two hardware mechanisms to eliminate this: set/clear registers (BSRR) and bit-banding. Understanding when each applies — and what replaces them on newer cores — prevents race conditions that produce intermittent glitches no debugger can catch.

## The Read-Modify-Write Hazard

Consider toggling two pins on the same port — PA5 from the main loop and PA6 from a timer ISR:

```c
// Main loop — set PA5
GPIOA->ODR |= (1 << 5);   // Compiles to: LDR r0, [GPIOA_ODR]
                            //              ORR r0, r0, #(1<<5)
                            //              STR r0, [GPIOA_ODR]

// Timer ISR — set PA6
void TIM2_IRQHandler(void) {
    GPIOA->ODR |= (1 << 6);
}
```

If the ISR fires between the LDR and STR in the main loop, the ISR's write to PA6 is lost. The main loop's STR writes back a stale copy of ODR that does not include the ISR's modification. The result: PA6 glitches low for one loop iteration. This is not theoretical — at 168 MHz on STM32F4, the 3-instruction RMW window is approximately 18 ns wide, and a 1 kHz timer ISR hits it roughly once every 55,000 iterations. Infrequent enough to pass bench testing, frequent enough to cause problems in production.

## BSRR: Hardware-Atomic Set and Clear

The Bit Set/Reset Register (BSRR) on STM32 eliminates RMW entirely. BSRR is a 32-bit write-only register where the lower 16 bits set pins and the upper 16 bits clear pins. A single STR instruction writes the register, and the hardware applies the change atomically — no read step, no interrupt window.

```c
// Set PA5 — write bit 5 in the lower half
GPIOA->BSRR = (1 << 5);

// Clear PA5 — write bit 5 in the upper half (bit 21)
GPIOA->BSRR = (1 << (5 + 16));

// Set PA5 and clear PA6 simultaneously
GPIOA->BSRR = (1 << 5) | (1 << (6 + 16));
```

The HAL wraps this:

```c
HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_SET);    // Uses BSRR
HAL_GPIO_WritePin(GPIOA, GPIO_PIN_5, GPIO_PIN_RESET);  // Uses BSRR
```

The safe version of the ISR conflict scenario:

```c
// Main loop — safe, single-instruction write
GPIOA->BSRR = (1 << 5);

// Timer ISR — also safe, independent of main loop
void TIM2_IRQHandler(void) {
    GPIOA->BSRR = (1 << 6);
}
```

No read occurs, so no stale data can be stored back. Even if the ISR fires during the main loop's BSRR write, the bus arbiter serializes the two STR instructions without data loss.

Some STM32 families also have BRR (Bit Reset Register), which provides a 16-bit clear-only register — functionally equivalent to writing the upper half of BSRR but slightly more readable in code.

## Bit-Banding on Cortex-M3/M4

Cortex-M3 and Cortex-M4 provide a hardware feature called bit-banding that maps each bit in the peripheral and SRAM regions to a dedicated 32-bit word in an alias region. Writing 0 or 1 to the alias address atomically clears or sets the corresponding bit — the bus hardware performs the RMW internally in a single, uninterruptible cycle.

The alias address formula:

```
alias_addr = alias_base + (byte_offset × 32) + (bit_number × 4)
```

For the peripheral bit-band region:
- **Bit-band base**: 0x40000000
- **Alias base**: 0x42000000

Example — PA5 in ODR (GPIOA base is 0x40020000, ODR offset is 0x14):

```c
#define PERIPH_BB_BASE  0x42000000UL
#define PERIPH_BASE     0x40000000UL

#define BITBAND_PERIPH(addr, bit) \
    (PERIPH_BB_BASE + ((uint32_t)(addr) - PERIPH_BASE) * 32 + (bit) * 4)

// Alias address for GPIOA->ODR bit 5
#define GPIOA_ODR_BB5 \
    (*((volatile uint32_t *)BITBAND_PERIPH(&GPIOA->ODR, 5)))

// Atomic set and clear — single STR instruction each
GPIOA_ODR_BB5 = 1;  // Set PA5
GPIOA_ODR_BB5 = 0;  // Clear PA5
```

Bit-banding also works for reading individual bits without masking:

```c
#define GPIOA_IDR_BB0 \
    (*((volatile uint32_t *)BITBAND_PERIPH(&GPIOA->IDR, 0)))

uint32_t pin_state = GPIOA_IDR_BB0;  // 0 or 1, no masking needed
```

The SRAM bit-band region (base 0x20000000, alias 0x22000000) enables atomic flag manipulation in shared variables between ISRs and the main loop — useful for lock-free signaling without disabling interrupts.

```c
volatile uint32_t flags;  // Must be in first 1 MB of SRAM

#define SRAM_BB_BASE  0x22000000UL
#define SRAM_BASE     0x20000000UL

#define BITBAND_SRAM(addr, bit) \
    (SRAM_BB_BASE + ((uint32_t)(addr) - SRAM_BASE) * 32 + (bit) * 4)

#define FLAG_DATA_READY \
    (*((volatile uint32_t *)BITBAND_SRAM(&flags, 0)))

// ISR sets flag atomically
FLAG_DATA_READY = 1;

// Main loop checks and clears
if (FLAG_DATA_READY) {
    FLAG_DATA_READY = 0;
    process_data();
}
```

## Cortex-M7 and Beyond: No Bit-Banding

Cortex-M7 (used in STM32H7, STM32F7, i.MX RT) does not implement bit-banding. The bit-band alias region is unmapped — accessing it triggers a BusFault. The architectural reason: M7's multi-layer AXI bus and cache system make the single-cycle atomic RMW guarantee impractical.

Alternatives on M7:

- **BSRR/BRR** for GPIO — unchanged, works identically to M3/M4.
- **LDREX/STREX** (exclusive access) for SRAM variables — these load-linked/store-conditional instructions provide atomic RMW at the cost of a retry loop:

```c
static inline void atomic_set_bit(volatile uint32_t *addr, uint32_t bit) {
    uint32_t old_val, new_val;
    do {
        old_val = __LDREXW(addr);
        new_val = old_val | (1 << bit);
    } while (__STREXW(new_val, addr));
}
```

- **Critical sections** (interrupt disable) for short sequences — `__disable_irq()` / `__enable_irq()` is the simplest approach when the RMW takes only a few cycles.

## RP2040 SIO GPIO

The RP2040 takes a different approach entirely. Its GPIO output is controlled through the SIO (Single-cycle I/O) block, which provides separate SET, CLR, and XOR registers:

```c
#include "hardware/gpio.h"

// Direct register access
sio_hw->gpio_set = (1 << 25);    // Set GPIO25 (onboard LED)
sio_hw->gpio_clr = (1 << 25);    // Clear GPIO25
sio_hw->gpio_togl = (1 << 25);   // Toggle GPIO25
```

Each register is write-only and atomic — similar to STM32's BSRR but with a dedicated toggle register that eliminates the need to read current state for XOR operations. The SIO block is specifically designed for single-cycle access from each core, and each core has its own SIO instance, so multi-core GPIO access is inherently safe without locking.

The Pico SDK wraps this:

```c
gpio_put(25, 1);           // Uses SIO set/clr internally
gpio_xor_mask(1 << 25);   // Uses SIO toggle
```

## ESP32 GPIO Atomic Access

ESP32 provides `GPIO_OUT_W1TS_REG` (write-1-to-set) and `GPIO_OUT_W1TC_REG` (write-1-to-clear):

```c
// Direct register — set GPIO18
REG_WRITE(GPIO_OUT_W1TS_REG, (1 << 18));

// Direct register — clear GPIO18
REG_WRITE(GPIO_OUT_W1TC_REG, (1 << 18));

// ESP-IDF API (uses W1TS/W1TC internally)
gpio_set_level(GPIO_NUM_18, 1);
gpio_set_level(GPIO_NUM_18, 0);
```

For GPIOs 32-39 (on base ESP32), separate registers `GPIO_OUT1_W1TS_REG` and `GPIO_OUT1_W1TC_REG` handle the upper pin range.

## Tips

- Default to BSRR (or platform equivalent) for all GPIO writes, not just ISR-shared pins — this eliminates an entire class of bugs proactively and costs nothing in code size or performance.
- Use bit-banding for SRAM flag variables shared between ISRs and the main loop on Cortex-M3/M4 — it avoids the need to disable interrupts for single-bit flag operations.
- Prefer `gpio_put()` on RP2040 and `gpio_set_level()` on ESP32 over direct register writes — the SDK functions handle pin range checks and register selection automatically.
- When toggling a pin for debug timing measurement, use the XOR/toggle register where available (RP2040 SIO, some STM32 via ODR XOR) — it compiles to a single instruction with a constant value, producing the most deterministic timing.
- If porting Cortex-M3/M4 code that uses bit-banding to a Cortex-M7 target, search for all `0x42000000` and `0x22000000` references — these compile and link without error but fault at runtime.

## Caveats

- **ODR read-modify-write is not atomic even with `volatile`** — The `volatile` keyword prevents the compiler from optimizing away the access but does not prevent an interrupt between the load and store instructions; `GPIOA->ODR |= x` is always a 3-instruction sequence.
- **Bit-banding only covers the first 1 MB of SRAM and peripherals** — Variables placed beyond 0x200FFFFF (e.g., in SRAM2 on some STM32F4 variants) cannot use SRAM bit-banding; the alias address formula produces addresses in unmapped space.
- **BSRR set takes priority over reset when both bits are written simultaneously** — Writing `GPIOA->BSRR = (1 << 5) | (1 << 21)` (set and clear PA5 in the same write) results in PA5 being set; this is defined behavior per the reference manual but can mask logic errors.
- **RP2040 dual-core GPIO access requires awareness of SIO ownership** — While SIO registers are per-core and non-conflicting, higher-level SDK calls that read-modify-write GPIO direction or pull configuration are not atomic across cores and need a mutex or spinlock.
- **Toggling via ODR XOR on STM32 is not atomic** — `GPIOA->ODR ^= (1 << 5)` is still a read-modify-write sequence; only the RP2040's dedicated `gpio_togl` register provides atomic toggle.

## In Practice

- An intermittent GPIO glitch that appears once every few seconds on a scope, where a pin drops low for one main-loop iteration then recovers, is the classic symptom of an ODR RMW race between the main loop and an ISR — switching to BSRR eliminates the glitch immediately.
- A Cortex-M7 port of working M4 firmware that hard faults on startup with BFAR pointing to the 0x42000000 region indicates bit-band alias usage that was not removed during the port — the fix is replacing all bit-band accesses with LDREX/STREX or BSRR.
- A GPIO pin that "sticks" in the wrong state after rapid set/clear sequences from both cores on RP2040 suggests both cores are writing to `gpio_oe_set` / `gpio_oe_clr` through the shared IO bank registers rather than the per-core SIO — the resolution is ensuring all output writes go through `sio_hw`.
- **A pin that occasionally misses a toggle** during high-frequency bit-bang output, visible as an irregular pulse on the analyzer, often traces to an ISR performing an ODR read-modify-write on the same port — even if the ISR touches a different pin on the same port, the RMW window is the root cause.
- An ESP32 output that works correctly for GPIO 0-31 but fails silently for GPIO 32+ commonly appears when the code writes to `GPIO_OUT_W1TS_REG` instead of `GPIO_OUT1_W1TS_REG` — the `gpio_set_level()` API handles this split automatically.
