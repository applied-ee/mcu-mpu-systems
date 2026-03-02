---
title: "Bluetooth Classic Audio"
weight: 50
bookCollapseSection: true
---

# Bluetooth Classic Audio

Bluetooth Classic (BR/EDR) remains the dominant transport for wireless audio — headphones, speakers, car infotainment, and hands-free calling all run over BR/EDR audio profiles rather than BLE. The reason is bandwidth: BLE was designed for low-duty-cycle sensor data, not continuous 16-bit audio streams. A2DP over BR/EDR delivers 328 kbps of SBC-encoded audio (enough for near-CD quality), while HFP carries narrowband or wideband voice over dedicated SCO links with guaranteed timing. These profiles are mature, widely supported by consumer devices, and available on dual-mode platforms like the ESP32.

This section covers Bluetooth Classic audio from the embedded firmware perspective — building A2DP source and sink pipelines, implementing HFP for voice calls, and integrating AVRCP for playback control. BLE-specific content (advertising, GATT, BLE audio / LC3) lives in [Networking — Bluetooth & BLE]({{< relref "/docs/networking/bluetooth-ble" >}}).

## Pages

- **[Bluetooth Classic for Audio]({{< relref "bluetooth-classic-overview" >}})** — BR/EDR vs BLE for audio, SCO/ACL links, ESP32 as the primary embedded platform, stack options (Bluedroid, BTstack), and dual-mode coexistence.

- **[A2DP Audio Streaming]({{< relref "a2dp-audio-streaming" >}})** — A2DP source and sink roles, SBC encoding (mandatory), optional codecs (AAC, LDAC), I2S-to-A2DP pipeline construction, and buffer management.

- **[HFP & Hands-Free Voice]({{< relref "hfp-voice-calls" >}})** — HFP/HSP profiles, SCO link setup, CVSD and mSBC codecs, echo cancellation, and the mic-to-SCO-to-speaker pipeline.

- **[AVRCP Playback Control]({{< relref "avrcp-playback-control" >}})** — Transport controls, track metadata, target vs controller roles, notification events, and AVRCP + A2DP integration.
