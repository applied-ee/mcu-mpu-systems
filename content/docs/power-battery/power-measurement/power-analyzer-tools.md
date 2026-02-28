---
title: "Power Analyzer Tools"
weight: 30
---

# Power Analyzer Tools

Measuring embedded power consumption requires instruments that can capture both the microamp sleep currents and the hundred-milliamp active bursts that characterize modern low-power firmware. A standard benchtop DMM, sampling at a few readings per second, averages out the brief transmit bursts and deep-sleep intervals — reporting a single number that represents neither the peak nor the baseline. Dedicated power analyzers solve this by combining high-speed sampling with wide dynamic range, continuous capture, and software tools for analyzing energy over time.

## Nordic Power Profiler Kit II (PPK2)

The Nordic PPK2 is the entry-level standard for embedded power profiling, particularly in BLE and low-power wireless applications. It operates in two modes: source meter (supplying power and measuring current simultaneously) and ammeter (measuring current in an external supply path).

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Current range | 200 nA to 1 A |
| Sampling rate | 100 kSps |
| Resolution | ~100 nA (low range), ~50 µA (high range) |
| Source voltage | 0.8V to 5.0V (adjustable in 50mV steps) |
| Voltage accuracy | ±50 mV |
| Interface | USB, nRF Connect Power Profiler app |
| Price | ~$99 USD |

**Source meter mode**: The PPK2 supplies power to the DUT through its VOUT pin while measuring the current drawn. The supply voltage is configurable from 0.8V to 5.0V. This mode eliminates the need for an external power supply and places the measurement shunt in the optimal position with factory-calibrated sense resistors and auto-ranging.

**Ammeter mode**: The PPK2 is inserted in series with an external power supply's positive rail. The DUT is powered by the external supply, and the PPK2 measures the current flowing through its internal shunt. This mode is used when the DUT requires a supply voltage or current capability beyond the PPK2's source mode limits.

**Workflow:**

1. Connect the PPK2 to the DUT's power rail (source mode: PPK2 supplies VOUT → DUT VCC; ammeter mode: supply → PPK2 VIN → PPK2 VOUT → DUT VCC)
2. Open nRF Connect for Desktop → Power Profiler application
3. Select the PPK2 device and configure the supply voltage
4. Start capture — the real-time waveform shows current vs. time
5. Use the selection tool to highlight a region and read average current, peak current, and total charge (µAh)
6. Export data as CSV for post-processing or documentation

The 100 kSps sampling rate captures events as short as 10 µs, sufficient for profiling BLE connection events (~1–3 ms) and most peripheral wakeup sequences. However, sub-microsecond transients (such as initial oscillator startup spikes) may be averaged out.

## Otii Arc (Qoitech)

The Otii Arc combines a programmable power supply with precision current measurement and a scripting API for automated testing. It is designed for battery life characterization and regression testing of firmware power profiles.

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Current range | ±5 A |
| Current resolution | 1 nA (low range), 100 nA (high range) |
| Sampling rate | Up to 4 kSps (current), 1 kSps (voltage) |
| Source voltage | 0.5V to 4.5V (expandable to 12V with Otii Battery Toolbox) |
| Max source current | 5 A |
| Interface | USB, Otii Desktop app, Python API |
| Price | ~$585 USD |

**Battery emulation**: The Otii Arc can emulate a battery discharge profile. Loading a battery model (or a measured discharge curve) makes the supply voltage drop as charge is consumed, replicating real-world battery behavior without waiting for an actual battery to drain. This enables characterizing battery life in minutes rather than days.

**Python scripting API**: The Otii Arc exposes a TCP-based API accessible from Python, enabling automated power profiling in CI/CD pipelines:

```python
from otii_tcp_client import otii_connection

# Connect to Otii application
connection = otii_connection.OtiiConnection("localhost", 1905)
otii = connection.connect_to_server()

# Get the connected Arc device
devices = otii.get_devices()
arc = devices[0]

# Configure supply
arc.set_main_voltage(3.3)
arc.set_max_current(0.5)
arc.enable_channel("mc", True)  # Enable main current channel
arc.set_range("low")            # Low range for µA-level measurements

# Start recording
project = otii.get_active_project()
project.start_recording()

# ... trigger DUT test sequence ...

import time
time.sleep(30)  # Capture 30 seconds of data

# Stop and retrieve data
project.stop_recording()
recording = project.get_last_recording()

# Get current data
current_data = recording.get_channel_data("mc", arc.id)
avg_current = sum(current_data["values"]) / len(current_data["values"])
print(f"Average current: {avg_current * 1e6:.1f} µA")
```

**Workflow:**

1. Connect the Otii Arc's positive output to DUT VCC and GND to DUT GND
2. In Otii Desktop, set the supply voltage and current limit
3. Enable the main current (mc) channel and optionally the main voltage (mv) channel
4. Start recording and exercise the DUT through its operational states
5. Use markers and statistics to measure average current per state, energy per transaction, and projected battery life
6. Export data or use the Python API for automated regression testing

## Joulescope JS220

The Joulescope JS220 is a DC-coupled, always-on current and voltage monitor designed for continuous capture at high sample rates. It is optimized for developers who need to see every microamp of sleep current and every milliamp of transmit burst in a single uninterrupted trace.

**Key specifications:**

| Parameter | Value |
|-----------|-------|
| Current range | ±10 A (±1 A with low-noise front end) |
| Current resolution | 18-bit effective (sub-nanoamp on lowest range) |
| Sampling rate | 2 Msps (current and voltage, simultaneous) |
| Bandwidth | DC to 1 MHz |
| Voltage range | 0 to 15 V |
| Voltage resolution | 18-bit |
| Insertion voltage drop | < 25 mV at 1 A |
| Interface | USB 3.0, Joulescope UI, Python API |
| Price | ~$999 USD |

**Always-on architecture**: Unlike instruments that require arming or triggering, the Joulescope captures continuously at full rate. There is no missed data between trigger events. The software displays a zoomable timeline from microseconds to hours, and the user can zoom into any region after capture to inspect individual current pulses.

**2 Msps sampling**: At 2 million samples per second, the JS220 captures events as short as 500 ns — sufficient for resolving individual clock cycles of an MCU's wake-from-stop transition, oscillator startup, and peripheral initialization sequence.

**Simultaneous voltage and current**: Both channels are sampled synchronously, enabling direct power (watts) and energy (joules) computation. The software displays instantaneous power as a derived channel.

**Workflow:**

1. Connect the Joulescope in series with the DUT's supply rail (V_IN+ to supply, V_OUT+ to DUT VCC, GND to DUT GND)
2. Launch the Joulescope UI application
3. Capture begins immediately — the real-time view shows current, voltage, and power
4. Use the dual-marker tool to select a time range and read energy, charge, average current, and average power
5. Zoom from a multi-hour overview down to microsecond-level detail on any region of interest
6. Export raw data as JLS (native), CSV, or access programmatically via the Python `joulescope` package

```python
import joulescope

with joulescope.scan_require_one(config='auto') as js:
    # Read a single current/voltage sample
    data = js.read(contiguous_duration=1.0)  # 1 second of data
    current = data['signals']['current']['value']
    voltage = data['signals']['voltage']['value']
    print(f"Avg current: {current.mean() * 1e6:.2f} µA")
    print(f"Avg voltage: {voltage.mean():.3f} V")
    print(f"Avg power:   {(current * voltage).mean() * 1e3:.3f} mW")
```

## Keysight N6705C DC Power Analyzer

The Keysight N6705C is a lab-grade mainframe that accepts up to four power modules, each functioning as a programmable power supply and precision measurement instrument. It is the reference standard for power characterization in professional embedded development labs.

**Key specifications (with N6781A 2-quadrant SMU module):**

| Parameter | Value |
|-----------|-------|
| Voltage range | 0 to 20 V |
| Current range | ±3 A |
| Current resolution | 100 pA (lowest range) |
| Measurement bandwidth | DC to 200 kHz |
| Sampling rate | Up to 200 kSps (with 14585A software) |
| Dynamic range | >10^7 (100 pA to 3 A) |
| Interface | USB, LAN, GPIB, SCPI programmable |
| Price | ~$8,000–$15,000 USD (mainframe + modules) |

**SCPI control**: The N6705C is fully programmable via Standard Commands for Programmable Instruments (SCPI) over USB, LAN, or GPIB. Automated test sequences can configure the supply, trigger measurements, and retrieve data without manual interaction:

```python
import pyvisa

rm = pyvisa.ResourceManager()
inst = rm.open_resource("TCPIP::192.168.1.100::INSTR")

# Configure channel 1 as 3.3V supply with 500mA limit
inst.write("INST:NSEL 1")
inst.write("VOLT 3.3")
inst.write("CURR 0.5")
inst.write("OUTP ON")

# Configure current measurement
inst.write("SENS:CURR:RANG:AUTO ON")
inst.write("SENS:CURR:DC:NPLC 10")  # 10 power line cycles integration

# Read current
current = float(inst.query("MEAS:CURR?"))
print(f"Current: {current * 1e6:.2f} µA")

# Data logging mode
inst.write("SENS:DLOG:FUNC:CURR ON")
inst.write("SENS:DLOG:PER 0.0001")   # 100 µs sample period = 10 kSps
inst.write("SENS:DLOG:TIME 10")       # Log for 10 seconds
inst.write("INIT:DLOG 'int:\\log1.dlog'")

# ... wait for capture to complete ...

# Retrieve data
inst.write("MMEM:DATA? 'int:\\log1.dlog'")
```

**Seamless ranging**: The N6781A module uses a seamless auto-ranging architecture that switches between current measurement ranges without gaps or glitches in the measurement. Unlike instruments that momentarily saturate or blank during range transitions, the N6705C captures the full dynamic range of an embedded system's power profile — from nanoamp deep sleep to amp-level transmit bursts — in a single trace.

## Tool Comparison

| Feature | PPK2 | Otii Arc | Joulescope JS220 | Keysight N6705C |
|---------|------|----------|-------------------|-----------------|
| Price | ~$99 | ~$585 | ~$999 | ~$8,000+ |
| Current resolution | ~100 nA | 1 nA | sub-nA | 100 pA |
| Sample rate | 100 kSps | 4 kSps | 2 Msps | 200 kSps |
| Max current | 1 A | 5 A | 10 A | 3 A (per module) |
| Voltage source | Yes (0.8–5V) | Yes (0.5–4.5V) | No (ammeter only) | Yes (0–20V) |
| Battery emulation | No | Yes | No | Yes (with SW) |
| Scripting API | No (export CSV) | Python TCP | Python package | SCPI (any language) |
| CI/CD integration | Manual | Good | Good | Excellent |
| Best for | Quick BLE profiling | Battery life testing | High-speed capture | Lab reference |

## When to Use Each Tool

**Nordic PPK2**: Best for initial power profiling during development of BLE, Zigbee, and other Nordic-based designs. The low cost and tight integration with nRF Connect make it the fastest path to a first power profile. Limited to 1A and 100 kSps, which is adequate for most wireless MCU applications.

**Otii Arc**: Best for battery life estimation and automated regression testing. The battery emulation feature provides realistic discharge profiles without waiting for real batteries to drain. The Python API enables integration into automated test frameworks, catching power regressions before firmware ships.

**Joulescope JS220**: Best for detailed power analysis requiring high time resolution. The 2 Msps rate and always-on capture architecture make it possible to see every transition in a wake-sleep cycle. The seamless zoom from hours-long captures to microsecond-level detail is unmatched in the price range.

**Keysight N6705C**: Best for production-grade characterization, compliance testing, and multi-rail analysis. The four-module mainframe can simultaneously power and measure multiple supply rails (e.g., VDD_CORE, VDD_IO, VDD_RF, VDD_SENSOR) with correlated timing. SCPI programmability enables fully automated test sequences.

## Tips

- Start with the PPK2 for early-stage power profiling — the $99 investment pays for itself on the first firmware revision that catches a peripheral left enabled during sleep
- Use the Otii Arc's battery emulation to test end-of-life behavior (brownout recovery, low-voltage data corruption) without waiting for a real battery to discharge to 3.0V
- Configure the Joulescope's trigger output to drive a logic analyzer or oscilloscope for correlating power events with specific bus transactions or GPIO activity
- When using the Keysight N6705C for multi-rail analysis, enable synchronized data logging across all channels to correlate the power-on sequence timing between supply rails
- Export raw measurement data and compute energy-per-operation (µJ per BLE advertisement, µJ per sensor read, µJ per UART message) rather than reporting only average current — energy per operation is the metric that determines battery life for event-driven systems
- For CI/CD integration, define power budgets as pass/fail thresholds in the test script (e.g., sleep current < 5 µA, peak TX current < 15 mA for the nRF52840) and fail the build if the firmware exceeds them

## Caveats

- **The PPK2's 100 kSps sample rate averages transients shorter than 10 µs** — A 2 µs current spike of 100mA is reported as a lower, wider pulse; the peak current and its duration are not accurately captured
- **The Otii Arc's 4 kSps current sampling rate is too slow for sub-millisecond events** — BLE connection events that last 1–3 ms appear as only 4–12 samples, making it impossible to resolve the internal structure of the event (oscillator startup, radio ramp, TX, RX, shutdown)
- **The Joulescope JS220 does not supply power** — An external supply is required, and the Joulescope is inserted in series with the positive rail; if the DUT needs a precise voltage, the supply must be regulated and the Joulescope's insertion drop (up to 25mV at 1A) must be accounted for
- **The Keysight N6705C's cost places it out of reach for individual developers and small teams** — A PPK2 or Joulescope provides 90% of the analytical capability for 1–10% of the cost
- **All these instruments measure current at a single point in the supply path** — A measurement on the main supply rail captures total system current but cannot distinguish between MCU core, radio, sensor, and regulator quiescent currents; profiling individual subsystems requires breaking the supply path at each point of interest or using firmware-controlled power switches to isolate loads
- **Battery emulation is not a substitute for testing with real batteries** — Real batteries have internal impedance that varies with state of charge, temperature, and age; a constant-voltage source (even one following a discharge curve) does not replicate the voltage sag under pulsed loads that real batteries exhibit

## In Practice

- A BLE device reporting 50 µA average sleep current on the PPK2 when the datasheet claims 2 µA for System ON with RTC running indicates a peripheral or GPIO configuration error — examining the PPK2 trace for periodic current bumps identifies which peripheral wakes unexpectedly
- An Otii Arc battery emulation test that shows the DUT browning out at 3.1V when the regulator's dropout voltage is 200mV and the battery cutoff is 3.0V reveals that the pulsed current load (e.g., radio TX at 100mA) causes a voltage sag below the regulator's minimum input — adding a bulk capacitor (100 µF) on the battery rail smooths the pulse and extends the usable discharge range
- A Joulescope capture showing a 50 ms wake period when the firmware intends a 5 ms wake-measure-sleep cycle identifies a slow peripheral initialization path — zooming in to the microsecond level reveals that the ADC's internal reference settling time (specified as 30 ms in the datasheet) dominates the wake duration
- Automated power regression tests using the Otii Arc's Python API that suddenly fail after a firmware update — with average current jumping from 8 µA to 45 µA — catch a code change that accidentally left the SPI peripheral clock enabled during sleep, a defect that would otherwise ship to production
