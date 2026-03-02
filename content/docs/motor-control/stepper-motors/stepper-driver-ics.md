---
title: "Stepper Driver ICs"
weight: 50
---

# Stepper Driver ICs

Dedicated stepper driver ICs handle the complex task of regulating coil current, generating microstep waveforms, and protecting the motor and driver from overcurrent, overtemperature, and short circuits. The three most common drivers in hobbyist and light-industrial embedded work are the Allegro A4988, Texas Instruments DRV8825, and Trinamic TMC2209. Each occupies a different point in the cost/feature/performance space.

## Feature Comparison

| Feature | A4988 | DRV8825 | TMC2209 |
|---------|-------|---------|---------|
| Max voltage | 35 V | 45 V | 29 V |
| Max current (RMS) | 2.0 A | 2.5 A | 2.0 A (with heatsink) |
| Microstep resolution | 1/16 | 1/32 | 1/256 (interpolated) |
| Current regulation | Fixed off-time chopper | Slow/mixed/fast decay | SpreadCycle / StealthChop |
| UART/SPI interface | No | No | UART (single-wire) |
| Stall detection | No | No | StallGuard |
| Automatic current reduction | No | No | CoolStep |
| Thermal shutdown | Yes | Yes | Yes |
| Package | QFN-28 | QFN-28 | QFN-28 |
| Typical module cost | $1–2 | $2–3 | $4–7 |

## A4988 Configuration

The A4988 is the entry-level chopper driver. Current limit is set with a trimpot that adjusts the reference voltage:

```
I_max = V_ref / (8 × R_sense)
```

Typical modules have R_sense = 0.068 Ω:

| V_ref | I_max (per phase) |
|-------|-------------------|
| 0.5 V | 0.92 A |
| 0.7 V | 1.29 A |
| 1.0 V | 1.84 A |

Measure V_ref between the trimpot wiper and ground with a multimeter while adjusting.

### Wiring

```
VMOT ─── Motor supply (8–35 V)
GND  ─── Ground (motor + logic)
VDD  ─── Logic supply (3.3–5 V)
1A/1B ── Motor coil A
2A/2B ── Motor coil B
STEP  ── Step input from MCU
DIR   ── Direction input from MCU
EN    ── Enable (active low, internal pull-down)
MS1/MS2/MS3 ── Microstep selection
```

## DRV8825 Configuration

The DRV8825 extends voltage range to 45 V and adds 1/32 microstepping. Current limit:

```
I_max = V_ref / (5 × R_sense)
```

With typical R_sense = 0.1 Ω:

| V_ref | I_max (per phase) |
|-------|-------------------|
| 0.5 V | 1.0 A |
| 0.75 V | 1.5 A |
| 1.0 V | 2.0 A |

The DRV8825 is a drop-in upgrade for the A4988 on most breakout boards, but note the different current-limit formula and the slower minimum pulse width (1.9 µs vs 1.0 µs).

## TMC2209 Configuration

The TMC2209 represents a generation leap in stepper driver technology. Key differentiators:

### UART Configuration

A single-wire UART interface allows runtime configuration of all parameters:

```c
/* TMC2209 UART communication — single wire, directly to MCU UART TX/RX via 1 kΩ */
void tmc2209_init(void) {
    /* Set RMS current to 1.2 A */
    tmc2209_write(IHOLD_IRUN, (8 << 0) |   /* IHOLD: hold current (0–31) */
                               (20 << 8) |  /* IRUN: run current (0–31) */
                               (5 << 16));  /* IHOLDDELAY: ramp-down time */

    /* Enable StealthChop */
    tmc2209_write(GCONF, (1 << 2));  /* en_spreadcycle = 0 → StealthChop */

    /* Configure StallGuard threshold */
    tmc2209_write(SGTHRS, 60);

    /* Enable CoolStep (automatic current reduction) */
    tmc2209_write(COOLCONF, (1 << 0) |   /* semin: CoolStep lower threshold */
                             (2 << 8));   /* semax: CoolStep upper threshold */
}
```

### StealthChop vs SpreadCycle

| Mode | Noise Level | Torque | Best For |
|------|------------|--------|----------|
| StealthChop | Very quiet | ~80 % of SpreadCycle | Low speed, consumer products, 3D printers |
| SpreadCycle | Moderate (traditional chopper noise) | Maximum | High speed, high load, CNC |

### StallGuard / CoolStep

**StallGuard** monitors back-EMF to detect stall conditions without an encoder. The DIAG pin asserts when the motor approaches stall, enabling sensorless homing and stall recovery.

**CoolStep** dynamically reduces motor current when the load is light and increases it when the load grows. This reduces power consumption and heat in variable-load applications. CoolStep requires SpreadCycle mode — it does not work with StealthChop.

### UART Addressing

Up to four TMC2209 drivers can share a single UART line using the MS1/MS2 pins as address selectors:

| MS1 | MS2 | UART Address |
|-----|-----|-------------|
| Low | Low | 0 |
| High | Low | 1 |
| Low | High | 2 |
| High | High | 3 |

## Thermal Considerations

All three drivers have thermal shutdown protection, but the thermal design of the breakout board determines the practical current limit:

| Driver | Package Thermal Resistance | Practical Limit Without Heatsink | With Small Heatsink |
|--------|---------------------------|--------------------------------|-------------------|
| A4988 | ~30 °C/W (QFN) | ~1.0 A | ~1.5 A |
| DRV8825 | ~35 °C/W (QFN) | ~1.0 A | ~1.8 A |
| TMC2209 | ~30 °C/W (QFN) | ~1.0 A | ~1.5–2.0 A |

At 2 A per phase with a 12 V supply and typical 0.3 Ω RDS(on), each FET dissipates ~1.2 W, plus switching and chopper losses. Without airflow, heatsinks on the IC package are essential above 1 A.

## Tips

- Start with the TMC2209 for new designs unless cost is the primary constraint. UART configuration, StealthChop, and StallGuard provide capabilities that save significant development time compared to bare A4988/DRV8825.
- Set the current limit with the motor at standstill and the driver energized. Measure motor temperature after 10 minutes — if the case exceeds 60 °C, reduce the current. The motor is more efficient running slightly below rated current.
- Add a 100 µF electrolytic capacitor directly at each driver's VMOT pin, in addition to any bulk supply capacitance. Inductive switching transients can exceed the driver's absolute maximum voltage without local decoupling.
- For TMC2209 UART, use a 1 kΩ series resistor between the MCU TX and the driver's single-wire UART pin. This prevents bus contention when both the MCU and driver try to drive the line simultaneously.

## Caveats

- The A4988 and DRV8825 have no diagnostic feedback — missed steps, overtemperature warnings, and open/shorted coils produce no signal to the MCU. The first indication of a problem is incorrect motion or a dead driver.
- TMC2209 StallGuard requires SpreadCycle mode and a minimum speed (~100 RPM). StealthChop with StallGuard is not reliably supported — the back-EMF measurement depends on the chopper mode.
- Cheap A4988 modules from different manufacturers have different R_sense values (0.050 Ω, 0.068 Ω, 0.100 Ω). Using the wrong formula for the installed R_sense results in overcurrent or undercurrent. Always check the physical resistor marking.
- VMOT supply must be present before or simultaneously with VDD logic supply. Powering VDD without VMOT can latch the driver in an undefined state, requiring a power cycle to recover.

## In Practice

- **Motor runs much hotter on one driver board than another of the "same" type.** Different A4988 module batches use different R_sense resistors. The trimpot set for 1.5 A on one board may produce 2.0 A on another. Measuring V_ref and recalculating I_max for the actual R_sense value identifies the mismatch.

- **TMC2209 UART communication fails intermittently.** The single-wire UART protocol requires a pull-up resistor (1 kΩ to VDD) and the 1 kΩ series resistor on the MCU TX pin. Missing either causes bus contention or floating-line reads. Checking the idle-state voltage (should be high) with an oscilloscope reveals the issue.

- **Motor makes a high-pitched whine at standstill with DRV8825.** The DRV8825's chopper decay mode interacts with certain motor inductances to produce audible chopper noise. Adjusting the decay mode (by modifying the DECAY pin setting on boards that expose it) or switching to a TMC2209 in StealthChop mode eliminates the noise.

- **StallGuard triggers false stall detections during acceleration.** The load torque during acceleration is higher than during cruise, and the StallGuard threshold tuned for steady-state running trips during ramp-up. Either increasing the threshold during acceleration or disabling StallGuard until cruise speed is reached prevents the false triggers.
