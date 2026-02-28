---
title: "Reverse Polarity Protection"
weight: 10
---

# Reverse Polarity Protection

A reversed power connection — swapped battery leads, a barrel jack plugged into the wrong supply, or a miswired harness — drives current backward through the regulator and downstream ICs, often destroying them in milliseconds. Reverse polarity protection prevents this by blocking or redirecting the reversed current path before it reaches any active component. The choice of protection method involves a direct trade-off between voltage drop, power dissipation, cost, and quiescent current.

## Series Diode Method

The simplest protection places a standard rectifier diode in series with the positive supply rail. When the supply is correctly oriented, the diode conducts and passes current to the load. When the supply is reversed, the diode blocks and no current flows.

A 1N5819 Schottky diode drops approximately 0.3–0.4V at moderate currents, while a standard 1N4007 silicon rectifier drops 0.6–0.7V. The power lost in the diode is P = Vf * Iload. At 500mA through a 1N5819 (Vf = 0.35V), this is 175mW — acceptable for many applications. At 2A, the same diode dissipates 700mW, generating significant heat in a small DO-41 or SMA package.

For battery-powered systems, the forward voltage drop is the critical concern. A 3.7V LiPo cell that sags to 3.4V under load loses another 0.35V through the Schottky, leaving only 3.05V for the regulator — dangerously close to brownout territory for a 3.3V LDO. This limitation makes the series diode method impractical for low-headroom battery designs.

## P-MOSFET Protection

A P-channel MOSFET placed in the high-side power path provides reverse polarity protection with near-zero voltage drop during normal operation. The circuit works as follows: the MOSFET source connects to the input supply, the drain connects to the load, and the gate ties to ground through a resistor. When the supply is correctly oriented, Vgs is negative (equal to -Vin), turning the P-FET fully on. The voltage drop across the FET is simply Rds_on * Iload. When the supply is reversed, Vgs becomes positive, the FET turns off, and the body diode blocks reverse current.

Common P-MOSFETs for this application:

| MOSFET | Vds_max | Rds_on (typ) | Id_max | Package | Notes |
|--------|---------|---------------|--------|---------|-------|
| SI2301 | -20V | 110mΩ | -2.8A | SOT-23 | Low cost, widely available |
| DMP2035U | -20V | 45mΩ | -4.2A | SOT-23 | Lower Rds_on, higher current |
| IRLML6402 | -20V | 65mΩ | -3.7A | SOT-23 | Common choice, proven reliability |
| Si2333DS | -20V | 28mΩ | -5.3A | SOT-23 | Higher performance, higher cost |
| IRF9540N | -100V | 117mΩ | -23A | TO-220 | High-current through-hole |

With a DMP2035U (Rds_on = 45mΩ) carrying 1A, the voltage drop is only 45mV — negligible compared to the 300–700mV drop of a series diode. Power dissipation is 45mW, a fraction of the diode approach.

## P-MOSFET Gate Drive Circuit

The basic P-MOSFET circuit connects the gate to ground through a 100kΩ resistor. This pulls the gate low (relative to the source at Vin), ensuring full enhancement. However, if the input voltage exceeds the gate-source maximum rating (typically ±20V for most small-signal MOSFETs), the gate oxide can rupture.

For systems with input voltages above 12V, a Zener diode (10–12V) placed between gate and source clamps Vgs to a safe level while still providing enough drive to fully enhance the FET. A 10V Zener ensures the FET sees -10V Vgs regardless of whether the input is 15V or 30V. A 10kΩ resistor in series with the gate limits current through the Zener during normal operation.

A TVS diode (such as the SMBJ12A) across gate-source provides additional protection against fast transients that might otherwise damage the gate oxide before the Zener can respond.

```
    VIN ──┬──[Source  Drain]──┬── VOUT (to load)
          │     P-FET         │
          │                   │
          ├──[10kΩ]──┬── Gate │
          │          │        │
          │        [Zener     │
          │         10V]      │
          │          │        │
    GND ──┴──────────┴────────┴── GND
```

## N-MOSFET Low-Side Protection

An N-channel MOSFET placed on the low side (ground return path) also provides reverse polarity protection. The source connects to the load's ground return, the drain connects to the supply ground, and the gate ties to the positive supply through a resistor. When correctly oriented, Vgs equals Vin, fully enhancing the FET. When reversed, Vgs is zero or negative, and the FET remains off.

N-channel MOSFETs generally offer lower Rds_on than P-channel devices at the same price point, making this approach attractive on paper. However, the load's ground reference shifts above true ground by Rds_on * Iload. For a circuit drawing 2A through a FET with 20mΩ Rds_on, the ground offset is 40mV. This ground shift can disturb ADC readings, UART communication levels, and any signal referenced to ground. N-MOSFET low-side protection is best suited for simple loads (motors, heaters, LED strings) where ground integrity is not critical.

## Ideal Diode Controllers

Dedicated ideal diode controller ICs drive an external N-channel MOSFET to emulate a perfect diode — conducting in the forward direction with millivolt-level drop and blocking instantly in reverse. These controllers monitor the voltage across the FET and regulate the gate drive to maintain near-zero Vds during forward conduction.

| Controller | Topology | Features | Package |
|------------|----------|----------|---------|
| LTC4357 | High-side, N-FET | 9–80V, 25µA Iq, auto-retry | MSOP-8 |
| LM74610 | High-side, N-FET | 0–65V, zero Iq (charge pump from Vds) | SOT-23-6 |
| LTC4359 | High-side, N-FET | 4–80V, reverse voltage blocking to -40V | MSOP-8 |

The LM74610 is notable for drawing zero quiescent current from the supply — it harvests operating energy from the forward voltage drop across the MOSFET via an internal charge pump. This makes it ideal for always-on battery systems where even 25µA of quiescent draw matters over months of deployment.

## Design Calculations

Selecting the MOSFET requires three calculations:

**1. Voltage drop at maximum current:**

```
V_drop = Rds_on * I_max
```

For IRLML6402 (Rds_on = 65mΩ) at 2A: V_drop = 0.13V. This must be tolerable for the downstream regulator's input range.

**2. Power dissipation in the MOSFET:**

```
P_diss = Rds_on * I_max²
```

For IRLML6402 at 2A: P_diss = 65mΩ * 4 = 260mW. The SOT-23 package (Rth_ja ~ 200°C/W) sees a junction temperature rise of 52°C — acceptable at room ambient.

**3. Gate-source voltage check:**

The available Vgs must exceed the FET's threshold voltage by a comfortable margin. For a 3.3V system, the P-FET sees Vgs = -3.3V. If the FET's Vgs_th is -1.5V (typical for the SI2301), the margin is adequate. However, some FETs with -2.0V threshold may not fully enhance at 3.3V, leading to higher-than-specified Rds_on. Always verify Rds_on at the actual Vgs from the datasheet curves, not just the headline specification measured at Vgs = -10V.

## Protection Method Comparison

| Method | Voltage Drop | Cost | Complexity | Iq Impact | Best For |
|--------|-------------|------|------------|-----------|----------|
| Schottky diode | 0.3–0.5V | Lowest | Single part | None | Non-critical, high-headroom |
| P-MOSFET | 10–100mV | Low | 2–3 parts | None | Most embedded systems |
| N-MOSFET (low-side) | 10–50mV | Lowest FET cost | 2–3 parts | None | Simple loads, ground shift OK |
| Ideal diode IC | 5–20mV | Moderate | IC + FET | 0–25µA | Battery, high-current, ORing |
| Series fuse + TVS | N/A (different purpose) | Low | 2 parts | None | Supplements polarity protection |

## Tips

- For battery-powered designs under 2A, a P-MOSFET in SOT-23 (SI2301 or IRLML6402) provides the best balance of cost, size, and voltage drop — the total BOM addition is one FET and one resistor
- Always verify Rds_on at the actual operating Vgs, not the datasheet headline value — a P-FET specified at 65mΩ with Vgs = -10V may show 150mΩ at Vgs = -3.3V
- Add a 100kΩ gate-to-ground resistor to ensure the P-FET gate is pulled low even if the gate node would otherwise float during power transitions
- For inputs above 15V, add a 10–12V Zener clamp between gate and source to protect the gate oxide — most small-signal MOSFETs have a ±20V Vgs maximum
- Consider the body diode forward recovery during hot-plug events — the body diode conducts briefly before the FET enhances, creating a short current pulse through the diode

## Caveats

- **P-MOSFET Rds_on increases with temperature** — At 100°C junction temperature, Rds_on is typically 1.5–2x the 25°C value, which increases both voltage drop and power dissipation in a thermal feedback loop
- **The body diode does not protect against reverse voltage exceeding Vds_max** — If a reversed supply exceeds the MOSFET's drain-source breakdown rating, the FET fails regardless of whether the gate is off
- **N-MOSFET low-side protection shifts the load ground** — Even 20mV of ground offset can introduce measurable errors in 12-bit ADC readings referenced to the same ground
- **Series Schottky diodes have significant reverse leakage at high temperatures** — A 1N5819 can leak 1mA at 125°C, which may slowly discharge a battery through the "protection" diode
- **Ideal diode controllers add startup delay** — The charge pump or bias circuit needs time to establish gate drive, creating a brief period during power-on where the MOSFET is not fully enhanced

## In Practice

- A field-deployed sensor node that dies after a battery swap often lacks reverse polarity protection — adding a P-MOSFET circuit costs pennies and prevents a common failure mode during maintenance
- A development board powered through a barrel jack that works with one supply but fails with another may have reversed center-pin polarity — barrel jacks have no standardized polarity convention, making protection essential on any connector without keying
- A design that uses a series Schottky diode for protection and then struggles to run from a 3.7V LiPo is hitting the forward voltage drop at low battery — replacing the diode with a P-MOSFET recovers 300mV of headroom
- A P-FET protection circuit that measures higher voltage drop than expected (e.g., 200mV instead of the calculated 65mV) at moderate current typically indicates that the FET is not fully enhanced — checking Vgs versus Vgs_th at the actual supply voltage reveals insufficient gate drive
- A board with an N-MOSFET on the ground return that exhibits intermittent UART communication failures under heavy load is seeing the ground offset shift UART levels outside the receiver's valid input range
