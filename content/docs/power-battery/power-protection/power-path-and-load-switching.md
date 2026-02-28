---
title: "Power Path & Load Switching"
weight: 40
---

# Power Path & Load Switching

Embedded systems frequently need to switch power to subsystems — turning off a GPS module during sleep, selecting between battery and USB power, or sequencing multiple voltage domains during startup. While a discrete MOSFET can switch a load, dedicated load switch ICs add controlled slew rate, thermal shutdown, quick output discharge, and reverse current blocking — features that prevent the transient glitches and ground bounce that cause downstream ICs to latch up or fail to initialize.

## Load Switch Fundamentals

A load switch is a MOSFET-based power gate with integrated control logic. At minimum, it provides an enable pin (ON/OFF control), an internal FET with specified Rds_on, and output discharge. More advanced parts add adjustable rise time, overcurrent protection, thermal shutdown, and reverse current blocking.

The distinction between a bare MOSFET and a load switch IC becomes clear during power-on. When a GPIO drives a discrete P-FET gate from high to low, the FET turns on as fast as the gate RC allows — often in microseconds — creating an uncontrolled voltage step on the output. If the output has 10µF of bypass capacitance, the resulting current spike is I = C * dV/dt = 10µF * 3.3V / 5µs = 6.6A. A load switch with controlled slew rate ramps the output over 1–5ms, keeping inrush current within bounds.

## Key Load Switch Parameters

| Parameter | Symbol | Significance |
|-----------|--------|-------------|
| On-resistance | Rds_on | Determines voltage drop and power loss: V_drop = Rds_on * Iload |
| Quiescent current | Iq | Supply current drawn by the control logic when the switch is on |
| Shutdown current | Isd | Leakage through the switch plus control logic current when off |
| Rise time | tR | Time for output to ramp from 10% to 90% of Vin — controls inrush |
| Quick output discharge | QOD | Internal pulldown resistor that discharges output capacitance when off |
| Maximum continuous current | Imax | Limited by package thermal dissipation, not just FET rating |
| Reverse current blocking | - | Prevents current from flowing backward (output to input) |

## Common Load Switch ICs

### TPS22918 (Texas Instruments)

The TPS22918 is one of the most widely used load switches for 3.3V and 5V MCU subsystems:

- **Vin range:** 1.62–5.5V
- **Rds_on:** 52mΩ at 3.3V Vin, 36mΩ at 5V
- **Maximum current:** 2A continuous
- **Quiescent current:** 1.5µA (on), 0.1µA (off)
- **Rise time:** 1.2ms (controlled, fixed)
- **Quick output discharge:** 120Ω internal pulldown
- **Package:** SOT-23-5 (5-pin, 1.6 x 2.9mm)

At 500mA load with 3.3V input, the voltage drop is 52mΩ * 0.5A = 26mV, and power dissipation is 13mW — negligible thermal impact. The 1.2ms rise time with 22µF output capacitance produces I_inrush = 22µF * 3.3V / 1.2ms = 60mA — well controlled.

### TPS22919 (Texas Instruments)

A lower Rds_on variant of the TPS22918:

- **Rds_on:** 90mΩ at 1.8V Vin, 28mΩ at 3.3V
- **Maximum current:** 1.5A
- **Rise time:** 1ms (slightly faster)
- **Package:** SOT-23-5

The lower on-resistance at low voltages makes this a better fit for 1.8V rail switching, where 52mΩ would consume too large a fraction of the available voltage headroom.

### SIP32431 (Vishay)

A cost-effective alternative for less demanding applications:

- **Vin range:** 1.1–5.5V
- **Rds_on:** 55mΩ at 3.3V
- **Maximum current:** 1A continuous
- **Quiescent current:** 1µA (on), 0.3µA (off)
- **Rise time:** 200µs (faster, less inrush protection)
- **Package:** SC-70-4 (tiny, 4-pin)

The faster rise time provides less inrush control than the TPS22918 — suitable for loads with minimal output capacitance (under 4.7µF) but potentially problematic for larger capacitor banks.

## GPIO-Controlled Power Domains

A common embedded architecture partitions the system into independently switchable power domains, each controlled by a load switch driven from a GPIO:

```
            MCU
             │
        ┌────┼────────┐
        │    │         │
     GPIO_0 GPIO_1  GPIO_2
        │    │         │
    ┌───┴─┐ ┌──┴──┐ ┌──┴──┐
    │LS_0 │ │LS_1 │ │LS_2 │   (TPS22918 load switches)
    └──┬──┘ └──┬──┘ └──┬──┘
       │       │       │
    [GPS]   [IMU]   [Radio]
   3.3V_GPS 3.3V_IMU 3.3V_RF
```

Each subsystem powers on only when needed. During deep sleep, all load switches turn off, and the MCU retains only its RTC and backup SRAM. The shutdown current through each TPS22918 is 0.1µA, adding negligible drain.

```c
/* Power domain control for STM32 + TPS22918 */

#define PWR_GPS_PIN    GPIO_PIN_4   /* PA4 -> TPS22918 ON pin */
#define PWR_IMU_PIN    GPIO_PIN_5   /* PA5 -> TPS22918 ON pin */
#define PWR_RADIO_PIN  GPIO_PIN_6   /* PA6 -> TPS22918 ON pin */
#define PWR_PORT       GPIOA

void power_domain_init(void) {
    GPIO_InitTypeDef gpio = {0};
    gpio.Pin = PWR_GPS_PIN | PWR_IMU_PIN | PWR_RADIO_PIN;
    gpio.Mode = GPIO_MODE_OUTPUT_PP;
    gpio.Pull = GPIO_PULLDOWN;  /* Default off at reset */
    gpio.Speed = GPIO_SPEED_FREQ_LOW;
    HAL_GPIO_Init(PWR_PORT, &gpio);
}

void power_domain_enable(uint16_t pin) {
    HAL_GPIO_WritePin(PWR_PORT, pin, GPIO_PIN_SET);
    /* Wait for load switch rise time + downstream regulator startup */
    HAL_Delay(5);  /* 1.2ms rise + margin for downstream POR */
}

void power_domain_disable(uint16_t pin) {
    HAL_GPIO_WritePin(PWR_PORT, pin, GPIO_PIN_RESET);
    /* QOD resistor discharges output in ~0.5ms for 10µF load */
}

void enter_deep_sleep(void) {
    power_domain_disable(PWR_GPS_PIN);
    power_domain_disable(PWR_IMU_PIN);
    power_domain_disable(PWR_RADIO_PIN);
    /* All domains off — total leakage ~0.3µA from load switches */
    HAL_PWR_EnterSTOPMode(PWR_LOWPOWERREGULATOR_ON,
                          PWR_STOPENTRY_WFI);
}
```

## Quick Output Discharge

When a load switch turns off, the output capacitors retain their charge and decay slowly through the load's leakage paths. This stored charge can cause problems:

- **Incomplete power-on reset:** If the domain is turned off and on quickly, the downstream IC may not see a full power cycle and fails to reset properly
- **Back-powering through I/O pins:** A powered-off subsystem with charged output capacitors can source current through its I/O pins into the MCU, causing latch-up

The TPS22918's internal 120Ω quick output discharge (QOD) resistor actively pulls the output to ground when the switch is off. Discharge time for a 10µF load to 10% of Vin: t ≈ 2.3 * R_QOD * C_load = 2.3 * 120Ω * 10µF ≈ 2.8ms.

## Battery/USB Power-Path Switching

Systems powered by both a battery and a USB connection require a power-path controller that selects the appropriate source, manages charging, and prevents reverse current flow.

### Simple Diode ORing

The simplest approach uses Schottky diodes to OR the battery and USB supplies:

```
USB 5V ──|>|──┬── VBUS_OR (to regulator)
              │
BAT 3.7V ─|>|──┘
```

The higher-voltage source dominates. When USB is connected at 5V, the battery diode is reverse-biased. When USB is removed, the battery diode conducts. The drawback is the diode forward voltage drop (0.3–0.5V) on both paths, which wastes power and reduces available headroom.

### Active Switchover with Ideal Diode ORing

Replacing the Schottky diodes with ideal diode controllers (LTC4357 or LM74610) eliminates the voltage drop. Each controller drives an N-channel MOSFET that conducts with millivolt-level drop in the forward direction and blocks reverse current when the other source is active.

For prioritized switching — where USB should always take over from battery when available — the LTC4417 provides a three-input priority power path controller. It sequences through inputs in priority order, connecting the highest-priority available source and disconnecting lower-priority sources to prevent reverse current and cross-conduction.

### Integrated Power Path with Battery Charger

Modern battery charger ICs often include integrated power-path management:

**BQ24072 (Texas Instruments):**
- USB input (4.35–6.4V) with integrated power-path FET
- Dynamic power management (DPM): limits charge current to prevent USB source overload
- System load is powered from USB when available, battery when not — seamless switchover
- 1.5A charge current, linear topology
- Thermal regulation reduces charge current if junction temperature exceeds 120°C

**BQ25895 (Texas Instruments):**
- Switching charger with integrated boost and power path
- 3.9–14V input range (supports USB-C PD voltage levels)
- I2C-programmable charge current, input current limit, and charge voltage
- NVDC (narrow voltage DC) power path: the system rail is regulated to slightly above battery voltage, avoiding the pass-through efficiency penalty of linear chargers
- Up to 3A charge current with >90% efficiency

```c
/* BQ25895 I2C configuration for USB-C PD charging */

#define BQ25895_ADDR  0x6A

/* Set input current limit to 2A (REG00) */
/* IINLIM[5:0] = 0b100110 = 38 * 50mA + 100mA = 2000mA */
uint8_t reg00 = 0x26;  /* EN_HIZ=0, EN_ILIM=0, IINLIM=2000mA */
i2c_write_reg(BQ25895_ADDR, 0x00, reg00);

/* Set charge voltage to 4.208V (REG06) */
/* VREG[5:0] = 0b011100 = 28 * 16mV + 3.840V = 4.288V */
/* Use 0b010111 = 23 * 16mV + 3.840V = 4.208V */
uint8_t reg06 = 0x5E;  /* VREG=4.208V, BATLOWV=3.0V, VRECHG=100mV */
i2c_write_reg(BQ25895_ADDR, 0x06, reg06);

/* Set charge current to 1.5A (REG04) */
/* ICHG[6:0] = 0b0010111 = 23 * 64mA = 1472mA ≈ 1.5A */
uint8_t reg04 = 0x17;  /* EN_PUMPX=0, ICHG=1472mA */
i2c_write_reg(BQ25895_ADDR, 0x04, reg04);

/* Read status register (REG0B) for power path state */
uint8_t status = i2c_read_reg(BQ25895_ADDR, 0x0B);
uint8_t vbus_stat = (status >> 5) & 0x07;
/* 0b000 = No input, 0b001 = USB host SDP, 0b010 = USB CDP */
/* 0b011 = USB DCP, 0b100 = Adjustable (PD/QC) */
```

## Controlled Shutdown Sequencing

When multiple power domains exist, the shutdown sequence often matters as much as startup. Turning off a bus master's power while a slave is still driving a shared bus can cause bus contention and current flow through I/O protection diodes. The recommended sequence:

1. De-initialize peripherals in firmware (disable DMA, flush buffers)
2. Tri-state or drive low all I/O pins connected to the domain being powered off
3. Disable the load switch for the target domain
4. Wait for QOD to discharge the output capacitors before proceeding to the next domain

For power-on, the reverse order applies: enable the power domain, wait for the voltage rail to stabilize, then initialize the peripheral.

## Power Domain Isolation

When a powered-off domain connects to a powered-on bus (I2C, SPI), the powered-off IC's ESD protection diodes can clamp the bus signals and back-power the IC through its I/O pins. This causes several problems:

- The "off" IC draws current through the bus, defeating the power savings
- The IC may enter an undefined state and corrupt bus transactions
- Sustained current through ESD diodes can exceed their rating and damage the IC

Solutions include:
- **Bus isolator ICs** (TXB0104, TCA9548A I2C multiplexer) that disconnect the bus when the domain is off
- **Level shifters with enable pins** (TXS0108E) that tri-state their outputs when OE is low
- **Series resistors** (1–10kΩ) that limit backfeed current to safe levels, combined with the load switch QOD to drain any coupled charge

## Tips

- Use load switches with quick output discharge (QOD) when power domains must cycle cleanly — without QOD, residual charge on output capacitors prevents proper power-on reset of downstream ICs
- Select load switches with Rds_on that produces less than 2% voltage drop at maximum load current — for a 3.3V rail at 500mA, the maximum acceptable Rds_on is 132mΩ (66mV drop)
- Configure GPIO pins driving load switch ON inputs with internal pulldowns so that the domains default to OFF during MCU reset — this prevents uncontrolled power-on of subsystems before firmware initializes
- For battery/USB switchover, prefer ICs with integrated power-path management (BQ24072, BQ25895) over discrete diode ORing — the integrated approach provides seamless switching, charging, and system power simultaneously
- Add a startup delay after enabling each power domain to allow the downstream regulator and IC to complete their power-on reset — 5–10ms is typically sufficient

## Caveats

- **Load switch rise time interacts with downstream capacitance** — A TPS22918 with 1.2ms rise time driving 100µF of output capacitance produces 275mA of inrush current (C * Vin / t_rise); if this exceeds the switch's current limit, the output ramp stalls
- **Quick output discharge adds leakage in the off state** — The 120Ω QOD resistor in the TPS22918 draws 27.5mA from a charged 3.3V output during discharge, but only for a few milliseconds; in rare cases where zero off-state leakage is required, a part without QOD is necessary
- **Back-powering through I/O pins is a real failure mode** — Turning off a load switch does not guarantee the downstream IC is truly unpowered if bus signals from powered domains are still connected
- **Battery/USB switchover glitches can cause MCU resets** — If the power-path controller has a break-before-make transition, the system rail dips briefly during switchover; adding 100µF of bulk capacitance on the system rail holds voltage through the gap
- **Load switches have limited reverse voltage tolerance** — Most load switches tolerate only a few hundred millivolts of reverse voltage (Vout > Vin); in battery-powered designs where the battery may be removed while output capacitors hold charge, select parts with explicit reverse current blocking

## In Practice

- A battery-powered sensor node that runs for only 3 days instead of the expected 30 often has peripheral ICs powered continuously — adding TPS22918 load switches and disabling GPS and radio power during sleep extends runtime by an order of magnitude
- A board where a peripheral IC works after initial power-on but fails to respond after a firmware-controlled power cycle has insufficient discharge time — the IC never sees a full POR because the output capacitors hold the rail above its reset threshold; enabling QOD or adding a longer delay between off and on resolves the issue
- A system that draws 50µA in sleep instead of the expected 5µA commonly has back-powering through I2C pull-ups — the 3.3V pull-up resistors on the I2C bus feed current into the powered-off sensor's VCC through its SDA/SCL ESD diodes; adding a TCA9548A I2C multiplexer or disconnecting pull-ups with a load switch eliminates the leakage path
- A USB-powered device that resets momentarily when the USB cable is unplugged and a battery is present has a power-path controller with excessive switchover delay — adding bulk capacitance (47–100µF) on the system rail bridges the transition gap
- A device that works from battery alone and from USB alone but locks up when switching between them is experiencing cross-conduction or a momentary output voltage spike during the transition — switching to an IC with break-before-make guarantee (TPS25944 or LTC4417) eliminates the overlap condition
