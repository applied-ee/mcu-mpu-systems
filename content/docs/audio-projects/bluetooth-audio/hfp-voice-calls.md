---
title: "HFP & Hands-Free Voice"
weight: 30
---

# HFP & Hands-Free Voice

The Hands-Free Profile (HFP) carries bidirectional voice audio over Bluetooth Classic — it is the protocol behind car hands-free systems, Bluetooth headsets for phone calls, and any device that handles voice communication over Bluetooth. Unlike A2DP (which streams high-quality unidirectional audio), HFP provides a simultaneous two-way voice channel: microphone audio flows from the hands-free unit (HF) to the phone (audio gateway, AG), and downlink audio flows from the phone to the hands-free unit. The audio quality is lower than A2DP (narrowband or wideband voice rather than music), but the bidirectional real-time nature is what makes voice calls work.

## HFP vs HSP

| Feature | HFP (Hands-Free Profile) | HSP (Headset Profile) |
|---|---|---|
| Voice audio | Bidirectional SCO | Bidirectional SCO |
| Call control | Answer, reject, dial, DTMF | Answer, hang up only |
| Caller ID | Yes | No |
| Voice recognition | Yes (trigger Siri/Google) | No |
| Three-way calling | Yes | No |
| Volume control | Synchronized with phone | Local only |
| Typical device | Car hands-free, smart speaker | Simple mono headset |

HSP is the older, simpler protocol — it carries voice audio but has minimal call control. HFP supersedes HSP and is what modern devices use. Most implementations support both for backward compatibility.

## Roles

| Role | Abbreviation | Function | Typical Device |
|---|---|---|---|
| Audio Gateway | AG | Phone side — originates/terminates calls | Smartphone, laptop |
| Hands-Free | HF | Remote side — provides speaker/mic | Car kit, headset, ESP32 |

An ESP32 typically acts as the HF role (receiving calls from a phone). Acting as the AG role (emulating a phone) is less common but supported by ESP-IDF for specialized applications like SIP-to-Bluetooth bridges.

## SCO Link Setup

HFP voice uses SCO (Synchronous Connection-Oriented) links for audio. Unlike ACL links used by A2DP, SCO links provide fixed-bandwidth, fixed-latency channels without retransmission:

| SCO Type | Codec | Sample Rate | Bandwidth | Quality |
|---|---|---|---|---|
| SCO (CVSD) | CVSD | 8 kHz | 64 kbps | Narrowband (telephone quality) |
| eSCO (mSBC) | mSBC (modified SBC) | 16 kHz | 64 kbps | Wideband (HD voice) |

CVSD (Continuously Variable Slope Delta modulation) is the mandatory narrowband codec — every HFP device must support it. mSBC (modified SBC for HFP) doubles the audio bandwidth to 16 kHz, providing significantly clearer voice quality. mSBC support is indicated by the "Codec Negotiation" feature in HFP 1.6 and later.

### Codec Negotiation Flow

```
Phone (AG)                    ESP32 (HF)
    │                             │
    │  ──── AT+BRSF ──────────►  │  Exchange supported features
    │  ◄──── +BRSF ───────────  │
    │                             │
    │  ──── AT+BAC=1,2 ────────► │  Available codecs (1=CVSD, 2=mSBC)
    │  ◄──── OK ───────────────  │
    │                             │
    │  (call established)         │
    │                             │
    │  ──── +BCS=2 ────────────► │  Codec selected: mSBC
    │  ◄──── AT+BCS=2 ─────────  │  Confirmed
    │                             │
    │  ──── SCO connection ────►  │  16 kHz wideband voice
```

## ESP32 HFP Implementation

```c
#include "esp_hf_client_api.h"

/* HFP client (HF role) callback */
static void hf_client_cb(esp_hf_client_cb_event_t event,
                          esp_hf_client_cb_param_t *param)
{
    switch (event) {
    case ESP_HF_CLIENT_CONNECTION_STATE_EVT:
        /* Connected/disconnected to phone */
        break;

    case ESP_HF_CLIENT_AUDIO_STATE_EVT:
        if (param->audio_stat.state == ESP_HF_CLIENT_AUDIO_STATE_CONNECTED) {
            /* SCO audio channel is open — start mic/speaker I/O */
        }
        break;

    case ESP_HF_CLIENT_CIND_CALL_EVT:
        /* Call state changed (incoming, active, held, ended) */
        break;

    case ESP_HF_CLIENT_RING_IND_EVT:
        /* Incoming call — ring indication */
        break;

    default:
        break;
    }
}

/* Audio data callbacks */
static uint32_t hf_client_incoming_cb(uint8_t *data, uint32_t len)
{
    /* Downlink audio (phone → ESP32) — write to I2S speaker output */
    size_t bytes_written;
    i2s_channel_write(i2s_tx_handle, data, len, &bytes_written, pdMS_TO_TICKS(5));
    return bytes_written;
}

static uint32_t hf_client_outgoing_cb(uint8_t *data, uint32_t len)
{
    /* Uplink audio (ESP32 mic → phone) — read from I2S mic input */
    size_t bytes_read;
    i2s_channel_read(i2s_rx_handle, data, len, &bytes_read, pdMS_TO_TICKS(5));
    return bytes_read;
}

void hfp_init(void)
{
    esp_hf_client_register_callback(hf_client_cb);
    esp_hf_client_init();

    esp_hf_client_register_data_callback(hf_client_incoming_cb,
                                          hf_client_outgoing_cb);
}
```

## The Mic-to-SCO-to-Speaker Pipeline

A complete HFP voice pipeline on ESP32:

```
[Microphone] → I2S/ADC → DMA → Outgoing Callback → SCO Link → Phone
[Speaker]   ← I2S/DAC ← DMA ← Incoming Callback ← SCO Link ← Phone
```

Both directions run simultaneously. The SCO link delivers and requests audio in small, fixed-size chunks (typically 60 or 120 bytes, depending on codec and SCO interval). The callbacks must service these quickly — the SCO link has no buffering tolerance.

### Sample Rate Mismatch

The I2S codec may run at 48 kHz while CVSD operates at 8 kHz or mSBC at 16 kHz. Sample rate conversion is needed in both directions:

- **Uplink (mic → phone)**: Downsample from 48 kHz to 8/16 kHz before passing to the outgoing callback.
- **Downlink (phone → speaker)**: Upsample from 8/16 kHz to 48 kHz before writing to I2S.

A simple integer-ratio SRC (e.g., 3:1 for 48→16 kHz) with a low-pass filter is sufficient for voice quality.

## Echo Cancellation

In speakerphone configurations (speaker and microphone in the same room), the microphone picks up the speaker output, creating an echo for the remote caller. Acoustic Echo Cancellation (AEC) subtracts the estimated speaker contribution from the microphone signal.

ESP-IDF provides an AEC module in the `esp-adf` (Audio Development Framework):

```c
/* ESP-ADF — Acoustic Echo Cancellation */
#include "esp_afe_sr_iface.h"

/* The AEC module takes two inputs:
 * 1. Microphone signal (with echo)
 * 2. Reference signal (what is being played on the speaker)
 * And outputs the echo-cancelled microphone signal */
```

AEC requires careful timing alignment between the reference signal (speaker output) and the microphone input. The processing introduces 10–30 ms of additional latency. On ESP32, AEC consumes approximately 30–50 MHz of CPU — significant but feasible on one core while the other handles Bluetooth and I2S.

### Without AEC

For headphone/headset configurations where the speaker output is acoustically isolated from the microphone, AEC is unnecessary. This simplifies the pipeline and reduces CPU load. The decision to include AEC depends entirely on the physical product design.

## Tips

- Test with both CVSD and mSBC codecs — some phones default to CVSD even when mSBC is available. Verifying that mSBC negotiation succeeds (check the `ESP_HF_CLIENT_BSIR_EVT` and codec selection events) ensures wideband voice quality.
- For speakerphone designs, use a microphone with a directional pickup pattern (cardioid capsule or beamforming array) rather than relying solely on AEC. Physical acoustic isolation reduces the echo signal before AEC processes it, improving cancellation quality.
- Implement call control AT commands (answer: `AT+ATA`, reject: `AT+CHUP`, dial: `AT+ATD<number>`) to provide a complete hands-free experience beyond basic audio streaming.

## Caveats

- SCO audio on ESP32 runs at high interrupt priority and is sensitive to CPU contention. Running heavy computation (WiFi operations, flash writes, DSP processing) during an active voice call can cause audio dropouts. Prioritizing the Bluetooth task and deferring non-critical work during calls improves stability.
- CVSD audio at 8 kHz sounds significantly worse than a modern phone call. The remote caller hears a noticeable quality difference compared to a direct phone connection. mSBC at 16 kHz is dramatically better and should be enabled whenever the phone supports it.
- The SCO callback timing is strict — the callback must return data within approximately 7.5 ms (one SCO interval). Blocking on I2S reads within the callback can cause missed SCO packets if the I2S buffer is not pre-filled.

## In Practice

- **Voice from ESP32 sounds robotic or garbled on the phone** — often indicates a sample rate mismatch between the I2S input and the SCO codec expectation. If the microphone is captured at 48 kHz but the outgoing callback expects 8 kHz CVSD data, the samples are misinterpreted, producing unintelligible audio.
- **Echo on the remote caller's side** — the microphone is picking up the speaker output. AEC is needed for speakerphone configurations, or the speaker volume must be reduced enough that the microphone does not capture it.
- **HFP connects but no audio — SCO link does not establish** — some phones require the HF device to support both CVSD and mSBC for codec negotiation to succeed. If the ESP32 advertises only one codec, certain phones may fail to establish the SCO link. Advertising both codecs (`AT+BAC=1,2`) resolves this.
- **Voice call audio drops out for 1–2 seconds periodically** — WiFi and Bluetooth Classic share the same 2.4 GHz radio on ESP32. During WiFi TX bursts (especially large HTTP transfers or OTA updates), the SCO link is preempted, causing voice dropouts. Suspending WiFi data transfers during active voice calls is the most reliable mitigation.
