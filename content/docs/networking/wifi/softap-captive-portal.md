---
title: "SoftAP, Captive Portals & Provisioning"
weight: 30
---

# SoftAP, Captive Portals & Provisioning

Every WiFi device faces a bootstrapping problem: it needs network credentials to connect, but it has no network connection through which to receive them. SoftAP provisioning solves this by temporarily turning the MCU into an access point, serving a credential-entry web page to a phone or laptop, and then switching back to station mode with the received SSID and password. This approach requires no companion app, no cloud account, and no Bluetooth — just a web browser. It has become the de facto provisioning method for consumer IoT devices, from smart plugs to environmental sensors.

## SoftAP vs Station Mode

SoftAP (Software Access Point) mode reverses the usual role — the MCU runs as an AP that other devices connect to, rather than connecting to an existing AP itself.

| Characteristic | Station Mode (STA) | SoftAP Mode (AP) |
|---------------|-------------------|------------------|
| Role | Client connecting to AP | AP accepting client connections |
| SSID source | Configured by firmware | Broadcast by firmware |
| IP assignment | Receives IP via DHCP | Runs DHCP server, assigns IPs |
| Internet access | Through AP's uplink | None (isolated network) |
| Max clients | N/A | Platform-limited (ESP32: 10, Pico W: 4) |
| Typical use | Normal operation | Provisioning, diagnostics, direct control |
| RAM overhead | WiFi stack + LWIP | WiFi stack + LWIP + DHCP server + HTTP server |
| Power draw | 150–250 mA active | 150–250 mA active (similar to STA) |
| Concurrent with STA | Some platforms (ESP32: yes) | ESP32 supports STA+AP simultaneously |

ESP32 supports simultaneous STA+AP mode, allowing the device to maintain its uplink connection while also running a provisioning or diagnostic AP. This is useful for reconfiguration without disconnecting from the active network. The Pico W and ATWINC1500 typically require exclusive mode — AP or STA, not both.

## SoftAP Configuration

Setting up a SoftAP involves choosing the SSID, security mode, channel, and maximum client count. Each choice has implications for usability and security.

**ESP-IDF SoftAP setup:**

```c
#include "esp_wifi.h"
#include "esp_netif.h"

void softap_init(void)
{
    esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap();

    /* Optional: set a custom IP range for the AP network */
    esp_netif_ip_info_t ip_info = {
        .ip      = { .addr = ESP_IP4TOADDR(192, 168, 4, 1) },
        .gw      = { .addr = ESP_IP4TOADDR(192, 168, 4, 1) },
        .netmask = { .addr = ESP_IP4TOADDR(255, 255, 255, 0) }
    };
    esp_netif_dhcps_stop(ap_netif);
    esp_netif_set_ip_info(ap_netif, &ip_info);
    esp_netif_dhcps_start(ap_netif);

    wifi_config_t ap_config = {
        .ap = {
            .ssid = "SENSOR-SETUP-A1B2",
            .ssid_len = 0,              /* Auto-detect length */
            .channel = 1,               /* Fixed channel */
            .password = "",             /* Open — see security notes */
            .max_connection = 4,        /* Limit concurrent clients */
            .authmode = WIFI_AUTH_OPEN, /* Open for easy provisioning */
            .ssid_hidden = 0,          /* Visible SSID */
            .beacon_interval = 100,    /* ms, default */
        }
    };

    esp_wifi_set_mode(WIFI_MODE_AP);
    esp_wifi_set_config(WIFI_IF_AP, &ap_config);
    esp_wifi_start();
}
```

**SSID naming conventions** — Including a unique identifier in the SSID (last 4 characters of the MAC address, a serial number, or a product code) prevents confusion when multiple devices are being provisioned simultaneously. Common patterns: `DEVICE-SETUP-A1B2`, `SmartPlug-Config-7F3E`, `Sensor_XXXX` where XXXX is derived from the MAC.

**Channel selection** — For provisioning, channel 1 is the safest default. Channel 6 and 11 are also acceptable. Avoid channels 2–5 and 7–10 (overlapping with non-overlapping channels). The provisioning session is brief (30–120 seconds), so channel optimization is less critical than during normal operation.

**Security trade-off** — Open (no password) SoftAPs allow instant connection without typing a password, improving the user experience during setup. The provisioning window is typically short (2–5 minutes), and the credentials are transmitted over a local-only network. For higher security, WPA2-PSK with a printed-on-device password is preferable but adds friction. The PSK can be printed on a label, embedded in a QR code, or derived from the device serial number.

## Captive Portal Architecture

A captive portal intercepts all HTTP requests from the connected client and redirects them to a credential-entry page hosted on the MCU. The mechanism relies on DNS hijacking — the MCU runs a DNS server that resolves every domain name to its own IP address.

### DNS Hijack Flow

```
Phone connects to SoftAP "SENSOR-SETUP-A1B2"
    │
    ├── Phone gets IP 192.168.4.2 via DHCP
    │   (Gateway: 192.168.4.1, DNS: 192.168.4.1)
    │
    ├── Phone OS sends captive portal probe:
    │   DNS query for "connectivitycheck.gstatic.com"
    │   → MCU DNS server responds: 192.168.4.1
    │
    ├── Phone OS sends HTTP GET to 192.168.4.1
    │   → MCU HTTP server returns redirect to /setup
    │   → Phone OS detects captive portal, opens browser sheet
    │
    ├── Browser loads http://192.168.4.1/setup
    │   → MCU serves credential entry page from flash/SPIFFS
    │
    ├── User enters SSID + password, submits form
    │   → POST /configure with ssid=HomeWiFi&password=secret
    │
    ├── MCU stores credentials to NVS
    │   → Responds with "Connecting..." status page
    │
    ├── MCU switches to STA mode
    │   → Attempts connection with received credentials
    │
    └── Success → SoftAP disabled, normal operation begins
        Failure → SoftAP re-enabled, error page served
```

### Captive Portal Detection

Modern operating systems automatically detect captive portals by making HTTP requests to known URLs immediately after WiFi association:

| OS | Probe URL | Expected Response |
|----|-----------|------------------|
| Android | `http://connectivitycheck.gstatic.com/generate_204` | HTTP 204 (no captive portal) |
| iOS / macOS | `http://captive.apple.com/hotspot-detect.html` | Contains "Success" (no portal) |
| Windows | `http://www.msftconnecttest.com/connecttest.txt` | Contains "Microsoft Connect Test" |
| Linux (NetworkManager) | `http://nmcheck.gnome.org/check_network_status.txt` | Contains "NetworkManager is online" |

When the MCU's DNS server resolves these domains to itself and the HTTP server returns a different response (a redirect or the portal page), the OS detects a captive portal and opens a captive portal browser sheet — a lightweight browser window that displays the portal page without the user needing to open a browser manually.

**Minimal DNS server (ESP-IDF):**

```c
#include "lwip/sockets.h"
#include "lwip/dns.h"

#define DNS_PORT 53

/* Minimal DNS response: resolve everything to our AP IP */
static void dns_server_task(void *pvParameters)
{
    uint32_t ap_ip = 0xC0A80401;  /* 192.168.4.1 in network byte order */
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);

    struct sockaddr_in server_addr = {
        .sin_family = AF_INET,
        .sin_port = htons(DNS_PORT),
        .sin_addr.s_addr = INADDR_ANY
    };
    bind(sock, (struct sockaddr *)&server_addr, sizeof(server_addr));

    uint8_t rx_buf[512];
    while (1) {
        struct sockaddr_in client_addr;
        socklen_t addr_len = sizeof(client_addr);
        int len = recvfrom(sock, rx_buf, sizeof(rx_buf), 0,
                          (struct sockaddr *)&client_addr, &addr_len);
        if (len < 12) continue;  /* Too short for DNS header */

        /* Build response: copy query, set response flags, add answer */
        uint8_t tx_buf[512];
        memcpy(tx_buf, rx_buf, len);

        /* Set QR=1 (response), AA=1 (authoritative) */
        tx_buf[2] = 0x85;  /* QR=1, Opcode=0, AA=1, TC=0, RD=1 */
        tx_buf[3] = 0x80;  /* RA=1, Z=0, RCODE=0 */

        /* Set answer count = 1 */
        tx_buf[6] = 0x00;
        tx_buf[7] = 0x01;

        /* Append answer: pointer to name, type A, class IN, TTL=60, IP */
        int pos = len;
        tx_buf[pos++] = 0xC0; tx_buf[pos++] = 0x0C;  /* Name pointer */
        tx_buf[pos++] = 0x00; tx_buf[pos++] = 0x01;  /* Type A */
        tx_buf[pos++] = 0x00; tx_buf[pos++] = 0x01;  /* Class IN */
        tx_buf[pos++] = 0x00; tx_buf[pos++] = 0x00;
        tx_buf[pos++] = 0x00; tx_buf[pos++] = 0x3C;  /* TTL = 60s */
        tx_buf[pos++] = 0x00; tx_buf[pos++] = 0x04;  /* Data length */
        tx_buf[pos++] = 192;  tx_buf[pos++] = 168;
        tx_buf[pos++] = 4;    tx_buf[pos++] = 1;     /* 192.168.4.1 */

        sendto(sock, tx_buf, pos, 0,
               (struct sockaddr *)&client_addr, addr_len);
    }
}
```

### HTTP Server and Portal Page

The HTTP server runs on the MCU, serving the credential-entry page directly from flash or a filesystem (SPIFFS, LittleFS). On ESP32, the built-in HTTP server handles this with minimal configuration.

```c
#include "esp_http_server.h"

/* Serve the setup page (stored in flash via EMBED_FILES or SPIFFS) */
extern const uint8_t setup_html_start[] asm("_binary_setup_html_start");
extern const uint8_t setup_html_end[]   asm("_binary_setup_html_end");

static esp_err_t setup_page_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, (const char *)setup_html_start,
                    setup_html_end - setup_html_start);
    return ESP_OK;
}

/* Handle credential submission */
static esp_err_t configure_handler(httpd_req_t *req)
{
    char buf[256];
    int ret = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (ret <= 0) return ESP_FAIL;
    buf[ret] = '\0';

    /* Parse ssid= and password= from URL-encoded form data */
    char ssid[33] = {0}, password[65] = {0};
    httpd_query_key_value(buf, "ssid", ssid, sizeof(ssid));
    httpd_query_key_value(buf, "password", password, sizeof(password));

    /* Store to NVS */
    nvs_handle_t nvs;
    nvs_open("wifi_creds", NVS_READWRITE, &nvs);
    nvs_set_str(nvs, "ssid", ssid);
    nvs_set_str(nvs, "password", password);
    nvs_commit(nvs);
    nvs_close(nvs);

    /* Respond with status page */
    httpd_resp_sendstr(req, "<html><body><h2>Connecting...</h2>"
                            "<p>The device is attempting to connect. "
                            "This page will close shortly.</p></body></html>");

    /* Schedule mode switch to STA (do not block HTTP response) */
    /* Use a FreeRTOS timer or task notification here */
    return ESP_OK;
}
```

The portal page itself should be minimal — HTML with inline CSS, no external resources (no CDN links, no Google Fonts). The MCU has no internet access in SoftAP mode, so any external resource request will fail or redirect to the portal. A practical portal page is 2–5 KB of HTML and fits easily in flash.

Key elements of the portal page:
- SSID selection (dropdown populated by a scan, or a text input for hidden networks)
- Password field
- Submit button
- Status/error feedback area
- Optional: device information (firmware version, MAC address)

## Credential Storage

Credentials must persist across power cycles. Each platform provides different storage mechanisms.

### ESP32 NVS (Non-Volatile Storage)

NVS is a key-value store in a dedicated flash partition (default: 24 KB). It handles wear leveling internally and supports strings, integers, and binary blobs.

```c
/* Write credentials */
nvs_handle_t nvs;
esp_err_t err = nvs_open("wifi_prov", NVS_READWRITE, &nvs);
nvs_set_str(nvs, "ssid", "HomeNetwork");
nvs_set_str(nvs, "pass", "s3cretP@ss");
nvs_set_u8(nvs,  "configured", 1);
nvs_commit(nvs);
nvs_close(nvs);

/* Read credentials at boot */
nvs_open("wifi_prov", NVS_READONLY, &nvs);
char ssid[33], pass[65];
size_t ssid_len = sizeof(ssid), pass_len = sizeof(pass);
nvs_get_str(nvs, "ssid", ssid, &ssid_len);
nvs_get_str(nvs, "pass", pass, &pass_len);
nvs_close(nvs);
```

NVS flash endurance is approximately 100,000 erase cycles per sector. For credentials written once during provisioning, wear is not a concern. For devices that re-provision frequently (test fixtures, rental equipment), monitoring NVS sector health via `nvs_get_stats()` is prudent.

### Other MCU Platforms

| Platform | Storage Method | Capacity | Wear Leveling | Encryption Support |
|----------|---------------|----------|---------------|-------------------|
| ESP32 | NVS (flash partition) | 12–96 KB configurable | Yes (internal) | Yes (NVS encryption) |
| STM32 | Flash sectors (manual) | Depends on flash layout | Manual (dual-page swap) | Application-level |
| nRF52 | FDS (Flash Data Storage) | Configurable pages | Yes (internal) | Application-level |
| Pico W (RP2040) | Flash sectors (last N KB) | Manual allocation | Manual | Application-level |
| ATWINC1500 | Host MCU flash | Host-dependent | Host-dependent | Application-level |

For platforms without built-in key-value stores, a dual-page write pattern provides basic wear leveling: alternate between two flash sectors, always writing to the inactive one and then swapping the active pointer. This guarantees that a power failure during write does not corrupt the active credentials.

**Security note:** Storing WiFi passwords in plaintext flash is standard practice for consumer IoT devices, but enterprise or security-sensitive deployments should consider flash encryption (ESP32 supports transparent flash encryption) or storing a derived key instead of the raw PSK.

## Provisioning Method Comparison

SoftAP captive portal is one of several provisioning methods. Each has distinct trade-offs in user experience, security, and implementation complexity.

| Feature | SoftAP + Captive Portal | SmartConfig (ESP-Touch) | BLE Provisioning | WPS Push-Button |
|---------|------------------------|------------------------|-------------------|-----------------|
| Requires companion app | No (browser only) | Yes (ESP-Touch app) | Yes (custom or standard) | No |
| Platform support | All WiFi MCUs | ESP32 only | ESP32, nRF52, any BLE MCU | Most APs, limited MCU support |
| User steps | 3–5 taps | 2–3 taps | 3–5 taps | 1–2 button presses |
| Security | Medium (open AP or device-PSK) | Low (credentials in broadcast) | High (encrypted BLE channel) | Low (2-minute window) |
| Works with hidden SSIDs | Yes (text entry) | No | Yes | No |
| Works without internet | Yes | Yes | Yes | Yes |
| Enterprise WPA support | Yes (can input full credentials) | No | Yes | No |
| Typical implementation size | 15–30 KB flash | 5–10 KB flash | 20–40 KB flash (BLE stack) | 2–5 KB flash |
| RAM overhead | 8–15 KB (HTTP server + DNS) | 2–5 KB | 20–30 KB (BLE stack) | Minimal |
| Connection time | 30–120 s (user-dependent) | 10–30 s | 30–120 s (user-dependent) | 5–15 s |
| Reliability | High | Medium (fails in noisy RF) | High | Medium (AP compatibility) |

### SmartConfig (ESP-Touch)

SmartConfig encodes WiFi credentials into the length field of broadcast UDP packets sent by a phone app while connected to the target WiFi network. The ESP32, in promiscuous mode, captures these packets and decodes the credentials without ever associating with the network. The advantage is speed and simplicity — no mode switching, no web server. The disadvantage is that credentials are effectively broadcast in a form that any nearby promiscuous receiver can capture, and the technique fails in environments with heavy multicast filtering or 802.11w management frame protection.

### BLE Provisioning

BLE provisioning uses a separate radio (Bluetooth Low Energy) to transfer WiFi credentials. The phone connects to the device's BLE GATT server, writes the SSID and password to characteristic UUIDs, and the device uses these to connect via WiFi. This keeps the WiFi radio free for station mode throughout the process — no AP↔STA mode switching — and the BLE link can be encrypted (LE Secure Connections) for credential confidentiality.

ESP-IDF provides a complete BLE provisioning library (`wifi_provisioning`) with a reference phone app. The implementation adds approximately 20–40 KB of flash for the BLE stack and GATT services, plus 20–30 KB of RAM while BLE is active. After provisioning, BLE can be deinitialized to reclaim the RAM.

## Provisioning State Machine

A complete provisioning flow includes fallback logic, timeout handling, and user feedback:

```
┌─────────────┐
│  POWER ON   │
└──────┬──────┘
       │ Check NVS for stored credentials
       v
  ┌────────────┐    Yes    ┌──────────────┐
  │ Credentials├──────────>│ STA Connect  │
  │  stored?   │           │  (timeout 15s)│
  └────┬───────┘           └──────┬───────┘
       │ No                       │
       v                     Success?
  ┌────────────┐              │    │
  │ Start      │        Yes ──┘    └── No (3 retries)
  │ SoftAP +   │              │              │
  │ Portal     │         ┌────v────┐    ┌────v──────┐
  └────┬───────┘         │ NORMAL  │    │ Clear creds│
       │                 │OPERATION│    │ Start AP   │
       v                 └─────────┘    └────┬───────┘
  ┌────────────┐                              │
  │ Wait for   │<─────────────────────────────┘
  │ credentials│
  │ (timeout   │
  │  5 min)    │
  └────┬───────┘
       │ Received
       v
  ┌────────────┐
  │ Store to   │
  │ NVS, try   │
  │ STA connect│
  └────┬───────┘
       │
  Success? ──Yes──> Normal Operation
       │
       No
       │
  ┌────v───────┐
  │ Show error │
  │ Re-enable  │
  │ portal     │
  └────────────┘
```

Key design decisions:

- **Provisioning timeout** — The SoftAP should not run indefinitely. A 5-minute timeout with automatic retry of stored credentials (if any) prevents a device from being stuck in provisioning mode after a transient failure.
- **Credential validation** — After receiving credentials, attempt a STA connection before confirming success to the user. If the connection fails, re-enable the portal with an error message.
- **Factory reset** — A physical button held for 5–10 seconds should clear stored credentials and force provisioning mode. This is the recovery path when a user changes their router or forgets the network password.
- **LED feedback** — Distinct LED patterns for "provisioning mode" (slow blink), "connecting" (fast blink), and "connected" (solid) provide feedback without a screen.

## Security Considerations

Provisioning is a security-sensitive operation — credentials are transmitted over a temporary network and stored persistently.

**Open SoftAP risks** — An open provisioning AP allows any nearby device to connect and submit credentials. An attacker could submit credentials for a malicious AP, causing the device to connect to an attacker-controlled network. Mitigation: use a device-specific WPA2-PSK (printed on label or QR code) for the provisioning AP.

**Credential transmission** — Even on an open AP, the captive portal can use HTTPS if the device has a self-signed certificate. However, browsers will show a security warning for self-signed certs, and the captive portal browser sheet on iOS/Android may not handle HTTPS gracefully. In practice, most implementations use HTTP on the local provisioning network — the attacker would need to be connected to the same short-lived open AP to intercept traffic.

**Credential storage** — Plaintext password storage in flash is the norm but represents a risk if the device is physically accessible. ESP32's NVS encryption (tied to the eFuse-stored key) provides hardware-backed encryption at rest. For other platforms, application-level encryption with a device-unique key (derived from a hardware serial number or random seed burned at manufacturing) adds a layer of protection.

**Provisioning window** — Limiting the time the SoftAP is active (2–5 minutes) reduces the attack surface. After the timeout, the device should either attempt stored credentials or enter a low-power state, not leave the AP running indefinitely.

## Tips

- Include a scan-results dropdown in the portal page rather than requiring manual SSID entry. Run `esp_wifi_scan_start()` in STA mode before switching to AP mode, cache the results, and populate the HTML dropdown. This eliminates SSID typos, which are the most common provisioning failure cause.
- Derive the SoftAP SSID from the MAC address or a unique device identifier. When provisioning multiple devices on a production line or in a customer's home, unique SSIDs prevent connecting to the wrong device.
- Set the SoftAP IP to something other than 192.168.1.x to avoid conflicts with the user's home network. The default 192.168.4.1 on ESP-IDF is a good choice. Avoid 10.0.0.x and 192.168.0.x, which are common home router ranges.
- Add a "test connection" step before confirming provisioning success. After receiving credentials, attempt a STA connection (with a 10–15 second timeout) and report the result back through the portal before shutting down the AP. This catches wrong passwords immediately instead of after the user has moved on.
- Store a "provisioning complete" flag alongside the credentials. On boot, check this flag before attempting STA connection — a missing flag after a power failure during provisioning means the credentials may be incomplete.

## Caveats

- **iOS and Android captive portal browsers are not full browsers** — The captive portal sheet has limited JavaScript support, no local storage, restricted cookie handling, and may close unexpectedly when the OS detects the portal has been satisfied (or the WiFi connection drops). Keep the portal page simple — plain HTML forms, minimal JavaScript, no AJAX.
- **Some Android versions require a specific HTTP response to trigger the captive portal sheet** — Returning HTTP 302 redirect to any URL works on most versions, but some require a non-204 response specifically to `connectivitycheck.gstatic.com`. Testing across Android 10, 11, 12, and 13 is essential for consumer products.
- **Concurrent STA+AP mode on ESP32 forces both interfaces to the same channel** — If the target STA network is on channel 6 but the SoftAP was started on channel 1, the AP switches to channel 6 when STA connects. Clients connected to the AP may be disrupted by the channel change. Starting the AP on the same channel as the target STA network avoids this.
- **SoftAP DHCP server lease table is small** — ESP32's DHCP server supports a limited number of leases (default: 10). In production testing scenarios where many phones connect and disconnect, lease exhaustion can prevent new connections. Reducing the lease time to 60 seconds or restarting the DHCP server between provisioning attempts helps.
- **The captive portal may not appear on all devices** — Older devices, some Linux laptops, and IoT devices connecting to the provisioning AP will not display a captive portal automatically. Including the AP's IP address (192.168.4.1) in the printed setup instructions as a fallback URL is essential.

## In Practice

- A provisioning flow that works on iPhone but fails on Samsung Galaxy phones is typically a DNS hijack response format issue. Samsung's captive portal detection is more sensitive to DNS response formatting than iOS. Ensuring the DNS response has correct flags (QR=1, AA=1, RA=1, RCODE=0) and a valid answer section resolves most Android compatibility issues.
- A device that successfully provisions but loses credentials after power cycling has an NVS commit issue. On ESP-IDF, `nvs_commit()` must be called after `nvs_set_str()` — without it, the data remains in the page buffer and is lost on reset. This is the single most common provisioning bug.
- A captive portal that loads but shows a blank page on the phone has a flash storage issue — the HTML file was not included in the firmware image. On ESP-IDF, embedded files require a `EMBED_FILES` entry in CMakeLists.txt, or the file must be uploaded to SPIFFS/LittleFS before the portal is accessed.
- A device that enters provisioning mode on every boot despite having valid stored credentials likely has a corrupt NVS partition. Running `nvs_flash_erase()` followed by `nvs_flash_init()` recovers from most corruption, but erases all stored data. Adding NVS partition integrity checks (CRC or magic number) at boot detects corruption early.
- A production line provisioning setup that slows down after 20–30 devices is likely exhausting DHCP leases or accumulating stale ARP entries. Restarting the SoftAP between each provisioning cycle (stop AP, reinit DHCP, start AP) resets the network state and maintains consistent provisioning times of 30–60 seconds per device.
