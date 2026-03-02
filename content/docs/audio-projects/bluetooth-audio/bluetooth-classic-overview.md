---
title: "Bluetooth Classic for Audio"
weight: 10
---

# Bluetooth Classic for Audio

Bluetooth Classic (BR/EDR — Basic Rate / Enhanced Data Rate) is the transport layer behind wireless headphones, car audio, and hands-free calling. BLE (Bluetooth Low Energy) was not designed for continuous audio streaming — its connection intervals, packet sizes, and lack of guaranteed throughput make it unsuitable for real-time audio at acceptable quality. Bluetooth Classic's ACL (Asynchronous Connection-Less) and SCO (Synchronous Connection-Oriented) links provide the bandwidth and timing guarantees that audio demands. The ESP32 is the dominant MCU platform for Bluetooth Classic audio, with both Bluedroid and NimBLE stacks available, though NimBLE supports only BLE — Bluetooth Classic audio requires Bluedroid or BTstack.

## BR/EDR vs BLE for Audio

| Parameter | Bluetooth Classic (BR/EDR) | BLE | BLE Audio (LC3/LE Audio) |
|---|---|---|---|
| Max data rate | 2.1 Mbps (EDR) | 2 Mbps (LE 2M PHY) | 2 Mbps |
| Audio streaming | A2DP (328 kbps SBC) | Not designed for audio | LC3 codec, broadcast |
| Voice | HFP (64 kbps CVSD/mSBC) | Not designed for voice | LC3 (voice+music) |
| Latency | 40–100 ms (A2DP) | 7.5–30 ms (conn interval) | 20–50 ms |
| Power | Higher (always-on radio) | Lower (duty-cycled) | Lower than Classic |
| MCU support | ESP32, some others | Nearly all BLE SoCs | Very limited on MCUs |
| Consumer device support | Universal (headphones, speakers, cars) | Limited for audio | Emerging (2024+) |

BLE Audio (LE Audio) with the LC3 codec is the successor to Bluetooth Classic audio, offering better quality at lower bitrates and supporting broadcast (Auracast). However, MCU-side support is minimal as of 2025 — ESP32 does not support LE Audio, and most embedded projects targeting wireless audio still use Bluetooth Classic.

## SCO and ACL Links

Bluetooth Classic provides two transport types for audio:

**ACL (Asynchronous Connection-Less)** — Used by A2DP for music streaming. ACL links carry L2CAP data packets with error correction and retransmission. The audio is encoded (SBC, AAC, LDAC) and streamed as a data payload. Latency is variable (40–200 ms) because packets can be retransmitted.

**SCO (Synchronous Connection-Oriented)** — Used by HFP/HSP for voice calls. SCO links provide a fixed-bandwidth, fixed-latency channel (64 kbps at 8 kHz or 16 kHz). Packets are not retransmitted — if a packet is lost, the audio has a gap. This guarantees bounded latency (typically 10–20 ms one-way) at the cost of occasional audio dropouts.

```
┌─────────────────────────────────────────────┐
│           Bluetooth Classic Stack            │
│                                              │
│  ┌──────────────┐    ┌──────────────────┐   │
│  │     A2DP      │    │     HFP/HSP      │   │
│  │ (music stream)│    │   (voice call)   │   │
│  └──────┬───────┘    └───────┬──────────┘   │
│         │                     │              │
│  ┌──────┴───────┐    ┌───────┴──────────┐   │
│  │   ACL Link    │    │    SCO Link      │   │
│  │ (retransmit)  │    │ (no retransmit)  │   │
│  └──────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────┘
```

## ESP32 as the Primary Platform

The ESP32 (original) is the most widely available MCU with Bluetooth Classic support. The ESP32-S3 supports only BLE. The ESP32-C3/C6/H2 support only BLE. For Bluetooth Classic audio projects, the original ESP32 is effectively the only low-cost MCU option.

| Feature | ESP32 (original) | ESP32-S3 | ESP32-C3/C6 |
|---|---|---|---|
| Bluetooth Classic | Yes | No | No |
| A2DP source/sink | Yes | No | No |
| HFP AG/HF | Yes | No | No |
| BLE | Yes | Yes | Yes |
| Dual-mode (Classic + BLE) | Yes | N/A | N/A |

### ESP-IDF Bluetooth Classic Stack

ESP-IDF uses the Bluedroid stack for Bluetooth Classic. Key components:

```c
#include "esp_bt.h"
#include "esp_bt_main.h"
#include "esp_bt_device.h"
#include "esp_a2dp_api.h"
#include "esp_avrc_api.h"

void bt_classic_init(void)
{
    /* Release BLE memory if not using BLE (saves ~30 KB) */
    esp_bt_controller_mem_release(ESP_BT_MODE_BLE);

    esp_bt_controller_config_t bt_cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
    esp_bt_controller_init(&bt_cfg);
    esp_bt_controller_enable(ESP_BT_MODE_CLASSIC_BT);

    esp_bluedroid_init();
    esp_bluedroid_enable();

    /* Set discoverable and connectable */
    esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
}
```

## Stack Options

| Stack | Platform | Classic Audio | BLE | License | Notes |
|---|---|---|---|---|---|
| Bluedroid (ESP-IDF) | ESP32 | A2DP, HFP, AVRCP | Yes | Apache 2.0 | Default ESP-IDF stack |
| BTstack | Multiple | A2DP, HFP, AVRCP | Yes | Dual (free/commercial) | Portable C, well-documented |
| BlueZ | Linux SBCs | Full profile support | Yes | GPL | Linux kernel Bluetooth stack |
| NimBLE (ESP-IDF) | ESP32 | No (BLE only) | Yes | Apache 2.0 | Not usable for Classic audio |

For ESP32 projects, Bluedroid is the standard choice — it is integrated with ESP-IDF, supports all audio profiles, and has extensive example code. BTstack is an alternative for non-ESP32 platforms or when more fine-grained control over the stack is needed.

## Memory Requirements

Bluetooth Classic audio consumes significant RAM:

| Component | Approximate RAM |
|---|---|
| BT controller (ESP32) | ~60 KB |
| Bluedroid stack | ~40 KB |
| A2DP + SBC codec | ~15 KB |
| HFP + CVSD/mSBC | ~20 KB |
| AVRCP | ~5 KB |
| **Total (A2DP + HFP)** | **~140 KB** |

On the ESP32's 520 KB SRAM, Bluetooth Classic audio leaves approximately 380 KB for the application, RTOS, WiFi (if dual-mode), and audio processing. This is tight for applications that need WiFi + BT Classic + DSP simultaneously.

## Dual-Mode Coexistence

The ESP32 supports simultaneous Bluetooth Classic and BLE operation (dual-mode). This enables scenarios like streaming audio over A2DP while advertising a BLE configuration service. The coexistence controller time-shares the single radio between Classic and BLE operations.

```c
/* Enable dual-mode (Classic + BLE) */
esp_bt_controller_enable(ESP_BT_MODE_BTDM);
```

The cost is increased RAM usage (~170 KB for both stacks) and reduced throughput for each protocol due to time-sharing. WiFi + Bluetooth Classic + BLE triple coexistence is supported but requires careful configuration of coexistence parameters to avoid audio dropouts during WiFi bursts.

## Tips

- Release unused Bluetooth memory during initialization. If using only Classic (no BLE), call `esp_bt_controller_mem_release(ESP_BT_MODE_BLE)` to reclaim ~30 KB. If using only BLE (no Classic), release Classic memory similarly.
- Set the Bluetooth device name to something meaningful before enabling discoverability — the default name is "ESP32" which is indistinguishable from hundreds of other ESP32 devices.
- For audio applications that do not need WiFi, disable WiFi entirely (`esp_wifi_stop()` and `esp_wifi_deinit()`) to free ~50 KB of RAM and eliminate WiFi/BT coexistence timing issues.

## Caveats

- ESP32-S3, C3, C6, and H2 do not support Bluetooth Classic. Projects targeting these chips cannot use A2DP, HFP, or AVRCP. Only the original ESP32 (and ESP32-WROVER variants) support Classic audio.
- Bluetooth Classic discovery and pairing are slow compared to BLE — initial device discovery takes 5–10 seconds, and pairing adds another 2–5 seconds. This is inherent to the BR/EDR inquiry/page procedure and cannot be significantly reduced.
- The Bluedroid stack on ESP32 is a modified Android Bluetooth stack. Some features documented in the Android Bluetooth API are not available or behave differently on ESP32. The ESP-IDF API documentation (not Android documentation) is the authoritative reference.

## In Practice

- **ESP32 resets or panics during Bluetooth Classic initialization** — typically a memory issue. The BT controller requires a contiguous ~60 KB allocation early in boot. If the heap is fragmented (from WiFi init or large allocations before BT init), the allocation fails. Initializing Bluetooth before WiFi and before any large heap allocations resolves the panic.
- **Audio device connects but no audio plays** — the connection established an ACL link (control channel) but the A2DP media channel (audio stream) was not started. This commonly occurs when the A2DP callback handler does not properly respond to the `ESP_A2D_AUDIO_STATE_EVT` event.
- **Bluetooth range is much shorter than expected (less than 5 meters)** — the ESP32 antenna design and orientation significantly affect range. PCB antenna modules (ESP32-WROOM) have a directional radiation pattern. Placing the antenna against a metal surface or inside a metal enclosure can reduce effective range to 1–2 meters.
