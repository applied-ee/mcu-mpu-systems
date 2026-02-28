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

## Hardware Breakpoints vs Software Breakpoints

ARM Cortex-M processors support two breakpoint mechanisms. **Hardware breakpoints** use the Flash Patch and Breakpoint (FPB) unit, which contains a limited number of comparators that match against the program counter. Cortex-M3 and M4 devices provide 6 hardware breakpoint comparators; Cortex-M0 typically has 4. Because these operate in silicon, hardware breakpoints work on code executing from flash without modifying the flash contents. **Software breakpoints** work by replacing the instruction at the target address with a `BKPT` opcode (0xBExx on Thumb). This modification requires writable memory, so software breakpoints only function in SRAM — or in flash if the debugger erases and reprograms the sector, which is slow. Most debuggers use hardware breakpoints by default and fall back to software breakpoints when the hardware limit is exhausted. Running out of hardware breakpoints on flash-resident code produces a silent failure or a debugger warning, depending on the tool.

## Watchpoints for Memory Corruption Debugging

The Data Watchpoint and Trace (DWT) unit provides data watchpoints — comparators that trigger when a specific memory address is read, written, or accessed. Cortex-M3/M4 devices typically have 4 watchpoint comparators. Watchpoints are invaluable for tracking down memory corruption: setting a watchpoint on a global variable's address causes the processor to halt the instant any code writes to that location, directly identifying the offending instruction. In GDB, the command `watch *(uint32_t *)0x20000100` sets a write watchpoint on address 0x20000100. Read watchpoints (`rwatch`) and access watchpoints (`awatch`) are also available. Unlike breakpoints, watchpoints consume DWT comparators and are always hardware-based — there is no software equivalent.

## Production Debug Lock

Before shipping a product, disabling debug access prevents firmware extraction through the SWD/JTAG interface. On STM32 devices, this is controlled through Read-Out Protection (RDP) levels configured in the option bytes. **RDP Level 0** (default) leaves debug fully open. **RDP Level 1** protects flash from external read access but still allows debug connections and SRAM access — transitioning back to Level 0 triggers a full flash erase. **RDP Level 2** permanently disables the debug interface at the silicon level. Level 2 is irreversible: no debugger, no flash tool, and no firmware update through SWD can ever access the device again. Programming RDP Level 2 on a device with buggy firmware bricks it permanently. The typical production flow sets RDP Level 1 so that field returns can still be mass-erased and reprogrammed.

## Semihosting

Semihosting is a mechanism that redirects C library I/O calls (e.g., `printf`, `fopen`) from the target to the host debugger. The target firmware executes a `BKPT` instruction with a specific parameter, which halts the CPU and signals the debugger to service the request. The debugger reads arguments from the target's registers, performs the I/O operation on the host, and resumes execution. This enables printf-style output without any UART or pin allocation. The critical limitation is performance and deployment safety: each semihosting call halts the processor for the duration of the host I/O operation, producing millisecond-scale stalls. If no debugger is attached, the `BKPT` instruction triggers a HardFault, causing the firmware to crash. Semihosting must be completely disabled or compiled out in production builds.

## Tips

- Start with the probe that matches the target vendor's ecosystem — ST-Link for STM32, J-Link for Nordic/NXP — to minimize configuration friction.
- Keep SWD/JTAG traces short and away from high-speed switching signals; even 15 cm of unshielded wire can cause intermittent connection drops at 4 MHz.
- Verify VTref on the debug connector reads the target's I/O voltage — a 1.8 V target connected to a 3.3 V-only probe can damage level-sensitive pins.
- Use OpenOCD's `adapter speed` command to step down the clock when connections are unreliable before blaming the probe or wiring.
- Flash a known-good blinky firmware as the first test after connecting a new probe to confirm the full toolchain works end-to-end.
- When debugging a variable corruption issue, set a DWT watchpoint on the address and run — the debugger halts at the exact instruction performing the rogue write, eliminating guesswork.
- Test semihosting-enabled firmware with and without a debugger attached before committing — an unguarded `BKPT` instruction in production firmware causes an immediate HardFault.

## Caveats

- **Cheap ST-Link clones often lack voltage translation** — They output 3.3 V signals regardless of target voltage, which risks damage to 1.8 V targets or unreliable operation at 5 V logic levels.
- **SWD does not support daisy-chaining** — Multi-device boards with shared debug access require JTAG or individual SWD connections per target.
- **NRST connection is optional but matters** — Without the reset line, some targets cannot be recovered from low-power modes or bad firmware that disables debug pins.
- **J-Link EDU licensing restricts commercial use** — The $20 EDU version is legally limited to non-commercial development; production programming requires the BASE or PLUS model.
- **OpenOCD target configs vary by silicon revision** — An STM32F411 config may not work for an STM32F407 despite both being Cortex-M4; always match the exact target file.
- **Hardware breakpoint count is easily exhausted** — Six FPB comparators can be consumed by a handful of IDE breakpoints; a "no more breakpoints available" error means the limit has been reached, not that the debugger is broken.
- **RDP Level 2 is permanent** — There is no recovery path from RDP Level 2 on STM32; even the chip vendor cannot unlock the device. Verify firmware thoroughly before applying this protection level.

## In Practice

- A probe that connects intermittently or loses connection during flash programming usually indicates a clock speed too high for the wiring — reducing `adapter speed` to 1000 kHz or below often resolves it.
- A "target not found" error on a board that previously worked suggests the target is in a deep sleep mode or the debug pins have been remapped by firmware — holding NRST low during connection forces the target into reset and re-enables debug access.
- A debug session that works in one IDE but fails in another is almost always a configuration mismatch in the OpenOCD or pyOCD target/interface file, not a hardware problem.
- Flash programming that succeeds but the target does not run the new firmware points to a missing reset after programming — some probe configurations require an explicit `reset run` command.
- A probe that enumerates on USB but refuses to connect to any target may have corrupted firmware — ST-Link and DAPLink probes can be reflashed using vendor-provided update utilities.
- A debugger session where breakpoints are silently skipped on flash-resident code indicates all hardware breakpoint comparators are in use — removing unused breakpoints or reducing their count restores proper halt behavior.
- Semihosting output that works during stepping but causes a HardFault during free-running execution usually means the probe cannot service the semihosting trap fast enough — switching to RTT or UART eliminates the issue.
