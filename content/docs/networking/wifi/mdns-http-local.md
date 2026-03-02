---
title: "mDNS, HTTP Servers & Local Discovery"
weight: 60
---

# mDNS, HTTP Servers & Local Discovery

Many embedded WiFi devices need to be reachable on a local network without requiring the user to know the device's IP address. mDNS (multicast DNS) provides hostname resolution — a device advertising itself as `sensor-01.local` can be reached by name from any machine on the same subnet. DNS-SD (DNS Service Discovery) extends this by advertising available services, so a configuration tool can discover all devices of a given type without scanning IP ranges. Running a lightweight HTTP server on the MCU itself enables web-based configuration pages, REST APIs for local control, and status dashboards — all without any cloud dependency.

## mDNS Protocol Basics

mDNS operates over UDP multicast on address 224.0.0.251, port 5353. When a machine needs to resolve a `.local` hostname, it sends a multicast DNS query to this address instead of contacting a unicast DNS server. The device owning that hostname responds with its IP address via multicast, allowing all devices on the subnet to cache the result.

Key protocol characteristics:

| Property | Value |
|---|---|
| Multicast group (IPv4) | 224.0.0.251 |
| Multicast group (IPv6) | ff02::fb |
| UDP port | 5353 |
| Domain suffix | `.local` |
| TTL (typical) | 120 seconds |
| Record types | A (IPv4), AAAA (IPv6), PTR, SRV, TXT |
| Conflict resolution | Probe-announce sequence at startup |

When an mDNS-enabled device joins the network, it performs a three-step process: (1) send probe queries for the desired hostname to detect conflicts, (2) if no conflict after 750 ms, announce the hostname via multicast response, and (3) periodically refresh the announcement before the TTL expires. If a conflict is detected (another device already claims the name), the device must either choose an alternative name (e.g., appending `-2`) or alert the application layer to resolve the conflict.

### ESP-IDF mDNS API

ESP-IDF includes a complete mDNS implementation that handles probing, announcing, and responding to queries. The API is straightforward for basic hostname advertisement:

```c
#include "mdns.h"

void start_mdns_service(void) {
    /* Initialize mDNS */
    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS init failed: %s", esp_err_to_name(err));
        return;
    }

    /* Set the hostname — device will respond to "sensor-01.local" */
    mdns_hostname_set("sensor-01");

    /* Set a friendly instance name (optional, used in DNS-SD browsing) */
    mdns_instance_name_set("Temperature Sensor Unit 01");

    /* Advertise an HTTP service via DNS-SD */
    mdns_service_add("ESP32-WebServer", "_http", "_tcp", 80, NULL, 0);

    /* Add TXT records with metadata */
    mdns_txt_item_t txt_data[] = {
        {"model",    "esp32-sensor"},
        {"firmware", "1.2.3"},
        {"path",     "/api/v1"},
    };
    mdns_service_txt_set("_http", "_tcp", txt_data, 3);
}
```

The mDNS stack runs as a background task in ESP-IDF, consuming approximately 4–6 KB of RAM for the task stack and internal buffers. Flash usage for the mDNS component is approximately 20–30 KB of compiled code. The stack automatically handles re-announcements, query responses, and conflict resolution without application intervention.

### Querying Other Devices

An MCU can also discover other mDNS devices on the network — useful for peer-to-peer communication between embedded devices or for finding a local gateway:

```c
/* Query for all HTTP services on the local network */
mdns_result_t *results = NULL;
esp_err_t err = mdns_query_ptr("_http", "_tcp", 3000, 10, &results);
if (err == ESP_OK && results != NULL) {
    mdns_result_t *r = results;
    while (r) {
        ESP_LOGI(TAG, "Found service: %s at %s:%d",
                 r->instance_name,
                 r->hostname,
                 r->port);
        r = r->next;
    }
    mdns_query_results_free(results);
}

/* Resolve a specific hostname */
mdns_result_t *host_result = NULL;
err = mdns_query_a("gateway-device", 2000, &host_result);
if (err == ESP_OK && host_result != NULL) {
    ESP_LOGI(TAG, "gateway-device.local -> " IPSTR,
             IP2STR(&host_result->addr));
    mdns_query_results_free(host_result);
}
```

## DNS-SD (DNS Service Discovery)

DNS-SD uses standard DNS record types (PTR, SRV, TXT) to advertise services on the network. When a client browses for services of a given type (e.g., `_http._tcp.local`), it sends a PTR query and receives pointers to specific service instances. Each instance has an SRV record (host and port) and optional TXT records (key-value metadata).

The service type naming convention follows the format `_service._protocol`, registered with IANA. Common types used in embedded systems:

| Service Type | Description | Typical Use |
|---|---|---|
| `_http._tcp` | HTTP web server | Configuration pages, REST APIs |
| `_https._tcp` | HTTPS web server | Secure configuration interfaces |
| `_mqtt._tcp` | MQTT broker | Local MQTT broker discovery |
| `_coap._udp` | CoAP server | Constrained application protocol |
| `_ipp._tcp` | Internet Printing Protocol | Network printers |
| `_airplay._tcp` | AirPlay | Audio/video streaming |
| `_hap._tcp` | HomeKit Accessory Protocol | Apple Home integration |
| `_webthing._tcp` | WebThings | Mozilla WebThings Gateway |

Custom service types for proprietary protocols use the format `_vendorname._tcp` (or `_udp`). TXT records carry metadata about the service — firmware version, device model, API version, available endpoints — limited to 255 bytes per key-value pair and 1300 bytes total (to fit in a single DNS packet without truncation).

## Lightweight HTTP Servers on MCUs

Running an HTTP server directly on a microcontroller enables local control without cloud dependency. The server typically handles a small number of endpoints — a configuration page, a status API, and perhaps a firmware upload handler. The challenge is fitting the server, its connection state, and the response content into the limited RAM and flash available.

### HTTP Server Options

| Server | Platform | RAM per Connection | Max Connections | Flash Size | Features |
|---|---|---|---|---|---|
| ESP HTTP Server (esp_http_server) | ESP-IDF | 4–8 KB | 7 (configurable) | ~40 KB | URI handlers, async, websocket support |
| lwIP httpd | Any lwIP platform | 1–2 KB | 4 (configurable) | ~15 KB | Static pages (compiled-in), SSI, CGI |
| Mongoose | Platform-independent | 8–12 KB | Configurable | ~80 KB | HTTP, WebSocket, MQTT, full-featured |
| MicroPython HTTP | MicroPython | 6–10 KB | 1–3 | N/A (interpreted) | Simple, slow, GC pauses |
| Pico W HTTP (lwIP) | Pico SDK | 2–4 KB | 4 | ~20 KB | Basic, tied to CYW43 driver |

The ESP HTTP Server is the most common choice for ESP-IDF projects. It runs as a FreeRTOS task, dispatches incoming requests to registered URI handler functions, and manages connection state internally. Each active connection consumes 4–8 KB of heap for the socket buffer, HTTP parser state, and request context.

### ESP HTTP Server Setup

```c
#include "esp_http_server.h"

/* Handler for GET /api/status */
static esp_err_t status_handler(httpd_req_t *req) {
    /* Build JSON response */
    char resp[256];
    snprintf(resp, sizeof(resp),
        "{\"temperature\":%.1f,\"humidity\":%.1f,"
        "\"uptime\":%lu,\"heap_free\":%lu}",
        sensor_get_temperature(),
        sensor_get_humidity(),
        (unsigned long)(esp_timer_get_time() / 1000000),
        (unsigned long)esp_get_free_heap_size());

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, resp, HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

/* Handler for POST /api/config */
static esp_err_t config_handler(httpd_req_t *req) {
    char buf[512];
    int received = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (received <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty body");
        return ESP_FAIL;
    }
    buf[received] = '\0';

    /* Parse JSON and apply configuration */
    /* ... cJSON parsing here ... */

    httpd_resp_send(req, "{\"status\":\"ok\"}", HTTPD_RESP_USE_STRLEN);
    return ESP_OK;
}

/* Handler for serving a static HTML page from flash */
extern const uint8_t index_html_start[] asm("_binary_index_html_start");
extern const uint8_t index_html_end[]   asm("_binary_index_html_end");

static esp_err_t root_handler(httpd_req_t *req) {
    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, (const char *)index_html_start,
                    index_html_end - index_html_start);
    return ESP_OK;
}

httpd_handle_t start_webserver(void) {
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_uri_handlers = 8;
    config.max_resp_headers = 8;
    config.stack_size = 8192;       /* Task stack — increase if handlers are complex */
    config.lru_purge_enable = true; /* Close idle connections when max is reached */

    httpd_handle_t server = NULL;
    if (httpd_start(&server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server");
        return NULL;
    }

    httpd_uri_t uri_root = {
        .uri = "/", .method = HTTP_GET, .handler = root_handler
    };
    httpd_uri_t uri_status = {
        .uri = "/api/status", .method = HTTP_GET, .handler = status_handler
    };
    httpd_uri_t uri_config = {
        .uri = "/api/config", .method = HTTP_POST, .handler = config_handler
    };

    httpd_register_uri_handler(server, &uri_root);
    httpd_register_uri_handler(server, &uri_status);
    httpd_register_uri_handler(server, &uri_config);

    return server;
}
```

### Serving Static Content from Flash

HTML, CSS, and JavaScript files for a configuration page are typically embedded in the firmware binary using ESP-IDF's `EMBED_FILES` CMake directive. This places the file contents in flash (.rodata) and makes them accessible via linker symbols:

```cmake
# In CMakeLists.txt
idf_component_register(
    SRCS "main.c" "webserver.c"
    INCLUDE_DIRS "."
    EMBED_FILES "web/index.html" "web/style.css" "web/app.js"
)
```

A typical configuration page for an embedded device is 5–15 KB of combined HTML/CSS/JS — small enough to fit comfortably in flash but worth minifying to leave room for firmware growth. Gzip compression reduces transfer size by 60–80%, and ESP HTTP Server supports sending pre-compressed responses by setting the `Content-Encoding: gzip` header, though the HTML must be gzipped at build time rather than at runtime (runtime compression requires too much RAM).

### Memory Overhead Summary

The total memory cost of running an HTTP server with a configuration page:

| Component | RAM (KB) | Flash (KB) |
|---|---|---|
| HTTP server task stack | 4–8 | — |
| HTTP server internals | 2–4 | 40 |
| Per-connection state (x4 connections) | 16–32 | — |
| Static HTML/CSS/JS content | — | 5–15 |
| cJSON parser (for API requests) | 2–8 (dynamic) | 15 |
| mDNS stack | 4–6 | 20–30 |
| **Total** | **28–58** | **80–100** |

On an ESP32 with 320 KB SRAM and 4 MB flash, this represents approximately 10–18% of RAM and 2–3% of flash — manageable for most applications but significant enough to consider when the device also runs WiFi, TLS, and application logic simultaneously.

## REST API Patterns on MCUs

REST APIs on microcontrollers follow the same principles as server-side APIs but with constraints that shape the design:

**Keep the endpoint count small.** Each registered URI handler adds to the flash footprint and the server's routing table. Five to ten endpoints is typical for an embedded REST API — enough for status, configuration, control, and OTA.

**Use JSON sparingly.** Generating and parsing JSON on an MCU is CPU-intensive and allocates heap memory proportional to the document size. The cJSON library (included in ESP-IDF) is convenient but allocates a node structure for every JSON element. For a response with 10 fields, cJSON allocates roughly 1–2 KB of heap. For large responses, consider building the JSON string directly with `snprintf()` to avoid the allocation overhead.

**Limit response sizes.** An MCU HTTP server typically uses a single output buffer of 1–4 KB. Responses larger than this buffer require chunked transfer encoding, which adds complexity. Keeping API responses under 1 KB avoids chunked encoding entirely.

**Handle concurrent requests carefully.** The ESP HTTP Server processes requests sequentially on a single task by default. A long-running handler (e.g., reading a sensor that takes 500 ms) blocks all other HTTP clients. For handlers that take significant time, consider responding with an immediate acknowledgment and using a background task to perform the actual work.

```c
/* Typical REST API endpoint pattern for MCU */

/* GET /api/v1/sensors — returns all sensor readings */
static esp_err_t sensors_get_handler(httpd_req_t *req) {
    char json[512];
    int len = snprintf(json, sizeof(json),
        "{"
        "\"sensors\":["
        "{\"id\":\"temp\",\"value\":%.1f,\"unit\":\"C\"},"
        "{\"id\":\"hum\",\"value\":%.1f,\"unit\":\"%%\"},"
        "{\"id\":\"pres\",\"value\":%.0f,\"unit\":\"hPa\"}"
        "],"
        "\"timestamp\":%lu"
        "}",
        read_temperature(),
        read_humidity(),
        read_pressure(),
        (unsigned long)time(NULL));

    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_send(req, json, len);
    return ESP_OK;
}

/* PUT /api/v1/config/wifi — update WiFi credentials */
static esp_err_t wifi_config_put_handler(httpd_req_t *req) {
    if (req->content_len > 256) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Body too large");
        return ESP_FAIL;
    }

    char buf[256];
    int received = httpd_req_recv(req, buf, sizeof(buf) - 1);
    if (received <= 0) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Empty body");
        return ESP_FAIL;
    }
    buf[received] = '\0';

    cJSON *root = cJSON_Parse(buf);
    if (!root) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid JSON");
        return ESP_FAIL;
    }

    cJSON *ssid = cJSON_GetObjectItem(root, "ssid");
    cJSON *pass = cJSON_GetObjectItem(root, "password");

    if (!cJSON_IsString(ssid) || !cJSON_IsString(pass)) {
        cJSON_Delete(root);
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST,
                            "Missing ssid or password");
        return ESP_FAIL;
    }

    /* Store credentials and schedule reconnection */
    store_wifi_credentials(ssid->valuestring, pass->valuestring);
    cJSON_Delete(root);

    httpd_resp_send(req, "{\"status\":\"ok\",\"message\":\"Restarting WiFi\"}",
                    HTTPD_RESP_USE_STRLEN);

    /* Reconnect on a background task — do not block the HTTP response */
    xTaskCreate(wifi_reconnect_task, "wifi_recon", 4096, NULL, 5, NULL);
    return ESP_OK;
}
```

## Cross-Platform Considerations

mDNS and HTTP server availability varies across MCU platforms:

| Feature | ESP-IDF | Pico W (Pico SDK) | Zephyr | Arduino (ESP32) |
|---|---|---|---|---|
| mDNS | Built-in (`mdns` component) | Community libraries | Built-in (dns_sd) | ESPmDNS library |
| DNS-SD | Built-in (via mdns API) | Manual implementation | Built-in | Limited |
| HTTP server | `esp_http_server` component | lwIP httpd or custom | Zephyr HTTP server | Arduino WebServer |
| HTTPS server | Supported (mbedTLS) | Not standard | Supported | Limited |
| WebSocket | Supported (esp_http_server) | Not standard | Not built-in | ArduinoWebsockets |
| Static file serving | EMBED_FILES + SPIFFS/LittleFS | Compiled-in only | Flash filesystem | SPIFFS/LittleFS |

On the Raspberry Pi Pico W, mDNS support requires integrating a third-party library or implementing the protocol manually on top of lwIP's raw UDP API. The Pico SDK's lwIP configuration does not include mDNS by default, making this a more involved setup than on ESP-IDF.

## Tips

- Set unique mDNS hostnames per device using a portion of the MAC address (e.g., `sensor-a1b2c3.local`) to avoid conflicts when deploying multiple identical devices — hostname collisions cause the mDNS probe to fail and the device to choose a random alternative.
- Enable `lru_purge_enable` in the ESP HTTP Server configuration to automatically close idle connections when the maximum is reached — without this, a client that opens a connection and abandons it consumes a connection slot indefinitely.
- Serve static web content from flash (EMBED_FILES) rather than a filesystem partition (SPIFFS, LittleFS) for configuration pages — filesystem access adds latency and failure modes, while flash-embedded content loads instantly and cannot be corrupted by power loss during a write.
- Add `Access-Control-Allow-Origin: *` headers to API responses if the configuration page is served from the device itself and makes AJAX calls — browsers enforce CORS even for local IP addresses, and missing headers cause the API calls to fail silently.
- Register the HTTP service via DNS-SD (`mdns_service_add`) even if the device does not need discovery — network scanning tools like Bonjour Browser and `dns-sd` become useful debugging aids for verifying the device is alive and advertising correctly.

## Caveats

- **mDNS does not work across subnets** — Multicast DNS queries are link-local (TTL=1) and do not cross routers or VLAN boundaries. Devices on different subnets cannot discover each other via mDNS without an mDNS reflector or proxy.
- **Windows mDNS support is inconsistent** — Windows 10 and later include an mDNS responder, but `.local` name resolution works reliably only in certain applications (browsers, PowerShell). Older Windows versions require Bonjour for Windows (Apple's mDNS implementation) or similar software.
- **ESP HTTP Server is not production-hardened** — The server does not implement rate limiting, request size limits beyond `content_len` checks, or protection against slowloris attacks. Exposing the server to untrusted networks requires additional firmware-level safeguards.
- **Concurrent TLS connections exhaust heap** — Running an HTTPS server with 4 concurrent connections requires 4 simultaneous TLS contexts, consuming 120–180 KB of RAM for TLS state alone. On ESP32, this leaves minimal heap for application logic. Using HTTP (not HTTPS) for local-only APIs avoids this cost when the threat model permits unencrypted local traffic.
- **mDNS hostname length is limited to 63 characters** — DNS label length restrictions apply; names exceeding this limit are silently truncated or rejected by the mDNS stack.
- **cJSON heap fragmentation** — Repeated parsing and freeing of JSON documents can fragment the MCU heap over time. For long-running devices, consider using a static JSON buffer or a streaming parser to avoid heap churn.

## In Practice

- A device that is discoverable via `device.local` on macOS and Linux but not on a Windows machine is hitting Windows' inconsistent mDNS resolution — installing Bonjour Print Services (which includes the mDNS responder) or using the device's IP address directly resolves the issue.
- An HTTP configuration page that works when one client is connected but returns errors when a second client loads the page simultaneously has reached the maximum connection limit — increasing `max_open_sockets` in the server config (at the cost of ~4 KB RAM per slot) or enabling LRU purge addresses this.
- A REST API that returns truncated JSON responses under load is exceeding the output buffer size — increasing the response buffer or splitting the response into smaller endpoints prevents truncation.
- A device that advertises via mDNS after boot but becomes undiscoverable after hours of operation typically has a task stack overflow in the mDNS task or a heap allocation failure preventing re-announcement — monitoring free heap and task high-water marks identifies the resource exhaustion.
- An embedded web page that loads the HTML but fails to fetch API data from the same device is blocked by CORS — the browser's developer console shows the blocked request, and adding the `Access-Control-Allow-Origin` header to the API response resolves it immediately.
- A fleet of identical devices deployed on the same network where only one is reachable via mDNS has a hostname collision — each device must use a unique hostname, and verifying uniqueness during provisioning prevents this issue.
