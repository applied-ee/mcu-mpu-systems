---
title: "BLE Advertising & GAP"
weight: 10
---

# BLE Advertising & GAP

BLE advertising is the mechanism by which devices announce their presence to the world. Unlike WiFi, where a station actively searches for access points, BLE reverses the model — the peripheral broadcasts short packets at regular intervals, and any nearby central or observer can receive them without establishing a connection. The Generic Access Profile (GAP) defines the roles, modes, and procedures that govern this discovery process. Understanding advertising at the packet level is essential because every byte matters: the legacy advertising payload is limited to 31 bytes, and the choices made in configuring advertising parameters directly determine power consumption, discovery latency, and connection speed.

## GAP Roles

GAP defines four fundamental roles that determine how a BLE device participates in the network:

| Role | Function | Typical Use Case | Advertising? | Scanning? | Connects? |
|------|----------|-----------------|-------------|-----------|-----------|
| Peripheral | Advertises and accepts connections | Sensor node, wearable, beacon | Yes | No | Accepts |
| Central | Scans and initiates connections | Phone app, gateway MCU | No | Yes | Initiates |
| Broadcaster | Advertises only, never connects | Temperature beacon, iBeacon | Yes | No | Never |
| Observer | Scans only, never connects | Passive asset tracker, display | No | Yes | Never |

A single device can support multiple roles simultaneously. The nRF52840, for example, can operate as both a peripheral (advertising a sensor service) and a central (scanning for other peripherals) at the same time, though this increases RAM usage and scheduling complexity. The ESP32 NimBLE stack supports concurrent GAP roles with separate callback handlers for each.

## Advertising Packet Structure

A BLE advertising packet on the air consists of a 1-byte preamble, 4-byte access address (always `0x8E89BED6` for advertising channels), the PDU (Protocol Data Unit), and a 3-byte CRC. The PDU itself contains a 2-byte header and up to 37 bytes of payload. Of those 37 bytes, 6 are consumed by the advertiser's address, leaving **31 bytes** for advertising data.

```
┌──────────┬──────────────┬─────────────────────┬─────────┐
│ Preamble │ Access Addr  │      PDU            │  CRC    │
│  1 byte  │   4 bytes    │  2 + 6 + 31 bytes   │ 3 bytes │
└──────────┴──────────────┴─────────────────────┴─────────┘

PDU Breakdown:
┌──────────┬───────────────┬──────────────────────┐
│  Header  │  AdvA (addr)  │  AdvData (payload)   │
│  2 bytes │   6 bytes     │   0–31 bytes         │
└──────────┴───────────────┴──────────────────────┘
```

The advertising data uses a **type-length-value (TLV)** format. Each AD structure contains a 1-byte length, a 1-byte AD type, and the data. This means each field has a 2-byte overhead.

## Common AD Types

| AD Type Code | Name | Typical Size | Purpose |
|-------------|------|-------------|---------|
| `0x01` | Flags | 3 bytes total | LE General Discoverable + BR/EDR Not Supported |
| `0x02` / `0x03` | 16-bit Service UUIDs (incomplete/complete) | 4+ bytes | Announce SIG-defined services |
| `0x06` / `0x07` | 128-bit Service UUIDs (incomplete/complete) | 18+ bytes | Announce custom services |
| `0x08` / `0x09` | Shortened/Complete Local Name | variable | Human-readable device name |
| `0xFF` | Manufacturer Specific Data | variable | Company ID (2 bytes) + custom payload |
| `0x16` | Service Data | variable | UUID + associated data payload |
| `0x0A` | TX Power Level | 3 bytes total | Signed int8, used for distance estimation |

A practical example — fitting a custom sensor beacon into 31 bytes:

```
Flags:              3 bytes  (len=2, type=0x01, data=0x06)
16-bit Service UUID: 4 bytes  (len=3, type=0x03, uuid=0x181A Environmental Sensing)
Complete Name:       8 bytes  (len=7, type=0x09, "TempSn")
Manufacturer Data:  14 bytes  (len=13, type=0xFF, company=0xFFFF, temp=2B, humidity=2B, battery=1B, seq=2B, reserved=4B)
Total:             29 bytes  (2 bytes remaining)
```

## Scan Response

When a central performs **active scanning**, it sends a `SCAN_REQ` after receiving an advertisement, and the peripheral replies with a `SCAN_RSP` packet containing an additional 31 bytes of data. This effectively doubles the available advertising payload to 62 bytes without establishing a connection.

The scan response is optional — if the advertising type is set to non-connectable non-scannable, no scan response is sent. The trade-off is that active scanning requires two packet exchanges per advertisement, consuming more power on both sides.

Common practice is to place the essential data (service UUIDs, flags, manufacturer data) in the advertising packet and the device name in the scan response, since name display is only needed when a user is actively browsing for devices.

## Advertising Types

| PDU Type | Connectable | Scannable | Directed | Use Case |
|----------|------------|-----------|----------|----------|
| `ADV_IND` | Yes | Yes | No | General-purpose peripheral advertising |
| `ADV_DIRECT_IND` | Yes | No | Yes | Fast reconnection to a known central |
| `ADV_NONCONN_IND` | No | No | No | Beacon, broadcast-only sensor |
| `ADV_SCAN_IND` | No | Yes | No | Broadcaster with scan response data |

**`ADV_IND`** is the most common type — the peripheral is discoverable, accepts scan requests, and accepts connection requests from any central. This is the default for most BLE peripheral applications.

**`ADV_DIRECT_IND`** targets a specific central by address and omits the AdvData field entirely (no payload). The high-duty-cycle variant advertises at 3.75 ms intervals for up to 1.28 seconds, enabling fast reconnection (~20 ms typical). This mode is used after bonding to rapidly re-establish a connection.

**`ADV_NONCONN_IND`** is the lowest-power option for broadcast-only applications. No scan response is sent, no connection is possible. Used for beacons (iBeacon, Eddystone) and environmental sensors that broadcast readings without requiring a connection.

## Advertising Intervals

The advertising interval controls how frequently the device transmits advertisement packets. The BLE specification allows intervals from 20 ms to 10.24 seconds, in steps of 0.625 ms.

| Interval | Events/sec | Avg Current (nRF52832) | Discovery Latency (median) | Use Case |
|----------|-----------|----------------------|---------------------------|----------|
| 20 ms | 50 | ~600 µA | <50 ms | Fast connection (limited duration) |
| 100 ms | 10 | ~50 µA | ~150 ms | Interactive device, user waiting |
| 250 ms | 4 | ~25 µA | ~400 ms | Good balance for most peripherals |
| 500 ms | 2 | ~15 µA | ~750 ms | Sensor with moderate latency tolerance |
| 1000 ms | 1 | ~10 µA | ~1.5 s | Typical sensor beacon |
| 2000 ms | 0.5 | ~6 µA | ~3 s | Low-power asset tracker |
| 10240 ms | ~0.1 | ~2 µA | ~15 s | Ultra-low-power, long discovery time |

Current draw figures are measured on an nRF52832 at 0 dBm TX power with DC/DC converter enabled. The BLE specification adds a random delay of 0–10 ms to each interval to reduce collision probability between co-located advertisers.

A common pattern is **fast advertising on boot** (100 ms for 30 seconds) followed by **slow advertising** (1–2 s indefinitely). This provides responsive discovery when the user is actively looking while minimizing long-term power consumption.

## Advertising Channels

BLE uses three dedicated advertising channels (37, 38, 39), spaced across the 2.4 GHz band to avoid single-source interference:

```
Channel 37: 2402 MHz  (below WiFi ch 1)
Channel 38: 2426 MHz  (between WiFi ch 1 and 6)
Channel 39: 2480 MHz  (above WiFi ch 11)
```

Each advertising event transmits the same PDU on all three channels sequentially, with ~150 µs between transmissions. The total on-air time for a single advertising event is approximately 2–4 ms depending on payload length and whether a scan response occurs.

Selective channel masking (advertising on fewer than three channels) is possible on some stacks but rarely beneficial — the three-channel spread is specifically designed to combat narrowband interference.

## BLE 5.0 Extended Advertising

BLE 5.0 introduced **extended advertising** to overcome the 31-byte payload limitation. Extended advertising uses the three legacy advertising channels to send a short pointer (AUX_ADV_IND) that directs the scanner to a secondary advertisement on one of the 37 data channels, where the full payload is transmitted.

| Feature | Legacy Advertising | Extended Advertising |
|---------|-------------------|---------------------|
| Max payload | 31 bytes (+31 scan response) | 255 bytes per PDU, chained up to ~1650 bytes |
| Channels | 37, 38, 39 only | 37, 38, 39 (primary) + data channels (secondary) |
| Advertising sets | 1 | Multiple simultaneous sets |
| Coded PHY support | No | Yes (125 kbps for 4x range) |
| Backward compatible | N/A | Scanner must support BLE 5.0 |

Extended advertising payloads can be **chained** — multiple AUX_CHAIN_IND PDUs link together to carry payloads exceeding 255 bytes. The practical limit is approximately 1650 bytes, though payloads above 255 bytes increase airtime and power consumption substantially.

**Advertising sets** allow a single device to maintain multiple independent advertisements simultaneously — for example, one connectable set for app pairing and one non-connectable set for beacon broadcasts, each with different intervals and data.

## NimBLE Advertising Example (ESP32)

```c
#include "host/ble_hs.h"
#include "services/gap/ble_svc_gap.h"

static uint8_t own_addr_type;

/* Manufacturer-specific data: company ID 0xFFFF + 4 bytes payload */
static uint8_t manuf_data[] = {
    0xFF, 0xFF,             /* Company ID (0xFFFF = testing) */
    0x01, 0x02, 0x03, 0x04  /* Custom payload */
};

static void start_advertising(void)
{
    struct ble_gap_adv_params adv_params;
    struct ble_hs_adv_fields fields;
    struct ble_hs_adv_fields rsp_fields;
    int rc;

    memset(&fields, 0, sizeof(fields));

    /* Flags: General Discoverable + BLE Only */
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;

    /* 16-bit service UUID */
    fields.uuids16 = (ble_uuid16_t[]){
        BLE_UUID16_INIT(0x181A)  /* Environmental Sensing */
    };
    fields.num_uuids16 = 1;
    fields.uuids16_is_complete = 1;

    /* Manufacturer-specific data */
    fields.mfg_data = manuf_data;
    fields.mfg_data_len = sizeof(manuf_data);

    rc = ble_gap_adv_set_fields(&fields);
    assert(rc == 0);

    /* Scan response: device name */
    memset(&rsp_fields, 0, sizeof(rsp_fields));
    rsp_fields.name = (uint8_t *)ble_svc_gap_device_name();
    rsp_fields.name_len = strlen(ble_svc_gap_device_name());
    rsp_fields.name_is_complete = 1;

    rc = ble_gap_adv_rsp_set_fields(&rsp_fields);
    assert(rc == 0);

    /* Advertising parameters */
    memset(&adv_params, 0, sizeof(adv_params));
    adv_params.conn_mode = BLE_GAP_CONN_MODE_UND;  /* Connectable */
    adv_params.disc_mode = BLE_GAP_DISC_MODE_GEN;  /* General discoverable */
    adv_params.itvl_min = BLE_GAP_ADV_ITVL_MS(100);  /* 100 ms */
    adv_params.itvl_max = BLE_GAP_ADV_ITVL_MS(150);  /* 150 ms */

    rc = ble_gap_adv_start(own_addr_type, NULL, BLE_HS_FOREVER,
                           &adv_params, gap_event_cb, NULL);
    assert(rc == 0);
}
```

## nRF5 SDK / SoftDevice Advertising Example

```c
#include "ble_advdata.h"
#include "ble_advertising.h"

#define APP_ADV_INTERVAL    MSEC_TO_UNITS(100, UNIT_0_625_MS)  /* 100 ms */
#define APP_ADV_DURATION    18000  /* 180 seconds, in 10 ms units */

static ble_uuid_t m_adv_uuids[] = {
    {BLE_UUID_ENVIRONMENTAL_SENSING_SERVICE, BLE_UUID_TYPE_BLE}
};

static void advertising_init(void)
{
    ble_advertising_init_t init;
    memset(&init, 0, sizeof(init));

    init.advdata.name_type               = BLE_ADVDATA_FULL_NAME;
    init.advdata.include_appearance       = false;
    init.advdata.flags                    = BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE;

    init.srdata.uuids_complete.uuid_cnt  = ARRAY_SIZE(m_adv_uuids);
    init.srdata.uuids_complete.p_uuids   = m_adv_uuids;

    init.config.ble_adv_fast_enabled     = true;
    init.config.ble_adv_fast_interval    = APP_ADV_INTERVAL;
    init.config.ble_adv_fast_timeout     = APP_ADV_DURATION;

    /* Slow advertising after fast timeout */
    init.config.ble_adv_slow_enabled     = true;
    init.config.ble_adv_slow_interval    = MSEC_TO_UNITS(1000, UNIT_0_625_MS);
    init.config.ble_adv_slow_timeout     = 0;  /* Advertise indefinitely */

    init.evt_handler = on_adv_evt;

    uint32_t err_code = ble_advertising_init(&m_advertising, &init);
    APP_ERROR_CHECK(err_code);
}
```

## Advertising Data for Beacons

Beacon protocols encode their payload entirely within the manufacturer-specific data field. The two most common formats:

**iBeacon (Apple)**:
```
AD Length:  0x1A (26 bytes)
AD Type:   0xFF (manufacturer specific)
Company:   0x004C (Apple)
Beacon ID: 0x0215
UUID:      16 bytes (proximity UUID)
Major:     2 bytes
Minor:     2 bytes
TX Power:  1 byte (calibrated RSSI at 1 meter)
```

**Eddystone-UID (Google)**:
```
AD Length:  0x03
AD Type:   0x03 (complete 16-bit UUID list)
UUID:      0xFEAA (Eddystone)

AD Length:  0x17 (23 bytes)
AD Type:   0x16 (service data)
UUID:      0xFEAA
Frame:     0x00 (UID frame)
TX Power:  1 byte
Namespace: 10 bytes
Instance:  6 bytes
Reserved:  2 bytes
```

Both formats fit within the 31-byte advertising payload limit. iBeacon uses 30 bytes total (flags + manufacturer data). Eddystone-UID uses 28 bytes total (UUID list + service data).

## Tips

- Start advertising at 100 ms during development and testing to ensure reliable scanning by phone apps. Reduce the interval to 500 ms–1 s for production firmware where power consumption matters.
- Always include the Flags AD type (`0x01`) in connectable advertisements — iOS requires it for proper device discovery. Omitting flags causes the device to be invisible to iOS scanning apps.
- Place the most important data (service UUIDs, manufacturer payload) in the advertising packet, not the scan response. Some scanners use passive mode and never request scan responses.
- For extended advertising on BLE 5.0, verify that the target central devices actually support BLE 5.0 scanning. Older phones (pre-2018 Android, pre-iPhone 8) only see legacy advertisements.
- Use a unique prefix in manufacturer-specific data to identify the device type when scanning in noisy environments. Filtering by manufacturer data is faster than connecting and discovering services.

## Caveats

- **The 31-byte payload limit is tighter than it appears** — after the mandatory Flags field (3 bytes) and a 128-bit service UUID (18 bytes), only 10 bytes remain for actual data. Design the advertising payload carefully, and prefer 16-bit SIG UUIDs when a standard service applies.
- **Advertising interval is not exact** — the BLE spec adds a 0–10 ms random delay to each interval to reduce collision probability. The actual interval varies between `interval` and `interval + 10 ms`. This randomization is mandatory and cannot be disabled.
- **Android scan throttling limits background scanning** — starting with Android 7.0, the OS limits BLE scan starts to 5 per 30-second window per app. Exceeding this limit silently stops scanning. This affects gateway and beacon scanner applications running on Android.
- **Advertising on all three channels is not always guaranteed** — in rare cases, RF interference on one channel can cause repeated CRC failures, making the device effectively invisible to scanners on that channel. The three-channel spread mitigates but does not eliminate this risk.
- **Extended advertising increases discovery latency** — the two-step process (primary → secondary channel) adds ~2–5 ms per advertising event. If the scanner misses the primary channel pointer, it must wait for the next advertising event to discover the secondary payload.

## In Practice

- A sensor beacon advertising every 1 second at 0 dBm on an nRF52832 with DC/DC enabled draws approximately 10 µA average. At this rate, a CR2032 coin cell (225 mAh) lasts roughly 2.5 years in advertising-only mode — though battery self-discharge and cold-temperature derating typically reduce this to 1.5–2 years in real deployments.
- A device that is discoverable by one phone but not another is likely encountering a Flags field issue. iOS requires the `LE General Discoverable` flag to be set in the advertising data. Android is more permissive but may filter differently depending on the scan mode used by the app.
- Fast-then-slow advertising is the standard pattern for consumer devices. The nRF5 SDK's `ble_advertising` module implements this natively with configurable fast/slow intervals and timeouts. On NimBLE, the same behavior requires a timer callback that stops and restarts advertising with new parameters.
- When debugging advertising content, nRF Connect (mobile app) displays raw AD structures in hex. The Wireshark BLE sniffer (using an nRF52840 dongle) captures every advertising packet on the selected channel, revealing timing, payload, and channel usage patterns that phone-based tools cannot show.
- A multi-sensor gateway that needs to discover many peripherals quickly should use a combination of short scan windows and UUID-based filtering rather than parsing every advertising packet. Filtering at the controller level (using a whitelist or AD type filter) reduces host CPU load compared to software filtering of every received advertisement.
