---
title: "🛠️ Development & Debugging"
weight: 2
bookCollapseSection: true
---

# Development & Debugging

Getting firmware from source code to a running chip — and figuring out why it isn't working — requires a distinct set of tools and workflows. Cross-compilation targets a processor architecture different from the build machine, vendor SDKs provide hardware abstraction at the cost of complexity, and build systems must manage compiler flags, linker scripts, and output format conversions. On the debug side, SWD/JTAG probes, serial output channels, logic analyzers, and crash analysis techniques each reveal a different layer of system behavior. Board bring-up ties it all together: a systematic process of verifying power, clocks, debug access, and peripherals on new hardware before trusting any firmware results.

## Sections

- **[Toolchains & Build Systems]({{< relref "toolchains-and-build-systems" >}})** — Cross-compilation, build system configuration, flashing and boot modes, and the role of vendor SDKs and hardware abstraction layers.
- **[Debugging & Observability]({{< relref "debugging-and-observability" >}})** — Debug probes, serial output channels, bench instruments, and crash analysis techniques for when things go wrong.
- **[Project Bring-Up Workflow]({{< relref "project-bring-up" >}})** — The systematic process of bringing a new board from first power-on through peripheral verification to a working baseline.
