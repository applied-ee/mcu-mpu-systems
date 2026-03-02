---
title: "Station Mode & Connection Management"
weight: 20
---

# Station Mode & Connection Management

Station mode (STA) is the most common WiFi operating mode for embedded devices — the MCU acts as a client connecting to an existing access point, just like a laptop or phone. The engineering challenge is not the initial connection but everything that follows: handling disconnections gracefully, reconnecting without user intervention, adapting to changing RF conditions, and managing the connection lifecycle across power states. A device that connects once on the bench is a demo. A device that maintains connectivity through AP reboots, channel changes, signal fading, and DHCP lease renewals over months of unattended operation is a product.

## Connection Lifecycle

The STA connection lifecycle is a state machine with more failure paths than success paths. Robust firmware must handle every transition, including the unexpected ones.

**Idle** — WiFi radio is initialized but not connected. The driver is loaded, MAC address is configured, and the radio is ready to scan. Power consumption is low (modem-sleep baseline or deep-sleep if the radio is fully powered down).

**Scanning** — The station sweeps channels looking for the target SSID. Active scanning sends probe requests and listens for probe responses (~100 ms per channel). Passive scanning listens for beacons (~110 ms per channel, one beacon interval). A full 13-channel active scan takes 1.3–2.0 seconds. Targeted scanning on a known channel (if cached from last connection) takes 100–200 ms.

**Authenticating** — Open System authentication exchange (two frames). Rarely fails unless the AP is overloaded or out of association slots.

**Associating** — The station negotiates capabilities with the AP. Failures here indicate capability mismatches (e.g., the AP requires WPA3 but the station only supports WPA2) or the AP has reached its maximum client count.

**Key Exchange** — The WPA2 4-way handshake or WPA3 SAE exchange. Wrong-password failures appear at this stage, typically as a timeout or explicit HANDSHAKE_TIMEOUT event. The PSK is never transmitted — both sides derive the PMK independently, so a mismatch results in key-confirmation failure on EAPOL message 3/4 or 4/4.

**Acquiring IP** — DHCP Discover → Offer → Request → Ack. Failures include no DHCP server responding (static route misconfiguration, DHCP server crash), lease exhaustion, or DHCP relay failures in enterprise networks. A static IP configuration bypasses this stage entirely.

**Connected** — Data frames flow. The station monitors beacon reception, responds to AP-initiated rekeys (group key rotation every 1–24 hours depending on AP configuration), and renews DHCP leases (typically every 1–24 hours, with renewal attempted at 50% of lease time).

**Disconnected** — Triggered by beacon loss, AP deauthentication frame, authentication timeout during rekey, or explicit disconnect call. The disconnect reason code identifies the cause.

## Scanning

Scanning is the first step in connection and also used for RSSI monitoring, channel selection, and AP discovery for roaming. The two scan types have different trade-offs.

| Scan Type | Duration per Channel | Power Draw | Detects Hidden SSIDs | Use Case |
|-----------|---------------------|------------|---------------------|----------|
| Active | 100–120 ms | High (TX + RX) | Yes (directed probe) | Fast connection, provisioning UI |
| Passive | 100–110 ms (1 beacon interval) | Medium (RX only) | No | DFS channels, low-power scanning |

**Active scanning** transmits a probe request frame (either broadcast or directed to a specific SSID) on each channel and collects probe responses. This is faster because the AP responds immediately rather than waiting for the next beacon interval. It also discovers hidden SSIDs (APs configured to omit their SSID from beacons) when a directed probe is used.

**Passive scanning** only listens. The station dwells on each channel for at least one beacon interval (typically 100 ms) and records any beacons received. Required on DFS channels in the 5 GHz band where transmitting before listening is prohibited. Also useful for reducing power consumption during background scans while connected.

On ESP-IDF, the scan API provides both modes:

```c
wifi_scan_config_t scan_config = {
    .ssid = (uint8_t *)"MyNetwork",    // NULL for broadcast scan
    .bssid = NULL,                      // NULL for any BSSID
    .channel = 0,                       // 0 = all channels
    .show_hidden = true,                // Include hidden SSIDs
    .scan_type = WIFI_SCAN_TYPE_ACTIVE,
    .scan_time = {
        .active = {
            .min = 100,   // ms per channel minimum
            .max = 300    // ms per channel maximum
        }
    }
};
esp_wifi_scan_start(&scan_config, true);  // true = blocking
```

After a scan completes, results are retrieved as an array of `wifi_ap_record_t` entries, each containing the BSSID, SSID, channel, RSSI, and security type. Sorting by RSSI helps select the strongest AP when multiple APs share the same SSID (enterprise deployments).

## ESP-IDF Event-Driven Connection

ESP-IDF uses a publish-subscribe event system for WiFi state management. The application registers handlers for specific events and responds to state transitions asynchronously. This is the recommended pattern for production firmware.

```c
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"

static const char *TAG = "wifi_sta";
static int s_retry_count = 0;
#define MAX_RETRY 10
#define BASE_RETRY_DELAY_MS 1000

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT) {
        switch (event_id) {
        case WIFI_EVENT_STA_START:
            ESP_LOGI(TAG, "STA started, initiating connection");
            esp_wifi_connect();
            break;

        case WIFI_EVENT_STA_CONNECTED:
            ESP_LOGI(TAG, "Associated with AP, awaiting IP");
            s_retry_count = 0;
            break;

        case WIFI_EVENT_STA_DISCONNECTED: {
            wifi_event_sta_disconnected_t *event =
                (wifi_event_sta_disconnected_t *)event_data;
            ESP_LOGW(TAG, "Disconnected, reason=%d (ssid=%s)",
                     event->reason, event->ssid);

            if (s_retry_count < MAX_RETRY) {
                /* Exponential backoff: 1s, 2s, 4s, 8s... capped at 60s */
                uint32_t delay_ms = BASE_RETRY_DELAY_MS << s_retry_count;
                if (delay_ms > 60000) delay_ms = 60000;

                ESP_LOGI(TAG, "Retry %d/%d in %lu ms",
                         s_retry_count + 1, MAX_RETRY, delay_ms);
                vTaskDelay(pdMS_TO_TICKS(delay_ms));
                esp_wifi_connect();
                s_retry_count++;
            } else {
                ESP_LOGE(TAG, "Max retries reached, signaling failure");
                /* Signal application layer — e.g., set event group bit,
                   enter provisioning mode, or schedule deep-sleep */
            }
            break;
        }
        default:
            break;
        }
    } else if (event_base == IP_EVENT) {
        switch (event_id) {
        case IP_EVENT_STA_GOT_IP: {
            ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
            ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
            s_retry_count = 0;
            /* Signal application layer — connection is fully usable */
            break;
        }
        case IP_EVENT_STA_LOST_IP:
            ESP_LOGW(TAG, "Lost IP address");
            /* DHCP lease expired or renewal failed.
               WiFi may still be associated — attempt DHCP restart. */
            break;
        default:
            break;
        }
    }
}

void wifi_sta_init(const char *ssid, const char *password)
{
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);

    esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                        &wifi_event_handler, NULL, NULL);
    esp_event_handler_instance_register(IP_EVENT, ESP_EVENT_ANY_ID,
                                        &wifi_event_handler, NULL, NULL);

    wifi_config_t wifi_config = { 0 };
    strncpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid));
    strncpy((char *)wifi_config.sta.password, password,
            sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    wifi_config.sta.sae_pwe_h2e = WPA3_SAE_PWE_BOTH;

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_start();  /* Triggers WIFI_EVENT_STA_START → connect */
}
```

Key disconnect reason codes to log and handle:

| Reason Code | ESP-IDF Constant | Meaning | Typical Cause |
|-------------|-----------------|---------|--------------|
| 2 | `WIFI_REASON_AUTH_EXPIRE` | Auth expired | AP rebooted, session timeout |
| 3 | `WIFI_REASON_AUTH_LEAVE` | Deauthenticated (leaving) | AP shutting down cleanly |
| 6 | `WIFI_REASON_CLASS2_FRAME_FROM_NONAUTH_STA` | Class 2 frame error | AP lost session state |
| 7 | `WIFI_REASON_CLASS3_FRAME_FROM_NONASSOC_STA` | Class 3 frame error | AP lost association state |
| 8 | `WIFI_REASON_ASSOC_LEAVE` | Disassociated (leaving) | AP deassociated the station |
| 15 | `WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT` | 4-way HS timeout | Wrong password, AP busy |
| 200 | `WIFI_REASON_BEACON_TIMEOUT` | Beacon loss | Signal degradation, AP crash |
| 201 | `WIFI_REASON_NO_AP_FOUND` | AP not found | AP offline, wrong SSID |
| 202 | `WIFI_REASON_AUTH_FAIL` | Authentication failure | Wrong password (WPA3) |

## Reconnection Strategies

A robust reconnection strategy balances responsiveness (reconnect fast when the AP returns) against resource waste (do not drain the battery probing for an AP that has been removed). Three common patterns address different deployment scenarios.

### Immediate Retry

The simplest approach: call `esp_wifi_connect()` immediately upon disconnection. Suitable for always-powered devices on a stable network where disconnections are rare and transient (AP firmware update, momentary interference).

- **Pro**: Fastest reconnection (~1–3 seconds if AP is available).
- **Con**: Burns current continuously if AP is down. Can flood the AP with association requests during a congested period, worsening the problem.

### Exponential Backoff

Each successive retry doubles the delay between attempts, typically capped at a maximum interval.

```
Retry 1:   1 second delay
Retry 2:   2 seconds
Retry 3:   4 seconds
Retry 4:   8 seconds
Retry 5:  16 seconds
Retry 6:  32 seconds
Retry 7+: 60 seconds (cap)
```

This is the standard production pattern. After the cap is reached, retries continue at the cap interval indefinitely (or until a maximum retry count triggers a fallback — entering provisioning mode, signaling a hardware watchdog, or entering deep sleep).

Adding jitter (random 0–25% of the delay) prevents synchronized reconnection storms when multiple devices lose connection simultaneously (e.g., after an AP reboot). Without jitter, 50 devices all reconnecting at exactly the same intervals can overwhelm the AP's association capacity.

### Credential Rotation

For devices that store multiple WiFi credentials (home network + mobile hotspot fallback, or primary + backup SSID), credential rotation attempts each stored credential set after the primary fails:

1. Try primary SSID with exponential backoff (3–5 attempts).
2. Scan for all known SSIDs.
3. Connect to the strongest available known network.
4. If no known networks found, enter provisioning mode (SoftAP captive portal).

This pattern is essential for consumer devices that may be moved between locations or where the home network SSID changes.

## RSSI Thresholds

RSSI (Received Signal Strength Indicator) is reported in dBm and provides a rough measure of signal quality. The values are negative — closer to zero means stronger signal.

| RSSI Range | Quality | Typical Behavior | Recommended Action |
|------------|---------|-----------------|-------------------|
| -30 to -50 dBm | Excellent | Max throughput, minimal retries | None needed |
| -50 to -60 dBm | Good | Near-max throughput, rare retries | Normal operation |
| -60 to -70 dBm | Fair | Reduced throughput (50–80% of max), occasional retries | Log warnings, consider rate adaptation |
| -70 to -80 dBm | Marginal | Significant throughput reduction, frequent retries | Trigger roaming scan, reduce TX data rate |
| -80 to -90 dBm | Poor | Intermittent connectivity, high packet loss | Active roaming or disconnect/reconnect |
| Below -90 dBm | Unusable | Connection drops, association failures | AP out of range |

RSSI is queried differently on each platform:

**ESP-IDF:**
```c
wifi_ap_record_t ap_info;
esp_wifi_sta_get_ap_info(&ap_info);
int8_t rssi = ap_info.rssi;  /* dBm, updated every ~1 second */
```

**Pico W (CYW43):**
```c
int32_t rssi;
cyw43_wifi_get_rssi(&cyw43_state, &rssi);
```

RSSI-based roaming is relevant in deployments with multiple APs sharing the same SSID. The firmware periodically checks RSSI and, if it drops below a threshold (e.g., -75 dBm), initiates a background scan for a stronger AP on the same SSID. If found, the station deauthenticates from the current AP and reassociates with the stronger one. This requires storing the BSSID of the current AP to avoid reconnecting to the same one.

## Connection Timing Breakdown

Understanding where time goes during the connection process helps set appropriate timeouts and user expectations.

| Stage | Typical Duration | Worst Case | Notes |
|-------|-----------------|------------|-------|
| Channel scan (all 13) | 1.3–2.0 s (active) | 3–5 s (passive) | Targeted single-channel scan: 100–200 ms |
| Authentication | 5–20 ms | 200 ms | Timeout indicates AP overload |
| Association | 5–20 ms | 200 ms | Capability mismatch causes immediate reject |
| WPA2 4-way handshake | 20–50 ms | 500 ms | Timeout = wrong password (most common) |
| WPA3 SAE exchange | 50–200 ms | 1 s | Computationally heavier than WPA2 |
| DHCP | 50–200 ms | 5 s | Server dependent; static IP skips this |
| **Total** | **1.5–3.0 s** | **5–10 s** | First connection after boot |

For reconnection to a known AP (cached channel and BSSID), the scan phase drops to 100–200 ms, bringing total reconnection time to 0.5–1.5 seconds.

## Multi-Credential Management

Production devices often need to store and manage multiple WiFi credentials. Common storage patterns:

**ESP32 NVS (Non-Volatile Storage):**
```c
#define MAX_STORED_NETWORKS 5

typedef struct {
    char ssid[33];
    char password[65];
    int8_t last_rssi;
    uint32_t last_connected;  /* Unix timestamp */
    uint16_t connect_failures;
} stored_network_t;

/* Store to NVS */
nvs_handle_t nvs;
nvs_open("wifi_creds", NVS_READWRITE, &nvs);
nvs_set_blob(nvs, "networks", networks, sizeof(networks));
nvs_commit(nvs);
nvs_close(nvs);
```

**Priority selection algorithm:**
1. Scan for visible networks.
2. Match against stored credentials.
3. Sort matches by: (a) last successful connection time, (b) current RSSI, (c) failure count (fewer = higher priority).
4. Attempt connection to highest-priority match.
5. On failure, increment failure count and try next match.

## ATWINC1500 Callback Model

The ATWINC1500 network coprocessor uses a callback-driven model through the host SPI interface. The host MCU sends commands and registers callbacks for asynchronous events:

```c
#include "m2m_wifi.h"

static void wifi_callback(uint8_t msg_type, void *msg_data)
{
    switch (msg_type) {
    case M2M_WIFI_RESP_CON_STATE_CHANGED: {
        tstrM2mWifiStateChanged *state =
            (tstrM2mWifiStateChanged *)msg_data;
        if (state->u8CurrState == M2M_WIFI_CONNECTED) {
            /* Associated — request IP via DHCP */
            m2m_wifi_request_dhcp_client();
        } else if (state->u8CurrState == M2M_WIFI_DISCONNECTED) {
            /* Disconnected — schedule reconnect */
        }
        break;
    }
    case M2M_WIFI_REQ_DHCP_CONF: {
        uint8_t *ip = (uint8_t *)msg_data;
        /* IP address assigned — connection fully up */
        break;
    }
    }
}

/* In main loop — must be called regularly */
while (1) {
    m2m_wifi_handle_events(NULL);  /* Polls SPI, dispatches callbacks */
}
```

The polling model requires that `m2m_wifi_handle_events()` is called frequently (every 1–10 ms). Blocking operations in the main loop or long interrupt handlers delay event processing and can cause missed responses or timeouts.

## Pico W Polling Model

The Pico W CYW43 driver uses a polling architecture. WiFi events are processed by calling `cyw43_arch_poll()` regularly in the main loop or by using the threadsafe background mode with `pico_cyw43_arch_threadsafe_background`:

```c
#include "pico/cyw43_arch.h"

/* Blocking connect with timeout */
int result = cyw43_arch_wifi_connect_timeout_ms(
    "MyNetwork",
    "MyPassword",
    CYW43_AUTH_WPA2_AES_PSK,
    30000   /* 30-second timeout */
);

if (result != 0) {
    /* Connection failed — result contains error code */
    printf("WiFi connect failed: %d\n", result);
}

/* Check link status in main loop */
while (1) {
    int link_status = cyw43_tcpip_link_status(&cyw43_state,
                                               CYW43_ITF_STA);
    switch (link_status) {
    case CYW43_LINK_UP:
        /* Connected with IP */
        break;
    case CYW43_LINK_DOWN:
        /* Not connected — trigger reconnect */
        break;
    case CYW43_LINK_JOIN:
        /* Associated but no IP yet */
        break;
    case CYW43_LINK_FAIL:
        /* Connection failed */
        break;
    case CYW43_LINK_NONET:
        /* Connected but no network (no DHCP response) */
        break;
    }
    /* Application work here */
    cyw43_arch_poll();  /* Process WiFi events */
    sleep_ms(100);
}
```

The Pico W lacks automatic reconnection — the application must detect `CYW43_LINK_DOWN` and explicitly re-initiate connection. Implementing a reconnection timer using a repeating alarm or a FreeRTOS task is the standard approach.

## Tips

- Always log the disconnect reason code. On ESP-IDF, the `wifi_event_sta_disconnected_t` structure provides the 802.11 reason code that distinguishes between AP-initiated deauth, beacon loss, authentication failure, and other causes. Without this, debugging field disconnections is guesswork.
- Cache the last-known good channel and BSSID. On reconnection, attempt a targeted scan on the cached channel first (100–200 ms) before falling back to a full scan (1.5–3 seconds). ESP-IDF supports setting `wifi_config.sta.channel` and `wifi_config.sta.bssid` for targeted reconnection.
- Add jitter to reconnection backoff timers. When an AP reboots, all associated stations disconnect simultaneously. Without jitter, all stations retry at the same intervals, creating periodic association storms that can prevent any station from successfully connecting.
- Set the DHCP hostname before connecting. Many DHCP servers and routers display the hostname in their client list, making device identification vastly easier during development and deployment. On ESP-IDF: `esp_netif_set_hostname(sta_netif, "sensor-kitchen-01")`.
- Monitor free heap after connection. A fully connected ESP32 with WiFi + LWIP + a single TLS socket typically consumes 90–120 KB of heap. If the application needs more, reduce TLS buffer sizes, disable WiFi scan memory caching (`CONFIG_ESP32_WIFI_SCAN_MAX_AP`), or use the external PSRAM.

## Caveats

- **DHCP lease renewal failures are silent until they are not** — LWIP handles DHCP renewals automatically, but if the DHCP server is temporarily unreachable at renewal time (50% of lease), the lease expires and the IP address is released. The station remains associated to the AP but cannot communicate. Monitoring the `IP_EVENT_STA_LOST_IP` event is essential.
- **Beacon loss threshold tuning is a double-edged sword** — Increasing the beacon loss count (e.g., from 7 to 20) reduces false disconnections in noisy environments but delays detection of a genuinely failed AP by 2–3 seconds. Decreasing it causes frequent unnecessary disconnection events on marginal links.
- **Background scanning while connected causes brief data interruptions** — When the station leaves its current channel to scan another channel, it misses any frames sent during that off-channel dwell. For latency-sensitive applications (voice, real-time control), disable background scanning or restrict it to low-activity periods.
- **Some consumer routers deauthenticate idle clients aggressively** — Cheap home routers with limited client tables may disconnect stations that have not sent data frames recently (despite keepalive frames at the 802.11 level). Sending periodic application-layer traffic (an MQTT ping, an NTP query) at 30–60 second intervals prevents this.
- **Static IP configuration saves 100–300 ms but creates address conflicts if two devices share the same IP** — Static IP is appropriate for controlled deployments (factory floor, dedicated test benches) but not for consumer products where the network configuration is unknown.

## In Practice

- A device that reconnects to the wrong AP (same SSID, weaker signal) after a disconnection is not clearing its BSSID filter. Setting the BSSID to all-zeros before reconnection allows the driver to choose the strongest AP. Conversely, locking to a specific BSSID prevents roaming — appropriate for single-AP deployments but harmful in multi-AP environments.
- A device that connects successfully but cannot reach the internet typically has a DNS or gateway issue. Verify the DHCP-assigned gateway and DNS server addresses. On ESP-IDF, `esp_netif_get_ip_info()` retrieves the assigned IP, netmask, and gateway. A missing gateway (0.0.0.0) indicates a DHCP server misconfiguration.
- A station that shows "connected" in the firmware log but drops MQTT messages is likely experiencing temporary channel congestion. The WiFi link is up, but retry rates are high enough that some TCP segments time out. Adding a WiFi statistics poll (`esp_wifi_get_stats()`) or checking the retry count reveals whether the RF link is healthy.
- A Pico W device that stops responding to network requests after hours of operation may have stopped calling `cyw43_arch_poll()` — any blocking operation or infinite loop in the main thread stalls WiFi event processing. Moving WiFi handling to a FreeRTOS task with `pico_cyw43_arch_threadsafe_background` prevents this class of bug.
- A multi-credential device that always connects to the weakest available network is likely iterating credentials in storage order rather than sorting by scan RSSI. Sorting the scan results by signal strength before attempting connection ensures the strongest compatible network is tried first.
