---
title: "2.4 GHz Radio Coexistence"
weight: 20
---

# 2.4 GHz Radio Coexistence

The 2.4 GHz ISM band (2.400–2.4835 GHz) is shared by WiFi, BLE, Thread, Zigbee, proprietary radios, microwave ovens, and USB 3.0 interference. When a single product incorporates two or more 2.4 GHz radios — WiFi+BLE on an ESP32, BLE+Thread on an nRF5340, or all three on a SiLabs EFR32 — those radios must coordinate access to avoid mutual interference that degrades throughput, increases latency, and raises power consumption through retransmissions.

Understanding how each protocol occupies spectrum, how combo chips arbitrate between co-located radios, and how to measure and mitigate interference at the bench is essential for shipping reliable multi-protocol devices.

## Spectrum Occupancy by Protocol

Each 2.4 GHz protocol carves the ISM band differently. The key parameters are channel bandwidth, number of channels, and dwell time per channel.

### WiFi (802.11 b/g/n)

WiFi uses 20 MHz or 40 MHz channels. In the 2.4 GHz band, only three non-overlapping 20 MHz channels exist: 1 (2.412 GHz), 6 (2.437 GHz), and 11 (2.462 GHz). A WiFi transmission occupies 20 MHz continuously for the duration of each frame — typically 0.1–5 ms depending on payload size and data rate. Between frames, the channel is released for CSMA/CA contention.

WiFi is the dominant consumer of 2.4 GHz bandwidth because it transmits at high power (15–20 dBm) with wide channels and long frame durations.

### BLE (Bluetooth Low Energy 5.x)

BLE uses 40 channels, each 2 MHz wide, spanning 2.400–2.480 GHz. Three channels (37, 38, 39) are dedicated to advertising; the remaining 37 are data channels. BLE hops between data channels using adaptive frequency hopping (AFH), which can exclude channels that overlap with active WiFi transmissions.

A BLE connection event typically occupies a single 2 MHz channel for 1–10 ms, then hops to a different channel for the next event. This narrow, hopping behavior makes BLE inherently more coexistence-friendly than WiFi.

### Thread / Zigbee (802.15.4)

IEEE 802.15.4 defines 16 channels in the 2.4 GHz band, each 2 MHz occupied bandwidth with 5 MHz channel spacing. The channels are numbered 11–26, centered from 2.405 GHz to 2.480 GHz. Each transmission is a single frame of up to 127 bytes, taking approximately 4 ms at 250 kbps.

The 802.15.4 channel plan overlaps significantly with WiFi:

```
WiFi Channel 1     WiFi Channel 6     WiFi Channel 11
2.401─────2.423    2.426─────2.448    2.451─────2.473
   │ ▲  ▲  ▲  ▲ │    │ ▲  ▲  ▲  ▲ │    │ ▲  ▲  ▲  ▲ │
   │11 12 13 14│    │15 16 17 18 19│    │20 21 22 23 24│ 25 26
   └───────────┘    └──────────────┘    └──────────────┘
   802.15.4 channels affected by each WiFi channel
```

Only 802.15.4 channels 15, 20, 25, and 26 sit in the gaps between WiFi channels 1, 6, and 11. Channel 26 (2.480 GHz) is above WiFi channel 11 and is often the best choice for Thread/Zigbee when WiFi coexistence is a concern — however, some regions restrict channel 26, and not all chipsets support it at full power.

## Channel Overlap Map

The following table shows the interference relationship between WiFi and 802.15.4 channels:

| WiFi Ch | Center (GHz) | 802.15.4 Channels Affected | BLE Channels Affected |
|---------|-------------|---------------------------|----------------------|
| 1 | 2.412 | 11, 12, 13, 14 | 0–19 |
| 6 | 2.437 | 15, 16, 17, 18, 19 | 12–31 |
| 11 | 2.462 | 20, 21, 22, 23, 24 | 24–36 |
| — | — | 25 (clear) | 37+ (advertising) |
| — | — | 26 (clear, restricted in some regions) | — |

When WiFi occupies channels 1, 6, and 11 simultaneously (common in apartment buildings), virtually the entire 802.15.4 channel range is impacted. Only channels 25 and 26 remain interference-free.

## Packet Traffic Arbitration (PTA)

Combo chips that integrate multiple radios use Packet Traffic Arbitration (PTA) to coordinate access to the shared RF front-end and antenna. PTA is a hardware mechanism — firmware configures priority levels and timing parameters, but the actual arbitration happens in real time at the radio controller level.

### ESP32 (WiFi + BLE)

The ESP32 integrates a single 2.4 GHz radio that time-shares between WiFi and BLE. The coexistence controller uses a priority scheme:

| Operation | Priority | Notes |
|-----------|----------|-------|
| WiFi beacon RX | High | Missing beacons triggers disconnection |
| BLE connection event | High | Especially during connection setup |
| WiFi data TX/RX | Medium | Yields to BLE connection events |
| BLE advertising | Medium | Can be delayed by WiFi traffic |
| WiFi scan | Low | Pauses during BLE events |

Configuration in ESP-IDF:

```c
// Enable WiFi/BLE coexistence
esp_coex_preference_set(ESP_COEX_PREFER_BALANCE);

// Options:
// ESP_COEX_PREFER_WIFI    — WiFi gets priority (BLE latency increases)
// ESP_COEX_PREFER_BT      — BLE gets priority (WiFi throughput drops)
// ESP_COEX_PREFER_BALANCE  — Dynamic balancing (default, recommended)
```

In practice, `ESP_COEX_PREFER_BALANCE` works for most applications. Setting WiFi preference is appropriate for streaming or OTA scenarios. BLE preference suits applications where BLE connection stability is critical and WiFi traffic is bursty.

**Measured impact on ESP32:** WiFi throughput drops approximately 20–40% when BLE is actively connected and exchanging data. BLE connection interval reliability degrades when WiFi is performing continuous TCP transfers. A BLE connection interval of 7.5 ms (the minimum) is particularly fragile during WiFi activity — increasing the connection interval to 30–50 ms significantly improves stability.

### nRF5340 (BLE + Thread/Zigbee)

The nRF5340 uses a Multi-Protocol Service Layer (MPSL) that arbitrates between BLE and 802.15.4 at the timeslot level. The network core (128 MHz Cortex-M33) runs the radio controller, while the application core (128 MHz Cortex-M33) runs application code.

```c
// nRF Connect SDK — enabling multiprotocol
// In prj.conf:
CONFIG_MPSL=y
CONFIG_BT=y
CONFIG_NET_L2_OPENTHREAD=y
CONFIG_OPENTHREAD_NORDIC_LIBRARY_MASTER=y

// MPSL manages radio timeslots:
// - BLE connection events get guaranteed timeslots
// - 802.15.4 frames transmit in gaps between BLE events
// - If collision is unavoidable, BLE typically wins (configurable)
```

The nRF5340's MPSL achieves good coexistence because BLE connection events are short (1–5 ms) and periodic, leaving substantial gaps for 802.15.4 traffic. Thread messages (typically < 127 bytes at 250 kbps = ~4 ms airtime) fit within a single BLE connection interval gap.

**Measured impact:** BLE latency increases by 5–15 ms on average when Thread is actively routing mesh traffic. Thread message latency increases by 10–30 ms when BLE is in a fast connection interval (< 15 ms). For Matter devices, where BLE is used only during commissioning and Thread is used for operational traffic, the two protocols rarely operate simultaneously.

### SiLabs EFR32 (Multi-Protocol)

The EFR32MG24 supports BLE, Thread, and Zigbee concurrently through a Radio Scheduler (RAIL) that manages the single radio at the packet level:

```c
// SiLabs GSDK — radio scheduler priorities
// Higher number = higher priority
RAIL_SchedulerSetPriority(railHandle, &(RAIL_SchedulerInfo_t){
    .priority = 100,  // BLE connection events
});

RAIL_SchedulerSetPriority(railHandle, &(RAIL_SchedulerInfo_t){
    .priority = 80,   // 802.15.4 ACK-required frames
});

RAIL_SchedulerSetPriority(railHandle, &(RAIL_SchedulerInfo_t){
    .priority = 50,   // 802.15.4 data frames
});

RAIL_SchedulerSetPriority(railHandle, &(RAIL_SchedulerInfo_t){
    .priority = 30,   // BLE advertising
});
```

The EFR32's RAIL scheduler provides fine-grained control over which protocol wins arbitration in each timeslot. This flexibility is essential for devices that must support all three protocols simultaneously (e.g., a Matter bridge that speaks Zigbee to legacy devices, Thread to new devices, and BLE for commissioning).

## BLE Adaptive Frequency Hopping (AFH)

BLE's Adaptive Frequency Hopping mechanism automatically identifies and avoids channels with persistent interference. The process works as follows:

1. **Channel classification** — The BLE central (or peripheral, in BLE 5.1+) monitors packet error rates on each of the 37 data channels.
2. **Channel map update** — Channels with error rates above a threshold (implementation-dependent, typically > 20% packet loss) are marked as "bad" and removed from the hopping sequence.
3. **Map distribution** — The central sends the updated channel map to the peripheral in an LL_CHANNEL_MAP_IND control PDU.
4. **Hopping adjustment** — Both devices restrict hopping to the remaining "good" channels. A minimum of 2 channels must remain in the map.

```
2.4 GHz Band:
┌─WiFi Ch 1──┐     ┌─WiFi Ch 6──┐     ┌─WiFi Ch 11─┐
│             │     │             │     │             │
▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░
BLE data channels: ▓ = blocked by AFH, ░ = available for hopping

After AFH:
BLE hops only among channels in WiFi gaps and above channel 11
```

AFH typically converges within 5–20 connection events (50–500 ms depending on connection interval). The channel assessment interval is configurable — more frequent assessment adapts faster to changing WiFi traffic but consumes more processing time.

**Practical observation:** AFH works well against static WiFi interference (e.g., a continuously occupied WiFi channel) but struggles with bursty WiFi traffic that occupies a channel intermittently. In such cases, AFH may not classify the channel as "bad" because the packet error rate averaged over the assessment window stays below the threshold.

## Channel Selection Strategies

When deploying multiple protocols on separate radios (not a combo chip), manual channel selection minimizes overlap:

**Strategy 1: Non-overlapping assignment**

| Protocol | Channel | Center Frequency | Bandwidth |
|----------|---------|-------------------|-----------|
| WiFi | 1 | 2.412 GHz | 20 MHz |
| Thread/Zigbee | 25 | 2.475 GHz | 2 MHz |
| BLE | AFH enabled | Hops across gaps | 2 MHz |

This places WiFi at the bottom of the band, 802.15.4 at the top (channel 25 or 26), and relies on BLE AFH to find the remaining gaps. This is the default recommendation for most deployments.

**Strategy 2: WiFi channel 6 avoidance**

In dense environments where neighboring WiFi networks occupy channels 1, 6, and 11, channel 25 is the only reliable 802.15.4 option. BLE AFH typically settles on 8–15 usable channels (out of 37) in these conditions.

**Strategy 3: Single-band segregation**

Some designs use Sub-GHz (Z-Wave, LoRa) for the mesh network and 2.4 GHz only for BLE, completely eliminating 2.4 GHz coexistence concerns for the mesh protocol. The Sub-GHz band is far less congested and offers no overlap with WiFi or BLE.

## Time-Division Approaches

When hardware PTA is unavailable (e.g., separate radio modules sharing an MCU), software-level time-division multiplexing provides coexistence at the cost of throughput:

```c
// Software time-division example: alternating WiFi and BLE windows
// Each window is long enough for meaningful protocol activity

#define WIFI_WINDOW_MS   50   // WiFi gets 50 ms for data transfer
#define BLE_WINDOW_MS    10   // BLE gets 10 ms for connection events
#define CYCLE_MS         (WIFI_WINDOW_MS + BLE_WINDOW_MS)

void coexistence_timer_callback(void) {
    static uint32_t phase = 0;
    phase = (phase + 1) % CYCLE_MS;

    if (phase < WIFI_WINDOW_MS) {
        // WiFi active window — enable WiFi radio, disable BLE
        radio_enable(RADIO_WIFI);
        radio_disable(RADIO_BLE);
    } else {
        // BLE active window — enable BLE radio, disable WiFi
        radio_enable(RADIO_BLE);
        radio_disable(RADIO_WIFI);
    }
}
```

This approach is crude but effective when the hardware provides no PTA. The duty cycle ratio (50:10 in this example) determines the throughput allocation. Adjusting the ratio dynamically based on traffic demand improves efficiency but adds complexity.

**Measured impact:** Software time-division reduces WiFi throughput by approximately 15–25% (due to the BLE windows) and increases BLE latency by up to the WiFi window duration (50 ms in this example). For applications where BLE is used only for provisioning and WiFi is the primary data path, setting WIFI_WINDOW_MS to 80 and BLE_WINDOW_MS to 5 minimizes WiFi impact.

## Measuring Interference with SDR Tools

Diagnosing coexistence issues requires visibility into the RF spectrum. Software-defined radio (SDR) tools provide this visibility at low cost.

### RTL-SDR (~$25 USB dongle)

An RTL-SDR covers 24 MHz – 1.7 GHz (not directly usable for 2.4 GHz, but useful for Sub-GHz coexistence analysis). For 2.4 GHz, an RTL-SDR with an upconverter or a HackRF ($300) is needed.

### HackRF One (~$300)

The HackRF One covers 1 MHz – 6 GHz and can capture the entire 2.4 GHz ISM band. Combined with `inspectrum`, `GNU Radio`, or `Universal Radio Hacker`, the raw IQ data reveals:

- WiFi channel occupancy (20 MHz blocks of high power)
- BLE advertisements (three narrow spikes at channels 37, 38, 39)
- 802.15.4 transmissions (narrow bursts on specific channels)
- Microwave oven interference (broadband noise centered around 2.450 GHz)

### Spectrum Analyzer Software

```bash
# Using hackrf_sweep for real-time spectrum monitoring
hackrf_sweep -f 2400:2500 -w 500000 -l 32 -g 32 | \
    feedgnuplot --stream --domain --lines --title "2.4 GHz Spectrum"

# Capture 10 seconds of raw IQ data at 2.44 GHz center, 20 MHz bandwidth
hackrf_transfer -r capture.raw -f 2440000000 -s 20000000 -n 200000000
```

### Practical Measurement: Packet Error Rate

A more accessible measurement approach is to monitor packet error rates on the device itself, without external SDR hardware:

```c
// BLE: monitor channel quality via HCI
// nRF Connect SDK provides channel assessment data
struct bt_conn_le_phy_info phy_info;
bt_conn_le_get_phy(conn, &phy_info);

// 802.15.4: monitor CCA (Clear Channel Assessment) failures
// High CCA failure rate indicates channel congestion
uint32_t cca_failures = otPlatRadioGetCcaFailureRate(instance);
// > 5% CCA failure rate suggests significant interference

// WiFi: monitor RSSI and retry rate
wifi_ap_record_t ap_info;
esp_wifi_sta_get_ap_info(&ap_info);
int rssi = ap_info.rssi;  // Below -75 dBm indicates potential issues
```

## Antenna Considerations

### Shared Antenna (Combo Chips)

Combo chips (ESP32, nRF5340, EFR32) use a single antenna for all protocols. The antenna must cover the full 2.400–2.4835 GHz band with acceptable VSWR (< 2:1). Since only one protocol transmits at a time (PTA ensures this), there is no simultaneous transmission concern, but the antenna bandwidth must accommodate all protocols.

A single PCB trace antenna (inverted-F or meander line) is the standard approach. Key layout rules:

- Keep a ground plane clearance zone (no copper pour) of at least 3 mm around the antenna trace
- Place the antenna at a board edge, not in the center
- No components or traces within the clearance zone
- RF matching network (pi or T topology) between the radio pin and the antenna allows tuning for the enclosure

### Separate Antennas (Dual Radio Modules)

When using separate radio modules (e.g., ESP32 for WiFi + nRF52840 for Thread), each module has its own antenna. Isolation between antennas is critical:

| Antenna Separation | Typical Isolation | Coexistence Quality |
|-------------------|-------------------|-------------------|
| < 10 mm | < 10 dB | Poor — significant desense |
| 10–25 mm | 10–20 dB | Marginal — AFH helps |
| 25–50 mm | 20–30 dB | Good — minimal impact |
| > 50 mm | > 30 dB | Excellent |
| Opposite board edges | 25–40 dB | Recommended minimum |

**Desensitization** occurs when a nearby transmitter raises the noise floor at the receiver. A WiFi transmission at +15 dBm with only 10 dB of antenna isolation presents +5 dBm of noise to a BLE receiver with -96 dBm sensitivity. The BLE receiver is completely overwhelmed. At 30 dB isolation, the interfering signal drops to -15 dBm — still above the noise floor but manageable with BLE's frequency hopping.

## Tips

- On ESP32, always enable coexistence (`CONFIG_SW_COEXIST_ENABLE=y` in sdkconfig) when using WiFi and BLE simultaneously. Without it, the radios transmit over each other, causing packet loss rates of 30–60%.
- For Thread/Zigbee channel selection, start with channel 25 and only move to lower channels if channel 25 has poor connectivity. Channel 26 is the second choice, but verify that the target market's regulations permit it (some regions restrict 802.15.4 channel 26).
- Increase BLE connection intervals to 30 ms or higher when WiFi is continuously active. The 7.5 ms minimum connection interval is almost always disrupted by WiFi traffic on combo chips.
- When debugging coexistence problems, disable one protocol at a time to isolate the interference source. If BLE throughput improves dramatically when WiFi is disabled, the issue is PTA arbitration or antenna isolation, not BLE stack configuration.
- Use a metal RF shield can (available in standard sizes from Würth, Laird) over each radio module on boards with separate radios. The shield provides 20–40 dB of additional isolation beyond antenna spacing.

## Caveats

- **PTA is not a complete solution** — PTA prevents co-located radios from transmitting simultaneously, but it cannot prevent interference from external devices. A neighbor's WiFi router on the same channel creates interference that no amount of on-board PTA can mitigate.
- **BLE AFH convergence takes time** — After WiFi channel usage changes (e.g., a new AP appears), AFH needs 5–20 connection events to reclassify channels. During convergence, BLE packet loss is elevated. Applications that require immediate reliability should maintain conservative channel maps.
- **Microwave ovens are the worst-case interferer** — A running microwave oven radiates broadband noise across 2.430–2.470 GHz (overlapping WiFi channels 6–11 and 802.15.4 channels 17–24) at power levels 30–40 dB above any wireless protocol. There is no coexistence strategy that works reliably during active microwave oven operation at close range — the only mitigation is physical distance or Sub-GHz protocols.
- **USB 3.0 radiates at 2.4 GHz** — USB 3.0 connectors and cables emit broadband noise in the 2.4 GHz band due to the 5 Gbps signaling rate. Placing a 2.4 GHz antenna near a USB 3.0 connector raises the noise floor by 10–20 dB. Maintain at least 20 mm separation and use shielded USB connectors.
- **Combo chip PTA configuration is silicon-specific** — PTA settings that work on ESP32 do not apply to ESP32-S3 or ESP32-C3, which have different radio architectures. Always consult the specific chip's technical reference manual and coexistence application note.

## In Practice

- An ESP32-based smart plug running WiFi (for cloud MQTT) and BLE (for local smartphone control) experiences intermittent BLE disconnections during firmware OTA updates over WiFi. The root cause is that OTA produces sustained, high-throughput WiFi traffic that dominates PTA arbitration. The fix is to temporarily increase the BLE connection interval to 100 ms during OTA and set `ESP_COEX_PREFER_WIFI` for the duration of the update, accepting degraded BLE responsiveness rather than BLE disconnection.
- A Thread sensor network using channel 15 works reliably in the lab but fails at customer sites where a strong WiFi network occupies channel 6. The 802.15.4 channel 15 center frequency (2.425 GHz) falls within WiFi channel 6's passband (2.426–2.448 GHz). Moving the Thread network to channel 25 (2.475 GHz) resolves the issue immediately.
- An nRF5340-based Matter lock uses BLE for commissioning and Thread for operational control. During commissioning (BLE active for 30–60 seconds), Thread responsiveness degrades — lock/unlock commands take 200–500 ms instead of the usual 50–100 ms. This is expected MPSL behavior and acceptable because commissioning is a one-time event. If both protocols must operate simultaneously at full performance, a dual-chip design (separate BLE and 802.15.4 radios) is the appropriate architecture.
- A prototype board with an ESP32 (WiFi+BLE) and an nRF52840 (Thread) has both antennas on the same board edge, 8 mm apart. BLE scans on the ESP32 trigger CCA failures on the nRF52840, causing Thread packet loss of 15–25%. Moving the nRF52840 antenna to the opposite board edge (60 mm separation) reduces cross-interference to < 2% packet loss.
- A home automation gateway running WiFi, BLE, and Zigbee simultaneously on an EFR32MG24 shows acceptable performance individually but degrades when all three protocols are active. The solution is priority-based scheduling: WiFi data transfers in 100 ms bursts, BLE connection events at 50 ms intervals in the gaps, and Zigbee frames queued for transmission during idle slots. Peak simultaneous throughput is approximately 40% of each protocol's individual maximum, but reliability reaches 99%+ with proper priority tuning.
