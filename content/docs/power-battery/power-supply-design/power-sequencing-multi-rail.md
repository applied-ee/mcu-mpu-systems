---
title: "Power Sequencing — Multi-Rail"
weight: 40
---

# Power Sequencing — Multi-Rail

Most embedded systems require more than one supply voltage. A typical Cortex-M7 design needs 1.8 V for the core, 3.3 V for I/O, and possibly 5 V for external peripherals. The order in which these rails turn on — and off — matters. Powering I/O pins before the core is ready can drive current into unpowered logic through ESD protection diodes, triggering latch-up. Removing core power while I/O rails remain active can force outputs into undefined states, back-driving connected devices. Power sequencing ensures every rail comes up and goes down in the correct order, with the correct timing, to prevent damage and undefined behavior.

## Why Sequencing Matters

### Latch-Up

CMOS ICs contain parasitic PNPN thyristor structures (formed by the N-well and P-substrate). If a signal pin is driven above VDD or below VSS by more than a diode drop (~0.6 V), current flows through these parasitic structures and can trigger latch-up — a low-impedance path from VDD to VSS that persists until power is removed. In a multi-rail system, if the 3.3 V I/O rail is active but the 1.8 V core rail is still at 0 V, a 3.3 V signal on an I/O pin can forward-bias the internal ESD diode to the unpowered core supply, injecting current into the substrate and potentially triggering latch-up.

The classic rule: **core supply first, I/O supply second.** On power-down, the reverse: **I/O supply off first, core supply off last.**

### I/O Contention

When a microcontroller or FPGA has no core power, its I/O pins are typically in a high-impedance state — but the ESD protection diodes still conduct. If an external device drives a signal into the unpowered IC through the I/O supply rail, current flows from the signal pin through the ESD diode to the I/O supply pin, effectively back-powering the chip through its I/O rail. This can cause indeterminate startup behavior, increased leakage, and in some cases permanent damage.

### Data Corruption

Flash memory and EEPROM require stable supply voltages during write operations. If a write cycle is in progress and a supply rail drops below the minimum operating voltage, the write may complete with corrupted data — or worse, corrupt the flash sector table. Brownout detectors (BOD/BOR) on the MCU guard against this, but only if they are active and the supply ramp-down is gradual enough for the BOD to react.

## Enable-Chain Sequencing

The simplest and most common sequencing method connects the power-good (PG or PGOOD) output of one regulator to the enable (EN) input of the next. This creates a daisy chain where each rail must be stable before the next one starts.

```
           ┌─────────┐       ┌─────────┐       ┌─────────┐
Battery ──▶│ Reg A    │──PG──▶│ Reg B    │──PG──▶│ Reg C    │
           │ 1.8V Core│       │ 3.3V I/O │       │ 5.0V Ext │
           └─────────┘       └─────────┘       └─────────┘
```

### Power-Good (PG) Signal Behavior

The PG output is typically an open-drain MOSFET that pulls low when the output voltage is below the regulation threshold (usually 90–95 % of the target) and releases (goes high-impedance) when the output is in regulation. A pull-up resistor (10 kΩ–100 kΩ to the upstream rail or to a logic supply) is required. Key timing parameters:

| Parameter | Typical Value | Notes |
|-----------|--------------|-------|
| PG assertion delay | 50–500 µs after Vout reaches threshold | IC-dependent; allows output to stabilize |
| PG deassertion delay | 5–50 µs after Vout drops below threshold | Fast, to signal fault quickly |
| PG threshold (rising) | 92–95 % of Vout nominal | Hysteresis prevents chatter |
| PG threshold (falling) | 88–92 % of Vout nominal | Lower than rising threshold |
| PG sink current | 1–5 mA max | Limits pull-up resistor minimum value |

When Reg A's PG goes high, Reg B's EN is asserted, starting its soft-start ramp. After Reg B's output stabilizes and its own PG asserts, Reg C enables. The total sequencing time is the sum of each regulator's soft-start plus PG delay:

```
T_total = (T_ss_A + T_pg_A) + (T_ss_B + T_pg_B) + (T_ss_C + T_pg_C)
```

For typical micro-buck converters with 0.5–1 ms soft-start and 100 µs PG delay, a three-rail sequence completes in approximately 2–4 ms.

### Enable-Chain Schematic Example

For a TPS62802 (1.8 V, Reg A) followed by a TPS62568 (3.3 V, Reg B):

```
TPS62802 PG pin ──┬── 100 kΩ pull-up to 1.8 V output
                   │
                   └── TPS62568 EN pin
```

The 100 kΩ pull-up ensures the EN pin sees 1.8 V (above the TPS62568's 0.7 V enable threshold) when PG releases. When PG pulls low (output fault or shutdown), EN is pulled to ground, disabling the downstream regulator.

## RC Delay on Enable Pins

For cases where no PG signal is available (or where additional delay is needed), an RC network on the enable pin creates a time delay:

```
Vin ──── R ──┬── EN
             │
             C
             │
            GND
```

The EN pin voltage rises as an exponential: V_EN(t) = Vin × (1 − e^(−t/RC)). The regulator enables when V_EN reaches the enable threshold V_th. The delay time is:

```
t_delay = −RC × ln(1 − V_th / Vin)
```

For R = 100 kΩ, C = 100 nF, V_th = 0.7 V, Vin = 3.3 V:

```
t_delay = −100e3 × 100e-9 × ln(1 − 0.7/3.3)
        = −0.01 × ln(0.788)
        = −0.01 × (−0.238)
        = 2.38 ms
```

This approach is simple but imprecise — component tolerances on R and C are typically ±10 %, and the enable threshold varies ±15 % across temperature. For critical sequencing (FPGA power-up, DDR memory), the enable-chain method using PG signals is more reliable.

### Ramp Rate Control

Some ICs specify a maximum supply ramp rate (dV/dt) to prevent internal latch-up during power-up. For example, many Xilinx FPGAs require the core supply to ramp at no more than 50 mV/µs. A regulator with a 1 ms soft-start ramping from 0 V to 1.8 V produces:

```
dV/dt = 1.8 V / 1 ms = 1.8 mV/µs
```

This is well within the 50 mV/µs limit. However, a regulator with a 100 µs soft-start would produce 18 mV/µs — still acceptable but approaching the limit. A hot-swap event (connecting a pre-charged capacitor to the supply) can produce ramp rates of 100+ mV/µs, requiring explicit inrush limiting.

## GPIO-Controlled Sequencing

When an MCU controls the power sequencing for downstream devices, the EN pins of subordinate regulators connect to MCU GPIO outputs. This provides programmable sequencing with precise timing, fault monitoring, and the ability to power-cycle individual subsystems without affecting others.

```c
/* Power sequencing for a multi-rail system:
   1.8 V core (always on via enable-chain from battery)
   3.3 V I/O (GPIO-controlled)
   5.0 V peripheral (GPIO-controlled, after 3.3 V stable) */

#define EN_3V3_PIN    GPIO_PIN_4    /* PA4 → 3.3V regulator EN */
#define EN_5V0_PIN    GPIO_PIN_5    /* PA5 → 5.0V regulator EN */
#define PG_3V3_PIN    GPIO_PIN_6    /* PA6 ← 3.3V regulator PG (input) */
#define PG_5V0_PIN    GPIO_PIN_7    /* PA7 ← 5.0V regulator PG (input) */

typedef enum {
    SEQ_OK = 0,
    SEQ_3V3_FAULT,
    SEQ_5V0_FAULT,
    SEQ_TIMEOUT
} seq_status_t;

seq_status_t power_sequence_up(void) {
    /* Enable 3.3V rail */
    HAL_GPIO_WritePin(GPIOA, EN_3V3_PIN, GPIO_PIN_SET);

    /* Wait for 3.3V PG with timeout */
    uint32_t start = HAL_GetTick();
    while (HAL_GPIO_ReadPin(GPIOA, PG_3V3_PIN) == GPIO_PIN_RESET) {
        if ((HAL_GetTick() - start) > 50) {  /* 50 ms timeout */
            HAL_GPIO_WritePin(GPIOA, EN_3V3_PIN, GPIO_PIN_RESET);
            return SEQ_3V3_FAULT;
        }
    }

    /* Delay between rails (1 ms minimum) */
    HAL_Delay(2);

    /* Enable 5.0V rail */
    HAL_GPIO_WritePin(GPIOA, EN_5V0_PIN, GPIO_PIN_SET);

    /* Wait for 5.0V PG with timeout */
    start = HAL_GetTick();
    while (HAL_GPIO_ReadPin(GPIOA, PG_5V0_PIN) == GPIO_PIN_RESET) {
        if ((HAL_GetTick() - start) > 50) {
            /* Fault: disable both rails in reverse order */
            HAL_GPIO_WritePin(GPIOA, EN_5V0_PIN, GPIO_PIN_RESET);
            HAL_Delay(1);
            HAL_GPIO_WritePin(GPIOA, EN_3V3_PIN, GPIO_PIN_RESET);
            return SEQ_5V0_FAULT;
        }
    }

    return SEQ_OK;
}

void power_sequence_down(void) {
    /* Reverse order: 5.0V off first, then 3.3V */
    HAL_GPIO_WritePin(GPIOA, EN_5V0_PIN, GPIO_PIN_RESET);
    HAL_Delay(2);  /* Allow 5V rail to discharge */
    HAL_GPIO_WritePin(GPIOA, EN_3V3_PIN, GPIO_PIN_RESET);
}
```

GPIO-controlled sequencing adds flexibility — the MCU can implement retry logic, log fault events, and selectively power-cycle subsystems. The downside is that the MCU itself must be powered before it can sequence other rails, so the MCU's own supply typically uses a simple enable-chain from the battery.

## Timing Requirements for Common Scenarios

### 1.8 V Core Before 3.3 V I/O

This is the most common sequencing requirement. The 1.8 V rail must reach regulation before any 3.3 V signal is present on the IC's I/O pins. Typical timing:

| Event | Time | Notes |
|-------|------|-------|
| 1.8V regulator enable | t = 0 ms | Battery connected or power switch closed |
| 1.8V output reaches 1.71V (95 %) | t = 0.5–1.0 ms | Soft-start dependent |
| 1.8V PG asserts | t = 0.6–1.1 ms | 100 µs after output stable |
| 3.3V regulator enable (via PG chain) | t = 0.6–1.1 ms | Immediate upon PG assertion |
| 3.3V output reaches 3.14V (95 %) | t = 1.1–2.1 ms | Second soft-start |
| 3.3V PG asserts | t = 1.2–2.2 ms | System ready |

Total sequence time: approximately 1.2–2.2 ms from power application to full system ready.

### FPGA/SoC Multi-Rail (4+ Rails)

Complex SoCs and FPGAs may require 4–6 supply rails with specific ordering. A Xilinx Zynq-7000, for example:

| Sequence | Rail | Voltage | Typical Current |
|----------|------|---------|----------------|
| 1 | VCCINT (core) | 1.0 V | 1–5 A |
| 2 | VCCAUX (auxiliary) | 1.8 V | 0.5–1 A |
| 3 | VCCBRAM (block RAM) | 1.0 V | 0.1–0.5 A |
| 4 | VCCO (I/O banks) | 1.8/2.5/3.3 V | 0.5–2 A |
| 5 | VCCPLL (PLL supply) | 1.0 V (filtered) | 50 mA |

The inter-rail timing requirement is typically that no rail should be more than a few hundred millivolts above any earlier-sequenced rail during the ramp. This prevents current injection through internal ESD structures. Xilinx specifies that VCCINT must start ramping before VCCO, with VCCO never exceeding VCCINT + 0.4 V during the ramp.

## Dedicated Sequencer ICs

### TPS65263 — Multi-Output with Sequencing

The TPS65263 from Texas Instruments integrates three synchronous buck converters with built-in sequencing:

| Parameter | Value |
|-----------|-------|
| Number of outputs | 3 |
| Output current per channel | Up to 3 A |
| Input voltage range | 4.5–18 V |
| Sequencing | Internal, configurable via pin strapping |
| Switching frequency | 300 kHz–2.2 MHz (adjustable) |
| Package | QFN-32 (5 × 5 mm) |

The TPS65263 supports programmable sequencing delays between channels via internal registers. Channel 1 starts first, and channels 2 and 3 follow with configurable delays of 0.5–8 ms. Each channel has an independent PG output for monitoring. This single IC replaces three discrete buck converters plus sequencing logic, reducing BOM count and board area.

For battery-powered systems where input voltage is below 4.5 V (single Li-Ion cell at 3.0–4.2 V), the TPS65263 is not directly applicable — it targets multi-cell battery packs or USB-powered systems. For single-cell designs, discrete converters with enable-chain sequencing remain the standard approach.

## STM32H7 Internal Dual Supply — SMPS + LDO

The STM32H7 series includes an internal SMPS (switched-mode power supply) that can generate the 1.2 V core supply from the 3.3 V VDD rail, reducing external component count and power dissipation compared to an external LDO.

### Internal Power Architecture

The STM32H750 has two internal supply domains:

- **VDD domain:** 1.62–3.6 V (external supply, typically 3.3 V)
- **VCORE domain:** 1.2 V (internal, generated by SMPS or LDO from VDD)

The SMPS converts 3.3 V → 1.2 V with approximately 90 % efficiency, compared to the internal LDO at 1.2/3.3 = 36 % efficiency. At a core current of 100 mA, the SMPS saves (3.3 − 1.2) × 0.1 × (1 − 0.36/0.90) ≈ 126 mW — significant in battery-powered applications.

### SMPS Configuration in STM32H7

The SMPS requires an external inductor (1 µH) and capacitor (1 µF) connected to specific pins (VDDSMPS and LX). The configuration is set through the PWR registers:

```c
/* Enable SMPS for 1.2V core supply on STM32H750
   Must be done before increasing clock speed */

void configure_smps(void) {
    /* Ensure SMPS is available (check option bytes) */
    /* The supply configuration is set via PWR_CR3 */

    /* Enable SMPS step-down converter, disable LDO */
    MODIFY_REG(PWR->CR3,
               PWR_CR3_SMPSEN | PWR_CR3_LDOEN | PWR_CR3_BYPASS,
               PWR_CR3_SMPSEN);

    /* Wait for SMPS ready flag */
    uint32_t timeout = 1000;
    while (!(PWR->CSR1 & PWR_CSR1_ACTVOSRDY) && timeout--) {
        /* Spin; typical stabilization time < 1 ms */
    }

    /* Verify supply configuration */
    if (!(PWR->CR3 & PWR_CR3_SMPSEN)) {
        /* SMPS failed to enable — fall back to LDO */
        SET_BIT(PWR->CR3, PWR_CR3_LDOEN);
    }
}
```

The SMPS mode must be configured early in the startup sequence, before the system clock is increased beyond 64 MHz. At higher clock speeds, the core current increases and the LDO's thermal dissipation becomes a constraint — the SMPS eliminates this bottleneck.

### External Component Requirements for STM32H7 SMPS

| Component | Value | Notes |
|-----------|-------|-------|
| Inductor (LX pin) | 1 µH, Isat > 500 mA | Low DCR preferred; 2 × 1.6 mm package |
| Output capacitor (VDDSMPS) | 1 µF, X7R, 6.3 V | Placed within 3 mm of VDDSMPS pin |
| Input capacitor (VDD) | 4.7 µF + 100 nF | Standard MCU decoupling |

The inductor is shared between the SMPS output and the LX pin — routing must keep this connection short (< 5 mm) with a solid ground return. The SMPS operates at approximately 1 MHz internally, and the LX pin swings between 0 V and VDD, so it should be treated as a switching node for layout purposes.

## Power-Down Sequencing

Power-down sequencing is often neglected but equally important. The standard rule is to reverse the power-up sequence: turn off I/O rails first, then auxiliary rails, and finally the core. In enable-chain designs, this happens naturally if each regulator's EN is tied to the upstream PG — when the first regulator shuts down, its PG drops, which disables the next, cascading through the chain.

For GPIO-controlled sequencing, explicit power-down code must mirror the power-up order in reverse. A common mistake is disabling all GPIO outputs simultaneously (e.g., during MCU reset), which drops all EN signals at once — violating the sequencing order. Configuring EN-connected GPIOs with internal pull-downs in the GPIO configuration ensures a defined state during MCU reset.

## Tips

- Always connect unused regulator EN pins to a defined state (VIN for always-on, or GND for always-off) — never leave EN floating, as noise coupling can cause the regulator to oscillate between enabled and disabled states.
- Use 100 kΩ pull-up resistors on PG outputs unless the downstream EN pin has specific input current requirements — higher resistance reduces leakage current in shutdown but slows the PG rising edge.
- Add a 100 nF capacitor from the PG output to ground to filter noise glitches that could momentarily deassert PG and trigger a downstream regulator to shut down — this adds approximately 1 ms of glitch immunity with a 100 kΩ pull-up.
- For GPIO-controlled sequencing, configure the EN-driving GPIOs as open-drain with external pull-downs — this ensures that during MCU reset (when GPIOs go high-impedance), the downstream regulators are disabled and power-down sequencing is maintained.
- If using the STM32H7 internal SMPS, configure it in the SystemInit function before the clock tree is configured — switching from LDO to SMPS after the PLL is running can cause a brief core voltage dip.

## Caveats

- **PG signals have propagation delay** — The 50–500 µs delay between output reaching regulation and PG asserting means that downstream regulators enable slightly after the upstream output is stable, but this delay must be accounted for in fast-sequence designs.
- **RC delay sequencing is imprecise** — Component tolerances (±10 % resistor, ±20 % capacitor) and enable threshold variation (±15 %) combine to give ±30–40 % uncertainty on the actual delay time. This approach is suitable only for non-critical sequencing where the exact delay does not matter.
- **Power-down sequencing is harder than power-up** — On power-up, each regulator starts with a controlled soft-start ramp. On power-down, the output voltage depends on the load's discharge behavior, output capacitor size, and any reverse leakage through the regulator. A lightly loaded 3.3 V rail with 22 µF of output capacitance may take 50–100 ms to discharge to 0 V, while a heavily loaded 1.8 V rail with 10 µF discharges in < 10 ms.
- **Back-powering through ESD diodes can maintain a "zombie" supply** — If the I/O rail is disabled but an external 3.3 V signal continues to drive an I/O pin, current flows through the ESD diode and partially powers the VDD rail through the I/O supply bus. The IC appears to be off but is actually running in an undefined state. Disconnecting all external signals before or simultaneously with the I/O supply prevents this.
- **The STM32H7 SMPS mode is set in option bytes** — On some STM32H7 variants, the SMPS availability is controlled by option bytes (OTP or flash-resident). Attempting to enable the SMPS on a variant configured for LDO-only operation silently fails, and the core runs on the LDO with higher power dissipation.

## In Practice

- A multi-rail system where the 3.3 V I/O rail comes up before the 1.8 V core rail (due to a missing PG-to-EN connection) may work 99 % of the time in testing but fail intermittently in production — the latch-up condition depends on the exact timing of external signals relative to the supply ramp, which varies with temperature, battery voltage, and component tolerance.
- A design that uses PG-to-EN chaining but omits the pull-up resistor on the PG pin will fail to sequence — the PG output is open-drain and floats high-impedance when asserted, which is not the same as driving high. Without a pull-up, the EN pin sees an undefined voltage.
- An STM32H7 design that runs from the internal LDO instead of the SMPS draws approximately 20–30 % more current from the battery at full clock speed (480 MHz) — switching to SMPS mode is one of the highest-impact power optimizations available on this platform.
- A prototype where one supply rail "sometimes" fails to come up is often caused by a race condition in the sequencing — the PG signal from the upstream regulator arrives while the downstream EN pin is still being driven low by an MCU GPIO that has not yet been reconfigured. Adding a 1 ms delay between GPIO configuration and sequencing start resolves the race.
- A system that powers down cleanly on the bench but corrupts flash settings when the battery is disconnected abruptly is missing power-down sequencing — adding a supervisory circuit (voltage detector) that triggers a controlled shutdown sequence before the supply drops below the MCU's minimum operating voltage prevents data loss.
