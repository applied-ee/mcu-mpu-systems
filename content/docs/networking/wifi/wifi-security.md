---
title: "WiFi Security on Constrained Devices"
weight: 40
---

# WiFi Security on Constrained Devices

WiFi security on microcontrollers involves a different set of trade-offs than on desktop or server platforms. The available RAM limits which TLS cipher suites can be negotiated, the absence of a filesystem complicates certificate management, and the need to store network credentials in flash creates a persistent attack surface. A device shipping with a hardcoded WPA2 PSK in plaintext firmware is trivially compromised by anyone with a UART adapter or a flash dump tool — yet this remains the default pattern in a surprising number of production IoT products.

## WPA2-PSK vs WPA3-SAE

WPA2-PSK (Pre-Shared Key) uses a 4-way handshake to establish session keys from a shared passphrase. The fundamental weakness is that the handshake can be captured over the air and subjected to offline dictionary attacks — an attacker with a recorded handshake and a GPU cluster can brute-force weak passphrases without any further interaction with the network. WPA3-SAE (Simultaneous Authentication of Equals) replaces the PSK handshake with a zero-knowledge proof protocol derived from Dragonfly key exchange. SAE is resistant to offline dictionary attacks because each authentication attempt requires real-time interaction with the access point — a captured handshake is cryptographically useless to an offline attacker.

| Property | WPA2-PSK | WPA3-SAE |
|---|---|---|
| Key exchange | 4-way handshake (PSK-derived PMK) | Dragonfly (SAE commit/confirm) |
| Offline dictionary attack | Vulnerable — captured handshake can be brute-forced | Resistant — each attempt requires live AP interaction |
| Forward secrecy | No — compromised PSK decrypts past traffic | Yes — unique session keys per association |
| PMF (Protected Management Frames) | Optional | Mandatory |
| Minimum cipher | CCMP (AES-128) | CCMP (AES-128), GCMP preferred |
| ESP32 support (ESP-IDF 5.x) | Full support | Supported on ESP32, ESP32-S2, ESP32-S3, ESP32-C3 |
| ESP32 RAM overhead | ~2 KB additional over open auth | ~4–6 KB additional over WPA2-PSK |
| Pico W (CYW43439) support | Full support | Not supported in current driver |
| ATWINC1500 support | Full support | Not supported |
| Typical AP compatibility | Universal | Requires WiFi 6 or recent firmware on many APs |

WPA3 transition mode allows a network to accept both WPA2 and WPA3 clients simultaneously, which is the most common deployment scenario during the migration period. However, transition mode reintroduces the offline attack surface for the WPA2 portion — an attacker can force a downgrade by deauthenticating a WPA3 client and capturing the subsequent WPA2 reconnection. For maximum security, WPA3-only mode eliminates this vector but requires all clients to support SAE.

## TLS Stack RAM Cost

Any device connecting to a cloud service over HTTPS or MQTTS needs a TLS stack. On constrained MCUs, the dominant implementation is mbedTLS (formerly PolarSSL), which ships with ESP-IDF, Zephyr, and many vendor SDKs. The RAM cost is substantial and varies by configuration.

| mbedTLS Component | Typical RAM (KB) | Notes |
|---|---|---|
| TLS handshake buffers | 8–12 | Two 4 KB I/O buffers minimum; 16 KB each for full-size records |
| X.509 certificate parsing | 4–8 | Scales with certificate chain depth |
| RSA-2048 key operations | 8–12 | Peak allocation during handshake; freed after key exchange |
| ECDSA P-256 operations | 3–5 | Significantly lighter than RSA |
| Session ticket/cache | 1–2 | For session resumption |
| Cipher context (AES-128-GCM) | 1–2 | Persistent during connection |
| **Total (RSA server cert)** | **30–45** | Typical for a single TLS 1.2 connection |
| **Total (ECDSA server cert)** | **20–35** | Using ECDHE-ECDSA cipher suite |
| **Total (TLS 1.3, ECDSA)** | **18–30** | Simplified handshake, fewer round trips |

On an ESP32 with 320 KB of SRAM, a single TLS connection consumes roughly 10% of available RAM. Opening two simultaneous TLS connections — common when connecting to both an MQTT broker and an HTTPS API — can push total TLS RAM usage to 60–80 KB, leaving limited headroom for application logic. Reducing `MBEDTLS_SSL_IN_CONTENT_LEN` and `MBEDTLS_SSL_OUT_CONTENT_LEN` from 16384 to 4096 bytes saves 24 KB but limits the maximum TLS record size, which can cause issues with servers that send large certificate chains in a single record.

```c
/* ESP-IDF sdkconfig options to reduce TLS RAM usage */
/* In sdkconfig or menuconfig: */
CONFIG_MBEDTLS_ASYMMETRIC_CONTENT_LEN=y
CONFIG_MBEDTLS_SSL_IN_CONTENT_LEN=4096
CONFIG_MBEDTLS_SSL_OUT_CONTENT_LEN=2048
CONFIG_MBEDTLS_DYNAMIC_BUFFER=y          /* Allocate buffers only during handshake */
CONFIG_MBEDTLS_SSL_KEEP_PEER_CERTIFICATE=n  /* Free peer cert after verification */
```

## Certificate Pinning Without a Full CA Store

Desktop browsers ship with a CA store containing 100+ root certificates, consuming hundreds of kilobytes. On an MCU, the typical approach is to embed only the specific CA certificate(s) needed to verify the server — often just the root CA that signs the cloud provider's certificate (e.g., Amazon Root CA 1 for AWS IoT, DigiCert Global Root G2 for Azure IoT Hub). This reduces the CA store from hundreds of certificates to one or two, saving significant flash space.

Certificate pinning goes further by validating that the server's certificate matches a known fingerprint, independent of the CA chain. Two common approaches exist:

**Public Key Hash Pinning** — Store the SHA-256 hash of the server's public key (SubjectPublicKeyInfo). This survives certificate renewal as long as the server operator reuses the same key pair. The pin occupies 32 bytes of flash per pinned key.

```c
/* Public key pin verification in mbedTLS callback */
static int pin_verify_callback(void *data, mbedtls_x509_crt *crt,
                                int depth, uint32_t *flags) {
    if (depth != 0) return 0;  /* Only check leaf certificate */

    uint8_t pubkey_hash[32];
    uint8_t der_buf[512];
    int der_len = mbedtls_pk_write_pubkey_der(&crt->pk, der_buf, sizeof(der_buf));
    if (der_len < 0) return MBEDTLS_ERR_X509_FATAL_ERROR;

    /* DER data is written to end of buffer */
    mbedtls_sha256(der_buf + sizeof(der_buf) - der_len, der_len, pubkey_hash, 0);

    const uint8_t *expected_pin = (const uint8_t *)data;
    if (memcmp(pubkey_hash, expected_pin, 32) != 0) {
        *flags |= MBEDTLS_X509_BADCERT_NOT_TRUSTED;
        return 0;
    }
    return 0;
}
```

**CA Subset Pinning** — Embed the specific root CA certificate in firmware and configure mbedTLS to use only that certificate for chain verification. This is simpler to implement and survives server certificate rotation (as long as the CA remains the same) but does not protect against a compromised CA issuing rogue certificates.

The trade-off: public key pinning provides stronger security but requires a firmware update when the server rotates keys. CA subset pinning is more resilient to routine certificate renewals but offers weaker assurance. In production, combining CA subset pinning with an OTA update mechanism for emergency pin rotation provides a practical balance.

## Enterprise Authentication with Secure Elements

WPA2-Enterprise using EAP-TLS provides per-device authentication with individual client certificates, eliminating shared secrets entirely. Each device presents a unique X.509 certificate during the 802.11 association, and the RADIUS server verifies the device's identity against a certificate authority. This is the gold standard for fleet deployments where devices connect to managed enterprise networks.

The challenge on MCUs is protecting the client's private key. Storing an RSA-2048 or ECC P-256 private key in plaintext flash means any physical attacker with a JTAG probe or flash reader can extract the key, clone the device identity, and impersonate it on the network. Secure elements solve this by generating and storing keys in tamper-resistant hardware that never exposes the raw key material.

The Microchip ATECC608A (now ATECC608B) is the most widely used secure element in IoT contexts. It stores up to 16 ECC P-256 key pairs in hardware-protected slots, performs ECDSA sign operations internally in ~50 ms, and costs under $0.60 in volume. The authentication flow for EAP-TLS with a secure element:

1. **Provisioning (factory)** — Generate an ECC P-256 key pair inside the ATECC608A. Export the public key. Submit a Certificate Signing Request (CSR) to the device CA. Write the signed device certificate to a data slot on the ATECC608A or to MCU flash (the certificate is public data).
2. **Association (runtime)** — The supplicant (firmware) initiates 802.11 association. The AP requests EAP-TLS authentication via EAPOL frames. The firmware sends the device certificate to the RADIUS server.
3. **Challenge-response** — The RADIUS server sends a challenge. The firmware passes the challenge hash to the ATECC608A over I2C, which performs the ECDSA sign operation internally and returns the signature. The firmware sends the signature to the RADIUS server.
4. **Verification** — The RADIUS server verifies the signature against the device's public key (from the certificate). If valid, the server issues the PMK and the 4-way handshake proceeds.

```c
/* ESP-IDF EAP-TLS configuration with ATECC608A */
/* Requires esp-cryptoauthlib component */

#include "esp_wpa2.h"
#include "cryptoauthlib.h"

/* Load device certificate from ATECC608A or flash */
extern const uint8_t client_cert_pem_start[] asm("_binary_client_crt_start");
extern const uint8_t client_cert_pem_end[]   asm("_binary_client_crt_end");
extern const uint8_t ca_cert_pem_start[]     asm("_binary_ca_crt_start");
extern const uint8_t ca_cert_pem_end[]       asm("_binary_ca_crt_end");

void configure_eap_tls(void) {
    esp_wifi_sta_wpa2_ent_set_ca_cert(ca_cert_pem_start,
        ca_cert_pem_end - ca_cert_pem_start);
    esp_wifi_sta_wpa2_ent_set_cert_key(client_cert_pem_start,
        client_cert_pem_end - client_cert_pem_start,
        NULL, 0,  /* Private key handled by secure element */
        NULL, 0);
    esp_wifi_sta_wpa2_ent_set_identity((const uint8_t *)"device-001", 10);
    esp_wifi_sta_wpa2_ent_enable();
}
```

## Secure Credential Storage Patterns

For WPA2-PSK deployments where a secure element is not present, credential storage remains a critical vulnerability. Common approaches, ranked from weakest to strongest:

| Approach | Security Level | Flash Cost | Notes |
|---|---|---|---|
| Plaintext in firmware binary | None | 0 extra | Extractable via flash dump or binary analysis |
| XOR obfuscation | Trivial | ~64 bytes | Provides no real security; deters only casual inspection |
| NVS encryption (ESP-IDF) | Moderate | 4 KB partition + key | AES-256-XTS; key stored in eFuse (one-time programmable) |
| Secure element (ATECC608A) | Strong | External IC | Key never leaves hardware; ~$0.60 BOM cost |
| Provisioning at runtime only | Strong | 0 persistent | Credentials held in RAM only; re-provisioned after every power cycle |

On ESP32, the NVS (Non-Volatile Storage) encryption feature encrypts the NVS flash partition using an AES-256 key stored in the eFuse block. Once the eFuse key is burned and flash encryption is enabled, the plaintext credentials cannot be extracted from the flash chip even with physical access. However, the credentials are still accessible in RAM during runtime, and a JTAG debugger can read them unless JTAG is disabled via eFuse as well.

```c
/* ESP-IDF: Storing WiFi credentials in encrypted NVS */
#include "nvs_flash.h"
#include "nvs.h"

esp_err_t store_wifi_credentials(const char *ssid, const char *password) {
    nvs_handle_t handle;
    esp_err_t err = nvs_open("wifi_config", NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_set_str(handle, "ssid", ssid);
    if (err != ESP_OK) { nvs_close(handle); return err; }

    err = nvs_set_str(handle, "password", password);
    if (err != ESP_OK) { nvs_close(handle); return err; }

    err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}
```

Enabling flash encryption and secure boot together provides the strongest protection available on ESP32 without an external secure element. Flash encryption prevents reading firmware or NVS contents from the flash chip. Secure boot prevents flashing modified firmware that could exfiltrate credentials. JTAG disable prevents runtime memory inspection. This combination closes the primary attack vectors for credential extraction, though side-channel attacks and voltage glitching remain theoretical concerns for high-value targets.

## Hardcoded PSK Vulnerabilities

The most common security failure in production IoT firmware is a WiFi PSK compiled directly into the firmware binary. This creates several problems:

- **Every device shares the same credential** — Compromising one device compromises the entire fleet's network access.
- **The credential is extractable** — Running `strings` on a firmware binary or dumping flash via SPI reveals the PSK in seconds.
- **Rotation is impossible without OTA** — Changing the network password requires updating every device's firmware.
- **Firmware updates transmit the credential** — Unless the OTA payload is encrypted, the PSK travels in the update image.

The mitigation is per-device provisioning: each device receives its unique network credentials during manufacturing or first-boot setup (via BLE, SoftAP, or a provisioning jig). The credentials are stored in an encrypted NVS partition or secure element, and the firmware binary contains no network secrets.

## Tips

- Use WPA3-SAE on ESP32 targets where AP compatibility allows it — the forward secrecy property means a compromised PSK does not retroactively expose captured traffic, which matters for devices deployed in physically accessible locations.
- Reduce TLS RAM consumption by enabling `MBEDTLS_DYNAMIC_BUFFER` in ESP-IDF — this allocates handshake buffers only during the TLS negotiation and frees them after the session is established, recovering 10–20 KB of heap.
- Pin the server's public key hash rather than the full certificate to survive routine certificate renewals without firmware updates — but maintain an OTA path for emergency pin rotation.
- Burn the JTAG-disable eFuse on production ESP32 boards after initial development — this closes the runtime memory inspection vector for credential extraction.
- Use `esp_flash_encryption_enabled()` at boot to verify flash encryption is active before proceeding with normal operation — a device that boots without encryption due to a provisioning error should refuse to connect to the network.

## Caveats

- **WPA3-SAE increases association time** — The Dragonfly handshake involves computationally expensive elliptic curve operations; on ESP32, SAE association takes 200–500 ms longer than WPA2-PSK, which affects reconnection latency in power-sensitive applications.
- **TLS 1.3 support varies by server** — Some legacy MQTT brokers and cloud endpoints still require TLS 1.2; forcing TLS 1.3 on the client side can cause silent connection failures if the server does not support it.
- **Certificate expiration is a fleet-bricking risk** — A root CA certificate embedded in firmware expires after 10–25 years, but intermediate certificates may expire in 1–5 years; a fleet of devices with an expired pinned certificate cannot establish TLS connections until firmware is updated.
- **NVS encryption on ESP32 is irreversible** — Once flash encryption eFuses are burned in release mode, the decision cannot be undone; a firmware bug in the NVS handling code can permanently lock out the encrypted partition.
- **Secure elements add I2C bus contention** — The ATECC608A shares the I2C bus with sensors or other peripherals; a 50 ms ECDSA operation blocks the bus unless the application uses an I2C mutex and handles the latency.

## In Practice

- A device fleet that starts failing to connect after a year in the field often has an expired intermediate CA certificate embedded in firmware — the root CA is still valid, but the server renewed its certificate chain with a different intermediate that the device does not trust.
- Firmware that connects reliably to a home AP but fails on enterprise networks typically lacks proper EAP-TLS configuration or has a certificate format mismatch — DER vs PEM encoding mismatches are a common source of silent failures in the supplicant.
- A device that associates with WPA3 at the bench but falls back to WPA2 in deployment is likely connecting to an AP running in WPA3 transition mode with management frame protection disabled — checking the association log for the negotiated security protocol confirms the downgrade.
- An ESP32 device that intermittently fails TLS handshakes under load often has insufficient heap for the handshake buffers — adding heap monitoring before `mbedtls_ssl_handshake()` reveals whether the allocation is failing due to fragmentation.
- A production device that works correctly but leaks the PSK when subjected to a firmware dump was shipped without flash encryption — enabling it retroactively in the field is possible on ESP32 but requires careful sequencing to avoid bricking devices.
