---
title: "BLDC Fundamentals"
weight: 10
---

# BLDC Fundamentals

A brushless DC motor (BLDC) replaces the mechanical commutator of a brushed motor with electronic switching. The rotor carries permanent magnets, and the stator has three sets of windings arranged 120° apart. By energizing the windings in the correct sequence at the correct rotor angle, the stator field continuously pulls the rotor forward. The result is higher efficiency (85–95 % vs 70–85 % for brushed), longer life (no brush wear), and better power density — at the cost of requiring a controller that knows the rotor position and drives a three-phase inverter.

## Three-Phase Topology

A BLDC motor has three stator phases (A, B, C) connected in either a **star (Y)** or **delta (Δ)** configuration. Most small BLDC motors used in embedded systems are star-wound:

```
        Phase A
         │
    ┌────┴────┐
    │  Winding │
    │    A     │
    └────┬────┘
         │
   Star point (neutral)
    ┌────┼────┐
    │         │
 Winding   Winding
    B         C
    │         │
  Phase B   Phase C
```

The three-phase inverter (six MOSFETs in three half-bridges) connects each phase to either the positive supply rail or ground:

```
     V+
  ┌──┼──┬──┐
  Q1  Q3  Q5   (high-side)
  │   │   │
  A   B   C     (motor phases)
  │   │   │
  Q2  Q4  Q6   (low-side)
  └──┼──┴──┘
    GND
```

At any instant, one high-side and one low-side FET are on (in different legs), driving current through two of the three phases while the third floats.

## Electrical vs Mechanical Degrees

A key distinction in BLDC control: one **electrical revolution** (360° electrical) corresponds to one full cycle of the commutation sequence. For a motor with P pole pairs, the relationship is:

```
θ_electrical = P × θ_mechanical
```

A common BLDC motor has 7 pole pairs (14 poles): one mechanical revolution = 7 electrical revolutions. The commutation must cycle 7 times per shaft rotation.

| Pole Pairs | Poles | Electrical Rev per Mech Rev | Typical Application |
|-----------|-------|---------------------------|-------------------|
| 1 | 2 | 1 | High-speed spindles |
| 2 | 4 | 2 | Small fans |
| 7 | 14 | 7 | Drone/quad motors |
| 11 | 22 | 11 | Gimbal motors |

## KV Rating

The KV rating of a BLDC motor specifies RPM per volt (no-load). It is the inverse of the back-EMF constant:

```
KV = 1 / K_e    (RPM/V)
K_e = 1 / KV    (V/RPM)
```

| KV Rating | RPM at 12 V (no-load) | Torque Characteristic | Application |
|----------|----------------------|----------------------|------------|
| 100 KV | 1,200 RPM | High torque, low speed | Gimbal, direct drive |
| 1000 KV | 12,000 RPM | Medium | General purpose |
| 2300 KV | 27,600 RPM | Low torque, high speed | Drone propellers |

Higher KV motors spin faster for a given voltage but produce less torque per amp. The motor constant (K_m = torque / √(power loss)) is a better figure of merit for efficiency comparison across different KV ratings.

## Torque, Speed, and Current

The fundamental relationships:

```
Torque = K_t × I_phase        (N·m)
Back-EMF = K_e × ω            (V)
Speed = (V_supply − I × R) / K_e   (RPM, simplified)
```

Where K_t (torque constant, N·m/A) and K_e (back-EMF constant, V/(rad/s)) are numerically equal in SI units. The motor draws only enough current to produce the torque the load demands — if the load is light, current is low and the motor spins near no-load speed; if the load increases, the motor slows, back-EMF drops, current rises, and torque increases.

## Motor Winding Parameters

Key datasheet parameters for embedded drive design:

| Parameter | Meaning | Impact on Driver Design |
|-----------|---------|----------------------|
| R_phase | Phase resistance (Ω) | Determines current at stall; sets minimum current-limit threshold |
| L_phase | Phase inductance (mH) | Determines current ripple at the PWM frequency |
| KV | Speed constant (RPM/V) | Sets required supply voltage for target speed |
| I_max | Maximum continuous current (A) | Sizes MOSFETs, shunt resistors, and PCB traces |
| Pole pairs | Number of magnetic pole pairs | Determines commutation frequency = RPM × pole_pairs / 60 |

## Tips

- Measure motor phase resistance and inductance before writing control code. These parameters determine the current-loop bandwidth, PWM frequency selection, and current-limit settings. A cheap LCR meter or multimeter provides sufficient accuracy.
- Connect all three motor phases to an oscilloscope and spin the motor by hand to see the trapezoidal or sinusoidal back-EMF waveform. This verifies the winding order and shows whether the motor is better suited for trapezoidal (six-step) or sinusoidal (FOC) drive.
- Verify Hall sensor phasing before running the motor under power. Incorrect Hall-to-phase mapping can run the motor backward, produce zero torque (90° phase error), or create destructive current spikes.
- Start with low voltage (30–50 % of rated) during initial firmware testing. A motor spinning at half speed does half the damage when commutation errors occur.

## Caveats

- The KV rating assumes ideal sinusoidal drive. With six-step (trapezoidal) commutation, torque ripple is significant and the effective KV may differ from the spec by 5–10 %.
- Star-wound motors cannot be driven with single-phase techniques. The neutral point is either floating or internal — assuming access to it is a common schematic error.
- The maximum electrical frequency (commutation rate) determines the controller's processing deadline. A 7-pole-pair motor at 10,000 RPM has an electrical frequency of 1167 Hz — the commutation loop must execute every ~860 µs. At 20,000 RPM, the deadline halves to ~430 µs.
- Phase resistance measured with a multimeter is the DC resistance. At high commutation frequencies, skin effect and AC losses in the windings can increase the effective resistance by 10–30 %, affecting current regulation.

## In Practice

- **Motor vibrates but does not spin when commutation is started.** The most common cause is incorrect phase-to-Hall mapping. The commutation table assigns the wrong phase energization to each Hall state, producing zero net torque or alternating torque. Systematically trying all six permutations of the three motor wires identifies the correct mapping.

- **Motor spins in only one direction regardless of the direction command.** The Hall sensors are mapped to commutation states that produce forward torque but the reverse mapping has a 180° electrical error. The commutation table for reverse direction needs to be the time-reverse of the forward table, not simply swapped high/low.

- **Motor draws excessive current at low speed and gets hot.** If the commutation angle is wrong by more than 30° electrical, the stator field partially opposes rotor rotation, and the motor fights itself. The wasted energy appears as heat. Adjusting the commutation timing (Hall sensor advance angle) reduces current and temperature.

- **Measured back-EMF amplitude varies between phases.** A small variation (< 5 %) is normal due to manufacturing tolerances. Larger variation indicates a shorted turn in one winding or a damaged magnet segment. The affected phase has lower impedance and produces a distorted waveform.
