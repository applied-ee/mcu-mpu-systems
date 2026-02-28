---
title: "MCU vs MPU — When to Use Which"
weight: 10
---

# MCU vs MPU — When to Use Which

The split between microcontrollers and microprocessors is the first fork in any embedded design. An MCU like the STM32F405 integrates 1 MB of flash, 192 KB of SRAM, and dozens of peripherals onto a single chip — power on and code executes in microseconds. An MPU like the Raspberry Pi CM4 (BCM2711, quad-core Cortex-A72) needs external DDR, an SD card or eMMC for storage, and boots a full Linux kernel in seconds. These are fundamentally different computing models, and picking the wrong one either over-constrains the software or over-complicates the hardware.

## Decision Matrix

| Feature | MCU | MPU |
|---------|-----|-----|
| OS support | Bare-metal or RTOS (FreeRTOS, Zephyr) | Full Linux, Android, or other POSIX OS |
| Boot time | Microseconds to low milliseconds | 3–15 seconds (kernel + userspace) |
| Real-time guarantees | Deterministic, sub-microsecond latency | Best-effort; RT-PREEMPT helps but not guaranteed |
| Memory | On-chip SRAM (4 KB–1 MB typical) | External DDR (256 MB–4 GB typical) |
| Power (active) | 10–200 mA | 200 mA–2 A |
| Power (sleep) | Sub-uA to low uA | 5–50 mA (suspend-to-RAM) |
| BOM cost | $1–10 (MCU + passives) | $15–50+ (SoM + DDR + eMMC + PMIC) |
| Software ecosystem | Vendor HAL, limited libraries | Full POSIX, thousands of Linux packages |

## Defining the Boundary

An MCU runs code directly from internal flash with no operating system required. Execution is deterministic — interrupt latency on a Cortex-M4 at 168 MHz is typically 12 cycles (~72 ns). An MPU relies on external DRAM, an MMU for virtual memory, and usually a full OS. The STM32H7 at 480 MHz with 1 MB of internal RAM sits at the upper edge of MCU territory, while the i.MX RT1060 (Cortex-M7, 600 MHz, external RAM) blurs the line — it has MCU-class peripherals but MPU-class memory requirements.

The distinction between an MPU (Memory Protection Unit) on Cortex-M and a full MMU (Memory Management Unit) on Cortex-A is critical. The MPU on Cortex-M defines a small number of memory regions (typically 8–16) with access permissions and cacheability attributes — it prevents accidental writes to flash or peripheral regions but does not provide virtual memory. A Cortex-A MMU provides full virtual-to-physical address translation, enabling process isolation, demand paging, and the memory model that Linux requires. An RTOS on a Cortex-M with an MPU can isolate tasks to some degree, but a misbehaving task can still crash the system if region configuration is incomplete.

## Real-Time Requirements

Hard real-time constraints — motor commutation at 20 kHz, ADC sampling at precise intervals, bit-banged protocols — strongly favor MCUs. Bare-metal or RTOS firmware on a Cortex-M can guarantee microsecond-level timing. Linux on an MPU provides millisecond-level scheduling at best, and worst-case latency is unpredictable without an RT-PREEMPT kernel. A servo loop that needs 50-microsecond determinism simply cannot run on a general-purpose Linux scheduler.

## Boot Time and Power

An STM32L4 in stop mode draws under 1 uA and wakes to full execution in 5 us. A Linux-based MPU needs 3-15 seconds to boot (kernel, init, userspace) and typically idles at 200-500 mA. For battery-powered sensor nodes that wake, sample, transmit, and sleep in under 100 ms total, an MCU is the only viable option. An MPU makes sense when the application needs a filesystem, a network stack, a display compositor, or complex user-space software that would take months to rewrite for bare metal.

## Hybrid Devices

Several devices intentionally straddle the MCU/MPU boundary:

- **STM32MP1** — Pairs a Cortex-A7 (running Linux) with a Cortex-M4 (running bare-metal or RTOS) on the same die. The A7 handles networking, UI, and filesystem operations while the M4 handles real-time motor control or sensor sampling. Inter-processor communication uses shared SRAM and hardware mailboxes (IPCC). This architecture eliminates the need for two separate boards but requires maintaining two distinct firmware images.
- **i.MX RT series** — Cortex-M7 cores running at 500–600 MHz with external SDRAM support. These parts offer MCU-class real-time behavior (no MMU, deterministic interrupt handling) with MPU-class memory capacity. The i.MX RT1170 adds a Cortex-M4 secondary core. The tradeoff is that the external SDRAM bus adds BOM complexity and layout sensitivity that a traditional MCU avoids.
- **ESP32-S3** — Dual Xtensa LX7 cores with optional 2–8 MB of PSRAM. While architecturally an MCU (no MMU, runs FreeRTOS), the available memory and built-in AI acceleration instructions push it into territory traditionally occupied by MPUs for edge ML inference and camera-based applications.

## Project Examples: MCU vs MPU Selection

Certain project types map clearly to one category:

- **Motor controller (FOC at 20 kHz)** — MCU. Hard real-time current-loop closure at 50 us intervals requires deterministic interrupt latency. A Cortex-M4F with hardware FPU (STM32G4, for example) is the standard choice.
- **Camera-based object detection** — MPU. Processing 640x480 frames with a neural network inference engine demands tens of megabytes of RAM and benefits from Linux-hosted OpenCV or TensorFlow Lite.
- **Battery-powered environmental sensor** — MCU. Wake, sample, transmit over BLE, sleep — total active time under 50 ms. Sub-uA sleep current is essential for multi-year battery life.
- **Touchscreen HMI with network connectivity** — MPU. A display compositor, touch driver, HTTP API, and TLS all running simultaneously fits naturally on a Linux platform.
- **USB-to-CAN bridge** — MCU. Simple protocol translation between two interfaces with low latency requirements. A Cortex-M0+ handles this with minimal BOM.

## Software Complexity and Connectivity

When the project requires TLS, an HTTP server, a camera pipeline, or machine-learning inference on large models, the MPU path saves enormous development effort — libraries like OpenCV, TensorFlow Lite, and full POSIX networking are readily available. For projects that need only SPI sensor reads, UART communication, and GPIO toggling, an MCU keeps the BOM simpler and the firmware fully auditable. The ESP32 occupies a middle zone: MCU-class peripherals with a built-in WiFi/BLE stack, running FreeRTOS, suitable for IoT applications that need connectivity without Linux overhead.

## Tips

- Start the decision from the real-time requirement and power budget, not the feature list — these two constraints eliminate one category quickly in most projects.
- Prototype with a dev board from each category (e.g., Nucleo-F446RE and a Pi Zero 2 W) to get a concrete feel for boot time, debugging workflow, and power draw before committing.
- Consider hybrid architectures — pairing an MCU for real-time I/O with an MPU for networking and UI is common in industrial designs and avoids forcing one processor to do everything.
- Check whether the required connectivity (WiFi, BLE, Ethernet) is available as an MCU peripheral or requires an external module, since this significantly affects BOM cost and board area.
- Evaluate the firmware update story early — OTA updates on an MCU require a bootloader and flash partitioning, while Linux-based systems have mature update frameworks (swupdate, RAUC).
- For projects with both real-time I/O and complex networking, evaluate hybrid SoCs (STM32MP1, i.MX 8M) before committing to a two-chip architecture — a single hybrid part can reduce board complexity and inter-processor wiring.
- Map each functional block (sensor acquisition, protocol handling, UI rendering, connectivity) to an MCU or MPU column early in the design — if more than two blocks require MPU capabilities, the decision is usually clear.

## Caveats

- **Cost comparisons must include the full BOM** — An MCU at $4 on a 2-layer PCB with a few passives often costs less total than a $5 MPU SoM that requires DDR layout on a 6-layer board, a PMIC, eMMC, and connectors.
- **"Just use a Pi" is not always simpler** — Linux introduces kernel configuration, driver compatibility, filesystem corruption on power loss, and boot-time management that bare-metal MCU firmware avoids entirely.
- **Crossover parts blur the categories** — Devices like the i.MX RT series or the STM32MP1 (Cortex-A7 + Cortex-M4) combine traits of both; these require understanding both worlds, not less expertise.
- **Low power on an MPU is not just a software problem** — Even with aggressive suspend states, a Linux MPU typically cannot match the sub-microamp sleep currents of a Cortex-M0+ in shutdown mode.
- **Real-time on Linux exists but has limits** — PREEMPT_RT can bring worst-case latency under 100 us on a tuned system, but that still exceeds what bare-metal Cortex-M achieves by orders of magnitude.
- **An RTOS on an MCU is not the same as Linux** — FreeRTOS or Zephyr provide task scheduling, but not virtual memory, process isolation, or a POSIX API — the programming model is fundamentally different.

## In Practice

- A sensor node that fails to last a week on battery despite sleeping most of the time likely chose an MPU where an MCU with deep sleep would have extended battery life to months.
- A project that starts on an MCU but accumulates a TLS stack, a JSON parser, a filesystem, and an HTTP client is recreating an OS badly — migrating to an MPU often reduces total development time.
- A motor controller with occasional jitter or missed commutation steps on a Linux MPU is hitting scheduler latency — this workload belongs on a dedicated MCU or a real-time co-processor.
- A prototype that boots in 12 seconds before responding to input is running Linux where an MCU-based design would be responsive in under 10 ms.
- An IoT device that works on the bench but brown-outs in the field likely has an MPU drawing too much current for the available power source.
- A hybrid design using STM32MP1 with the M4 core handling real-time sensor acquisition and the A7 core running Linux for cloud connectivity demonstrates the value of the dual-architecture approach — each core operates in its optimal domain without compromise.
