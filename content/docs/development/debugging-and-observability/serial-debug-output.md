---
title: "Serial Debug Output — UART, SWO & RTT"
weight: 20
---

# Serial Debug Output — UART, SWO & RTT

Getting runtime information out of a microcontroller is fundamental to firmware development. Three approaches dominate: UART-based printf, ARM's SWO trace output, and SEGGER's RTT memory-based transfer. Each trades off pin usage, throughput, timing distortion, and toolchain dependency differently. Understanding these tradeoffs determines whether debug output is helpful or actively misleading.

## UART Debug Output

The most common debug channel uses a UART peripheral retargeted to `printf()` via a syscall stub (e.g., `_write()` on GCC/Newlib or `fputc()` on Keil). Typical baud rates range from 115200 to 921600. At 115200 baud, a 64-byte message takes roughly 5.5 ms to transmit — long enough to distort millisecond-scale timing. A USB-to-serial adapter (CP2102, CH340, FTDI FT232) bridges the UART to the host. DMA-backed UART transmission reduces CPU blocking: the firmware queues a buffer and returns immediately, but the output still occupies the wire at baud-rate speed. UART debug requires two dedicated pins (TX/RX) and is available on virtually every MCU.

A minimal printf retarget on GCC/Newlib overrides the `_write` syscall to send each character to a UART peripheral:

```c
int _write(int fd, char *ptr, int len) {
    for (int i = 0; i < len; i++) {
        while (!(USART2->SR & USART_SR_TXE));
        USART2->DR = ptr[i];
    }
    return len;
}
```

This blocking implementation waits for the transmit data register to empty before writing each byte. On Keil/ARMCC, the equivalent hook is `fputc()`. On STM32 HAL projects, the retarget often wraps `HAL_UART_Transmit()` instead of direct register access.

## SWO — Serial Wire Output

SWO transmits debug data over a single dedicated pin on the SWD connector, using the ARM ITM (Instrumentation Trace Macrocell). Data is encoded as ITM stimulus port packets — port 0 is conventionally used for printf-style output. SWO runs asynchronously at speeds up to 2 Mbps on most probes (J-Link supports up to 6 MHz SWO clock). Because transmission is non-blocking from the CPU's perspective, timing distortion is minimal compared to polled UART. SWO output appears in tools like STM32CubeIDE's SWV console, J-Link SWO Viewer, or OpenOCD's `tpiu config`. The limitation is that SWO is output-only and requires a debug probe that supports trace capture.

Setting up ITM output requires enabling the trace subsystem and configuring the stimulus port. The ITM has 32 stimulus ports (0-31), with port 0 as the default printf channel. Firmware writes a character to `ITM->PORT[0].u8` and the ITM packetizes it for transmission over SWO. In OpenOCD, the `tpiu config internal /tmp/swo.log uart off <core_clock> <swo_freq>` command configures the trace capture. In STM32CubeIDE, the SWV trace configuration panel sets the core clock and SWO frequency — the prescaler must divide the core clock to the exact SWO rate or output will be garbled.

## SEGGER RTT — Real-Time Transfer

RTT uses the debug probe's memory access channel to read and write circular buffers in the target's RAM. No additional pins or peripherals are required — data moves through the same SWD/JTAG connection used for debugging. Throughput reaches approximately 1 MB/s on J-Link probes, far exceeding UART or SWO. RTT is bidirectional, supporting both output logging and input commands. The CPU overhead is essentially a `memcpy` into a RAM buffer — on the order of microseconds for typical messages. The tradeoff is a hard dependency on SEGGER's J-Link probe and RTT library (though open-source implementations exist for CMSIS-DAP probes).

RTT initialization places a control block (the `_SEGGER_RTT` structure) in SRAM at a known or discoverable address. The control block contains pointers to circular buffers for each configured channel. The debug probe scans the target's RAM for the control block's magic identifier string (`"SEGGER RTT"`), then reads and writes the buffers directly via SWD background memory access — no CPU intervention is needed on the read side. This mechanism explains why RTT has near-zero timing impact: the firmware only performs a buffer write, and the probe asynchronously drains data without halting the core.

## Timing Distortion Comparison

The timing cost of debug output varies by orders of magnitude across methods. Polled UART at 115200 baud takes approximately 87 microseconds per character (1 start bit + 8 data bits + 1 stop bit at 115200 bits/second). A 40-character log message therefore blocks the CPU for roughly 3.5 ms. RTT, by contrast, copies the same 40 bytes into a RAM buffer in approximately 1-2 microseconds total — a 1000x improvement. SWO falls between the two: the CPU write to the ITM stimulus port completes in a few cycles, but if the SWO output FIFO is full, the write stalls until space is available, introducing variable latency. For timing-sensitive code paths (interrupt handlers, control loops above 1 kHz), RTT is the only method that avoids measurable distortion.

## Comparison

| Feature | UART | SWO | RTT |
|---|---|---|---|
| Pins required | 2 (TX/RX) | 1 (SWO) | 0 (uses SWD) |
| Throughput | ~115 KB/s at 921600 | ~250 KB/s at 2 Mbps | ~1 MB/s |
| Direction | Bidirectional | Output only | Bidirectional |
| Timing impact | High (polled), moderate (DMA) | Low | Very low |
| Probe required | No (USB-serial adapter) | Yes (SWO-capable) | Yes (J-Link or CMSIS-DAP) |
| Works without debugger | Yes | No | No |

## Tips

- Use DMA-backed UART if RTT and SWO are not available — it reduces CPU blocking from milliseconds to microseconds per message, though wire-time latency remains.
- Keep debug messages short and structured (e.g., single-letter tags with hex values) to minimize bandwidth consumption and make log parsing easier.
- Disable or compile out debug output in release builds — even RTT's `memcpy` overhead accumulates in tight loops running at tens of kHz.
- Configure SWO clock to match the probe's expected frequency exactly; a mismatch produces garbled output or silence.
- Use RTT's multiple channels (up to 16 up/down) to separate log severity levels or subsystem output without parsing overhead.
- Wrap debug output behind a compile-time macro (e.g., `#ifdef DEBUG_UART`) so that all debug I/O can be stripped from production builds with a single define change.
- For quick integer logging without pulling in full printf, a custom hex-to-ASCII function outputting 8 characters per 32-bit value avoids Newlib's 20+ KB flash overhead entirely.

## Caveats

- **Printf with polled UART blocks the CPU for the full transmission time** — At 115200 baud, a 100-byte message stalls execution for ~8.7 ms, which can cause missed interrupts, watchdog resets, or completely altered timing behavior.
- **SWO requires correct TPIU and ITM initialization** — Missing or incorrect clock prescaler configuration results in no output at all, with no error indication on the target side.
- **RTT buffer overflows silently by default** — When the target produces data faster than the probe reads it, the oldest data is overwritten unless the blocking or skip mode is explicitly configured.
- **Newlib printf pulls in ~20-30 KB of flash** — On flash-constrained targets (e.g., 32 KB STM32F0), consider lightweight alternatives like `snprintf` into a fixed buffer or custom integer-to-ASCII routines.
- **USB-serial adapters introduce variable latency** — CP2102 and CH340 chips buffer data internally and may add 1-16 ms of jitter to timestamps observed on the host, making them unreliable for sub-millisecond timing analysis.

## In Practice

- Debug output that appears garbled or produces random characters almost always indicates a baud rate mismatch between the MCU's UART configuration and the host terminal.
- SWO output that works intermittently but drops characters under load suggests the SWO clock prescaler is slightly off — recalculating from the core clock and target SWO frequency typically resolves it.
- A firmware build that suddenly exceeds flash capacity after adding debug prints points to Newlib's printf pulling in floating-point support — using `iprintf` or `-u _printf_float` linkage flags controls this.
- RTT output that stops when breakpoints are hit is expected behavior — the probe cannot simultaneously service debug halt and RTT memory reads on most J-Link models.
- A system that behaves correctly with debug prints enabled but fails without them is exhibiting a timing-dependent bug — the debug output is masking a race condition by slowing execution.
