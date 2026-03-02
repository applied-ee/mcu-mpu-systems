---
title: "BLE Power Optimization"
weight: 50
---

# BLE Power Optimization

Power consumption is the defining advantage of BLE over other wireless protocols. A BLE peripheral can operate for years on a coin cell battery — but only if the firmware is designed around the protocol's duty-cycling nature. The radio consumes 5–8 mA when transmitting and 5–7 mA when receiving on a typical nRF52 SoC, which means even brief radio activity dominates the total power budget. The difference between a well-optimized and a naively configured BLE device can be 10x in average current draw, translating directly to 10x battery life.

## BLE Power Model

BLE power consumption follows a simple pattern: short bursts of high current (radio on) separated by long periods of low current (radio off, MCU sleeping). The average current is determined by:

```
I_avg = (I_active × t_active + I_sleep × t_sleep) / (t_active + t_sleep)
```

For a device advertising once per second:

```
t_active ≈ 3 ms (advertising event: 3 channels × ~1 ms each)
t_sleep  ≈ 997 ms
I_active ≈ 7 mA (radio TX at 0 dBm)
I_sleep  ≈ 1.5 µA (system-on, RAM retained, RTC running)

I_avg = (7 mA × 3 ms + 1.5 µA × 997 ms) / 1000 ms
      = (21 µA·s + 1.5 µA·s) / 1 s
      ≈ 22.5 µA
```

With the DC/DC converter enabled (nRF52832), the active current drops from ~7 mA to ~4.5 mA, reducing the average to approximately 15 µA. The measured value of ~10 µA at 1-second advertising on nRF52832 with DC/DC reflects further optimizations in the SoftDevice's radio scheduling.

## Advertising Power Trade-offs

Advertising interval is the primary control for power consumption in non-connected peripherals:

| Interval | Events/sec | Avg Current (nRF52832, 0 dBm, DC/DC) | Annual Energy (µAh) | CR2032 Life |
|----------|-----------|---------------------------------------|---------------------|-------------|
| 20 ms | 50 | ~600 µA | 5,256,000 | ~16 days |
| 100 ms | 10 | ~50 µA | 438,000 | ~6 months |
| 250 ms | 4 | ~25 µA | 219,000 | ~1 year |
| 500 ms | 2 | ~15 µA | 131,400 | ~1.7 years |
| 1000 ms | 1 | ~10 µA | 87,600 | ~2.5 years |
| 2000 ms | 0.5 | ~6 µA | 52,560 | ~3.5 years |
| 5000 ms | 0.2 | ~3 µA | 26,280 | ~5 years* |
| 10240 ms | ~0.1 | ~2 µA | 17,520 | ~6 years* |

*Battery self-discharge limits practical life to 5–7 years for CR2032 regardless of load current.

These numbers assume advertising-only (no connections). The dominant factor at long intervals is the sleep current, not the advertising energy. Below approximately 3 µA average, the sleep current of the SoC itself (1.5 µA for nRF52832 in system-on) becomes the limiting factor.

## TX Power and Range Trade-offs

Transmit power directly affects both range and current draw:

| TX Power | nRF52832 Peak Current | nRF52840 Peak Current | Approximate Range (indoor) |
|----------|---------------------|---------------------|--------------------------|
| -20 dBm | 3.2 mA | 3.0 mA | 5–10 m |
| -8 dBm | 4.0 mA | 3.6 mA | 10–15 m |
| 0 dBm | 5.3 mA | 4.8 mA | 15–25 m |
| +4 dBm | 7.0 mA | 6.2 mA | 25–40 m |
| +8 dBm | N/A | 9.5 mA | 40–60 m |

For a device advertising at 1-second intervals, reducing TX power from 0 dBm to -8 dBm saves approximately 2 µA average current — a modest but meaningful improvement for coin-cell applications. The range reduction is acceptable for devices that operate within a room.

## Connection Interval Power

Connected BLE devices consume more power than advertising-only devices because connection events involve both TX and RX operations. The peripheral must wake for each connection event (unless slave latency is used) and remain awake for the duration of the exchange.

| Connection Interval | Slave Latency | Effective Wake Rate | Avg Current (nRF52832) | Use Case |
|--------------------|---------------|--------------------|-----------------------|----------|
| 7.5 ms | 0 | 133 Hz | ~3 mA | DFU, audio |
| 15 ms | 0 | 67 Hz | ~1.5 mA | Interactive |
| 30 ms | 0 | 33 Hz | ~700 µA | Default phone connection |
| 100 ms | 0 | 10 Hz | ~50 µA | Moderate sensor |
| 100 ms | 4 | 2 Hz | ~15 µA | Sensor with latency tolerance |
| 500 ms | 0 | 2 Hz | ~10 µA | Slow sensor |
| 500 ms | 9 | 0.2 Hz | ~5 µA | Ultra-low-power connected sensor |

Slave latency is the most effective tool for reducing connected power consumption. A CI of 100 ms with slave latency 4 keeps the connection responsive (100 ms worst-case latency when the peripheral has data) while reducing average current by ~3x compared to latency 0.

## System-Off and Wake-on-Radio

For applications that need the absolute lowest power between activities, **system-off mode** shuts down everything except the RTC wake source or a GPIO pin. Current draw in system-off is 0.3–0.7 µA on nRF52.

The challenge is that system-off loses the BLE connection. Re-establishing a connection requires advertising, scanning, connecting, and optional security — a process that takes 1–5 seconds and consumes a burst of ~5–10 mA.

Pattern: **system-off between connections**:
1. Peripheral completes data exchange
2. Peripheral disconnects and enters system-off
3. External event (button press, sensor threshold, RTC alarm) wakes the MCU
4. Peripheral re-initializes BLE stack and starts advertising
5. Central detects the advertisement and reconnects

This pattern works well for devices that report infrequently (once per hour or less). For more frequent reporting, maintaining a connection with high slave latency is more power-efficient than repeated connect/disconnect cycles.

```c
/* nRF52 system-off with GPIO wake */
void enter_system_off(void)
{
    /* Configure button pin as wake source */
    nrf_gpio_cfg_sense_input(BUTTON_PIN,
                             NRF_GPIO_PIN_PULLUP,
                             NRF_GPIO_PIN_SENSE_LOW);

    /* Enter system-off (0.3 µA) */
    sd_power_system_off();
    /* Execution stops here — next wake is a reset */
}

/* nRF52 system-off with RTC wake (using app_timer workaround) */
void enter_system_off_with_rtc(uint32_t seconds)
{
    /* Configure RTC COMPARE event as wake source */
    NRF_RTC2->CC[0] = NRF_RTC2->COUNTER + (seconds * 32768);
    NRF_RTC2->EVTENSET = RTC_EVTENSET_COMPARE0_Msk;
    NRF_RTC2->INTENSET = RTC_INTENSET_COMPARE0_Msk;

    sd_power_system_off();
}
```

## PPK2 Measurement Techniques

The Nordic Power Profiler Kit II (PPK2) is the standard tool for BLE current measurement. It provides:

- Dynamic range: 200 nA to 1 A
- Sampling rate: up to 100 kHz
- Resolution: ~200 nA at low currents
- Supply voltage: 0.8–5.0 V, software-adjustable

### Measurement Setup

```
PPK2 in Source Mode:
┌──────┐                    ┌──────────────┐
│ PPK2 │─── VOUT ──────────│ VDD (DUT)    │
│      │─── GND ───────────│ GND (DUT)    │
│      │                    │              │
│      │ USB ──── PC        │ nRF52 DK     │
└──────┘ (nRF Connect       └──────────────┘
          Power Profiler)

PPK2 in Ampere Meter Mode (for battery-powered devices):
┌──────┐                    ┌──────────────┐
│ PPK2 │─── IN ────────────│ Battery +    │
│      │─── OUT ───────────│ VDD (DUT)    │
│      │─── GND ───────────│ GND (DUT)    │
└──────┘                    └──────────────┘
```

### Measurement Best Practices

- Remove the debugger connection during measurement. The J-Link interface draws 5–10 mA through the debug header, completely masking the BLE device's actual consumption.
- Measure for at least 10 full advertising intervals (or 10 connection events) and average. Single-event measurements are noisy due to interference-caused retransmissions.
- Enable the PPK2's digital trigger output and correlate with GPIO toggles in firmware to identify which code sections consume the most power.
- Measure at room temperature (25°C). BLE radio current increases by approximately 10% at -20°C and decreases by ~5% at 60°C due to semiconductor physics.
- Use the "Average" display mode in nRF Connect Power Profiler for long-term average current. The "Peaks" display shows the instantaneous radio TX/RX bursts.

### Characteristic Current Signatures

Each BLE operation produces a distinctive current waveform:

```
Advertising Event (~3 ms total):
  ┌─────┐  ┌─────┐  ┌─────┐
  │ Ch37│  │ Ch38│  │ Ch39│
  │ TX  │  │ TX  │  │ TX  │
──┘     └──┘     └──┘     └───────── (sleep until next event)
  ~1ms    ~1ms    ~1ms

Connection Event (~1–2 ms):
  ┌──┐┌──┐
  │RX││TX│
──┘  └┘  └────────────────────────── (sleep until next event)
  ~0.5ms each

Scan Event (~continuous):
────────────────────────────────────  (radio RX continuously during scan window)
  I_rx ≈ 5–6 mA for entire scan window duration
```

## BLE vs WiFi Power Comparison

For periodic sensor data reporting, BLE provides dramatically lower power consumption than WiFi:

| Scenario | BLE | WiFi (ESP32) | Ratio |
|----------|-----|-------------|-------|
| Report 20 bytes every 1 minute | ~10 µA avg | ~2 mA avg (deep sleep + wake + connect + send) | 200x |
| Report 100 bytes every 10 minutes | ~5 µA avg | ~400 µA avg | 80x |
| Report 1 KB every 1 hour | ~3 µA avg | ~100 µA avg | 33x |
| Continuous streaming 10 KB/s | ~1.5 mA avg | ~80 mA avg | 53x |

WiFi's disadvantage comes from its connection overhead. A WiFi association + DHCP + TLS handshake + MQTT publish takes 2–5 seconds at 150–250 mA. Even with deep sleep between transmissions, the energy cost of each wake cycle is enormous compared to BLE's ~3 ms advertising or connection event.

For payloads larger than ~10 KB, WiFi's higher throughput begins to offset its connection overhead. The crossover point — where WiFi becomes more energy-efficient per byte — is approximately 50 KB per transaction, depending on the WiFi stack's sleep behavior.

## Battery Life Calculations

### CR2032 (225 mAh, 3V)

| BLE Mode | Average Current | Battery Life (theoretical) | Battery Life (practical*) |
|----------|----------------|---------------------------|--------------------------|
| Advertising 1 s | 10 µA | 2.6 years | 1.5–2 years |
| Advertising 2 s | 6 µA | 4.3 years | 2.5–3 years |
| Connected, CI=500 ms, latency=9 | 5 µA | 5.1 years | 3–4 years |
| Connected, CI=100 ms, latency=0 | 50 µA | 6 months | 4–5 months |
| Connected, CI=30 ms (phone default) | 700 µA | 13 days | 10–12 days |

*Practical life accounts for battery self-discharge (~1%/year), temperature effects, and voltage droop at end of life.

### AA Alkaline (2500 mAh, 1.5V → boost to 3.3V, η≈85%)

| BLE Mode | Average Current | Battery Life (theoretical) |
|----------|----------------|---------------------------|
| Advertising 1 s | 10 µA | 24 years* |
| Connected, CI=100 ms, latency=4 | 15 µA | 16 years* |
| Connected, CI=30 ms, DFU bursts | 200 µA avg over lifetime | 1.2 years |

*Limited by battery shelf life (5–10 years for alkaline).

### LiPo 500 mAh (3.7V, with regulator)

| BLE Mode | Average Current | Battery Life |
|----------|----------------|-------------|
| Advertising 1 s | 10 µA | 5.7 years* |
| Connected, CI=100 ms, latency=0 | 50 µA | 1.1 years |
| Connected, CI=15 ms (interactive) | 1.5 mA | 14 days |
| Mixed: low-power 95% + DFU 5% | ~150 µA avg | 4 months |

*Limited by LiPo self-discharge (~5–10%/year).

## Power Optimization Checklist

| Optimization | Impact | Effort | Platform |
|-------------|--------|--------|----------|
| Enable DC/DC converter | 30–40% reduction in active current | Low (register/config) | nRF52, ESP32 |
| Increase advertising interval | Linear reduction | Low (parameter change) | All |
| Use slave latency | 2–5x reduction when connected | Low (parameter change) | All |
| Reduce TX power | 10–30% reduction in peak current | Low (API call) | All |
| Disable unused peripherals (UART, SPI when idle) | 0.5–2 mA savings | Medium | All |
| System-off between connections | Approach 0.3 µA sleep | Medium (wake logic) | nRF52 |
| Optimize advertising payload (shorter = faster TX) | 5–10% per event | Low | All |
| Use 2M PHY for connections | 50% less radio on-time per byte | Low (PHY request) | BLE 5.0 devices |
| Disable SoftDevice logging | 50–200 µA savings | Low (build config) | nRF52 |
| Use event-driven architecture (no polling) | Eliminates idle CPU current | High (architecture) | All |

## ESP32 BLE Power Considerations

The ESP32 has higher baseline current than Nordic chips due to its more complex SoC architecture:

| State | ESP32 (NimBLE) | nRF52832 (SoftDevice) | nRF52840 (SoftDevice) |
|-------|---------------|---------------------|---------------------|
| Deep Sleep (no BLE) | 10 µA | 0.3 µA (system-off) | 0.4 µA (system-off) |
| Light Sleep (BLE maintaining connection) | ~800 µA | ~5 µA (system-on) | ~5 µA (system-on) |
| Advertising 1 s, 0 dBm | ~80 µA | ~10 µA | ~12 µA |
| Connected, CI=100 ms | ~500 µA | ~50 µA | ~55 µA |
| Active TX | 130–180 mA | 5–7 mA | 5–8 mA |

The ESP32's 10 µA deep sleep is excellent for WiFi duty cycling but less competitive for always-on BLE applications. For CR2032-powered BLE devices, Nordic's nRF52 series is the standard choice. The ESP32 excels in applications where BLE is used alongside WiFi or where the higher processing power (240 MHz dual-core vs 64 MHz single-core) justifies the power premium.

## Tips

- Enable the DC/DC converter on nRF52 before any other optimization. This single setting reduces radio current from ~7 mA to ~4.5 mA at 0 dBm. On the nRF52 DK, the DC/DC is enabled with `sd_power_dcdc_mode_set(NRF_POWER_DCDC_ENABLE)` — it requires an external inductor, which is present on all Nordic DKs and reference designs.
- Measure power with the PPK2 before and after each optimization to quantify the actual impact. Theoretical calculations frequently overestimate savings because they miss firmware overhead, peripheral leakage, and stack housekeeping.
- For coin-cell designs, calculate the **peak current** draw, not just the average. CR2032 cells have high internal resistance (~15–30 Ω), limiting peak current to ~10–15 mA before significant voltage droop. A BLE TX burst at 7 mA is within this budget, but adding LED indicators or sensor readings during the TX event can push peak current beyond the cell's capability.
- Use the fastest advertising interval at startup (100 ms for 30 seconds), then switch to a slow interval (1–2 s). Most user interactions happen within the first 30 seconds; after that, the device enters its steady-state low-power mode.
- On ESP32, use `esp_bt_sleep_enable()` and configure modem sleep to allow the BLE controller to sleep between events. Without this, the radio subsystem draws continuous current even when idle.

## Caveats

- **Battery capacity ratings assume constant current discharge** — a CR2032 rated at 225 mAh delivers that capacity at a ~0.2 mA constant discharge. At 10 µA average with 7 mA peaks, the effective capacity may be 5–10% lower due to the pulsed load characteristic and voltage recovery between pulses.
- **System-on sleep current depends on what is enabled** — the nRF52832 specification cites 1.5 µA in system-on with 64 KB RAM retention. Enabling additional RAM blocks, keeping peripheral clocks running, or leaving GPIO pins in non-optimal states adds 0.5–5 µA. Audit every peripheral and pin configuration.
- **Phone behavior dominates connected power** — when connected to an iPhone or Android device, the phone determines the connection interval. iPhones typically enforce 30 ms CI initially, which draws ~700 µA on the peripheral. A parameter update request to 100 ms or longer must be accepted by the phone before power savings materialize.
- **Advertising power measurements in a noisy RF environment differ from clean lab results** — interference causes the scanner to miss advertisements, but it does not affect the advertiser's power consumption. However, if active scanning is used and the scan response requires retransmission, the advertiser's per-event energy increases.
- **DC/DC converter efficiency depends on supply voltage** — the nRF52's DC/DC provides maximum benefit at higher supply voltages (3.0–3.6 V). At 1.8 V (near end-of-life for a single-cell LiPo), the DC/DC advantage diminishes because the input-to-output voltage ratio is smaller.

## In Practice

- A temperature/humidity sensor reporting every 60 seconds via BLE notifications draws ~8 µA average on nRF52832 with DC/DC enabled, 1-second advertising for discovery, and CI=500 ms with slave latency 9 during connected operation. On a CR2032, this achieves approximately 2 years of battery life in a typical home environment.
- A wearable fitness band connected to a phone at 30 ms CI (iPhone default) draws ~700 µA. After a successful parameter update to 100 ms CI with slave latency 4, current drops to ~15 µA — a 46x improvement. If the parameter update is rejected (common during active app interaction), the firmware should retry periodically until the phone accepts the lower-power parameters.
- Measuring BLE power without a PPK2 or similar instrument leads to incorrect conclusions. A standard multimeter on the µA range cannot capture the dynamic current profile of BLE (0.3 µA sleep → 7 mA peak in microseconds). The PPK2's 100 kHz sampling rate is the minimum needed to resolve individual advertising and connection events.
- An asset tracker that reports position once per hour uses system-off between reports, drawing 0.4 µA during idle periods. Each report cycle (wake → GPS fix → BLE connect → transmit → disconnect → system-off) costs approximately 30–100 mAh depending on GPS acquisition time. With a 500 mAh LiPo, the device operates for 1–2 months — the GPS fix, not BLE, is the dominant power consumer.
- A device that shows higher-than-expected power consumption in the field but measures correctly on the bench should be checked for peripheral leakage. External sensors or peripherals connected to GPIO pins can draw current through pull-ups, pull-downs, or input leakage. Setting unused GPIO pins to disconnected input mode (`NRF_GPIO_PIN_DIR_INPUT`, `NRF_GPIO_PIN_INPUT_DISCONNECT`) eliminates this source of leakage.
