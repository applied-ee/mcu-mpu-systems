---
title: "I2S Audio Pipelines"
weight: 10
bookCollapseSection: true
---

# I2S Audio Pipelines

An I2S peripheral moves audio samples between an MCU and external devices — codec ICs, DAC modules, digital microphones, or other processors. The protocol itself is straightforward (clock, word-select, data), but building a reliable audio pipeline around it requires solving several interrelated problems: sizing DMA buffers to balance latency against underrun risk, configuring external codec ICs over I2C, routing multiple channels through TDM slots, and resampling when source and sink clocks do not share a common base.

These pages focus on the system-level engineering of I2S audio paths. Protocol-level I2S and PDM fundamentals — signal timing, frame formats, and peripheral initialization — are covered in [PDM & I2S Audio Interfaces]({{< relref "/docs/sensor-integration/audio-and-acoustic/pdm-and-i2s-audio-interfaces" >}}).

## Pages

- **[I2S DMA Buffer Management]({{< relref "i2s-dma-buffer-management" >}})** — Double/triple buffering strategies, buffer sizing for latency and headroom, alignment requirements on Cortex-M, and cache coherency on M7/A-class cores.

- **[Audio Codec Integration]({{< relref "audio-codec-integration" >}})** — External codec ICs (WM8960, SGTL5000, ES8388): I2S data + I2C control configuration, MCLK generation, PLL setup, and power-up sequencing.

- **[TDM & Multi-Channel Audio]({{< relref "tdm-multichannel-audio" >}})** — TDM mode on I2S peripherals, slot addressing, microphone arrays, per-slot DMA routing on ESP32 and STM32 SAI.

- **[Sample Rate Conversion]({{< relref "sample-rate-conversion" >}})** — ASRC for mismatched clocks, integer-ratio resampling, polyphase filters, and quality/CPU trade-offs on constrained hardware.

- **[S/PDIF Digital Audio]({{< relref "spdif-digital-audio" >}})** — S/PDIF receive and transmit on MCUs: hardware peripheral support (STM32 SAI, NXP SPDIF), software implementations (ESP32 RMT/I2S), external transceiver ICs, and TOSLINK vs coaxial physical layers.
