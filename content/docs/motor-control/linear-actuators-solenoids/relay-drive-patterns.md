---
title: "Relay Drive Patterns"
weight: 40
---

# Relay Drive Patterns

A relay is a solenoid that switches electrical contacts rather than moving a mechanical load. The coil circuit (driven by the MCU through a transistor) and the contact circuit (carrying the load current) are galvanically isolated — this is the relay's primary value. Relays switch mains power, high-current DC loads, and analog signals that semiconductors cannot handle or where isolation is required. The drive considerations are identical to solenoid circuits (inductive coil, flyback protection), with the added complexity of contact management: bounce, arcing, and welding.

## Relay Types

| Type | Coil Voltage | Contact Rating | Switching Speed | Life (mechanical) |
|------|-------------|---------------|----------------|-------------------|
| Signal relay (HFD4) | 3.3–5 V | 2 A @ 30 VDC | 2–5 ms | 10⁷ cycles |
| Power relay (SRD-05VDC) | 5 V | 10 A @ 250 VAC | 5–10 ms | 10⁵ cycles |
| Automotive relay (typical) | 12 V | 30–40 A @ 14 VDC | 5–15 ms | 10⁵ cycles |
| Latching relay | 3.3–5 V pulse | Various | 3–10 ms | 10⁶ cycles |
| SSR (solid-state relay) | 3–32 VDC control | 2–40 A AC | < 1 ms (zero-cross) | Unlimited (no contacts) |

## Coil Drive Circuit

Relay coils draw 30–150 mA for signal relays and 50–200 mA for power relays — too much for direct GPIO drive. A transistor (NPN BJT or N-MOSFET) switches the coil:

### NPN BJT Drive

```
V_coil ──── Relay coil ──┬── D1 (flyback) ── V_coil
                         │
                    NPN collector
                         │
            MCU GPIO ── 1 kΩ ── NPN base
                         │
                    NPN emitter ── GND
```

```c
/* Base resistor calculation for 2N2222 driving a 5 V / 70 mA relay coil */
/* R_base = (V_GPIO - V_BE) / (I_coil / h_FE_min) */
/* R_base = (3.3 - 0.7) / (0.070 / 50) = 1857 Ω → use 1.0–1.5 kΩ for margin */
```

### N-MOSFET Drive

For 3.3 V GPIO with logic-level MOSFETs:

```
V_coil ──── Relay coil ──┬── D1 (flyback) ── V_coil
                         │
                    MOSFET drain
                         │
            MCU GPIO ── MOSFET gate
                         │
                    MOSFET source ── GND
                         │
                    10 kΩ pull-down ── GND
```

MOSFETs are preferred over BJTs for 3.3 V logic because there is no base current requirement and no VBE drop. A logic-level MOSFET (IRLML6344, 2N7002) fully enhances at 3.3 V.

## Contact Protection

When relay contacts switch inductive or capacitive loads, arcing occurs at the contact gap. Arcing erodes contact material, reduces contact life, and generates EMI. Protection circuits suppress the arc:

### DC Load Protection

A flyback diode across the DC load (same as for any inductive load) prevents voltage spikes:

```
Relay contact ── DC load (motor, solenoid) ── Return
                     │
                D_flyback (across load)
```

### AC Load Protection (RC Snubber)

For AC loads, an RC snubber across the contacts limits the voltage rise rate (dV/dt) at contact opening:

```
Relay contact ──┬── Load ── Neutral
                │
           R (100 Ω) + C (100 nF)  series, across contacts
```

The RC values depend on the load. For resistive loads, the snubber is optional. For inductive AC loads (motors, transformers), it is essential for contact life.

## Contact Bounce

Mechanical relay contacts bounce — they make and break contact several times over 1–5 ms before settling. This is critical for applications where the microcontroller reads the relay's state:

| Relay Type | Bounce Duration | Bounces |
|-----------|----------------|---------|
| Signal relay | 0.5–2 ms | 3–10 |
| Power relay | 2–5 ms | 5–20 |

For digital logic downstream of a relay contact, debouncing (hardware RC + Schmitt trigger, or software delay) is required.

## Solid-State Relays (SSRs)

SSRs use semiconductor switches (TRIAC for AC, MOSFET for DC) instead of mechanical contacts. No coil, no flyback diode, no contact bounce:

| Feature | Mechanical Relay | Solid-State Relay |
|---------|-----------------|-------------------|
| Isolation | Galvanic (air gap) | Optical (LED + photodetector) |
| On-resistance | < 50 mΩ (metal contacts) | 10–100 mΩ (MOSFET) |
| Off-state leakage | Zero | 1–10 mA (TRIAC snubber leakage) |
| Switching speed | 5–15 ms | < 1 ms (zero-cross: half cycle) |
| Voltage drop (on) | ~0 V | 1.0–1.5 V (TRIAC); 0.1–0.5 V (MOSFET) |
| Life | 10⁵–10⁷ cycles (contact wear) | Unlimited (no wear) |
| Failure mode | Contacts weld closed (fails closed) | Semiconductor short (fails closed) |

SSR considerations:
- **Heat:** The on-state voltage drop creates heat (1.5 V × 10 A = 15 W). A heatsink is mandatory for loads > 3 A.
- **Leakage current:** TRIAC-based AC SSRs have 1–10 mA leakage in the off state. This can keep low-power LED loads dimly lit.
- **Zero-cross switching:** Most AC SSRs switch at the AC zero crossing to minimize EMI. This adds up to one half-cycle (10 ms at 50 Hz) of latency.

## Latching Relays

A latching relay maintains its contact position without continuous coil current — a pulse sets it, a pulse on a second coil (or reversed polarity) resets it. Ideal for battery-powered applications:

```c
/* Set latching relay */
HAL_GPIO_WritePin(RELAY_SET_PORT, RELAY_SET_PIN, GPIO_PIN_SET);
HAL_Delay(20);  /* 10–50 ms pulse */
HAL_GPIO_WritePin(RELAY_SET_PORT, RELAY_SET_PIN, GPIO_PIN_RESET);

/* Reset latching relay */
HAL_GPIO_WritePin(RELAY_RESET_PORT, RELAY_RESET_PIN, GPIO_PIN_SET);
HAL_Delay(20);
HAL_GPIO_WritePin(RELAY_RESET_PORT, RELAY_RESET_PIN, GPIO_PIN_RESET);
```

Latching relays have unknown state at power-on — firmware must either sense the contact state or set a known state during initialization.

## Tips

- Always use a flyback diode across the relay coil. Even "relay modules" from popular hobby suppliers sometimes lack adequate protection on the coil side.
- For switching mains AC, use relays rated for AC with appropriate contact spacing (creepage/clearance). DC-rated relays may not safely interrupt AC arcs.
- Place a 100 nF capacitor directly across the relay coil to suppress the brief voltage spike at the MCU GPIO. Even with a flyback diode, the switching transient can propagate through the transistor to the GPIO pin.
- For high-reliability applications, monitor the relay contact state with an auxiliary input (read the contact position, not just the coil drive signal). This detects welded contacts, coil failure, and wiring faults.

## Caveats

- Relay contacts can weld shut when switching high-inrush loads (motors, capacitive supplies). The initial contact closure carries the full inrush current through a very small contact area, generating enough heat to fuse the contacts. Contact ratings assume resistive loads — derate by 50 % or more for inductive or capacitive loads.
- Relay coil current may exceed the GPIO sink capability of the switching transistor. A 12 V relay with 150 Ω coil draws 80 mA — safe for a 2N2222 but too much for a 2N7002 (which saturates at ~115 mA). Check the transistor's SOA.
- SSR off-state leakage can hold contactors, solenoids, or LED loads partially on. Testing with the actual load verifies that the leakage is below the load's turn-off threshold.
- The relay's specified contact life (e.g., 100,000 cycles at 10 A) assumes resistive loads. With inductive loads, contact life may be 10–50× shorter due to arcing. Adding contact protection (snubber, MOV) dramatically extends life.

## In Practice

- **Relay clicks but the load does not turn on.** Oxidized or pitted relay contacts create high resistance. The coil activates (audible click) but the contacts do not make a low-resistance connection. Measuring contact resistance with a multimeter — or detecting the voltage drop across the contacts under load — reveals the degradation. Replacing the relay is the standard fix; contact cleaning is a temporary measure.

- **LED load stays dimly lit when the SSR is "off."** The SSR's off-state leakage current (typically 2–5 mA for TRIAC-based SSRs) is enough to forward-bias the LED. Adding a bleeder resistor (10–47 kΩ) across the load provides a current path that drops the voltage below the LED's forward voltage.

- **MCU resets when the relay switches a large inductive load.** Despite the flyback diode on the relay coil, the load-side switching transient couples through the relay's internal capacitance (coil-to-contact) and through shared ground paths into the MCU power supply. Additional decoupling on the MCU power pins (100 µF + 100 nF) and separating the relay ground from the MCU ground at the power supply resolve the resets.

- **Relay contacts weld after switching a motor a few thousand times.** The motor's inrush current (5–10× running current) exceeds the relay's contact rating during closure. The contacts momentarily bounce, arcing at each bounce while carrying the high inrush current. Adding an NTC inrush limiter in series with the motor reduces the initial current spike and extends contact life.
