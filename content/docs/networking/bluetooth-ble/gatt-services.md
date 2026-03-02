---
title: "GATT Services & Characteristics"
weight: 20
---

# GATT Services & Characteristics

The Generic Attribute Profile (GATT) is the framework that organizes all data exchange over a BLE connection. Every piece of information — a temperature reading, a firmware version string, a configuration parameter — is exposed through a structured hierarchy of services, characteristics, and descriptors. GATT determines how a central discovers what a peripheral offers, how data is read and written, and how the peripheral pushes updates without being polled. Getting GATT design right is the difference between a device that pairs seamlessly with phone apps and one that requires custom protocol documentation and fragile byte-level parsing.

## GATT Hierarchy

```
Profile (application-level concept, not in ATT database)
 └── Service (grouping of related characteristics)
      ├── Characteristic
      │    ├── Characteristic Value (the actual data)
      │    ├── CCCD (Client Characteristic Configuration Descriptor)
      │    └── Other Descriptors (format, user description, etc.)
      └── Characteristic
           ├── Characteristic Value
           └── Descriptors...
```

**Profile** — A profile is a specification-level concept describing a use case (Heart Rate Profile, Device Information Profile). It defines which services must be present and how they interact. Profiles are not stored in the attribute database; they are a design contract.

**Service** — A service groups related characteristics under a single UUID. Services can be **primary** (top-level, discoverable) or **secondary** (included by reference from a primary service). Each service occupies a contiguous range of handles in the ATT database.

**Characteristic** — A characteristic is the fundamental data unit. It contains a declaration (properties, handle, UUID), a value attribute (the actual data), and zero or more descriptors. The characteristic properties byte defines what operations are permitted.

**Descriptor** — Descriptors provide metadata about a characteristic. The most important is the CCCD, which enables notifications and indications. Other descriptors include the Characteristic Presentation Format (data type, exponent, unit) and the Characteristic User Description (human-readable string).

## Handles

Every attribute in the GATT database has a 16-bit **handle** — a numeric identifier assigned at database construction time. Handles are contiguous and ordered. A characteristic with a CCCD occupies at least three handles:

| Handle | Attribute | Content |
|--------|-----------|---------|
| 0x000A | Characteristic Declaration | Properties, value handle, UUID |
| 0x000B | Characteristic Value | The actual data bytes |
| 0x000C | CCCD | 2 bytes: notifications enable / indications enable |

Handles are assigned automatically by most BLE stacks but remain stable across connections as long as the GATT database does not change. Some platforms (SoftDevice) allow explicit handle assignment to guarantee stability across firmware updates — important for bonded devices that cache handle mappings.

## UUIDs

BLE uses two UUID formats:

| Format | Size | Example | Use Case |
|--------|------|---------|----------|
| 16-bit | 2 bytes | `0x180F` (Battery Service) | SIG-adopted standard services/characteristics |
| 128-bit | 16 bytes | `12345678-1234-5678-1234-56789abcdef0` | Custom/vendor-specific services |

The 16-bit UUIDs are shorthand — they expand to 128-bit by inserting into the Bluetooth Base UUID: `0000XXXX-0000-1000-8000-00805F9B34FB`. This means `0x180F` is actually `0000180F-0000-1000-8000-00805F9B34FB`.

**16-bit UUIDs are reserved by the Bluetooth SIG.** Custom services and characteristics must use full 128-bit UUIDs. The standard approach is to generate a random base UUID and vary the 3rd and 4th bytes for different characteristics within the service:

```
Base:           A0E5XXXX-0000-1000-8000-00805F9B34FB
Service:        A0E50001-...
Char (Temp):    A0E50002-...
Char (Humidity): A0E50003-...
Char (Config):  A0E50004-...
```

Using a shared base UUID allows NimBLE and SoftDevice to store only the base once, reducing RAM usage for multi-characteristic services.

## Common SIG-Defined Services

| UUID | Service Name | Key Characteristics |
|------|-------------|-------------------|
| `0x1800` | Generic Access | Device Name, Appearance |
| `0x1801` | Generic Attribute | Service Changed |
| `0x180A` | Device Information | Manufacturer, Model, Serial, Firmware Rev, Hardware Rev |
| `0x180F` | Battery Service | Battery Level (uint8, 0–100%) |
| `0x181A` | Environmental Sensing | Temperature, Humidity, Pressure |
| `0x180D` | Heart Rate | Heart Rate Measurement, Body Sensor Location |
| `0x1816` | Cycling Speed and Cadence | CSC Measurement, CSC Feature |
| `0x1815` | Automation IO | Digital, Analog inputs/outputs |

Using SIG-defined services ensures interoperability with generic BLE apps (nRF Connect, LightBlue) and allows phone operating systems to present device information without custom app code.

## Characteristic Properties

The properties byte in the characteristic declaration defines permitted operations:

| Bit | Property | Description |
|-----|----------|-------------|
| 0 | Broadcast | Value can be included in advertising data |
| 1 | Read | Central can read the value |
| 2 | Write Without Response | Central can write without acknowledgment |
| 3 | Write | Central can write with acknowledgment |
| 4 | Notify | Peripheral can push updates (no acknowledgment) |
| 5 | Indicate | Peripheral can push updates (with acknowledgment) |
| 6 | Authenticated Signed Writes | Write with authentication signature |
| 7 | Extended Properties | Additional properties in Extended Properties descriptor |

Common combinations:

| Pattern | Properties | Use Case |
|---------|-----------|----------|
| Sensor reading | Read + Notify | Temperature, heart rate, battery level |
| Configuration | Read + Write | Measurement interval, alarm threshold |
| Command | Write Without Response | Motor control, LED color |
| Firmware chunk | Write Without Response + Notify | DFU data transfer (write chunks, notify status) |
| Log data | Notify | High-throughput streaming from peripheral |

## MTU Negotiation

The default ATT MTU is 23 bytes, yielding a maximum characteristic value of **20 bytes** per operation (23 - 1 byte opcode - 2 bytes handle). This is the single most common source of confusion in BLE development.

MTU negotiation allows increasing this limit:

| Parameter | Default | Negotiated Max | Effective Payload |
|-----------|---------|---------------|-------------------|
| ATT MTU | 23 bytes | 247 bytes (BLE 4.2+) | MTU - 3 = 244 bytes |
| ATT MTU | 23 bytes | 512 bytes (some stacks) | MTU - 3 = 509 bytes |

The negotiation is initiated by the central with an **Exchange MTU Request**. The agreed MTU is the minimum of the two sides' supported values. Most modern phones support MTU 247 or higher (iOS negotiates 185 by default, Android varies by version and manufacturer).

```
Central → Peripheral:  Exchange MTU Request (MTU = 247)
Peripheral → Central:  Exchange MTU Response (MTU = 247)
Agreed MTU: min(247, 247) = 247
Effective payload per notification: 247 - 3 = 244 bytes
```

For data transfer applications, MTU negotiation is critical. Sending 200 bytes of sensor data with the default MTU requires fragmenting into 10 ATT operations (20 bytes each). With MTU 247, the same data fits in a single notification.

## CCCD — Client Characteristic Configuration Descriptor

The CCCD is a 2-byte descriptor that controls whether the peripheral sends notifications or indications for a characteristic. The central writes to the CCCD to subscribe:

| CCCD Value | Behavior |
|-----------|----------|
| `0x0000` | Notifications and indications disabled |
| `0x0001` | Notifications enabled |
| `0x0002` | Indications enabled |
| `0x0003` | Both enabled (rare, stack-dependent) |

**Notifications** are unacknowledged — the peripheral sends data and does not wait for a response. This allows the highest throughput because multiple notifications can be queued in a single connection event.

**Indications** are acknowledged — the peripheral sends data and waits for a confirmation from the central before sending the next one. This guarantees delivery but limits throughput to one indication per connection interval (7.5 ms minimum).

For bonded devices, the CCCD value should be **persisted in flash** so that subscriptions survive a disconnect/reconnect cycle. Both NimBLE and SoftDevice handle this automatically when bonding is configured, but custom stacks may require explicit storage.

## NimBLE GATT Server Example (ESP32)

```c
#include "host/ble_hs.h"
#include "services/gatt/ble_svc_gatt.h"

/* Custom service UUID: A0E50001-... */
static const ble_uuid128_t svc_uuid =
    BLE_UUID128_INIT(0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
                     0x78, 0x56, 0x34, 0x12, 0x01, 0x00, 0xe5, 0xa0);

/* Temperature characteristic UUID: A0E50002-... */
static const ble_uuid128_t temp_chr_uuid =
    BLE_UUID128_INIT(0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
                     0x78, 0x56, 0x34, 0x12, 0x02, 0x00, 0xe5, 0xa0);

/* Config characteristic UUID: A0E50003-... */
static const ble_uuid128_t config_chr_uuid =
    BLE_UUID128_INIT(0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
                     0x78, 0x56, 0x34, 0x12, 0x03, 0x00, 0xe5, 0xa0);

static uint16_t temp_val_handle;
static int16_t current_temp = 2250;      /* 22.50 °C, fixed-point */
static uint16_t config_interval = 1000;  /* Measurement interval ms */

static int temp_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                          struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        os_mbuf_append(ctxt->om, &current_temp, sizeof(current_temp));
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static int config_access_cb(uint16_t conn_handle, uint16_t attr_handle,
                            struct ble_gatt_access_ctxt *ctxt, void *arg)
{
    if (ctxt->op == BLE_GATT_ACCESS_OP_READ_CHR) {
        os_mbuf_append(ctxt->om, &config_interval, sizeof(config_interval));
        return 0;
    }
    if (ctxt->op == BLE_GATT_ACCESS_OP_WRITE_CHR) {
        uint16_t len = OS_MBUF_PKTLEN(ctxt->om);
        if (len != sizeof(config_interval)) {
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        ble_hs_mbuf_to_flat(ctxt->om, &config_interval,
                            sizeof(config_interval), NULL);
        /* Validate range: 100 ms to 60000 ms */
        if (config_interval < 100 || config_interval > 60000) {
            config_interval = 1000;
            return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        }
        return 0;
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def gatt_services[] = {
    {
        .type = BLE_GATT_SVC_TYPE_PRIMARY,
        .uuid = &svc_uuid.u,
        .characteristics = (struct ble_gatt_chr_def[]) {
            {
                .uuid = &temp_chr_uuid.u,
                .access_cb = temp_access_cb,
                .val_handle = &temp_val_handle,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_NOTIFY,
            },
            {
                .uuid = &config_chr_uuid.u,
                .access_cb = config_access_cb,
                .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE,
            },
            { 0 }  /* Sentinel */
        },
    },
    { 0 }  /* Sentinel */
};

/* Send notification (call from sensor task) */
void notify_temperature(uint16_t conn_handle, int16_t temp)
{
    struct os_mbuf *om = ble_hs_mbuf_from_flat(&temp, sizeof(temp));
    ble_gatts_notify_custom(conn_handle, temp_val_handle, om);
}
```

## SoftDevice GATT Example (nRF52)

```c
#include "ble.h"
#include "ble_srv_common.h"

static uint16_t service_handle;
static ble_gatts_char_handles_t temp_handles;

static void services_init(void)
{
    ble_uuid128_t base_uuid = { .uuid128 = {
        0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
        0x78, 0x56, 0x34, 0x12, 0x00, 0x00, 0xe5, 0xa0
    }};

    uint8_t uuid_type;
    sd_ble_uuid_vs_add(&base_uuid, &uuid_type);

    ble_uuid_t svc_uuid = { .uuid = 0x0001, .type = uuid_type };
    sd_ble_gatts_service_add(BLE_GATTS_SRVC_TYPE_PRIMARY,
                             &svc_uuid, &service_handle);

    /* Temperature characteristic */
    ble_gatts_char_md_t char_md = { 0 };
    char_md.char_props.read   = 1;
    char_md.char_props.notify = 1;

    ble_gatts_attr_md_t cccd_md = { 0 };
    BLE_GAP_CONN_SEC_MODE_SET_OPEN(&cccd_md.read_perm);
    BLE_GAP_CONN_SEC_MODE_SET_OPEN(&cccd_md.write_perm);
    cccd_md.vloc = BLE_GATTS_VLOC_STACK;
    char_md.p_cccd_md = &cccd_md;

    ble_uuid_t chr_uuid = { .uuid = 0x0002, .type = uuid_type };

    ble_gatts_attr_md_t attr_md = { 0 };
    BLE_GAP_CONN_SEC_MODE_SET_OPEN(&attr_md.read_perm);
    attr_md.vloc = BLE_GATTS_VLOC_STACK;

    int16_t initial_temp = 2250;
    ble_gatts_attr_t attr = {
        .p_uuid    = &chr_uuid,
        .p_attr_md = &attr_md,
        .init_len  = sizeof(initial_temp),
        .max_len   = sizeof(initial_temp),
        .p_value   = (uint8_t *)&initial_temp,
        .init_offs = 0,
    };

    sd_ble_gatts_characteristic_add(service_handle, &char_md,
                                     &attr, &temp_handles);
}

/* Send notification */
void notify_temperature(uint16_t conn_handle, int16_t temp)
{
    uint16_t len = sizeof(temp);
    ble_gatts_hvx_params_t hvx = {
        .handle = temp_handles.value_handle,
        .type   = BLE_GATT_HVX_NOTIFICATION,
        .offset = 0,
        .p_len  = &len,
        .p_data = (uint8_t *)&temp,
    };
    sd_ble_gatts_hvx(conn_handle, &hvx);
}
```

## BlueZ GATT Example (Linux)

On Linux SBCs, BlueZ provides GATT server functionality via D-Bus. The `bluetoothctl` tool and `gatttool` (deprecated but still useful) work for testing. For production, the D-Bus API or the `bleak` Python library provides programmatic access:

```python
# BlueZ GATT client using bleak (Python, runs on Raspberry Pi)
import asyncio
from bleak import BleakClient, BleakScanner

TEMP_CHAR_UUID = "a0e50002-0000-1000-8000-00805f9b34fb"

async def main():
    devices = await BleakScanner.discover(timeout=5.0)
    target = next((d for d in devices if d.name and "TempSensor" in d.name), None)

    if target is None:
        return

    async with BleakClient(target.address) as client:
        # Read temperature
        data = await client.read_gatt_char(TEMP_CHAR_UUID)
        temp = int.from_bytes(data, byteorder="little", signed=True) / 100.0

        # Subscribe to notifications
        def notification_handler(sender, data):
            temp = int.from_bytes(data, byteorder="little", signed=True) / 100.0

        await client.start_notify(TEMP_CHAR_UUID, notification_handler)
        await asyncio.sleep(60)  # Listen for 60 seconds
        await client.stop_notify(TEMP_CHAR_UUID)

asyncio.run(main())
```

## GATT Design Patterns

**One service per functional domain** — Group related characteristics into a single service. A weather station might have an Environmental Sensing service (temperature, humidity, pressure) and a Battery Service (battery level). Avoid monolithic services with dozens of unrelated characteristics.

**Fixed-point integers over floats** — Transmit temperature as `int16_t` in hundredths of a degree (2250 = 22.50 °C) rather than a 4-byte float. This matches the SIG-defined characteristic formats, uses less bandwidth, avoids floating-point endianness ambiguity, and is more natural for MCU firmware that often works with integer ADC values.

**Version characteristic** — Include a read-only characteristic with the firmware version string. This allows phone apps to verify compatibility and simplifies field debugging without needing to connect a debugger.

**Write-with-response for configuration** — Use Write (with response) rather than Write Without Response for configuration parameters. The response confirms the peripheral received and accepted the value. Write Without Response is appropriate for high-throughput streaming where occasional drops are acceptable.

## Tips

- Always include the Device Information Service (`0x180A`) with at least Manufacturer Name and Firmware Revision characteristics. This is free metadata that simplifies debugging and is expected by many BLE testing tools.
- Negotiate the largest MTU the peripheral supports. On NimBLE, set `BLE_ATT_MTU_PREFERRED_OVER_BLE` in `menuconfig`. On SoftDevice, call `sd_ble_gatts_exchange_mtu_reply()` with the desired MTU in the `BLE_GATTS_EVT_EXCHANGE_MTU_REQUEST` handler.
- Use `nRF Connect` (mobile app) during development to browse the GATT table, read characteristics, write values, and subscribe to notifications. It provides raw hex display and supports custom UUID recognition.
- For characteristics that carry structured data (multiple fields), define a packed struct in firmware and document the byte layout. Avoid JSON over BLE — the parsing overhead and bandwidth waste are significant at BLE data rates.
- Limit the total number of characteristics to what the application needs. Each characteristic with a CCCD consumes 3 handles (declaration, value, CCCD) and corresponding RAM in the attribute table. On nRF52 with SoftDevice, the default handle allocation supports ~20 characteristics before requiring configuration changes.

## Caveats

- **MTU negotiation is not automatic on all platforms** — On Android, the app must explicitly call `requestMtu()` after connecting. iOS negotiates automatically but caps at 185 bytes by default. The peripheral cannot initiate MTU negotiation; it can only respond.
- **Handle caching by bonded centrals causes "service changed" issues** — If the GATT database changes between firmware versions (characteristics added, removed, or reordered), bonded phones may use stale cached handles, causing read/write failures. The Service Changed characteristic (`0x2A05`) with an indication solves this, but implementation varies by stack.
- **Notification throughput depends on the connection interval** — Each connection event allows a limited number of packets. At a 30 ms connection interval with DLE enabled, approximately 6 notifications per event are possible, yielding ~48 KB/s. Faster connection intervals or more packets per event increase throughput but also increase power consumption.
- **128-bit UUIDs consume 16 bytes per appearance in the ATT database** — On RAM-constrained devices, using a vendor-specific base UUID with 16-bit offsets reduces memory usage. NimBLE and SoftDevice both support this optimization.
- **Write Without Response can overwhelm the peripheral** — If the central writes faster than the peripheral processes, the stack's buffer fills and writes are silently dropped. Implement flow control using a notify-back acknowledgment or use Write With Response for reliable delivery.

## In Practice

- A custom environmental sensor exposes temperature (int16, hundredths of °C), humidity (uint16, hundredths of %RH), and pressure (uint32, Pascals) as three characteristics under a single custom service. The phone app subscribes to notifications on all three and receives updates every 2 seconds. Total BLE bandwidth: ~30 bytes per update cycle, well within default MTU limits.
- A firmware update (DFU) service uses Write Without Response for data chunks (to maximize throughput) and Notify for status/progress feedback. With MTU 247 and a 15 ms connection interval, typical DFU throughput reaches 10–15 KB/s on nRF52840 — transferring a 100 KB firmware image in approximately 7–10 seconds.
- A device that works with nRF Connect but fails with the production phone app likely has an MTU mismatch or is missing the CCCD on a notify characteristic. nRF Connect automatically negotiates maximum MTU and subscribes to notifications when tapping the arrows — the production app may not.
- Migrating from SoftDevice to NimBLE on nRF52 requires restructuring the GATT server definition. SoftDevice uses imperative API calls (add service, add characteristic), while NimBLE uses a declarative table of `ble_gatt_svc_def` structs resolved at initialization. The concepts map directly, but the code structure differs significantly.
- A peripheral that disconnects immediately after a central writes to a characteristic is typically crashing in the write callback. Common causes: null pointer dereference when accessing the write data, buffer overflow from unchecked write length, or stack overflow in the callback context. Adding length validation as the first operation in every write callback prevents the most common failure mode.
