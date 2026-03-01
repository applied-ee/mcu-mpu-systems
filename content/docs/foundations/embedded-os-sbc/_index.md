---
title: "Embedded OS & SBC Platforms"
weight: 50
bookCollapseSection: true
---

# Embedded OS & SBC Platforms

Once the project points toward an MPU rather than a bare-metal MCU — see [MCU vs MPU]({{< relref "mcu-vs-mpu" >}}) — a new set of decisions opens up. The processor runs an operating system, storage holds a full filesystem, and peripherals are accessed through kernel drivers rather than direct register writes. The hardware ecosystem shifts from dev boards with headers to single-board computers (SBCs) and compute modules with established Linux support, community images, and carrier board ecosystems.

This changes almost everything about how firmware — now closer to application software — gets developed, deployed, and maintained. GPIO access goes through userspace APIs instead of memory-mapped registers. Deployment means building and flashing OS images rather than uploading a single binary. Real-time guarantees require kernel-level configuration rather than being a natural property of the hardware. And the boot process involves multiple stages of firmware and configuration before the application ever runs.

## What This Section Covers

- **[SBC & Compute Module Selection Guide]({{< relref "sbc-selection-guide" >}})** — A decision matrix comparing Raspberry Pi variants, BeagleBone, Jetson, and other platforms across CPU, RAM, GPIO, power, price, and OS support.
- **[Embedded OS Landscape]({{< relref "embedded-os-landscape" >}})** — Linux distributions (Raspberry Pi OS, Armbian, Yocto, Buildroot), non-Linux alternatives (Zephyr, NuttX, Android IoT), and the criteria that guide OS selection.
- **[Real-Time Constraints on Linux]({{< relref "real-time-linux" >}})** — PREEMPT_RT patching, kernel tuning, measured latencies, and where RT-Linux falls short compared to bare-metal MCUs.
- **[GPIO & Peripheral Access: Linux vs Bare-Metal]({{< relref "gpio-peripherals-linux-vs-mcu" >}})** — libgpiod, spidev, device tree overlays, latency differences, and the PRU subsystem on BeagleBone.
- **[Image-Based Deployments & System Updates]({{< relref "image-based-deployments" >}})** — Read-only root filesystems, A/B partition schemes, OTA frameworks, and storage reliability on SD, eMMC, and NVMe.
- **[Boot Process & System Configuration]({{< relref "boot-process-and-configuration" >}})** — From power-on through U-Boot, device tree, kernel, and systemd to a running application, plus boot optimization and headless setup.
