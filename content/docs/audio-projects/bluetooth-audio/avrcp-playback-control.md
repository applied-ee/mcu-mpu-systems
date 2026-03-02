---
title: "AVRCP Playback Control"
weight: 40
---

# AVRCP Playback Control

AVRCP (Audio/Video Remote Control Profile) provides the control channel that accompanies A2DP audio streaming. While A2DP handles the audio data, AVRCP handles play/pause, next/previous track, volume adjustment, and track metadata (title, artist, album). Every Bluetooth speaker and headphone uses AVRCP alongside A2DP — the play/pause button on a headphone sends an AVRCP command to the phone, and the track name displayed on a car stereo arrives via AVRCP metadata notifications.

## Roles

| Role | Function | Typical Device | AVRCP Abbreviation |
|---|---|---|---|
| Controller (CT) | Sends commands, receives metadata | Headphone, car stereo, ESP32 (sink) | CT |
| Target (TG) | Receives commands, provides metadata | Phone, media player, ESP32 (source) | TG |

An ESP32 acting as an A2DP sink (receiving audio from a phone) typically also acts as an AVRCP controller — sending play/pause commands to the phone and receiving track metadata. An ESP32 acting as an A2DP source typically acts as an AVRCP target — receiving play/pause commands from the headphone and providing track metadata.

## Transport Controls

AVRCP defines standard transport control commands (passthrough commands):

| Command | Key ID | Description |
|---|---|---|
| Play | 0x44 | Start or resume playback |
| Pause | 0x46 | Pause playback |
| Stop | 0x45 | Stop playback |
| Forward | 0x4B | Next track |
| Backward | 0x4C | Previous track |
| Fast Forward | 0x49 | Seek forward (press and hold) |
| Rewind | 0x48 | Seek backward (press and hold) |
| Volume Up | 0x41 | Increase volume |
| Volume Down | 0x42 | Decrease volume |

### Sending Commands (Controller Role)

```c
#include "esp_avrc_api.h"

void avrcp_play(void)
{
    esp_avrc_ct_send_passthrough_cmd(0, ESP_AVRC_PT_CMD_PLAY,
                                     ESP_AVRC_PT_CMD_STATE_PRESSED);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_avrc_ct_send_passthrough_cmd(0, ESP_AVRC_PT_CMD_PLAY,
                                     ESP_AVRC_PT_CMD_STATE_RELEASED);
}

void avrcp_next_track(void)
{
    esp_avrc_ct_send_passthrough_cmd(0, ESP_AVRC_PT_CMD_FORWARD,
                                     ESP_AVRC_PT_CMD_STATE_PRESSED);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_avrc_ct_send_passthrough_cmd(0, ESP_AVRC_PT_CMD_FORWARD,
                                     ESP_AVRC_PT_CMD_STATE_RELEASED);
}
```

Each passthrough command requires a press-and-release sequence. Sending only the press without the release can cause unexpected behavior on some phones (continuous fast-forward, stuck button state).

## Track Metadata

AVRCP 1.3+ supports metadata retrieval through the "Get Element Attributes" command. The controller requests metadata, and the target responds with text attributes:

| Attribute ID | Name | Example |
|---|---|---|
| 0x01 | Title | "Bohemian Rhapsody" |
| 0x02 | Artist | "Queen" |
| 0x03 | Album | "A Night at the Opera" |
| 0x04 | Track Number | "11" |
| 0x05 | Total Tracks | "12" |
| 0x06 | Genre | "Rock" |
| 0x07 | Playing Time (ms) | "354000" |

### Receiving Metadata on ESP32 (Controller Role)

```c
static void avrc_ct_cb(esp_avrc_ct_cb_event_t event,
                        esp_avrc_ct_cb_param_t *param)
{
    switch (event) {
    case ESP_AVRC_CT_METADATA_RSP_EVT: {
        uint8_t attr_id = param->meta_rsp.attr_id;
        char *text = (char *)param->meta_rsp.attr_text;

        switch (attr_id) {
        case ESP_AVRC_MD_ATTR_TITLE:
            printf("Title: %s\n", text);
            break;
        case ESP_AVRC_MD_ATTR_ARTIST:
            printf("Artist: %s\n", text);
            break;
        case ESP_AVRC_MD_ATTR_ALBUM:
            printf("Album: %s\n", text);
            break;
        }
        break;
    }
    case ESP_AVRC_CT_PLAY_STATUS_RSP_EVT:
        /* Playback position, duration, play status */
        break;

    case ESP_AVRC_CT_CHANGE_NOTIFY_EVT:
        /* Track change, playback status change, volume change */
        handle_notification(param);
        break;

    default:
        break;
    }
}

void avrcp_controller_init(void)
{
    esp_avrc_ct_register_callback(avrc_ct_cb);
    esp_avrc_ct_init();
}

/* Request metadata for the currently playing track */
void request_track_metadata(void)
{
    esp_avrc_ct_send_metadata_cmd(0,
        ESP_AVRC_MD_ATTR_TITLE |
        ESP_AVRC_MD_ATTR_ARTIST |
        ESP_AVRC_MD_ATTR_ALBUM);
}
```

## Notification Events

AVRCP supports change notifications — the target asynchronously informs the controller when the playback state changes. This eliminates the need for polling.

| Notification Event | Description |
|---|---|
| `PLAYBACK_STATUS_CHANGED` | Play, pause, stop, forward seek, reverse seek |
| `TRACK_CHANGED` | New track started |
| `PLAY_POS_CHANGED` | Playback position update (periodic) |
| `BATTERY_STATUS_CHANGED` | Remote device battery level |
| `VOLUME_CHANGED` | Remote volume adjusted |

### Registering for Notifications

```c
/* Register for track change and playback status notifications */
void register_notifications(void)
{
    esp_avrc_ct_send_register_notification_cmd(0,
        ESP_AVRC_RN_TRACK_CHANGE, 0);
    esp_avrc_ct_send_register_notification_cmd(1,
        ESP_AVRC_RN_PLAY_STATUS_CHANGE, 0);
    esp_avrc_ct_send_register_notification_cmd(2,
        ESP_AVRC_RN_PLAY_POS_CHANGED, 10);  /* Every 10 seconds */
}

static void handle_notification(esp_avrc_ct_cb_param_t *param)
{
    switch (param->change_ntf.event_id) {
    case ESP_AVRC_RN_TRACK_CHANGE:
        /* Track changed — request new metadata */
        request_track_metadata();
        /* Re-register for next track change */
        esp_avrc_ct_send_register_notification_cmd(0,
            ESP_AVRC_RN_TRACK_CHANGE, 0);
        break;

    case ESP_AVRC_RN_PLAY_STATUS_CHANGE:
        /* Playback started/paused/stopped */
        uint8_t status = param->change_ntf.event_parameter.playback;
        /* Re-register for next change */
        esp_avrc_ct_send_register_notification_cmd(1,
            ESP_AVRC_RN_PLAY_STATUS_CHANGE, 0);
        break;
    }
}
```

Notification registration is one-shot — after receiving a notification, the controller must re-register to receive the next one. Forgetting to re-register causes the controller to miss subsequent events.

## Absolute Volume Control

AVRCP 1.4+ introduced absolute volume — a synchronized volume level (0–127) between the controller and target. This enables the phone to display the headphone's volume level and the headphone to display the phone's volume level.

```c
/* Handle absolute volume change from phone */
case ESP_AVRC_CT_CHANGE_NOTIFY_EVT:
    if (param->change_ntf.event_id == ESP_AVRC_RN_VOLUME_CHANGE) {
        uint8_t volume = param->change_ntf.event_parameter.volume;
        /* volume is 0–127; map to application volume */
        set_output_volume(volume * 100 / 127);
    }
    break;

/* Set volume from ESP32 side */
void set_remote_volume(uint8_t volume_0_127)
{
    esp_avrc_ct_send_set_absolute_volume_cmd(0, volume_0_127);
}
```

## AVRCP + A2DP Integration

In a typical Bluetooth audio project, AVRCP and A2DP are initialized together and share the same Bluetooth connection:

```c
void bluetooth_audio_init(void)
{
    /* Initialize Bluetooth stack */
    bt_classic_init();

    /* A2DP sink — receive audio */
    esp_a2d_sink_register_data_callback(a2dp_data_cb);
    esp_a2d_register_callback(a2dp_cb);
    esp_a2d_sink_init();

    /* AVRCP controller — send commands, receive metadata */
    esp_avrc_ct_register_callback(avrc_ct_cb);
    esp_avrc_ct_init();

    /* Make discoverable */
    esp_bt_gap_set_scan_mode(ESP_BT_CONNECTABLE, ESP_BT_GENERAL_DISCOVERABLE);
    esp_bt_dev_set_device_name("ESP32 Speaker");
}
```

When a phone connects, both A2DP and AVRCP connections are typically established automatically. The A2DP connection carries audio data; the AVRCP connection carries control commands and metadata. Physical buttons on the ESP32 device (GPIO inputs) trigger AVRCP passthrough commands to control playback on the phone.

## Tips

- Re-register notifications immediately in the notification callback — the one-shot nature means any delay between receiving a notification and re-registering creates a window where events are missed.
- Request metadata after receiving a track change notification rather than polling. Polling wastes Bluetooth bandwidth and may not reflect the current track due to timing issues.
- Implement volume synchronization with absolute volume (AVRCP 1.4) when the remote device supports it. Without absolute volume, the phone's volume and the device's volume are independent, leading to unexpected loudness changes.

## Caveats

- Not all phones expose all metadata fields. Some streaming apps do not provide album art or track number through AVRCP. The controller should handle missing metadata gracefully (display "Unknown" or omit the field).
- AVRCP passthrough commands require the press-release sequence to complete within a timeout (typically 2 seconds). If the release is delayed beyond the timeout, some phones interpret it as a long-press (e.g., fast-forward instead of next track).
- AVRCP version differences between devices can cause feature mismatches. An ESP32 advertising AVRCP 1.6 features to a phone that only supports AVRCP 1.3 may fail to negotiate metadata or notification features. Checking the remote device's supported features during connection is good practice.

## In Practice

- **Play/pause button works but next/previous track does not** — the phone may not support passthrough commands for forward/backward in the current media app. Some apps handle AVRCP transport controls inconsistently, or the phone's AVRCP implementation does not forward these commands to the active media session.
- **Track metadata updates are delayed or show the previous track** — notification re-registration is delayed, or the metadata request is sent before the phone has updated its internal state. Adding a small delay (200–500 ms) between the track change notification and the metadata request allows the phone to update.
- **Volume jumps to maximum or minimum unexpectedly** — an absolute volume mismatch. The phone sends a volume level (0–127) that the ESP32 maps to its local volume range. If the mapping is incorrect or the initial volume synchronization is not performed, the first volume adjustment from the phone applies a level that does not match the user's expectation.
