---
title: "BLE Connection Parameters & Throughput"
weight: 40
---

# BLE Connection Parameters & Throughput

BLE connection parameters determine three fundamental trade-offs: power consumption, latency, and throughput. Unlike WiFi, where the radio stays on continuously, BLE operates in discrete **connection events** — short windows during which the central and peripheral exchange data, then both radios power down until the next event. The timing of these events, the amount of data exchanged per event, and the physical layer data rate collectively determine what is achievable. A misconfigured connection can waste 10x the power necessary or deliver 10x less throughput than the hardware supports.

## Connection Parameters Overview

Three parameters govern connection timing:

| Parameter | Range | Default (typical) | Unit |
|-----------|-------|-------------------|------|
| Connection Interval (CI) | 7.5 ms – 4 s | 30–50 ms (phone-dependent) | 1.25 ms steps |
| Slave Latency | 0 – 499 | 0 | Connection events |
| Supervision Timeout | 100 ms – 32 s | 4–6 s | 10 ms steps |

**Connection Interval (CI)** — The time between the start of two consecutive connection events. A 30 ms CI means the devices wake up and exchange data every 30 ms. Shorter intervals increase throughput and reduce latency but consume more power.

**Slave Latency** — The number of consecutive connection events the peripheral is allowed to skip if it has no data to send. With slave latency = 4, the peripheral can sleep through 4 events and only wake on the 5th. The central must still wake for every event (to transmit if needed), but the peripheral saves power proportional to the latency value.

**Supervision Timeout** — The maximum time without a successful data exchange before the connection is considered lost. If the peripheral skips events (due to slave latency) and then misses additional events (due to interference), the supervision timeout determines when the link is declared dead.

## Parameter Constraint

The BLE specification enforces a critical constraint:

```
Supervision Timeout > (1 + Slave Latency) × Connection Interval × 2
```

This ensures the supervision timer does not expire before the peripheral has a chance to respond after using its full slave latency allowance. Violating this constraint causes the connection to be rejected by the controller.

**Example calculation:**
- CI = 100 ms, Slave Latency = 4
- Minimum supervision timeout > (1 + 4) × 100 ms × 2 = 1000 ms
- Safe value: 2000 ms (providing margin for missed events)

## Connection Event Anatomy

```
┌─ Connection Event ─────────────────────────────────────┐
│                                                         │
│  Central TX    Peripheral TX    Central TX    ...       │
│  ┌──────┐      ┌──────┐        ┌──────┐               │
│  │ Pkt  │ IFS  │ Pkt  │  IFS   │ Pkt  │  IFS  ...    │
│  └──────┘ 150µs└──────┘ 150µs  └──────┘ 150µs         │
│                                                         │
│  ← ──────── Connection Event Duration ──────────── →   │
└─────────────────────────────────────────────────────────┘
    ← CI →
    (next event)
```

Within a connection event, the central and peripheral alternate transmitting packets with a **150 µs Inter-Frame Spacing (IFS)**. Multiple data packets can be exchanged in a single event. The number of packets depends on the connection event length (set by the controller, typically 2.5–7.5 ms) and the packet duration.

## Data Length Extension (DLE)

BLE 4.2 introduced Data Length Extension, which increases the maximum Link Layer PDU payload from 27 bytes to 251 bytes:

| Parameter | Without DLE | With DLE |
|-----------|------------|---------|
| Max LL PDU payload | 27 bytes | 251 bytes |
| Max ATT payload (MTU-3) | 20 bytes | 244 bytes (with MTU 247) |
| Packet airtime (1M PHY) | ~328 µs | ~2120 µs |
| Packets per 7.5 ms event | ~10 | ~2 |
| Bytes per event (net) | ~200 bytes | ~488 bytes |
| Throughput at 30 ms CI | ~53 KB/s | ~130 KB/s |

DLE dramatically improves throughput for large payloads because it reduces the per-packet overhead (preamble, access address, header, CRC, IFS) relative to payload size. Without DLE, each 27-byte packet carries 27 bytes of payload in a ~328 µs transmission, yielding 65% efficiency. With DLE, each 251-byte packet carries 251 bytes in ~2120 µs, yielding 94% efficiency.

DLE is negotiated automatically after connection on most modern stacks. On NimBLE, it is enabled by default. On SoftDevice, call `sd_ble_gap_data_length_update()` after the connection is established.

## PHY Options (BLE 5.0)

BLE 5.0 added two new Physical Layer (PHY) options:

| PHY | Symbol Rate | Data Rate | Range (vs 1M) | Airtime (vs 1M) | Use Case |
|-----|------------|-----------|---------------|-----------------|----------|
| 1M (LE 1M) | 1 Msym/s | 1 Mbps | Baseline | Baseline | Default, compatible |
| 2M (LE 2M) | 2 Msym/s | 2 Mbps | ~80% of 1M | ~50% of 1M | High throughput, lower power per byte |
| Coded S=2 | 1 Msym/s | 500 kbps | ~2x of 1M | ~2x of 1M | Extended range |
| Coded S=8 | 1 Msym/s | 125 kbps | ~4x of 1M | ~8x of 1M | Maximum range |

**2M PHY** doubles the data rate, which has two benefits: higher throughput and lower energy per byte (the radio is on for half the time per packet). The trade-off is slightly reduced range (~20% shorter) because the faster symbol rate reduces receiver sensitivity by approximately 3 dB.

**Coded PHY** adds Forward Error Correction (FEC), trading throughput for range. The S=8 coding achieves approximately 4x the range of 1M PHY but at 1/8 the data rate. This is useful for applications like asset tracking where data is minimal (a few bytes per transmission) but the device must operate at 100+ meter range.

PHY negotiation happens after connection establishment via the `LE PHY Update` procedure. Both devices must support the requested PHY.

## Real-World Throughput Measurements

Throughput depends on the combination of connection interval, DLE, PHY, and number of packets per connection event. Measured values on nRF52840 (Nordic SDK) with a compatible central:

| Configuration | CI | DLE | PHY | Measured Throughput | Power (Peripheral) |
|--------------|-----|-----|-----|--------------------|--------------------|
| Default | 30 ms | Off (27B) | 1M | ~45 KB/s | ~600 µA avg |
| DLE enabled | 30 ms | On (251B) | 1M | ~120 KB/s | ~700 µA avg |
| DLE + 2M PHY | 30 ms | On (251B) | 2M | ~200 KB/s | ~550 µA avg |
| DLE + 2M + fast CI | 7.5 ms | On (251B) | 2M | ~800 KB/s | ~3 mA avg |
| DLE + 2M + 15 ms CI | 15 ms | On (251B) | 2M | ~450 KB/s | ~1.5 mA avg |
| Coded S=8 | 30 ms | Off (27B) | Coded | ~5 KB/s | ~1.2 mA avg |

Key observations:
- Enabling DLE alone nearly triples throughput (45 → 120 KB/s) with minimal power increase.
- Adding 2M PHY increases throughput by ~60% while actually reducing power per byte.
- Shortening the CI from 30 ms to 7.5 ms provides 4x more connection events and approaches the theoretical maximum of ~800 KB/s.
- The peak throughput of ~800 KB/s is achievable but requires both DLE and 2M PHY with an aggressive connection interval.

## Connection Parameter Update Request

The peripheral can request a parameter change after connection using the **L2CAP Connection Parameter Update Request**. The central may accept or reject the request.

```
Flow:
Peripheral → Central:  L2CAP Connection Parameter Update Request
                       (min_CI=100, max_CI=200, latency=4, timeout=6000)
Central → Peripheral:  L2CAP Connection Parameter Update Response
                       (accepted / rejected)
Central:               LE Connection Update (applies new parameters)
```

On iOS, parameter update requests are subject to Apple's guidelines:

| Parameter | Apple Guideline |
|-----------|----------------|
| CI minimum | ≥ 15 ms |
| CI maximum | ≤ 2 s, and ≤ 6 × CI minimum |
| Slave Latency | ≤ 30 |
| Supervision Timeout | ≤ 6 s |
| CI max × (Slave Latency + 1) | ≤ 6 s |

Violating these guidelines causes iOS to reject the parameter update request, leaving the connection at iOS's default parameters (~30 ms CI). Android is more permissive but has its own vendor-specific behaviors.

## NimBLE Connection Parameter Configuration

```c
/* Request connection parameter update (peripheral side) */
static void request_conn_params(uint16_t conn_handle)
{
    struct ble_gap_upd_params params = {
        .itvl_min = BLE_GAP_CONN_ITVL_MS(100),   /* 100 ms min */
        .itvl_max = BLE_GAP_CONN_ITVL_MS(200),   /* 200 ms max */
        .latency  = 4,                             /* Skip up to 4 events */
        .supervision_timeout = 600,                /* 6000 ms (in 10ms units) */
        .min_ce_len = 0,
        .max_ce_len = 0,
    };
    ble_gap_update_params(conn_handle, &params);
}

/* Set preferred PHY (after connection established) */
static void request_2m_phy(uint16_t conn_handle)
{
    uint8_t tx_phys = BLE_GAP_LE_PHY_2M_MASK;
    uint8_t rx_phys = BLE_GAP_LE_PHY_2M_MASK;
    ble_gap_set_prefered_le_phy(conn_handle, tx_phys, rx_phys, 0);
}
```

## SoftDevice Connection Parameter Configuration

```c
/* Request connection parameter update (peripheral side) */
static void request_conn_params(uint16_t conn_handle)
{
    ble_gap_conn_params_t params = {
        .min_conn_interval = MSEC_TO_UNITS(100, UNIT_1_25_MS),
        .max_conn_interval = MSEC_TO_UNITS(200, UNIT_1_25_MS),
        .slave_latency     = 4,
        .conn_sup_timeout  = MSEC_TO_UNITS(6000, UNIT_10_MS),
    };
    sd_ble_gap_conn_param_update(conn_handle, &params);
}

/* Request DLE (after connection) */
static void request_dle(uint16_t conn_handle)
{
    ble_gap_data_length_params_t dle_params = {
        .max_tx_octets  = 251,
        .max_rx_octets  = 251,
        .max_tx_time_us = 2120,
        .max_rx_time_us = 2120,
    };
    sd_ble_gap_data_length_update(conn_handle, &dle_params, NULL);
}

/* Request 2M PHY */
static void request_2m_phy(uint16_t conn_handle)
{
    ble_gap_phys_t phys = {
        .tx_phys = BLE_GAP_PHY_2MBPS,
        .rx_phys = BLE_GAP_PHY_2MBPS,
    };
    sd_ble_gap_phy_update(conn_handle, &phys);
}
```

## Power vs Throughput vs Latency Trade-offs

| Application | Recommended CI | Slave Latency | DLE | PHY | Avg Current | Throughput | Latency |
|-------------|---------------|---------------|-----|-----|------------|-----------|---------|
| Environment sensor (1 reading/min) | 500 ms | 0 | Off | 1M | ~5 µA | N/A | 500 ms |
| Fitness tracker (1 Hz updates) | 100 ms | 4 | Off | 1M | ~15 µA | ~20 KB/s | 100–500 ms |
| Interactive remote control | 15 ms | 0 | Off | 1M | ~200 µA | ~50 KB/s | 15 ms |
| Audio streaming (LC3) | 10 ms | 0 | On | 2M | ~2 mA | ~200 KB/s | 10 ms |
| Firmware update (DFU) | 7.5 ms | 0 | On | 2M | ~3 mA | ~800 KB/s | 7.5 ms |
| Long-range sensor | 500 ms | 0 | Off | Coded S=8 | ~20 µA | ~2 KB/s | 500 ms |

The typical pattern for sensor applications: negotiate a moderate CI (100–200 ms) with slave latency (4–10) for the data phase, then temporarily switch to a fast CI (7.5–15 ms) during firmware updates or bulk data transfers. After the transfer completes, revert to the low-power parameters.

## Throughput Calculation

Theoretical maximum throughput can be estimated:

```
Packets per CI = floor(CI / packet_time)
  where packet_time = airtime + IFS (150 µs)

1M PHY, DLE (251B payload):
  airtime = (preamble + access_addr + header + payload + crc) / 1 Mbps
          = (1 + 4 + 2 + 251 + 3) bytes × 8 / 1 Mbps
          = 2088 µs
  packet_time = 2088 + 150 = 2238 µs
  With 7.5 ms CI: floor(7500 / 2238) = 3 packets/event
  But: alternating TX/RX, so ~3 packets per direction per event
  Net throughput: 3 × 244 bytes × (1000/7.5) events/s = ~97 KB/s

2M PHY, DLE (251B payload):
  airtime = (2 + 4 + 2 + 251 + 3) bytes × 8 / 2 Mbps
          = 1048 µs
  packet_time = 1048 + 150 = 1198 µs
  With 7.5 ms CI: floor(7500 / 1198) = 6 packets/event
  Net throughput: 6 × 244 bytes × (1000/7.5) events/s = ~195 KB/s
```

Actual throughput varies because connection event length is controller-managed and may not fill the entire CI. The nRF52840 SoftDevice achieves close to theoretical limits with proper configuration. ESP32 NimBLE achieves approximately 70–80% of theoretical maximum due to scheduling and processing overhead.

## Tips

- Request DLE and 2M PHY immediately after connection establishment. Most stacks support doing both in the same connection event. The performance improvement is significant (3–4x throughput) with no user-visible downside.
- For sensor applications, use slave latency rather than a very long connection interval. A 100 ms CI with slave latency 9 gives an effective wake rate of 1 second, but the device can still respond within 100 ms when there is data to send. A 1000 ms CI with latency 0 forces a 1-second minimum response time.
- Test connection parameter updates with the actual target phone OS. Apple and Android negotiate parameters differently and may reject requests that fall outside their acceptable ranges.
- Monitor the `BLE_GAP_EVT_CONN_PARAM_UPDATE` (SoftDevice) or `BLE_GAP_EVENT_CONN_UPDATE` (NimBLE) event to confirm that requested parameters were actually applied. The central may choose different values than requested.
- For maximum throughput, send multiple notifications per connection event rather than one notification per event. Queue data in the stack's TX buffer and let the controller pack as many as possible into each event.

## Caveats

- **iOS does not expose CI directly to apps** — iOS selects the connection interval based on its own heuristics and the peripheral's parameter update request. The actual CI may differ from what was requested, and there is no API for the iOS app to override it.
- **Slave latency interacts poorly with notification latency** — if the peripheral uses slave latency and the central sends a write while the peripheral is sleeping, the write is delivered at the next event the peripheral participates in. This can add up to `slave_latency × CI` of latency to central-to-peripheral communication.
- **Not all centrals support 2M PHY** — older phones (pre-2018) and some embedded centrals support only 1M PHY. The PHY negotiation gracefully falls back to 1M, but throughput expectations must account for this.
- **Connection event length is not directly configurable on most stacks** — the controller decides how long each connection event lasts based on pending data, other connections, and scheduling constraints. This means throughput can vary between connection events even with constant CI.
- **Switching between low-power and high-throughput parameters takes time** — a parameter update request round-trip takes at least 2 × CI. Transitioning from 500 ms CI to 7.5 ms CI for a firmware update adds ~1 second of setup time before high-throughput transfer begins.

## In Practice

- A fitness tracker sending 20-byte heart rate measurements once per second should use CI = 100 ms with slave latency = 9. The effective connection rate is ~1 second, keeping average current under 15 µA on nRF52. When the user opens the companion app and requests historical data, the app can request a CI update to 15 ms for bulk transfer, then revert to 100 ms + latency when complete.
- A firmware update that must complete in under 30 seconds for a 200 KB image requires sustained throughput of at least 7 KB/s. With default parameters (no DLE, 1M PHY, 30 ms CI), throughput is ~45 KB/s — sufficient. With DLE + 2M PHY + 7.5 ms CI, throughput reaches ~800 KB/s, completing the same update in under a second.
- A peripheral that reports "connected" but shows zero throughput in the application may be stuck at default connection parameters with the central not scheduling enough packets per event. Checking the actual connection interval (logged by the stack's event handler) and comparing it against the requested value reveals whether the parameter update was accepted.
- A multi-peripheral gateway running on nRF52840 managing 10 simultaneous connections must balance connection scheduling. With 10 connections at 30 ms CI, the controller has 3 ms per connection per interval — enough for 1–2 packets each. Reducing the number of active connections or increasing CI allows more data per connection event.
- Measuring actual throughput requires a dedicated test: send a known number of bytes over notifications and time the transfer. Do not rely on CI × payload calculation because connection event length, TX buffer depth, and controller scheduling all affect the real number. The Nordic `ble_app_throughput` example provides a reference implementation.
