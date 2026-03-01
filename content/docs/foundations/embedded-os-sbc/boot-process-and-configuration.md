---
title: "Boot Process & System Configuration"
weight: 60
---

# Boot Process & System Configuration

An embedded Linux device goes through multiple firmware stages before the application code runs. Understanding this sequence — and where each stage can be configured, measured, and optimized — is essential for reducing boot time, debugging startup failures, and building reliable systems that recover from faults.

The boot chain is deterministic: each stage loads and validates the next, handing off control in a fixed order. A failure at any stage halts the process, and the symptoms observed at the serial console directly indicate which stage failed. Knowing the chain makes root-cause analysis straightforward.

---

## Boot Sequence Overview

The full chain from power-on to application is:

1. **Power-on** — voltage rails stabilize, SoC comes out of reset
2. **SoC ROM bootloader** — fixed in silicon, finds and loads the secondary bootloader
3. **Secondary bootloader** (U-Boot, UEFI, or vendor-specific) — loads kernel, device tree, optional initramfs
4. **Kernel** — initializes hardware, mounts root filesystem
5. **initramfs** (optional) — early userspace for loading drivers needed to mount the real root
6. **Init system** (systemd, BusyBox init, OpenRC) — starts services and the application
7. **Application** — the actual embedded workload begins

Each stage produces output on the serial console (except the ROM bootloader on most SoCs). Capturing this output is the single most reliable method for diagnosing boot failures.

---

## SoC ROM Bootloader

The ROM bootloader is the first code that executes after the SoC comes out of reset. It is burned into silicon at the factory and cannot be modified.

### Boot Media Selection

The ROM bootloader determines where to look for the next stage based on:

- **Strapping pins or fuses** — hardware configuration that selects boot media order (SD, eMMC, NVMe, USB, SPI NOR, NAND, network)
- **Fallback sequence** — most SoCs try multiple boot sources in a fixed priority order if the primary source fails

The ROM reads a small initial payload (typically the secondary bootloader) from the selected media, performs minimal validation (checksum or signature on secure-boot-capable SoCs), and jumps to it.

### Platform-Specific Details

- **Raspberry Pi (BCM2711/BCM2712)**: The boot process is unusual — the VideoCore GPU, not the ARM cores, runs first. On Pi 3 and earlier, the GPU loads `bootcode.bin` from the SD card's FAT32 partition. On Pi 4 and Pi 5, an SPI-attached EEPROM contains the bootloader firmware, which the GPU executes before loading `start4.elf` and handing off to the ARM cores. The EEPROM bootloader is updatable via `rpi-eeprom-update`.
- **BeagleBone (AM335x)**: The ROM checks for an `MLO` file (also called SPL — Secondary Program Loader) on the first FAT partition of the SD card or eMMC, depending on the boot pin configuration. Holding the USER/BOOT button during power-on forces SD card boot regardless of fuse settings.
- **Jetson (Tegra)**: NVIDIA's boot ROM loads a chain of signed firmware components from a dedicated boot partition on eMMC or SPI NOR. The signing and partition layout are managed through NVIDIA's `flash.sh` tooling.
- **i.MX (NXP)**: Boot mode is set by `BOOT_MODE` pins. The ROM loads a boot image that includes U-Boot SPL or the vendor's HAB (High Assurance Boot) signed chain from SD, eMMC, QSPI, or USB.

### Secure Boot

On SoCs that support it, the ROM bootloader verifies a cryptographic signature on the secondary bootloader before executing it. Once fuses are burned to enable secure boot, only signed images can run — this is irreversible. Testing with unsigned images must happen before fusing.

---

## U-Boot

U-Boot is the most widely used secondary bootloader for ARM-based embedded Linux systems. It bridges the gap between the ROM bootloader and the Linux kernel.

### What U-Boot Does

1. Initializes DRAM (if not already done by an SPL stage)
2. Initializes the console (UART) — this is typically the first human-readable output in the boot process
3. Loads the kernel image (`zImage`, `Image`, or `Image.gz`) into RAM at a configured address
4. Loads the device tree blob (`.dtb`) into RAM
5. Optionally loads an initramfs image
6. Sets the kernel command line (`bootargs`)
7. Transfers control to the kernel

### Key Environment Variables

U-Boot behavior is controlled by environment variables stored in flash (or a file on the boot partition):

| Variable | Purpose |
|----------|---------|
| `bootcmd` | The command sequence U-Boot runs automatically after the boot delay |
| `bootargs` | Kernel command line passed to Linux |
| `bootdelay` | Seconds to wait before auto-boot (set to 0 for production, 2-3 for development) |
| `loadaddr` | RAM address where the kernel image is loaded |
| `fdtaddr` | RAM address where the device tree blob is loaded |
| `bootpart` | Partition number for the boot filesystem |

The two most critical variables are `bootcmd` (what to boot) and `bootargs` (how to configure the kernel). A misconfigured `bootargs` — wrong root partition, missing console parameter — is one of the most common causes of a kernel that loads but never reaches a login prompt.

### U-Boot Shell

Pressing a key during the `bootdelay` countdown drops into the U-Boot shell, accessible over the serial console. Common operations:

```
# Print all environment variables
printenv

# Set kernel command line
setenv bootargs 'root=/dev/mmcblk0p2 rootfstype=ext4 console=ttyS0,115200 quiet'

# Save environment to persistent storage
saveenv

# Boot manually
boot

# Load a kernel image from SD card partition 1
fatload mmc 0:1 ${loadaddr} zImage

# Load device tree
fatload mmc 0:1 ${fdtaddr} bcm2711-rpi-4-b.dtb

# Boot with explicit addresses
bootz ${loadaddr} - ${fdtaddr}
```

The U-Boot shell is the primary recovery tool when a board fails to boot — it allows loading alternative kernels, device trees, and root filesystems without reflashing anything.

### U-Boot SPL (Secondary Program Loader)

On platforms where the ROM bootloader can only load a small payload (e.g., BeagleBone's 128 KB limit), U-Boot is split into two stages:

- **SPL (MLO)** — minimal code that initializes DRAM and loads full U-Boot
- **U-Boot proper** — the full-featured bootloader

This two-stage approach is transparent to the rest of the boot process but explains why some platforms have both an `MLO` and a `u-boot.img` on the boot partition.

---

## Device Tree

The device tree is a data structure that describes the hardware layout of the board to the Linux kernel. Without it, the kernel would have no way to know what peripherals are present, what addresses they occupy, or how they are connected.

### Format and Compilation

- **Source**: `.dts` (device tree source) — human-readable text files
- **Binary**: `.dtb` (device tree blob) — compiled binary loaded by U-Boot
- **Compiler**: `dtc` (device tree compiler) converts `.dts` → `.dtb`

```
# Compile a device tree source to binary
dtc -I dts -O dtb -o board.dtb board.dts

# Decompile a binary back to source (useful for inspection)
dtc -I dtb -O dts -o board.dts board.dtb
```

### What the Device Tree Contains

A typical device tree describes:

- CPU cores and their properties
- Memory layout (address ranges, reserved regions)
- Interrupt controller configuration
- Bus topology (I²C, SPI, UART controllers and their base addresses)
- GPIO pin assignments
- Clock tree relationships
- Peripheral-specific properties (e.g., eMMC bus width, Ethernet PHY address)

The kernel matches each device tree node against its compiled-in drivers using `compatible` strings. A node with `compatible = "brcm,bcm2711-gpio"` triggers the BCM2711 GPIO driver to probe.

### Device Tree Overlays

Overlays (`.dtbo` files) modify the base device tree at boot time without replacing it. This mechanism enables or disables peripherals:

- Enable SPI: `dtoverlay=spi0-1cs`
- Enable I²C: `dtparam=i2c_arm=on`
- Add a display: `dtoverlay=vc4-kms-v3d`
- Configure a hardware PWM: `dtoverlay=pwm-2chan`

Overlays are the standard mechanism for configuring GPIO-header peripherals on Pi and BeagleBone without recompiling the kernel or the base device tree.

### Platform-Specific Overlay Configuration

- **Raspberry Pi**: Overlays are listed in `config.txt` on the boot partition. The `dtoverlay=` and `dtparam=` directives are processed by the GPU firmware before handing off to the kernel.
- **BeagleBone**: Overlays are specified in `uEnv.txt` or loaded at runtime via the Cape Manager (deprecated on newer kernels in favor of `uEnv.txt` configuration).
- **Jetson**: Device tree is part of the flashed partition layout. Modifications require reflashing with NVIDIA's tools or editing `extlinux.conf` to point to a custom DTB.

---

## Kernel Boot

Once U-Boot transfers control, the kernel takes over.

### Kernel Loading and Decompression

- **zImage**: Compressed ARM kernel image — self-extracting, decompresses in place
- **Image.gz**: Compressed AArch64 kernel — U-Boot or the bootloader handles decompression
- **Image**: Uncompressed kernel — larger but avoids decompression time (relevant for fast-boot applications)

Decompression adds measurable time to boot. For sub-5-second boot targets, using LZ4 compression instead of gzip saves 100-300 ms on typical ARM SoCs. For sub-2-second targets, an uncompressed kernel may be worthwhile despite the larger flash footprint.

### Kernel Command Line

The kernel command line, passed via U-Boot's `bootargs`, controls fundamental kernel behavior:

```
root=/dev/mmcblk0p2 rootfstype=ext4 console=ttyS0,115200 quiet loglevel=3
```

| Parameter | Purpose |
|-----------|---------|
| `root=` | Root filesystem device |
| `rootfstype=` | Filesystem type (avoids probing delay) |
| `console=` | Serial console device and baud rate |
| `quiet` | Suppresses most kernel log messages (saves boot time) |
| `loglevel=` | Controls which messages appear on the console (0 = emergencies only) |
| `rootwait` | Wait indefinitely for the root device to appear (needed for USB or slow eMMC init) |
| `init=` | Path to the init program (default: `/sbin/init`) |
| `panic=` | Seconds to wait before rebooting on kernel panic (0 = hang forever) |

Specifying `rootfstype=` explicitly avoids the kernel probing multiple filesystem drivers and can save 200-500 ms on systems with many filesystem modules.

### Kernel Initialization Sequence

After decompression, the kernel:

1. Initializes the CPU, MMU, and exception vectors
2. Parses the device tree to discover hardware
3. Initializes the interrupt controller and timer
4. Brings up memory management (page tables, slab allocator)
5. Probes drivers for devices described in the device tree
6. Mounts the root filesystem
7. Executes `/sbin/init` (or the `init=` override) as PID 1

Driver probing is the most variable phase — a kernel with many compiled-in drivers probes them all, even for hardware that is not present. Minimizing the kernel configuration to include only necessary drivers significantly reduces this phase.

---

## initramfs

The initramfs (initial RAM filesystem) is an optional early userspace environment loaded into RAM alongside the kernel.

### When initramfs Is Needed

- The root filesystem requires drivers not built into the kernel (e.g., LVM, dm-crypt for encrypted root, NFS for network boot)
- The system uses complex storage setups that require userspace tools before the real root can be mounted
- Full Linux distributions (Ubuntu, Debian) use initramfs by default for flexibility

### When initramfs Can Be Skipped

- All drivers needed to mount the root filesystem are built into the kernel (not as modules)
- The root filesystem is on a straightforward block device (SD, eMMC) with a standard filesystem (ext4, squashfs)
- Build systems like Buildroot and Yocto routinely skip initramfs by including necessary drivers in the kernel

Skipping initramfs eliminates one decompression and filesystem setup step, saving 0.5-2 seconds depending on the initramfs size. For boot-time-sensitive embedded systems, building root filesystem drivers into the kernel and eliminating initramfs is a standard optimization.

---

## Init System

The init system is the first userspace process (PID 1). It starts all other services and manages the system lifecycle.

### systemd

The default init system on most full Linux distributions (Pi OS, Ubuntu, Armbian, Fedora):

- Starts services in parallel based on dependency graphs
- Uses unit files (`.service`, `.target`, `.timer`, `.mount`) to describe services
- Provides `systemctl` for managing services and `journalctl` for logs
- Handles watchdog integration, cgroup management, and socket activation
- Boot target: `multi-user.target` (headless) or `graphical.target` (desktop)

A typical embedded application runs as a systemd service:

```ini
[Unit]
Description=Sensor Data Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/opt/app/collector
Restart=always
RestartSec=5
WatchdogSec=30

[Install]
WantedBy=multi-user.target
```

The `WatchdogSec=30` directive tells systemd to expect a watchdog notification from the application every 30 seconds — if the application stops sending notifications, systemd restarts it.

### BusyBox init

A minimal init system used in Buildroot and other stripped-down environments:

- Sequential startup via shell scripts in `/etc/init.d/`
- No dependency resolution — services start in filename order
- Much smaller footprint than systemd (BusyBox init adds negligible overhead)
- No built-in service supervision — process management requires additional tools (e.g., `runit`, `s6`, or a custom watchdog script)

### OpenRC

A dependency-based init system used by Alpine Linux and Gentoo:

- Lighter than systemd, more capable than BusyBox init
- Shell-script-based service definitions with dependency tracking
- A middle ground for systems that need service management without systemd's complexity

---

## Boot Time Measurement and Optimization

### Measuring Boot Time

**systemd-analyze tools** provide the most accessible boot time breakdown:

```bash
# Total boot time (firmware, loader, kernel, userspace)
systemd-analyze

# Ranked list of slowest services
systemd-analyze blame

# Dependency chain showing the critical path
systemd-analyze critical-chain

# SVG visualization of the boot process
systemd-analyze plot > boot.svg
```

`systemd-analyze` only measures from kernel handoff — it does not include firmware and bootloader time. The total power-on to application time is always longer.

**Kernel-level timing**:

```bash
# Kernel log with timestamps (microsecond resolution)
dmesg | head -50

# Kernel timestamp of first message shows when the kernel started
# relative to its own initialization
```

**Hardware measurement** — the most accurate method for total boot time:

- Toggle a GPIO pin high in the application's startup code
- Measure time from power-on to GPIO transition with an oscilloscope or logic analyzer
- This captures all firmware, bootloader, kernel, and userspace time with no software instrumentation bias

### Optimization Techniques

Optimization effort should start with the largest time consumers and work downward:

**Userspace (typically 60-80% of boot time on unoptimized systems)**:

- Disable unused services: `systemctl disable bluetooth.service`, `systemctl disable avahi-daemon.service`, `systemctl disable ModemManager.service`
- Disable `NetworkManager-wait-online.service` or `systemd-networkd-wait-online.service` — these block boot for up to 2 minutes waiting for a network link
- Use systemd preset files to disable default services that are not needed
- Reduce or eliminate login managers and desktop environments on headless systems

**Kernel (typically 2-5 seconds)**:

- Remove unused drivers from the kernel configuration — fewer drivers to probe means faster boot
- Build required drivers directly into the kernel instead of as modules (eliminates module loading overhead)
- Use LZ4 kernel compression instead of gzip — faster decompression for a modest size increase
- Add `quiet` to the kernel command line — suppressing console output saves 0.5-1 second on serial consoles
- Specify `rootfstype=` explicitly to avoid filesystem probing

**Bootloader (typically 1-3 seconds)**:

- Set U-Boot `bootdelay=0` to eliminate the interactive countdown
- Minimize U-Boot's hardware initialization to only what the kernel needs
- On Pi: update EEPROM bootloader firmware — newer versions are faster

**Storage**:

- eMMC boots significantly faster than SD cards — the interface is wider (4/8 bit vs 1/4 bit) and the controller is more capable
- Ensure partition alignment matches the eMMC erase block size (typically 4 MB) — misalignment causes read-modify-write cycles that slow every read operation
- Use squashfs for a read-only root filesystem — smaller image, faster read, and compression improves transfer speed from slow media

### Typical Boot Times

These measurements represent power-on to application-ready (GPIO toggle method):

| Configuration | Platform | Boot Time |
|--------------|----------|-----------|
| Pi OS Desktop (full) | Pi 5 | 25–40 s |
| Pi OS Lite (no desktop) | Pi 4 | 15–25 s |
| Ubuntu Server | Pi 4 | 20–30 s |
| Armbian minimal | Pi 4 | 12–18 s |
| Yocto minimal image | CM4 (eMMC) | 5–10 s |
| Buildroot minimal | CM4 (eMMC) | 2–4 s |
| Buildroot + kernel tuning | CM4 (eMMC) | <2 s |
| Buildroot + kernel tuning | i.MX8M (eMMC) | 1.5–3 s |

The gap between a stock distribution (25+ seconds) and an optimized Buildroot image (<2 seconds) is roughly one order of magnitude. Most of the difference comes from eliminating services and reducing the kernel, not from exotic hardware tricks.

---

## Platform-Specific Configuration

### Raspberry Pi

Configuration is split across several files on the FAT32 boot partition:

**`config.txt`** — GPU firmware and hardware configuration:

```ini
# Enable hardware interfaces
dtparam=spi=on
dtparam=i2c_arm=on
dtparam=i2s=on
dtoverlay=uart2

# GPU memory allocation (MB)
gpu_mem=16

# CPU frequency and voltage (overclocking)
arm_freq=2000
over_voltage=6

# Enable hardware watchdog
dtparam=watchdog=on

# HDMI configuration (headless: disable to save power)
hdmi_blanking=2

# Pi 5 specific section
[pi5]
arm_freq=2400

# Apply to all models
[all]
enable_uart=1
```

**`cmdline.txt`** — kernel command line (single line, space-separated):

```
console=serial0,115200 console=tty1 root=PARTUUID=xxxxxxxx-02 rootfstype=ext4 rootwait quiet
```

**EEPROM configuration** (Pi 4/5):

```bash
# View current EEPROM config
rpi-eeprom-config

# Edit EEPROM config (boot order, power settings, network boot)
sudo rpi-eeprom-config --edit
```

The EEPROM `BOOT_ORDER` setting controls the boot media priority. A value of `0xf14` means: try SD card first, then USB, then restart the sequence. This is relevant for A/B boot setups and recovery images.

### BeagleBone

**`uEnv.txt`** — U-Boot environment file on the boot partition:

```bash
# Kernel and device tree
uname_r=5.10.168-ti-r72
dtb=am335x-boneblack.dtb

# Cape overlays
dtb_overlay=/lib/firmware/BB-UART1-00A0.dtbo
dtb_overlay=/lib/firmware/BB-I2C2-00A0.dtbo

# Kernel command line
cmdline=coherent_pool=1M net.ifnames=0 quiet

# Boot arguments
optargs=consoleblank=0
```

BeagleBone's `uEnv.txt` is closer to raw U-Boot configuration than Pi's `config.txt`. Syntax errors in `uEnv.txt` can prevent boot entirely — always keep a recovery SD card with a known-good configuration.

### Jetson (NVIDIA)

- Initial board setup uses `flash.sh` from the JetPack SDK on a host machine
- Device tree and boot configuration are part of a signed partition layout
- Runtime kernel parameter changes go in `/boot/extlinux/extlinux.conf`:

```
LABEL primary
    MENU LABEL primary kernel
    LINUX /boot/Image
    FDT /boot/dtb/tegra234-p3767-0003-p3768-0000-a0.dtb
    INITRD /boot/initrd
    APPEND root=/dev/mmcblk0p1 rootfstype=ext4 console=ttyTCU0,115200 quiet
```

- Modifying the device tree requires either reflashing the board or placing a custom DTB on the filesystem and updating `extlinux.conf` to reference it

---

## Headless Setup

Most embedded Linux devices run headless (no monitor, no keyboard). Getting initial access requires pre-configuring the boot media before first boot.

### Serial Console

The serial console is the most reliable access method — it works before networking, before SSH, and before the filesystem is fully mounted.

- Connect a USB-to-UART adapter to the board's UART TX, RX, and GND pins (on the GPIO header)
- Default baud rate on nearly all boards: **115200**
- Terminal emulator: `minicom`, `picocom`, `screen`, or `tio`

```bash
# Connect with picocom (common on Linux/macOS)
picocom -b 115200 /dev/ttyUSB0

# Connect with screen
screen /dev/ttyUSB0 115200
```

Serial console captures all boot messages starting from U-Boot (and sometimes earlier, depending on the SoC). This is the only way to observe what happens before the network stack initializes.

### SSH

- **Pi OS**: Place an empty file named `ssh` (no extension) on the boot partition. Also create `userconf.txt` with `username:encrypted-password` to set up the default user.
- **Ubuntu/Armbian**: SSH is enabled by default on server images. Default credentials are documented per distribution.
- **cloud-init**: Ubuntu and Armbian support cloud-init — place a `user-data` YAML file on the boot partition to configure users, SSH keys, packages, and network settings before first boot.

### Wi-Fi Configuration (Pre-Boot)

- **Pi OS**: Create `wpa_supplicant.conf` on the boot partition with network credentials. Pi OS copies it to the right location on first boot.
- **Ubuntu (netplan)**: Configure Wi-Fi in the cloud-init `network-config` file on the boot partition.
- **Armbian**: Use `armbian-config` after first boot via serial console, or pre-configure via the filesystem before inserting the SD card.

### Network Configuration

Static IP assignment avoids DHCP delays and ensures consistent access:

- **systemd-networkd**: Drop a `.network` file in `/etc/systemd/network/`
- **NetworkManager**: Use `nmcli` or pre-configure connection files
- **netplan** (Ubuntu): YAML-based configuration in `/etc/netplan/`

For production headless devices, a static IP or mDNS (Avahi) hostname avoids the fragility of depending on DHCP assignments.

---

## Reliability Features

### Watchdog Timers

A hardware watchdog timer is built into most SoCs. It counts down from a configured value, and if the system does not reset the counter ("feed" or "kick" the watchdog) before it reaches zero, the watchdog triggers a hardware reset.

**Enabling the watchdog**:

- Raspberry Pi: `dtparam=watchdog=on` in `config.txt`
- BeagleBone: Watchdog is enabled by default in the AM335x device tree
- Most other SoCs: Enabled via device tree node for the watchdog peripheral

**systemd integration**:

Add to `/etc/systemd/system.conf`:

```ini
RuntimeWatchdogSec=15
ShutdownWatchdogSec=120
```

With `RuntimeWatchdogSec=15`, systemd opens `/dev/watchdog` and feeds it regularly. If systemd itself hangs (kernel deadlock, runaway process consuming all resources), the watchdog is not fed and the hardware resets the board after 15 seconds.

**Application-level watchdog**:

For finer-grained monitoring, the application itself feeds the watchdog (directly or through systemd's `WatchdogSec=` in the service file). If the application crashes, hangs, or enters an infinite loop, the watchdog triggers a reboot. This is the last line of defense for unattended systems.

### Auto-Restart on Kernel Panic

A kernel panic normally halts the system, requiring a manual power cycle. For unattended devices, this is unacceptable.

```bash
# In /etc/sysctl.conf or via kernel command line
kernel.panic=10
```

This causes the kernel to reboot automatically 10 seconds after a panic. Combined with a watchdog timer, the system recovers from most failure modes without human intervention.

The kernel command line equivalent:

```
panic=10
```

### A/B Partition Scheme

An A/B (or active/fallback) boot scheme maintains two copies of the root filesystem:

- **Partition A**: Current running image
- **Partition B**: Previous known-good image (or newly flashed update)

The bootloader (U-Boot) tracks which partition to boot and a retry counter. The typical flow:

1. U-Boot boots partition A with a retry counter set to 3
2. If the kernel panics or the watchdog fires before the application marks the boot as successful, the retry counter decrements
3. After exhausting retries, U-Boot switches to partition B on the next boot
4. If partition B boots successfully, the application marks it as the new active partition

This scheme prevents a bad firmware update from permanently bricking a device in the field. Tools like [RAUC](https://rauc.io/) and [SWUpdate](https://swupdate.org/) implement this pattern with cryptographic verification.

### Persistent Logging for Post-Mortem Analysis

By default, systemd's journal is stored in memory and lost on reboot. For debugging field failures, persistent logging is essential:

```bash
# Enable persistent journal storage
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
```

After the next reboot:

```bash
# View logs from the previous boot
journalctl --boot=-1

# View logs from two boots ago
journalctl --boot=-2

# List all stored boots
journalctl --list-boots
```

For production systems, limit journal size to avoid filling the filesystem:

```ini
# /etc/systemd/journald.conf
SystemMaxUse=50M
SystemMaxFileSize=10M
```

### Read-Only Root Filesystem

A read-only root filesystem protects against corruption from unexpected power loss — a common event in embedded systems without controlled shutdown:

- Use squashfs or ext4 mounted read-only for the root filesystem
- Mount a small writable partition (ext4 or f2fs) for runtime data, logs, and configuration
- Use `overlayfs` to present a writable view of the root filesystem backed by a tmpfs (changes are lost on reboot, but the root filesystem is always consistent)

This approach eliminates filesystem corruption from power loss entirely for the root partition. Only the writable data partition needs journaling or fsck recovery.

---

## Tips

- Always set up serial console access before first boot of a new board — it catches boot failures that happen before networking comes up, and there is no substitute when the system does not reach a shell prompt.
- Run `systemd-analyze blame` as the first step in any boot time optimization effort — the top 3–5 services usually account for most of the userspace delay, and disabling unnecessary ones often yields the largest single improvement.
- Keep `config.txt` (Pi), `uEnv.txt` (BeagleBone), and `extlinux.conf` (Jetson) under version control — boot configuration changes can be hard to diagnose after the fact if not tracked.
- Set `kernel.panic=10` and enable the hardware watchdog on any unattended device — a hung system that requires manual power cycle is the most common field failure mode.
- For headless devices, enable both SSH and serial console — network issues can prevent SSH access, and serial is always available as long as there is physical access.
- A common sanity check after changing `config.txt` or `cmdline.txt` is to re-mount the boot partition and verify the file contents before rebooting — a syntax error in these files can prevent boot.
- For production images, set `bootdelay=0` in U-Boot to eliminate the interactive wait — this saves 2–3 seconds and prevents unintended access to the U-Boot shell.
- Using `rootfstype=ext4` (or the appropriate type) in the kernel command line eliminates filesystem probing and saves a few hundred milliseconds.

## Caveats

- Pi's `config.txt` changes take effect only on reboot — there is no runtime equivalent for many settings (clock frequencies, overlays, GPU memory). Testing a change requires a full power cycle.
- U-Boot environment corruption (e.g., from interrupted `saveenv` or flash wear) can make a board unbootable — always have a recovery method (serial console access + SD card with a known-good image).
- `systemd-analyze` measures time from kernel handoff, not from power-on — firmware and bootloader time is not included. On some platforms (Pi with slow EEPROM, Jetson with signed boot chain), this hidden time adds 3–8 seconds.
- Aggressive boot time optimization (removing services, skipping initramfs, reducing kernel) can create a system that boots fast but cannot recover from errors — always maintain a recovery path (A/B partitions, serial console, USB boot fallback).
- Watchdog timeout set too short causes reboot loops if the application takes longer than expected to initialize on first boot (e.g., database migration, one-time filesystem setup, package configuration).
- Device tree overlay errors (wrong pin assignments, conflicting overlays) do not always produce clear error messages — the kernel may boot with the overlay silently failing, leaving the peripheral non-functional.
- Enabling `quiet` mode speeds up boot but hides kernel messages that are critical for diagnosing hardware problems — development images should leave `quiet` off and only add it for production.
- Read-only root filesystem breaks applications that assume `/etc` or `/var` are writable — every file that needs to be modified at runtime must be explicitly redirected to the writable partition or tmpfs overlay.

## In Practice

- **A device that boots reliably in the lab but hangs in the field** commonly shows the boot process stuck at network configuration. systemd's `systemd-networkd-wait-online.service` blocks for up to 2 minutes waiting for a network link. This often shows up in environments where the expected Ethernet cable is not connected or a Wi-Fi access point is out of range. Disabling or reducing the timeout on this service resolves the stall.

- **Serial console output showing U-Boot messages but no kernel log** usually indicates a device tree or kernel image mismatch. The kernel loads but panics immediately, before console output is initialized. This commonly appears after a kernel update without a matching device tree update, or when an overlay references a symbol not present in the base DTB. Reverting the last device tree change or booting a known-good kernel from a recovery SD card isolates the problem.

- **A Buildroot image achieving sub-2-second boot in development but taking 8–10 seconds in production** often traces back to eMMC partition alignment. The boot partition or root partition starting at an address that is not aligned to the eMMC erase block boundary causes the flash controller to perform read-modify-write cycles on every read — effectively multiplying read latency by 3–5x. Repartitioning with proper alignment (typically 4 MB boundaries) restores expected performance.

- **Watchdog-triggered reboots every 30–60 seconds on a new deployment** typically point to the application failing to start. A missing library, wrong binary path, or configuration error causes the application to crash immediately. systemd restarts it (due to `Restart=always`), it crashes again, and eventually the watchdog fires because no one is feeding it. This shows up as a repeating pattern in `journalctl -b -1` — a crash log, followed by a restart, followed by the same crash.

- **Kernel boot completing but no login prompt on the serial console** commonly appears when the `console=` parameter in the kernel command line does not match the actual UART device. On Pi, the correct device is `serial0` (which maps to the appropriate hardware UART). On BeagleBone, it is `ttyS0` or `ttyO0` depending on the kernel version. The kernel finishes booting and starts systemd, but the getty service is bound to a different console device, so nothing appears on the serial port.

- **Intermittent filesystem corruption on systems without controlled shutdown** — SD cards and eMMC are particularly vulnerable to metadata corruption from power loss during write operations. This shows up as read-only remounts after unexpected reboots, or ext4 journal recovery messages on every boot. Switching to a read-only root filesystem with a separate writable partition for data (using f2fs or ext4 with journaling) eliminates the root filesystem corruption entirely.

- **Boot time regression after a distribution update** often results from new services being enabled by default. A distribution upgrade that adds `snapd`, `fwupd`, `unattended-upgrades`, or `ModemManager` can add 5–15 seconds to boot time. Running `systemd-analyze blame` after the upgrade identifies the new entries, and disabling the unnecessary ones restores the previous boot time.
