---
title: "Field-Oriented Control"
weight: 30
---

# Field-Oriented Control

Field-oriented control (FOC), also called vector control, is the gold standard for BLDC and PMSM motor control. Instead of switching between six discrete commutation states, FOC treats the motor as a DC machine by transforming the three-phase stator currents into a two-component rotating reference frame aligned with the rotor. This allows independent control of torque-producing current (Iq) and field-weakening current (Id), producing smooth, ripple-free torque at all speeds. The trade-off is significantly more math per control cycle — Clarke and Park transforms, two PID loops, inverse transforms, and space-vector PWM — all running at 10–40 kHz.

## Why FOC Matters

| Property | Six-Step | FOC |
|----------|---------|-----|
| Torque ripple | 10–15 % | < 2 % |
| Acoustic noise | Moderate | Low |
| Efficiency at partial load | Good | Excellent |
| Low-speed control | Cogging, 60° steps | Smooth to near-zero RPM |
| Implementation complexity | Low | High |
| Required rotor position accuracy | 60° sector | Continuous (encoder or observer) |

FOC is essential for gimbal motors, precision servo drives, robotic joints, and any application requiring smooth torque delivery across the full speed range.

## The FOC Pipeline

The control loop runs once per PWM period (typically 10–20 kHz):

```
                    ┌─────────┐
Phase currents ────►│ Clarke  │──► Iα, Iβ
  (Ia, Ib, Ic)     │Transform│    (stationary frame)
                    └─────────┘
                         │
                    ┌────▼────┐
                    │  Park   │──► Id, Iq
                    │Transform│    (rotating frame)
                    └─────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼───┐ ┌───▼────┐    │
         │ Id PID │ │ Iq PID │    │
         │(field) │ │(torque)│    │
         └────┬───┘ └───┬────┘    │
              │         │         │
         Vd_ref    Vq_ref     θ_electrical
              │         │         │
         ┌────▼─────────▼────┐    │
         │  Inverse Park     │◄───┘
         │   Transform       │
         └────────┬──────────┘
                  │
             Vα, Vβ
                  │
         ┌────────▼──────────┐
         │  Space Vector     │
         │  PWM (SVPWM)      │
         └────────┬──────────┘
                  │
            PWM duty cycles
           (Ta, Tb, Tc)
```

### 1. Clarke Transform (ABC → αβ)

Converts three-phase currents to a two-axis stationary reference frame:

```c
/* Clarke transform — assumes Ia + Ib + Ic = 0 */
float I_alpha = I_a;
float I_beta  = (I_a + 2.0f * I_b) * ONE_OVER_SQRT3;
/* Alternatively: I_beta = (2*I_b + I_a) / sqrt(3) */
```

Only two phase currents need to be measured — the third is calculated from Kirchhoff's current law (Ia + Ib + Ic = 0).

### 2. Park Transform (αβ → dq)

Rotates the stationary frame to align with the rotor:

```c
/* Park transform */
float cos_theta = cosf(theta_electrical);
float sin_theta = sinf(theta_electrical);

float I_d = I_alpha * cos_theta + I_beta * sin_theta;
float I_q = -I_alpha * sin_theta + I_beta * cos_theta;
```

Where θ_electrical is the rotor's electrical angle, obtained from an encoder, Hall sensors with interpolation, or a sensorless observer.

### 3. Current Control (dq PID Loops)

Two independent PI controllers regulate Id and Iq:

```c
/* Id controller — target is typically 0 (no field weakening) */
float Id_error = Id_ref - I_d;  /* Id_ref = 0 for max torque/amp */
float Vd_ref = pi_controller(&pid_d, Id_error);

/* Iq controller — target is the torque command */
float Iq_error = Iq_ref - I_q;
float Vq_ref = pi_controller(&pid_q, Iq_error);
```

### 4. Inverse Park Transform (dq → αβ)

```c
float V_alpha = Vd_ref * cos_theta - Vq_ref * sin_theta;
float V_beta  = Vd_ref * sin_theta + Vq_ref * cos_theta;
```

### 5. Space-Vector PWM (αβ → PWM Duties)

SVPWM converts Vα, Vβ into three PWM duty cycles with better DC bus utilization (15 % more voltage range) than sinusoidal PWM:

```c
/* Simplified SVPWM — sector identification and duty calculation */
uint8_t sector = identify_sector(V_alpha, V_beta);
/* Calculate T1, T2 (active vector times) and T0 (zero vector time) */
/* Map to PWM compare registers for phases A, B, C */
```

Full SVPWM implementations are available in ST's motor control library (MC SDK), SimpleFOC, and TI's MotorControl SDK.

## Position Sensing for FOC

FOC requires continuous rotor angle, not just 60° sector information:

| Method | Resolution | Cost | Startup | Notes |
|--------|-----------|------|---------|-------|
| Incremental encoder | 100–10000 PPR | Moderate | Needs alignment or index | Most common in servo drives |
| Hall sensors + interpolation | ~60° sectors + timer interpolation | Low | Immediate | Adequate for many applications |
| Sensorless observer | Estimated from back-EMF | None (software) | Requires startup routine | Works above ~10 % speed |
| Absolute encoder (SPI) | 12–14 bit | Higher | Immediate | AS5047, MA730 |

Hall-based FOC interpolates the angle between Hall transitions using the measured speed. This works well above ~100 RPM but introduces phase error at rapid acceleration/deceleration.

## Tips

- Start with an existing FOC library (SimpleFOC for Arduino/ESP32, STM32 Motor Control SDK, or VESC firmware) before writing FOC from scratch. The math is well-documented, but the timing, ADC synchronization, and SVPWM edge cases take weeks to debug from scratch.
- Tune the current PI loops first, with the motor locked or at very low speed. Good current control is the foundation — if Id and Iq oscillate, the velocity and position loops built on top will never be stable.
- Use center-aligned PWM and synchronize ADC sampling to the timer counter center (when all low-side FETs are on). This provides the cleanest current measurement with minimum switching noise.
- The maximum bus voltage utilization for linear modulation is V_bus / √3 ≈ 0.577 × V_bus. SVPWM extends this to V_bus / √3 × (2/√3) ≈ 0.667 × V_bus. Overmodulation beyond this introduces distortion.

## Caveats

- FOC requires execution of the full transform pipeline (Clarke → Park → PI × 2 → inverse Park → SVPWM) within one PWM period. At 20 kHz, the deadline is 50 µs. On a 72 MHz Cortex-M3 without FPU, floating-point FOC can take 30–40 µs — leaving little margin. Fixed-point implementations or an FPU-equipped MCU (Cortex-M4F, Cortex-M7) are strongly recommended.
- Incorrect rotor angle (from encoder misalignment, Hall interpolation error, or observer drift) directly reduces torque and increases current. A 30° electrical angle error reduces torque by cos(30°) ≈ 13 % while increasing non-torque-producing current.
- Field weakening (Id < 0) allows operation above base speed by reducing the effective magnet flux, but risks demagnetizing the permanent magnets if the Id current exceeds the magnet's coercivity. Most embedded applications do not need field weakening.
- Sensorless FOC observers (sliding-mode, Luenberger, extended Kalman filter) fail at standstill and very low speeds because back-EMF is proportional to speed. An open-loop startup sequence (forced commutation at increasing speed) is required until the observer converges.

## In Practice

- **Motor produces a high-pitched whine under FOC at standstill.** The current PI loops are oscillating — the proportional gain is too high or the integral gain causes overshoot. Reducing Kp by 50 % and monitoring Id/Iq on a scope (via DAC output) reveals the oscillation. Stable current loops produce flat Id and Iq traces at steady state.

- **Motor torque pulsates at 6× the electrical frequency under FOC.** Residual harmonic content in the current waveform — typically from ADC timing errors, current sensor offset, or SVPWM nonlinearity — creates 6th-harmonic torque ripple. ADC offset calibration (measuring with zero current and subtracting the offset) is the first correction.

- **Sensorless FOC loses tracking during rapid deceleration.** The observer relies on back-EMF, which decreases with speed. During aggressive deceleration, the speed passes through the observer's minimum operating range, and the estimated angle diverges from reality. Blending back to open-loop control below a speed threshold prevents loss of tracking.

- **FOC draws significantly more current than expected for the mechanical load.** A rotor angle offset (encoder not aligned to the electrical zero) causes part of the Iq current to project onto the d-axis, producing no useful torque. The alignment procedure — slowly rotating the field to a known electrical angle and recording the encoder position — must be performed once during commissioning.
