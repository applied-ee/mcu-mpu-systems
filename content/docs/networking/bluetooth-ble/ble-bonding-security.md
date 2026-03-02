---
title: "BLE Bonding & Security"
weight: 30
---

# BLE Bonding & Security

BLE security is frequently misunderstood and frequently misconfigured. The protocol provides a layered security model — pairing establishes trust, encryption protects data in transit, and bonding stores keys for future reconnections without re-pairing. The challenge is that BLE's default mode (Just Works pairing) provides encryption but no authentication, meaning a man-in-the-middle (MITM) attack is trivially possible during the pairing process. Understanding the security model at the protocol level is essential for choosing the right trade-off between usability, security, and firmware complexity.

## Pairing vs Bonding

These terms are often confused but describe distinct operations:

**Pairing** is the process of establishing a shared secret between two devices through a key-exchange protocol. Pairing happens in real-time during the connection, involves user interaction (or not, depending on the method), and produces encryption keys. Pairing alone does not persist — if the devices disconnect, the keys are lost.

**Bonding** is the act of storing the keys generated during pairing so that future connections can be encrypted immediately without repeating the pairing process. Bonding requires flash storage on both devices. A bonded connection re-establishes encryption in ~50 ms versus 2–5 seconds for a fresh pairing.

```
First Connection:
  Connect → Pairing (key exchange) → Encrypt → Bond (store keys)

Subsequent Connection:
  Connect → Encrypt (using stored keys) → Ready
```

## Security Levels

BLE defines four security levels (modes) that determine the strength of protection:

| Level | Name | Encryption | Authentication (MITM Protection) | Pairing Method |
|-------|------|-----------|--------------------------------|---------------|
| 1 | No Security | None | None | None |
| 2 | Unauthenticated Encryption | AES-CCM | No | Just Works |
| 3 | Authenticated Encryption | AES-CCM | Yes | Passkey, Numeric Comparison, OOB |
| 4 | Authenticated LE Secure Connections | AES-CCM (ECDH) | Yes | Passkey, Numeric Comparison, OOB with LESC |

Level 2 (Just Works) is the most commonly deployed mode. It encrypts the link against passive eavesdropping but provides no protection against an active MITM attacker during the initial pairing. For many consumer IoT devices — temperature sensors, light bulbs, fitness trackers — this is considered acceptable because the data is low-sensitivity and the attack requires physical proximity during pairing.

Level 3 and 4 require **authenticated** pairing methods where both devices confirm they are communicating with each other and not an attacker.

## Pairing Methods

The pairing method is selected automatically based on the **I/O capabilities** advertised by each device:

| Device I/O Capability | Has Display | Has Keyboard | Has Yes/No Button |
|-----------------------|------------|-------------|-------------------|
| DisplayOnly | Yes | No | No |
| DisplayYesNo | Yes | No | Yes |
| KeyboardOnly | No | Yes | No |
| KeyboardDisplay | Yes | Yes | No/Yes |
| NoInputNoOutput | No | No | No |

The mapping from I/O capabilities to pairing method:

| Initiator \ Responder | DisplayOnly | DisplayYesNo | KeyboardOnly | NoInputNoOutput | KeyboardDisplay |
|----------------------|------------|-------------|-------------|----------------|----------------|
| **DisplayOnly** | Just Works | Just Works | Passkey Entry | Just Works | Passkey Entry |
| **DisplayYesNo** | Just Works | Numeric Comp | Passkey Entry | Just Works | Numeric Comp |
| **KeyboardOnly** | Passkey Entry | Passkey Entry | Passkey Entry | Just Works | Passkey Entry |
| **NoInputNoOutput** | Just Works | Just Works | Just Works | Just Works | Just Works |
| **KeyboardDisplay** | Passkey Entry | Numeric Comp | Passkey Entry | Just Works | Numeric Comp |

### Just Works

No user interaction required. The devices perform a Diffie-Hellman key exchange (ECDH with LESC, or a simpler exchange with Legacy) and establish encryption. Provides confidentiality against passive eavesdropping but no MITM protection. An attacker within radio range during pairing can intercept and relay the exchange.

Appropriate for: low-sensitivity sensors, consumer convenience devices, prototyping.

### Passkey Entry

One device displays a 6-digit number (000000–999999), and the user enters it on the other device. This provides MITM protection because the passkey is incorporated into the key-exchange computation — an attacker who does not know the passkey cannot derive the encryption keys.

Appropriate for: devices with a display or a phone-side UI, fitness devices, medical sensors.

### Numeric Comparison

Both devices display a 6-digit number, and the user confirms they match by pressing "Yes" on both. This method is only available with LE Secure Connections and provides strong MITM protection. It is the preferred method for device-to-phone pairing when both sides have a display and a confirmation button.

Appropriate for: phone-to-device pairing, consumer electronics.

### Out-of-Band (OOB)

Key material is exchanged through a channel other than BLE — NFC tap, QR code scan, or a pre-shared key embedded during manufacturing. OOB provides the strongest security guarantee because the BLE radio is never used for key exchange, making radio-based MITM impossible.

Appropriate for: industrial devices, medical equipment, high-security applications.

## LE Secure Connections vs Legacy Pairing

BLE 4.2 introduced **LE Secure Connections (LESC)**, a significant upgrade over the original "Legacy" pairing mechanism:

| Feature | Legacy Pairing | LE Secure Connections |
|---------|---------------|---------------------|
| Key Exchange | Custom BLE protocol (Temporary Key) | ECDH P-256 (Elliptic Curve Diffie-Hellman) |
| Key Length | 128-bit STK → LTK | 128-bit LTK derived from ECDH |
| Passkey Security | Each bit leaks ~1 bit of key | Passkey used as nonce, not directly as key material |
| Just Works Security | Vulnerable to passive + active MITM | Vulnerable to active MITM only (passive eavesdropping protected) |
| Numeric Comparison | Not available | Available |
| Brute-Force Resistance | Passkey (10^6) crackable in seconds on Legacy | Passkey + ECDH computationally expensive to brute-force |

**Legacy pairing with Passkey Entry** has a known weakness: the 6-digit passkey (20 bits of entropy) is used directly in key generation. An attacker who captures the pairing exchange can brute-force the passkey offline in under a second. LESC fixes this by using ECDH for the key exchange and incorporating the passkey as a confirmation value rather than key material.

Recommendation: always enable LE Secure Connections on new designs. All nRF52, ESP32, and modern BLE chipsets support LESC.

## Key Distribution

During bonding, multiple keys are generated and optionally distributed:

| Key | Full Name | Purpose | Direction |
|-----|-----------|---------|-----------|
| LTK | Long Term Key | Encrypts future connections | Both (LESC) or Peripheral→Central (Legacy) |
| IRK | Identity Resolving Key | Resolves Resolvable Private Addresses (RPAs) | Both directions |
| CSRK | Connection Signature Resolving Key | Authenticates signed data (rarely used) | Both directions |
| EDIV + Rand | Encrypted Diversifier + Random | Identifies which LTK to use (Legacy only) | Peripheral→Central |

In LE Secure Connections, both devices derive the same LTK from the ECDH exchange — there is no separate key distribution step for the LTK. IRK distribution is still performed if privacy is enabled.

## Key Storage

Bonding keys must be stored in non-volatile memory. The storage requirements per bonded device are approximately:

| Data | Size |
|------|------|
| LTK | 16 bytes |
| IRK | 16 bytes |
| CSRK | 16 bytes |
| Peer Address | 7 bytes (6 addr + 1 type) |
| EDIV + Rand (Legacy) | 10 bytes |
| CCCD values | 2 bytes per subscribed characteristic |
| Metadata | ~20 bytes (flags, security level, etc.) |
| **Total per bond** | **~90–150 bytes** |

Storage options:

| Method | Platform | Capacity | Wear Leveling |
|--------|----------|----------|--------------|
| NVS (ESP-IDF) | ESP32 | 4 KB default partition, ~30 bonds | Yes (built-in) |
| FDS (nRF5 SDK) | nRF52 | 2–4 flash pages, ~10–20 bonds | Yes (built-in) |
| Settings (Zephyr) | Various | Configurable | Yes (if using NVS backend) |
| Secure Element (ATECC608A) | Any | 16 key slots | N/A (no flash wear) |

For devices that pair with many centrals (e.g., a public kiosk), implementing a bond eviction policy — removing the oldest bond when storage is full — prevents pairing failures. NimBLE provides a `ble_store_util_delete_oldest_peer()` function for this purpose.

## Resolvable Private Addresses (RPA)

BLE privacy uses **Resolvable Private Addresses** to prevent passive tracking. Instead of advertising with a fixed public or static random address, the device generates a new random-looking address every 15 minutes (configurable, typically 15 min–1 hour). Only devices that possess the IRK can resolve the RPA back to the device's identity.

```
RPA Structure (6 bytes):
┌──────────────┬─────────────────────┐
│  prand (3B)  │  hash (3B)          │
│  random part │  AES(IRK, prand)    │
└──────────────┴─────────────────────┘

Verification:  hash == AES-128(IRK, prand)[0:3]
```

RPA resolution involves trying each stored IRK against the received address — an O(n) operation where n is the number of bonded devices. Hardware-accelerated resolution (available on nRF52) performs this in the controller, avoiding host-side computation.

Privacy is especially important for wearables and personal devices. Without RPA, a BLE device advertising with a fixed address can be tracked across locations by any passive observer with a BLE sniffer.

## Known BLE Attacks

| Attack | Year | Target | Impact | Mitigation |
|--------|------|--------|--------|-----------|
| **KNOB** (Key Negotiation of Bluetooth) | 2019 | Entropy negotiation | Forces encryption key to 1 byte, enabling brute-force | Enforce minimum key entropy (7 bytes) in stack configuration |
| **BLESA** (BLE Spoofing Attacks) | 2020 | Reconnection after bonding | Attacker spoofs peripheral during reconnection | Mutual authentication, verify LTK immediately after connection |
| **Method Confusion** | 2021 | Pairing method selection | Tricks devices into using Just Works instead of Numeric Comparison | Firmware-side enforcement of minimum security level |
| **BIAS** (Bluetooth Impersonation Attacks) | 2020 | Role switching during authentication | Attacker impersonates a previously bonded device | Updated BLE stack with role verification |
| **SweynTooth** | 2020 | BLE stack implementations | Crashes, deadlocks, security bypasses in specific vendor stacks | Firmware updates from chip vendor |
| **BLURtooth** | 2020 | Cross-Transport Key Derivation | Overwrite BLE keys using BR/EDR pairing | Disable CTKD or enforce restrictions |

Most of these attacks require physical proximity (BLE range, ~50 m in open air, ~10 m indoors). The practical risk depends on the threat model — a temperature sensor in a private home faces different threats than a medical device in a hospital.

## NimBLE Security Configuration (ESP32)

```c
#include "host/ble_hs.h"
#include "host/ble_sm.h"

static void configure_security(void)
{
    /* Enable LE Secure Connections */
    ble_hs_cfg.sm_sc = 1;

    /* Set I/O capabilities */
    ble_hs_cfg.sm_io_cap = BLE_SM_IO_CAP_DISP_YES_NO;  /* Display + Yes/No */

    /* Require bonding */
    ble_hs_cfg.sm_bonding = 1;

    /* Require MITM protection */
    ble_hs_cfg.sm_mitm = 1;

    /* Enable keypress notifications (for passkey entry UI) */
    ble_hs_cfg.sm_keypress = 0;

    /* Key distribution: distribute and accept LTK and IRK */
    ble_hs_cfg.sm_our_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
    ble_hs_cfg.sm_their_key_dist = BLE_SM_PAIR_KEY_DIST_ENC | BLE_SM_PAIR_KEY_DIST_ID;
}

/* Passkey display callback (called during Passkey Entry or Numeric Comparison) */
static void on_passkey_action(uint16_t conn_handle,
                              struct ble_gap_event *event)
{
    struct ble_sm_io pkey = { 0 };

    if (event->passkey.params.action == BLE_SM_IOACT_DISP) {
        /* Display this passkey to the user */
        pkey.action = BLE_SM_IOACT_DISP;
        pkey.passkey = 123456;  /* In production: generate random */
        ble_sm_inject_io(conn_handle, &pkey);
    }
    else if (event->passkey.params.action == BLE_SM_IOACT_NUMCMP) {
        /* Display number and get user confirmation */
        pkey.action = BLE_SM_IOACT_NUMCMP;
        pkey.numcmp_accept = 1;  /* In production: wait for button press */
        ble_sm_inject_io(conn_handle, &pkey);
    }
}
```

## SoftDevice Security Configuration (nRF52)

```c
#include "ble.h"
#include "peer_manager.h"

static void peer_manager_init(void)
{
    ble_gap_sec_params_t sec_params = {
        .bond           = 1,        /* Enable bonding */
        .mitm           = 1,        /* Require MITM protection */
        .lesc           = 1,        /* Enable LE Secure Connections */
        .keypress       = 0,
        .io_caps        = BLE_GAP_IO_CAPS_DISPLAY_YESNO,
        .oob            = 0,
        .min_key_size   = 7,        /* Minimum encryption key size (bytes) */
        .max_key_size   = 16,       /* Maximum encryption key size */
        .kdist_own      = { .enc = 1, .id = 1 },
        .kdist_peer     = { .enc = 1, .id = 1 },
    };

    pm_init();
    pm_sec_params_set(&sec_params);

    /* Delete all bonds on long button press (for development) */
    /* pm_peers_delete(); */
}

/* Handle pairing events */
static void pm_evt_handler(pm_evt_t const *p_evt)
{
    switch (p_evt->evt_id) {
        case PM_EVT_BONDED_PEER_CONNECTED:
            /* Reconnected with a bonded device — encryption auto-established */
            break;
        case PM_EVT_CONN_SEC_SUCCEEDED:
            /* Pairing/encryption succeeded */
            break;
        case PM_EVT_CONN_SEC_FAILED:
            /* Pairing failed — disconnect */
            sd_ble_gap_disconnect(p_evt->conn_handle,
                                  BLE_HCI_REMOTE_USER_TERMINATED_CONNECTION);
            break;
        case PM_EVT_STORAGE_FULL:
            /* Bond storage full — delete oldest */
            pm_peer_delete(pm_next_peer_id_get(PM_PEER_ID_INVALID));
            break;
        default:
            break;
    }
}
```

## Security Level Enforcement Per Characteristic

Different characteristics can require different security levels. A temperature reading might be readable without encryption, while a configuration parameter requires authenticated encryption:

```c
/* NimBLE: characteristic with security requirements */
{
    .uuid = &config_chr_uuid.u,
    .access_cb = config_access_cb,
    .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_WRITE
           | BLE_GATT_CHR_F_READ_ENC      /* Read requires encryption */
           | BLE_GATT_CHR_F_WRITE_ENC     /* Write requires encryption */
           | BLE_GATT_CHR_F_WRITE_AUTHEN, /* Write requires authentication */
},
```

When a central attempts to access a characteristic that requires a higher security level than the current connection provides, the stack returns an `Insufficient Authentication` or `Insufficient Encryption` error. Well-behaved centrals (including iOS and Android) respond by initiating pairing automatically.

## Tips

- Default to LE Secure Connections (LESC) on all new designs. The computational overhead of ECDH P-256 is negligible on modern BLE SoCs (nRF52: ~200 ms for key generation, ESP32: ~100 ms with hardware acceleration).
- Implement a "factory reset" mechanism (long button press, special write to a characteristic) that deletes all bonds. This is essential for development and for recovering from corrupted bond storage in the field.
- Test pairing with multiple phone OS versions. iOS and Android handle security negotiation differently — iOS aggressively caches security state and may reject reconnections if bond keys are deleted on the peripheral side without the phone's knowledge.
- Set `min_key_size` to at least 7 bytes (the BLE specification minimum is 7, maximum is 16). This mitigates the KNOB attack, which attempts to negotiate a 1-byte key.
- For devices that pair with a single phone, store the bonded peer's IRK and reject connections from unknown addresses after bonding. This prevents unauthorized access from other phones.

## Caveats

- **Just Works pairing is encrypted but not authenticated** — it protects against passive eavesdropping (someone sniffing BLE traffic from across the room) but not against an active attacker who positions a relay device between the peripheral and central during pairing. For most consumer IoT devices, this is an accepted risk.
- **Bond deletion on one side causes "silent failure" on the other** — if the peripheral's bonds are erased (firmware update, factory reset) but the phone retains the old bond, the phone attempts to encrypt with the old LTK, which fails silently or causes repeated disconnections. The fix is to remove the bond from the phone's Bluetooth settings or implement the Service Changed indication to force re-pairing.
- **Secure Element integration adds complexity** — storing keys in an ATECC608A or similar provides tamper resistance but requires I2C communication during the pairing process, adding latency. Most consumer BLE devices use flash-based key storage, with the secure element reserved for applications where physical key extraction is a threat.
- **Legacy pairing Passkey Entry is weaker than it appears** — the 6-digit passkey (20 bits of entropy) can be brute-forced offline if the pairing exchange is captured. Always use LESC with passkey entry to mitigate this.
- **RPA rotation interval is a privacy vs power trade-off** — frequent rotation (every 15 minutes) provides stronger privacy but requires more frequent address updates in the controller. On devices advertising at 1-second intervals, the RPA rotation itself consumes negligible power, but bonded centrals must re-resolve the address, adding ~1 ms of latency per reconnection.

## In Practice

- A sensor device that pairs once with a gateway and then communicates indefinitely should use LESC with Numeric Comparison during initial setup, then rely on bonding for all subsequent connections. The initial pairing takes 2–5 seconds; bonded reconnections complete in under 100 ms.
- A consumer product that "just works" out of the box with a phone app typically uses Just Works pairing. The app developer should implement certificate pinning and application-layer encryption (AES-128-GCM over the GATT characteristic) if the data requires confidentiality beyond what Just Works provides.
- A device that intermittently fails to reconnect with a bonded phone — working some days but not others — is likely encountering RPA resolution failures. Check that the IRK is stored correctly and that the controller's resolving list is properly populated on boot. On nRF52 with SoftDevice, the `pm_whitelist_set()` / `pm_device_identities_list_set()` calls must happen after `pm_init()` and before advertising starts.
- OOB pairing via NFC tap is the gold standard for consumer UX — the user taps the phone to the device, and pairing completes in under a second with full MITM protection. Implementation requires an NFC tag (NT3H2111 or similar) that stores the OOB data and a firmware routine that generates fresh OOB keys for each pairing attempt.
- Testing BLE security requires a BLE sniffer (nRF52840 dongle + Wireshark with the Nordic BLE sniffer plugin). Capturing the pairing exchange reveals whether LESC is actually being used, what I/O capabilities were exchanged, and whether the encryption key length meets expectations. Phone-based tools cannot verify these protocol-level details.
