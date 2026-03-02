---
title: "A2DP Audio Streaming"
weight: 20
---

# A2DP Audio Streaming

A2DP (Advanced Audio Distribution Profile) is the Bluetooth Classic profile for streaming high-quality stereo audio — it is the protocol behind every wireless headphone and Bluetooth speaker. A2DP defines two roles: the **source** (SRC) sends audio (phone, MCU, media player) and the **sink** (SNK) receives and plays it (headphones, speaker). An ESP32 can act as either role, enabling projects that stream audio to Bluetooth headphones (source) or receive audio from a phone (sink).

## A2DP Roles

| Role | Function | ESP32 Use Case |
|---|---|---|
| Source (SRC) | Encodes and sends audio | Internet radio → BT headphones, SD card player → BT speaker |
| Sink (SNK) | Receives, decodes, and plays audio | BT audio receiver → I2S DAC → wired speakers |

## Codec Negotiation

During A2DP connection setup, the source and sink negotiate a codec. Both devices advertise their supported codecs, and the highest-quality mutually supported codec is selected:

| Codec | Mandatory? | Bitrate | Quality | Latency | MCU Encoding Cost |
|---|---|---|---|---|---|
| SBC | Yes (mandatory) | 198–345 kbps | Good | ~100 ms | Low (~5 MHz) |
| AAC | Optional | 256 kbps | Better | ~150 ms | High (~30 MHz) |
| aptX | Optional (Qualcomm) | 352 kbps | Better | ~70 ms | Not available on ESP32 |
| LDAC | Optional (Sony) | 330–990 kbps | Best | ~200 ms | Available on ESP32 (ESP-IDF 5.x) |

SBC is the only codec guaranteed to be supported by all A2DP devices. Most Bluetooth headphones and speakers support SBC and AAC; aptX and LDAC support varies by device and manufacturer.

### SBC Encoding Parameters

SBC (Sub-Band Codec) divides the audio into sub-bands and encodes each band independently. Configuration parameters affect quality:

| Parameter | Options | Typical for High Quality |
|---|---|---|
| Sample rate | 16, 32, 44.1, 48 kHz | 44.1 kHz |
| Channel mode | Mono, Dual, Stereo, Joint Stereo | Joint Stereo |
| Block length | 4, 8, 12, 16 | 16 |
| Sub-bands | 4, 8 | 8 |
| Allocation method | SNR, Loudness | Loudness |
| Bitpool | 2–53 | 35–53 (quality vs bitrate) |

The **bitpool** parameter is the primary quality control: higher bitpool = higher bitrate = better quality. A bitpool of 53 (maximum for Joint Stereo) produces ~345 kbps, approaching transparent quality for most content. Many devices negotiate a lower bitpool (35–40) by default to reduce Bluetooth bandwidth and improve robustness.

## A2DP Source Implementation (ESP32)

An A2DP source reads audio data (from I2S, SD card, or internal synthesis) and streams it to a connected Bluetooth speaker or headphones:

```c
#include "esp_a2dp_api.h"
#include "esp_avrc_api.h"

/* Audio data callback — called by the stack when it needs audio data */
static int32_t bt_audio_data_cb(uint8_t *data, int32_t len)
{
    /* Fill 'data' with signed 16-bit stereo PCM, interleaved L/R */
    /* 'len' is in bytes; return the number of bytes written */
    size_t samples = len / sizeof(int16_t);
    int16_t *pcm = (int16_t *)data;

    /* Example: read from I2S input */
    size_t bytes_read;
    i2s_channel_read(i2s_rx_handle, pcm, len, &bytes_read, pdMS_TO_TICKS(10));
    return bytes_read;
}

/* A2DP event handler */
static void a2dp_source_cb(esp_a2d_cb_event_t event, esp_a2d_cb_param_t *param)
{
    switch (event) {
    case ESP_A2D_CONNECTION_STATE_EVT:
        if (param->conn_stat.state == ESP_A2D_CONNECTION_STATE_CONNECTED) {
            esp_a2d_media_ctrl(ESP_A2D_MEDIA_CTRL_START);
        }
        break;
    case ESP_A2D_AUDIO_STATE_EVT:
        /* Audio streaming started/stopped/suspended */
        break;
    default:
        break;
    }
}

void a2dp_source_init(void)
{
    esp_a2d_source_register_data_callback(bt_audio_data_cb);
    esp_a2d_register_callback(a2dp_source_cb);
    esp_a2d_source_init();

    /* Connect to a known device (or discover first) */
    esp_a2d_source_connect(peer_bda);  /* peer_bda = 6-byte BT address */
}
```

The stack calls `bt_audio_data_cb` from a Bluetooth task context. The callback should return data quickly (within a few milliseconds) — blocking for too long causes the audio stream to stutter. Pre-buffering audio data in a FreeRTOS queue or ring buffer decouples the audio source from the Bluetooth timing.

## A2DP Sink Implementation (ESP32)

An A2DP sink receives audio from a phone or other source and outputs it through I2S to a DAC or codec:

```c
/* A2DP sink data callback — receives decoded PCM audio */
static void a2dp_sink_data_cb(const uint8_t *data, uint32_t len)
{
    /* 'data' contains signed 16-bit stereo PCM, interleaved L/R */
    /* Write to I2S output */
    size_t bytes_written;
    i2s_channel_write(i2s_tx_handle, data, len, &bytes_written, pdMS_TO_TICKS(10));
}

static void a2dp_sink_cb(esp_a2d_cb_event_t event, esp_a2d_cb_param_t *param)
{
    switch (event) {
    case ESP_A2D_CONNECTION_STATE_EVT:
        /* Handle connect/disconnect */
        break;
    case ESP_A2D_AUDIO_CFG_EVT:
        /* Codec configuration — sample rate and channel mode */
        /* Reconfigure I2S to match */
        break;
    default:
        break;
    }
}

void a2dp_sink_init(void)
{
    esp_a2d_sink_register_data_callback(a2dp_sink_data_cb);
    esp_a2d_register_callback(a2dp_sink_cb);
    esp_a2d_sink_init();

    /* Make device discoverable so phone can connect */
    esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
}
```

## I2S-to-A2DP Pipeline

A complete audio pipeline from I2S input (e.g., codec IC capturing from a microphone) to A2DP output involves:

```
I2S Codec → DMA → Ring Buffer → A2DP Source Callback → SBC Encoder → BT Radio
```

The ring buffer absorbs the timing difference between I2S (running at a precise crystal-locked rate) and the Bluetooth stack (which requests data at variable intervals dictated by the Bluetooth scheduler). A ring buffer of 4–8 audio frames (20–40 ms of audio) typically provides sufficient margin.

```c
/* Ring buffer between I2S and A2DP */
static RingbufHandle_t audio_ringbuf;

void i2s_read_task(void *param)
{
    int16_t buf[512];
    size_t bytes_read;
    for (;;) {
        i2s_channel_read(i2s_rx_handle, buf, sizeof(buf),
                          &bytes_read, portMAX_DELAY);
        xRingbufferSend(audio_ringbuf, buf, bytes_read, portMAX_DELAY);
    }
}

static int32_t bt_audio_data_cb(uint8_t *data, int32_t len)
{
    size_t item_size;
    void *item = xRingbufferReceive(audio_ringbuf, &item_size, pdMS_TO_TICKS(5));
    if (item) {
        size_t copy_len = (item_size < len) ? item_size : len;
        memcpy(data, item, copy_len);
        vRingbufferReturnItem(audio_ringbuf, item);
        return copy_len;
    }
    memset(data, 0, len);  /* Underrun — send silence */
    return len;
}
```

## Buffer Management for Continuous Playback

A2DP audio quality depends on a steady stream of data to the encoder. Gaps in the data produce silence or artifacts in the output. The Bluetooth scheduler requests data in bursts — several frames may be requested in rapid succession, followed by a pause. The ring buffer must absorb these bursts.

| Buffer Size | Duration (44.1 kHz stereo) | Trade-Off |
|---|---|---|
| 2 KB | ~11 ms | Tight — may underrun during BT scheduling jitter |
| 8 KB | ~45 ms | Safe for most conditions |
| 16 KB | ~90 ms | Robust, handles WiFi coexistence |
| 32 KB | ~181 ms | Excessive for most applications |

## Tips

- Handle the `ESP_A2D_AUDIO_CFG_EVT` event in the sink callback to dynamically configure I2S for the negotiated sample rate. Most phones stream at 44.1 kHz, but some devices use 48 kHz.
- For A2DP source, start the audio stream only after receiving `ESP_A2D_AUDIO_STATE_EVT` with state `STARTED` — sending data before the stream is established is silently discarded.
- Store the last-connected device's Bluetooth address in NVS (non-volatile storage) and attempt reconnection on boot. This avoids the slow discovery process for known devices.

## Caveats

- A2DP adds 100–200 ms of end-to-end latency (encoding + Bluetooth buffering + decoding in the headphone). This is acceptable for music but noticeable for video synchronization or real-time monitoring. There is no mechanism to reduce this latency within A2DP — it is inherent to the protocol.
- SBC encoding quality varies by bitpool. The ESP-IDF A2DP source defaults to a moderate bitpool. Increasing the bitpool in the SBC configuration improves quality but may cause dropouts on congested Bluetooth channels.
- Some Bluetooth speakers and headphones disconnect after 10–30 seconds of silence. Sending a low-level noise signal during pauses (comfort noise) prevents automatic disconnection.

## In Practice

- **Audio stutters or breaks up every few seconds** — the A2DP data callback is not being serviced quickly enough, or the ring buffer is undersized. If WiFi is active simultaneously, Bluetooth/WiFi coexistence contention is often the cause. Increasing the ring buffer and adjusting coexistence parameters (`esp_coex_preference_set(ESP_COEX_PREFER_BT)`) improves stability.
- **Audio quality is noticeably poor (metallic, artifacts)** — SBC encoding at a low bitpool. Check the negotiated codec parameters in the `ESP_A2D_AUDIO_CFG_EVT` callback. If the bitpool is below 30, the connected device is requesting low-quality encoding. Some devices negotiate a higher bitpool after the initial connection.
- **A2DP sink receives audio but at the wrong sample rate** — the I2S peripheral is configured for 48 kHz but the phone is streaming at 44.1 kHz. Handling the `ESP_A2D_AUDIO_CFG_EVT` event and reconfiguring I2S to match the reported sample rate resolves the pitch shift.
