---
title: "TLS & DTLS on Constrained Devices"
weight: 30
---

# TLS & DTLS on Constrained Devices

Transport Layer Security (TLS) on a constrained microcontroller is a fundamentally different problem than TLS on a server or desktop. A server completes a TLS 1.3 handshake in under 1 ms with negligible memory impact. A Cortex-M4 at 120 MHz without hardware crypto takes 1–3 seconds for the same handshake, consuming 30–50 KB of RAM at peak — potentially half the available SRAM on a mid-range MCU. Every design decision in the TLS stack — cipher suite selection, certificate format, session management, buffer sizing — has measurable impact on performance, memory, and power consumption.

DTLS (Datagram TLS) extends TLS semantics to UDP, enabling encrypted communication for connectionless protocols like CoAP and custom telemetry. DTLS adds retransmission and reordering logic that TCP handles natively, creating additional memory and complexity overhead.

## TLS 1.2 vs TLS 1.3 Handshake

TLS 1.3 reduces the handshake from two round trips (TLS 1.2) to one, and eliminates several legacy cipher suites. On constrained devices, this translates to measurable improvements:

| Parameter | TLS 1.2 | TLS 1.3 |
|-----------|---------|---------|
| **Round Trips** | 2 (full handshake) | 1 (full handshake) |
| **Handshake Time (Cortex-M4 @ 120 MHz, no HW crypto)** | 2–3 seconds | 1.5–2 seconds |
| **Handshake Time (Cortex-M4 @ 120 MHz, HW AES+ECC)** | 0.8–1.5 seconds | 0.5–1.0 seconds |
| **Peak RAM (mbedTLS, certificate auth)** | 40–50 KB | 35–45 KB |
| **Peak RAM (mbedTLS, PSK auth)** | 15–25 KB | 12–20 KB |
| **Cipher Suites** | Dozens (many insecure) | 5 (all AEAD) |
| **0-RTT Resumption** | Not supported | Supported (with replay risk) |
| **Forward Secrecy** | Optional (depends on suite) | Mandatory |

The handshake time breakdown on a Cortex-M4 at 120 MHz (software-only crypto) for TLS 1.2 with ECDHE-ECDSA-AES128-GCM-SHA256:

```
Operation                          Time (ms)    % of Total
─────────────────────────────────────────────────────────
ECDHE key generation (P-256)         400–600      25%
ECDSA signature verify (P-256)       400–600      25%
Certificate parsing (DER, ~1 KB)      50–100       4%
AES-128-GCM key derivation            10–20        1%
SHA-256 transcript hash               20–40        2%
Network round trips (2x)            100–500       20%
Record layer framing                   10–30        1%
mbedTLS internal overhead            100–300       15%
─────────────────────────────────────────────────────────
Total                              1100–2200     100%
```

The ECC operations (ECDHE + ECDSA verify) dominate handshake time, accounting for roughly 50% of the total. Hardware ECC acceleration (available on STM32L5, nRF5340, and ATECC608A) reduces these operations from 400–600 ms each to 20–50 ms, cutting total handshake time by 40–50%.

## RAM Budget: mbedTLS Breakdown

mbedTLS (formerly PolarSSL) is the dominant TLS library for bare-metal and RTOS-based MCU projects. Understanding its memory allocation profile is essential for sizing the heap and avoiding out-of-memory crashes during handshake.

### Handshake Peak Memory

| Component | RAM (bytes) | Notes |
|-----------|------------|-------|
| SSL context (`mbedtls_ssl_context`) | 200–300 | Core state machine |
| SSL config (`mbedtls_ssl_config`) | 400–600 | Shared across connections |
| Handshake state (`mbedtls_ssl_handshake_params`) | 2,000–4,000 | Freed after handshake |
| Input record buffer | 16,384 (default) | Configurable down to 1 KB |
| Output record buffer | 16,384 (default) | Configurable down to 1 KB |
| Certificate chain (parsing) | 2,000–8,000 | Depends on chain depth |
| ECDHE working memory | 1,500–3,000 | Temporary during key exchange |
| X.509 CRT storage | 1,000–4,000 | Server cert + CA cert |
| Entropy/DRBG context | 500–1,000 | Random number generation |
| **Total (default buffers, cert auth)** | **~40,000–50,000** | |
| **Total (4 KB buffers, PSK auth)** | **~10,000–15,000** | |

### Steady-State Memory (After Handshake)

After the handshake completes, mbedTLS frees the handshake-specific structures. Steady-state memory for an active TLS session:

| Component | RAM (bytes) |
|-----------|------------|
| SSL context | 200–300 |
| Input record buffer | 16,384 (default) or 4,096 (reduced) |
| Output record buffer | 16,384 (default) or 4,096 (reduced) |
| Session state (keys, IVs) | 200–400 |
| **Total (default buffers)** | **~33,000–34,000** |
| **Total (4 KB buffers)** | **~8,500–9,000** |

### Buffer Size Configuration

The single most impactful memory optimization is reducing the TLS record buffers:

```c
// ESP-IDF sdkconfig (menuconfig → Component config → mbedTLS)
CONFIG_MBEDTLS_SSL_IN_CONTENT_LEN=4096
CONFIG_MBEDTLS_SSL_OUT_CONTENT_LEN=4096

// Bare-metal mbedTLS config.h
#define MBEDTLS_SSL_IN_CONTENT_LEN   4096
#define MBEDTLS_SSL_OUT_CONTENT_LEN  4096

// For CoAP/DTLS with small payloads, 1 KB buffers work:
#define MBEDTLS_SSL_IN_CONTENT_LEN   1024
#define MBEDTLS_SSL_OUT_CONTENT_LEN  1024
```

Reducing buffers from 16 KB to 4 KB saves approximately 24 KB of heap — significant on a device with 128–256 KB of SRAM. The trade-off is that TLS records larger than the buffer size trigger a `MBEDTLS_ERR_SSL_BUFFER_TOO_SMALL` error. Most IoT payloads (MQTT messages, CoAP responses, REST API calls) fit within 4 KB. Server certificates occasionally exceed 4 KB if the chain includes intermediate CAs — test against the actual server before deploying reduced buffers.

## DTLS for UDP Protocols

DTLS provides TLS security semantics over UDP, required by CoAP (RFC 7252), LwM2M, and custom UDP-based telemetry protocols. DTLS handles challenges that TCP resolves at the transport layer:

| Challenge | TCP (TLS handles automatically) | UDP (DTLS must handle) |
|-----------|--------------------------------|----------------------|
| Packet loss | TCP retransmits | DTLS retransmission timer |
| Reordering | TCP sequence numbers | DTLS epoch + sequence number |
| Fragmentation | TCP segments transparently | DTLS fragment offset/length |
| Replay detection | TCP sequence | DTLS anti-replay window |

DTLS adds approximately 2–4 KB of additional code size and 1–2 KB of additional RAM compared to TLS, primarily for the retransmission buffer and fragment reassembly.

### DTLS Configuration for CoAP

```c
// mbedTLS DTLS setup for CoAP communication
mbedtls_ssl_config conf;
mbedtls_ssl_config_init(&conf);

// Use DTLS (not TLS)
mbedtls_ssl_config_defaults(&conf,
    MBEDTLS_SSL_IS_CLIENT,
    MBEDTLS_SSL_TRANSPORT_DATAGRAM,   // DTLS mode
    MBEDTLS_SSL_PRESET_DEFAULT);

// DTLS retransmission timers
mbedtls_ssl_conf_handshake_timeout(&conf,
    1000,    // Initial timeout: 1 second
    60000);  // Max timeout: 60 seconds (exponential backoff)

// DTLS anti-replay protection
mbedtls_ssl_conf_dtls_anti_replay(&conf, MBEDTLS_SSL_ANTI_REPLAY_ENABLED);

// DTLS maximum fragment size (constrained networks)
mbedtls_ssl_conf_max_frag_len(&conf, MBEDTLS_SSL_MAX_FRAG_LEN_1024);

// CID (Connection ID) for NAT traversal — DTLS 1.2 extension
mbedtls_ssl_conf_dtls_connection_id(&conf, cid, cid_len);
```

**DTLS Connection ID (CID)** is a critical extension for IoT deployments where NAT rebinding changes the device's source IP/port. Without CID, a NAT rebind invalidates the DTLS session, forcing a full renegotiation. With CID, the DTLS layer identifies the session by the CID value rather than the IP 5-tuple, surviving NAT changes without renegotiation.

## Certificate vs PSK Authentication

The authentication method — X.509 certificates or Pre-Shared Keys (PSK) — has dramatic impact on handshake time, memory usage, and provisioning complexity.

| Parameter | Certificate (ECDSA) | PSK |
|-----------|-------------------|-----|
| **Handshake Time (Cortex-M4, no HW crypto)** | 2–3 seconds | 0.3–0.5 seconds |
| **Handshake Peak RAM** | 40–50 KB | 10–15 KB |
| **Flash for Credentials** | 2–4 KB (cert + key) | 32–64 bytes (PSK + identity) |
| **Authentication Strength** | Asymmetric (strong, standard) | Symmetric (strong, but key distribution risk) |
| **Provisioning** | PKI infrastructure required | Key must be securely provisioned per device |
| **Rotation** | Certificate renewal via ACME/EST | Requires secure channel to update PSK |
| **Scalability** | Excellent (CA validates any device) | Challenging (server must store N PSKs) |
| **Mutual Auth** | Client cert optional | Always mutual |

### PSK Configuration

```c
// mbedTLS PSK setup — client side
const unsigned char psk[] = {
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10
};  // 16-byte (128-bit) PSK — minimum recommended length

const char psk_identity[] = "device-001";

mbedtls_ssl_conf_psk(&conf,
    psk, sizeof(psk),
    (const unsigned char *)psk_identity,
    strlen(psk_identity));

// Restrict cipher suites to PSK-only
const int psk_ciphersuites[] = {
    MBEDTLS_TLS_PSK_WITH_AES_128_GCM_SHA256,
    MBEDTLS_TLS_PSK_WITH_AES_128_CCM,
    MBEDTLS_TLS_PSK_WITH_AES_128_CCM_8,     // 8-byte tag, saves 8 bytes/record
    0  // terminator
};
mbedtls_ssl_conf_ciphersuites(&conf, psk_ciphersuites);
```

PSK eliminates the asymmetric crypto operations that dominate handshake time and the certificate parsing that consumes RAM. The trade-off is provisioning — each device needs a unique PSK securely programmed during manufacturing, and the server must maintain a database of PSK-to-device mappings. For fleets of thousands of devices, PSK provisioning at scale requires a secure manufacturing flow (e.g., JTAG programming in a trusted factory with key injection from an HSM).

### Certificate Configuration

```c
// mbedTLS certificate setup — client side
mbedtls_x509_crt ca_cert;
mbedtls_x509_crt_init(&ca_cert);

// Parse CA certificate (DER format saves ~30% vs PEM)
mbedtls_x509_crt_parse_der(&ca_cert,
    ca_cert_der, ca_cert_der_len);

mbedtls_ssl_conf_ca_chain(&conf, &ca_cert, NULL);

// Optional: client certificate for mutual TLS
mbedtls_x509_crt client_cert;
mbedtls_pk_context client_key;
mbedtls_x509_crt_init(&client_cert);
mbedtls_pk_init(&client_key);

mbedtls_x509_crt_parse_der(&client_cert,
    client_cert_der, client_cert_der_len);
mbedtls_pk_parse_key(&client_key,
    client_key_der, client_key_der_len, NULL, 0);

mbedtls_ssl_conf_own_cert(&conf, &client_cert, &client_key);
```

## Hardware Crypto Acceleration

Hardware crypto engines reduce handshake time and free the CPU for application tasks during bulk encryption. The acceleration varies dramatically across MCU families:

| MCU / Secure Element | AES | SHA-256 | ECC (P-256) | RSA | True RNG |
|---------------------|-----|---------|-------------|-----|---------|
| ESP32 (Xtensa LX6) | HW | SW | SW | SW | HW |
| ESP32-S3 | HW | HW | SW | SW | HW |
| STM32L4 (Cortex-M4) | HW (some) | HW (some) | SW | SW | HW |
| STM32L5 (Cortex-M33) | HW | HW | HW (PKA) | HW (PKA) | HW |
| nRF5340 (Cortex-M33) | HW (CryptoCell-312) | HW | HW | HW (2048-bit) | HW |
| ATECC608A (ext SE) | HW (host side) | HW | HW (P-256 only) | — | HW |
| ATECC608B (ext SE) | HW | HW | HW (P-256) | — | HW |

### Impact on Handshake Time

```
TLS 1.2 Handshake: ECDHE-ECDSA-AES128-GCM-SHA256
Device: Cortex-M4 @ 120 MHz

Software only:          ████████████████████████████████  2200 ms
HW AES only:            ██████████████████████████████    2050 ms  (−7%)
HW AES + SHA-256:       ████████████████████████████      1900 ms  (−14%)
HW AES + SHA + ECC:     ████████████                       650 ms  (−70%)
HW AES + SHA + ECC      ██████████                         500 ms  (−77%)
  + session resumption:
```

ECC acceleration provides the largest single improvement because ECDHE key generation and ECDSA signature verification dominate the handshake. AES and SHA acceleration have modest impact on handshake time but significantly improve bulk data throughput.

### ATECC608A/B Integration

The ATECC608A is an external secure element connected via I2C (up to 1 MHz). It stores private keys in tamper-resistant hardware and performs ECC operations internally — the private key never leaves the chip.

```c
// ATECC608A integration with mbedTLS (via cryptoauthlib)
#include "atca_mbedtls_interface.h"

// Register ATECC608A as the PK (private key) engine
mbedtls_pk_context pk;
mbedtls_pk_init(&pk);

// Load the device certificate from ATECC608A slot 0
atca_mbedtls_pk_init(&pk, 0);  // Slot 0 holds the private key

// The ATECC608A performs ECDSA signing internally
// mbedTLS calls the pk_sign callback → routed to ATECC608A via I2C
// Signing takes ~50 ms on ATECC608A vs ~500 ms in software
```

The ATECC608A costs approximately $0.50–0.80 in volume and occupies a 3x3 mm UDFN package. For products requiring hardware-backed key storage (e.g., AWS IoT Core, Azure IoT Hub device provisioning), the ATECC608A provides both security and performance benefits.

## Session Resumption and Tickets

Full TLS handshakes are expensive on constrained devices. Session resumption mechanisms allow subsequent connections to skip the asymmetric crypto operations:

### TLS Session Resumption (Session ID)

The server stores session state and issues a session ID. On reconnection, the client presents the session ID, and both sides derive new keys from the cached master secret. This reduces the handshake to a single round trip with no asymmetric crypto.

**RAM cost:** ~100 bytes per cached session (session ID + master secret).

### TLS Session Tickets (RFC 5077)

The server encrypts the session state into a ticket and sends it to the client. The client stores the ticket and presents it on reconnection. The server decrypts the ticket to restore session state without maintaining per-client storage.

**RAM cost:** ~200–300 bytes per ticket on the client side. Zero server-side per-client storage.

```c
// Enable session tickets in mbedTLS
mbedtls_ssl_conf_session_tickets(&conf, MBEDTLS_SSL_SESSION_TICKETS_ENABLED);

// Cache the session after successful handshake
mbedtls_ssl_session session;
mbedtls_ssl_session_init(&session);
mbedtls_ssl_get_session(&ssl, &session);

// On reconnection, load the cached session
mbedtls_ssl_set_session(&ssl, &session);

// The resumed handshake skips ECDHE and certificate exchange
// Typical time: 100–300 ms vs 1500–2500 ms for full handshake
```

### TLS 1.3 0-RTT (Early Data)

TLS 1.3 supports 0-RTT resumption — the client sends application data in the first flight, before the handshake completes. This eliminates one round trip for the first data message.

**Caution:** 0-RTT data is vulnerable to replay attacks. The server must implement replay protection (e.g., single-use nonces, idempotent endpoints) for any 0-RTT data it accepts. For IoT sensor telemetry (inherently idempotent — a duplicate temperature reading causes no harm), 0-RTT is safe and beneficial.

## ECDSA vs RSA

RSA remains common on servers but is poorly suited to constrained devices:

| Operation | RSA-2048 (SW, Cortex-M4 @ 120 MHz) | ECDSA P-256 (SW, Cortex-M4 @ 120 MHz) | Ratio |
|-----------|-------------------------------------|---------------------------------------|-------|
| Sign | 3000–5000 ms | 400–600 ms | 6–8x faster |
| Verify | 200–400 ms | 400–600 ms | RSA verify is faster |
| Key Generation | 10–30 seconds | 400–600 ms | 20–50x faster |
| Public Key Size | 256 bytes | 64 bytes | 4x smaller |
| Signature Size | 256 bytes | 64 bytes | 4x smaller |
| Certificate Size | ~1000–1500 bytes | ~500–800 bytes | ~2x smaller |

ECDSA wins on every axis except verification speed — and on constrained devices, the client typically signs (for mutual TLS) and verifies the server's signature, so the combined time favors ECDSA.

RSA-2048 key generation (10–30 seconds on a Cortex-M4) makes on-device key generation impractical for RSA. ECDSA P-256 key generation completes in under 1 second, enabling on-device key generation during provisioning.

## Cipher Suite Selection for Minimal Footprint

Not all cipher suites are equal in code size and RAM consumption. The recommended suites for constrained devices:

| Cipher Suite | Code Size (mbedTLS) | RAM Impact | Security | Recommendation |
|-------------|-------------------|------------|----------|----------------|
| TLS_AES_128_GCM_SHA256 (TLS 1.3) | Baseline | Baseline | Strong | Primary choice |
| TLS_AES_128_CCM_SHA256 (TLS 1.3) | −2 KB | −500 B | Strong | Good for HW CCM |
| TLS_AES_128_CCM_8_SHA256 (TLS 1.3) | −2 KB | −500 B | Reduced tag | Bandwidth-constrained |
| ECDHE-ECDSA-AES128-GCM-SHA256 (1.2) | Baseline | Baseline | Strong | TLS 1.2 primary |
| PSK-AES128-GCM-SHA256 (1.2) | −15 KB | −20 KB | Strong | PSK-only deployments |
| PSK-AES128-CCM (1.2) | −17 KB | −20 KB | Strong | Minimal footprint |

### mbedTLS Compile-Time Optimization

Disabling unused features in `mbedtls_config.h` dramatically reduces code size:

```c
// Minimal mbedTLS config for PSK-only TLS 1.2
// Saves ~40–60 KB of flash compared to default config

// Disable RSA (saves ~15 KB flash)
#undef MBEDTLS_RSA_C
#undef MBEDTLS_KEY_EXCHANGE_RSA_ENABLED
#undef MBEDTLS_KEY_EXCHANGE_DHE_RSA_ENABLED

// Disable X.509 certificates (saves ~20 KB flash, ~10 KB RAM)
#undef MBEDTLS_X509_CRT_PARSE_C
#undef MBEDTLS_X509_CRL_PARSE_C
#undef MBEDTLS_PEM_PARSE_C

// Disable unused ciphers
#undef MBEDTLS_DES_C
#undef MBEDTLS_CAMELLIA_C
#undef MBEDTLS_ARIA_C
#undef MBEDTLS_CHACHA20_C     // Unless needed
#undef MBEDTLS_POLY1305_C     // Unless needed

// Disable unused hash algorithms
#undef MBEDTLS_SHA512_C       // SHA-384/512 not needed for AES-128-GCM
#undef MBEDTLS_MD5_C          // Deprecated, not used in modern suites

// Disable unused key exchange
#undef MBEDTLS_KEY_EXCHANGE_ECDHE_RSA_ENABLED
#undef MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED
#undef MBEDTLS_ECDSA_C
#undef MBEDTLS_ECDH_C

// Enable only PSK with AES-128-GCM
#define MBEDTLS_KEY_EXCHANGE_PSK_ENABLED
#define MBEDTLS_AES_C
#define MBEDTLS_GCM_C
#define MBEDTLS_SHA256_C

// Resulting flash: ~25–35 KB (vs 80–100 KB with full config)
// Resulting RAM:   ~10–15 KB peak during handshake
```

### Full Certificate Config (Minimal)

```c
// Minimal mbedTLS config for ECDSA certificate TLS 1.2
// ~50–65 KB flash, ~35–45 KB RAM peak

#define MBEDTLS_KEY_EXCHANGE_ECDHE_ECDSA_ENABLED
#define MBEDTLS_ECDSA_C
#define MBEDTLS_ECDH_C
#define MBEDTLS_ECP_C
#define MBEDTLS_ECP_DP_SECP256R1_ENABLED   // P-256 only
#define MBEDTLS_X509_CRT_PARSE_C
#define MBEDTLS_ASN1_PARSE_C
#define MBEDTLS_AES_C
#define MBEDTLS_GCM_C
#define MBEDTLS_SHA256_C
#define MBEDTLS_BIGNUM_C

// Disable everything else (RSA, DES, MD5, SHA-512, etc.)
// Use DER format for certificates (skip PEM parsing, saves ~3 KB)
#undef MBEDTLS_PEM_PARSE_C
```

## Tips

- Start with PSK authentication during development — the faster handshake (300–500 ms vs 2+ seconds) accelerates the debug cycle. Switch to certificate authentication before production if the deployment model requires it.
- Store certificates in DER format, not PEM. DER is the binary encoding that mbedTLS parses directly. PEM is base64-encoded DER with headers — parsing PEM requires base64 decoding (~3 KB of code) and produces the same DER output. Flash storage is also ~30% smaller with DER.
- Use `mbedtls_ssl_conf_max_frag_len()` to negotiate smaller fragment sizes with the server. The `MaxFragmentLength` extension (RFC 6066) tells the server to limit TLS record sizes to 512, 1024, 2048, or 4096 bytes. Not all servers support this extension — test against the production endpoint.
- Monitor heap usage during the TLS handshake with `mbedtls_memory_buffer_alloc_status()` or FreeRTOS `xPortGetFreeHeapSize()`. The peak occurs during certificate parsing and ECDHE computation — typically 2–5 seconds into the handshake. A heap-monitoring task logging free heap every 100 ms reveals the true peak.
- For MQTT over TLS, use persistent connections. A single TLS handshake amortized over thousands of MQTT PUBLISH messages is negligible. Reconnecting per message (a common beginner mistake) wastes 1–3 seconds and 500–1000 mA·s of charge per message.

## Caveats

- **Certificate expiration is a ticking time bomb on deployed devices** — A TLS certificate with a 1-year validity period means every device in the field stops connecting when the CA certificate expires. Embedded devices rarely have accurate wall-clock time after power loss unless an RTC with battery backup or NTP is available. Use certificates with long validity periods (10–20 years) for root CAs embedded in firmware, and implement certificate renewal (EST, ACME) for device certificates.
- **Server Name Indication (SNI) may be required** — Cloud services (AWS IoT, Azure IoT Hub) hosted behind load balancers require the client to send the SNI extension during the handshake so the server presents the correct certificate. mbedTLS supports SNI via `mbedtls_ssl_set_hostname()`, but omitting this call causes a handshake failure with an opaque "certificate verification failed" error.
- **mbedTLS heap allocation patterns cause fragmentation** — The handshake allocates and frees many small buffers in a pattern that fragments the heap over repeated connect/disconnect cycles. Using `mbedtls_memory_buffer_alloc_init()` with a dedicated memory pool (separate from the main heap) prevents TLS fragmentation from affecting application allocations.
- **DTLS over lossy networks amplifies handshake cost** — Each lost handshake packet triggers a retransmission timeout (starting at 1 second, doubling up to 60 seconds). On a network with 10% packet loss, a DTLS handshake can take 10–30 seconds due to retransmission delays. Reducing the initial timeout and implementing application-layer retry logic mitigates this.
- **Hardware crypto acceleration requires driver integration** — Enabling hardware AES or ECC in mbedTLS is not automatic. The MCU vendor's HAL driver must be integrated via mbedTLS's `MBEDTLS_AES_ALT` or `MBEDTLS_ECDSA_ALT` mechanism. Some vendor SDKs (ESP-IDF, nRF Connect SDK, STM32Cube) include these integrations; others require manual implementation.

## In Practice

- An ESP32 device connecting to AWS IoT Core with mutual TLS (client certificate in ATECC608A) completes the TLS 1.2 handshake in approximately 800 ms — the ATECC608A handles ECDSA signing in ~50 ms, and the ESP32's hardware AES accelerates the symmetric operations. Without the ATECC608A (software ECDSA on ESP32), the same handshake takes 2.2 seconds.
- A battery-powered Cortex-M4 sensor connecting to a CoAP server over DTLS with PSK authentication completes the handshake in 300–400 ms and enters a steady-state session consuming ~10 KB of RAM. With DTLS Connection ID enabled, the session survives NAT rebinds for weeks without renegotiation, keeping the expensive handshake as a one-time cost.
- A fleet of 10,000 devices using PSK authentication requires provisioning 10,000 unique PSKs. A common approach is deriving per-device PSKs from a master key and device serial number using HKDF: `PSK = HKDF(master_key, serial_number)`. The server derives the PSK from the PSK identity (which contains the serial number) using the same master key, avoiding the need to store 10,000 individual PSKs.
- An STM32L5-based industrial sensor running mbedTLS with the default configuration crashes during TLS handshake due to heap exhaustion — the 256 KB SRAM is shared with a sensor data buffer (80 KB), RTOS tasks (40 KB), and peripheral DMA buffers (20 KB), leaving only 100 KB for the heap. Reducing TLS buffers to 4 KB, using PSK instead of certificates, and enabling the PKA hardware accelerator (which uses less working memory than software ECC) reduces TLS peak RAM to 12 KB, fitting within the available heap.
- A product that initially used TLS 1.2 with RSA-2048 server certificates experienced 4–5 second handshake times on a Cortex-M4 without hardware crypto. Migrating the server to ECDSA P-256 certificates and enabling TLS 1.3 reduced handshake time to 1.2 seconds — without any hardware changes. The server certificate shrank from 1.4 KB to 600 bytes, also reducing network transfer time on slow links.
