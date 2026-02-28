---
title: "SWD, JTAG & Debug Probes"
weight: 10
---

# SWD, JTAG & Debug Probes

Debug access to a microcontroller requires a physical interface between the host toolchain and the target silicon. The two dominant protocols — SWD and JTAG — differ in pin count, capability, and ecosystem support. Choosing the right debug probe and wiring it correctly determines whether breakpoints, flash programming, and register inspection work reliably or not at all.

## SWD — Serial Wire Debug

SWD is an ARM-specific two-wire protocol using SWDIO (bidirectional data) and SWCLK (clock). It provides full debug access — breakpoints, watchpoints, flash programming, and register read/write — over just two signal lines plus ground. SWD clock speeds typically run at 1-4 MHz for reliable operation, though many probes support up to 10 MHz on short traces. The protocol also carries SWO (Serial Wire Output) on an optional third pin, enabling trace output without additional UART hardware.

## JTAG — Joint Test Action Group

JTAG uses four signal lines: TDI, TDO, TMS, and TCK, plus an optional TRST. Unlike SWD, JTAG supports daisy-chaining multiple devices on a single scan chain, making it essential for boards with multiple ICs requiring boundary scan or debug. JTAG is not ARM-specific — it works with RISC-V, MIPS, FPGA, and CPLD targets. The 20-pin legacy JTAG header remains common on evaluation boards, while the 10-pin Cortex Debug Connector (1.27 mm pitch) is standard for ARM targets supporting both SWD and JTAG.

## Debug Probe Options

The probe market spans from $3 clones to $400+ professional units. ST-Link V2 clones ($3-8) work for STM32 targets and integrate with STM32CubeIDE. The genuine ST-Link V3 ($30) adds multi-voltage support and faster flash programming. SEGGER J-Link EDU ($20) and J-Link BASE ($400) offer broad target support, fast flash download (up to 3 MB/s on J-Link PLUS), and tight IDE integration. CMSIS-DAP and DAPLink probes are open-source designs that work with OpenOCD and pyOCD — many development boards (e.g., micro:bit, LPC-Link2) ship with DAPLink firmware onboard. The Black Magic Probe runs a GDB server directly on the probe, eliminating the need for OpenOCD entirely.

## Connection Requirements and Pinouts

SWD signals benefit from 10k-100k pull-up resistors on SWDIO. Trace lengths should stay under 10 cm for reliable operation above 2 MHz. The 10-pin Cortex Debug Connector maps pin 1 to VTref, pin 2 to SWDIO/TMS, pin 4 to SWCLK/TCK, and pin 6 to SWO. Ground pins occupy positions 3, 5, and 9. OpenOCD configuration files specify the interface (e.g., `interface/stlink.cfg`) and the target (e.g., `target/stm32f4x.cfg`), and a typical launch command looks like `openocd -f interface/stlink.cfg -f target/stm32f4x.cfg`.

## Tips

- Start with the probe that matches the target vendor's ecosystem — ST-Link for STM32, J-Link for Nordic/NXP — to minimize configuration friction.
- Keep SWD/JTAG traces short and away from high-speed switching signals; even 15 cm of unshielded wire can cause intermittent connection drops at 4 MHz.
- Verify VTref on the debug connector reads the target's I/O voltage — a 1.8 V target connected to a 3.3 V-only probe can damage level-sensitive pins.
- Use OpenOCD's `adapter speed` command to step down the clock when connections are unreliable before blaming the probe or wiring.
- Flash a known-good blinky firmware as the first test after connecting a new probe to confirm the full toolchain works end-to-end.

## Caveats

- **Cheap ST-Link clones often lack voltage translation** — They output 3.3 V signals regardless of target voltage, which risks damage to 1.8 V targets or unreliable operation at 5 V logic levels.
- **SWD does not support daisy-chaining** — Multi-device boards with shared debug access require JTAG or individual SWD connections per target.
- **NRST connection is optional but matters** — Without the reset line, some targets cannot be recovered from low-power modes or bad firmware that disables debug pins.
- **J-Link EDU licensing restricts commercial use** — The $20 EDU version is legally limited to non-commercial development; production programming requires the BASE or PLUS model.
- **OpenOCD target configs vary by silicon revision** — An STM32F411 config may not work for an STM32F407 despite both being Cortex-M4; always match the exact target file.

## In Practice

- A probe that connects intermittently or loses connection during flash programming usually indicates a clock speed too high for the wiring — reducing `adapter speed` to 1000 kHz or below often resolves it.
- A "target not found" error on a board that previously worked suggests the target is in a deep sleep mode or the debug pins have been remapped by firmware — holding NRST low during connection forces the target into reset and re-enables debug access.
- A debug session that works in one IDE but fails in another is almost always a configuration mismatch in the OpenOCD or pyOCD target/interface file, not a hardware problem.
- Flash programming that succeeds but the target does not run the new firmware points to a missing reset after programming — some probe configurations require an explicit `reset run` command.
- A probe that enumerates on USB but refuses to connect to any target may have corrupted firmware — ST-Link and DAPLink probes can be reflashed using vendor-provided update utilities.
