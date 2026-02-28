---
title: "MCU vs MPU — When to Use Which"
weight: 10
---

# MCU vs MPU — When to Use Which

The split between microcontrollers and microprocessors is the first fork in any embedded design. An MCU like the STM32F405 integrates 1 MB of flash, 192 KB of SRAM, and dozens of peripherals onto a single chip — power on and code executes in microseconds. An MPU like the Raspberry Pi CM4 (BCM2711, quad-core Cortex-A72) needs external DDR, an SD card or eMMC for storage, and boots a full Linux kernel in seconds. These are fundamentally different computing models, and picking the wrong one either over-constrains the software or over-complicates the hardware.

## Defining the Boundary

An MCU runs code directly from internal flash with no operating system required. Execution is deterministic — interrupt latency on a Cortex-M4 at 168 MHz is typically 12 cycles (~72 ns). An MPU relies on external DRAM, an MMU for virtual memory, and usually a full OS. The STM32H7 at 480 MHz with 1 MB of internal RAM sits at the upper edge of MCU territory, while the i.MX RT1060 (Cortex-M7, 600 MHz, external RAM) blurs the line — it has MCU-class peripherals but MPU-class memory requirements.

## Real-Time Requirements

Hard real-time constraints — motor commutation at 20 kHz, ADC sampling at precise intervals, bit-banged protocols — strongly favor MCUs. Bare-metal or RTOS firmware on a Cortex-M can guarantee microsecond-level timing. Linux on an MPU provides millisecond-level scheduling at best, and worst-case latency is unpredictable without an RT-PREEMPT kernel. A servo loop that needs 50-microsecond determinism simply cannot run on a general-purpose Linux scheduler.

## Boot Time and Power

An STM32L4 in stop mode draws under 1 uA and wakes to full execution in 5 us. A Linux-based MPU needs 3-15 seconds to boot (kernel, init, userspace) and typically idles at 200-500 mA. For battery-powered sensor nodes that wake, sample, transmit, and sleep in under 100 ms total, an MCU is the only viable option. An MPU makes sense when the application needs a filesystem, a network stack, a display compositor, or complex user-space software that would take months to rewrite for bare metal.

## Software Complexity and Connectivity

When the project requires TLS, an HTTP server, a camera pipeline, or machine-learning inference on large models, the MPU path saves enormous development effort — libraries like OpenCV, TensorFlow Lite, and full POSIX networking are readily available. For projects that need only SPI sensor reads, UART communication, and GPIO toggling, an MCU keeps the BOM simpler and the firmware fully auditable. The ESP32 occupies a middle zone: MCU-class peripherals with a built-in WiFi/BLE stack, running FreeRTOS, suitable for IoT applications that need connectivity without Linux overhead.

## Tips

- Start the decision from the real-time requirement and power budget, not the feature list — these two constraints eliminate one category quickly in most projects.
- Prototype with a dev board from each category (e.g., Nucleo-F446RE and a Pi Zero 2 W) to get a concrete feel for boot time, debugging workflow, and power draw before committing.
- Consider hybrid architectures — pairing an MCU for real-time I/O with an MPU for networking and UI is common in industrial designs and avoids forcing one processor to do everything.
- Check whether the required connectivity (WiFi, BLE, Ethernet) is available as an MCU peripheral or requires an external module, since this significantly affects BOM cost and board area.
- Evaluate the firmware update story early — OTA updates on an MCU require a bootloader and flash partitioning, while Linux-based systems have mature update frameworks (swupdate, RAUC).

## Caveats

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
