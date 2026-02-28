---
title: "Inrush Limiting & eFuses"
weight: 30
---

# Inrush Limiting & eFuses

When a power source connects to a circuit with large capacitors on the input rail, the initial charging current can spike to tens of amps for a brief period. A 1000µF capacitor bank charged through a 50mΩ source impedance path draws an initial peak current of I = V/R = 5V / 0.05Ω = 100A. This inrush current welds connector pins, trips upstream fuses, causes voltage sags on shared power buses, and stresses input capacitors beyond their ripple current rating. Inrush limiting circuits control the rate of current rise during power-on to keep peak current within safe bounds.

## The Inrush Problem

The fundamental equation governing capacitive inrush is:

```
I_inrush = C * dV/dt
```

For a step voltage change (plugging into a live supply), dV/dt is limited only by source impedance and wiring resistance. A USB port with 100mΩ total path resistance supplying a board with 100µF of input capacitance produces:

```
I_peak = 5V / 0.1Ω = 50A
τ = R * C = 0.1Ω * 100µF = 10µs
```

The 50A spike lasts only microseconds, but it exceeds the USB specification's inrush limit of 100µF (USB 2.0) and can cause the upstream port to fold back or reset. For larger capacitor banks (1000µF on a 12V industrial rail), peak currents reach hundreds of amps and can damage connectors rated for only 5–10A continuous.

## NTC Thermistor Inrush Limiting

A negative temperature coefficient (NTC) thermistor in series with the power input provides passive inrush limiting. At power-on, the thermistor is at ambient temperature and presents its full cold resistance — typically 5–50Ω depending on the part. This resistance limits the initial current spike: I_peak = Vin / R_cold. As the thermistor self-heats from the continuous operating current, its resistance drops to 10–20% of the cold value, reducing steady-state voltage drop and power dissipation.

Common NTC thermistors for inrush limiting:

| Part | R_cold (25°C) | R_hot (steady state) | I_max | Application |
|------|---------------|----------------------|-------|-------------|
| Ametherm SL10 5R020 | 5Ω | 0.3Ω | 2A | 5V/2A supplies |
| Ametherm SL22 10R015 | 10Ω | 0.7Ω | 1.5A | 12V/1A systems |
| EPCOS B57236S0100M | 10Ω | 0.5Ω | 4A | 12–24V industrial |
| Ametherm SL32 2R025 | 2Ω | 0.1Ω | 5A | Higher current, lower limiting |

**Limitation:** If the power is cycled rapidly (disconnected and reconnected within seconds), the thermistor is still hot and provides minimal inrush protection on the second connection. The thermal time constant of most NTC inrush limiters is 30–90 seconds — full cold resistance is only restored after the thermistor cools to ambient. This makes NTC thermistors unsuitable for hot-plug applications where the connector may be repeatedly inserted and removed.

## Active Inrush Limiting with MOSFET Soft-Start

An N-channel MOSFET (or P-channel, depending on high-side vs low-side placement) can serve as a controlled inrush limiter by ramping its gate voltage slowly at power-on. The MOSFET operates in its linear (saturation) region during the ramp, acting as a variable resistance that limits current flow.

The basic circuit uses an RC network on the gate:

```
VIN ──┬──[R_charge]──┬── Gate
      │              │
      │          [C_gate]
      │              │
      GND ───────────┘

Gate voltage ramps as: Vg(t) = Vin * (1 - e^(-t / (R * C)))
```

With R_charge = 100kΩ and C_gate = 100nF, the time constant is 10ms. The MOSFET transitions through its linear region over several milliseconds, allowing the output capacitors to charge gradually. A 10kΩ gate discharge resistor ensures the FET turns off when power is removed.

For a high-side P-FET soft-start, the same principle applies with inverted polarity — the gate ramps from Vin toward ground, controlling the turn-on rate. The SI4435DDY (P-channel, 30V, 8.8A, 20mΩ) is commonly used in this configuration for 5V and 12V systems.

## eFuse ICs

Electronic fuse (eFuse) ICs integrate MOSFET power switch, current sensing, soft-start control, and fault protection into a single device. They replace the combination of a discrete MOSFET, gate drive circuit, current sense resistor, and comparator with a single IC and a few configuration resistors.

### TPS2596 (Texas Instruments)

The TPS2596 is a full-featured eFuse suitable for 2.7–19V rails at up to 4A:

- **Adjustable current limit:** Set by a single resistor on the ILIM pin. R_ILIM = 4430 / I_limit (in ohms, for I_limit in amps). For a 2A limit: R_ILIM = 2.2kΩ.
- **Overvoltage protection (OVP):** The OV pin threshold, set by a resistor divider, disconnects the load when input voltage exceeds the setpoint. For 6V OVP on a 5V rail: R_top = 100kΩ, R_bottom = 200kΩ (threshold = 1.22V * (1 + R_top/R_bottom) ≈ 6.1V).
- **Undervoltage lockout (UVLO):** The UV pin prevents connection until input voltage is sufficient, preventing operation from a sagging supply.
- **Thermal shutdown:** Internal temperature monitoring disconnects the load if the junction reaches 150°C.
- **Soft-start:** An external capacitor on the dVdT pin controls output voltage slew rate. C_dVdT = 50nF gives approximately 5ms rise time.
- **Fault response timer:** A capacitor on the TIMER pin sets the fault blanking period. C_TIMER = 100nF provides approximately 10ms of overcurrent tolerance before latching off.

```c
/* TPS2596 configuration example — 5V rail, 2A limit, 6V OVP */
/* Component values: */
/* R_ILIM = 2.2kΩ (sets 2A current limit) */
/* C_dVdT = 47nF (soft-start ~5ms) */
/* C_TIMER = 100nF (10ms fault blanking) */
/* OVP divider: 100kΩ / 200kΩ (6.1V trip) */
/* UVLO divider: 100kΩ / 220kΩ (4.0V enable) */

/* Firmware reads FLT (fault) output via GPIO interrupt: */
void EXTI_IRQHandler(void) {
    if (EXTI->PR & EFUSE_FLT_PIN) {
        EXTI->PR = EFUSE_FLT_PIN;  /* Clear pending */
        /* Log fault event — eFuse has latched off */
        fault_log_write(FAULT_EFUSE_OC, systick_ms());
        /* Optionally toggle EN pin to retry after delay */
        efuse_retry_after_ms(500);
    }
}
```

### MAX14525 (Maxim/Analog Devices)

The MAX14525 is a simpler eFuse in a SOT-23-5 package for space-constrained designs:

- Fixed 2.5A current limit (no external resistor needed)
- 2.5–5.5V operating range
- Internal 2ms soft-start (no external capacitor)
- Thermal shutdown at 160°C
- Active-low fault output

The minimal external component count (just input and output capacitors) makes this device suitable for USB peripheral power protection and small battery-powered boards.

### TPS25944 (Texas Instruments)

The TPS25944 is a dual-input eFuse / power multiplexer that selects between two supply inputs with priority-based switchover:

- Two independent input channels, each with current limiting and OVP
- Priority input selection with configurable switchover threshold
- 2.5–22V, up to 5.5A per channel
- Break-before-make switching prevents cross-conduction
- Ideal for battery-plus-USB or primary-plus-backup supply architectures

## eFuse vs Passive Protection Comparison

| Feature | NTC Thermistor | Discrete MOSFET | eFuse IC |
|---------|---------------|-----------------|----------|
| Inrush limiting | Moderate (R_cold) | Excellent (controlled ramp) | Excellent (configurable dV/dt) |
| Overcurrent protection | None | Requires external sense | Integrated, adjustable |
| Overvoltage protection | None | None | Integrated (some parts) |
| Repeated hot-plug | Poor (thermal recovery) | Excellent | Excellent |
| Component count | 1 | 5–8 | 3–5 |
| Board area | Small | Moderate | Small to moderate |
| Cost | $0.10–0.30 | $0.50–2.00 | $0.80–3.00 |
| Quiescent current | None | Depends on circuit | 10–200µA |

## Hot-Plug Design Considerations

Hot-plug applications — USB devices, PCIe cards, field-replaceable modules — impose the most demanding inrush requirements. The connector must survive the initial current spike, the upstream supply must not droop below regulation, and downstream ICs must see a clean, monotonic voltage ramp.

Key design rules for hot-plug circuits:

1. **Limit peak inrush to connector rating** — A USB Micro-B connector rated for 1A continuous should not see 50A inrush spikes, even for microseconds. Repeated high-current events erode the contact plating.
2. **Control dV/dt on output** — Downstream regulators and ICs may have maximum input voltage slew rate specifications. The TPS2596's dVdT pin directly controls this.
3. **Handle pre-charge of output capacitors** — If the output has large capacitance (100µF or more), the eFuse's soft-start must be configured for a ramp time long enough that I = C * dV/dt stays within the current limit.
4. **Fault retry strategy** — After a fault (overcurrent, thermal), the eFuse latches off. Firmware must decide whether to retry (with a delay) or remain off and signal an error. Infinite retry loops on a persistent fault waste power and can overheat the eFuse.

## Tips

- For hot-plug USB applications, an eFuse (TPS2596 or MAX14525) is strongly preferred over an NTC thermistor — NTC recovery time after power cycling is too slow for repeated plug/unplug events
- Size the TPS2596 current limit 20–30% above the maximum steady-state load current to avoid nuisance trips during normal load transients while still protecting against genuine faults
- Set the soft-start ramp time so that the inrush current (I = C_load * dV/dt_ramp) stays below 80% of the eFuse current limit — this provides margin for component tolerance
- Add a 100nF capacitor close to the eFuse input pin to suppress high-frequency transients from connector contact bounce during hot-plug events
- Use the eFuse fault output to log overcurrent events in firmware — repeated faults at a specific port indicate a wiring problem or defective peripheral

## Caveats

- **NTC thermistors provide no protection on rapid power cycling** — If the supply is disconnected and reconnected within a few seconds, the thermistor is still warm and provides minimal current limiting
- **eFuse current limit accuracy degrades at temperature extremes** — The TPS2596 current limit tolerance is ±15% at 25°C but can widen to ±20% at 85°C; design the limit setpoint with this tolerance in mind
- **Soft-start time that is too long can cause downstream regulator timeout** — Some LDOs and switching regulators have internal soft-start timers that expect input voltage to stabilize within a specific window; if the eFuse ramps too slowly, the regulator may fault
- **The eFuse MOSFET operates in its linear region during soft-start** — It dissipates P = Vds * Id during this interval, which can reach several watts; the ramp must be fast enough that the MOSFET does not overheat during the transition
- **Latch-off eFuses require deliberate firmware action to re-enable** — If the EN pin is tied high and the fault clears, the eFuse remains off until EN is cycled; designs that expect auto-retry must use eFuse variants with auto-retry or implement the EN toggle in firmware

## In Practice

- A USB hub that resets or drops devices when a new peripheral is plugged into an adjacent port is typically experiencing inrush-induced voltage sag on the shared 5V bus — adding a TPS2596 on each downstream port isolates the inrush and prevents cross-port interference
- A 12V industrial sensor module that blows its input fuse on every power-on has excessive input capacitance (often 470µF or more) drawing an inrush spike that exceeds the fuse's I²t rating — adding an eFuse with controlled soft-start solves the problem without upsizing the fuse
- A battery-powered device that shows lower-than-expected battery life despite correct sleep current measurements often has an eFuse with 50–100µA quiescent current that dominates during sleep — selecting a lower-Iq eFuse or bypassing it during sleep with a parallel MOSFET recovers the lost standby time
- A hot-swap module that works on the bench but fails during vibration testing is experiencing connector contact bounce — the repeated connect/disconnect events trigger the eFuse's fault latch, requiring a firmware retry mechanism to recover
- A board with an NTC inrush limiter that passes initial testing but fails in the field during rapid power cycling (such as a relay-controlled outlet) is hitting the NTC while it is still hot — replacing the NTC with an active eFuse eliminates the thermal recovery dependency
