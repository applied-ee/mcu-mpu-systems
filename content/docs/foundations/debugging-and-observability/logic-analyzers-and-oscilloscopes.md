---
title: "Logic Analyzers & Oscilloscopes at the Bench"
weight: 30
---

# Logic Analyzers & Oscilloscopes at the Bench

Software debugging reveals what firmware thinks is happening. Logic analyzers and oscilloscopes reveal what is actually happening on the wire. Protocol mismatches, signal integrity failures, and power delivery problems are invisible to software tools but immediately apparent with the right instrument and trigger configuration.

## Logic Analyzers for Protocol Decoding

A logic analyzer captures digital signals and decodes them into human-readable protocol transactions. The Saleae Logic Pro 8 (8 channels, 500 MS/s digital, $480) and Logic 8 (8 channels, 100 MS/s, $200) are the most common bench tools for embedded work. Budget alternatives using Cypress FX2-based clones ($10-15) work with the open-source sigrok/PulseView software at sample rates up to 24 MHz. For SPI decoding, sample at least 4x the clock rate — a 10 MHz SPI bus needs 40 MS/s or higher. I2C, running at 100-400 kHz, is comfortably captured at 1-2 MS/s. Protocol decoders overlay the raw waveform with decoded bytes, addresses, and ACK/NACK status, making it straightforward to confirm whether the MCU is sending what the firmware intends.

A typical SPI decode setup requires connecting four logic analyzer channels: MOSI, MISO, SCK, and CS. In the decoder configuration, the clock polarity (CPOL) and clock phase (CPHA) must match the peripheral's SPI mode — Mode 0 (CPOL=0, CPHA=0) samples on the rising edge with clock idle low, while Mode 3 (CPOL=1, CPHA=1) samples on the falling edge with clock idle high. Setting these incorrectly produces decoded bytes that are bit-shifted or completely wrong, even though the raw waveform looks correct. Assigning CS as the frame enable signal allows the decoder to delineate individual transactions and ignore bus activity between assertions.

## Oscilloscopes for Signal Quality

Where logic analyzers see only high/low states, oscilloscopes show the analog reality: rise times, overshoot, ringing, and noise. A 100 MHz bandwidth scope covers most embedded work up to 50 MHz signal frequencies (the Nyquist rule applies to scope bandwidth as well). Probe compensation matters — an uncompensated 10x probe introduces measurement error that looks like signal distortion. For I2C and SPI signals, the oscilloscope reveals whether signal edges are clean, whether pull-up resistor values produce adequate rise times (I2C spec requires <300 ns rise time at 400 kHz), and whether bus capacitance is within limits.

**Probe compensation** is performed using the 1 kHz square wave test point present on every oscilloscope's front panel. Connecting a 10x probe to this test point and observing the waveform reveals compensation state: an overcompensated probe shows overshoot on edges, an undercompensated probe shows rounded corners, and a correctly compensated probe shows clean square edges. The trimmer capacitor on the probe body (or at the BNC connector) is adjusted with a non-metallic tool until the waveform is square. This calibration should be repeated whenever a probe is moved between scope channels or when the ambient temperature changes significantly.

**Bandwidth and rise time** are related by the approximation BW x t_rise = 0.35, which holds for a single-pole response characteristic of most analog oscilloscope front ends. A 100 MHz scope can faithfully measure rise times down to approximately 3.5 ns. Faster edges appear slower than they actually are — the scope's own response time dominates the measurement. Choosing scope bandwidth based on signal edge rates rather than signal frequency ensures accurate waveform capture: a 10 MHz SPI clock with 2 ns edges requires at least 175 MHz of bandwidth to measure the edge shape accurately.

## Power Rail Analysis

Switching regulators produce ripple and transient noise that a multimeter cannot capture. A scope with AC coupling and 20 MHz bandwidth limiting shows regulator output ripple directly — typical switching regulators produce 10-50 mV ripple, but layout issues or inadequate decoupling can push this to 200+ mV. Load transients during WiFi TX bursts (e.g., ESP32 drawing 300-400 mA peaks) cause voltage sags visible on the scope. A 10 uF ceramic plus 100 nF close to the MCU's VDD pins should keep transients under 100 mV. Measuring at the MCU pin rather than at the regulator output reveals the true supply quality the silicon experiences.

## Trigger Modes for Intermittent Events

Single-shot trigger mode captures a one-time event — essential for debugging startup sequences, watchdog resets, or rare fault conditions. Edge triggering on a GPIO debug pin (toggled in firmware at a specific code point) synchronizes the scope capture to a software event. Pulse-width triggering catches glitches: set the trigger to fire on pulses shorter than the minimum expected signal width (e.g., <50 ns on a 1 MHz SPI clock). Serial protocol triggering (available on mid-range scopes) fires on specific I2C addresses or SPI byte values, eliminating manual waveform searching.

## Tips

- Dedicate a spare GPIO as a debug toggle — driving it high at ISR entry and low at exit gives a direct oscilloscope measurement of interrupt latency and execution time.
- Use the oscilloscope's math channel (CH1 minus CH2) to measure differential signals or isolate noise on a power rail relative to ground.
- Save logic analyzer captures to session files before changing probe connections — having a known-good reference capture makes future comparison debugging much faster.
- Set the logic analyzer's voltage threshold to match the target logic family — 1.4 V for 3.3 V LVCMOS, 0.8 V for 1.8 V logic — to avoid missed edges or false triggers.
- Attach scope ground leads as short as physically possible; the standard 15 cm ground clip acts as an antenna and introduces ringing artifacts that can be mistaken for real signal problems.
- Run probe compensation before every measurement session — even moving a probe from CH1 to CH2 on the same scope can change the compensation due to different input capacitances.
- When decoding a protocol, verify the decoder settings against the peripheral datasheet — the most common source of "wrong data" in captures is a CPOL/CPHA or bit-order mismatch in the analyzer configuration, not a hardware problem.

## Caveats

- **Budget logic analyzer clones often lack analog sampling** — They capture digital thresholds only, making them useless for diagnosing signal integrity issues like slow rise times or voltage level violations.
- **Oscilloscope bandwidth rated at -3 dB means 30% amplitude error at the rated frequency** — A 100 MHz scope measuring a 100 MHz signal shows it at 70% of true amplitude; always use a scope rated at 3-5x the signal frequency for accurate measurements.
- **Long ground leads on oscilloscope probes introduce inductance** — The resulting LC resonance creates ringing artifacts on fast edges that appear to be real signal problems; use the spring-tip ground contact for anything above 10 MHz.
- **Logic analyzers with insufficient sample rate alias fast signals** — A 24 MS/s analyzer capturing a 10 MHz SPI clock will show a distorted waveform and may decode data incorrectly.
- **AC-coupled scope inputs block DC information** — Power rail analysis with AC coupling shows ripple accurately but hides the actual voltage level; verify the DC level separately with DC coupling or a multimeter.
- **An uncompensated probe distorts every measurement** — The distortion looks like real signal behavior (overshoot or slow rise), leading to incorrect conclusions about signal integrity. Always compensate before diagnosing edge quality.

## In Practice

- An I2C bus that works at 100 kHz but fails at 400 kHz, with no firmware changes, almost always indicates excessive bus capacitance or pull-up resistor values too high for the faster rise time requirement — visible on the scope as rounded edges that do not reach valid logic levels within spec.
- SPI data that decodes correctly on the logic analyzer but produces wrong values in firmware suggests a clock polarity (CPOL) or phase (CPHA) mismatch — the analyzer is decoding with different settings than the slave device expects.
- A power rail that measures a clean 3.3 V on a multimeter but causes intermittent MCU resets reveals itself on the scope as 300+ mV transient dips during high-current events like radio transmission or motor actuation.
- A UART signal that appears correct on the scope but produces framing errors on the receiver indicates a baud rate tolerance issue — crystal-less MCU oscillators (internal RC) can drift 2-5%, enough to corrupt bytes at 115200 baud and above.
- Intermittent signal glitches visible only with single-shot triggering and persistence mode often trace back to floating inputs, missing pull-up/pull-down resistors, or inadequate decoupling on nearby switching regulators.
- Measuring a rise time of 4 ns on a 100 MHz scope actually means the real rise time is faster — the scope's 3.5 ns response is dominating. The true rise time can be estimated as sqrt(t_measured^2 - t_scope^2), giving approximately 1.9 ns in this case.
