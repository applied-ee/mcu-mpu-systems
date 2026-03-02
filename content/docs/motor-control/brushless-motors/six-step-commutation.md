---
title: "Six-Step Commutation"
weight: 20
---

# Six-Step Commutation

Six-step (trapezoidal) commutation is the simplest method for driving a BLDC motor. At any instant, two of the three phases are energized (one high, one low) while the third floats. As the rotor advances through 60° electrical increments, the firmware switches to the next commutation state. The sequence repeats every 360° electrical — six states per electrical revolution, hence the name. This approach requires only six discrete switching states and can be driven from three Hall-effect sensors or sensorless back-EMF detection.

## Commutation Table

The six commutation states for a three-phase motor (phases A, B, C) with corresponding Hall sensor inputs:

| Step | Hall A | Hall B | Hall C | Phase A | Phase B | Phase C |
|------|--------|--------|--------|---------|---------|---------|
| 1 | 1 | 0 | 1 | High | Low | Float |
| 2 | 1 | 0 | 0 | High | Float | Low |
| 3 | 1 | 1 | 0 | Float | High | Low |
| 4 | 0 | 1 | 0 | Low | High | Float |
| 5 | 0 | 1 | 1 | Low | Float | High |
| 6 | 0 | 0 | 1 | Float | Low | High |

The exact mapping between Hall states and commutation steps varies by motor manufacturer. The table above is one common arrangement — the correct mapping must be verified for each motor.

**Invalid Hall states:** States 000 and 111 should never occur during normal rotation. Detecting these indicates a sensor fault, broken wire, or noise.

## Hall Sensor Placement

Three Hall-effect sensors are typically mounted 120° electrical apart in the stator. Their switching pattern produces a 3-bit Gray code that uniquely identifies the rotor position within each 60° electrical sector.

Physical placement depends on pole count:

```
Spacing = 120° electrical = 120° / pole_pairs (mechanical)
```

For a 7-pole-pair motor: 120° / 7 = 17.1° mechanical between sensors.

### Reading Hall Sensors (STM32)

```c
uint8_t read_halls(void) {
    uint8_t hall = 0;
    hall |= HAL_GPIO_ReadPin(HALL_A_PORT, HALL_A_PIN) << 2;
    hall |= HAL_GPIO_ReadPin(HALL_B_PORT, HALL_B_PIN) << 1;
    hall |= HAL_GPIO_ReadPin(HALL_C_PORT, HALL_C_PIN) << 0;
    return hall;  /* Returns 1–6 (valid), 0 or 7 (fault) */
}
```

### Interrupt-Driven Commutation

```c
/* Hall sensor change triggers EXTI interrupt */
void EXTI_Hall_IRQHandler(void) {
    uint8_t hall_state = read_halls();

    if (hall_state == 0 || hall_state == 7) {
        /* Invalid state — disable outputs */
        disable_all_phases();
        return;
    }

    /* Look up commutation state */
    apply_commutation(commutation_table[direction][hall_state]);
}

/* Commutation table (forward direction) */
const uint8_t commutation_fwd[8] = {
    /*         0     1     2     3     4     5     6     7 */
    /* Hall: */ 0xFF, 0x05, 0x03, 0x04, 0x01, 0x06, 0x02, 0xFF
};
```

### STM32 Timer Hall Sensor Interface

STM32 advanced timers (TIM1, TIM8) include a dedicated Hall sensor interface that triggers commutation automatically:

```c
/* Configure TIM1 for 6-step commutation with Hall sensor input */
TIM_HallSensor_InitTypeDef sHallConfig = {0};
sHallConfig.IC1Polarity = TIM_ICPOLARITY_RISING;
sHallConfig.IC1Prescaler = TIM_ICPSC_DIV1;
sHallConfig.IC1Filter = 0x0F;        /* Digital filter for noise */
sHallConfig.Commutation_Delay = 0;   /* Immediate commutation */
HAL_TIMEx_HallSensor_Init(&htim1, &sHallConfig);
HAL_TIMEx_HallSensor_Start_IT(&htim1);
```

The timer captures the Hall edge timing (for speed measurement) and generates a commutation event that triggers the complementary PWM outputs to switch to the next state.

## PWM Application in Six-Step

PWM is applied to the active phases to control speed/torque. Two common strategies:

**High-side PWM:** Only the high-side FET is PWM'd; the low-side FET stays on continuously during its active state. Simpler, but freewheeling current flows through body diodes.

**Complementary PWM with dead time:** Both the high-side and low-side FETs in the active leg are PWM'd with complementary signals and dead time. More efficient freewheeling (current recirculates through the synchronous FET rather than the body diode).

```c
/* Set PWM duty cycle for speed control */
/* Active high-side channel gets PWM; active low-side is full-on */
void apply_commutation(uint8_t state) {
    disable_all_phases();

    switch (state) {
        case 1:  /* A-high, B-low */
            set_pwm(PHASE_A, duty_cycle);
            set_low_on(PHASE_B);
            break;
        case 2:  /* A-high, C-low */
            set_pwm(PHASE_A, duty_cycle);
            set_low_on(PHASE_C);
            break;
        /* ... remaining states ... */
    }
}
```

## Torque Ripple

Six-step commutation produces inherent torque ripple because the current waveform is rectangular (flat-top) while the back-EMF is trapezoidal. The torque is constant only during the flat portion of the back-EMF waveform; during the 60° transition between states, torque varies. The peak-to-peak ripple is typically 10–15 % of average torque.

For applications where this ripple is unacceptable (precision servo, gimbal), field-oriented control (FOC) with sinusoidal commutation eliminates it.

## Tips

- Use the STM32 timer's Hall sensor interface instead of raw GPIO interrupts. The hardware captures timing, applies digital filtering, and generates commutation events — reducing firmware latency and jitter to near zero.
- Start commutation verification at very low duty (5–10 %) to limit current if the table is wrong. An incorrect commutation table can produce current spikes of several times the rated motor current.
- Add a 100 nF capacitor and a 10 kΩ pull-up on each Hall sensor line. Open-collector Hall outputs are noise-sensitive, and motor switching transients can produce false edges.
- Measure the time between Hall edges to calculate motor speed: RPM = 60 / (6 × pole_pairs × Δt), where Δt is the time between consecutive Hall transitions.

## Caveats

- The commutation table is motor-specific. Two motors with the same connector and form factor may have different Hall sensor wiring or magnet orientation, requiring different tables. Always verify the table empirically.
- Hall sensor noise at low speeds (especially near sensor switching thresholds) can cause rapid toggling between two commutation states, producing vibration and audible buzzing. Digital filtering (hardware or timer-based) suppresses this.
- Six-step commutation has a dead zone at startup: the rotor must be within the correct 60° sector for the initial commutation state. If the rotor is at a sector boundary, the initial state may produce near-zero torque. An alignment step (briefly energizing one state to pull the rotor to a known position) ensures reliable startup.
- At very low speeds (< 50 RPM), the 60° steps become perceptible as discrete position jumps. This cogging is intrinsic to trapezoidal commutation and can only be eliminated by switching to sinusoidal/FOC drive.

## In Practice

- **Motor spins but produces a rhythmic vibration at 6× the rotation frequency.** This is the torque ripple inherent in six-step commutation. Each commutation transition produces a brief torque dip as current transfers between phases. The vibration is most noticeable at low speed and under load. Switching to FOC eliminates it; for six-step, ensuring clean commutation timing (no delay at transitions) minimizes the amplitude.

- **Motor runs smoothly in one direction but cogs badly in reverse.** The commutation table for reverse is incorrect — simply negating the Hall state lookup does not always produce the correct reverse sequence. The reverse table must be the time-reversed version of the forward table, which depends on the specific Hall sensor arrangement.

- **Motor starts in the wrong direction for the first 60° then corrects itself.** The initial commutation state is off by one step. The rotor moves backward for one Hall transition, then the correct state is applied. Adding a rotor alignment step before starting (energizing the correct pair for 50–100 ms) ensures the first step is always forward.

- **Speed measurement from Hall timing is noisy at low RPM.** The Hall edge intervals become long (tens of milliseconds), and any jitter in the edge timing — from sensor noise, mechanical vibration, or magnet irregularities — produces large percentage errors in the speed calculation. Averaging over multiple Hall transitions (6 or 12 edges) smooths the measurement.
