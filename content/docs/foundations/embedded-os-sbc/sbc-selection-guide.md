---
title: "SBC & Compute Module Selection Guide"
weight: 10
---

# SBC & Compute Module Selection Guide

Once a project points toward an MPU or SBC rather than a bare-metal MCU — see
[MCU vs MPU]({{< relref "mcu-vs-mpu" >}}) for the decision boundary — the next
question becomes which platform fits the application requirements. The
single-board computer and compute module market has expanded well beyond the
Raspberry Pi, and different boards optimize for different axes: raw compute,
GPU/NPU acceleration, real-time I/O, power efficiency, production readiness, or
simply ecosystem maturity and community support.

Selecting a platform early in a project is consequential. The choice locks in an
OS ecosystem, a peripheral set, a thermal envelope, and a supply chain.
Switching platforms mid-project is possible but expensive in engineering time —
driver differences, kernel versions, and boot configurations rarely transfer
cleanly. A mismatch discovered late (insufficient RAM for a containerized
workload, missing PCIe for NVMe storage, or inadequate GPU for an inference
pipeline) can force a redesign of both hardware and software.

The goal of this guide is to lay out the comparison axes, provide concrete
specifications for the most common platforms, and highlight the trade-offs that
are difficult to see from datasheets alone.

---

## SBC Selection Criteria

The primary axes for comparing SBCs and compute modules fall into hardware,
software, and ecosystem categories. Each axis interacts with the others — a
board with excellent hardware specifications but poor OS support may be less
productive than a modestly-specced board with a mature, well-documented software
stack.

### CPU Architecture & Performance

ARM Cortex-A series dominates the embedded Linux SBC space. The relevant core
generations, roughly ordered by single-thread performance:

| Core | Typical Clock | Pipeline | Notes |
|------|--------------|----------|-------|
| Cortex-A8 | 1 GHz | In-order, single-issue | BeagleBone Black; aging but functional |
| Cortex-A53 | 1.0–1.5 GHz | In-order, dual-issue | Pi Zero 2 W; low power, modest perf |
| Cortex-A55 | 1.5–2.0 GHz | In-order, improved A53 | big.LITTLE "little" cores on RK3588S |
| Cortex-A72 | 1.5–2.0 GHz | Out-of-order, 3-wide | Pi 4, CM4, BeagleBone AI-64 |
| Cortex-A76 | 2.0–2.4 GHz | Out-of-order, 4-wide | Pi 5, CM5, Orange Pi 5 |
| Cortex-A78AE | 1.5–2.0 GHz | Out-of-order, 4-wide | Jetson Orin; automotive safety features |

x86 options exist (Intel Celeron, Atom) and bring compatibility with standard PC
software stacks but typically at higher power draw per unit of compute. The
ZimaBoard falls into this category.

Core count and clock speed provide a rough indicator, but memory bandwidth, cache
hierarchy, and thermal throttling behavior under sustained load often matter more
in practice. A quad-core Cortex-A76 at 2.4 GHz with LPDDR4X-4267 (Pi 5)
outperforms a quad-core Cortex-A72 at 1.8 GHz with LPDDR4-3200 (Pi 4) by more
than the clock speed difference suggests, because the memory subsystem and
microarchitectural improvements compound.

### RAM

Available RAM ranges from 512 MB (Pi Zero 2 W) to 16 GB (Jetson Orin NX, Orange
Pi 5). The minimum viable RAM depends on the workload:

| Workload | Minimum RAM | Comfortable RAM |
|----------|-------------|-----------------|
| Headless IoT gateway (MQTT, sensor polling) | 256 MB | 512 MB |
| Lightweight web server (Node.js, Flask) | 512 MB | 1 GB |
| Docker with 2-3 containers | 1 GB | 2 GB |
| Desktop GUI / browser-based dashboard | 2 GB | 4 GB |
| ML inference (small models, MobileNet-class) | 2 GB | 4 GB |
| ML inference (larger models, YOLO, LLM quantized) | 4 GB | 8–16 GB |
| Multi-stream video analytics | 4 GB | 8–16 GB |

LPDDR4/LPDDR4X/LPDDR5 bandwidth also matters for memory-bound workloads like
image processing and neural network inference. The difference between LPDDR4-3200
(Pi 4) and LPDDR4X-4267 (Pi 5) is measurable in large matrix operations and
video processing pipelines.

RAM on most SBCs is soldered and not upgradeable. Selecting the right RAM
configuration at purchase time is essential — there is no option to add more
later.

### Storage

MicroSD is the most common boot medium but has well-documented reliability
problems under sustained write loads (logging, databases). The storage hierarchy
for SBCs, roughly ordered by performance and reliability:

| Medium | Sequential Read | Random 4K Read | Write Endurance | Notes |
|--------|----------------|----------------|-----------------|-------|
| MicroSD (UHS-I) | ~80 MB/s | ~3–5 MB/s | Low (consumer) | Default on most SBCs |
| MicroSD (Industrial) | ~80 MB/s | ~5–8 MB/s | Medium | SanDisk Industrial, Transcend |
| eMMC 5.1 | ~200–300 MB/s | ~10–20 MB/s | Medium-High | CM4, BeagleBone Black |
| USB 3.0 SSD | ~350–400 MB/s | ~30–50 MB/s | High | Pi 4 USB boot |
| NVMe (PCIe 2.0 x1) | ~400–500 MB/s | ~50–80 MB/s | High | Pi 5 via HAT+ |
| NVMe (PCIe 3.0 x4) | ~2000–3500 MB/s | ~200–500 MB/s | High | Orange Pi 5, Jetson |
| SATA SSD | ~500 MB/s | ~40–80 MB/s | High | ZimaBoard |

The jump from MicroSD to NVMe is not incremental — it is transformative for boot
time, application startup, database queries, and log write throughput. For any
project where storage I/O is on the critical path, evaluating NVMe-capable
boards early avoids a bottleneck that cannot be fixed without a platform change.

### GPIO & Peripheral Availability

The number of GPIO pins matters less than what peripherals are actually exposed.
The key interfaces to evaluate:

- **SPI** — How many independent SPI buses? How many chip selects per bus?
  Needed for displays, ADCs, DACs, flash memory.
- **I2C** — How many I2C buses? Address conflicts are common when multiple
  sensors share a bus with fixed addresses.
- **UART** — How many hardware UARTs? Needed for GPS modules, debug consoles,
  RS-485 transceivers, cellular modems.
- **PWM** — How many hardware PWM channels? Software PWM from Linux userspace
  has poor timing resolution (millisecond-class jitter).
- **ADC** — Rare on Linux SBCs. The BeagleBone Black's 7-channel 12-bit ADC is
  an exception. Most ARM SBCs require an external ADC IC (MCP3008, ADS1115)
  connected via SPI or I2C.
- **CSI** — Camera Serial Interface for direct camera module connection.
  Important for vision applications; USB cameras work universally but add
  latency and USB bandwidth consumption.
- **DSI** — Display Serial Interface for direct display panel connection.
  Lower latency and power than HDMI for embedded displays.
- **PCIe** — Available on newer boards (Pi 5, CM5, Orange Pi 5, Jetson). Enables
  NVMe, additional Ethernet, USB 3.0 host controllers, and accelerator cards.

Pin muxing means that enabling one peripheral may disable another. The datasheet
and device tree overlays define the actual combinations available. A common
failure mode is designing a system that requires SPI1, I2C3, UART2, and four
PWM channels simultaneously, only to discover that three of those share
overlapping pin groups.

### Power Draw

Power draw ranges from under 0.5 W (Pi Zero 2 W idle) to 25+ W (Jetson Orin NX
under full GPU load). The power budget determines:

- **Power source** — USB (5V, 2-3A typical), PoE (802.3af provides up to
  12.95 W), battery (LiPo 3.7V with boost converter), solar (with MPPT
  controller and battery buffer)
- **Thermal solution** — Passive heatsink (up to ~5 W in open air), active fan
  (up to ~15 W), heat pipe or vapor chamber (higher)
- **Enclosure design** — Sealed IP65/IP67 enclosures require passive cooling
  only, which limits maximum sustained power
- **Battery life** — A 10 Wh battery pack (typical 18650 cell) sustains a
  Pi Zero 2 W for ~20 hours idle but a Pi 5 for only ~1.5 hours under load

Idle power matters for always-on deployments; peak power determines the supply
rail requirements. Measuring actual power draw with a USB power meter (like the
Satechi or AVHzY CT-3) under realistic workload conditions is essential — the
datasheet numbers are nominal, and real draw varies with peripherals attached,
Wi-Fi activity, and CPU/GPU utilization.

### Form Factor

Standard SBC form factors range from the Pi Zero's 65 x 30 mm to full
ATX-adjacent boards. Compute modules (CM4, CM5, Jetson SoM) separate the
processor from the I/O board, enabling custom carrier board designs that match
the mechanical constraints of the final product.

For enclosure design, the critical dimensions are not just the board outline but
also the component height (heatsink clearance), connector protrusion (USB, HDMI,
Ethernet extending beyond the board edge), and mounting hole pattern.

### Price

Ranges from ~$5 (XIAO ESP32S3) to ~$700 (Jetson Orin NX 16 GB). The price
comparison should include the full bill of materials:

- Board or module itself
- Required heatsink or cooling solution
- Power supply (USB-C adapter, PoE splitter, or custom supply)
- Storage media (SD card, eMMC module, NVMe SSD)
- Carrier board (for compute modules)
- Enclosure and mechanical mounting
- Any required software licenses (generally none for Linux-based stacks, but
  some NVIDIA tools have commercial licensing considerations at scale)

A $15 Pi Zero 2 W with a $10 SD card and $5 USB power supply totals $30. A $250
Jetson Orin Nano module with a $100 carrier board, $30 NVMe SSD, $15 heatsink,
and $20 power supply totals $415.

### OS Support Breadth

Raspberry Pi OS (Debian-based) has the broadest package availability and testing
for Pi hardware. Ubuntu and Armbian support many boards. Key considerations:

- **Raspberry Pi OS** — Official, best-tested for Pi hardware, Debian-based,
  apt package manager, both 32-bit and 64-bit variants available
- **Ubuntu** — Available for Pi, Jetson (via JetPack), and many other boards;
  familiar to most Linux developers; LTS releases provide 5-year support windows
- **Armbian** — Community-maintained images for dozens of SBCs; often the best
  option for non-Pi boards (Orange Pi, Banana Pi, Rock Pi); quality varies by
  board
- **DietPi** — Minimal Debian-based distribution optimized for low-RAM SBCs;
  good for headless appliances
- **JetPack** — NVIDIA's SDK for Jetson; Ubuntu-based but includes
  NVIDIA-specific kernel, CUDA, cuDNN, TensorRT; mandatory for Jetson GPU access
- **Yocto / Buildroot** — Custom minimal images for production; steep learning
  curve but produces optimized, minimal-footprint images with fast boot times
- **TI SDK** — Required for BeagleBone AI-64's DSP and ML accelerators;
  Debian-based with TI-specific kernel patches

### Community & Ecosystem Maturity

The size and activity of the community directly affects the speed of
troubleshooting. A rough ranking by community size and resource availability:

1. **Raspberry Pi** — Largest by far. The official forums, Stack Overflow,
   Reddit (r/raspberry_pi), and countless blog tutorials cover almost every
   conceivable use case. Third-party HATs, cases, and accessories are abundant.
2. **NVIDIA Jetson** — Strong ML/AI-focused community. NVIDIA Developer Forums
   are active. Fewer general-purpose resources but deep coverage of inference,
   computer vision, and CUDA topics.
3. **BeagleBone** — Smaller but technically deep. Strong presence in industrial
   and academic contexts. PRU-specific resources are sparse.
4. **Orange Pi / other alternatives** — Thinner communities. Armbian forums
   provide the best support. Manufacturer documentation may be in Chinese with
   incomplete English translation.
5. **ZimaBoard** — Small community focused on home server and self-hosting use
   cases. CasaOS community provides application-level support.

---

## Consumer SBC Comparison

The table below summarizes key specifications across popular SBCs and compute
modules. All prices are approximate USD at the time of writing and may vary with
supply and regional availability.

| Platform | CPU | RAM | Storage | GPIO / Interfaces | Typical Power Draw | Form Factor | Approx Price (USD) | OS Support | Standout Feature |
|---|---|---|---|---|---|---|---|---|---|
| **Raspberry Pi Zero 2 W** | BCM2710A1, 4x Cortex-A53 @ 1 GHz | 512 MB LPDDR2 | MicroSD | 40-pin header, 1x mini HDMI, 1x micro USB OTG, CSI (mini) | ~0.4 W idle, ~1.8 W load | 65 x 30 mm | $15 | Raspberry Pi OS, Ubuntu, DietPi | Smallest Pi with quad-core and Wi-Fi |
| **Raspberry Pi 4 Model B (4 GB)** | BCM2711, 4x Cortex-A72 @ 1.8 GHz | 4 GB LPDDR4-3200 | MicroSD, USB 3.0 boot | 40-pin header, 2x USB 3.0, 2x USB 2.0, 2x micro HDMI, GbE, CSI, DSI | ~3 W idle, ~6 W load | 85 x 56 mm | $55 | Raspberry Pi OS, Ubuntu, Armbian, Manjaro | Mature ecosystem, huge accessory market |
| **Raspberry Pi 5 (8 GB)** | BCM2712, 4x Cortex-A76 @ 2.4 GHz | 8 GB LPDDR4X-4267 | MicroSD, NVMe via HAT+ (PCIe 2.0 x1) | 40-pin header, 2x USB 3.0, 2x USB 2.0, 2x micro HDMI 4Kp60, GbE, 2x CSI/DSI, PCIe, RTC | ~3.5 W idle, ~7 W load | 85 x 56 mm | $80 | Raspberry Pi OS, Ubuntu 24.04+, Armbian | 2-3x CPU perf over Pi 4, PCIe, RTC |
| **Raspberry Pi CM4** | BCM2711, 4x Cortex-A72 @ 1.5 GHz | 1/2/4/8 GB LPDDR4-3200 | eMMC (8/16/32 GB) or SD via carrier, PCIe 2.0 x1 | Via carrier: 2x HDMI, 2x CSI, 2x DSI, GbE, USB 2.0, GPIOs | ~2.5 W idle, ~5.5 W load | 55 x 40 mm (SO-DIMM style) | $25–75 | Raspberry Pi OS, Ubuntu, Yocto | Production module, eMMC, PCIe |
| **Raspberry Pi CM5** | BCM2712, 4x Cortex-A76 @ 2.4 GHz | 2/4/8 GB LPDDR4X-4267 | eMMC (16/32/64 GB) or SD via carrier, PCIe 2.0 x4 | Via carrier: 2x HDMI, 2x CSI/DSI, GbE, USB 3.0, PCIe, GPIOs | ~3 W idle, ~6.5 W load | 55 x 40 mm (CM4-compatible) | $45–95 | Raspberry Pi OS, Ubuntu, Yocto | CM4 pin-compatible, faster CPU, PCIe x4 |
| **BeagleBone Black** | AM3358, 1x Cortex-A8 @ 1 GHz | 512 MB DDR3L | 4 GB eMMC, MicroSD | 2x 46-pin headers (65 GPIO), USB 2.0, HDMI, 7x 12-bit ADC, 2x PRU cores | ~1 W idle, ~2.3 W load | 86 x 54 mm | $55 | Debian, Ubuntu, Yocto | PRU real-time subsystem (2x 200 MHz) |
| **BeagleBone AI-64** | TDA4VM, 2x Cortex-A72 @ 2 GHz + C7x DSP + MMA | 4 GB LPDDR4 | MicroSD, USB boot | 2x 46-pin headers, 2x USB 3.0, GbE, M.2 E-key, CSI | ~5 W idle, ~12 W load | 102 x 80 mm | $180 | Debian (TI SDK) | 8 TOPS AI accelerator + DSP |
| **Seeed reTerminal** | CM4-based (4x Cortex-A72 @ 1.5 GHz) | 4 GB LPDDR4 | 32 GB eMMC | 40-pin breakout, USB 2.0, GbE, 5" 720p touchscreen, accelerometer, light sensor | ~3 W idle, ~5.5 W load | 140 x 95 x 21 mm | $195 | Raspberry Pi OS, custom images | Integrated HMI with touchscreen + sensors |
| **Seeed XIAO ESP32S3** | ESP32-S3 (Xtensa LX7 dual-core @ 240 MHz) | 8 MB PSRAM | 8 MB flash, MicroSD via breakout | 11 GPIO, SPI, I2C, UART, USB-C, OV2640 camera connector | ~0.1 W idle, ~0.5 W active | 21 x 17.8 mm | $5–8 | ESP-IDF, Arduino, MicroPython | Thumb-sized with camera, MCU-class |
| **ZimaBoard 832** | Intel Celeron N3450, 4x @ 1.1–2.2 GHz (x86) | 8 GB LPDDR4 | 32 GB eMMC, 2x SATA 6 Gbps | 2x GbE, 2x USB 3.0, PCIe 2.0 x4, mini-DP | ~6 W idle, ~12 W load | 120 x 75 mm | $200 | Ubuntu, Debian, CasaOS, TrueNAS, Proxmox | x86 + dual SATA + dual GbE |
| **Orange Pi 5** | RK3588S, 4x A76 @ 2.4 GHz + 4x A55 @ 1.8 GHz | 4/8/16 GB LPDDR4X | MicroSD, eMMC module, NVMe (M.2 M-key) | 26-pin header, USB 3.0, USB-C, HDMI 2.1 8K, GbE, CSI | ~2.5 W idle, ~8 W load | 100 x 62 mm | $60–90 | Orange Pi OS, Armbian, Ubuntu | RK3588S 6 TOPS NPU, 8K decode |
| **NVIDIA Jetson Orin Nano (8 GB)** | 6x Cortex-A78AE @ 1.5 GHz, 1024-core Ampere GPU | 8 GB LPDDR5 | MicroSD (dev kit), NVMe via carrier | USB 3.2, GbE, 2x CSI, GPIO header, M.2 M-key, M.2 E-key, DP | ~7 W idle, ~15 W load | 69.6 x 45 mm (module) | $250 (module) | JetPack (Ubuntu-based), L4T | Up to 40 TOPS AI inference |
| **NVIDIA Jetson Orin NX (16 GB)** | 8x Cortex-A78AE @ 2 GHz, 1024-core Ampere GPU | 16 GB LPDDR5 | NVMe via carrier | USB 3.2, GbE, 4x CSI, GPIO, M.2 M-key, DP, PCIe x8 | ~10 W idle, ~25 W load | 69.6 x 45 mm (module) | $700 (module) | JetPack (Ubuntu-based), L4T | Up to 100 TOPS AI inference |

---

### Raspberry Pi Family

The Raspberry Pi line covers a wide range from ultra-compact IoT nodes to
desktop-replacement performance, and its ecosystem — documentation, community
forums, accessory market, and third-party library support — is unmatched in the
SBC space.

#### Pi Zero 2 W

The quad-core Cortex-A53 upgrade from the original Pi Zero makes the Zero 2 W
viable for lightweight Linux workloads that the single-core Zero could not
sustain. The 512 MB RAM ceiling is the primary constraint: running a GUI is
impractical, but headless applications (MQTT broker, sensor aggregator,
lightweight web server) fit comfortably. Idle power draw around 0.4 W makes
battery and solar-powered deployments feasible. Wi-Fi (802.11 b/g/n) and
Bluetooth 4.2 are integrated, but there is no wired Ethernet — a USB Ethernet
adapter occupies the single micro USB OTG port, which is also the only data
connection.

The CSI camera connector on the Zero 2 W uses a smaller ribbon cable format (22
pin, 0.5 mm pitch) rather than the standard Pi camera connector (15 pin, 1.0 mm
pitch). An adapter cable is required to use standard Pi camera modules. The mini
HDMI port requires an adapter for display output during debugging.

Thermal behavior on the Zero 2 W is generally not a concern — the small die area
and low clock speed keep temperatures well below throttling thresholds even
without a heatsink, except in enclosed deployments with no airflow at elevated
ambient temperatures (above ~40°C).

Common use cases: Wi-Fi-connected sensor nodes, lightweight MQTT brokers,
PiHole DNS filtering, dedicated print servers, simple GPIO automation, and
battery-powered camera traps (with appropriate sleep/wake cycling).

#### Pi 4 Model B

The general-purpose workhorse of the Pi lineup. Dual micro HDMI outputs support
4Kp60 (one port) or dual 4Kp30. USB 3.0 ports provide actual high-speed
peripheral access (up to ~300 MB/s measured throughput to an attached SSD), and
true Gigabit Ethernet (unlike the Pi 3's USB 2.0-bottlenecked Ethernet) enables
network-attached storage and streaming use cases. The 4 GB RAM variant handles
most embedded Linux workloads comfortably, including containerized applications
via Docker.

Thermal management is the Pi 4's main operational concern. Under sustained
quad-core load without a heatsink, thermal throttling engages at 80°C and
reduces the clock speed from 1.8 GHz to 1.5 GHz, then further to 1.0 GHz as
temperature continues rising. A basic aluminum heatsink or the official Pi 4
case fan eliminates throttling under normal ambient temperatures (below ~35°C).
The passive "armor case" style heatsink cases (where the entire case is a
heatsink) provide effective cooling without fan noise.

The Pi 4 supports USB boot (booting from a USB SSD instead of an SD card), which
significantly improves storage performance and reliability for applications with
heavy I/O. The boot EEPROM must be updated to enable this feature. The process
is straightforward:

```bash
# Update the bootloader to latest stable
sudo rpi-eeprom-update -a
sudo reboot

# After reboot, configure boot order (USB first, then SD)
sudo raspi-config
# Advanced Options → Boot Order → USB Boot
```

Once USB boot is configured, a USB 3.0 SSD provides dramatically better
performance than any SD card — boot time drops from ~25 seconds (SD) to ~12
seconds (SSD), and random I/O performance improves by 10-20x.

The Pi 4 has reached maturity: driver support is stable, peripheral
compatibility is well-documented, and the accessory ecosystem (cases, HATs, PoE
modules, camera modules, displays) is extensive. For new projects that do not
specifically need the Pi 5's performance improvements, the Pi 4 remains a safe
and cost-effective choice.

#### Pi 5

A substantial performance jump over the Pi 4: 2-3x improvement in
single-threaded and multi-threaded CPU benchmarks, driven by the Cortex-A76
cores at 2.4 GHz. The addition of a dedicated RP1 southbridge chip is an
architectural improvement — USB, Ethernet, and GPIO are no longer sharing a
single USB 2.0 bus as on the Pi 4. Each peripheral controller has its own
dedicated connection to the SoC via PCIe, eliminating the bandwidth contention
that could cause latency spikes on the Pi 4 when USB and Ethernet were active
simultaneously.

The PCIe 2.0 x1 interface (accessible via the HAT+ connector or a flat cable
adapter) enables NVMe SSD boot with dramatically better storage performance than
SD or USB. While officially PCIe 2.0 x1 (~500 MB/s theoretical), many NVMe
drives function at PCIe Gen 3 speeds with a config.txt modification:

```ini
# /boot/firmware/config.txt
# Experimental: force PCIe Gen 3 (not officially supported)
dtparam=pciex1_gen=3
```

This typically yields sequential read speeds of ~800 MB/s, though compatibility
varies by NVMe drive model and is not officially guaranteed by the Raspberry Pi
Foundation.

The Pi 5 includes a built-in real-time clock (RTC) with a battery connector —
the first Pi to include this feature. For applications that need accurate time
after power loss without network access (data logging in remote locations), this
eliminates the need for an external RTC module.

Power requirements increased: the Pi 5 needs a 5V 5A USB-C supply (the official
Pi 5 power supply uses USB PD negotiation). A standard 5V 3A supply may cause
undervoltage warnings under load, indicated by a lightning bolt icon on HDMI
output and throttled performance. The Pi 5 also enforces USB peripheral power
limits more strictly — high-power USB devices may not receive sufficient current
without a powered USB hub.

The fan header on the Pi 5 supports PWM-controlled active cooling. The official
Active Cooler (a combined heatsink and fan assembly) keeps the Pi 5 well below
throttling temperatures even under sustained full load, with the fan running at
inaudible speeds below ~60°C.

#### CM4 (Compute Module 4)

The production-oriented variant of the Pi 4 platform. The CM4 packages the
BCM2711 SoC, RAM, and optional eMMC onto a compact 55 x 40 mm module that
connects to a carrier board via two 100-pin Hirose DF40 high-density connectors.
This separation of compute and I/O is the key advantage: the carrier board can
be designed with exactly the connectors, mounting holes, and form factor the
application requires.

CM4 configurations span a matrix of options:

| Feature | Options |
|---------|---------|
| RAM | 1 GB, 2 GB, 4 GB, 8 GB |
| eMMC | None (Lite), 8 GB, 16 GB, 32 GB |
| Wireless | With Wi-Fi/BT, without |
| Antenna | On-module, external (u.FL connector) |

The eMMC variants provide more reliable boot media than SD cards, particularly
important for deployed systems that cannot tolerate SD card corruption after
unexpected power loss. The "Lite" variants (no eMMC) boot from SD via the carrier
board and are appropriate for prototyping or applications where the carrier board
provides its own NVMe storage.

The PCIe 2.0 x1 lane on the CM4 is typically used for NVMe storage, USB 3.0
host controllers, or Ethernet controllers on custom carrier boards. The CM4 IO
Board (the official development carrier) breaks out all interfaces and provides
a good starting point for prototyping before designing a custom carrier.

An industrial temperature variant of the CM4 is available, rated to -20°C to
+85°C (compared to the standard 0°C to +80°C). This variant is essential for
outdoor or industrial deployments where environmental temperature cannot be
controlled.

#### CM5 (Compute Module 5)

Pin-compatible with the CM4 at the mechanical level, the CM5 upgrades to the
BCM2712 (Cortex-A76 cores) and expands the PCIe interface to x4 lanes. This
backward compatibility means existing CM4 carrier boards work with the CM5
(subject to some power supply and thermal adjustments — the CM5 draws
slightly more current than the CM4 under load).

New carrier designs targeting the CM5 can take advantage of the additional PCIe
bandwidth (4 lanes vs 1 lane). This enables higher-throughput NVMe storage,
multi-port USB 3.0 host controllers, or even attaching low-power PCIe
accelerator cards.

The CM5 supports larger eMMC options (up to 64 GB) and exposes USB 3.0 via the
carrier board — a meaningful improvement over the CM4's USB 2.0 limitation. For
new production designs, the CM5 is the default recommendation unless the project
is cost-constrained to the point where the CM4's lower starting price ($25 vs
$45) matters.

The CM5 also inherits the Pi 5's RP1 southbridge architecture, meaning that
GPIO, SPI, I2C, and UART interfaces operate through dedicated pathways rather
than sharing bandwidth with USB and Ethernet. This reduces latency jitter on
peripheral I/O under heavy network or USB traffic.

---

### BeagleBone

#### BeagleBone Black

The distinguishing feature of the BeagleBone Black is the PRU (Programmable
Real-time Unit) subsystem: two 200 MHz 32-bit RISC cores that operate
independently of the main ARM core and Linux kernel. The PRUs have direct access
to GPIO pins with single-cycle (5 ns) pin toggle capability, making them
suitable for:

- Bit-banged protocols (WS2812B LED strips, custom serial protocols)
- High-speed pulse generation and measurement
- Stepper motor step/direction generation with precise timing
- Custom industrial I/O timing that cannot be achieved from Linux userspace
- Emulating hardware peripherals (additional UARTs, encoders)

The AM3358 SoC's main Cortex-A8 core at 1 GHz is modest by current standards —
comparable to the original Raspberry Pi in CPU performance. The 512 MB DDR3L RAM
limits the complexity of Linux workloads that can run alongside PRU-based
real-time tasks. The 4 GB onboard eMMC provides a reliable boot medium without
an SD card, though 4 GB fills quickly with a full Debian installation — careful
package selection or a minimal image (using debootstrap) is advisable.

The BeagleBone's 2x 46-pin headers expose a large number of peripheral options:
up to 65 GPIO pins, 7 analog inputs (1.8V max, 12-bit ADC), 4 UART buses, 2 SPI
buses, 2 I2C buses, 8 PWM outputs, and the PRU I/O pins. The analog inputs are
notable — most ARM Linux SBCs lack any ADC capability, requiring external ADC
ICs (MCP3008 via SPI or ADS1115 via I2C). The BeagleBone's built-in ADC,
while limited to 1.8V input range and ~200 ksps, eliminates the need for
external ADC hardware in many sensor-reading applications.

The PRU programming model uses the remoteproc framework for loading firmware and
the RPMsg protocol for communication between the ARM core (running Linux) and
the PRU cores. TI's PRU Software Support Package provides header files, linker
scripts, and example programs. The C compiler (clpru) generates PRU assembly
from C code, though performance-critical inner loops are often written directly
in PRU assembly for precise cycle counting.

```c
/* PRU C example: toggle GPIO pin every 100 ns (10 MHz) */
#include <stdint.h>
#include <pru_cfg.h>
#include <pru_ctrl.h>

/* PRU GPIO register for direct pin access */
volatile register uint32_t __R30;  /* Output register */

void main(void) {
    /* Clear SYSCFG[STANDBY_INIT] to enable OCP master port */
    CT_CFG.SYSCFG_bit.STANDBY_INIT = 0;

    while (1) {
        __R30 ^= (1 << 0);   /* Toggle PRU output bit 0 */
        __delay_cycles(10);   /* 10 cycles @ 200 MHz = 50 ns half-period */
    }
}
```

The learning curve for PRU development is steep. Documentation is scattered
across TI wiki pages, the PRU Software Support Package repository on GitHub,
community blog posts (particularly Derek Molloy's "Exploring BeagleBone" series),
and example repositories. The investment pays off for applications that genuinely
need deterministic sub-microsecond I/O timing, but for general-purpose embedded
Linux tasks, the Raspberry Pi ecosystem is far more productive.

#### BeagleBone AI-64

A significant step up from the BeagleBone Black, built around TI's TDA4VM SoC
originally designed for automotive ADAS (Advanced Driver Assistance Systems)
applications. The dual Cortex-A72 cores provide competitive general-purpose CPU
performance. The C7x DSP core and dedicated Matrix Multiply Accelerator (MMA)
deliver up to 8 TOPS of AI inference performance — more than the Orange Pi 5's
NPU (6 TOPS) but less than the Jetson Orin Nano (40 TOPS).

The AI-64 targets edge vision and inference applications: the CSI camera
interface, hardware video codecs (H.264/H.265 encode and decode), and ML
accelerator form a coherent pipeline for tasks like object detection and
classification at the edge. The TI SDK (based on Debian) includes support for
TensorFlow Lite and ONNX model deployment to the accelerator through the TI
Deep Learning (TIDL) runtime. The toolchain is less mature than NVIDIA's
TensorRT ecosystem but covers common model architectures (MobileNet, YOLO,
ResNet, EfficientNet).

The board's power draw (5-12 W depending on workload) and physical size (102 x
80 mm) are significantly larger than the BeagleBone Black. The M.2 E-key slot
supports Wi-Fi/Bluetooth modules. The traditional BeagleBone cape headers are
retained for backward compatibility with some existing capes, though pin
assignments differ from the Black — not all Black capes work without
modification.

The TDA4VM also includes two R5F real-time Cortex-R5 cores that can run RTOS
(FreeRTOS) firmware concurrently with Linux on the A72 cores, providing real-time
I/O capability similar in concept (though different in implementation) to the
BeagleBone Black's PRUs.

---

### Seeed Platforms

#### reTerminal

A Raspberry Pi CM4 packaged inside an industrial-style enclosure with an
integrated 5-inch IPS touchscreen (720 x 1280, capacitive touch, portrait
orientation). The enclosure includes a built-in accelerometer (LIS3DHTR),
light sensor (LTR-303ALS-01), and four programmable buttons accessible via
GPIO. A 40-pin GPIO header is accessible on the rear of the unit through a
removable cover.

The reTerminal targets HMI (human-machine interface) prototyping and dashboard
applications. Rather than assembling a separate Pi + display + case + touch
driver, the reTerminal provides a single integrated unit. The CM4 inside is a
fixed 4 GB RAM / 32 GB eMMC configuration with Wi-Fi — the CM4 is not easily
swappable (it is soldered to the carrier board inside the enclosure), so the
configuration is permanent.

Typical use cases include:

- Industrial control panel displays (process monitoring, status dashboards)
- Kiosk interfaces (check-in terminals, information displays)
- Home automation control panels
- Data logger with local visualization
- Edge device management interface

The integrated nature is both the strength and the limitation: the display,
enclosure, and CM4 are not independently upgradeable. The 5-inch screen is
adequate for control panels and status dashboards but small for complex GUI
applications requiring dense information display. VESA mounting holes (75 x 75
mm) and a DIN rail adapter are available for industrial installation.

Running a web-based dashboard (Grafana, Node-RED dashboard) in Chromium kiosk
mode is a common software pattern for the reTerminal. The 4 GB RAM handles
this comfortably, including moderate-complexity Grafana dashboards with
real-time data updates.

#### XIAO ESP32S3

Strictly speaking, this is an MCU module rather than an SBC — it runs ESP-IDF or
Arduino firmware, not Linux. It appears in this comparison because it represents
the boundary where MCU-class hardware begins to overlap with tasks traditionally
assigned to SBCs: camera-based image capture, Wi-Fi connectivity, and basic ML
inference (via TensorFlow Lite Micro on the ESP32-S3's vector extensions).

At 21 x 17.8 mm, the XIAO ESP32S3 is smaller than a postage stamp. The camera
connector supports OV2640 modules for image capture at up to 1600 x 1200
resolution. The 8 MB PSRAM enables frame buffering for camera applications —
without PSRAM, the ESP32-S3's 512 KB internal SRAM cannot hold even a single
VGA-resolution frame.

Power draw is extremely low: tens of milliwatts in deep sleep (with RTC wake
configured), ~100 mW in light sleep, and ~500 mW active with Wi-Fi transmitting.
A small LiPo cell (500 mAh) can sustain periodic wake-capture-transmit-sleep
cycles for days.

The relevance for SBC selection is understanding where the MCU-to-SBC boundary
sits:

| Capability | XIAO ESP32S3 (MCU) | Linux SBC |
|---|---|---|
| Camera capture + classify + transmit | Possible (simple models) | Full flexibility |
| TLS/HTTPS client | Yes (mbedTLS) | Yes (OpenSSL) |
| MQTT client | Yes | Yes |
| Package manager | No | Yes (apt, pip) |
| Filesystem (large, writable) | Limited (LittleFS, FAT on SD) | Full (ext4, btrfs) |
| Multi-process orchestration | No (single RTOS, tasks) | Yes (systemd, Docker) |
| OTA updates | Yes (ESP-IDF OTA) | Yes (apt, Mender, RAUC) |
| Python/Node.js runtime | MicroPython (limited) | Full CPython, Node.js |
| Power draw | 0.01–0.5 W | 0.4–25 W |

If the workload is "capture a photo, run a small classifier, send a result over
Wi-Fi," the XIAO ESP32S3 may suffice at a fraction of the cost and power of a
Linux SBC. If the workload requires a full filesystem, a network stack with TLS
mutual authentication, a package manager, or multi-process orchestration, a
Linux SBC is the appropriate choice.

---

### ZimaBoard

#### ZimaBoard 832

An x86-based SBC built around the Intel Celeron N3450 (Apollo Lake, quad-core,
1.1 GHz base with 2.2 GHz burst). The x86 architecture is the differentiator:
standard amd64 Docker containers, Proxmox virtualization, TrueNAS, and any
conventional Linux distribution run without ARM compatibility concerns. There is
no need to find ARM-specific Docker images, cross-compile applications, or work
around architecture-specific library availability.

Two SATA 6 Gbps ports make the ZimaBoard suitable for NAS and storage gateway
applications — a use case where ARM SBCs typically require USB-to-SATA adapters
that bottleneck at USB 3.0 speeds and add reliability concerns. The PCIe 2.0 x4
slot can host a 10 GbE NIC, a low-profile GPU (within the 6W TDP limit), or an
NVMe adapter. Dual Gigabit Ethernet ports enable router/firewall configurations
(running OPNsense, pfSense, or a custom iptables/nftables setup).

The power draw trade-off is significant: 6 W idle and 12 W under load are 2-4x
higher than equivalent ARM SBCs. For battery-powered or solar-powered
deployments, this rules out the ZimaBoard. For always-on, mains-powered edge
servers and home lab applications, the power difference translates to roughly
$5-10/year in electricity costs (at US residential rates), which is unlikely to
drive platform selection.

The 32 GB eMMC provides boot storage. The SATA ports are the expected primary
storage medium — attaching two 2.5-inch SSDs or HDDs provides a compact NAS
configuration. The CasaOS software layer (developed by the same company,
IceWhale) provides a browser-based management interface for Docker container
orchestration, simplifying home server setup for applications like Nextcloud,
Plex, Home Assistant, and Gitea.

Common ZimaBoard use cases: home NAS, Docker host for self-hosted services,
network firewall/router, Proxmox virtualization host (for running multiple VMs
in a home lab), and edge data collection server.

---

### Orange Pi

#### Orange Pi 5

Built around the Rockchip RK3588S, the Orange Pi 5 offers competitive or
superior hardware specifications compared to the Raspberry Pi 5 at a similar or
lower price point. The big.LITTLE CPU configuration (4x Cortex-A76 @ 2.4 GHz +
4x Cortex-A55 @ 1.8 GHz) provides strong multi-core performance. The integrated
6 TOPS NPU (Neural Processing Unit) enables on-device ML inference without a
discrete accelerator.

The RK3588S supports 8K video decoding (H.265, VP9, AV1) and 8K display output
via HDMI 2.1 — capabilities that exceed the Pi 5. RAM options extend to 16 GB
LPDDR4X, which is useful for memory-intensive workloads such as running multiple
Docker containers, large database queries, or ML model inference.

The M.2 M-key slot directly on the board provides NVMe SSD support without the
adapter HAT required on the Pi 5. An eMMC module socket is also available as an
alternative to MicroSD boot. The presence of both NVMe and eMMC options directly
on the board — rather than through adapters — is a hardware advantage over the Pi
5 for storage-intensive applications.

The caveat — and it is a significant one — is software support. Key pain points:

- **Kernel** — The Orange Pi 5 relies on Rockchip's BSP (Board Support Package)
  kernel, which is based on Linux 5.10 and lags behind mainline. Mainline kernel
  support for the RK3588S is improving but not yet feature-complete for all
  peripherals.
- **GPU** — Mali-G610 MP4 acceleration under Linux depends on the Panfrost
  open-source driver. OpenGL ES 3.1 works; Vulkan support is incomplete. Desktop
  compositing and GPU-accelerated video playback are functional but less polished
  than on Pi hardware.
- **NPU** — Rockchip's RKNN (Rockchip Neural Network) toolkit provides the NPU
  runtime. Model compatibility is narrower than TensorRT or TFLite — not all
  operations are supported, and model conversion sometimes requires layer-by-layer
  debugging. The RKNN toolkit documentation is improving but still has gaps.
- **Camera** — CSI camera support depends on the BSP kernel and specific camera
  module compatibility. Not all V4L2-compatible cameras work out of the box.

Armbian provides the most actively maintained community images for the Orange Pi
5, but driver coverage, peripheral support, and bug fix velocity do not match the
Raspberry Pi Foundation's official OS releases. Community forum activity is lower,
and troubleshooting obscure issues often requires reading Chinese-language
documentation or forum posts.

For projects where the hardware specifications are the primary driver (NPU, 16 GB
RAM, NVMe on-board, 8K video) and the team is comfortable working through
software rough edges, the Orange Pi 5 is a strong option. For projects where
time-to-working-prototype and long-term software maintenance matter more, the
Raspberry Pi ecosystem remains safer.

---

### NVIDIA Jetson

#### Jetson Orin Nano

The entry point to NVIDIA's embedded GPU compute platform. The Orin Nano
delivers up to 40 TOPS (INT8) of AI inference performance via a 1024-core
Ampere GPU, paired with 6 Cortex-A78AE CPU cores. This positions it for edge AI
workloads that exceed what CPU-only SBCs or NPU-equipped ARM boards can handle:

- Multi-stream video analytics (4-8 simultaneous camera feeds)
- Real-time object detection at 1080p (YOLO, SSD, EfficientDet)
- Natural language processing inference (BERT, GPT-2 class models)
- Generative AI tasks at reduced model sizes (Stable Diffusion at low resolution)
- Simultaneous localization and mapping (SLAM) for robotics

The Orin Nano operates in two power modes: 7 W and 15 W. The 7 W mode reduces
GPU and CPU clocks to fit within a tighter thermal and power envelope, at the
cost of reduced inference throughput (roughly half of the 15 W mode). The 15 W
mode enables full performance but requires active cooling — a heatsink with fan,
or a carrier board with an integrated thermal solution.

The module itself is 69.6 x 45 mm and connects to a carrier board via a 260-pin
SO-DIMM connector (Jetson module form factor, not standard desktop SO-DIMM). The
official developer kit provides a carrier board with USB 3.2, GbE, DisplayPort,
GPIO header (compatible with Raspberry Pi HAT pinout for the first 40 pins), M.2
Key M (NVMe), and M.2 Key E (Wi-Fi). For production, custom carrier boards or
third-party carriers (from Connect Tech, Seeed Studio, Auvidea, or Antmicro) are
available with different I/O configurations.

Storage on the developer kit is via MicroSD; production deployments typically use
NVMe SSDs on the carrier board. The 8 GB LPDDR5 is unified memory shared between
CPU and GPU — there is no separate VRAM. Large model inference competes with the
OS and application for memory bandwidth. Monitoring memory usage during inference
is critical:

```bash
# Monitor Jetson resource usage (CPU, GPU, memory, power)
tegrastats

# Typical output:
# RAM 3412/7620MB (lfb 234x4MB) SWAP 0/3810MB ...
# GR3D_FREQ 76% ... VDD_IN 8432mW VDD_CPU_GPU_CV 3214mW ...
```

The `tegrastats` utility (Jetson-specific) provides real-time monitoring of RAM
usage, GPU utilization, power draw per rail, and thermal status. This is the
primary tool for sizing workloads to the platform.

#### Jetson Orin NX

The higher-performance tier, delivering up to 100 TOPS (INT8) with the same
Ampere GPU architecture but higher clock speeds, 8 CPU cores (vs 6 on the Orin
Nano), and 16 GB LPDDR5. The additional memory is critical for:

- Running larger models (YOLOv8-X, EfficientDet-D7, larger transformer models)
- Multiple concurrent inference pipelines (e.g., object detection + pose
  estimation + tracking simultaneously)
- Models with large input resolutions (4K inference)
- Development and profiling (where tools like Nsight consume additional memory)

The Orin NX supports more PCIe lanes (up to x8, configurable as 1x8, 2x4, 1x4+
2x2, etc.) and more CSI camera lanes (up to 6 cameras via 3x MIPI CSI-2 x2
ports) than the Orin Nano, making it suitable for multi-camera vision systems
such as 360-degree surround view, multi-angle inspection, and autonomous
navigation.

The 25 W power mode enables full GPU utilization, though 10 W and 15 W modes are
available for power-constrained deployments. The power mode trade-off is direct:
reducing from 25 W to 10 W roughly halves inference throughput but enables
passive cooling and smaller power supplies.

#### Jetson Software Stack

Both Jetson Orin modules require NVIDIA's JetPack SDK, which is based on Ubuntu
but includes NVIDIA-specific components:

- **L4T (Linux for Tegra)** — NVIDIA's customized Ubuntu with kernel patches for
  the Tegra/Orin SoC family
- **CUDA** — GPU compute library; the foundation for all GPU-accelerated
  workloads
- **cuDNN** — Optimized deep learning primitives (convolution, pooling,
  normalization)
- **TensorRT** — Inference optimizer and runtime; converts trained models into
  GPU-optimized execution engines
- **Jetson Multimedia API** — Hardware-accelerated video encode/decode, camera
  capture (via Argus/libargus)
- **VPI (Vision Programming Interface)** — GPU/PVA-accelerated computer vision
  operations (stereo disparity, optical flow, image filtering)
- **DeepStream** — SDK for building multi-stream video analytics pipelines

Standard Armbian or vanilla Ubuntu images do not work on Jetson hardware. The
GPU, encoder/decoder hardware, and CSI camera pipeline all depend on NVIDIA's
proprietary drivers and firmware. The SDK Manager tool for initial flashing runs
on an Ubuntu x86 host machine connected to the Jetson via USB — there is no
self-flash capability on the Jetson itself.

For AI-specific workload planning, model optimization, and deployment strategies
on Jetson hardware, see the [Edge AI]({{< relref "/docs/edge-ai" >}}) section.

---

## Compute Modules vs Dev Boards

The decision between a standalone SBC (like the Pi 4 or BeagleBone Black) and a
compute module (like the CM4, CM5, or Jetson SoM) typically tracks with the
project phase and production intent.

### When to Use a Dev Board

Development boards are self-contained: they include the SoC, RAM, storage
interface, power regulation, USB ports, video output, and GPIO headers on a
single PCB. This makes them ideal for:

- **Prototyping and proof-of-concept** — No carrier board design required,
  peripheral access is immediate. Power up, flash an SD card, and start
  developing.
- **Low-volume deployments** (fewer than ~50-100 units) — The NRE (non-recurring
  engineering) cost of a custom carrier board design ($2,000-$10,000 for
  schematic, layout, fabrication, and assembly) is not justified at low volumes.
- **Education and experimentation** — Plug in and start. The ecosystem of
  tutorials, example projects, and community support assumes a dev board.
- **Applications where the standard I/O set is sufficient** — If the Pi 4's USB,
  HDMI, GPIO, and Ethernet ports match the project's needs, a custom carrier
  adds cost without benefit.
- **Rapid iteration** — When the hardware requirements are still being defined
  and may change significantly between iterations.

### When to Use a Compute Module

Compute modules separate the processing core from the I/O board, which provides
several advantages for production:

- **Custom form factor** — The carrier board can be designed with exactly the
  connectors, mounting holes, and board outline the enclosure requires,
  eliminating unnecessary ports and wasted PCB area. A CM4 on a minimal carrier
  can fit in a form factor far smaller than a Pi 4.
- **Peripheral customization** — A carrier board can route PCIe to an NVMe slot,
  break out additional UARTs from the SoC, add PoE circuitry (802.3af/at), or
  include application-specific hardware (RS-485 transceivers, CAN bus
  controllers, industrial ADCs) — configurations not available on standard dev
  boards.
- **eMMC boot reliability** — Compute modules with onboard eMMC avoid the SD
  card failure mode that plagues long-running SBC deployments. The eMMC is
  soldered to the module, eliminating contact oxidation and vibration-related
  disconnection that affect SD card sockets.
- **Thermal management** — A custom carrier board design can position the module
  and heatsink to align with the enclosure's thermal path, rather than working
  around the dev board's fixed layout. Heat can be conducted to the enclosure
  walls, a dedicated heat pipe, or a custom heatsink profile.
- **Supply chain planning** — Compute modules from established vendors (Raspberry
  Pi Foundation, NVIDIA) have clearer long-term availability commitments and
  industrial-grade temperature ratings. The CM4 offers an industrial temperature
  variant rated to -20°C to +85°C.
- **Upgradability** — Pin-compatible module upgrades (CM4 to CM5) allow a carrier
  board design to benefit from new silicon without a full PCB redesign. The
  carrier board investment is preserved.
- **Certification** — A compute module with pre-certified wireless (FCC, CE, IC)
  simplifies the regulatory certification process for the final product. Only
  the carrier board's unintentional emissions need to be tested, not the radio.

### Carrier Board Design Considerations

Designing a custom carrier board involves several engineering disciplines:

**Schematic design** — Start from the vendor's reference design schematic (CM4 IO
Board, Jetson dev kit). The reference design shows the required power supply
rails, decoupling capacitor placement, pull-up/pull-down resistors, and interface
circuits. Modifying a proven reference design is far safer than designing from
scratch.

**Power supply design** — The module's power input requirements (voltage, current,
sequencing, ramp rate) must be met precisely. The CM4 requires 5V at up to 2.5A
with specific power sequencing between VBAT, 3.3V, and 1.8V rails. Underpowered
modules exhibit subtle reliability failures (random crashes, filesystem
corruption, peripheral initialization failures) rather than clean error messages
or refusal to boot.

**High-speed signal routing** — PCIe, HDMI, USB 3.0, and CSI lanes require
impedance-controlled differential pairs (typically 85-100 ohm differential
impedance) and length matching (within 5 mils for intra-pair, within 100 mils
for inter-pair). A 2-layer PCB is insufficient for most carrier board designs; a
minimum of 4 layers is typical, with 6 layers preferred for boards with multiple
high-speed interfaces.

**Connector selection** — The module-to-carrier connector (100-pin Hirose DF40
for CM4/CM5, 260-pin SO-DIMM for Jetson) requires specific PCB footprints,
stacking heights, and solder paste specifications. The connector vendor's
recommended PCB layout guidelines must be followed precisely — misalignment
causes unreliable connections that are extremely difficult to debug.

**Thermal interface** — The thermal pad or heatsink mounting must align with the
module's SoC location. Compute modules specify a maximum junction temperature
(typically 100-105°C) and may provide a thermal resistance budget. The thermal
path from the SoC die through the module's thermal pad, through the thermal
interface material (TIM), to the heatsink or enclosure determines whether the
design can sustain full performance without throttling.

**Testing and bring-up** — Plan for at least one board spin (revision). First
prototypes commonly have issues with high-speed signal integrity, power supply
noise, or mechanical fit. Building 3-5 prototypes of the first revision is
typical. Include test points on critical power rails and data lines.

---

## Tips

- Start prototyping on a dev board and transition to a compute module for
  production. The dev board validates the software stack and peripheral
  requirements; the compute module addresses form factor, reliability, and
  thermal constraints. This two-phase approach avoids the cost and delay of a
  carrier board design before the software requirements are stable.

- Check actual peripheral availability before committing to a platform. Some
  GPIO pins are shared with other functions through pin muxing — enabling a
  second SPI bus may disable several GPIO pins. The device tree overlay
  documentation (or `pinctrl` output on a running board) shows the real
  configuration. On a Raspberry Pi, `raspi-gpio get` displays the current
  function of every GPIO pin.

- Power budget matters early in the design. A Pi 5 under load draws 5-7 W vs a
  Pi Zero 2 W at ~0.4 W idle — this difference drives fundamentally different
  power supply, thermal, and enclosure designs. Measure actual power draw with a
  USB power meter under realistic workload conditions; do not rely solely on
  datasheet nominal values.

- Community size correlates with troubleshooting speed. The Raspberry Pi has the
  largest ecosystem by far — a search for almost any Pi-related issue returns
  forum threads, blog posts, and Stack Overflow answers. Smaller communities
  (BeagleBone, Orange Pi, Jetson) may require more self-directed debugging and
  source code reading.

- For production deployments, prefer eMMC over SD card for boot media
  reliability. SD cards in write-heavy applications (logging, databases, frequent
  config writes) develop bad sectors and filesystem corruption over months to
  years of continuous operation. eMMC flash has better wear leveling, error
  correction, and write endurance.

- Evaluate storage I/O requirements early. The jump from MicroSD (~3-5 MB/s
  random 4K read) to eMMC (~10-20 MB/s) to NVMe (~50-500 MB/s) dramatically
  affects boot time, application responsiveness, and logging throughput. A
  database-backed application that performs well on NVMe during development may
  be unacceptably slow on SD card in deployment.

- Test thermal behavior under sustained load before finalizing an enclosure
  design. A board that runs cool during a 5-minute demo may throttle badly
  inside a sealed enclosure after 30 minutes of continuous operation at elevated
  ambient temperature. The test should simulate the worst-case workload at the
  highest expected ambient temperature.

- Budget for a proper power supply. Underpowered USB supplies cause subtle,
  intermittent failures that waste debugging time. The Pi 5 in particular
  requires a USB-PD capable 5V/5A supply — a generic phone charger is
  insufficient under load.

- When evaluating boards for production, request samples of multiple units from
  the same SKU. Manufacturing variation in components (especially SD card slots,
  USB connectors, and thermal interface materials) occasionally produces units
  with different behavior. Testing 3-5 units catches issues that a single sample
  would miss.

---

## Caveats

- Headline specs can mislead. RAM bandwidth, I/O throughput, and thermal
  throttling behavior under sustained load matter more than peak clock speed in
  most embedded applications. A benchmark under realistic workload conditions is
  the only reliable way to evaluate platform performance. A board that benchmarks
  well in a 30-second synthetic test may throttle badly in a sustained
  application.

- Raspberry Pi CM4 and CM5 availability has historically been constrained during
  semiconductor shortages. Plan for supply chain risk by qualifying at least one
  alternative platform or ordering modules with sufficient lead time. The
  Raspberry Pi Foundation prioritizes industrial customers for CM allocation
  through the Approved Reseller network, which helps for production orders but
  not always for initial prototyping quantities.

- BeagleBone PRU documentation is sparse and fragmented. The TI wiki, the PRU
  Software Support Package repository, and community blog posts collectively
  cover the topic, but there is no single coherent reference. Expect a
  multi-week learning curve to become productive with PRU programming. The
  remoteproc and RPMsg APIs have changed across kernel versions, so examples
  from older blog posts may not work without modification on current kernels.

- Jetson boards require NVIDIA's JetPack SDK. Standard Armbian, Ubuntu Server,
  or other generic ARM images do not work. JetPack includes NVIDIA-specific
  kernel patches, device trees, firmware blobs, and userspace libraries. The SDK
  Manager for initial flashing runs only on Ubuntu x86 host machines (20.04 or
  22.04 specifically — not other Ubuntu versions, not other distros without
  container-based workarounds). This creates a hard dependency on NVIDIA's
  software release cadence for security patches and feature updates.

- Orange Pi and other Raspberry Pi alternatives often lag on mainline kernel
  support and driver quality. GPU acceleration, camera interfaces, and hardware
  video codecs may require vendor-specific BSP kernels that are pinned to older
  kernel versions (e.g., Linux 5.10 when mainline is at 6.x). Evaluate the
  specific peripheral support needed before committing — the board may have the
  hardware capability but lack the software driver to access it.

- ZimaBoard and other x86 SBCs have power draw (6-12 W) significantly higher
  than ARM alternatives at comparable performance levels. For battery or solar
  applications, this power difference is disqualifying. For mains-powered edge
  computing, the ~$8/year additional electricity cost is unlikely to matter, but
  the thermal design implications (larger heatsink, possible fan) do matter for
  enclosure design.

- The MicroSD boot medium used by many SBCs is a known reliability risk.
  Industrial-grade SD cards (SanDisk Industrial, Transcend Industrial, ATP)
  improve the situation but do not eliminate it. The root cause is the SD card's
  flash translation layer and write amplification — consumer cards prioritize
  sequential write speed (for cameras) over random write endurance (needed for
  OS operations). For any deployment expected to run continuously for months or
  years, plan for eMMC, NVMe, or network boot (PXE/TFTP).

- USB peripherals on SBCs can cause unexpected boot failures. Some USB devices
  draw excessive current during enumeration, causing voltage drops that reset
  the SBC. Others present firmware bugs that cause kernel panics during USB
  enumeration. Test every USB peripheral that will be used in the deployed
  configuration during extended boot testing (100+ boot cycles).

- Wi-Fi performance on SBCs varies significantly with antenna design, RF
  environment, and driver quality. Onboard antennas (Pi Zero 2 W, Pi 4) provide
  modest range suitable for indoor use. For reliable outdoor or long-range
  connectivity, an external antenna (via u.FL connector on the CM4) or a USB
  Wi-Fi adapter with a high-gain antenna is typically necessary.

---

## In Practice

A project that starts on a Pi 4 often migrates to CM4 on a custom carrier board
once the prototype stabilizes. The CM4's smaller footprint and eMMC boot make it
more suitable for enclosures and repeated deployments. The typical workflow is:
prove the concept on a Pi 4, port the SD card image to the CM4 IO Board to
validate peripheral access and device tree compatibility, then design the custom
carrier board. The software transition from Pi 4 to CM4 is minimal — the SoC is
identical — but the carrier board hardware design takes 4-8 weeks including
schematic capture, PCB layout, fabrication, assembly, and bring-up testing.

Thermal throttling on a Pi 5 without a heatsink commonly appears as intermittent
performance drops during sustained CPU load. The symptom is inconsistent: a
benchmark may run 30% slower than expected on one run and normally on the next,
because the throttling engages and disengages as the die temperature oscillates
around the 80°C threshold. Checking `vcgencmd measure_temp` and seeing values
above 80°C is a clear indicator. The `vcgencmd get_throttled` command returns a
bitmask that reveals whether throttling has occurred since boot — a non-zero
return value after running a sustained workload confirms thermal throttling as
the performance bottleneck.

```bash
# Check current SoC temperature
vcgencmd measure_temp
# temp=72.0'C

# Check throttle status (0x0 = no throttling has occurred)
vcgencmd get_throttled
# throttled=0x50005
# Bit 0:  under-voltage detected (now)
# Bit 1:  ARM frequency capped (now)
# Bit 2:  currently throttled
# Bit 3:  soft temperature limit active
# Bit 16: under-voltage has occurred (since boot)
# Bit 17: ARM frequency capping has occurred
# Bit 18: throttling has occurred
# Bit 19: soft temperature limit has occurred
```

A value of `0x50005` indicates that under-voltage is currently detected (bit 0),
and that both under-voltage and throttling have occurred at some point since boot
(bits 16 and 18). This pattern is characteristic of a power supply that cannot
sustain the required current under load — upgrading to the official Pi 5 power
supply (5V/5A USB-PD) typically resolves it.

BeagleBone PRU-based GPIO toggling shows up as sub-microsecond jitter on an
oscilloscope, compared to tens of microseconds from userspace `libgpiod` on the
same board. This difference is what makes the PRU attractive for real-time I/O
despite the steeper development effort.

A typical comparison test involves toggling a GPIO pin in a tight loop and
measuring the period with an oscilloscope:

| Method | Toggle Period | Jitter (p-p) | Notes |
|--------|--------------|-------------- |-------|
| PRU direct register write | 10 ns (100 MHz) | < 1 ns | Limited by 200 MHz PRU clock |
| PRU with delay loop (1 us period) | 1.000 us | < 5 ns | Deterministic cycle counting |
| Kernel GPIO (sysfs) | 50-200 us | 10-100 us | Highly variable, kernel scheduling |
| libgpiod from userspace | 10-50 us | 5-50 us | Better than sysfs, still non-deterministic |
| libgpiod with SCHED_FIFO | 8-30 us | 3-20 us | Improved but not guaranteed |

The PRU achieves consistent 5 ns granularity (limited by the 200 MHz clock),
while `libgpiod` from userspace shows a toggle period of 10-50 microseconds with
periodic latency spikes from kernel scheduling, interrupt handling, and memory
management. Running the userspace application with `SCHED_FIFO` real-time
priority reduces but does not eliminate the jitter — the kernel still interrupts
for timer ticks, network packets, and other system activity. The PRU is immune
to these interruptions because it operates independently of the Linux kernel.

Jetson Orin Nano inference benchmarks frequently cite peak TOPS, but real-world
model throughput depends heavily on memory bandwidth and model optimization.
Running an unoptimized ONNX or TFLite model on the Jetson GPU often shows only
10-20% of theoretical throughput. The TensorRT conversion step — which quantizes
weights to FP16 or INT8, fuses adjacent layers (convolution + batch norm + ReLU
into a single kernel), and optimizes the execution graph for the specific GPU
architecture — typically yields a 3-5x throughput improvement.

The workflow for deploying an optimized model:

1. Train the model on a workstation GPU (or cloud GPU)
2. Export to ONNX format
3. Transfer the ONNX file to the Jetson
4. Run `trtexec` on the Jetson to build a TensorRT engine file optimized for the
   specific GPU and power mode
5. Deploy the engine file in the application

```bash
# Convert ONNX model to TensorRT engine on the Jetson
# The engine is hardware-specific — must be built on the target device
/usr/src/tensorrt/bin/trtexec \
    --onnx=model.onnx \
    --saveEngine=model_fp16.engine \
    --fp16 \
    --workspace=2048 \
    --verbose

# Benchmark the optimized engine
/usr/src/tensorrt/bin/trtexec \
    --loadEngine=model_fp16.engine \
    --batch=1 \
    --iterations=1000 \
    --avgRuns=100

# Example output for a MobileNetV2 model:
# Throughput: 842.3 qps
# Latency: mean = 1.18 ms, p99 = 1.35 ms
# GPU Compute Time: mean = 0.94 ms
```

Skipping the TensorRT conversion step leads to misleading benchmark results and
potentially undersized hardware procurement. A model that runs at 100 fps with
TensorRT optimization on an Orin Nano might run at only 20 fps without it — the
difference between a viable product and a hardware upgrade requirement.

The TensorRT engine file is specific to the GPU architecture and the TensorRT
version. An engine built on one Jetson model does not work on a different model,
and an engine built with TensorRT 8.5 may not load on TensorRT 8.6. The engine
must be rebuilt whenever the target hardware or TensorRT version changes — a
detail that affects deployment automation and OTA update pipelines.

SD card failure in deployed Raspberry Pi systems typically manifests as read-only
filesystem remounts or boot failures after weeks to months of continuous
operation. The failure mode is insidious: the system runs normally for weeks, then
one day fails to write logs, save configuration changes, or complete a software
update. In the worst case, the filesystem becomes corrupted and the system fails
to boot entirely, requiring physical access to re-flash the SD card.

Monitoring for early warning signs:

```bash
# Check SD card health indicators (error counts)
cat /sys/block/mmcblk0/stat
# Fields: reads_completed reads_merged sectors_read ms_reading \
#         writes_completed writes_merged sectors_written ms_writing \
#         ios_in_progress ms_io weighted_ms_io

# Check kernel messages for MMC errors
dmesg | grep -i "mmc\|mmcblk"
# Watch for: "error -110" (timeout), "retrying" messages,
# "read-only" remount warnings

# Check filesystem health
sudo dumpe2fs -h /dev/mmcblk0p2 | grep -i "mount\|error\|state"
# "Filesystem state: clean" is expected
# "EXT4-fs error" entries indicate filesystem damage
```

The most reliable mitigations for SD card failure in production:

1. **Switch to eMMC** — Use CM4/CM5 with onboard eMMC for the root filesystem.
   eMMC has better wear leveling, error correction, and write endurance than
   consumer SD cards.
2. **NVMe root** — Boot from SD/eMMC but mount an NVMe SSD as the root
   filesystem. Particularly effective for write-heavy workloads.
3. **Read-only root** — Mount the root filesystem as read-only and use tmpfs for
   `/tmp`, `/var/log`, and other write-heavy paths. Application data writes go
   to a separate partition with wear-aware configuration (journaling disabled or
   reduced, noatime mount option).
4. **Overlay filesystem** — Use overlayfs to layer a tmpfs over the read-only
   root, allowing apparent writes without actually modifying the SD card. Changes
   are lost on reboot unless explicitly committed.
5. **Log rotation and write reduction** — Configure aggressive log rotation
   (`logrotate` with small file sizes and few kept files), disable unnecessary
   logging services, and use `tmpfs` for `/var/log` with periodic sync to
   persistent storage.

A production deployment targeting 5+ years of unattended operation should avoid
SD cards entirely. The cost difference between a CM4 Lite (SD boot) and a CM4
with 16 GB eMMC is roughly $10-15 — a trivial cost compared to the expense of a
field service visit to replace a failed SD card.
