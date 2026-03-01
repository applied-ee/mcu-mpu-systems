---
title: "OTA Firmware Updates"
weight: 10
---

# OTA Firmware Updates

Over-the-air (OTA) firmware updates allow deployed devices to receive new firmware without physical access or debug probes. The update lifecycle spans far more than the actual flash write — it involves delivery infrastructure, transport protocols, image verification, partition management, and rollback strategies that determine whether a fleet of thousands stays healthy or bricks itself simultaneously. The low-level bootloader mechanics (dual-bank flash, boot swap, vector table relocation) are covered in [Flashing & Boot Modes]({{< relref "/docs/development/toolchains-and-build-systems/flash-and-boot" >}}). This page focuses on the system-level update pipeline: how firmware images move from a build server to a running device and what happens when something goes wrong along the way.

## Update Delivery Models

Two fundamental approaches exist for getting firmware to devices:

- **Pull model** — The device periodically checks a known endpoint (HTTP server, S3 bucket, MQTT topic) for available updates. The device controls timing, bandwidth usage, and retry behavior. This is the most common pattern for battery-powered and bandwidth-constrained devices because the device decides when network and power conditions are favorable.
- **Push model** — A cloud service or management platform initiates the update by sending a notification (MQTT message, CoAP observe, SMS wake-up) that triggers the device to download the image. Push provides tighter control over rollout timing and is typical in fleet management platforms like AWS IoT Device Management, Azure IoT Hub, and Mender.

In practice, most production systems use a hybrid: the cloud pushes a notification that an update is available, and the device pulls the binary at its own pace.

## Transport Protocols

The choice of transport depends on device connectivity, bandwidth, and power budget:

- **MQTT + object storage** — The most common pattern for IoT fleets. An MQTT message announces the update and provides a pre-signed URL to an S3 bucket (or equivalent). The device downloads the binary over HTTPS. This separates the signaling channel (lightweight MQTT) from the bulk transfer (HTTP with resume support).
- **HTTP/HTTPS** — Direct download from a firmware server. Range requests (`Range: bytes=N-M`) enable resumable downloads, which is critical for unreliable cellular or satellite links. A 256 KB firmware image over a 9600 bps modem takes ~4 minutes — an interrupted download without resume support means starting over.
- **CoAP with block transfer** — Designed for constrained networks (6LoWPAN, Thread). CoAP block-wise transfer (RFC 7959) breaks the image into small blocks (typically 64–1024 bytes) with built-in retransmission. Suitable for devices on IEEE 802.15.4 networks where an HTTP stack is too heavy.
- **LwM2M (Lightweight M2M)** — An OMA standard built on CoAP that defines a complete firmware update object (Object ID 5) with state management, progress reporting, and result codes. LwM2M servers like Eclipse Leshan handle the update orchestration.

## Image Formats

- **Full binary image** — The entire firmware as a flat `.bin` or wrapped in a metadata header (version, size, CRC, signature). Simple to generate and apply. A 512 KB image requires 512 KB of download bandwidth and a full partition to stage.
- **Delta/diff patches** — Only the differences between the running firmware and the new version are transmitted. Tools like `bsdiff` and `detools` generate compact patches that reduce transfer sizes by 70–95% for minor version changes. The device applies the patch against its current firmware to reconstruct the full new image. Delta updates require more RAM and CPU during patch application — `bsdiff` patches need working memory roughly equal to the old image size, while `detools` is designed for constrained devices with lower memory overhead. The tradeoff: smaller downloads but more complex update logic and a dependency on the exact running version.
- **Signed update bundles** — Frameworks like MCUboot and SWUpdate wrap the binary with a header containing version info, cryptographic signatures, and dependency metadata. The bootloader validates the header before applying the update.

## The Update State Machine

A robust OTA update follows a deterministic state machine:

```
IDLE → DOWNLOAD → VERIFY → SWAP → REBOOT → TEST → CONFIRM
                                                ↓ (failure)
                                             ROLLBACK
```

1. **Download** — The device retrieves the firmware image and writes it to a staging partition (or external flash). Partial downloads are tracked so transfers can resume after power loss or connectivity drops.
2. **Verify** — The staged image is checked for integrity (SHA-256 hash) and authenticity (cryptographic signature). Both checks must pass before proceeding.
3. **Swap** — The bootloader marks the staged image as pending. On the next boot, the bootloader copies or swaps the staged image into the active partition. In A/B schemes, the bootloader simply changes which partition is "active."
4. **Test boot** — The device boots into the new firmware. The application has a limited window (often enforced by a watchdog timer) to confirm the update succeeded.
5. **Confirm** — The application signals the bootloader that the new firmware is healthy (e.g., by writing a flag to a known flash location or resetting a boot counter). Until confirmation, the update is considered tentative.
6. **Rollback** — If confirmation never arrives (watchdog fires, boot counter exceeds threshold, application crashes), the bootloader reverts to the previous firmware on the next reset.

## Code Signing and Verification

CRC32 catches transmission errors but provides zero security — any attacker who can modify the firmware image can recompute the CRC. Production OTA systems require cryptographic verification:

- **Asymmetric signatures (ECDSA-P256)** — The build server signs the firmware hash with a private key. The device verifies using the corresponding public key embedded in the bootloader. ECDSA-P256 is the standard choice for constrained devices: a signature is 64 bytes, verification takes 100–500 ms on a Cortex-M4 at 64 MHz, and the public key is 64 bytes.
- **Hash verification** — SHA-256 over the entire image. The hash is included in the signed metadata header, so verifying the signature implicitly verifies the image integrity.
- **Certificate chains** — For fleet-scale deployments, the signing key may be an intermediate certificate signed by a root CA stored in the bootloader. This allows key rotation without updating every device's trust anchor.
- **Key storage** — The public key or root certificate hash lives in the bootloader partition, which is never overwritten by OTA updates. On devices with hardware secure elements (ATECC608, STSAFE), keys are stored in tamper-resistant silicon.

The signature verification must happen in the bootloader, not in the application being replaced. An application that verifies its own replacement can be bypassed by replacing the verification code itself.

## A/B Partition Schemes

The safest OTA architecture uses two firmware partitions of equal size:

| Partition | Role |
|-----------|------|
| Slot A | Active firmware (currently running) |
| Slot B | Staging area (receives the new image) |

The new image downloads directly into the inactive slot. On the next boot, the bootloader swaps the active slot pointer. If the new firmware fails to confirm, the bootloader reverts to the original slot. No firmware is lost at any point — the previous version remains intact until the new version is confirmed.

MCUboot, the most widely used open-source secure bootloader, supports three swap strategies:

- **Swap using scratch** — Copies sectors between slots using a small scratch area. Works on any flash topology but is slow (sector-by-sector copy).
- **Swap using move** — Moves sectors within a single flash region. Requires one extra sector but avoids a dedicated scratch partition.
- **Direct XIP (execute in place)** — No copying at all. The bootloader simply selects which slot to boot from. Both slots must be in directly-executable memory regions.

## Rollback Strategies

- **Watchdog-triggered rollback** — The bootloader starts a hardware watchdog before jumping to the application. The application must initialize and confirm the update (by petting the watchdog or writing a confirmation flag) within a timeout window, often 30–60 seconds. If the application crashes or hangs, the watchdog resets the device and the bootloader reverts.
- **Boot counter** — The bootloader increments a counter each boot. The application resets the counter to zero on successful startup. If the counter exceeds a threshold (typically 3), the bootloader declares the firmware defective and rolls back.
- **Golden image** — A known-good factory firmware stored in a protected partition that is never overwritten. If both A and B slots fail, the bootloader falls back to the golden image. This is the last-resort recovery path and trades flash space for brick resistance.
- **Application-level health checks** — Beyond simply booting, the new firmware may need to pass functional checks (successful cloud connection, sensor reads within range, critical task execution) before calling the update confirmed.

## Tips

- Stage OTA images to an inactive partition or external flash — never write to the partition the device is currently executing from. A power loss during a write to the active partition bricks the device with no recovery path.
- Include firmware version and hardware revision in the update metadata header, and validate both before applying. Flashing firmware built for a different hardware revision causes failures that look like random peripheral malfunctions.
- Implement resumable downloads with byte-range tracking. Cellular and LPWAN connections drop frequently, and restarting a 512 KB download from zero over a 50 kbps NB-IoT link wastes 80+ seconds of airtime per failure.
- Use staged rollouts (canary deployments) — push updates to 1% of the fleet first, monitor for anomalies for 24–48 hours, then proceed. A bad firmware image pushed to an entire fleet simultaneously can take weeks to recover via physical access.
- Keep the bootloader minimal and never update it via OTA. The bootloader is the recovery mechanism — if it is broken, the device is permanently bricked. Treat the bootloader as immutable after factory provisioning.
- Store the signing public key in the bootloader or a hardware secure element, not in the application partition. The key must survive an application update; storing it in the updateable partition creates a circular dependency.
- Log the OTA state machine transitions to persistent storage (e.g., a status register in external flash or a wear-leveled EEPROM page). Post-mortem analysis of failed updates depends on knowing which state the device reached before failure.

## Caveats

- **An update that passes verification but fails at runtime is the hardest failure mode to catch.** Signature verification confirms the image is authentic and intact — it says nothing about whether the firmware is functionally correct. A signed image with a regression bug will pass every cryptographic check and still break the fleet.
- **Delta updates couple the patch to the exact running firmware version.** If any device in the fleet is running an unexpected version (due to a partial rollout or manual flash), applying the delta patch against the wrong base image produces corrupted firmware. Full-image fallback must always be available.
- **Flash wear from repeated OTA failures can degrade the staging partition.** Each failed attempt erases and rewrites the staging slot. Most MCU flash is rated for 10,000 cycles, but a retry loop that attempts an update every boot can exhaust this budget within months. Rate-limiting retries (e.g., exponential backoff with a daily cap) protects flash longevity.
- **Clock drift on devices without NTP can cause certificate validation failures.** TLS connections for HTTPS downloads validate server certificate timestamps. A device whose RTC has drifted by months may reject a valid certificate or accept an expired one, depending on the TLS library's strictness.
- **Power loss during the swap phase is the highest-risk moment in the update lifecycle.** If the bootloader is midway through copying sectors between partitions and power is lost, both partitions can be left in an inconsistent state. MCUboot's swap algorithm is designed to be power-safe (it can resume from any point), but custom bootloader implementations often lack this property.

## In Practice

- **A device that repeatedly reboots after an OTA update and eventually reverts to old firmware** is the boot counter or watchdog rollback working as designed. The new firmware crashes before it can confirm the update, the counter increments on each attempt, and the bootloader falls back once the threshold is reached. The symptom looks like instability, but the recovery mechanism is functioning correctly.
- **Devices reporting successful OTA completion but running the old firmware version** often have a confirmation step that executes before the application actually validates its own health. The new firmware boots, immediately confirms the update, and then crashes — but because confirmation already happened, the bootloader considers the update permanent and does not roll back.
- **A fleet-wide OTA rollout that succeeds on most devices but fails on a specific hardware revision** typically indicates a mismatch between the firmware image and the hardware variant. Peripheral register layouts, flash sizes, or oscillator configurations differ between revisions, and the update metadata did not include a hardware compatibility check.
- **Intermittent OTA download failures that correlate with time of day** commonly appear on cellular-connected devices where network congestion peaks during business hours. The download stalls, times out, and restarts — without resumable transfers, total bandwidth consumption can be 5–10x the actual image size.
- **A device that successfully boots new firmware but loses its configuration or calibration data** after an OTA update has a partition layout where the configuration storage overlaps with the firmware staging area, or the new firmware's linker script places a data section at a different address than the old version expected.
