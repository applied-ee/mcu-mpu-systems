---
title: "Proportional Solenoid Control"
weight: 30
---

# Proportional Solenoid Control

Standard solenoids are binary — fully energized or fully off. Proportional solenoid control uses PWM to regulate the average current through the coil, producing variable force or variable plunger position. This technique is essential for proportional hydraulic/pneumatic valves, variable-force clamping, and any application requiring analog-like force control from a digital drive signal. The key challenge is linearizing the force-position-current relationship, which is inherently nonlinear in most solenoid designs.

## PWM Dithering

Proportional solenoids (designed for variable-force operation) respond to average current, which PWM controls by varying the duty cycle. However, static friction (stiction) in the plunger and valve spool can prevent smooth motion at low current levels. **Dithering** — superimposing a small high-frequency oscillation on the PWM signal — overcomes stiction by continuously micro-vibrating the plunger:

```c
/* PWM with dithering for proportional solenoid */
/* Base PWM: 200 Hz carrier (typical for proportional valves) */
/* Dither: ±5 % amplitude at ~100 Hz superimposed on the carrier */

void solenoid_set_force(float force_pct) {
    /* Base duty cycle (0–100 %) */
    float base_duty = force_pct;

    /* Dither amplitude and frequency */
    float dither_amplitude = 5.0f;   /* ±5 % of full scale */
    static uint32_t dither_counter = 0;
    float dither = dither_amplitude * sinf(2.0f * M_PI * 100.0f *
                   dither_counter / CONTROL_LOOP_FREQ);
    dither_counter++;

    float duty = base_duty + dither;
    if (duty > 100.0f) duty = 100.0f;
    if (duty < 0.0f) duty = 0.0f;

    __HAL_TIM_SET_COMPARE(&htim_sol, TIM_CHANNEL_1,
        (uint16_t)(duty * htim_sol.Init.Period / 100.0f));
}
```

### Dither Parameters

| Parameter | Typical Range | Notes |
|-----------|-------------|-------|
| Dither frequency | 50–200 Hz | Must be above mechanical response bandwidth |
| Dither amplitude | 3–10 % of full scale | Too low: no effect; too high: vibration |
| Base PWM frequency | 100–400 Hz | Standard for proportional valves |

## Current Regulation

Because solenoid coil resistance changes with temperature (copper TCR ≈ +0.4 %/°C), a fixed PWM duty cycle produces different currents at different temperatures. For precise force control, a current control loop is preferred over open-loop PWM:

```c
/* Closed-loop current control for proportional solenoid */
float target_current = force_to_current_map(force_command);
float measured_current = read_shunt_current();
float error = target_current - measured_current;

/* PI controller on current */
static float integral = 0;
integral += error * dt;
float duty = Kp * error + Ki * integral;

/* Clamp and apply */
if (duty > 100.0f) duty = 100.0f;
if (duty < 0.0f) duty = 0.0f;
apply_pwm(duty);
```

The current-to-force relationship depends on the solenoid geometry and plunger position, but proportional solenoids are designed with a flat force-stroke characteristic over a usable range (typically 60–80 % of total stroke).

## Valve Control Applications

Proportional solenoid valves are the primary application. The solenoid force positions a spool inside the valve body, controlling the flow rate of hydraulic fluid or compressed air:

| Valve Type | Solenoid Function | Control Signal |
|-----------|------------------|---------------|
| Proportional directional | Spool position → flow path | Current → force → spool position |
| Proportional pressure relief | Cracking pressure adjustment | Current → force → set pressure |
| Proportional flow control | Orifice size adjustment | Current → force → orifice area |

### Linearization

The relationship between PWM duty (or current) and flow rate is nonlinear due to:
- Solenoid force-stroke curve
- Valve spool geometry (ports opening/closing)
- Pressure differential across the valve

A lookup table or piecewise-linear calibration maps the desired flow to the required current:

```c
/* Linearization table: flow (%) → current (mA) */
const uint16_t flow_to_current[] = {
    /*  0 %   10 %   20 %   30 %   40 %   50 %   60 %   70 %   80 %   90 %  100 % */
       0,    150,   280,   390,   510,   620,   740,   870,  1020,  1180,  1350
};

float linearize_flow(float flow_pct) {
    int idx = (int)(flow_pct / 10.0f);
    float frac = (flow_pct - idx * 10.0f) / 10.0f;
    return flow_to_current[idx] * (1.0f - frac) +
           flow_to_current[idx + 1] * frac;
}
```

## Tips

- Use current control (not voltage/PWM control) for repeatable force output. Temperature-induced resistance changes can shift the force by 15–20 % over a 50 °C temperature swing if only voltage is controlled.
- Start dithering at low amplitude (3 %) and increase until hysteresis is eliminated. Too much dither wastes energy and produces audible noise from the valve spool vibrating.
- Proportional solenoids require a minimum current to begin moving the plunger (threshold current, typically 10–20 % of full scale). Commands below this threshold produce no motion. Account for this dead zone in firmware.
- Bench-calibrate the current-to-flow relationship with the actual valve and fluid at operating pressure. Datasheet curves are approximate and vary significantly between units.

## Caveats

- Standard (non-proportional) solenoids are not designed for proportional control. The force-stroke relationship is highly nonlinear, and partial energization can leave the plunger in an unstable intermediate position that produces unpredictable behavior.
- PWM frequency for proportional valve control is lower than for motor control — typically 100–400 Hz, not 20 kHz. High PWM frequencies do not give the plunger enough time to respond to each cycle, and the solenoid acts as a low-pass filter.
- Dithering generates heat in the coil and mechanical wear on the plunger. For continuously operated valves, dither amplitude should be the minimum necessary to overcome stiction.
- Proportional solenoid valves have significant hysteresis (5–15 % of full scale). The current required to move the spool from 50 % to 60 % is different from the current to move from 60 % to 50 %. Closed-loop position feedback on the spool (available on high-end valves) is the most effective mitigation.

## In Practice

- **Valve flow rate changes with temperature even though PWM duty is constant.** Coil resistance increases with temperature, reducing current at a fixed duty cycle. At 50 °C above ambient, a copper coil's resistance increases by ~20 %, dropping current by ~17 %. Switching to closed-loop current control eliminates the temperature dependence.

- **Valve spool sticks at low flow commands and then jumps to a higher flow.** Static friction (stiction) in the valve body prevents smooth spool movement. The solenoid force must exceed the stiction threshold before the spool moves, and then the dynamic friction is lower — the spool overshoots. Adding dithering provides continuous micro-vibration that prevents the spool from sticking.

- **Proportional control works in one direction but not the other (for bidirectional valves).** The dither frequency or amplitude is tuned for one spring stiffness direction but not the opposing one. Bidirectional proportional valves often have asymmetric spring rates. Separate dither parameters for each direction resolve the asymmetry.

- **Audible buzzing from the solenoid at a specific duty cycle.** The PWM frequency is in the audible range, and the plunger oscillates at the PWM carrier frequency. This is most noticeable at 40–60 % duty where the current ripple is highest. Increasing the PWM frequency (within the valve's response bandwidth) or adding an LC filter on the solenoid power line reduces the buzz.
