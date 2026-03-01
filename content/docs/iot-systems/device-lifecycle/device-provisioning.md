---
title: "Device Provisioning"
weight: 20
---

# Device Provisioning

Device provisioning is the process of assigning a unique identity and initial credentials to a device so it can authenticate to cloud services, peer devices, or local gateways. Provisioning spans from the factory floor — where silicon serial numbers and cryptographic keys are first bound together — through field activation, where a device autonomously enrolls itself into a fleet. A provisioning failure leaves a device either unable to connect at all or, worse, connected with weak or shared credentials that compromise the entire fleet. The low-level secure boot chain and hardware trust anchors overlap with [OTA Firmware Updates]({{< relref "/docs/iot-systems/device-lifecycle/ota-firmware-updates" >}}), but this page focuses on the identity lifecycle: how a device goes from bare silicon to an authenticated member of a managed fleet.

## Device Identity Models

Every connected device needs an identity that a backend can verify. Three dominant models exist, each with different security, scalability, and cost profiles:

- **X.509 certificates** — The device holds a private key and a certificate signed by a trusted Certificate Authority (CA). Authentication happens via mutual TLS (mTLS), where both the device and the server present certificates. AWS IoT Core, Azure IoT Hub, and Google Cloud IoT all support X.509 as the primary identity model. Certificate lifetimes range from 1 year (high-security deployments) to 10+ years (devices with no practical way to renew). A typical device certificate is 500–1500 bytes depending on key size and chain depth.
- **Symmetric keys** — A shared secret (typically 32–64 bytes) is provisioned to both the device and the cloud. Authentication uses HMAC-based challenge-response or derives session tokens from the shared key. Simpler to implement than PKI — no certificate parsing, no chain validation — but the shared secret must be protected on both endpoints. Azure IoT Hub supports symmetric key authentication with SAS tokens derived via HMAC-SHA256.
- **TPM-based attestation** — Devices equipped with a Trusted Platform Module (TPM 2.0) use the Endorsement Key (EK) burned into the TPM at manufacture as a root of trust. The cloud service verifies the EK against a registry of known TPMs. This model avoids ever exposing a secret outside the TPM but requires backend infrastructure that understands TPM attestation flows.

X.509 certificates dominate production IoT deployments because they scale without sharing secrets — each device has a unique key pair, and compromising one device does not reveal credentials for others.

## Unique Device ID Sources

Before a device can receive a certificate or key, it needs a stable, unique identifier. Common sources:

- **Silicon serial numbers** — Most MCUs embed a factory-programmed unique ID. STM32 devices have a 96-bit unique device ID at a fixed memory address (e.g., `0x1FFF7A10` on STM32F4). ESP32 chips expose a 48-bit MAC address via `esp_efuse_mac_get_default()`. These IDs are immutable and available without any provisioning step.
- **MAC addresses** — Pre-assigned by the radio chipset vendor. Globally unique (in theory) and often used as device identifiers for simplicity. However, MAC addresses are transmitted in the clear on the network, so using them as the sole identity component is insufficient for authentication.
- **eFuse-programmed IDs** — Some SoCs (ESP32, NXP i.MX) provide one-time-programmable eFuse banks where a factory can burn a custom serial number or key hash. Once blown, eFuses cannot be changed — this provides a hardware root of trust for identity binding.
- **Secure element serial numbers** — Devices like the ATECC608 and STSAFE-A110 have factory-programmed serial numbers that are cryptographically bound to the key material stored inside the element. The serial number alone is not a secret, but it serves as a tamper-evident link between the physical device and its credentials.

The best practice is to derive the device identity from a hardware-bound identifier that cannot be cloned or extracted via software. Silicon serial numbers combined with secure element key storage satisfy this requirement.

## Secure Element Integration

Secure elements provide tamper-resistant storage for private keys and perform on-chip cryptographic operations so that key material never appears on an external bus:

- **Microchip ATECC608** — Stores up to 16 key slots, supports ECDSA-P256 sign/verify, ECDH key agreement, and SHA-256 HMAC. Key generation happens on-chip; the private key is never exported. Communicates over I2C at up to 1 MHz. An ECDSA-P256 sign operation takes ~50 ms. The ATECC608 is the most widely used secure element in IoT, supported by AWS IoT, Azure IoT, and most embedded TLS stacks (mbedTLS, wolfSSL). Cost is $0.50–$1.00 per unit in volume.
- **STMicroelectronics STSAFE-A110** — Targets STM32 ecosystems. Stores X.509 certificates and key pairs, supports ECDSA and AES-based symmetric operations. Includes a secure counter for anti-replay protection. Communicates over I2C.
- **Infineon OPTIGA Trust M** — Supports RSA and ECC key storage, X.509 certificate management, and TLS integration via a PKCS#11-like interface. Provides a built-in certificate chain back to Infineon's root CA, enabling zero-touch cloud provisioning without factory-side key injection.

When a secure element is present, the provisioning workflow changes: instead of injecting a pre-generated private key into the device, the device generates its own key pair inside the secure element and exports only the public key (as a Certificate Signing Request) for the CA to sign.

## Factory Provisioning

Factory provisioning happens during manufacturing, before the device ships:

1. **Hardware identity capture** — The production fixture reads the silicon serial number or secure element ID via JTAG, SWD, or I2C.
2. **Key generation** — Either the factory HSM generates a key pair and injects it into the device, or the device's secure element generates the key pair on-chip and exports a CSR.
3. **Certificate issuance** — A local CA (or a registration authority connected to the fleet CA) signs the device's public key and returns an X.509 certificate. The certificate includes the device ID in the Common Name (CN) or Subject Alternative Name (SAN) field.
4. **Credential storage** — The certificate and (if applicable) private key are written to the device's secure element, protected flash region, or provisioning partition. On devices without secure elements, the private key often lands in a flash region protected by read-out protection (RDP level 1 on STM32, or the equivalent CRP on NXP).
5. **Registry enrollment** — The device's identity (certificate fingerprint, serial number, device group) is registered with the cloud platform. AWS IoT calls this "thing registration"; Azure uses "device enrollment."

Factory provisioning adds 5–30 seconds per device on the production line, depending on whether key generation is on-chip or HSM-based. For runs of 10,000+ units, this translates directly to manufacturing cost. Dedicated provisioning stations with parallel fixtures (flashing 8–16 boards simultaneously) reduce per-unit time to under 3 seconds.

## Field Provisioning

Field provisioning defers credential assignment until the device first powers on at its deployment site. The device ships with a bootstrap credential — just enough to authenticate once and request its permanent identity:

- **Bootstrap token provisioning** — The device carries a one-time-use token (embedded in firmware or printed as a QR code on the label). On first boot, it presents the token to a provisioning service, which validates it against a token registry, issues a device certificate, and invalidates the token. This pattern works well for consumer devices where the end user activates the device.
- **Claim-based provisioning (AWS IoT Fleet Provisioning)** — Devices ship with a shared "claim certificate" that grants permission only to call the provisioning API. The device uses the claim certificate to request a unique device certificate. The provisioning service validates the request against a provisioning template (which may check the device's serial number against an allowlist) and returns a unique certificate. The claim certificate has limited permissions — it cannot publish or subscribe to data topics.
- **EST (Enrollment over Secure Transport, RFC 7030)** — The device connects to an EST server over TLS (using a bootstrap certificate or HTTP basic auth) and requests a new certificate via a `/simpleenroll` endpoint. EST supports certificate renewal via `/simplereenroll`. Designed for enterprise environments where an existing PKI infrastructure already manages certificate lifecycle. The protocol is lightweight enough for constrained devices — an EST transaction involves 2–4 HTTPS round trips.
- **SCEP (Simple Certificate Enrollment Protocol)** — An older protocol common in enterprise network equipment. The device sends a PKCS#10 CSR wrapped in a PKCS#7 envelope to a SCEP server, which returns a signed certificate. SCEP requires the device to have a one-time challenge password. Less common in IoT than EST because SCEP lacks native TLS integration and has weaker security properties, but still encountered in brownfield deployments integrating with existing Microsoft NDES (Network Device Enrollment Service) infrastructure.

## Factory vs. Field Provisioning Tradeoffs

| Dimension | Factory | Field |
|-----------|---------|-------|
| Identity assurance | High — controlled environment, HSM-backed CA | Medium — depends on bootstrap credential security |
| Manufacturing cost | Higher — provisioning station, HSM license, per-unit time | Lower — ship generic firmware |
| Logistics complexity | High — must track which certificates go to which devices | Lower — devices self-register |
| Offline operation | Device works immediately out of the box | Requires network access on first boot |
| Credential revocation | Replace at factory (expensive) | Re-provision remotely (cheaper) |
| Supply chain risk | Key injection on the factory floor creates exposure points | Bootstrap tokens can leak if QR codes are photographed |

Most large-scale deployments use factory provisioning for high-security applications (medical devices, industrial controllers) and field provisioning for consumer or high-volume devices where per-unit manufacturing cost dominates.

## Fleet Provisioning at Scale

Provisioning 100 devices manually is tedious. Provisioning 100,000 requires automation:

- **Provisioning templates** — AWS IoT Fleet Provisioning templates define the rules for auto-creating device resources (thing name, certificate, policy attachments, thing group membership) based on parameters the device presents during enrollment. A single template can handle an entire product line.
- **Batch certificate generation** — For factory provisioning at scale, the CA pre-generates thousands of certificates in a batch. Each certificate is assigned a serial-number-to-certificate mapping stored in a provisioning database. The factory fixture looks up the device's silicon serial number, retrieves the corresponding certificate, and injects it. AWS IoT supports `register-certificate-without-thing` for pre-registering certificates before the device exists.
- **Just-in-time registration (JITR)** — Devices are provisioned with certificates signed by a CA that is registered with the cloud platform, but the devices are not individually pre-registered. When a device first connects, the platform triggers a Lambda function (or equivalent) that creates the device's cloud-side resources on demand. This eliminates the need for a provisioning database but requires careful Lambda logic to handle race conditions and duplicate registrations.
- **Just-in-time provisioning (JITP)** — Similar to JITR but uses a provisioning template associated with the CA certificate. When an unknown device connects with a certificate signed by the registered CA, the platform automatically provisions it according to the template. No custom Lambda required — the template defines the thing name pattern, policy, and group membership.

## Provisioning Workflow State Machine

A robust provisioning workflow follows a deterministic state machine to ensure devices reach a fully provisioned state or fail cleanly:

```
UNPROVISIONED → BOOTSTRAP → ENROLL → CREDENTIAL_STORE → REGISTER → VERIFY → PROVISIONED
                                                                       ↓ (failure)
                                                                    QUARANTINE
```

1. **Unprovisioned** — Device has no credentials beyond factory-burned hardware IDs.
2. **Bootstrap** — Device loads its bootstrap credential (claim certificate, token, or initial PSK) and establishes a TLS connection to the provisioning endpoint.
3. **Enroll** — Device generates a key pair (on-chip if a secure element is present), creates a CSR, and submits it to the provisioning service or EST/SCEP server.
4. **Credential store** — The returned certificate and any associated configuration (MQTT endpoint, topic prefixes, thing group) are written to the device's secure storage.
5. **Register** — The device's identity is recorded in the fleet registry (thing shadow created, device twin instantiated, group membership assigned).
6. **Verify** — The device disconnects from the provisioning endpoint and reconnects using its permanent credentials to confirm end-to-end authentication works.
7. **Quarantine** — If any step fails after maximum retries (typically 3–5 attempts with exponential backoff), the device enters a quarantine state. It stops attempting provisioning and signals the failure via a status LED or local diagnostic interface. Quarantined devices require manual intervention or a factory reset to retry.

Storing the current state in non-volatile memory (a provisioning status register in flash or EEPROM) ensures the device can resume from the correct step after a power cycle rather than restarting the entire flow.

## Tips

- Generate private keys inside the secure element rather than injecting externally generated keys. On-chip key generation ensures the private key never exists outside tamper-resistant silicon — not on the factory HSM's export log, not in transit, not in a provisioning database backup.
- Use the device's silicon serial number as a component of the certificate Common Name (e.g., `CN=product-AABBCCDD1122`). This creates a verifiable link between the physical hardware and its digital identity that survives firmware reflashes and factory resets.
- Implement provisioning idempotency — if a device runs the provisioning flow a second time (due to power loss or reset), the backend should detect the duplicate and return the existing credentials rather than creating a second identity. Duplicate device identities in the fleet registry cause shadow conflicts and telemetry routing errors.
- Store provisioning state in non-volatile memory at each step of the state machine. A power loss during the enrollment phase that forces a full restart from the bootstrap step wastes one-time tokens and creates orphaned certificate requests in the CA.
- Test the provisioning flow with the bootstrap credential revoked. The most common field failure is a claim certificate that has expired or been revoked after a firmware build but before device deployment. A 90-day-old firmware image on warehouse shelves may carry an expired bootstrap credential.
- Pre-register device CA certificates with every cloud region the fleet may connect to. A device that roams to a different region and presents a certificate signed by an unregistered CA receives a TLS handshake failure with no helpful error message on the device side.

## Caveats

- **Symmetric key provisioning does not scale securely past a few thousand devices.** Every device shares a secret with the backend, and the backend must store all secrets. A backend database breach exposes every device's credential simultaneously. X.509 certificate-based identity avoids this because the backend never holds private keys — it only needs the CA certificate to validate device certificates.
- **Claim certificates used for fleet provisioning are shared across all devices in a product line.** If the claim certificate's private key is extracted from one device's firmware (via JTAG, flash dump, or firmware reverse engineering), an attacker can provision unlimited rogue devices. Rate-limiting the provisioning API and binding provisioning requests to hardware serial number allowlists mitigate this risk but do not eliminate it.
- **Secure element provisioning adds I2C transaction time to the manufacturing flow.** An ATECC608 key generation takes ~50 ms, but writing key slots, configuring the zone locks, and reading back the public key can take 200–500 ms total. On a high-speed production line running 1 device per second, this bottleneck requires parallel fixtures or a pre-provisioning step.
- **Certificate expiration in long-lived deployments is a time bomb.** A device provisioned with a 10-year certificate and deployed in an inaccessible location (embedded in concrete, underwater sensor) will stop authenticating when the certificate expires. Renewal requires either an automated re-enrollment protocol (EST `/simplereenroll`) or manual replacement. Deployments that lack renewal infrastructure should use the maximum practical certificate lifetime and calendar-based monitoring.
- **Factory provisioning databases that map serial numbers to certificates become single points of failure.** If the database is lost, corrupted, or desynchronized with the CA, there is no way to determine which device holds which certificate. Periodic database backups and cryptographic binding (embedding the serial number in the certificate SAN field) provide recovery paths.

## In Practice

- **A device that fails TLS handshake on first boot but works after manual certificate injection** typically indicates a field provisioning flow that never completed. The bootstrap credential may have expired, the provisioning endpoint may be unreachable from the deployment network, or the provisioning service rejected the device's serial number because it was not on the allowlist. Checking the provisioning state register (if implemented) reveals which step failed.
- **Devices that authenticate successfully for months and then suddenly fail with certificate errors** are hitting certificate expiration. The failure appears abrupt because TLS validation is binary — one day before expiry the certificate is valid, one day after it is rejected. Monitoring the `Not After` field across the fleet and alerting at 30 and 7 days before expiry prevents surprises.
- **A batch of factory-provisioned devices where 2–3% fail authentication on first cloud connection** often points to a race condition in the factory provisioning station. The certificate was issued and stored on the device, but the registry enrollment step (registering the certificate with the cloud platform) was skipped or failed silently. The device holds a valid certificate that the cloud does not recognize.
- **Devices provisioned with a secure element that lose their identity after firmware reflash** have a firmware image that reinitializes the secure element's configuration zone on boot, overwriting the provisioned key slots. The secure element's zone lock bits must be set during provisioning to prevent subsequent firmware from modifying locked slots.
- **Fleet provisioning that works in development but fails in production at scale** frequently hits API rate limits on the cloud provisioning endpoint. AWS IoT Fleet Provisioning has a default rate of 50 transactions per second. A factory line that powers on 200 devices simultaneously during a batch test overwhelms the endpoint, and failed provisioning attempts with one-time tokens leave devices in an unrecoverable state without token regeneration.
