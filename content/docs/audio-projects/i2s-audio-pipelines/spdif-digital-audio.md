---
title: "S/PDIF Digital Audio"
weight: 50
---

# S/PDIF Digital Audio

S/PDIF (Sony/Philips Digital Interface) carries stereo PCM audio over a single unidirectional connection — either a coaxial cable or a TOSLINK optical fiber. Unlike I2S, which uses separate clock and data lines, S/PDIF embeds the clock in the data stream using biphase mark coding. This self-clocking property means only one signal wire is needed, but it also means the receiver must recover the clock from the incoming bitstream, introducing jitter sensitivity that does not exist in I2S links.

S/PDIF is defined as a unidirectional, point-to-point serial link. In practice, the continuous self-clocking bitstream can be buffered or optically split to feed multiple receivers, but the protocol itself assumes one transmitter driving one receiver.

On MCUs and MPUs, S/PDIF appears in three forms: dedicated hardware peripherals (STM32 SAI SPDIF mode, NXP i.MX RT SPDIF transceiver), software implementations using repurposed peripherals (ESP32 I2S for TX, ESP32 RMT for RX), and external transceiver ICs that bridge between S/PDIF and I2S. The choice depends on whether the application needs receive, transmit, or both — and whether the target MCU has a peripheral that can handle the timing requirements.

## Protocol Fundamentals

S/PDIF follows the IEC 60958 standard. Audio data is transmitted as a continuous stream of **frames**, each containing two **subframes** (left and right channels). Each subframe carries:

- **4-bit preamble** — identifies the subframe type (B = start of block, M = left/channel 1, W = right/channel 2)
- **24-bit audio sample** — MSB-justified, zero-padded if the source is 16-bit or 20-bit
- **4 status/flag bits** — validity (V), user data (U), channel status (C), and parity (P)

A block consists of 192 consecutive frames. The channel status bits across one complete block form a 192-bit structure that describes the audio format: sample rate, bit depth, emphasis, copy protection, and whether the content is PCM or non-audio (compressed AC-3/DTS).

### Biphase Mark Coding

Every bit in the S/PDIF stream is encoded using biphase mark coding (BMC): a transition always occurs at the start of each bit period, and a logic '1' adds a second transition at the midpoint. This guarantees at least one edge per bit, making the signal self-clocking and DC-balanced. For 48 kHz stereo audio, the base bit rate is 3.072 Mbps, with transitions occurring at up to 6.144 MHz.

The preambles violate the BMC encoding rules intentionally — they contain patterns that cannot appear in normal data, making them unambiguously detectable by the receiver for frame synchronization.

## Hardware Peripheral Support

### STM32 SAI — SPDIF Protocol Mode

The STM32 Serial Audio Interface (SAI) on F4, F7, and H7 families includes a dedicated SPDIF protocol mode. In this mode, the SAI block handles biphase mark encoding/decoding, preamble generation/detection, and channel status bit management in hardware. Configuration through STM32 HAL:

```c
/* STM32 SAI — S/PDIF transmit configuration */
hsai.Instance                 = SAI1_Block_A;
hsai.Init.Protocol            = SAI_SPDIF_PROTOCOL;
hsai.Init.AudioMode           = SAI_MODEMASTER_TX;
hsai.Init.Synchro             = SAI_ASYNCHRONOUS;
hsai.Init.DataSize            = SAI_DATASIZE_24;
hsai.Init.FirstBit            = SAI_FIRSTBIT_MSB;
hsai.Init.ClockStrobing       = SAI_CLOCKSTROBING_FALLINGEDGE;
hsai.Init.AudioFrequency      = SAI_AUDIO_FREQUENCY_48K;

HAL_SAI_Init(&hsai);

/* Channel status register — PCM audio, 48 kHz, no emphasis */
HAL_SAI_ConfigChannelStatus(&hsai, channelstatus);
```

The SAI SPDIF mode requires the SAI PLL (PLLSAI1) to generate an accurate bit clock. The PLL must produce exactly 128× the sample rate for the S/PDIF encoder to generate correct timing. With a 48 kHz target, the required SAI clock is 6.144 MHz.

### NXP i.MX RT — Dedicated SPDIF Peripheral

The i.MX RT series (RT1010 and above) includes a standalone SPDIF transceiver peripheral with separate TX and RX blocks. The receiver performs clock recovery in hardware using a DPLL (Digital Phase-Locked Loop) that locks to the incoming biphase mark transitions. The NXP MCUXpresso SDK provides complete driver examples:

```c
/* NXP i.MX RT — SPDIF receiver setup */
spdif_config_t config;
SPDIF_GetDefaultConfig(&config);
config.gainSel = kSPDIF_GAIN_24;       /* DPLL gain for clock recovery */
config.dPhaseConfig = kSPDIF_SampleOnFallingEdge;
SPDIF_Init(SPDIF, &config);

/* Read received audio + channel status */
SPDIF_ReceiveData(SPDIF, &left, &right);
uint32_t status = SPDIF_GetChannelStatus(SPDIF);
```

The i.MX RT SPDIF peripheral reports lock status and can generate interrupts on lock loss, sample rate change, or channel status updates — functionality that software implementations must handle manually.

## Software Implementations

When no dedicated S/PDIF peripheral is available, existing peripherals can be repurposed to handle the encoding or decoding.

### ESP32 I2S — S/PDIF Transmit

The ESP32 I2S peripheral, configured in LCD mode with a carefully chosen bit clock, can output a pre-encoded S/PDIF bitstream. The firmware encodes each PCM sample into biphase mark coded subframes in software, then writes the encoded bitstream to the I2S DMA buffer as if it were raw audio data. The I2S peripheral shifts out the bits at the correct rate.

The `arduino-audio-tools` library implements this as `AudioOutputSPDIF`, which handles BMC encoding, preamble insertion, and channel status generation. The I2S clock is set to produce the required 6.144 MHz bit rate for 48 kHz output (or 5.6448 MHz for 44.1 kHz).

### ESP32 RMT — S/PDIF Receive

The ESP32 RMT (Remote Control Transceiver) peripheral, designed for IR remote protocols, can capture S/PDIF input by measuring the time between transitions. The RMT hardware timestamps each edge, and firmware decodes the biphase mark encoding by classifying inter-edge intervals as half-bit or full-bit periods. Clock recovery happens implicitly — the transition timing reveals both the data and the bit rate.

This approach works because RMT captures edges with 12.5 ns resolution (80 MHz APB clock), which is sufficient for the ~162 ns minimum transition period at 48 kHz. The decoding runs in an ISR or task that processes the RMT capture buffer.

### STM32 Timer + SPI — Software Decode

A timer peripheral captures S/PDIF transitions (input capture mode), and firmware reconstructs the bitstream by classifying the intervals between edges. Alternatively, an SPI peripheral in slave mode, clocked at a multiple of the S/PDIF bit rate, can sample the incoming signal and decode the biphase mark pattern from the captured bit sequence. Both approaches are CPU-intensive and typically limited to lower sample rates or cores with sufficient headroom.

## External Transceiver ICs

External S/PDIF transceiver ICs handle the biphase mark encoding/decoding in dedicated hardware and present a standard I2S interface to the MCU. This follows the same integration pattern as audio codec ICs — I2S for audio data, I2C for control.

| IC | Function | I2S Output | Sample Rates | Control | Typical Use |
|---|---|---|---|---|---|
| WM8804 | TX + RX | Up to 24-bit/192 kHz | 32–192 kHz | I2C (0x3A/0x3B) | Raspberry Pi HATs, hi-fi DAC boards |
| DIR9001 | RX only | Up to 24-bit/96 kHz | 32–96 kHz | Hardware pins (no I2C) | Low-cost S/PDIF input, minimal config |
| CS8416 | RX (8-input mux) | Up to 24-bit/192 kHz | 32–192 kHz | I2C or SPI | Multi-source selectors, pro audio |

The WM8804 is the most common choice for bidirectional S/PDIF on embedded boards. It includes a PLL that recovers the clock from the S/PDIF input and generates I2S clocks, making it functionally equivalent to having a dedicated S/PDIF peripheral. The DIR9001 is a simpler receive-only part that requires no software configuration — sample rate, format, and error status are reported through output pins rather than registers.

## Optical (TOSLINK) vs Coaxial

S/PDIF defines two physical layers for the same logical protocol:

**Coaxial** — 75 Ω unbalanced, 0.5 Vpp signal on an RCA connector. The electrical interface is straightforward: a 75 Ω series resistor on the transmitter output and proper impedance-matched trace routing. Maximum cable length is roughly 10 meters for reliable operation, though shorter runs are more forgiving of impedance mismatches.

**Optical (TOSLINK)** — 650 nm red LED or laser, modulated with the biphase mark coded signal. TOSLINK modules (Toshiba TOTX and TORX series, or compatible parts) convert between the TTL-level electrical signal and the optical fiber. The transmitter module accepts a 3.3 V or 5 V logic-level input; the receiver module outputs a TTL-level signal.

The key practical difference: **TOSLINK provides complete galvanic isolation** between source and sink. In embedded systems where the audio source and destination may have different ground references — or where motor drivers, switching converters, or RF circuits share the same board — optical isolation eliminates ground loop hum and conducted noise without additional isolation components.

TOSLINK modules connect directly to MCU GPIO pins (through a suitable buffer if the module requires 5 V logic). The interface is purely electrical from the MCU's perspective — the optical conversion is handled entirely within the module.

## Tips

- Start with an external transceiver IC (WM8804 or DIR9001) rather than a software implementation when adding S/PDIF to an existing I2S pipeline — the transceiver presents a standard I2S interface, so the existing DMA and buffer management code does not need to change.
- For TOSLINK, verify the module's logic level requirements before connecting to a 3.3 V MCU. Some TOTX/TORX modules require 5 V TTL input; a simple level shifter or open-drain buffer resolves this.
- When using the STM32 SAI SPDIF mode, configure the PLLSAI1 before enabling the SAI block. The PLL lock time is typically a few milliseconds — enabling the SAI before the PLL is stable produces garbage output.
- For ESP32 I2S-based S/PDIF transmit, the `arduino-audio-tools` library is the most tested path. Manual BMC encoding is straightforward in principle but getting the I2S clock dividers to produce the exact bit rate requires careful PLL/APLL configuration.
- Channel status bits matter for consumer equipment. A receiver that sees the "non-audio" flag set in the channel status block will mute PCM audio. Setting the correct sample rate in the channel status also allows the receiver to configure its own PLL appropriately.

## Caveats

- S/PDIF is **unidirectional** — a single link carries audio in one direction only. Bidirectional audio requires two separate S/PDIF connections. This is fundamentally different from I2S, which can carry data in both directions on separate pins within the same clock domain.
- Clock accuracy requirements are tight. The IEC 60958 standard specifies ±50 ppm for consumer S/PDIF. Exceeding this causes the receiver's PLL to lose lock or produce audible artifacts. MCU-generated clocks from non-audio crystals (8 MHz, 25 MHz) may not achieve this accuracy after PLL synthesis.
- Software S/PDIF receive implementations (RMT, timer capture) are sensitive to interrupt latency. If ISR response time varies by more than a few hundred nanoseconds, the decoder misclassifies transitions and produces corrupted samples. Real-time OS tasks with higher priority, or other interrupts that disable the S/PDIF ISR, can cause intermittent decode errors.
- Consumer S/PDIF receivers may ignore or misinterpret channel status bits from MCU-generated streams. If the channel status block is not populated correctly (especially the "original/copy" and "category code" fields), some receivers apply unexpected processing or refuse to lock.
- The 24-bit audio field in each subframe is fixed — there is no negotiation mechanism. If the source sends 16-bit audio zero-padded to 24 bits, the receiver has no reliable way to determine the actual bit depth from the S/PDIF stream alone.

## In Practice

- **Silence from a connected S/PDIF receiver** — commonly appears when the transmitter's bit rate is outside the receiver's lock range. A clock error of more than ±500 ppm often prevents lock entirely. This also occurs when the biphase mark encoding has timing errors that prevent preamble detection. Checking the transmitter output with an oscilloscope reveals whether the signal has the expected ~3 MHz transition pattern for 48 kHz audio.
- **Intermittent clicks or dropouts in received audio** — often traced to jitter on the S/PDIF signal. Software transmit implementations that share CPU time with other tasks produce variable transition timing, which the receiver's PLL tracks imperfectly. The symptom worsens under heavy CPU load. Moving the BMC encoding to a higher-priority task or using DMA-driven output reduces the effect.
- **Audio plays at the wrong speed** — indicates a sample rate mismatch between what the S/PDIF stream actually carries and what the receiver's local clock expects. This happens when the channel status bits report one sample rate but the actual bit rate corresponds to a different one, or when the receiver ignores channel status and assumes a default rate.
- **Hum or buzz on coaxial S/PDIF but not optical** — a ground loop between source and receiver. The coaxial connection creates a galvanic path between the two devices' grounds. Switching to TOSLINK eliminates the ground loop. If coaxial is required, an isolation transformer (1:1, wideband RF type) on the S/PDIF coaxial line breaks the ground path.
- **Receiver reports "no signal" despite waveform present on the wire** — the signal amplitude may be out of spec. Consumer S/PDIF expects 0.5 Vpp into 75 Ω. MCU GPIO outputs at 3.3 V are far above this level and can overdrive the receiver input. A resistive voltage divider (680 Ω series, 75 Ω to ground) attenuates the output to the correct level.
