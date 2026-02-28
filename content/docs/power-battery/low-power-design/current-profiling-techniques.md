---
title: "Current Profiling Techniques"
weight: 30
---

# Current Profiling Techniques

Measuring the current consumption of a battery-powered embedded device is not as simple as reading a multimeter. A typical firmware duty cycle involves sub-microsecond transitions between sleep (1 µA), active processing (5 mA), and radio transmission (120 mA) — a dynamic range of 100,000:1 that no single instrument captures perfectly. Dedicated current profiling tools like the Nordic Power Profiler Kit II (PPK2) and Qoitech Otii Arc exist specifically for this problem, while a shunt resistor and oscilloscope remain the most flexible approach for capturing fast transients. The goal is always the same: correlate every feature in the current waveform to a specific firmware state, so that each microamp in the power budget is accounted for.

## Nordic Power Profiler Kit II (PPK2)

The PPK2 is a USB-connected current measurement tool designed for ultra-low-power embedded development. It operates in two modes:

- **Source mode** — The PPK2 supplies power to the target (0.8–5.0 V, up to 500 mA) and measures current simultaneously. This eliminates the need for a separate power supply.
- **Ampere meter mode** — The PPK2 is inserted in series with an external supply and measures current passively.

### Specifications

| Parameter | Value |
|-----------|-------|
| Current range | 200 nA – 500 mA |
| Resolution | ~100 nA (low range), ~50 µA (high range) |
| Sample rate | 100 kSa/s |
| Voltage supply (source mode) | 0.8 – 5.0 V, adjustable in 1 mV steps |
| Input voltage (ampere meter) | 0.8 – 5.0 V |
| Interface | USB 2.0, nRF Connect for Desktop |
| Price (2024) | ~$99 USD |

### Hardware Setup (Source Mode)

Connection for an nRF52840-DK:

1. Remove the jumper on P22 (current measurement header) on the DK.
2. Connect PPK2 VOUT to the DK's VDD (P22 pin closest to the nRF52840).
3. Connect PPK2 GND to the DK's GND.
4. Optional: Connect a DK GPIO to PPK2 Logic Port D0–D7 for trigger/correlation.
5. In nRF Connect Power Profiler, set voltage to 3.0 V and enable Source Mode.

### Software Integration

The PPK2 software (nRF Connect for Desktop — Power Profiler) provides:

- **Real-time streaming** at 100 kSa/s with automatic range switching
- **Trigger mode** — start capture on a logic level change on D0–D7
- **Selection statistics** — drag to select a time window and read average current, charge (µAh), and peak current
- **Export** — CSV export of raw samples for offline analysis

The 8 digital logic inputs (D0–D7) are invaluable for correlating firmware states with current waveform features. A common pattern drives dedicated GPIO pins high during specific firmware phases:

```c
/* Define profile pins */
#define PROFILE_PIN_ACTIVE    NRF_GPIO_PIN_MAP(0, 13)
#define PROFILE_PIN_RADIO     NRF_GPIO_PIN_MAP(0, 14)
#define PROFILE_PIN_SENSOR    NRF_GPIO_PIN_MAP(0, 15)

void init_profile_pins(void)
{
    nrf_gpio_cfg_output(PROFILE_PIN_ACTIVE);
    nrf_gpio_cfg_output(PROFILE_PIN_RADIO);
    nrf_gpio_cfg_output(PROFILE_PIN_SENSOR);
}

void sensor_read_task(void)
{
    nrf_gpio_pin_set(PROFILE_PIN_ACTIVE);

    nrf_gpio_pin_set(PROFILE_PIN_SENSOR);
    /* Read I2C sensor — ~2 ms */
    read_bme280(&sensor_data);
    nrf_gpio_pin_clear(PROFILE_PIN_SENSOR);

    nrf_gpio_pin_set(PROFILE_PIN_RADIO);
    /* Transmit BLE advertisement — ~3 ms */
    ble_advertise(&sensor_data);
    nrf_gpio_pin_clear(PROFILE_PIN_RADIO);

    nrf_gpio_pin_clear(PROFILE_PIN_ACTIVE);
}
```

In the Power Profiler waveform, PROFILE_PIN_SENSOR high corresponds to the I2C current draw (~1.5 mA), and PROFILE_PIN_RADIO high corresponds to the BLE TX burst (~8 mA peak). This makes it trivial to identify which firmware phase contributes most to the average current.

## Qoitech Otii Arc

The Otii Arc is a more capable (and more expensive) current profiling tool that doubles as a programmable power supply:

### Specifications

| Parameter | Value |
|-----------|-------|
| Current range | 1 µA – 5 A |
| Resolution | 500 nA (low range), ~100 µA (high range) |
| Sample rate | 4 kSa/s (current), 1 kSa/s (voltage) |
| Voltage supply | 0.5 – 4.55 V main, 1.8/2.5/3.3 V expansion |
| Digital inputs | 2 (GPI1, GPI2) |
| UART capture | 1 channel (for correlating log messages to current) |
| Interface | USB, Otii desktop software |
| Price (2024) | ~$575 USD |

### Key Advantages Over PPK2

- **Higher current range** — Up to 5 A, suitable for Wi-Fi and cellular modules that draw 500 mA+ during TX bursts
- **UART log correlation** — The Otii Arc captures UART output alongside the current waveform, allowing firmware `printf()` messages to appear directly on the current timeline
- **Scripting API** — Python scripting for automated test sequences:

```python
from otii_tcp_client import otii_connection

# Connect to Otii application
connection = otii_connection.OtiiConnection("localhost", 1905)
otii = connection.connect_to_server()

# Get the Otii Arc device
devices = otii.get_devices()
arc = devices[0]

# Configure supply
arc.set_main_voltage(3.3)
arc.set_max_current(0.5)

# Start recording
project = otii.get_active_project()
project.start_recording()

# Wait for test duration
import time
time.sleep(60)

# Stop and export
project.stop_recording()
recording = project.get_last_recording()
recording.export_csv("power_profile.csv")
```

- **Automated testing** — Combine the scripting API with a test framework to run regression tests on power consumption, catching firmware changes that increase average current

### UART Log Correlation

The Otii Arc's built-in UART capture (up to 115200 baud) maps log messages directly onto the current waveform:

```c
/* Firmware side — print state transitions to UART */
printf("[STATE] sensor_start\n");
read_sensor();
printf("[STATE] sensor_done\n");

printf("[STATE] tx_start\n");
transmit_data();
printf("[STATE] tx_done\n");

printf("[STATE] sleep\n");
enter_sleep();
```

Each `[STATE]` message appears as an annotation on the Otii timeline, eliminating guesswork about which current spike corresponds to which operation.

## Shunt Resistor and Oscilloscope Method

For the highest bandwidth measurements (capturing sub-microsecond transients), a shunt resistor in series with the power supply, measured by an oscilloscope, remains the most direct approach.

### Resistor Selection

The shunt resistor value is a tradeoff between measurement sensitivity and voltage drop:

| Shunt Value | Voltage Drop at 100 mA | Voltage Drop at 1 µA | Sensitivity at 1 mV/div | Use Case |
|-------------|------------------------|-----------------------|--------------------------|----------|
| 1 Ω | 100 mV | 1 nV | 1 mA/div | High-current phases (radio TX) |
| 10 Ω | 1 V (too high) | 10 nV | 100 µA/div | Medium current only |
| 100 Ω | 10 V (way too high) | 100 nV | 10 µA/div | Sleep current only |
| 1 kΩ | — | 1 µV | 1 µA/div | Ultra-low sleep analysis |

A 1 Ω shunt is the most common starting point. At 100 mA, it drops 100 mV across the resistor — acceptable for most 3.3 V systems (a 3% supply reduction). At 1 µA sleep current, the voltage across 1 Ω is 1 µV, well below any oscilloscope's noise floor. This means a single shunt value cannot capture both sleep and active current with adequate resolution.

### Dual-Shunt Technique

A practical solution uses two shunt resistors with a bypass MOSFET:

```
VCC ──┬── 1 kΩ ──┬── MCU VDD
      │           │
      └── 1 Ω ───┘
           │
       [MOSFET SW]
           │
          GND
```

During sleep, the MOSFET is off, and all current flows through the 1 kΩ resistor, producing 1 mV/µA — measurable on an oscilloscope. When the MCU wakes and draws milliamps, the firmware enables the MOSFET, bypassing the 1 kΩ shunt and routing current through the 1 Ω resistor.

In practice, this technique requires careful MOSFET selection (low Rds_on, fast switching) and adds firmware complexity. The PPK2 or Otii Arc's automatic range switching handles this transparently.

### Oscilloscope Settings

For current profiling with a 1 Ω shunt:

- **Bandwidth limit** — Enable 20 MHz bandwidth limit to reduce noise on the measurement channel
- **DC coupling** — Always use DC coupling to see the absolute current level
- **Probe** — Use a differential probe or measure across the shunt with two probes in math-subtract mode to reject ground bounce
- **Trigger** — Trigger on a GPIO toggle pin (same as the PPK2 correlation technique)
- **Horizontal scale** — Start at 10 ms/div to see the full duty cycle, then zoom to 100 µs/div for individual state transitions

## Identifying Firmware States in Current Traces

A well-structured current waveform from a BLE sensor node shows distinct phases:

```
Current
  ^
  |
120mA |              ┌──┐         ← BLE TX burst (2-3 ms)
  |              │  │
  |              │  │
 15mA |         ┌──┤  │         ← CPU active + sensor read
  |         │  │  │
  5mA |    ┌──┤  │  │         ← CPU init after wake
  |    │  │  │  │
  1µA |────┘  └──┘  └──────── ← Deep sleep baseline
  |
  └──────────────────────────> Time
        Wake  Sensor  TX  Sleep
```

Each phase has characteristic signatures:

| Phase | Current Signature | Duration | Identifying Feature |
|-------|-------------------|----------|-------------------|
| Sleep baseline | 0.5–2 µA, flat | Seconds to minutes | Constant, lowest level |
| Init spike | 5–15 mA, brief | 50–500 µs | Sharp rise at wake |
| Sensor read (I2C) | 1–5 mA, stepped | 1–10 ms | Regular I2C clock pattern visible at high bandwidth |
| ADC sampling | 2–4 mA, flat-ish | 10–500 µs | Short, consistent duration |
| Flash write | 5–15 mA, flat | 1–10 ms | Longer block for page writes |
| BLE advertising | 8–12 mA peak | 2–3 ms | Three bursts on ch 37/38/39 |
| Wi-Fi TX (ESP32) | 120–240 mA peak | 2–5 ms per packet | Very high, distinctive spike |
| Wi-Fi association | 80–150 mA sustained | 500 ms – 2 s | Long plateau with modulation |

## Correlating GPIO Pins to Current Events

The GPIO toggle technique is the most reliable method for mapping firmware execution to current draw:

```c
/* STM32 example — profile pins for current correlation */
#define PROFILE_PORT  GPIOC
#define PIN_WAKE      GPIO_PIN_0
#define PIN_SENSOR    GPIO_PIN_1
#define PIN_COMMS     GPIO_PIN_2
#define PIN_FLASH     GPIO_PIN_3

void duty_cycle(void)
{
    /* Wake from Stop 2 — pin goes high on wake ISR */
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_WAKE, GPIO_PIN_SET);
    SystemClock_Config();

    /* Sensor phase */
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_SENSOR, GPIO_PIN_SET);
    float temperature = read_tmp117();
    float humidity = read_bme280_humidity();
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_SENSOR, GPIO_PIN_RESET);

    /* Communication phase */
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_COMMS, GPIO_PIN_SET);
    lorawan_send(temperature, humidity);
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_COMMS, GPIO_PIN_RESET);

    /* Flash logging phase */
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_FLASH, GPIO_PIN_SET);
    flash_log_entry(temperature, humidity);
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_FLASH, GPIO_PIN_RESET);

    /* Return to sleep */
    HAL_GPIO_WritePin(PROFILE_PORT, PIN_WAKE, GPIO_PIN_RESET);
    enter_stop2_mode();
}
```

Connect each profile pin to a separate oscilloscope channel (or PPK2 logic input). The resulting waveform shows exactly which firmware function is responsible for each current feature, making optimization targeted rather than speculative.

## Automating Profile Capture

For regression testing, automated capture ensures that firmware changes do not inadvertently increase power consumption:

### PPK2 Command-Line Interface

The `nrf-power-profiler` npm package provides programmatic access:

```bash
# Install CLI tool
npm install -g @nicolo/nrf-ppk2

# Capture 60 seconds of data in source mode at 3.0V
ppk2-capture --source --voltage 3000 --duration 60 --output profile.csv
```

### Python Analysis Script

After exporting CSV data from any profiling tool, a simple analysis script computes the average current over a duty cycle:

```python
import csv
import numpy as np

def analyze_profile(csv_path, sample_rate_hz=100000):
    """Analyze a current profile CSV from PPK2 or Otii Arc."""
    currents = []
    with open(csv_path, 'r') as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        for row in reader:
            currents.append(float(row[1]))  # column 1 = current in amps

    currents = np.array(currents)
    duration_s = len(currents) / sample_rate_hz

    print(f"Duration:        {duration_s:.3f} s")
    print(f"Average current: {np.mean(currents)*1e6:.2f} µA")
    print(f"Peak current:    {np.max(currents)*1e3:.2f} mA")
    print(f"Min current:     {np.min(currents)*1e6:.2f} µA")
    print(f"Total charge:    {np.sum(currents)/sample_rate_hz*1e6:.2f} µAh")

    # Identify sleep baseline (bottom 10th percentile)
    sleep_baseline = np.percentile(currents, 10)
    print(f"Sleep baseline:  {sleep_baseline*1e6:.2f} µA")

analyze_profile("profile.csv")
```

### CI Integration Pattern

A firmware CI pipeline can include power regression tests:

1. Flash the DUT with the new firmware build.
2. Trigger a known duty cycle (e.g., via UART command or timer-based).
3. Capture 10 duty cycles with the PPK2 or Otii Arc.
4. Compute average current per cycle.
5. Compare against the baseline from the previous release.
6. Fail the build if average current increases by more than 5%.

This approach catches regressions like accidentally leaving a debug UART enabled, adding a new peripheral init without a corresponding deinit, or increasing the active-mode duration through slower algorithms.

## Tips

- Always measure current on the final production hardware — development boards include debug LEDs, voltage regulators, and USB bridges that draw 5–20 mA and completely mask the MCU's actual consumption
- Use at least 3 profile GPIO pins (wake, sensor, communication) — trying to infer firmware state from the current waveform alone is ambiguous when multiple peripherals draw similar currents
- Capture at least 10 complete duty cycles and average them — individual cycles vary due to radio retransmissions, sensor conversion jitter, and RTOS scheduling, so a single cycle is not representative
- Export raw CSV data and compute statistics offline — the GUI tools show averages over the selected window, but automated scripts can segment by state, compute per-phase energy, and track trends across firmware versions
- Remove the PPK2 or shunt resistor for final production measurements — the measurement circuit itself adds series resistance (PPK2: ~10 Ω internal shunt on low range) that can affect the target's behavior at very low voltages

## Caveats

- **PPK2 sample rate (100 kSa/s) misses sub-10 µs transients** — A 5 µs current spike during a flash write is undersampled and may appear as a lower, wider pulse; an oscilloscope with a 1 Ω shunt captures the true peak
- **Otii Arc's 4 kSa/s current sample rate is too slow for per-packet radio analysis** — Individual BLE advertisement TX bursts (2–3 ms each) appear as only 8–12 samples, insufficient for characterizing the waveform shape; use the PPK2 or oscilloscope for radio-burst analysis
- **Shunt resistors add voltage drop that changes MCU behavior** — A 10 Ω shunt drops 1 V at 100 mA, reducing the MCU supply to 2.3 V from a 3.3 V rail, potentially causing brownout or altered LDO operation
- **GPIO toggle pins consume current themselves** — Each driven-high GPIO pin sourcing into a scope probe (1 MΩ) draws negligible current, but if accidentally connected to a 10 kΩ pull-down, it adds 330 µA per pin, corrupting the measurement
- **Automatic range switching introduces brief artifacts** — Both the PPK2 and Otii Arc show a small glitch (1–2 samples) when transitioning between current ranges, appearing as a brief spike or dip at the sleep-to-active transition; this is a measurement artifact, not actual device behavior

## In Practice

- A BLE sensor node profile on the PPK2 showed 1.8 µA average over a 10-second cycle: 1.2 µA sleep baseline, a 5 ms active burst at 8 mA, and a 3 ms BLE TX at 12 mA — the calculation (1.2 µA * 9.992s + 8 mA * 5 ms + 12 mA * 3 ms) / 10s = 5.0 µA average, but the actual measured average was 7.2 µA, revealing a 2.2 µA leakage from an I2C pull-up to an unpowered sensor
- An ESP32 application measured with the Otii Arc showed that Wi-Fi association after deep sleep wake took 1.8 seconds at 130 mA average — a single association consumed 65 µAh, equivalent to 23 hours of 2.8 µA deep sleep, meaning the duty cycle must be longer than ~2 minutes between wakes for deep sleep to provide net energy savings
- A shunt resistor measurement on an oscilloscope revealed a 200 µs current spike of 45 mA during STM32L4 flash page erase — invisible on the PPK2 at 100 kSa/s (aliased to a 15 mA bump over 2 samples) but significant for peak current dimensioning of a coin-cell supply with high internal resistance
- A product team that added power profiling to their CI pipeline caught a regression where a new logging feature increased sleep current from 2.1 µA to 38 µA — the root cause was the UART peripheral left enabled after a debug print, and the automated test flagged it before the code reached production
