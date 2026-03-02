---
title: "WiFi Power Management"
weight: 50
---

# WiFi Power Management

WiFi is the most power-hungry radio option available on low-cost microcontrollers. An ESP32 transmitting at full power draws 240 mA — enough to drain a 1000 mAh LiPo battery in about four hours of continuous use. Battery-powered WiFi devices are only viable through aggressive duty cycling: keeping the radio off for the vast majority of the time and minimizing the duration of each active period. The 802.11 standard includes power save mechanisms that allow a station to sleep between beacon intervals, but these were designed for laptops, not microcontrollers — getting them to work reliably on constrained devices requires careful tuning of listen intervals, DTIM settings, and AP compatibility.

## Power States and Current Draw

The ESP32 provides the most commonly referenced current draw numbers for MCU WiFi, and serves as a useful baseline for understanding the power cost of each operating mode.

| Power State | Current Draw | Radio | CPU | RAM | Wake Source | Wake Latency |
|---|---|---|---|---|---|---|
| Active TX (13 dBm) | 240 mA | Transmitting | Running | Retained | N/A | N/A |
| Active TX (max, 20 dBm) | 310–340 mA | Transmitting | Running | Retained | N/A | N/A |
| Active RX | 95–100 mA | Receiving | Running | Retained | N/A | N/A |
| Modem sleep | 20 mA | Off | Running | Retained | Software (immediate) | ~1 ms radio startup |
| Light sleep | 0.8 mA | Off | Paused | Retained | Timer, GPIO, UART | ~1–3 ms |
| Deep sleep | 10 µA | Off | Off | Lost (RTC RAM only) | Timer, EXT0/EXT1 GPIO | ~200–500 ms (full boot) |
| Hibernation | 5 µA | Off | Off | Lost (including RTC) | EXT0 GPIO only | ~200–500 ms (full boot) |

For comparison, other WiFi-capable MCU platforms show similar patterns:

| Platform | TX Current | RX Current | Lowest Sleep (radio off) |
|---|---|---|---|
| ESP32 (WROOM-32) | 240 mA | 100 mA | 10 µA (deep sleep) |
| ESP32-C3 (RISC-V) | 300 mA | 80 mA | 5 µA (deep sleep) |
| ESP32-S3 | 310 mA | 95 mA | 8 µA (deep sleep) |
| Raspberry Pi Pico W (CYW43439) | 200 mA | 60 mA | ~25 µA (dormant) |
| ATWINC1500 (SPI module) | 268 mA | 56 mA | 3 µA (power-down) |
| RTL8720DN (BW16) | 250 mA | 80 mA | 7 µA (deep sleep) |

The TX current figures represent the radio module only. Total system current includes the MCU core, voltage regulator quiescent current, and any other active peripherals.

## 802.11 Power Save Modes

The 802.11 standard defines power save mechanisms that allow a station (STA) to enter a doze state between access point (AP) beacons. The AP buffers frames destined for sleeping stations and announces their availability in the Traffic Indication Map (TIM) field of each beacon.

### PS-Poll (Legacy Power Save)

In legacy power save mode, the station wakes at each DTIM beacon interval, checks the TIM for buffered frames, and sends a PS-Poll frame to retrieve each buffered unicast frame individually. This mode is simple but inefficient when multiple frames are buffered — each frame requires a separate PS-Poll/response exchange.

### WMM Power Save (U-APSD)

WMM Power Save (Unscheduled Automatic Power Save Delivery) is more efficient for bursty traffic. The station sends a trigger frame (any QoS data frame) when it is ready to receive, and the AP delivers all buffered frames in a burst. This reduces the number of wake-up cycles for applications that naturally produce bursts of traffic (e.g., sending a sensor reading and immediately receiving an acknowledgment).

### DTIM and Listen Interval

Two parameters control how frequently a sleeping station must wake to check for buffered frames:

**DTIM (Delivery Traffic Indication Map) interval** — Set by the AP, typically 1–10 beacon intervals. A DTIM interval of 3 with a 100 ms beacon period means the AP sends a DTIM beacon every 300 ms. Broadcast and multicast frames are delivered only at DTIM beacons, so the station must wake at least every DTIM interval to receive them.

**Listen interval** — Set by the station during association, specifying the maximum number of beacon intervals between wake-ups. A listen interval of 10 with a 100 ms beacon period means the station may sleep for up to 1 second between wake-ups. The AP must buffer unicast frames for this duration, which consumes AP memory — some consumer APs drop buffered frames if the listen interval exceeds their buffer capacity.

```c
/* ESP-IDF: Configuring listen interval for power save */
wifi_config_t wifi_config = {
    .sta = {
        .ssid = "MyNetwork",
        .password = "MyPassword",
        .listen_interval = 10,  /* Wake every 10 beacons (typically 1s) */
    },
};
esp_wifi_set_config(WIFI_IF_STA, &wifi_config);

/* Enable power save mode */
esp_wifi_set_ps(WIFI_PS_MIN_MODEM);  /* Wake at every DTIM */
/* or */
esp_wifi_set_ps(WIFI_PS_MAX_MODEM);  /* Wake at listen interval */
```

The interaction between DTIM and listen interval determines the effective sleep duration:

| Beacon Interval | DTIM Interval | Listen Interval | Effective Wake Period | Typical Current Savings |
|---|---|---|---|---|
| 100 ms | 1 | 1 | Every 100 ms | Minimal — 5–10% reduction |
| 100 ms | 3 | 3 | Every 300 ms | Moderate — 20–40% reduction |
| 100 ms | 3 | 10 | Every 1000 ms | Significant — 50–70% reduction |
| 100 ms | 10 | 10 | Every 1000 ms | Maximum — misses most broadcasts |

Setting `WIFI_PS_MIN_MODEM` wakes at every DTIM beacon, which is the safest option for maintaining broadcast/multicast reception (essential for ARP, mDNS, and DHCP). Setting `WIFI_PS_MAX_MODEM` wakes only at the listen interval, potentially missing broadcasts between DTIM beacons — this saves more power but can cause connectivity issues if the device misses ARP requests or DHCP renewals.

## ESP32 Sleep Modes in Detail

### Modem Sleep

Modem sleep turns off the WiFi radio between DTIM/listen intervals while the CPU continues running. This is the default power save mode in ESP-IDF when WiFi is connected. The CPU can perform computation, read sensors, and prepare data for transmission while the radio is off. Current draw drops from ~100 mA (RX idle) to ~20 mA (CPU active, radio off). When the next beacon interval arrives, the radio powers up in approximately 1 ms and receives the beacon.

### Light Sleep

Light sleep extends modem sleep by also pausing the CPU (clock-gating). Current draw drops to approximately 0.8 mA. SRAM contents are retained, so the device resumes execution from where it paused — no reboot or re-association is needed. The WiFi stack automatically wakes before each DTIM/listen interval to receive beacons and buffered frames.

```c
/* ESP-IDF: Enabling automatic light sleep with WiFi */
/* WiFi must already be connected */
esp_wifi_set_ps(WIFI_PS_MIN_MODEM);

/* Enable automatic light sleep — CPU sleeps between WiFi events */
esp_pm_config_t pm_config = {
    .max_freq_mhz = 240,
    .min_freq_mhz = 80,
    .light_sleep_enable = true,
};
esp_pm_configure(&pm_config);

/* The FreeRTOS idle task will now enter light sleep automatically
   when no tasks are ready to run. WiFi wakeups happen transparently. */
```

Automatic light sleep requires `CONFIG_FREERTOS_USE_TICKLESS_IDLE=y` and `CONFIG_PM_ENABLE=y` in the ESP-IDF menuconfig. The power management system coordinates with the WiFi driver to ensure the CPU wakes before each scheduled beacon reception.

### Deep Sleep

Deep sleep turns off the CPU, most of the RAM, and the radio. Only the RTC controller and optionally 8 KB of RTC slow memory remain powered, drawing approximately 10 µA. Waking from deep sleep is equivalent to a full reboot — the firmware runs from the reset vector, WiFi must re-associate, and TCP/IP connections must be re-established. This makes deep sleep unsuitable for maintaining a persistent connection but excellent for periodic transmit-only patterns.

```c
/* ESP-IDF: Deep sleep with periodic wake for WiFi transmission */
#include "esp_sleep.h"
#include "esp_wifi.h"

/* Store state in RTC memory to survive deep sleep */
RTC_DATA_ATTR static int boot_count = 0;

void app_main(void) {
    boot_count++;

    /* Full WiFi initialization — connect, send data, disconnect */
    wifi_init_sta();
    wait_for_connection();
    send_sensor_data();  /* MQTT publish or HTTP POST */
    esp_wifi_disconnect();
    esp_wifi_stop();

    /* Enter deep sleep for 60 seconds */
    esp_sleep_enable_timer_wakeup(60 * 1000000ULL);  /* microseconds */
    esp_deep_sleep_start();
    /* Execution never reaches here — device reboots on wake */
}
```

## Duty Cycle Calculation

The average current draw of a duty-cycled WiFi device depends on the time spent in each state during a complete wake-sleep cycle.

**Example: Sensor node waking every 60 seconds to transmit a reading**

| Phase | Duration | Current | Charge (µAh) |
|---|---|---|---|
| Wake from deep sleep | 200 ms | 40 mA | 2.22 |
| WiFi connect (DHCP) | 2,000 ms | 140 mA | 77.78 |
| TLS handshake | 800 ms | 120 mA | 26.67 |
| MQTT publish + ACK | 200 ms | 180 mA | 10.00 |
| WiFi disconnect | 100 ms | 100 mA | 2.78 |
| Deep sleep | 56,700 ms | 0.01 mA | 0.16 |
| **Total cycle** | **60,000 ms** | | **119.61 µAh** |

Average current = 119.61 µAh / (60,000 ms / 3,600,000 ms/h) = 119.61 / 0.01667 = **7.17 mA**

This is dominated by the WiFi connection phase. Reducing the connection time has the highest leverage on battery life.

**Optimizations to reduce average current:**

- **Static IP** — Eliminates DHCP, saving 500–1500 ms per wake cycle. Configure a static IP, gateway, and DNS in firmware.
- **TLS session resumption** — Caches the TLS session ticket in RTC memory, reducing the handshake from 800 ms to ~200 ms on subsequent connections.
- **WiFi fast connect** — Store the AP's BSSID and channel in RTC memory to skip the scan phase, saving 200–500 ms.
- **UDP instead of TCP/TLS** — For non-sensitive data, sending a UDP datagram eliminates TLS handshake and TCP three-way handshake entirely, reducing the transmit phase to ~100 ms.

With all optimizations applied, the active phase can shrink from 3.3 seconds to approximately 1 second, reducing average current to ~3 mA.

## Battery Life Estimation

Using the duty cycle calculation above, battery life estimates for common battery types:

| Battery | Capacity (mAh) | Avg Current (mA) | Runtime (hours) | Runtime (days) |
|---|---|---|---|---|
| CR2032 coin cell | 230 | 7.17 | 32 | 1.3 |
| 2x AA alkaline | 2800 | 7.17 | 390 | 16 |
| 18650 LiPo | 3400 | 7.17 | 474 | 20 |
| CR2032 coin cell | 230 | 3.0 (optimized) | 77 | 3.2 |
| 2x AA alkaline | 2800 | 3.0 (optimized) | 933 | 39 |
| 18650 LiPo | 3400 | 3.0 (optimized) | 1133 | 47 |
| 18650 LiPo | 3400 | 0.8 (light sleep, connected) | 4250 | 177 |

These figures assume ideal battery behavior. Real-world derating factors include:

- **Battery self-discharge** — Alkaline cells lose 5–10% capacity per year; LiPo cells lose 2–5% per month at room temperature.
- **Internal resistance** — CR2032 internal resistance is 10–40 ohms, causing significant voltage drop at 140 mA draw; effective capacity at WiFi TX currents may be 50% of rated capacity or less.
- **Temperature** — Lithium cell capacity drops 10–20% at 0 degC and 30–40% at -20 degC.
- **Regulator dropout** — A 3.3 V LDO with 200 mV dropout stops regulating when the battery voltage drops below 3.5 V, leaving unusable capacity in the cell.

CR2032 coin cells are fundamentally unsuitable for WiFi applications due to their high internal resistance. The 140+ mA current spikes during WiFi TX cause the cell voltage to sag below the MCU's brownout threshold, causing resets. Even with a large decoupling capacitor (100–470 µF) to buffer the spikes, the effective battery life from a CR2032 powering a WiFi device is typically under two days.

## AP Compatibility Issues

Aggressive power save settings interact poorly with some access points, particularly consumer-grade routers:

| Issue | Symptom | Root Cause |
|---|---|---|
| Dropped association | Device disconnects after minutes of sleep | AP drops station from association table when it misses too many beacons |
| Failed ARP | Device becomes unreachable from LAN | AP's ARP cache expires; sleeping station misses ARP requests |
| DHCP lease loss | Device gets new IP after waking | AP does not buffer DHCP renewal; lease expires during sleep |
| Multicast loss | mDNS, SSDP, IGMP stop working | Station misses multicast frames between DTIM intervals |
| Sluggish response | 1–3 second latency for incoming connections | Station asleep when request arrives; AP must buffer until next wake |

Testing with the target AP hardware is essential. Enterprise APs (Cisco, Aruba, Ubiquiti) generally handle power save stations more reliably than consumer routers, as their buffer management is designed for large numbers of mobile clients.

```c
/* ESP-IDF: Disabling power save when responsiveness is needed */
/* Use this when the device must respond to incoming connections quickly */
esp_wifi_set_ps(WIFI_PS_NONE);  /* Radio stays on continuously — ~100 mA */

/* Re-enable power save when entering a low-power period */
esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
```

## Tips

- Use static IP configuration for deep-sleep duty-cycled devices — eliminating DHCP saves 500–1500 ms per wake cycle, which is often the single largest contributor to average current draw.
- Store the AP BSSID and channel number in RTC memory (`RTC_DATA_ATTR`) and use `wifi_config_t.sta.bssid_set = true` on subsequent boots to skip the scan phase — this saves 200–500 ms per connection.
- Cache the TLS session ticket in RTC memory (8 KB RTC slow memory is sufficient for one ticket) to reduce TLS handshake from ~800 ms to ~200 ms — the session ticket is valid for the server's configured lifetime, typically 1–24 hours.
- Measure actual current draw with a Nordic PPK2 or similar tool during the complete wake-sleep cycle — the wake-up current spike and WiFi connection sequence are invisible to a multimeter and dominate the power budget.
- Consider whether WiFi is the right radio for the application — BLE consumes 5–15 mA during transmission and supports connection intervals as low as 7.5 ms; for low-throughput sensor data, BLE provides 10x better battery life than WiFi.

## Caveats

- **Modem sleep current varies widely with ESP32 module** — The 20 mA figure for modem sleep includes the ESP32 CPU running at 80 MHz; actual consumption depends on what the firmware is doing during the radio-off interval. A busy loop draws more than an idle task waiting on a FreeRTOS queue.
- **Light sleep with WiFi requires specific ESP-IDF configuration** — Without `CONFIG_PM_ENABLE`, `CONFIG_FREERTOS_USE_TICKLESS_IDLE`, and proper power management locks, the CPU does not actually enter light sleep even when `light_sleep_enable` is set.
- **Deep sleep WiFi reconnection time is not deterministic** — The 2-second connection estimate assumes a visible AP on a clean channel; in congested RF environments, scanning and association can take 3–5 seconds, roughly doubling the power consumption per cycle.
- **WiFi power save disables during active data transfer** — The radio must remain on for the entire duration of a TCP transfer; sending 10 KB at 1 Mbps effective throughput keeps the radio active for ~80 ms, regardless of power save settings.
- **CR2032 cells sag dramatically under WiFi loads** — A fresh CR2032 at 3.0 V drops to 2.4–2.6 V under 150 mA load due to 10–40 ohm internal resistance; this is below the 2.7 V brownout threshold of most 3.3 V MCUs and causes immediate reset.

## In Practice

- A WiFi sensor node that runs for weeks in the lab but dies within days in deployment often has a longer-than-expected connection time due to RF congestion — capturing the connection duration with a GPIO toggle and oscilloscope reveals 3–5 second associations instead of the expected 1–2 seconds.
- A battery-powered device that resets when transmitting is drawing more current than the battery can source — adding a 100–470 µF capacitor on the 3.3 V rail or switching to a LiPo cell with lower internal resistance resolves the brownout.
- A device using `WIFI_PS_MAX_MODEM` that gradually becomes unreachable over hours is missing ARP requests from the gateway — switching to `WIFI_PS_MIN_MODEM` (wake at every DTIM) restores reachability at a modest power cost.
- A deep-sleep device that occasionally fails to connect and wastes an entire wake cycle retrying benefits from a connection timeout — if association does not complete within 5 seconds, returning to deep sleep immediately and retrying on the next cycle preserves more battery than waiting indefinitely.
- Firmware that achieves excellent battery life on one AP model but drains rapidly on another typically has a DTIM mismatch — some consumer APs default to DTIM interval 1 (wake every 100 ms) while enterprise APs use DTIM 3–10; checking the AP configuration and matching the listen interval accordingly closes the gap.
