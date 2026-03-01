---
title: "MCU & MPU Systems"
type: docs
---

<div class="landing-hero">
# MCU & MPU Systems
</div>

Microcontrollers and embedded Linux systems sit at the center of modern hardware projects — from LED installations and audio pipelines to SDR nodes and networked gateways. This site is a practical guide to designing and building those systems reliably. It focuses on real-world integration: power architecture, signal integrity, peripheral wiring, firmware structure, and deployment patterns. The aim is to move beyond projects that merely function on a breadboard, toward systems designed and built to last over time, under load, and in real operating environments.

## How It's Organized

The sections progress from core embedded fundamentals through peripheral interfaces, specific application domains, and finally production and deployment concerns.

<div class="section-cards">

<div class="section-card">

### [Foundations for Building Embedded Systems]({{< relref "/docs/foundations" >}})

Processor selection, power architecture, clock trees, memory layout, toolchains, debugging, and board bring-up — the core decisions and skills needed before writing application-level firmware.

</div>

<div class="section-card">

### [Digital Interfaces & Peripheral Patterns]({{< relref "/docs/digital-interfaces" >}})

GPIO, I2C, SPI, UART, CAN, timers, interrupts, and DMA — firmware-side implementation of digital interfaces with HAL configuration, interrupt integration, and production robustness patterns.

</div>

<div class="section-card">

### [LED Systems]({{< relref "/docs/led-systems" >}})

Addressable strip protocols, power injection at scale, color management, driver ICs, animation and rendering patterns, and signal integrity for installations beyond a single-LED demo.

</div>

<div class="section-card">

### [Sensor Integration Patterns]({{< relref "/docs/sensor-integration" >}})

Analog front-end design, environmental and inertial sensors, position and ranging, audio capture, optical sensing, sensor fusion and filtering, and RF peripheral integration.

</div>

<div class="section-card">

### [Screens & Displays]({{< relref "/docs/screens-displays" >}})

Character LCDs, monochrome OLEDs, color TFTs, and E-Ink panels — display technology selection, graphics libraries, font rendering, and UI layout patterns for constrained hardware.

</div>

<div class="section-card">

### [Power & Battery Patterns]({{< relref "/docs/power-battery" >}})

Li-ion integration, low-power design, converter topologies, current measurement, protection circuits, USB Power Delivery, and energy harvesting for battery-powered embedded systems.

</div>

<div class="section-card">

### [Networking & Connectivity]({{< relref "/docs/networking" >}})

Wired and wireless connectivity for embedded systems — Ethernet, Wi-Fi, BLE, LoRa, MQTT, and the protocol stacks that connect devices to networks and cloud services.

</div>

<div class="section-card">

### [Linux-Based Embedded Systems]({{< relref "/docs/linux-embedded" >}})

Single-board computers, embedded Linux distributions, device trees, kernel configuration, and the firmware patterns that differ when a full OS sits between the application and the hardware.

</div>

<div class="section-card">

### [Audio Projects]({{< relref "/docs/audio-projects" >}})

Audio DACs, amplifier circuits, I2S and PDM interfaces, DSP pipelines, and the analog and digital signal chains involved in embedded audio playback and processing.

</div>

<div class="section-card">

### [Productionizing Projects]({{< relref "/docs/productionizing" >}})

OTA updates, configuration management, enclosure design, thermal management, regulatory compliance, and the engineering required to move from prototype to deployed product.

</div>

<div class="section-card">

### [Complete Project Walkthroughs]({{< relref "/docs/project-walkthroughs" >}})

End-to-end builds that integrate multiple sections — from requirements and hardware selection through firmware, testing, and deployment of complete embedded systems.

</div>

</div>
