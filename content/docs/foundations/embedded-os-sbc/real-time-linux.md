---
title: "Real-Time Constraints on Linux"
weight: 30
---

# Real-Time Constraints on Linux

Standard Linux is not a real-time operating system. The kernel can preempt user tasks at any time, but kernel code itself has sections that run with preemption disabled — creating unbounded worst-case latencies. For embedded applications that need deterministic timing (motor control, audio processing, high-speed data acquisition), this matters. The difference between a 15 µs average scheduling latency and a 2000 µs worst-case spike is the difference between a control loop that tracks its setpoint and one that overshoots into a mechanical stop.

Understanding where Linux's timing guarantees break down — and what can be done about it — is essential before choosing between an SBC running Linux and a bare-metal MCU for a time-sensitive application.

---

## What "Real-Time" Means in This Context

The term "real-time" is frequently misused. In embedded systems, it has a specific meaning that is distinct from "fast."

### Determinism, Not Speed

A real-time system guarantees that a response will occur within a **bounded worst-case time**. Average latency is largely irrelevant — what matters is the absolute maximum latency that can ever occur, including under worst-case system load. A system with 50 µs average and 55 µs worst-case latency is more deterministic than one with 5 µs average and 2000 µs worst-case.

### Hard Real-Time vs Soft Real-Time

- **Hard real-time**: Missing a deadline constitutes a system failure. Examples include motor commutation timing, airbag deployment, and safety interlock response. The consequence of a missed deadline is physical damage or danger.
- **Soft real-time**: Missing a deadline degrades performance but does not constitute failure. Examples include audio playback (a glitch is audible but not dangerous) and display refresh (a dropped frame is visible but recoverable).
- **Firm real-time**: A middle ground where a missed deadline makes the result worthless (too late to be useful) but does not cause physical harm. Sensor sampling with strict Nyquist requirements falls here — a late sample cannot be retroactively inserted.

Standard Linux, even without any real-time patches, handles many soft real-time tasks adequately. The concern arises when worst-case latency must be bounded and verified.

### The Metric That Matters

The primary benchmark for real-time Linux performance is **worst-case interrupt-to-response time under sustained load**. This measures how long it takes from the moment a hardware interrupt fires until the corresponding handler or user-space thread begins executing, while the system is simultaneously handling heavy CPU, memory, and I/O load.

This metric captures the combined effect of:

- Interrupt delivery latency
- Kernel preemption latency
- Scheduler dispatch latency
- Cache and TLB effects

A system that reports 10 µs average latency in a quiet lab but has never been measured under load provides no useful real-time guarantee.

---

## Why Standard Linux Has Unbounded Latency

Several kernel mechanisms create unpredictable delays:

### Non-Preemptible Kernel Sections

The standard kernel disables preemption while holding spinlocks, during certain memory management operations, and within interrupt handlers. If a high-priority real-time task becomes runnable while the kernel is in a non-preemptible section, the task must wait until that section completes — and the duration is unbounded in the general case.

### Interrupt Handling

In the standard kernel, hardware interrupt handlers (top halves) run with the interrupted context's preemption disabled. A long-running interrupt handler (such as a USB completion handler processing a large transfer) delays all other processing, including higher-priority real-time tasks.

### Memory Management

Page faults, memory compaction, and slab allocator operations can introduce millisecond-scale delays. If a real-time task touches a page that has been swapped out, the resulting page fault stalls the task for the entire disk (or SD card) I/O duration — potentially tens of milliseconds.

### Kernel Timekeeping

The standard kernel timer tick (typically 250 Hz or 1000 Hz) introduces quantization in scheduling decisions. A task that becomes runnable between ticks may wait up to one full tick period before being scheduled.

### Driver Quality

Many Linux drivers are written for throughput, not latency. Network drivers that process large batches of packets in a single interrupt context, or USB drivers that hold locks during multi-stage transfers, can introduce latency spikes visible in scheduling measurements.

---

## PREEMPT_RT Patch

The PREEMPT_RT patch set transforms the Linux kernel to make nearly all code paths preemptible, dramatically reducing worst-case latency.

### What It Does

The core changes include:

- **Spinlocks become sleeping mutexes**: Most kernel spinlocks are converted to RT-mutexes that support priority inheritance and allow preemption. Only a small number of truly non-preemptible raw spinlocks remain.
- **Threaded interrupt handlers**: Hardware interrupt handlers are converted to kernel threads with configurable priority. This allows the scheduler to prioritize a real-time task over a less-important interrupt handler.
- **Priority inheritance throughout**: Wherever a high-priority task blocks on a resource held by a low-priority task, the holder's priority is temporarily boosted to prevent priority inversion.
- **High-resolution timers**: Timer resolution moves from tick-based (1-4 ms) to hardware timer resolution (typically sub-microsecond).
- **Preemptible RCU**: Read-copy-update sections become preemptible, removing another source of long non-preemptible windows.

### Mainline Integration Status

As of the Linux 6.x kernel series, many PREEMPT_RT features have been merged into the mainline kernel:

- Threaded IRQ infrastructure (`IRQF_ONESHOT`, `request_threaded_irq()`) — mainline since 2.6.30
- High-resolution timers — mainline since 2.6.16
- Priority inheritance futexes — mainline since 2.6.18
- `PREEMPT_DYNAMIC` configuration — mainline since 5.12
- Printk threading — progressively merged through 6.x series
- Forced IRQ threading (`threadirqs` boot parameter) — available in mainline

The full PREEMPT_RT patch set still adds the sleeping spinlock conversion and remaining preemptibility improvements that are not yet mainline. The patch set continues to shrink as pieces are upstreamed.

### Applying PREEMPT_RT to a Mainline Kernel

The general process for building an RT kernel from source:

```bash
# Download matching kernel source and RT patch
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.6.tar.xz
wget https://cdn.kernel.org/pub/linux/kernel/projects/rt/6.6/patch-6.6-rt15.patch.xz

# Extract and apply
tar xf linux-6.6.tar.xz
cd linux-6.6
xzcat ../patch-6.6-rt15.patch.xz | patch -p1

# Configure — start from running kernel's config
cp /boot/config-$(uname -r) .config
make olddefconfig
```

The critical kernel configuration options:

```
CONFIG_PREEMPT_RT=y          # Enable full RT preemption
CONFIG_HIGH_RES_TIMERS=y     # High-resolution timer support
CONFIG_NO_HZ_FULL=y          # Tickless operation for isolated cores
CONFIG_HZ_1000=y             # 1000 Hz tick rate
CONFIG_CPU_FREQ_DEFAULT_GOV_PERFORMANCE=y  # Disable frequency scaling
```

Additional options worth disabling for tighter latency:

```
CONFIG_DEBUG_PREEMPT=n       # Preempt debugging adds overhead
CONFIG_LOCK_STAT=n           # Lock statistics add overhead
CONFIG_FTRACE=n              # Function tracing (disable for production)
CONFIG_KMEMLEAK=n            # Memory leak detector
```

### Pre-Built RT Kernels

Building a custom RT kernel is time-consuming and error-prone. Several distributions provide pre-built options:

| Distribution | Package | Notes |
|---|---|---|
| Raspberry Pi OS | `linux-image-rt` / `raspi-firmware` | Available via `sudo apt install linux-image-rt-arm64` on 64-bit Pi OS (Bookworm+) |
| Ubuntu | `linux-image-rt-*` | Available in universe repository; `sudo apt install linux-lowlatency` for a lighter option |
| Debian | `linux-image-rt-amd64` | Available in main repository |
| Fedora | `kernel-rt` | Available via `dnf install kernel-rt` |
| RHEL / Rocky | `kernel-rt` | Supported in RHEL real-time subscription |

Starting with a vendor-provided RT kernel and validating its latency characteristics before building a custom one avoids days of kernel configuration debugging.

---

## Measured Latency Benchmarks

### cyclictest: The Standard Tool

`cyclictest` is the de facto standard for measuring Linux scheduling latency. It creates one or more real-time threads that sleep for a specified interval, then measures how late the wakeup is relative to the requested time. The difference between requested and actual wakeup time is the scheduling latency.

#### Installation

```bash
# Most distributions
sudo apt install rt-tests

# Or from source
git clone git://git.kernel.org/pub/scm/utils/rt-tests/rt-tests.git
cd rt-tests && make && sudo make install
```

#### Standard Test Command

```bash
# Run cyclictest on all CPUs, SCHED_FIFO priority 80, 1 ms interval,
# for 3600 seconds (1 hour), with histogram output
sudo cyclictest --mlockall --smp --priority=80 \
    --interval=1000 --distance=0 \
    --duration=3600 --histogram=200 \
    --histfile=cyclictest_histogram.txt
```

Key flags:

| Flag | Purpose |
|---|---|
| `--mlockall` | Lock all memory to prevent page faults |
| `--smp` | Run one thread per CPU core |
| `--priority=80` | SCHED_FIFO priority (higher = more priority) |
| `--interval=1000` | Sleep interval in microseconds (1 ms) |
| `--duration=3600` | Test duration in seconds |
| `--histogram=200` | Collect histogram up to 200 µs |

#### Interpreting Results

```
# /dev/cpu_dma_latency set to 0us
T: 0 ( 1842) P:80 I:1000 C: 3600000 Min:      3 Act:    8 Avg:    9 Max:      47
T: 1 ( 1843) P:80 I:1000 C: 3600000 Min:      3 Act:   10 Avg:   10 Max:      52
T: 2 ( 1844) P:80 I:1000 C: 3600000 Min:      2 Act:    7 Avg:    8 Max:      38
T: 3 ( 1845) P:80 I:1000 C: 3600000 Min:      3 Act:    9 Avg:    9 Max:      41
```

- **Min/Avg/Max**: Minimum, average, and maximum latency in microseconds across the entire run
- **C**: Cycle count — total number of wakeup measurements
- **Max** is the only number that matters for real-time guarantees — it represents the worst-case latency observed during the test

#### Generating Load During Testing

Latency measurements taken on a quiet system are meaningless for real-time validation. The system must be under realistic (or worse-than-realistic) load:

```bash
# CPU and memory stress
stress-ng --cpu $(nproc) --io 4 --vm 2 --vm-bytes 256M \
    --timeout 3600s &

# Disk I/O stress
dd if=/dev/urandom of=/tmp/stress_file bs=1M count=1024 \
    oflag=direct &

# Network stress (if applicable)
iperf3 -c <target_ip> -t 3600 -P 4 &
```

### Representative Latency Results

The following table shows typical results from 1-hour cyclictest runs under `stress-ng` load. These are representative — actual results depend on peripheral load, kernel configuration, driver versions, thermal conditions, and test duration.

| Platform | Kernel | Avg Latency | Max Latency (loaded) | Test Conditions |
|---|---|---|---|---|
| Raspberry Pi 4 | Standard (6.1) | ~15 µs | 500–2000 µs | stress-ng (cpu + io + vm), 1 hr |
| Raspberry Pi 4 | PREEMPT_RT (6.1) | ~10 µs | 50–80 µs | stress-ng (cpu + io + vm), 1 hr |
| Raspberry Pi 5 | PREEMPT_RT (6.6) | ~8 µs | 40–70 µs | stress-ng (cpu + io + vm), 1 hr |
| BeagleBone Black | PREEMPT_RT (5.10) | ~12 µs | 50–100 µs | stress-ng (cpu + io + vm), 1 hr |
| Jetson Orin Nano | PREEMPT_RT (5.15) | ~10 µs | 40–80 µs | stress-ng (cpu + io + vm), 1 hr |
| x86_64 (Intel i5) | PREEMPT_RT (6.6) | ~3 µs | 15–25 µs | stress-ng (cpu + io + vm), 1 hr |
| Bare-metal MCU (STM32F4) | N/A (ISR) | ~0.1 µs | ~1 µs | Direct interrupt response |

Notable observations from these measurements:

- The standard Pi 4 kernel shows a **25–40x** spread between average and worst-case latency — this is the fundamental problem PREEMPT_RT addresses.
- PREEMPT_RT narrows the spread to roughly **5–8x**, making worst-case behavior predictable.
- x86 platforms consistently outperform ARM SBCs on RT latency, primarily due to deeper interrupt controller integration and faster cache hierarchies.
- The bare-metal MCU column provides context: even the best-tuned RT-Linux system has **40–80x** worse determinism than a dedicated microcontroller.

---

## Kernel Tuning for Reduced Latency

Installing an RT kernel is the first step. Achieving consistent low-latency behavior requires additional system-level tuning.

### CPU Isolation with `isolcpus`

The `isolcpus` kernel parameter removes specified CPU cores from the general scheduler, preventing kernel threads, workqueues, and user-space processes from running on them. Real-time tasks are then explicitly pinned to these isolated cores.

On a quad-core system, a typical configuration reserves cores 2 and 3 for RT tasks:

```bash
# In /boot/cmdline.txt (Raspberry Pi) or /etc/default/grub (x86)
isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3
```

Explanation of related parameters:

| Parameter | Effect |
|---|---|
| `isolcpus=2,3` | Remove cores 2,3 from the general scheduler |
| `nohz_full=2,3` | Disable the periodic timer tick on isolated cores (tickless mode) |
| `rcu_nocbs=2,3` | Offload RCU callbacks from isolated cores to other cores |

After booting with these parameters, verify isolation:

```bash
# Check which CPUs are isolated
cat /sys/devices/system/cpu/isolated
# Expected: 2-3

# Verify no kernel threads on isolated cores (should be nearly empty)
ps -eo pid,psr,comm | awk '$2 == 2 || $2 == 3'
```

### Threaded IRQs

The `threadirqs` kernel boot parameter forces all interrupt handlers to run as kernel threads, making them schedulable and preemptible:

```bash
# Add to kernel command line
threadirqs
```

Once threaded, IRQ handler priorities can be adjusted:

```bash
# List IRQ threads and their priorities
ps -eo pid,cls,rtprio,comm | grep irq

# Set a specific IRQ thread to lower priority than the RT application
chrt -f -p 50 <irq_thread_pid>
```

The typical approach is to set the RT application's priority higher than all IRQ threads except the one that triggers its work. For example, if the RT application responds to a GPIO interrupt:

- GPIO IRQ thread: priority 90
- RT application thread: priority 80
- All other IRQ threads: priority 50

### CPU Affinity

Pin RT processes to isolated cores using `taskset`:

```bash
# Run an RT application on core 2 with SCHED_FIFO priority 80
sudo taskset -c 2 chrt -f 80 ./rt_application

# Or set affinity of a running process
sudo taskset -cp 2 <pid>
```

From within the application, affinity can be set programmatically:

```c
#define _GNU_SOURCE
#include <sched.h>
#include <sys/mman.h>

void setup_rt_environment(int cpu_core, int priority) {
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(cpu_core, &cpuset);
    sched_setaffinity(0, sizeof(cpuset), &cpuset);

    struct sched_param param;
    param.sched_priority = priority;
    sched_setscheduler(0, SCHED_FIFO, &param);

    /* Lock all current and future memory allocations */
    mlockall(MCL_CURRENT | MCL_FUTURE);
}
```

### Disabling CPU Frequency Scaling

Dynamic frequency scaling (DVFS) introduces latency during frequency transitions. Locking the CPU to maximum frequency eliminates this source of jitter:

```bash
# Set all cores to performance governor
for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    echo performance | sudo tee "$cpu"
done

# Verify
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
# Expected: performance

# On Raspberry Pi, also disable ondemand service
sudo systemctl disable ondemand
```

### Memory Configuration

Memory management is a significant source of latency spikes in RT applications:

```bash
# Disable transparent huge pages (THP)
echo never | sudo tee /sys/kernel/mm/transparent_hugepage/enabled

# Disable automatic NUMA balancing (multi-socket systems)
echo 0 | sudo tee /proc/sys/kernel/numa_balancing
```

In the application code, lock all memory to prevent page faults:

```c
#include <sys/mman.h>

/* At application startup, before entering the RT loop */
if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
    perror("mlockall failed");
    /* Cannot guarantee RT behavior without locked memory */
    exit(1);
}

/* Pre-fault the stack by touching it */
{
    volatile char stack_prefault[8192];
    memset((char *)stack_prefault, 0, sizeof(stack_prefault));
}
```

### Timer Tick Configuration

For isolated cores running a single RT task, eliminating the periodic timer tick removes one source of scheduling interference:

```bash
# Kernel command line (combined with isolcpus)
nohz_full=2,3

# This enables "adaptive-ticks" mode:
# - When only one runnable task is on the core, the tick stops
# - No timer interrupts disturb the RT task
```

### Disabling Unnecessary Kernel Features

Several kernel features add measurable latency overhead:

```bash
# Disable kernel audit subsystem
audit=0    # kernel command line

# Disable kernel watchdog (NMI-based, can interrupt RT tasks)
nosoftlockup nowatchdog

# Reduce kernel log verbosity
loglevel=3

# Disable speculative execution mitigations (if security model permits)
# WARNING: only appropriate for dedicated, non-networked embedded systems
mitigations=off
```

### Complete Kernel Command Line Example

A full kernel command line for an RT-optimized Raspberry Pi 4:

```
console=serial0,115200 console=tty1 root=PARTUUID=xxx rootfstype=ext4 \
    fsck.repair=yes rootwait \
    isolcpus=2,3 nohz_full=2,3 rcu_nocbs=2,3 \
    threadirqs \
    nosoftlockup nowatchdog \
    audit=0 loglevel=3 \
    processor.max_cstate=0 idle=poll
```

The `idle=poll` parameter keeps the CPU from entering low-power idle states, which add exit latency. This trades power consumption for reduced worst-case latency — appropriate for mains-powered embedded systems but not battery-operated ones.

---

## RT-Linux vs Bare-Metal MCU

The fundamental question for any time-sensitive embedded project: does the application need Linux, or does it need determinism?

### Latency Comparison

| Metric | RT-Linux (well-tuned) | Bare-Metal MCU (STM32F4-class) |
|---|---|---|
| Worst-case ISR response | 40–150 µs | 0.1–1 µs |
| Scheduling jitter | 5–50 µs | 0 (no scheduler) |
| Best achievable loop rate | ~10 kHz (with margin) | >1 MHz |
| Context switch time | 5–15 µs | 0.5–2 µs (RTOS) |
| Page fault impact | 0 (with mlockall) to ms | N/A (no MMU) |

The gap is **50–150x** in worst-case determinism. This is not a tuning gap — it is architectural.

### When RT-Linux Is Sufficient

RT-Linux works well for applications where the control loop period is long relative to the worst-case jitter:

- **Control loops at 1 kHz or slower**: A 1 ms period with 50–80 µs worst-case jitter represents 5–8% timing uncertainty — acceptable for many PID controllers, temperature regulation, and position control systems.
- **Audio processing at standard sample rates**: 48 kHz audio with ALSA and an RT kernel handles buffer sizes of 128–256 frames (2.7–5.3 ms) reliably, sufficient for most real-time audio effects and synthesis.
- **Data acquisition with buffering**: Sampling analog signals at rates up to ~50 kHz using DMA-based ADC interfaces, where the kernel is responsible for processing buffers rather than individual samples.
- **Network-connected systems**: Applications that need both real-time response and TCP/IP networking benefit enormously from running on Linux rather than implementing a network stack on a bare-metal MCU.

### When RT-Linux Is Not Sufficient

Some applications require determinism that Linux cannot provide, regardless of tuning:

- **Motor commutation above 10 kHz**: BLDC motor field-oriented control (FOC) at 20 kHz PWM frequency requires current sensing and phase switching within microseconds. RT-Linux jitter of 50+ µs makes this impractical.
- **Safety-critical hard real-time**: Applications subject to IEC 61508, ISO 26262, or DO-178C certification require formally verified timing bounds. Linux is not certifiable to these standards.
- **Sub-microsecond jitter**: Precision timing applications — laser pulse control, high-speed sensor synchronization, stepper motor microstepping at high speeds — need jitter below 1 µs.
- **Guaranteed response in all conditions**: RT-Linux worst-case numbers are empirical, not formally proven. A 1-hour cyclictest may miss a rare worst-case event that occurs once per day. Bare-metal MCU interrupt latency is architecturally bounded by the silicon.

---

## Xenomai as an Alternative

Xenomai takes a fundamentally different approach from PREEMPT_RT, achieving better worst-case latency at the cost of increased complexity.

### Dual-Kernel Architecture

Xenomai runs a small, hard-real-time co-kernel (Cobalt) alongside the Linux kernel. The co-kernel handles all real-time scheduling and interrupt management, treating Linux as the lowest-priority task. When a real-time interrupt fires, Cobalt handles it immediately — Linux only runs when no real-time task needs the CPU.

This architecture means:

- Real-time tasks run in a separate execution domain with guaranteed preemption of Linux
- Worst-case latency depends only on the co-kernel, not on Linux kernel code paths
- Typical worst-case latency: **10–30 µs** under heavy load (compared to 40–80 µs for PREEMPT_RT on the same hardware)

### Tradeoffs

| Aspect | PREEMPT_RT | Xenomai (Cobalt) |
|---|---|---|
| Worst-case latency | 40–80 µs (ARM SBC) | 10–30 µs (ARM SBC) |
| API | Standard POSIX (pthreads, clock_nanosleep) | Xenomai-specific API (Alchemy, POSIX skin) |
| Driver model | Standard Linux drivers | Xenomai RTDM drivers for RT I/O |
| Maintenance | Approaching full mainline merge | Separate patch set, smaller community |
| Complexity | Low — standard Linux userspace | High — dual-kernel debugging, mode switching |
| Kernel support | Follows mainline releases closely | Lags behind mainline, limited to supported versions |

### Mode Switching Penalty

A critical Xenomai concept: when a real-time task makes a Linux system call (file I/O, network socket, `printf`), it triggers a **mode switch** from the Cobalt domain to the Linux domain. This switch has a cost (~5–15 µs) and temporarily makes the task non-real-time. Keeping RT tasks in the Cobalt domain requires using only Xenomai-native I/O interfaces for any operations in the critical path.

### Community and Long-Term Trajectory

PREEMPT_RT has steadily gained mainline kernel integration, backed by the Linux Foundation's Real-Time Linux project and contributors from major embedded companies. Xenomai's community remains active but smaller, and the dual-kernel approach inherently requires ongoing maintenance against each new kernel version. The general trajectory favors PREEMPT_RT for new projects, with Xenomai reserved for applications that demonstrably need sub-30 µs worst-case latency on Linux-class hardware.

---

## Practical RT Application Structure

A well-structured real-time Linux application follows a common pattern:

```c
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <sched.h>
#include <sys/mman.h>
#include <errno.h>

#define RT_PRIORITY     80
#define RT_CPU          2
#define LOOP_PERIOD_NS  1000000  /* 1 ms = 1 kHz loop rate */

static void configure_rt(void) {
    /* Set CPU affinity to isolated core */
    cpu_set_t cpuset;
    CPU_ZERO(&cpuset);
    CPU_SET(RT_CPU, &cpuset);
    if (sched_setaffinity(0, sizeof(cpuset), &cpuset) != 0) {
        perror("sched_setaffinity");
        exit(1);
    }

    /* Set SCHED_FIFO scheduling policy */
    struct sched_param param;
    param.sched_priority = RT_PRIORITY;
    if (sched_setscheduler(0, SCHED_FIFO, &param) != 0) {
        perror("sched_setscheduler");
        exit(1);
    }

    /* Lock all memory */
    if (mlockall(MCL_CURRENT | MCL_FUTURE) != 0) {
        perror("mlockall");
        exit(1);
    }

    /* Pre-fault stack */
    volatile char stack_prefault[8192];
    memset((char *)stack_prefault, 0, sizeof(stack_prefault));
}

static void timespec_add_ns(struct timespec *ts, long ns) {
    ts->tv_nsec += ns;
    while (ts->tv_nsec >= 1000000000L) {
        ts->tv_nsec -= 1000000000L;
        ts->tv_sec++;
    }
}

int main(void) {
    struct timespec next_period;

    configure_rt();

    /* All memory allocation must happen before entering the RT loop.
     * malloc(), printf(), file I/O, and other non-deterministic calls
     * must not appear inside the loop. */

    clock_gettime(CLOCK_MONOTONIC, &next_period);

    while (1) {
        timespec_add_ns(&next_period, LOOP_PERIOD_NS);
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME,
                        &next_period, NULL);

        /* --- RT work happens here --- */
        /* Read sensors, compute control output, write actuators */
        /* No system calls that may block (no printf, no malloc,
         * no file I/O, no mutex acquisition without timeout) */
    }

    return 0;
}
```

Key structural rules:

- All memory allocation happens **before** the RT loop
- `clock_nanosleep()` with `TIMER_ABSTIME` prevents drift accumulation
- No calls to `printf()`, `malloc()`, `fwrite()`, or other non-deterministic functions inside the loop
- The RT loop body should be short enough to complete well within the loop period
- Error logging from the RT loop, if needed, writes to a lock-free ring buffer that a non-RT thread drains

---

## Verifying RT Behavior

Beyond cyclictest, several tools help validate that the system is behaving as expected.

### Checking Scheduling Policy

```bash
# Verify the RT application is running with correct policy and priority
chrt -p <pid>
# Expected output: pid <N>'s current scheduling policy: SCHED_FIFO
# pid <N>'s current scheduling priority: 80

# Verify CPU affinity
taskset -cp <pid>
# Expected output: pid <N>'s current affinity list: 2
```

### Monitoring Latency at Runtime

```bash
# Check for kernel preemption latency events in ftrace
echo function_graph > /sys/kernel/debug/tracing/current_tracer
echo 1 > /sys/kernel/debug/tracing/tracing_on
# ... run workload ...
echo 0 > /sys/kernel/debug/tracing/tracing_on
cat /sys/kernel/debug/tracing/trace | head -100
```

### hwlatdetect: Hardware-Level Latency

`hwlatdetect` measures latency caused by hardware — SMI (System Management Interrupts), BIOS activity, and platform firmware. These latency sources exist below the OS level and cannot be eliminated by kernel tuning.

```bash
sudo hwlatdetect --duration=300
```

If `hwlatdetect` reports spikes that exceed the application's jitter budget, no amount of kernel tuning can fix the problem. The platform itself is not suitable for that level of real-time performance.

### Oscilloscope Verification

For critical applications, the definitive latency measurement uses an oscilloscope:

1. Configure a GPIO pin toggle at the start of each RT loop iteration
2. Feed an external trigger signal (the event the RT task responds to)
3. Measure the time between the trigger edge and the GPIO toggle

This captures the true end-to-end latency including all hardware and software components — something cyclictest cannot measure.

---

## Tips

- Run cyclictest for at least 1 hour under realistic load before trusting latency numbers — short tests miss rare worst-case events. For production validation, 24-hour runs are standard practice.

- Use `isolcpus=2,3` on a quad-core SBC to dedicate cores to RT tasks and keep system services on cores 0 and 1. This single step often eliminates the largest latency spikes.

- Pin RT threads to isolated cores with `taskset -c 2 ./rt_app` and set `SCHED_FIFO` priority. Without explicit affinity, the scheduler may migrate the RT task to a core handling USB or network interrupts.

- Build the RT application with `mlockall(MCL_CURRENT | MCL_FUTURE)` to prevent page faults during execution. Call it once at startup, before entering the real-time loop.

- Pre-fault the stack by allocating and touching a volatile buffer at startup — this ensures the stack pages are physically mapped before the RT loop begins.

- Start with a vendor-provided RT kernel before attempting to build a custom one — it avoids days of kernel configuration debugging and provides a known-good baseline for latency measurements.

- Log cyclictest histograms, not just max values — the latency distribution reveals whether worst-case spikes are isolated outliers (possibly hardware SMIs) or systematic (indicating a kernel or driver problem).

- Use `CLOCK_MONOTONIC` with `TIMER_ABSTIME` in `clock_nanosleep()` to prevent drift accumulation. Sleeping for a relative duration introduces cumulative error from the time spent executing the loop body.

- Write `/dev/cpu_dma_latency` with a value of `0` from the RT application to prevent CPU idle states. This achieves the same effect as `idle=poll` but only while the application is running:

  ```c
  int fd = open("/dev/cpu_dma_latency", O_RDWR);
  int32_t latency = 0;
  write(fd, &latency, sizeof(latency));
  /* Keep fd open for the lifetime of the RT application */
  ```

- Check `hwlatdetect` results before investing time in kernel tuning — if the hardware itself has large latency spikes (common with x86 systems that have aggressive SMI behavior), kernel-level improvements cannot compensate.

- Avoid running any GUI or desktop environment on an RT system. X11/Wayland compositors, GPU drivers, and desktop services generate unpredictable interrupt and scheduling load.

---

## Caveats

- PREEMPT_RT reduces throughput by 5–15% compared to a standard kernel — the same hardware does less non-RT work. The sleeping spinlock conversion adds overhead to every kernel lock acquisition, even for non-RT tasks.

- USB and network drivers on many SBCs are not RT-optimized — USB traffic can inject 100+ µs latency spikes even on an RT kernel. On the Raspberry Pi, the USB controller shares an interrupt with Ethernet, compounding the effect.

- SD card I/O is a major latency source — any RT application should avoid filesystem access in the critical path. SD card write operations can stall for 50–200 ms during wear-leveling or garbage collection, and these stalls are not preventable from the host side.

- Kernel updates can break PREEMPT_RT patches — version pinning is essential for production systems. The RT patch set is version-specific; upgrading from kernel 6.1-rt to 6.6-rt may require revalidating the entire tuning configuration.

- cyclictest measures scheduling latency only — it does not capture application-level latency from I/O, memory allocation, or lock contention. A system that passes cyclictest validation may still miss deadlines if the application itself has non-deterministic code paths.

- "Real-time Linux" marketing from SBC vendors sometimes means only that an RT kernel package is available in the repository, not that the platform has been validated for RT use or that peripheral drivers are RT-compatible.

- Thermal throttling on ARM SBCs introduces periodic latency spikes that correlate with die temperature. A Pi 4 without a heatsink under sustained load can throttle every few seconds, causing latency spikes that do not appear in short tests run on a cool system.

- `isolcpus` does not prevent all kernel activity on isolated cores — certain per-CPU kernel threads (migration, ksoftirqd) may still execute briefly. Full isolation additionally requires `nohz_full` and `rcu_nocbs`.

- The `idle=poll` parameter significantly increases power consumption and heat generation. On passively cooled SBCs, this can paradoxically worsen latency by triggering thermal throttling.

- Worst-case latency numbers from cyclictest are empirical, not proven bounds. A 1-hour test with a 52 µs maximum does not guarantee the system will never exceed 52 µs — it only means it was not observed to do so during that specific test run. Longer tests and adversarial load patterns can uncover worse cases.

---

## In Practice

- **Periodic latency spikes correlated with USB activity** often show up as 100–300 µs outliers in cyclictest histograms on SBCs where the USB controller shares an interrupt line with other peripherals. A control loop running at 1 kHz on a PREEMPT_RT Pi 4 typically shows consistent 10–15 µs scheduling jitter — until a USB device is plugged in or a USB transfer completes, at which point spikes of 200+ µs appear. Isolating the RT task to a CPU core away from the USB IRQ handler resolves this. Checking `/proc/interrupts` reveals which cores service the USB interrupt, informing the choice of which core to isolate.

- **Thermal-induced latency spikes** commonly appear as periodic jumps in cyclictest max values on a Pi 5 running continuous RT workloads. The spikes correlate with `vcgencmd measure_temp` readings above 80°C, at which point the firmware reduces clock speed. A heatsink or active cooling eliminates the pattern. On Jetson platforms, `tegrastats` shows the thermal zone triggering the throttle.

- **Audio buffer underruns** at small buffer sizes (64 frames at 48 kHz = 1.3 ms) on an RT kernel often appear as periodic clicks or dropouts in the audio stream. ALSA's `xrun_debug` logging confirms the underruns. Increasing to 128 or 256 frames (2.7–5.3 ms) provides margin while staying within acceptable latency for most audio processing. The underruns at 64 frames typically correspond to the worst-case scheduling latency exceeding the buffer period.

- **Gradual latency degradation over hours** sometimes appears in cyclictest runs as a slow upward trend in both average and maximum latency. This pattern often traces to memory fragmentation when the RT application (or another process) performs repeated small allocations without `mlockall()`. The kernel's memory compaction runs periodically and introduces scheduling delays. Locking memory at startup and pre-allocating all buffers eliminates the trend.

- **Unexplained latency spikes on x86 platforms** that do not correlate with any OS-level activity often originate from System Management Interrupts (SMIs). These are BIOS-level events invisible to the OS. `hwlatdetect` confirms the presence of SMI-induced latency. Some BIOS versions allow disabling unnecessary SMI sources; others do not. On platforms with irreducible SMI latency, the RT application must budget for it.

- **The heterogeneous pattern** — Linux for networking and user interface, MCU for the time-critical loop — appears frequently in projects that start with PREEMPT_RT and later discover the worst-case latency is insufficient. The typical architecture uses a Raspberry Pi or similar SBC communicating with an STM32 or similar MCU over SPI or UART, with the MCU handling the fast control loop (motor commutation, high-speed ADC sampling) and the Linux host handling data logging, network connectivity, and operator interface. This pattern combines the strengths of both platforms and avoids forcing either into a role it is not suited for.

- **Conflicting IRQ priorities on the same core** manifest as intermittent latency spikes that appear random but correlate with specific peripheral activity. Moving the RT application to a different core may resolve the issue, but the root cause — two high-priority interrupt sources competing on the same core — is worth identifying. Examining `/proc/interrupts` over time and correlating per-core interrupt counts with latency spikes reveals the conflict.
