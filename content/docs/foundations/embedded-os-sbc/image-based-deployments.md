---
title: "Image-Based Deployments & System Updates"
weight: 50
---

# Image-Based Deployments & System Updates

Deploying software to an embedded Linux device is fundamentally different from deploying firmware to an MCU. Instead of flashing a single binary, the deployment unit is an entire OS image — kernel, root filesystem, configuration, and application — or a carefully managed set of packages. How that image gets built, written to storage, and updated in the field determines the reliability and maintainability of the product. A device that can be updated safely and rolled back on failure is a device that can survive years of field deployment. A device that cannot is a device that eventually becomes e-waste.

The central tension in image-based deployment is between flexibility and reproducibility. A fully mutable filesystem is easy to customize but impossible to reproduce exactly. A read-only image is perfectly reproducible but requires careful design to accommodate runtime state. The patterns described here — read-only roots, A/B partitioning, OTA frameworks, and storage media selection — all address different facets of this tension.

---

## Read-Only Root Filesystems

The single most effective reliability measure for an embedded Linux device is making the root filesystem read-only. A read-only root prevents filesystem corruption on power loss, reduces flash wear to nearly zero on the system partition, and ensures that every boot produces an identical, known state. If a device can lose power at any moment — and in the field, it will — a writable root filesystem is a liability.

### Why Read-Only Matters

On a standard Linux desktop, the root filesystem is read-write. Logs accumulate, package managers modify system files, and temporary files scatter across the disk. This works when power is reliable and the filesystem is backed by a drive with robust error correction. On an embedded device running from an SD card or eMMC, an unexpected power loss during a write to the root filesystem can corrupt the ext4 journal, leave partial writes in system directories, or render the device unbootable.

A read-only root eliminates this failure mode entirely. The rootfs partition is mounted with `ro` in `/etc/fstab` or via kernel command line (`ro root=/dev/mmcblk0p2`). No process can modify it, regardless of what happens at runtime. The system boots identically every time, which also makes debugging straightforward — if a field device misbehaves, reflashing the same image onto an identical board reproduces the environment exactly.

### OverlayFS for Transient State

A purely read-only system is too restrictive for most applications. Services need to write to `/tmp`, `/var/run`, and `/var/log`. Applications may need to update configuration files. OverlayFS solves this by layering a writable upper directory on top of the read-only lower directory. From the perspective of running processes, the filesystem appears fully writable. Writes go to the upper layer (typically a tmpfs in RAM or a small dedicated partition), while reads fall through to the read-only base.

The OverlayFS mount is typically configured in the initramfs or early in the boot process:

```bash
mount -t overlay overlay \
  -o lowerdir=/mnt/rootfs-ro,upperdir=/mnt/overlay/upper,workdir=/mnt/overlay/work \
  /mnt/merged
```

When the upper layer is backed by tmpfs, all changes are lost on reboot — which is exactly the desired behavior for most embedded applications. The device returns to a known state every boot cycle. If the upper layer is backed by a persistent partition, changes survive reboots but the read-only base is still protected from corruption.

### squashfs for Compressed Images

squashfs is a compressed, read-only filesystem that produces extremely small image files. Compression ratios of 2:1 to 3:1 are typical for a Linux root filesystem, meaning a 500 MB rootfs fits in 170-250 MB of flash. squashfs is commonly used in embedded Linux distributions, OpenWrt, and container images. The trade-off is CPU overhead on read — every file access requires decompression — but on modern ARM SoCs (Cortex-A53 and above), this overhead is negligible for most workloads.

Building a squashfs image from a populated root filesystem:

```bash
mksquashfs /path/to/rootfs rootfs.squashfs -comp xz -b 256K
```

The `-comp xz` flag selects XZ compression (best ratio, slower decompression). For devices where boot speed matters, `lz4` trades some compression ratio for significantly faster decompression.

### The Persistent Data Partition

A read-only root requires a strategy for data that must survive reboots: device configuration, calibration data, application state, and logs. The standard pattern is a separate writable partition dedicated to persistent data.

A typical partition layout:

| Partition | Filesystem | Mount Point | Purpose |
|-----------|-----------|-------------|---------|
| mmcblk0p1 | FAT32 | /boot | Kernel, DTBs, bootloader config |
| mmcblk0p2 | squashfs or ext4 (ro) | / | Root filesystem (read-only) |
| mmcblk0p3 | ext4 or f2fs | /data | Persistent application data |

The data partition is the only partition that receives regular writes. Sizing it appropriately and using a flash-friendly filesystem (f2fs or ext4 with appropriate journal settings) concentrates wear on a partition that does not affect system bootability.

---

## Image Creation Tools

Building a deployable image involves assembling a kernel, root filesystem, bootloader configuration, and application into a format that can be written to the target storage media. The choice of tooling depends on the scale and reproducibility requirements of the project.

### Raw Images with dd

The simplest approach is a raw disk image — a file that is a byte-for-byte representation of the target storage device, including partition table, boot partition, and root filesystem. Writing it to an SD card is a single `dd` command:

```bash
dd if=image.img of=/dev/sdX bs=4M status=progress
```

Raw images are easy to understand and work with, but they are inflexible. Changing the partition layout requires rebuilding the image. They also cannot be partially updated — the entire image must be rewritten even for a one-byte change.

### Yocto Project

The Yocto Project is the industry-standard build system for custom embedded Linux distributions. It generates complete flashable images — including kernel, root filesystem, bootloader, and device tree — from a declarative layer-based configuration. A Yocto build produces `.wic`, `.sdimg`, or raw image files that can be written directly to storage media.

Key Yocto characteristics for deployment:

- **Reproducible builds**: Given the same configuration and source revisions, Yocto produces bit-identical images (when the build environment is controlled).
- **Layer architecture**: Board support packages (BSPs), application layers, and update framework integration (meta-mender, meta-rauc, meta-swupdate) are separate layers that compose cleanly.
- **Image recipes**: The contents of the root filesystem are defined declaratively — adding or removing packages is a configuration change, not a manual filesystem edit.
- **SDK generation**: Yocto produces cross-compilation SDKs that match the target image exactly, ensuring build-time and runtime library consistency.

The cost of Yocto is complexity. Initial setup takes days, not hours. Build times on a fast machine (32+ cores, NVMe) run 1-4 hours for a full build, and incremental builds still take minutes. The learning curve is steep, but for production deployments of custom Linux images, Yocto is the dominant tool for good reason.

### Buildroot

Buildroot serves a similar purpose to Yocto but with a simpler, Makefile-based approach. It produces a root filesystem, kernel image, and bootloader from a single `make menuconfig` session. Build times are shorter (30-90 minutes for a typical configuration), and the configuration model is easier to learn.

Buildroot is well-suited to small, focused images — a device that runs one application and a minimal set of services. It lacks Yocto's layer system and SDK generation, making it less flexible for large teams or complex multi-product deployments. For single-product projects with a small root filesystem, Buildroot often gets to a working image faster than Yocto.

### debootstrap for Debian-Based Images

For devices that benefit from the Debian package ecosystem (apt repositories, extensive driver support), `debootstrap` creates a minimal Debian root filesystem that can be customized and packed into a deployable image:

```bash
debootstrap --arch=arm64 bookworm /mnt/rootfs http://deb.debian.org/debian
```

This produces a bare Debian installation. From there, `chroot` into the rootfs (or use `systemd-nspawn`) to install additional packages, configure services, and set up the application. The result is exported as a tarball or written into a partition image.

The trade-off is reproducibility. A `debootstrap`-based image depends on the current state of the Debian repositories at build time. Pinning package versions and using a local mirror improves reproducibility but adds maintenance burden.

### Raspberry Pi Imager and Vendor Tools

For Raspberry Pi and similar SBCs with strong vendor ecosystems, pre-built OS images are available for direct download. Raspberry Pi Imager writes these to SD cards with optional pre-configuration of WiFi, SSH, hostname, and user credentials. This is the fastest path from unboxing to a running system, but the resulting image is not customized at the build level — modifications happen after boot, which makes them harder to reproduce and scale.

For prototyping and development, vendor images are the right starting point. For production, transitioning to a Yocto or Buildroot pipeline ensures that every device in a fleet runs an identical, auditable image.

### Image Signing and Verification

Any image that will be deployed to devices in the field — whether written manually or delivered via OTA — should be cryptographically signed. The signing process is straightforward:

1. Build the image.
2. Compute a SHA-256 hash of the image file.
3. Sign the hash with a private key (RSA-2048 or Ed25519).
4. Distribute the image with its signature.
5. On the device, verify the signature against the embedded public key before writing.

Unsigned images are a security vulnerability. If a device accepts any image without verification, a compromised update server or a man-in-the-middle attack can push arbitrary code to the fleet. Every OTA framework discussed below supports image signing natively.

---

## A/B Partition Schemes

The A/B (or dual-copy) partition scheme is the standard pattern for reliable field updates on embedded Linux devices. The core idea is simple: maintain two root filesystem partitions, with only one active at any time. Updates are written to the inactive partition. If the update succeeds, the boot target switches. If it fails, the device continues booting from the previously active partition as if nothing happened.

### Partition Layout

A typical A/B partition layout on eMMC or SD:

| Partition | Device | Size | Purpose |
|-----------|--------|------|---------|
| boot | mmcblk0p1 | 256 MB | FAT32 — kernel, DTBs, bootloader env |
| rootfs_A | mmcblk0p2 | 1-4 GB | ext4 — root filesystem slot A |
| rootfs_B | mmcblk0p3 | 1-4 GB | ext4 — root filesystem slot B |
| data | mmcblk0p4 | Remaining | ext4/f2fs — persistent application data |

The boot partition contains the bootloader configuration that determines which rootfs slot is active. The data partition is shared between both slots and is never overwritten during an update.

### Update Lifecycle

The full lifecycle of an A/B update follows a strict sequence:

1. **Download**: The new image is downloaded to a temporary location (RAM, data partition, or directly streamed to the target partition).
2. **Write**: The image is written to the inactive partition. The active partition is untouched during this step.
3. **Verify**: The written image is verified — checksum, signature, or both.
4. **Switch**: The bootloader environment is updated to point to the newly written partition on the next boot.
5. **Reboot**: The device reboots into the new image.
6. **Health check**: The application or a watchdog service confirms the new image is functional.
7. **Commit**: The bootloader environment is updated to mark the new partition as confirmed. Without this step, the bootloader will revert to the old partition on the next reboot.

Step 7 — the commit — is critical. If the device boots the new image but the application fails to start, or a required peripheral driver is missing, the watchdog timer expires and the device reboots. Because the new partition was never committed, the bootloader falls back to the old partition automatically. This is the rollback mechanism.

### Bootloader Integration

U-Boot is the most common bootloader for A/B schemes on ARM-based embedded Linux. The partition switching is controlled by U-Boot environment variables:

```
# U-Boot environment for A/B boot
boot_slot=a
boot_a_left=3
boot_b_left=3

# Boot script logic (simplified)
if test "${boot_slot}" = "a"; then
    setenv bootargs root=/dev/mmcblk0p2 ro
    setenv boot_a_left $((boot_a_left - 1))
else
    setenv bootargs root=/dev/mmcblk0p3 ro
    setenv boot_b_left $((boot_b_left - 1))
fi
```

The `boot_X_left` counter decrements on each boot attempt. If the counter reaches zero without the application committing the update (resetting the counter), the bootloader switches to the other slot. This provides automatic rollback after a configurable number of failed boot attempts.

On x86-based embedded systems (e.g., ZimaBoard, UP Board), GRUB or systemd-boot can serve the same role, with the EFI boot variables or GRUB environment block controlling the active partition.

### Single-Copy Updates

Not all devices have the storage budget for two root filesystem copies. On small eMMC (4 GB), an A/B scheme with two 1.5 GB rootfs partitions leaves little room for anything else. Single-copy update strategies write the new image over the active partition — either by updating individual packages (like a traditional package manager) or by streaming a new image directly onto the rootfs while the system is running from an initramfs or recovery partition.

Single-copy updates are inherently riskier. A power loss during the write leaves the device with a partially overwritten root filesystem — potentially unbootable. Recovery partitions mitigate this (boot into recovery, rewrite the main partition), but add complexity and still require enough free space to hold the update payload temporarily.

---

## OTA Update Frameworks

Over-the-air (OTA) update frameworks automate the process of building, signing, distributing, and installing system updates on deployed devices. The three dominant open-source frameworks for embedded Linux are SWUpdate, RAUC, and Mender.

### SWUpdate

SWUpdate is an open-source update agent developed by Stefano Babic and widely used in industrial embedded Linux deployments. It runs on the device as a daemon (or is triggered on demand) and handles both image-level and package-level updates.

**Architecture and operation:**

- Updates are packaged in `.swu` files — a CPIO archive containing the image payload, a `sw-description` metadata file, and optional scripts.
- The `sw-description` file defines what gets written where: which partition receives the image, pre- and post-install scripts, version compatibility checks.
- SWUpdate supports multiple update handlers: raw image writes, UBI volume updates, shell script execution, package manager integration.
- Cryptographic verification (RSA or CMS signatures) is built in.

**Server integration:**

SWUpdate integrates with Eclipse hawkBit, an open-source device update management server. hawkBit provides fleet management, deployment scheduling, rollout campaigns, and device status tracking. The SWUpdate client polls the hawkBit server (or receives push notifications via DDI API) for available updates.

**Update strategies:**

SWUpdate supports both A/B and single-copy (in-place) update strategies. For A/B, the `sw-description` specifies which slot to write, and SWUpdate coordinates with the bootloader (U-Boot or EFI-GRUB) to switch the active partition. For single-copy, SWUpdate can apply delta patches or update individual files within the running filesystem — riskier, but necessary on storage-constrained devices.

**Example sw-description for an A/B image update:**

```
software =
{
    version = "2.1.0";
    hardware-compatibility: [ "revC" ];

    images: (
        {
            filename = "rootfs.ext4.gz";
            type = "raw";
            compressed = "zlib";
            device = "/dev/mmcblk0p3";
            sha256 = "a1b2c3...";
        }
    );

    scripts: (
        {
            filename = "post-update.sh";
            type = "shellscript";
            sha256 = "d4e5f6...";
        }
    );
}
```

### RAUC

RAUC (Robust Auto-Update Controller) is an open-source update framework focused on A/B slot management with strong cryptographic verification. Developed by Pengutronix, RAUC is more opinionated than SWUpdate — it enforces a strict slot-based update model and does not support arbitrary in-place modifications.

**Core concepts:**

- **Bundles**: RAUC updates are distributed as signed bundles — a squashfs archive containing one or more image files and a manifest. The bundle is verified against an X.509 certificate chain before any writes occur.
- **Slots**: RAUC manages named slots (e.g., `rootfs.0`, `rootfs.1`) defined in a system configuration file (`system.conf`). Each slot maps to a block device or file.
- **Slot status**: RAUC tracks which slot is active, which is booted, and whether the current boot has been marked as good. This status drives the rollback logic.

**system.conf example:**

```ini
[system]
compatible=my-device
bootloader=uboot
mountprefix=/mnt/rauc

[keyring]
path=/etc/rauc/keyring.pem

[slot.rootfs.0]
device=/dev/mmcblk0p2
type=ext4
bootname=A

[slot.rootfs.1]
device=/dev/mmcblk0p3
type=ext4
bootname=B
```

**Build system integration:**

RAUC provides `meta-rauc` for Yocto and a Buildroot package. The Yocto layer generates signed bundles as part of the build pipeline — `bitbake my-image-bundle` produces a `.raucb` file ready for deployment.

**Comparison with SWUpdate:**

RAUC is simpler to configure for pure A/B image updates. SWUpdate is more flexible — it supports a wider range of update strategies, custom handlers, and scripted workflows. For projects that need only A/B image updates with cryptographic verification, RAUC has a shorter time to integration. For projects that need package-level updates, delta patching, or complex multi-step update sequences, SWUpdate provides more options.

### Mender

Mender is a commercial OTA update platform with an open-source device client. It provides a full client-server architecture: the Mender client runs on the device, and the Mender server (hosted or self-hosted) manages the fleet, stores artifacts, and tracks deployment status.

**Client-side operation:**

The Mender client is a Go binary that runs as a systemd service. It polls the server for available updates, downloads the artifact, writes it to the inactive partition, and manages the A/B boot switching through U-Boot or GRUB integration. After a successful boot, the client reports status to the server and marks the deployment as committed.

**Mender Artifacts:**

Updates are packaged as Mender Artifacts (`.mender` files) — a structured archive containing the image payload, metadata (device type, artifact name, version), and a manifest with checksums. Artifacts are signed with RSA or ECDSA keys.

**Delta updates:**

Mender supports binary delta updates, which compute the difference between the currently running image and the new image. Only the diff is transmitted to the device, where it is applied to reconstruct the full new image on the inactive partition. For typical embedded Linux images where only application code and configuration change between versions, delta updates reduce bandwidth by 70-90%. The delta mechanism requires a reliable base image on the device — if the active partition has been modified (unlikely with a read-only root, but possible with a writable root), the delta reconstruction fails and a full image update is required as fallback.

**Fleet management:**

The Mender server provides:

- Device inventory and grouping
- Phased rollouts (deploy to 10% of devices, wait, then expand)
- Deployment scheduling
- Status dashboards (pending, downloading, installing, rebooting, success, failure)
- Audit logs

For fleet-level OTA management patterns and integration with broader IoT infrastructure, the IoT & Systems Integration section covers additional context.

**Licensing:**

Mender's device client is open source (Apache 2.0). The hosted server is a commercial service. A self-hosted open-source server (Mender Community) provides basic functionality, while the commercial edition (Mender Enterprise) adds role-based access control, audit logging, and advanced deployment features.

### Framework Comparison

| Feature | SWUpdate | RAUC | Mender |
|---------|----------|------|--------|
| Update model | A/B, single-copy, hybrid | A/B slots only | A/B image |
| Server component | hawkBit (optional) | hawkBit (optional) | Mender server |
| Delta updates | Via zchunk | No native support | Yes (binary delta) |
| Bundle format | .swu (CPIO) | .raucb (squashfs) | .mender (tar-based) |
| Signing | RSA, CMS | X.509 certificate chain | RSA, ECDSA |
| Yocto integration | meta-swupdate | meta-rauc | meta-mender |
| Buildroot support | Yes | Yes | Community recipes |
| Fleet management | Via hawkBit | Via hawkBit | Built-in dashboard |
| License | GPL-2.0 | LGPL-2.1 | Apache 2.0 / Commercial |
| Primary use case | Industrial, flexible | A/B with crypto focus | Full-stack OTA platform |

---

## Storage Media Considerations

The choice of storage media affects performance, reliability, update strategy, and product lifetime. Embedded Linux devices commonly use SD cards, eMMC, or NVMe storage, each with distinct characteristics.

### SD Cards

SD cards are ubiquitous, cheap, and physically swappable. For prototyping and development, SD cards are the default — nearly every SBC ships with an SD card slot. For production deployment, SD cards are a calculated risk.

**Consumer SD cards** (SanDisk Ultra, Samsung EVO, etc.) are optimized for sequential write performance in cameras and phones. Their wear leveling is rudimentary, and they provide no power-loss protection. Random write performance — the dominant pattern for an OS with logging and journaling — is highly variable: 0.5-5 MB/s, often an order of magnitude worse than the card's rated sequential speed. Consumer cards in write-heavy embedded applications commonly fail within 3-12 months.

**Industrial SD cards** (Swissbit, ATP, Delkin, Western Digital IX series) are designed for embedded applications. They feature:

- Better wear leveling algorithms (static and dynamic)
- Power-loss protection (capacitors that allow in-flight writes to complete)
- Higher endurance ratings (3,000-30,000 P/E cycles vs. 500-1,000 on consumer cards)
- Health monitoring via SD health status extensions (S.M.A.R.T.-like)
- Wider temperature ranges (-40 to 85C)

Industrial cards cost 3-10x more than consumer equivalents but are the minimum viable choice for field deployments on SD-based platforms.

### eMMC

eMMC (embedded MultiMediaCard) is soldered or socketed directly on the board. It integrates a NAND flash array with a controller in a single BGA package. Compared to SD cards, eMMC offers:

- **Better wear leveling**: The integrated controller manages wear across the entire flash array, with both static and dynamic wear leveling.
- **Power-loss protection**: eMMC 5.1 and later include a robust write protection mechanism, and many industrial-grade eMMC parts include internal capacitors for write completion on power loss.
- **Higher random write performance**: 5-30 MB/s depending on grade, significantly better than SD.
- **Longer endurance**: Industrial eMMC (e.g., Micron, Kingston, Swissbit) rates at 3,000-10,000 P/E cycles with internal wear leveling distributing writes across the array.

eMMC is the standard storage for production compute modules: Raspberry Pi CM4/CM5, NVIDIA Jetson, BeagleBone, and Variscite modules all offer eMMC options. The trade-off is that eMMC is not field-swappable (unless socketed, which is uncommon), so the initial provisioning and OTA update story must be solid.

Common eMMC sizes on embedded modules: 8 GB, 16 GB, 32 GB, 64 GB. For A/B partitioning, an 8 GB eMMC with two 2 GB root filesystem slots, a 256 MB boot partition, and a 3 GB data partition is a tight but workable layout.

### NVMe via M.2 or PCIe

NVMe storage is available on an increasing number of SBCs and embedded platforms:

- Raspberry Pi 5 via M.2 HAT+
- NVIDIA Jetson Orin series (native M.2 slot)
- ZimaBoard, Radxa Rock 5B, Orange Pi 5
- x86 embedded boards (UP Board, Kontron, congatec)

NVMe provides dramatically better performance: 50-500 MB/s random write, 1-3 GB/s sequential, and endurance ratings of hundreds of TBW (terabytes written). For applications that require high I/O throughput — edge AI inference with large model swaps, video recording, database workloads — NVMe is the appropriate choice.

The trade-offs are power consumption (1-3W active vs. 0.1-0.3W for eMMC) and cost. For a device that mostly boots, runs an application, and occasionally receives an OTA update, NVMe is overkill. The flash endurance and performance of eMMC are more than sufficient.

### Storage Comparison

| Characteristic | Consumer SD | Industrial SD | eMMC | NVMe |
|---------------|-------------|---------------|------|------|
| Sequential write | 30-100 MB/s | 30-90 MB/s | 50-200 MB/s | 500-3000 MB/s |
| Random write (4K) | 0.5-5 MB/s | 2-10 MB/s | 5-30 MB/s | 50-500 MB/s |
| Endurance (P/E) | 500-1,000 | 3,000-30,000 | 3,000-10,000 | 3,000-10,000+ |
| Power-loss safety | None | Some variants | Built-in (eMMC 5.1+) | Built-in |
| Hot-swappable | Yes | Yes | No | No (usually) |
| Temperature range | 0 to 70C | -40 to 85C | -40 to 85C | 0 to 70C (consumer) |
| Active power | ~0.3W | ~0.3W | 0.1-0.3W | 1-3W |
| Typical cost (32 GB) | $5-10 | $25-80 | $15-40 (module) | $20-50 (drive) |
| Best for | Prototyping | Field (SD slot) | Production | High-I/O edge |

---

## Filesystem Selection and Corruption Resilience

The choice of filesystem on writable partitions directly affects data integrity after power loss and the long-term health of flash storage.

### ext4 with Journaling

ext4 is the default filesystem for most embedded Linux root filesystems. With journaling enabled (the default), ext4 recovers metadata consistency after an unclean shutdown — the journal replays incomplete transactions on the next mount. However, ext4 journaling only guarantees metadata integrity by default. Data writes that were in flight at the time of power loss may be lost or partially written.

Enabling `data=journal` mode (instead of the default `data=ordered`) journals both metadata and data, providing stronger guarantees at the cost of write performance (roughly 50% slower for small writes). For most embedded applications, `data=ordered` is sufficient — the critical requirement is that the filesystem remains mountable, not that every in-flight write completes.

Reducing journal frequency lowers write amplification on flash:

```bash
# Set commit interval to 60 seconds (default is 5)
mount -o commit=60 /dev/mmcblk0p4 /data
```

This batches journal writes, reducing flash wear at the cost of potentially losing up to 60 seconds of data on power loss.

### f2fs (Flash-Friendly File System)

f2fs is designed specifically for NAND flash storage (SD, eMMC, USB drives). It uses a log-structured approach that converts random writes into sequential writes, which aligns well with how NAND flash operates internally. Benefits over ext4 on flash:

- Lower write amplification (fewer erased blocks per logical write)
- Better awareness of flash erase block boundaries
- Native TRIM/discard support
- Append-only logging reduces partial-write corruption risk

f2fs is a strong choice for the writable data partition on eMMC and SD. The Linux kernel support is mature (mainline since 3.8), and most embedded distributions include f2fs-tools.

### Power Loss During A/B Updates

The primary safety benefit of A/B partitioning reveals itself during a power loss mid-update. Because the update writes to the inactive partition while the active partition remains untouched, a power loss at any point during the write process leaves the active partition intact. The device reboots into the previously working image. The incomplete write to the inactive partition is simply garbage — it will be overwritten entirely on the next update attempt.

This property holds regardless of the filesystem on the inactive partition, because the update process writes a raw image (overwriting the partition from the first byte) rather than modifying files within an existing filesystem. The partition table and boot configuration are not modified until after the write completes and is verified.

### Mitigation Stack

The full mitigation stack for power-loss resilience, in order of effectiveness:

1. **Read-only root filesystem** — eliminates corruption on the system partition entirely.
2. **A/B partitioning** — ensures updates never leave the device in an unbootable state.
3. **Journaled filesystem on writable partitions** — recovers metadata consistency after unclean shutdown.
4. **Hardware power-loss protection** — UPS HAT, supercapacitor, or battery backup provides a grace period for graceful shutdown.
5. **Watchdog timer** — reboots the device if software hangs during or after an update.

Layers 1 and 2 are software design choices with no hardware cost. Layer 3 is a filesystem choice. Layers 4 and 5 require hardware support but provide defense-in-depth against failures that software alone cannot prevent.

---

## Provisioning and Initial Deployment

Getting the first image onto a device — before any OTA infrastructure exists — requires a provisioning strategy. The approach depends on fleet size and manufacturing context.

### Manual Provisioning

For small runs (1-100 devices), writing images to SD cards or eMMC with `dd` or a dedicated flashing tool is practical. The Raspberry Pi Compute Module ships with `rpiboot`, which puts the CM4/CM5 eMMC into USB mass storage mode for direct writing from a host PC:

```bash
# Flash an image to a CM4 eMMC
rpiboot                          # Exposes eMMC as /dev/sdX
dd if=production-image.img of=/dev/sdX bs=4M status=progress
```

For eMMC-based modules without USB mass storage mode, UART or USB bootloaders (e.g., `imx_usb_loader` for NXP i.MX, `sunxi-fel` for Allwinner) provide initial flashing capability.

### Factory Provisioning at Scale

For larger production runs, automated provisioning stations flash images onto devices in a production line. The typical setup involves:

- A host PC or dedicated flashing station with multiple USB ports
- A script that detects newly connected devices, writes the image, verifies the write, and logs the serial number
- Per-device identity injection: writing a unique device certificate, serial number, or configuration to the data partition after imaging

This per-device identity step is critical for OTA infrastructure. Each device needs a unique identity (typically an X.509 client certificate) to authenticate with the update server. Baking this identity into the factory provisioning process avoids the chicken-and-egg problem of needing an update mechanism to deploy the update client's credentials.

### Network Boot and PXE

For x86-based embedded devices or ARM devices with network boot support (some i.MX and Jetson platforms), PXE or TFTP-based network boot can serve as a provisioning mechanism. The device boots from the network, runs a provisioning script that writes the production image to local storage, and reboots into the installed image. This eliminates the need to physically connect each device to a flashing station.

---

## Tips

- Default to a read-only root with OverlayFS for any device that may lose power unexpectedly — this eliminates the most common class of field failures with zero hardware cost.
- Adopt A/B partitioning from the start of a project, not as a retrofit — adding it later requires repartitioning every deployed device, which means either a carefully orchestrated migration update or a truck roll.
- Test power-loss resilience by pulling power during updates — do this repeatedly during development, not just once. A bench setup with a relay or smart plug controlled by a script can automate hundreds of power-cycle tests overnight.
- For SD card deployments, minimize write operations: mount `/tmp` and `/var/log` as tmpfs, disable swap entirely (`swapoff -a` and remove from fstab), and increase the ext4 commit interval on any writable partition.
- Sign all update images cryptographically — unsigned updates are a security vulnerability in any network-connected device. The cost of implementing signing is a few hours of initial setup; the cost of a compromised fleet is catastrophic.
- Keep a separate data partition that survives A/B image updates — losing user configuration, calibration data, or device identity on every update is a common early-stage design mistake that erodes trust in the update process.
- Use `fsck` at boot on writable partitions — ext4 journaling handles most unclean shutdowns, but periodic full filesystem checks catch latent errors before they propagate.
- Pin the OTA framework version in the image build — an update that changes the update client itself can break the update path if the new client has a bug, leaving the device unable to receive further updates.
- Implement a health check that runs after every boot and reports to the update server — without positive confirmation that the new image is functional, the server cannot distinguish between a successful update and a device that is stuck in a boot loop.
- For bandwidth-constrained deployments (cellular, satellite), evaluate delta updates early — the difference between pushing a 500 MB full image and a 30 MB delta to 1,000 devices is 470 GB of cellular data per deployment cycle.
- Store the bootloader environment (U-Boot env) on a dedicated small partition or in a redundant location — corruption of the bootloader environment can prevent A/B switching even when both root filesystem partitions are intact.
- When using OverlayFS with tmpfs as the upper layer, set a size limit on the tmpfs mount (`mount -t tmpfs -o size=64M tmpfs /overlay`) to prevent a runaway process from consuming all RAM.

---

## Caveats

- **A/B partitioning doubles root filesystem storage** — On a device with 8 GB eMMC, two 2 GB rootfs partitions plus boot and data partitions leave a tight budget. Every package added to the image has a 2x storage cost. Stripping unnecessary packages and using squashfs compression helps, but the constraint is real.
- **Delta updates add fragile dependencies** — Binary diff mechanisms (bsdiff, xdelta, Mender delta) assume the base image on the device matches the expected state exactly. If the active partition has been modified — even by a stray write to a writable root — the delta reconstruction produces garbage, and the device must fall back to a full image update. Read-only roots make this failure mode far less likely.
- **OverlayFS upper layers grow silently** — The writable overlay accumulates all changes: package installs, log writes, temporary files. If the upper layer is backed by tmpfs, it consumes RAM. If backed by a persistent partition, it consumes flash. Either way, an unmonitored overlay eventually fills its backing store, and the system becomes unresponsive with misleading "disk full" errors even though the read-only base has plenty of space.
- **Yocto build reproducibility requires a locked environment** — Yocto builds on different host machines (different Ubuntu versions, different installed packages) can produce subtly different images. This manifests as devices that behave differently depending on which CI runner built their image. Containerized builds (using `crops/poky` or a custom Docker image) are the standard mitigation.
- **SD card endurance is workload-dependent, not capacity-dependent** — A 64 GB consumer SD card does not last longer than a 16 GB card under the same write workload, because the wear leveling controller may concentrate writes on a subset of the flash array. Endurance depends on the card's internal wear leveling quality, not its total capacity.
- **The bootloader is a single point of failure in A/B schemes** — A/B partitioning protects the root filesystem, but the bootloader itself is not duplicated on most platforms. A corrupted U-Boot environment or a failed bootloader update can brick the device regardless of how many rootfs copies exist. Some platforms (NXP i.MX8) support redundant boot images in ROM, but this is not universal.
- **First-boot provisioning on cellular devices consumes data** — If the factory image is minimal and the first boot pulls additional packages or configuration from a server, every device consumes bandwidth during initial deployment. For fleets of thousands of devices activating simultaneously, this can overwhelm both the server and the cellular data budget.
- **Mender and RAUC bundles are not cross-compatible** — Choosing an OTA framework is a long-term commitment. Migrating from one framework to another requires updating every device in the fleet with a transitional image that replaces the update client — a complex, high-risk operation.

---

## In Practice

- **Corrupted root filesystems on consumer SD cards** commonly appear after 3-6 months on devices with active logging or frequent package updates. The `dmesg` output shows I/O errors on the `mmcblk0` device, and `fsck` finds orphaned inodes and corrupted directory entries. Switching to a read-only root with logs directed to tmpfs (flushed periodically to a data partition on an industrial SD or eMMC) eliminates this failure mode. The underlying card may still wear out eventually, but the system remains bootable.

- **A failed A/B update that triggers automatic rollback** often shows up in the update server dashboard as a deployment stuck in "rebooting" state. On the device side, the sequence is visible in the boot log: U-Boot decrements the boot attempt counter, boots the new partition, the health check fails (or the watchdog expires), the device reboots, U-Boot sees the counter at zero, and switches back to the old partition. The device comes online with the previous image and reports the failure. Without A/B, the same scenario — a missing kernel module, a broken init script, a misconfigured network — results in a device that does not boot and does not report.

- **Delta update bandwidth savings** on a fleet of CM4-based devices typically show a 70-90% reduction compared to full image updates for minor application releases. A 500 MB root filesystem image where only the application binary and a few configuration files changed produces a delta of 20-50 MB. However, the first deployment after a major OS version bump (e.g., Yocto Kirkstone to Scarthgap) produces deltas that are larger than the full image — the binary diff between major versions is effectively random. The update server should be configured to fall back to full images when the delta exceeds a size threshold.

- **Power loss during an eMMC write with A/B partitioning** results in a clean boot to the previously active partition. The incomplete write to the inactive partition appears as a partition with invalid filesystem metadata — `blkid` may not recognize the filesystem type, and attempting to mount it returns an error. This is the expected state. The next update attempt overwrites the partition entirely, restoring it to a valid image.

- **OverlayFS filling up on a device with tmpfs backing** presents as processes failing with `ENOSPC` (no space left on device) while `df` on the read-only root shows ample free space. The actual constraint is the tmpfs mount — `df /overlay` or `df /tmp` reveals the full tmpfs. This commonly occurs when a process writes large temporary files or when log rotation is not configured, allowing `/var/log` to grow unbounded in the overlay. Setting a tmpfs size limit and monitoring overlay usage prevents the surprise.

- **Bootloader environment corruption on SD cards** shows up as a device that boots the wrong partition or fails to switch partitions after an update. The U-Boot environment is typically stored in a small region of the boot partition or in raw sectors. On SD cards without power-loss protection, a write to the environment sector that is interrupted by power loss can leave the environment in an inconsistent state. Redundant U-Boot environments (configured with `CONFIG_ENV_OFFSET_REDUND` in U-Boot) mitigate this — U-Boot maintains two copies and uses the one with a valid CRC.

- **Yocto images that behave differently across build machines** manifest as subtle bugs that appear on some production devices but not on development boards. The root cause is often a host tool version difference (e.g., different `openssl` or `glibc` versions on the build machine) that produces a functionally different binary. This commonly shows up as TLS failures (different default cipher suites), DNS resolution differences, or time zone handling bugs. Running all production builds inside a pinned container eliminates the variable.

- **A device fleet with 1,000 units receiving a simultaneous OTA push** can overwhelm both the update server and the network. The typical mitigation is a phased rollout: push to 1% of the fleet, wait for success reports, then expand to 10%, then 50%, then 100%. Mender and hawkBit both support phased rollouts natively. Without phasing, the server sees 1,000 simultaneous download requests, and devices on shared network links (e.g., a factory floor on a single uplink) experience timeouts and retry storms.
