---
title: "Constant-Current LED Drivers"
weight: 10
---

# Constant-Current LED Drivers

LEDs are current-driven devices — their brightness is proportional to the current flowing through them, and their forward voltage is a consequence of that current, not a control parameter. Driving an LED from a voltage source with just a resistor works for basic applications, but the brightness varies with supply voltage, temperature, and the LED's own forward voltage tolerance. Constant-current driver ICs eliminate this variability by regulating the current through each LED string regardless of supply voltage fluctuations, LED forward voltage variation, or temperature drift.

## Why Constant Current Matters

An LED's forward voltage (Vf) varies by ±10–20% across a manufacturing batch and shifts with temperature (~2mV/°C for typical InGaN blue/green LEDs). With a simple resistor from a 5V supply driving a white LED (Vf ≈ 3.0V), the resistor drops 2V. A 10% Vf variation means the resistor voltage changes from 2.3V to 1.7V — a 35% current variation, and therefore a 35% brightness variation. In a multi-LED array where uniformity matters, this is unacceptable.

A constant-current driver measures the actual current (typically via a low-side sense resistor or integrated current mirror) and adjusts its output to maintain the setpoint regardless of Vf changes. The result: every LED in an array runs at identical brightness, even if their forward voltages differ by several hundred millivolts.

## Common Driver ICs

**Linear constant-current drivers** (e.g., CAT4101, AL8860, BCR421U) regulate current by dropping excess voltage across an internal pass element. Simple and noise-free, but the power dissipated in the driver equals (Vsupply − Vf − Vsense) × Iled. Efficiency suffers when the supply voltage is much higher than the LED forward voltage.

**Switching (buck) LED drivers** (e.g., TPS92512, AL8843, MP3431) use an inductor and switch to step down the voltage efficiently. The input-to-output voltage difference is handled by switching rather than dissipation, achieving 85–95% efficiency. These are the standard choice for high-power LED systems and any application where thermal budget is a concern.

**Multi-channel sink drivers** (e.g., TLC5940, PCA9685) provide multiple constant-current outputs with individual PWM dimming per channel. These are designed for LED arrays, matrix displays, and architectural lighting where many LEDs need independent brightness control. The current is set by a single external resistor, and all channels match to within ±1–3%.

## Setting the Current

Most constant-current drivers use an external resistor to set the output current. The relationship is typically:

```
Iled = Vref / Rset
```

Where Vref is an internal reference voltage (commonly 0.1V to 1.25V depending on the IC). For a TLC5940 with Vref = 1.24V, a 2kΩ Rset produces Iled = 620µA per channel — appropriate for indicator LEDs. For high-power drivers like the CAT4101, Rset directly sets the LED current up to 1A.

The Rset resistor should be a 1% tolerance metal film type — its accuracy directly determines current accuracy. A 5% carbon resistor introduces 5% LED-to-LED brightness variation, partially negating the benefit of constant-current drive.

## Tips

- Use switching (buck) drivers for any application where (Vsupply − Vf) > 2V — the efficiency advantage over linear drivers quickly becomes significant as the headroom voltage increases
- Select 1% tolerance Rset resistors — the current accuracy can't exceed the resistor accuracy
- Place the current-sense resistor (if external) close to the driver IC with a Kelvin connection to minimize PCB trace resistance error
- For multi-channel drivers like the TLC5940, chain the data interface (SPI) to control hundreds of channels from a single MCU with minimal GPIO

## Caveats

- **Linear drivers waste significant power at high headroom** — A 12V supply driving a 3V LED through a linear driver dissipates 9V × Iled in the driver as heat. This limits either the current or the duty cycle in thermally constrained designs
- **Switching drivers introduce EMI** — The high-frequency switching generates noise on the supply rails and can radiate. Layout is critical — short, fat traces for the power loop, and a ground plane under the switcher. LED lighting in RF-sensitive environments (near antennas or sensitive analog circuits) may need additional filtering
- **Constant-current drivers don't eliminate the need for thermal management** — The LED itself still generates heat proportional to its forward power. The driver just ensures the current is consistent, not that the LED is cool enough
- **Multi-channel drivers have limited voltage compliance** — The TLC5940, for example, requires each output to be within ~0.5V of GND. LEDs with high forward voltages may need a higher-voltage variant or a different topology

## In Practice

- LEDs in a row that show visible brightness variation despite identical wiring likely have different forward voltages being driven from a voltage source — switching to a constant-current driver equalizes brightness immediately
- A linear driver IC that becomes too hot to touch is dissipating excessive headroom voltage — either the supply voltage is too high for the application or a switching driver should replace it
- A multi-channel driver where one or two channels are noticeably dimmer than the rest usually indicates a solder issue on the output pin or the LED connection, not a driver failure — the IC's channel matching is tight by design
- Audible whine from a switching LED driver at low dimming levels indicates the PWM frequency has dropped into the audible range — increasing the dimming frequency or using a different dimming method (analog current reduction vs. PWM) eliminates the noise
