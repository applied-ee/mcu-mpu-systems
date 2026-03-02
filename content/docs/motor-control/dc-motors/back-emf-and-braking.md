---
title: "Back-EMF & Braking"
weight: 40
---

# Back-EMF & Braking

A spinning DC motor is also a generator. The rotating armature produces a voltage proportional to speed — the back-EMF (electromotive force). This voltage opposes the applied voltage and is the fundamental mechanism that regulates motor current: as speed increases, back-EMF rises, net voltage across the winding drops, and current decreases. Understanding back-EMF is essential for speed measurement without encoders, controlled deceleration, and preventing voltage spikes from damaging drive electronics.

## Back-EMF Fundamentals

The back-EMF voltage of a brushed DC motor follows:

```
V_bemf = K_e × ω
```

Where K_e is the back-EMF constant (V/rad/s or V/RPM) and ω is the angular velocity. K_e is numerically equal to the torque constant K_t (in SI units: V·s/rad = N·m/A), a consequence of energy conservation.

| Motor Parameter | Typical Range | Notes |
|----------------|--------------|-------|
| K_e (small hobby motor) | 0.005–0.02 V/RPM | 6–12 V motors, 3000–10000 RPM |
| K_e (geared motor) | 0.02–0.1 V/RPM | Lower speed, higher torque |
| V_bemf at no-load speed | ~90–95 % of V_supply | Difference is I_noload × R_winding |

At full speed with no load, back-EMF is nearly equal to the supply voltage. The small difference drives just enough current through the winding resistance to overcome friction.

## Speed Measurement via Back-EMF

During the PWM off-time, the drive FET is off and the motor terminal voltage reflects the back-EMF (minus the body diode drop during freewheeling). Sampling this voltage with an ADC provides a sensorless speed estimate:

```c
/* Sample back-EMF during PWM off-time */
/* ADC triggered by timer compare event at end of off-time */
float v_bemf = (adc_raw / 4095.0f) * 3.3f * voltage_divider_ratio;
float speed_rpm = v_bemf / K_E_VOLTS_PER_RPM;
```

A voltage divider scales the motor voltage (e.g., 12 V) to the ADC range (3.3 V). The measurement window must be long enough for the LC ringing at the switch node to settle — typically 5–20 µs after the MOSFET turns off.

### Voltage Divider Sizing

For a 12 V motor sensed by a 3.3 V ADC:

```
R_top = 33 kΩ, R_bottom = 10 kΩ
V_adc = V_motor × 10 / (33 + 10) = V_motor × 0.233
12 V → 2.79 V at ADC (within range)
```

## Dynamic Braking

Shorting the motor terminals (through the low-side FETs of an H-bridge) converts kinetic energy into heat in the winding resistance. The motor decelerates quickly because it drives current through its own resistance:

```
I_brake = V_bemf / R_winding
```

A motor with 1 Ω winding resistance spinning at a speed producing 10 V back-EMF initially draws 10 A of braking current — this can exceed the H-bridge current rating. Current decreases as the motor slows and back-EMF drops.

### Implementation

```c
/* Dynamic braking: both low-side FETs on, both high-side FETs off */
void motor_brake(void) {
    /* Disable PWM outputs */
    HAL_TIM_PWM_Stop(&htim1, TIM_CHANNEL_1);  /* High-side A */
    HAL_TIM_PWM_Stop(&htim1, TIM_CHANNEL_2);  /* High-side B */
    /* Turn on both low-side FETs */
    HAL_GPIO_WritePin(LS_A_PORT, LS_A_PIN, GPIO_PIN_SET);
    HAL_GPIO_WritePin(LS_B_PORT, LS_B_PIN, GPIO_PIN_SET);
}
```

## Regenerative Braking

Instead of dissipating braking energy as heat, regenerative braking feeds current back into the supply. This occurs naturally when back-EMF exceeds the supply voltage — current flows backward through the H-bridge body diodes into the supply capacitor. This is useful in battery-powered systems where recovering energy extends runtime, but it requires:

1. A supply that can absorb energy (battery or large capacitor bank)
2. Voltage monitoring to prevent the supply rail from rising above component ratings
3. A dump resistor or active clamp if the supply cannot absorb all regenerated energy

| Braking Method | Energy Destination | Deceleration Rate | Complexity |
|---------------|-------------------|-------------------|------------|
| Coast | Mechanical friction | Slow | None (FETs off) |
| Dynamic | Heat in motor winding | Fast | Low (short terminals) |
| Regenerative | Back to supply | Fast | Moderate (needs energy management) |

## Voltage Spikes from Back-EMF

When the drive transistor turns off abruptly, the motor's inductance forces current to continue flowing. If there is no current path (missing flyback diode, no body diode conduction), the voltage at the switch node spikes — potentially to hundreds of volts on a 12 V motor. This is the same inductive flyback that affects solenoids and relays, and it requires the same protection: flyback diodes, snubbers, or TVS clamps (covered in detail in the [Drive Circuitry]({{< relref "../drive-circuitry/flyback-and-snubber-protection" >}}) section).

## Tips

- Back-EMF measurement during PWM off-time provides a free tachometer. The accuracy improves at higher speeds (larger signal) and lower PWM frequencies (longer sampling window).
- For dynamic braking, verify that the initial braking current (V_bemf / R_winding) does not exceed the H-bridge current rating. If it does, use PWM'd braking — alternating between brake and coast states — to limit average current.
- Adding a 100–470 µF capacitor on the motor supply rail absorbs regenerative energy during brief deceleration events (< 1 s) without needing a dedicated braking resistor.
- The back-EMF constant K_e can be measured empirically by spinning the motor with an external source (drill, another motor) at a known speed and measuring the open-circuit terminal voltage.

## Caveats

- Back-EMF sampling requires careful timing. If the ADC samples during the switching transient (ringing from parasitic inductance and capacitance at the switch node), the reading is meaningless. Wait at least 5–10 µs after the FET turns off before sampling.
- Regenerative braking into a fully charged battery can raise the bus voltage above the MOSFET and capacitor ratings. Without overvoltage protection, this destroys components. A TVS diode or active brake resistor at the supply rail prevents overvoltage.
- Dynamic braking current is highest at the instant braking begins — when the motor is spinning fastest. The brief current spike can trip overcurrent protection set for normal running conditions. A separate, higher threshold for braking avoids nuisance trips.
- Back-EMF measurement does not work at very low speeds because the generated voltage is below the ADC's useful resolution. Below ~10 % of rated speed, encoder feedback is far more reliable.

## In Practice

- **Motor supply voltage spikes to 20 V on a 12 V rail during deceleration.** Regenerative current from the motor charges the supply capacitor faster than the load can discharge it. This commonly appears when a large motor decelerates quickly with a small supply capacitor. Adding bulk capacitance or a braking resistor clamps the overshoot.

- **Back-EMF speed reading is noisy and jumps between valid and zero.** The ADC sample point falls on the switching transient for some duty cycles but not others. The ringing at the switch node produces voltages that swing both above and below the actual back-EMF. Adjusting the ADC trigger point to sample later in the off-time — after the ringing has settled — produces a clean reading.

- **Motor takes noticeably longer to stop when hot.** Winding resistance increases with temperature (copper TCR ≈ +0.4 %/°C). Higher resistance means lower braking current for a given back-EMF, reducing braking torque. At 80 °C above ambient, winding resistance is ~30 % higher and braking current is ~23 % lower.

- **Supply current briefly goes negative (measured by a high-side shunt) during PWM off-time.** This is normal regenerative behavior — the motor's stored inductive energy pumps current back into the supply through the body diodes. The magnitude depends on motor inductance and the current at the switching instant.
