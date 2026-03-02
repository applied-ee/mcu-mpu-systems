---
title: "BLE Central Role & Scanning"
weight: 60
---

# BLE Central Role & Scanning

Most BLE tutorials focus on the peripheral role — advertising a service and waiting for a phone to connect. But many embedded applications require the MCU to act as a **central**: scanning for peripherals, initiating connections, and managing ongoing data exchange with one or more remote devices. The gateway pattern — an MCU central aggregating data from a fleet of BLE sensor peripherals — is one of the most common architectures in commercial IoT deployments. Running a BLE central on an MCU introduces scheduling challenges, memory constraints, and scanning trade-offs that do not exist in phone-based central implementations.

## Scanning Fundamentals

Before a central can connect to a peripheral, it must discover it through scanning. The central's radio listens on the three advertising channels (37, 38, 39) and reports received advertising packets to the host stack.

Two scanning modes exist:

**Passive Scanning** — The central listens for advertising packets but does not transmit anything. It receives only the advertising PDU payload (up to 31 bytes). This mode consumes less power and does not affect the advertiser's power consumption.

**Active Scanning** — The central listens for advertising packets and, upon receiving one from a scannable advertiser, sends a `SCAN_REQ` to request the scan response data. This provides up to 62 bytes of total data (31 advertising + 31 scan response) but requires the advertiser to transmit the scan response, increasing both sides' power consumption.

| Parameter | Passive Scanning | Active Scanning |
|-----------|-----------------|-----------------|
| Data received | Advertising PDU only (31 bytes) | Advertising + Scan Response (62 bytes) |
| Central power | RX only | RX + occasional TX |
| Advertiser power | Unaffected | Increased (scan response TX) |
| Discovery speed | Same | Same (scan response adds ~150 µs) |
| Use case | Beacon monitoring, power-constrained central | Device discovery, name resolution |

## Scan Window and Scan Interval

The scan window and interval parameters control the duty cycle of the scanner's radio:

```
Scan Interval: ─────────────────────────────────────────────
                │                    │                    │
Scan Window:    ├────────┤           ├────────┤           ├────────┤
                │ Radio  │ Radio     │ Radio  │ Radio     │ Radio  │
                │  ON    │  OFF      │  ON    │  OFF      │  ON    │
```

| Parameter | Range | Default (typical) | Unit |
|-----------|-------|-------------------|------|
| Scan Interval | 2.5 ms – 10.24 s | 100 ms | 0.625 ms steps |
| Scan Window | 2.5 ms – 10.24 s | 50 ms | 0.625 ms steps |

The scan window must be less than or equal to the scan interval. The **scan duty cycle** is `window / interval`:

| Scan Interval | Scan Window | Duty Cycle | Avg Current (nRF52840) | Discovery Probability* |
|--------------|-------------|-----------|----------------------|----------------------|
| 100 ms | 100 ms | 100% (continuous) | ~6 mA | >99% per advertiser event |
| 100 ms | 50 ms | 50% | ~3 mA | ~85% per event |
| 100 ms | 30 ms | 30% | ~1.8 mA | ~60% per event |
| 500 ms | 50 ms | 10% | ~600 µA | ~30% per event |
| 1000 ms | 30 ms | 3% | ~200 µA | ~10% per event |

*Discovery probability per individual advertising event. Over multiple events, cumulative probability increases rapidly.

**100% duty cycle scanning** (window = interval) guarantees that every advertising event on the currently monitored channel is received, but draws ~6 mA continuously — unacceptable for battery-powered centrals. For mains-powered gateways, continuous scanning is the simplest and most reliable approach.

For battery-powered centrals, a common pattern is **burst scanning**: scan at 100% duty cycle for 5–10 seconds to discover all nearby peripherals, then stop scanning entirely until the next discovery cycle.

## UUID-Based Filtering

Scanning without filtering in a typical environment (office, home, mall) produces dozens to hundreds of advertising reports per second — Bluetooth keyboards, mice, headphones, beacons, phones, and fitness trackers all advertise constantly. Filtering is essential to identify target peripherals efficiently.

**Controller-level filtering** (whitelist) filters by advertiser address in the BLE controller's hardware, before packets reach the host stack. This is the most efficient method but requires knowing the address in advance (typically from bonding).

**Host-level filtering** parses each advertising report in firmware and checks for specific AD structures — typically a 128-bit service UUID, a manufacturer-specific data prefix, or a device name pattern. This is more flexible but consumes CPU time for every received advertisement.

```c
/* NimBLE: Scan with host-level UUID filtering */
static const ble_uuid128_t target_svc_uuid =
    BLE_UUID128_INIT(0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
                     0x78, 0x56, 0x34, 0x12, 0x01, 0x00, 0xe5, 0xa0);

static int scan_event_cb(struct ble_gap_event *event, void *arg)
{
    if (event->type != BLE_GAP_EVENT_DISC) {
        return 0;
    }

    struct ble_hs_adv_fields fields;
    int rc = ble_hs_adv_parse_fields(&fields, event->disc.data,
                                      event->disc.length_data);
    if (rc != 0) {
        return 0;
    }

    /* Check for target 128-bit service UUID */
    for (int i = 0; i < fields.num_uuids128; i++) {
        if (ble_uuid_cmp(&fields.uuids128[i].u, &target_svc_uuid.u) == 0) {
            /* Found target device — initiate connection */
            ble_gap_disc_cancel();  /* Stop scanning */

            struct ble_gap_conn_params conn_params = {
                .scan_itvl = BLE_GAP_SCAN_ITVL_MS(100),
                .scan_window = BLE_GAP_SCAN_WIN_MS(100),
                .itvl_min = BLE_GAP_CONN_ITVL_MS(30),
                .itvl_max = BLE_GAP_CONN_ITVL_MS(50),
                .latency = 0,
                .supervision_timeout = 400,  /* 4 seconds */
                .min_ce_len = 0,
                .max_ce_len = 0,
            };

            ble_gap_connect(BLE_OWN_ADDR_PUBLIC, &event->disc.addr,
                           30000, &conn_params, gap_event_cb, NULL);
            return 0;
        }
    }
    return 0;
}

static void start_scanning(void)
{
    struct ble_gap_disc_params scan_params = {
        .itvl = BLE_GAP_SCAN_ITVL_MS(100),
        .window = BLE_GAP_SCAN_WIN_MS(50),
        .filter_policy = BLE_HCI_SCAN_FILT_NO_WL,
        .limited = 0,
        .passive = 0,  /* Active scanning for scan response */
        .filter_duplicates = 1,
    };

    ble_gap_disc(BLE_OWN_ADDR_PUBLIC, 10000,  /* 10-second timeout */
                 &scan_params, scan_event_cb, NULL);
}
```

## Multi-Connection Management

Modern BLE controllers support multiple simultaneous connections:

| Platform | Max Simultaneous Connections | RAM per Connection | Practical Limit |
|----------|----------------------------|-------------------|----------------|
| nRF52832 (SoftDevice S132) | 20 | ~1.5 KB | 8–10 (RAM limited) |
| nRF52840 (SoftDevice S140) | 20 | ~1.5 KB | 15–20 |
| ESP32 (NimBLE) | 9 (configurable) | ~2 KB | 5–7 (heap limited) |
| ESP32-C3 (NimBLE) | 3 (configurable) | ~2 KB | 3 |
| Linux (BlueZ) | Limited by adapter | N/A (OS managed) | 7–10 (typical adapter) |

Each connection requires dedicated RAM for the connection context, TX/RX buffers, and security state. On constrained MCUs, the practical limit is lower than the theoretical maximum because application logic, GATT client state, and notification buffers also consume RAM.

### Connection Scheduling

With multiple connections, the BLE controller must schedule connection events so they do not overlap. The controller interleaves events across connections:

```
Time →
Conn 1: ──█──────────────────█──────────────────█──────
Conn 2: ────────█──────────────────█──────────────────█
Conn 3: ──────────────█──────────────────█─────────────
                      │                  │
              CI (same for all or staggered)
```

If all connections use the same CI (e.g., 30 ms) and the event scheduling becomes congested, the controller may miss events, causing increased latency or reduced throughput. Strategies to manage this:

- **Stagger connection intervals** — use slightly different CIs (e.g., 97 ms, 103 ms, 107 ms) to prevent periodic collisions.
- **Use longer CIs for idle connections** — peripherals that send data infrequently can use CI = 500 ms with slave latency, while active peripherals use CI = 50 ms.
- **Limit packets per connection event** — reduce the maximum event length to leave time for other connections.

## Gateway Pattern

The BLE gateway is one of the most valuable embedded patterns: a central MCU collects data from multiple BLE sensor peripherals and forwards it upstream (WiFi, Ethernet, cellular, or UART to a host system).

```
                     ┌─────────────┐
                     │  Cloud /    │
                     │  Server     │
                     └──────┬──────┘
                            │ WiFi / Ethernet / Cellular
                     ┌──────┴──────┐
                     │  Gateway    │
                     │  (Central)  │
                     │  nRF52840   │
                     │  or ESP32   │
                     └──┬──┬──┬──┬─┘
                BLE     │  │  │  │    BLE
              ┌─────────┘  │  │  └─────────┐
              │            │  │            │
        ┌─────┴─────┐ ┌───┴──┴──┐ ┌───────┴──┐
        │ Sensor A  │ │ Sensor B│ │ Sensor C │
        │ (Periph)  │ │ (Periph)│ │ (Periph) │
        └───────────┘ └─────────┘ └──────────┘
```

### Gateway Implementation Considerations

**Discovery vs persistent connections** — The gateway can either maintain persistent connections to all peripherals (lower latency, higher power) or periodically scan and connect to each peripheral for data retrieval (lower steady-state power, higher latency). For battery-powered sensors reporting every minute, the connect-retrieve-disconnect pattern is often more power-efficient because the connection event overhead per retrieval is amortized over the reporting interval.

**Round-robin polling** — Connect to peripheral A, read data, disconnect, connect to peripheral B, read data, disconnect, and so on. Simple to implement but slow — each connect/disconnect cycle takes 1–3 seconds. For 10 peripherals, a full cycle takes 10–30 seconds.

**Persistent connections with notifications** — Maintain connections to all peripherals simultaneously. Each peripheral notifies the gateway when new data is available. Lower latency (~CI) but higher power and RAM usage. This is the preferred approach when the gateway is mains-powered.

### Gateway Data Flow (NimBLE Central)

```c
/* Connected to a peripheral — discover services and subscribe to notifications */
static void on_connect(uint16_t conn_handle)
{
    /* Discover the custom service */
    struct ble_gatt_svc svc;
    ble_gattc_disc_svc_by_uuid(conn_handle, &target_svc_uuid.u,
                                svc_disc_cb, NULL);
}

static int svc_disc_cb(uint16_t conn_handle,
                       const struct ble_gatt_error *error,
                       const struct ble_gatt_svc *service, void *arg)
{
    if (error->status == 0) {
        /* Discover characteristics within the service */
        ble_gattc_disc_all_chrs(conn_handle,
                                service->start_handle,
                                service->end_handle,
                                chr_disc_cb, NULL);
    }
    return 0;
}

static int chr_disc_cb(uint16_t conn_handle,
                       const struct ble_gatt_error *error,
                       const struct ble_gatt_chr *chr, void *arg)
{
    if (error->status == 0 && chr != NULL) {
        if (ble_uuid_cmp(&chr->uuid.u, &temp_chr_uuid.u) == 0) {
            /* Found temperature characteristic — subscribe to notifications */
            uint8_t val[2] = { 0x01, 0x00 };  /* Enable notifications */
            ble_gattc_write_flat(conn_handle, chr->val_handle + 1,
                                val, sizeof(val), write_cb, NULL);
        }
    }
    return 0;
}

/* Handle incoming notifications from any connected peripheral */
static int notification_cb(uint16_t conn_handle, uint16_t attr_handle,
                           struct os_mbuf *om, void *arg)
{
    uint8_t data[256];
    uint16_t len = OS_MBUF_PKTLEN(om);
    os_mbuf_copydata(om, 0, len, data);

    /* Route data based on conn_handle to identify which peripheral sent it */
    struct peer_info *peer = find_peer_by_conn(conn_handle);
    if (peer) {
        process_sensor_data(peer->id, data, len);
    }
    return 0;
}
```

## RSSI-Based Distance Estimation

BLE Received Signal Strength Indicator (RSSI) is frequently used for proximity estimation, but the results are unreliable for precise distance measurement.

The theoretical relationship follows the log-distance path loss model:

```
RSSI = RSSI_1m - 10 × n × log10(d)

where:
  RSSI_1m = measured RSSI at 1 meter (typically -50 to -70 dBm)
  n       = path loss exponent (2.0 in free space, 2.5–4.0 indoors)
  d       = distance in meters
```

| RSSI (dBm) | Estimated Distance (free space, n=2) | Estimated Distance (office, n=3) | Confidence |
|-----------|-------------------------------------|--------------------------------|-----------|
| -50 | ~1 m | ~1 m | High |
| -60 | ~3 m | ~2 m | Moderate |
| -70 | ~10 m | ~4 m | Low |
| -80 | ~30 m | ~8 m | Very low |
| -90 | ~100 m | ~15 m | Unreliable |

**Why RSSI is unreliable for distance:**

- **Multipath reflections** — signals bouncing off walls, floors, and furniture create constructive and destructive interference, causing RSSI to vary by ±10 dB at a fixed distance.
- **Body absorption** — a human body between the devices attenuates the signal by 10–20 dB, making a 2-meter distance look like 10 meters.
- **Antenna orientation** — BLE chip antennas are directional; rotating the device 90° can change RSSI by 5–10 dB.
- **Environmental changes** — opening a door, people walking through the area, or humidity changes affect propagation.

RSSI is useful for **proximity zones** (near/medium/far) and **relative distance changes** (getting closer/farther), but not for absolute distance measurement. For sub-meter accuracy, BLE Direction Finding (AoA/AoD, BLE 5.1) or UWB (Ultra-Wideband) is required.

### RSSI Filtering

Raw RSSI values fluctuate rapidly. A simple moving average or exponential moving average (EMA) smooths the readings:

```c
/* Exponential moving average RSSI filter */
#define RSSI_ALPHA 0.3f  /* Smoothing factor: 0.0 (stable) to 1.0 (responsive) */

static float filtered_rssi = -70.0f;

void update_rssi(int8_t raw_rssi)
{
    filtered_rssi = RSSI_ALPHA * (float)raw_rssi
                  + (1.0f - RSSI_ALPHA) * filtered_rssi;
}
```

## Scanning on Linux (BlueZ)

For Raspberry Pi or other Linux SBC gateways, `bluetoothctl` and `hcitool` provide scanning capabilities, but production deployments typically use the D-Bus BlueZ API or the `bleak` Python library:

```python
# BLE central scanning with bleak (Python, Linux/macOS/Windows)
import asyncio
from bleak import BleakScanner

TARGET_SERVICE_UUID = "a0e50001-0000-1000-8000-00805f9b34fb"

async def scan_for_sensors():
    devices = await BleakScanner.discover(
        timeout=10.0,
        service_uuids=[TARGET_SERVICE_UUID],
    )

    for device in devices:
        rssi = device.rssi

    return devices

asyncio.run(scan_for_sensors())
```

For continuous scanning (gateway use case):

```python
import asyncio
from bleak import BleakScanner

def detection_callback(device, advertisement_data):
    if TARGET_SERVICE_UUID.lower() in [
        str(u).lower() for u in advertisement_data.service_uuids
    ]:
        # Process manufacturer data or service data
        pass

async def continuous_scan():
    scanner = BleakScanner(detection_callback=detection_callback)
    await scanner.start()
    # Run until stopped
    while True:
        await asyncio.sleep(1.0)

asyncio.run(continuous_scan())
```

## Central vs Peripheral Power Comparison

Running as a central consumes significantly more power than running as a peripheral because the central's radio must be in RX mode during scan windows and during connection events (waiting for peripheral transmissions):

| Role | Operation | Duration | Current (nRF52840) |
|------|-----------|----------|-------------------|
| Peripheral | Advertising (3 channels) | ~3 ms per event | ~5 mA during TX |
| Peripheral | Connection event (respond) | ~1 ms per event | ~5 mA (RX + TX) |
| Central | Scan window | Continuous during window | ~6 mA (RX) |
| Central | Connection event (initiate) | ~1–2 ms per event | ~6 mA (RX + TX) |
| Central | Multi-connection scheduling | Proportional to connection count | ~6 mA per active event |

A battery-powered central scanning at 50% duty cycle with 3 active connections draws approximately 3–4 mA average — unsuitable for coin-cell operation. Mains-powered gateways avoid this constraint entirely.

## Tips

- Use `filter_duplicates = 1` in scan parameters to receive only one report per advertising address per scan period. Without this, a single peripheral advertising at 100 ms generates 10 scan reports per second, flooding the host callback with redundant data.
- For gateway applications, start with persistent connections and notifications rather than connect/disconnect cycling. The implementation is simpler, the latency is lower, and the power cost is acceptable for mains-powered devices.
- When managing multiple connections, maintain a peer table mapping `conn_handle` to application-level peer identifiers. Connection handles are assigned by the controller and may differ between connections to the same device.
- Set a scan timeout to prevent indefinite scanning. On NimBLE, the `duration_ms` parameter in `ble_gap_disc()` stops scanning automatically. On SoftDevice, use `sd_ble_gap_scan_stop()` from a timer callback.
- For RSSI-based proximity, calibrate `RSSI_1m` for the specific peripheral hardware and antenna configuration. Measuring RSSI at exactly 1 meter in the deployment environment provides a baseline that significantly improves proximity zone accuracy.

## Caveats

- **Scanning and advertising simultaneously increases power and scheduling complexity** — a device acting as both central (scanning) and peripheral (advertising) must time-share the radio between scan windows, advertising events, and connection events. The controller handles this automatically, but throughput and discovery speed are reduced compared to single-role operation.
- **Connection creation takes 1–3 seconds** — after the central decides to connect, it must wait for the next advertising event on the correct channel, send a `CONNECT_IND`, and complete the connection setup. This latency is inherent to BLE's channel-hopping design and cannot be reduced below one advertising interval.
- **Android and iOS background scanning is severely throttled** — phone-based BLE centrals in the background scan at reduced duty cycles, increasing discovery latency from seconds to minutes. MCU-based centrals do not have this limitation, making them superior for time-sensitive gateway applications.
- **The 20-connection limit on nRF52840 is a SoftDevice limit, not a hardware limit** — Zephyr's BLE controller on nRF52840 supports different connection counts depending on configuration. The practical limit is always RAM, not the radio hardware.
- **Service discovery after connection adds 500 ms–2 s of latency** — the GATT service/characteristic discovery process requires multiple round trips. Caching discovered handles (storing the handle values per peer address) eliminates this overhead on reconnections with known devices.

## In Practice

- A BLE gateway on nRF52840 managing 8 sensor peripherals with 200 ms CI and notifications draws approximately 4 mA from a 3.3V supply (13 mW). The gateway receives one 20-byte notification per second from each peripheral and forwards the data over UART to a host processor running MQTT. Total BLE-to-UART latency is under 300 ms.
- A gateway that intermittently loses connection to one peripheral while maintaining others is likely experiencing a scheduling collision. The fix is to stagger connection intervals — request slightly different CIs from each peripheral (e.g., 197 ms, 203 ms, 211 ms using prime numbers to minimize periodic alignment).
- Scanning in a retail environment with 50+ BLE devices advertising produces hundreds of scan reports per second. Without UUID filtering, the host CPU spends significant time parsing irrelevant advertisements. Implementing a two-stage filter — first check for the custom manufacturer company ID (2-byte comparison), then parse the full UUID — reduces CPU overhead by 90%.
- A central that connects to a peripheral and immediately attempts GATT operations before service discovery completes receives `BLE_HS_ATT_ERR_INVALID_HANDLE` errors. The correct sequence is: connect → wait for connection event → discover services → discover characteristics → read/write/subscribe. NimBLE's `peer` module in the examples provides a clean abstraction for this flow.
- A mobile phone app running as a central with `filter_duplicates` disabled in a busy environment can exhaust its Bluetooth stack's internal buffers, causing scan stops and missed connections. This failure mode appears as "scanning started but no devices found" even though `nRF Connect` on the same phone discovers peripherals immediately. The fix is always enabling duplicate filtering and processing scan results asynchronously.
