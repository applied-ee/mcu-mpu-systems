---
title: "Debouncing in Firmware"
weight: 40
---

# Debouncing in Firmware

A mechanical switch does not produce a clean digital transition. When the contacts close, they bounce — making and breaking contact multiple times over a period of 1-20 ms (some switches bounce for 50 ms or more). A single button press can produce 5-50 edge transitions before settling. Without debounce logic, a single press registers as multiple presses, a rotary encoder skips counts, and an interrupt-driven input floods the system with spurious events. Firmware debouncing filters this mechanical noise using time-domain analysis — waiting for the signal to remain stable before accepting the new state.

## Bounce Characteristics

The bounce waveform varies by switch type. A typical 6mm tactile switch (e.g., Omron B3F-1000) produces 1-5 ms of bounce with 3-10 transitions. A toggle switch or slide switch can bounce for 10-20 ms. Cherry MX keyboard switches typically settle within 5 ms. Microswitches (e.g., Omron D2F series) bounce for 1-3 ms. These are open-contact bounce times — release bounce tends to be shorter than press bounce because the spring mechanism assists separation.

The bounce pattern is not regular. It consists of clean closures (contact resistance < 1 ohm) interspersed with clean opens (contact resistance > 1 megohm), at irregular intervals. There is no ringing or analog oscillation — each individual transition is a clean digital edge, but the edges arrive at unpredictable times within the bounce window.

## Polling-Based Debounce with Integration Counter

The most robust general-purpose debounce method: sample the pin at a fixed rate and require N consecutive identical readings before accepting a state change. This is an integration counter (or majority-vote filter).

```c
#define DEBOUNCE_SAMPLES  10    // Number of stable readings required
#define POLL_INTERVAL_MS  5     // Sampling period

typedef struct {
    pin_id_t pin;
    bool     debounced_state;
    uint8_t  integrator;
    uint8_t  max_count;
} debounce_t;

void debounce_init(debounce_t *d, pin_id_t pin, uint8_t samples) {
    d->pin = pin;
    d->debounced_state = gpio_read(pin);
    d->integrator = d->debounced_state ? samples : 0;
    d->max_count = samples;
}

bool debounce_poll(debounce_t *d) {
    bool raw = gpio_read(d->pin);
    bool prev = d->debounced_state;

    if (raw) {
        if (d->integrator < d->max_count) {
            d->integrator++;
        }
    } else {
        if (d->integrator > 0) {
            d->integrator--;
        }
    }

    if (d->integrator == 0) {
        d->debounced_state = false;
    } else if (d->integrator >= d->max_count) {
        d->debounced_state = true;
    }

    return (d->debounced_state != prev);  // true on state change
}
```

Called from a periodic timer or main loop:

```c
static debounce_t btn_debounce;

void main(void) {
    debounce_init(&btn_debounce, PIN_USER_BTN, DEBOUNCE_SAMPLES);

    while (1) {
        if (debounce_poll(&btn_debounce)) {
            if (btn_debounce.debounced_state) {
                handle_button_press();
            } else {
                handle_button_release();
            }
        }
        HAL_Delay(POLL_INTERVAL_MS);
    }
}
```

With 10 samples at 5 ms intervals, the debounce latency is 50 ms — the switch must be stable for 50 ms before the state changes. Total response time from first contact to accepted press: bounce time + debounce time, typically 55-70 ms. This is well within human perception limits (tactile feedback is perceived as "instant" up to ~100 ms).

The integration counter is inherently noise-resistant: a single glitch resets the counter but does not produce a false trigger. Even electrical noise that produces one spurious reading every few samples only slows the integration without producing false events.

## Timer-Based Debounce

An alternative approach: on the first edge, record the timestamp and ignore all further edges until a timeout expires. After the timeout, read the pin state and accept it.

```c
typedef struct {
    pin_id_t pin;
    bool     debounced_state;
    uint32_t last_edge_tick;
    uint32_t lockout_ms;
    bool     locked;
} debounce_timer_t;

bool debounce_timer_poll(debounce_timer_t *d, uint32_t now_ms) {
    bool raw = gpio_read(d->pin);
    bool prev = d->debounced_state;

    if (raw != d->debounced_state && !d->locked) {
        // First edge detected — start lockout
        d->last_edge_tick = now_ms;
        d->locked = true;
    }

    if (d->locked && (now_ms - d->last_edge_tick) >= d->lockout_ms) {
        // Lockout expired — accept current pin state
        d->debounced_state = gpio_read(d->pin);
        d->locked = false;
    }

    return (d->debounced_state != prev);
}
```

This approach has lower latency (the lockout period can be tuned to just beyond the worst-case bounce), but it is more sensitive to noise: a single glitch outside the bounce window starts a new lockout cycle, potentially delaying legitimate inputs.

## Interrupt + Timer Debounce

For low-power applications where continuous polling wastes current, combine an edge interrupt with a one-shot timer. The interrupt wakes the system and starts the debounce timer; the timer callback reads the settled state:

```c
static volatile bool debounce_pending = false;

// GPIO EXTI interrupt handler
void EXTI15_10_IRQHandler(void) {
    if (__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_13)) {
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_13);

        // Disable further interrupts during debounce
        HAL_NVIC_DisableIRQ(EXTI15_10_IRQn);

        // Start one-shot debounce timer (20 ms)
        __HAL_TIM_SET_COUNTER(&htim6, 0);
        HAL_TIM_Base_Start_IT(&htim6);

        debounce_pending = true;
    }
}

// Timer interrupt — fires after 20 ms
void TIM6_DAC_IRQHandler(void) {
    if (__HAL_TIM_GET_FLAG(&htim6, TIM_FLAG_UPDATE)) {
        __HAL_TIM_CLEAR_FLAG(&htim6, TIM_FLAG_UPDATE);
        HAL_TIM_Base_Stop_IT(&htim6);

        // Read settled state
        bool pressed = (HAL_GPIO_ReadPin(GPIOC, GPIO_PIN_13) == GPIO_PIN_RESET);

        if (pressed) {
            handle_button_press();
        }

        // Re-enable GPIO interrupt
        __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_13);
        HAL_NVIC_EnableIRQ(EXTI15_10_IRQn);

        debounce_pending = false;
    }
}
```

The critical step: disabling the EXTI interrupt before starting the timer. Without this, every bounce edge fires the ISR, and each one restarts the timer — producing either multiple callbacks or an interrupt storm that consumes all CPU time during the bounce window.

## State Machine Debounce

A formal state machine approach handles press, release, and repeat with explicit states. This is especially useful for UI firmware that needs held-button repeat or long-press detection:

```c
typedef enum {
    BTN_IDLE,
    BTN_PRESS_DEBOUNCE,
    BTN_PRESSED,
    BTN_RELEASE_DEBOUNCE,
} btn_state_t;

typedef enum {
    BTN_EVENT_NONE,
    BTN_EVENT_PRESS,
    BTN_EVENT_RELEASE,
    BTN_EVENT_HELD,
} btn_event_t;

typedef struct {
    pin_id_t     pin;
    btn_state_t  state;
    uint32_t     state_enter_tick;
    uint32_t     debounce_ms;
    uint32_t     hold_ms;
    bool         hold_reported;
} btn_sm_t;

btn_event_t btn_sm_poll(btn_sm_t *b, uint32_t now_ms) {
    bool raw = gpio_read(b->pin);
    uint32_t elapsed = now_ms - b->state_enter_tick;

    switch (b->state) {
    case BTN_IDLE:
        if (raw) {
            b->state = BTN_PRESS_DEBOUNCE;
            b->state_enter_tick = now_ms;
        }
        return BTN_EVENT_NONE;

    case BTN_PRESS_DEBOUNCE:
        if (!raw) {
            b->state = BTN_IDLE;  // Bounce — return to idle
            return BTN_EVENT_NONE;
        }
        if (elapsed >= b->debounce_ms) {
            b->state = BTN_PRESSED;
            b->state_enter_tick = now_ms;
            b->hold_reported = false;
            return BTN_EVENT_PRESS;
        }
        return BTN_EVENT_NONE;

    case BTN_PRESSED:
        if (!raw) {
            b->state = BTN_RELEASE_DEBOUNCE;
            b->state_enter_tick = now_ms;
            return BTN_EVENT_NONE;
        }
        if (!b->hold_reported && elapsed >= b->hold_ms) {
            b->hold_reported = true;
            return BTN_EVENT_HELD;
        }
        return BTN_EVENT_NONE;

    case BTN_RELEASE_DEBOUNCE:
        if (raw) {
            b->state = BTN_PRESSED;  // Bounce — return to pressed
            b->state_enter_tick = now_ms;
            return BTN_EVENT_NONE;
        }
        if (elapsed >= b->debounce_ms) {
            b->state = BTN_IDLE;
            return BTN_EVENT_RELEASE;
        }
        return BTN_EVENT_NONE;
    }
    return BTN_EVENT_NONE;
}
```

This pattern separates press debounce from release debounce and adds a hold timer with zero additional hardware resources. Polling at 5-10 ms intervals is sufficient.

## Rotary Encoder Debounce

Rotary encoders (e.g., Alps EC11, Bourns PEC11) present a different debounce challenge. Two quadrature signals (A and B) produce a sequence of states that must be decoded in order: 00 → 01 → 11 → 10 → 00 (clockwise). Bounce on either signal produces illegal state transitions that corrupt the count.

The standard approach: only accept transitions that follow the valid quadrature sequence. Invalid transitions (e.g., 00 → 11, skipping 01) are ignored as bounce artifacts:

```c
static const int8_t enc_table[16] = {
     0, -1,  1,  0,
     1,  0,  0, -1,
    -1,  0,  0,  1,
     0,  1, -1,  0,
};

typedef struct {
    pin_id_t pin_a;
    pin_id_t pin_b;
    uint8_t  prev_state;
    int32_t  position;
} encoder_t;

void encoder_poll(encoder_t *e) {
    uint8_t a = gpio_read(e->pin_a) ? 1 : 0;
    uint8_t b = gpio_read(e->pin_b) ? 1 : 0;
    uint8_t new_state = (a << 1) | b;

    uint8_t index = (e->prev_state << 2) | new_state;
    e->position += enc_table[index];
    e->prev_state = new_state;
}
```

The lookup table inherently rejects illegal transitions (they map to 0). Polling rate matters: at 1 ms intervals, a hand-turned encoder at typical speeds (2-3 detents per second, 24 detents per revolution) produces transitions every ~15 ms, well within the sampling capability. High-speed encoders or motor-driven shafts may require hardware timer capture instead of polling.

For additional noise immunity, require a full valid quadrature cycle (4 transitions) before incrementing the count by one detent, rather than counting every transition:

```c
void encoder_poll_detent(encoder_t *e) {
    uint8_t a = gpio_read(e->pin_a) ? 1 : 0;
    uint8_t b = gpio_read(e->pin_b) ? 1 : 0;
    uint8_t new_state = (a << 1) | b;

    uint8_t index = (e->prev_state << 2) | new_state;
    int8_t delta = enc_table[index];
    e->prev_state = new_state;

    // Only report at detent positions (both signals same state)
    static int8_t accumulator = 0;
    accumulator += delta;
    if (new_state == 0b00 || new_state == 0b11) {
        if (accumulator >= 2) {
            e->position++;
            accumulator = 0;
        } else if (accumulator <= -2) {
            e->position--;
            accumulator = 0;
        }
    }
}
```

## Tips

- Start with a 20 ms debounce time for unknown switches — this works for the vast majority of tactile, toggle, and slide switches; tune downward only after measuring the specific switch with a scope.
- Poll at 5 ms intervals for button debounce — faster than 2 ms wastes cycles without improving responsiveness, slower than 10 ms adds perceptible lag to the UI.
- Use the integration counter method as the default choice — it handles noise, bounce, and slow transitions (corroded contacts) with a single parameter (sample count) and no edge detection logic.
- For battery-powered devices, use the interrupt + timer approach and put the MCU to sleep between button presses — continuous 5 ms polling draws 1-10 mA depending on the MCU, while sleep-with-EXTI-wakeup can drop to microamps.
- Keep debounce state in a struct, not in static variables — this allows multiple independent debounce instances for multiple buttons without duplicating code.
- For rotary encoders, poll at 1 ms or faster — the quadrature transitions during fast rotation can be as short as 2-3 ms apart, and missing a transition corrupts the direction decode.

## Caveats

- **Interrupt-only debounce without edge lockout causes interrupt storms** — A bouncing switch producing 20 edges in 5 ms at EXTI priority fires the ISR 20 times, each potentially running to completion; if the ISR takes 100 us, that is 2 ms of solid interrupt processing, starving the main loop and any lower-priority interrupts.
- **Debounce time is not constant across the life of a switch** — New switches may bounce for 1-2 ms, but after 100,000 cycles the contacts degrade and bounce time increases to 10-20 ms; a 5 ms debounce that works in the lab can fail in the field after six months.
- **Software debounce adds latency that stacks with other delays** — A 50 ms debounce on a button that triggers a 100 ms display update creates 150 ms total response time; perceived responsiveness degrades noticeably above 100 ms total.
- **Polling debounce depends on a stable timebase** — If the polling interval varies (e.g., the main loop has variable execution time), the effective debounce time varies too; a loop that sometimes takes 2 ms and sometimes 50 ms makes the integrator counter unreliable.
- **Rotary encoder debounce with too-aggressive filtering drops counts** — A debounce time longer than the minimum transition interval at the maximum rotation speed causes the state machine to miss valid transitions, appearing as reduced sensitivity or direction reversal during fast rotation.
- **EXTI on STM32 shares interrupt vectors across pins** — EXTI lines 5-9 share one IRQ and lines 10-15 share another; an interrupt storm from a bouncing switch on EXTI13 blocks handling of legitimate interrupts on EXTI10, 11, 12, 14, or 15 until the bounce subsides.

## In Practice

- A button that occasionally registers double-presses, appearing as two rapid events 2-8 ms apart in the event log, is the textbook symptom of insufficient debounce — the bounce window extends past the debounce timeout, and the trailing bounce edge triggers a second accepted transition.
- **A rotary encoder that skips counts or increments in the wrong direction** during fast rotation typically indicates the polling interval is too slow relative to the rotation speed — reducing the poll period from 10 ms to 1 ms resolves the missed transitions.
- A system that works perfectly on the bench with new switches but generates spurious button events after months of field deployment points to contact degradation increasing bounce time — designing with 20-30 ms debounce from the start (rather than the 5 ms that new switches tolerate) prevents this field failure.
- An interrupt-driven button that causes visible stutter in an LED blink pattern during each press traces to the ISR firing repeatedly during the bounce window — the ISR is not individually expensive, but 10-20 invocations in 5 ms delay the timer ISR that maintains the blink timing.
- A battery-powered device that measures 3 mA in sleep mode instead of the expected 20 uA, with the excess current disappearing when the button is disconnected, suggests the debounce polling timer is still running continuously — the timer must be stopped after the debounce completes and restarted only on the next EXTI wakeup.
- **A button held down continuously that re-triggers every few seconds** indicates the debounce implementation does not distinguish between the initial press and steady-state hold — the state machine approach with explicit PRESSED and IDLE states prevents this by only reporting the press edge, not the sustained level.
