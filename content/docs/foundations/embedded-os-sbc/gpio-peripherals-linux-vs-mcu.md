---
title: "GPIO & Peripheral Access: Linux vs Bare-Metal"
weight: 40
---

# GPIO & Peripheral Access: Linux vs Bare-Metal

On a bare-metal MCU, toggling a GPIO pin means writing directly to a memory-mapped register — a single instruction, deterministic, and immediate. On Linux, that same operation passes through kernel drivers, userspace APIs, and scheduling layers. The abstraction provides safety and portability but introduces latency and non-determinism that fundamentally changes what GPIO can and cannot do.

Understanding the available access methods, their performance characteristics, and their limitations is essential for choosing the right approach on a Linux-based SBC. Some tasks that are trivial on a bare-metal MCU — bit-banging a custom protocol, generating a precisely-timed PWM signal — become difficult or impossible through a standard Linux GPIO interface. Other tasks — managing dozens of I²C sensors, driving SPI displays while running a network stack — become dramatically easier with a full OS underneath.

---

## The Abstraction Stack

On a bare-metal MCU such as an STM32 or RP2040, GPIO access follows a direct path:

```
Application code → Register write → Pin state changes
```

The entire path executes in a single clock cycle (or a small handful of cycles on Cortex-M with bus wait states). There is no OS, no scheduler, and no protection layer between the application and the hardware.

On a Linux SBC such as a Raspberry Pi or BeagleBone, the path is longer:

```
Application code → System call / ioctl → Kernel GPIO subsystem →
  GPIO controller driver → Hardware register → Pin state changes
```

Each layer adds latency and introduces scheduling uncertainty. The kernel may preempt the process between the system call entry and the actual register write. Other processes, interrupts, and kernel threads compete for CPU time. The result is that even the fastest userspace GPIO toggle on Linux is roughly 100 to 1000 times slower than a bare-metal register write, and the jitter on that timing is unpredictable.

### Where the Latency Lives

The dominant sources of latency in Linux GPIO access are:

- **Context switch into kernel space** — The system call itself costs 0.5 to 2 µs on typical ARM SoCs.
- **Kernel GPIO framework overhead** — The gpiolib subsystem validates the request, checks permissions, and routes it to the correct controller driver.
- **Scheduler preemption** — At any point during the path, the kernel scheduler may suspend the process to run something else. On a loaded system, this can add milliseconds of delay.
- **Cache effects** — After a context switch, instruction and data caches may be cold, adding further unpredictable delay.

On a bare-metal MCU, none of these layers exist. A `GPIOA->ODR |= (1 << 5)` compiles to a single store instruction with deterministic execution time.

---

## GPIO Access Methods on Linux

Four primary methods exist for accessing GPIO from a Linux system, each with different trade-offs between performance, safety, and portability.

### sysfs (Deprecated)

The original Linux GPIO interface exposes pins through the virtual filesystem at `/sys/class/gpio/`. The typical workflow:

```bash
# Export GPIO pin 17
echo 17 > /sys/class/gpio/export

# Set direction to output
echo out > /sys/class/gpio/gpio17/direction

# Set pin high
echo 1 > /sys/class/gpio/gpio17/value

# Set pin low
echo 0 > /sys/class/gpio/gpio17/value

# Release the pin
echo 17 > /sys/class/gpio/unexport
```

Each read or write to these files triggers a full filesystem operation: open, write, close. The kernel parses the ASCII string, converts it to an integer, and then performs the actual GPIO operation. This overhead results in toggle latencies of approximately 100 µs per operation — slow enough that even toggling an LED at 1 kHz is unreliable under load.

The sysfs GPIO interface was deprecated in Linux 4.8 (2016) in favor of the character device interface. It remains in the kernel for backward compatibility and still appears in many older tutorials, forum posts, and legacy codebases. New development should avoid it entirely.

**Key limitations of sysfs:**
- No support for atomic multi-pin operations (setting several pins simultaneously)
- No built-in event/edge detection — polling `value` files is the only option
- Pin numbering is global and platform-dependent, making code non-portable
- Race conditions between export/unexport and direction/value operations
- The interface provides no way to identify which GPIO controller owns a given pin number

### Character Device (libgpiod)

The modern Linux GPIO interface uses character devices at `/dev/gpiochipN`, where each GPIO controller on the SoC appears as a separate chip device. The `libgpiod` library provides both a C API and a set of command-line tools for interacting with these devices.

#### Command-Line Tools

The `libgpiod` package includes several utilities useful for exploration and debugging:

```bash
# List all GPIO chips on the system
gpiodetect
```

Typical output on a Raspberry Pi 4:

```
gpiochip0 [pinctrl-bcm2711] (58 lines)
gpiochip1 [raspberrypi-exp-gpio] (8 lines)
```

```bash
# Show all lines on a chip with their current configuration
gpioinfo gpiochip0
```

This displays each line's name (if assigned in device tree), direction, active state, and which consumer (if any) has claimed it. Lines already in use by kernel drivers appear as "used" with the driver name.

```bash
# Read the value of a GPIO line
gpioget gpiochip0 17

# Set a GPIO line high
gpioset gpiochip0 17=1

# Monitor a line for edge events
gpiomon --rising-edge gpiochip0 17
```

The `gpiomon` tool is particularly useful for testing interrupt-driven inputs — it reports edge events with timestamps, without requiring custom code.

#### C API

The libgpiod C API provides structured access to GPIO lines with proper resource management:

```c
#include <gpiod.h>
#include <stdio.h>
#include <unistd.h>

/* Open a GPIO chip */
struct gpiod_chip *chip = gpiod_chip_open("/dev/gpiochip0");
if (!chip) {
    perror("gpiod_chip_open");
    return 1;
}

/* Get a reference to line 17 */
struct gpiod_line *line = gpiod_chip_get_line(chip, 17);
if (!line) {
    perror("gpiod_chip_get_line");
    gpiod_chip_close(chip);
    return 1;
}

/* Request the line as output, initial value 0 */
if (gpiod_line_request_output(line, "my-app", 0) < 0) {
    perror("gpiod_line_request_output");
    gpiod_chip_close(chip);
    return 1;
}

/* Toggle the line */
gpiod_line_set_value(line, 1);
usleep(1000);
gpiod_line_set_value(line, 0);

/* Release resources */
gpiod_line_release(line);
gpiod_chip_close(chip);
```

The API also supports bulk operations — requesting and setting multiple lines atomically in a single ioctl call. This is critical when multiple pins must change state simultaneously (parallel data buses, stepper motor phases).

#### Edge Detection

Unlike sysfs polling, libgpiod supports event-driven edge detection through the kernel's GPIO interrupt infrastructure:

```c
/* Request line with edge detection */
struct gpiod_line_request_config config = {
    .consumer = "my-app",
    .request_type = GPIOD_LINE_REQUEST_EVENT_RISING_EDGE,
};

gpiod_line_request(line, &config, 0);

/* Wait for an event (blocks until edge occurs or timeout) */
struct gpiod_line_event event;
int ret = gpiod_line_event_wait(line, NULL);  /* NULL = no timeout */
if (ret == 1) {
    gpiod_line_event_read(line, &event);
    printf("Edge at %lld.%09lld\n",
           (long long)event.ts.tv_sec,
           (long long)event.ts.tv_nsec);
}
```

The kernel timestamps the edge event in the interrupt handler, so the timestamp accuracy is much better than the latency of delivering the event to userspace. Typical edge-to-userspace delivery takes 10 to 50 µs, but the timestamp itself is accurate to within a few microseconds.

#### libgpiod v2 vs v1

The libgpiod library underwent a major API redesign between version 1 and version 2. The v2 API (shipped with libgpiod 2.0+) introduces `gpiod_line_request` objects that replace the per-line request model. Many distributions still ship v1 (Raspberry Pi OS Bullseye, for instance), while newer distributions (Bookworm and later) include v2. Code targeting broad compatibility should check the installed version at build time.

**Performance:** Toggle latency with libgpiod is typically 5 to 10 µs from userspace on a Raspberry Pi 4 — roughly 10x faster than sysfs but still 500x to 1000x slower than a bare-metal MCU register write.

### Direct Register Access (mmap)

For applications that need the fastest possible GPIO toggle from userspace, the peripheral registers can be memory-mapped directly into the process's address space. This bypasses the kernel GPIO subsystem entirely.

On a Raspberry Pi 4 (BCM2711), the GPIO registers live at physical address `0xFE200000`. The approach:

```c
#include <fcntl.h>
#include <sys/mman.h>
#include <stdint.h>

#define GPIO_BASE 0xFE200000  /* BCM2711 */
#define BLOCK_SIZE 4096

int fd = open("/dev/mem", O_RDWR | O_SYNC);
volatile uint32_t *gpio = (volatile uint32_t *)mmap(
    NULL, BLOCK_SIZE, PROT_READ | PROT_WRITE,
    MAP_SHARED, fd, GPIO_BASE
);

/* Set GPIO 17 as output (FSEL register) */
gpio[1] &= ~(7 << 21);  /* Clear bits 23-21 */
gpio[1] |=  (1 << 21);   /* Set as output */

/* Set GPIO 17 high */
gpio[7] = (1 << 17);     /* GPSET0 register */

/* Set GPIO 17 low */
gpio[10] = (1 << 17);    /* GPCLR0 register */

munmap((void *)gpio, BLOCK_SIZE);
close(fd);
```

Toggle latency with mmap access is typically 0.1 to 1 µs — approaching bare-metal speeds. The remaining overhead comes from the ARM memory barrier and cache synchronization required for device memory access.

**The `/dev/gpiomem` alternative** — On Raspberry Pi, `/dev/gpiomem` provides access to the GPIO registers without requiring root privileges or full `/dev/mem` access. This is slightly safer than `/dev/mem` since it only exposes the GPIO peripheral block, not all of physical memory.

#### Why mmap Access Is Dangerous

Direct register access from userspace has serious drawbacks:

- **No kernel coordination** — The kernel does not know that userspace has taken control of the pin. If a kernel driver also tries to use the same pin, both will write to the same registers with no arbitration. The result is undefined behavior — pins changing state unexpectedly, peripherals receiving corrupted data.
- **No portability** — The register addresses, bit layouts, and behavior are specific to each SoC. Code written for BCM2711 does not work on BCM2835, BCM2712, or any non-Broadcom chip.
- **No protection** — A bug in the mmap code can write to any register in the mapped page, potentially reconfiguring pins connected to critical functions (SDRAM controller, eMMC interface).
- **Two processes mapping the same registers** — If two processes both mmap the GPIO peripheral and write simultaneously, the result depends on the order of store instructions — a classic race condition with no mutex or lock protecting it.

The typical use case for mmap GPIO is bit-banging protocols that require sub-microsecond timing but cannot use a dedicated hardware peripheral. Even in this case, a dedicated coprocessor (such as the BeagleBone PRU) is usually a better solution.

### Latency Comparison

| Method | Typical Toggle Latency | Determinism | Portability | Safety |
|---|---|---|---|---|
| Bare-metal register write | ~10 ns | High | None (chip-specific) | N/A |
| mmap `/dev/mem` | 0.1–1 µs | Medium | None (chip-specific) | Low |
| libgpiod (character device) | 5–10 µs | Low | High | High |
| sysfs (deprecated) | ~100 µs | Very low | High | High |

The "determinism" column reflects worst-case jitter, not average latency. Under load, libgpiod toggles can occasionally take 100+ µs due to scheduler preemption. The mmap approach has lower average jitter but is still subject to interrupts and kernel preemption — only bare-metal or a real-time coprocessor can guarantee timing.

---

## SPI and I²C from Userspace

GPIO is only one category of peripheral access. SPI and I²C — the two most common bus protocols for sensors, displays, and external memory — also have userspace interfaces on Linux.

### spidev — Userspace SPI

The `spidev` kernel module exposes SPI bus masters as character devices at `/dev/spidevB.C`, where `B` is the bus number and `C` is the chip-select number. Transfers are performed via `ioctl()` calls.

```c
#include <linux/spi/spidev.h>
#include <sys/ioctl.h>
#include <fcntl.h>
#include <stdint.h>

int fd = open("/dev/spidev0.0", O_RDWR);

/* Configure SPI mode and speed */
uint8_t mode = SPI_MODE_0;
uint32_t speed = 1000000;  /* 1 MHz */
uint8_t bits = 8;

ioctl(fd, SPI_IOC_WR_MODE, &mode);
ioctl(fd, SPI_IOC_WR_MAX_SPEED_HZ, &speed);
ioctl(fd, SPI_IOC_WR_BITS_PER_WORD, &bits);

/* Full-duplex transfer */
uint8_t tx[] = {0x01, 0x02, 0x03};
uint8_t rx[3] = {0};

struct spi_ioc_transfer xfer = {
    .tx_buf = (unsigned long)tx,
    .rx_buf = (unsigned long)rx,
    .len = 3,
    .speed_hz = speed,
    .bits_per_word = bits,
};

ioctl(fd, SPI_IOC_MESSAGE(1), &xfer);

close(fd);
```

The kernel handles chip-select assertion/deassertion, clock generation, and — on SoCs that support it — DMA transfers. For small transfers (a few bytes to read a sensor register), the overhead of the ioctl round-trip dominates: approximately 50 to 100 µs per transaction regardless of the data size. For larger transfers (sending a framebuffer to a display), the DMA engine moves data at the full bus clock rate, and the per-transaction overhead becomes negligible relative to the transfer time.

**Maximum practical throughput** depends on the SoC's SPI controller. On a Raspberry Pi 4, the SPI0 peripheral supports clock rates up to 125 MHz, though practical rates above 50 MHz require careful signal integrity. At 10 MHz with DMA, sustained throughput of approximately 1 MB/s is achievable for bulk transfers.

#### Batching Transfers

The `SPI_IOC_MESSAGE(N)` ioctl accepts an array of transfer descriptors, allowing multiple transfers to execute in a single system call. This is critical for protocols that require a command byte followed by a data phase without releasing chip select:

```c
struct spi_ioc_transfer xfers[2] = {
    { .tx_buf = (unsigned long)&cmd, .len = 1 },
    { .rx_buf = (unsigned long)data, .len = 256 },
};

/* Both transfers execute in one ioctl, CS held active between them */
ioctl(fd, SPI_IOC_MESSAGE(2), xfers);
```

Without batching, the kernel releases and reasserts chip select between separate ioctl calls, which violates the protocol requirements of many SPI peripherals.

### i2c-dev — Userspace I²C

The `i2c-dev` module exposes I²C bus masters at `/dev/i2c-N`. Transactions use `ioctl()` with the `I2C_RDWR` command for full control, or simplified `read()`/`write()` calls for basic operations.

```c
#include <linux/i2c-dev.h>
#include <linux/i2c.h>
#include <sys/ioctl.h>
#include <fcntl.h>

int fd = open("/dev/i2c-1", O_RDWR);

/* Read 2 bytes from register 0x00 on device at address 0x48 */
uint8_t reg = 0x00;
uint8_t data[2];

struct i2c_msg msgs[2] = {
    { .addr = 0x48, .flags = 0,        .len = 1, .buf = &reg },
    { .addr = 0x48, .flags = I2C_M_RD, .len = 2, .buf = data },
};

struct i2c_rdwr_ioctl_data xfer = {
    .msgs = msgs,
    .nmsgs = 2,
};

ioctl(fd, I2C_RDWR, &xfer);

close(fd);
```

#### Command-Line Tools

The `i2c-tools` package provides utilities for bus probing and quick register access:

```bash
# Detect all devices on bus 1
i2cdetect -y 1
```

This scans all 112 valid 7-bit addresses and reports which ones acknowledge. The output grid shows addresses that responded, making it a quick way to verify wiring and confirm a device is present on the bus.

```bash
# Read a single byte from register 0x00 on device 0x48
i2cget -y 1 0x48 0x00

# Write value 0x80 to register 0x01 on device 0x48
i2cset -y 1 0x48 0x01 0x80

# Dump all registers from device 0x48
i2cdump -y 1 0x48
```

These tools are invaluable during bring-up: confirming that a sensor responds before writing any driver code, verifying register values after configuration, and debugging communication failures.

### Kernel Drivers vs Userspace Access

The choice between a dedicated kernel driver and userspace access via spidev or i2c-dev depends on the application requirements:

**Kernel driver is preferable when:**
- The peripheral requires continuous, high-speed data streaming (DMA-driven audio codecs, high-rate ADCs)
- Interrupt-driven operation is essential (touch controllers, button matrices)
- Multiple processes or subsystems need coordinated access to the same device
- The device has a standard Linux subsystem (IIO for sensors, ALSA for audio, input subsystem for HID devices, framebuffer/DRM for displays)
- Shared bus arbitration is needed — the kernel I²C core serializes access from multiple drivers on the same bus

**Userspace access is adequate when:**
- The device is used for low-frequency configuration or status reads
- Prototyping and bring-up — faster iteration than writing and loading kernel modules
- Single-process access with no contention
- The application is written in Python, Node.js, or another high-level language where kernel module development is impractical

The Linux Industrial I/O (IIO) subsystem deserves special mention. It provides a unified kernel framework for ADCs, DACs, IMUs, light sensors, and other measurement devices. An IIO driver exposes sensor data through sysfs attributes and a character device with buffered/triggered capture — a much more efficient path than polling a sensor via i2c-dev from userspace.

---

## Device Tree and Pin Configuration

On ARM-based Linux SBCs, the device tree describes the hardware configuration — which peripherals exist, what addresses they occupy, and how pins are assigned. Modifying peripheral availability and pin assignments typically requires editing or overlaying the device tree.

### What the Device Tree Describes

The device tree is a hierarchical data structure (source format `.dts`, compiled format `.dtb`) that the bootloader passes to the kernel at boot. It describes:

- SoC peripherals and their memory-mapped register addresses
- Interrupt routing
- Clock parent relationships
- Pin mux configuration — which function (GPIO, SPI, I²C, UART, PWM) is active on each physical pin
- Peripheral parameters (bus speed, chip-select polarity, etc.)

The kernel uses this information to instantiate the correct drivers with the correct configuration. Without a device tree entry, a peripheral does not exist from the kernel's perspective, even if the hardware is physically present and connected.

### Device Tree Overlays

Overlays are fragments of device tree that modify the base tree at runtime (or at boot). They enable or reconfigure peripherals without recompiling the entire device tree.

**Raspberry Pi example** — enabling SPI1 with three chip selects by adding to `/boot/config.txt`:

```
dtoverlay=spi1-3cs
```

Other common overlays on the Pi:

```
dtoverlay=i2c-gpio,bus=3,i2c_gpio_sda=23,i2c_gpio_scl=24
dtoverlay=pwm-2chan,pin=18,func=2,pin2=19,func2=2
dtoverlay=uart3
```

**BeagleBone example** — overlays are compiled from `.dts` source files into `.dtbo` binary files:

```bash
# Compile an overlay
dtc -O dtb -o my-overlay.dtbo -@ my-overlay.dts

# Load at boot via /boot/uEnv.txt
dtb_overlay=/lib/firmware/my-overlay.dtbo
```

The BeagleBone cape system originally used a runtime cape manager for loading overlays dynamically. Modern BeagleBone images (Debian Bookworm and later) prefer boot-time loading via U-Boot, which is more reliable but requires a reboot to apply changes.

### Pin Muxing

Most SoC pins serve multiple functions. A single physical pin might be configurable as:

- General-purpose GPIO
- SPI clock (SCK)
- I²C data (SDA)
- PWM output
- UART TX

The device tree (or overlay) selects which function is active. On the AM335x (BeagleBone), pin mux configuration is explicit in the overlay:

```dts
&am33xx_pinmux {
    spi1_pins: spi1_pins {
        pinctrl-single,pins = <
            0x190 (PIN_INPUT_PULLUP | MUX_MODE3)  /* SPI1_SCLK */
            0x194 (PIN_INPUT_PULLUP | MUX_MODE3)  /* SPI1_D0 (MISO) */
            0x198 (PIN_OUTPUT | MUX_MODE3)         /* SPI1_D1 (MOSI) */
            0x19C (PIN_OUTPUT | MUX_MODE3)         /* SPI1_CS0 */
        >;
    };
};
```

Each pin has a fixed set of possible functions (modes 0 through 7 on AM335x). The device tree selects the mode and pull-up/pull-down configuration. Attempting to assign a function that does not exist on a particular pin results in a silent failure — the pin remains in its previous state.

### Verifying Pin Configuration

After loading an overlay, verifying that pins are correctly configured prevents hours of debugging:

**Raspberry Pi:**

```bash
# Show current pin state and mux configuration
pinctrl get

# Check loaded overlays
dtoverlay -l

# Inspect the live device tree
ls /proc/device-tree/
```

The `pinctrl` tool (replacing the older `raspi-gpio`) shows the actual hardware state of each pin — its current function, pull-up/pull-down setting, and drive strength. This is the ground truth; if `pinctrl` shows a pin in the wrong mode, the overlay either did not load or conflicted with another configuration.

**BeagleBone:**

```bash
# Show pin mux state
cat /sys/kernel/debug/pinctrl/44e10800.pinmux/pinmux-pins

# Check which driver claimed each GPIO
cat /sys/kernel/debug/gpio
```

---

## PWM from Linux Userspace

PWM on Linux is exposed through the sysfs PWM subsystem at `/sys/class/pwm/`. Unlike the deprecated GPIO sysfs interface, the PWM sysfs interface remains the standard userspace API.

```bash
# Enable PWM channel 0 on pwmchip0
echo 0 > /sys/class/pwm/pwmchip0/export

# Set period to 20 ms (50 Hz — typical servo frequency)
echo 20000000 > /sys/class/pwm/pwmchip0/pwm0/period

# Set duty cycle to 1.5 ms (servo center position)
echo 1500000 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle

# Enable the output
echo 1 > /sys/class/pwm/pwmchip0/pwm0/enable
```

Values are in nanoseconds. The hardware PWM peripheral generates the signal autonomously — once configured, no CPU intervention is needed, and the output is jitter-free regardless of system load.

The number of hardware PWM channels varies by SoC. The Raspberry Pi 4 has two independent PWM channels (though they share a clock divider). The BeagleBone has up to six PWM outputs through the eHRPWM and eCAP modules.

For software PWM (generating PWM from GPIO toggling in userspace), the timing limitations of Linux scheduling apply. Software PWM is adequate for LED brightness control at low frequencies (100–1000 Hz) but unsuitable for motor control or servo applications where timing precision matters.

---

## PRU on BeagleBone

The BeagleBone Black and its successors include two Programmable Real-Time Units (PRU) — dedicated 32-bit RISC cores running at 200 MHz with their own instruction memory, data memory, and direct I/O pins. The PRUs operate independently of the Linux kernel, providing deterministic real-time GPIO access without any OS overhead.

### Architecture

Each PRU core has:

- 8 KB of instruction memory (IRAM)
- 8 KB of data memory (DRAM), plus 12 KB of shared memory between the two PRUs
- Direct access to a set of dedicated I/O pins (no mux through the kernel)
- Single-cycle instruction execution at 200 MHz — 5 ns per instruction
- A register file of 32 general-purpose 32-bit registers
- No pipeline stalls, no cache misses, no branch prediction — every instruction takes exactly one cycle

### GPIO Performance

A PRU can toggle a GPIO pin every instruction cycle — 5 ns. A simple toggle loop:

```asm
; PRU assembly — toggle R30 bit 0 every cycle
LOOP:
    SET r30, r30, 0    ; Set pin high (1 cycle)
    CLR r30, r30, 0    ; Set pin low  (1 cycle)
    QBA LOOP           ; Branch back  (1 cycle)
```

This produces a clean 66.7 MHz square wave with zero jitter — measurable on an oscilloscope as a perfectly stable waveform. The same test with libgpiod from Linux userspace produces visible jitter above 10 kHz and fails to maintain a consistent waveform above approximately 50 kHz.

### Programming the PRU

PRU firmware can be written in:

- **TI PRU assembly** — Maximum control, one instruction per cycle, but a steep learning curve. The instruction set is small (around 40 instructions) but unfamiliar to developers used to ARM or x86.
- **TI PRU C compiler** — Compiles C code targeting the PRU instruction set. Easier to write but does not always produce single-cycle code; the compiler may insert additional instructions for pointer arithmetic and structure access.

Firmware is loaded from Linux userspace via the RemoteProc framework:

```bash
# Copy firmware to the expected location
cp my-pru-firmware /lib/firmware/am335x-pru0-fw

# Start the PRU
echo start > /sys/class/remoteproc/remoteproc1/state

# Stop the PRU
echo stop > /sys/class/remoteproc/remoteproc1/state
```

### Communication with Linux

Two primary mechanisms connect the PRU to the Linux application:

- **Shared memory** — The PRU and ARM core can both access a region of DDR memory or the PRU shared SRAM. The Linux application mmaps this region and reads/writes data that the PRU firmware also accesses. There is no hardware synchronization — the application and PRU must use flags or ring buffers to coordinate access.

- **RPMsg (Remote Processor Messaging)** — A message-passing framework that creates a character device (`/dev/rpmsg_pru30`, `/dev/rpmsg_pru31`) in Linux. The PRU sends messages that appear as reads on the character device, and the Linux application writes messages that the PRU receives via interrupt. Throughput is lower than shared memory but provides proper synchronization.

### Common PRU Use Cases

- **WS2812 / NeoPixel LED strings** — The 800 kHz single-wire protocol requires precise 0.4 µs and 0.8 µs bit timings that only a real-time processor can sustain. The PRU handles the protocol while Linux manages the color data.
- **High-speed encoder counting** — Quadrature encoders on motors can generate millions of edges per second. The PRU counts edges without missing any, while Linux reads the accumulated count periodically.
- **Custom protocol bit-banging** — One-wire protocols, proprietary serial formats, and legacy interfaces that lack kernel drivers.
- **Servo control** — Generating multiple independent PWM signals with microsecond resolution for RC servo motors.
- **Stepper motor pulse generation** — Generating precise step/direction pulses at high rates (100+ kHz) for CNC or 3D printer applications.

### Learning Curve

The PRU documentation from Texas Instruments is functional but sparse. The instruction set reference, register maps, and examples are spread across several documents (the AM335x Technical Reference Manual, the PRU-ICSS Reference Guide, and various application notes). Community resources — particularly the BeagleBoard.org PRU Cookbook — fill in many gaps but can lag behind kernel changes.

The debugging experience is also limited compared to ARM development. There is no GDB-style debugger for PRU code running on hardware; the typical approach is to use shared memory as a printf-style log buffer and inspect it from Linux.

---

## UART from Linux Userspace

UART (serial port) access on Linux goes through the standard terminal device interface at `/dev/ttySN` or `/dev/ttyAMA0` (on Raspberry Pi). The `termios` API configures baud rate, parity, stop bits, and flow control.

```c
#include <termios.h>
#include <fcntl.h>
#include <unistd.h>

int fd = open("/dev/ttyAMA0", O_RDWR | O_NOCTTY);

struct termios tty;
tcgetattr(fd, &tty);

cfsetispeed(&tty, B115200);
cfsetospeed(&tty, B115200);

tty.c_cflag &= ~PARENB;        /* No parity */
tty.c_cflag &= ~CSTOPB;        /* One stop bit */
tty.c_cflag &= ~CSIZE;
tty.c_cflag |= CS8;            /* 8 data bits */
tty.c_cflag |= CLOCAL | CREAD; /* Enable receiver, ignore modem */

/* Raw mode — no line processing */
cfmakeraw(&tty);

/* Apply settings */
tcsetattr(fd, TCSANOW, &tty);

/* Write data */
write(fd, "Hello\n", 6);

/* Read data */
char buf[256];
int n = read(fd, buf, sizeof(buf));

close(fd);
```

On Raspberry Pi, the primary UART (`/dev/ttyAMA0` or `/dev/serial0`) is shared with the Bluetooth module by default. Freeing it for general use requires a device tree overlay:

```
dtoverlay=disable-bt
```

Or using the mini UART (`/dev/ttyS0`) instead, which has a less capable FIFO and ties its baud rate to the core clock — making it unreliable if the CPU frequency changes dynamically.

---

## Voltage Level Concerns

SBC GPIO pins operate at specific voltage levels that differ from many common peripherals. Connecting signals at the wrong voltage damages the SoC permanently and silently — there is no overcurrent protection on most GPIO pins.

### Raspberry Pi

All GPIO pins on every Raspberry Pi model operate at **3.3 V** with no 5 V tolerance. The absolute maximum voltage on any GPIO pin is 3.3 V. Connecting a 5 V signal — even briefly, even through a resistor — risks permanent damage to the BCM SoC. The damage may not be immediately obvious: a pin might continue to work intermittently or with degraded noise margins before failing completely.

### BeagleBone

GPIO on the AM335x operates at **3.3 V** and is likewise not 5 V tolerant. The absolute maximum rating on I/O pins is 3.6 V. The BeagleBone's expansion headers also include 1.8 V analog input pins (for the ADC) that are even more sensitive — applying 3.3 V to an analog input pin damages the ADC peripheral.

### Level Shifting Solutions

When interfacing with 5 V peripherals, a level shifter is required:

- **Bidirectional MOSFET-based shifters (BSS138)** — Simple, inexpensive, and work well for I²C and low-speed GPIO (up to ~400 kHz). The BSS138 circuit uses an N-channel MOSFET with pull-ups on both sides. Suitable for open-drain protocols.

- **TXB0108 auto-direction shifter** — Supports bidirectional signals up to 8 channels. Works at speeds up to ~100 MHz. Does not work well with open-drain protocols (I²C) because the auto-direction sensing conflicts with the pull-up behavior. Best for SPI and parallel buses.

- **74LVC series buffers** — Unidirectional level translation. The 74LVC1T45 and 74LVC245 accept 5 V inputs and output 3.3 V (or vice versa). Fast (up to 200+ MHz) and predictable, but only shift in one direction per channel.

- **Resistive voltage dividers** — Two resistors forming a divider from 5 V to 3.3 V (e.g., 1 kΩ and 2 kΩ). Simple and adequate for slow, unidirectional signals but adds impedance that limits rise time at higher frequencies. Not suitable for I²C or SPI.

### Out-of-Spec Operation

Some 5 V peripherals (WS2812 LEDs, certain 5 V logic sensor breakout boards) technically accept 3.3 V as a logic high. The WS2812 datasheet specifies V_IH (input high voltage) as 0.7 × VDD = 3.5 V, meaning 3.3 V is below the guaranteed input high threshold. In practice, many WS2812 LEDs work with 3.3 V drive — until they do not. Temperature changes, manufacturing variation between LED batches, and long wire runs reduce noise margins to the point where the first LED in the chain occasionally misreads bits. Adding a single-channel level shifter (74HCT125 or a BSS138 circuit) on the data line to the first LED eliminates this class of intermittent failure.

---

## Python Peripheral Access

Python is a common choice for SBC projects due to rapid development, and several libraries provide GPIO and peripheral access:

### gpiod Python Bindings

The `python3-gpiod` package provides Python bindings for libgpiod:

```python
import gpiod

chip = gpiod.Chip('gpiochip0')
line = chip.get_line(17)
line.request(consumer='my-app', type=gpiod.LINE_REQ_DIR_OUT)

line.set_value(1)
line.set_value(0)

line.release()
chip.close()
```

### spidev Python Module

```python
import spidev

spi = spidev.SpiDev()
spi.open(0, 0)          # Bus 0, chip select 0
spi.max_speed_hz = 1000000
spi.mode = 0

# Transfer 3 bytes, get 3 bytes back (full duplex)
response = spi.xfer2([0x01, 0x02, 0x03])

spi.close()
```

### smbus2 for I²C

```python
from smbus2 import SMBus

with SMBus(1) as bus:
    # Read 2 bytes from register 0x00 on device 0x48
    data = bus.read_i2c_block_data(0x48, 0x00, 2)

    # Write a byte to register 0x01
    bus.write_byte_data(0x48, 0x01, 0x80)
```

Python's overhead adds approximately 50 to 200 µs per GPIO operation on top of the underlying C library latency. For sensor polling, display updates, and general I/O at frequencies below 1 kHz, this overhead is negligible. For anything requiring consistent timing at higher rates, C or C++ with direct libgpiod calls is the better choice.

---

## Kernel GPIO Consumer Framework

From the kernel side, GPIO access follows a different model. Kernel drivers request GPIOs through the `gpiod_*` API (not to be confused with the userspace libgpiod library — same name concept, different codebase):

```c
/* In a kernel driver */
#include <linux/gpio/consumer.h>

struct gpio_desc *reset_gpio;

/* Request a GPIO defined in device tree as "reset-gpios" */
reset_gpio = devm_gpiod_get(&pdev->dev, "reset", GPIOD_OUT_HIGH);
if (IS_ERR(reset_gpio))
    return PTR_ERR(reset_gpio);

/* Use it */
gpiod_set_value(reset_gpio, 0);  /* Assert reset (active low) */
msleep(10);
gpiod_set_value(reset_gpio, 1);  /* Release reset */
```

The device tree for this driver would include:

```dts
my_device {
    compatible = "vendor,my-device";
    reset-gpios = <&gpio0 17 GPIO_ACTIVE_LOW>;
};
```

This approach ties GPIO ownership to the device tree, preventing conflicts between drivers and providing automatic cleanup when the driver is unloaded. Userspace tools like `gpioinfo` show these kernel-claimed lines as "used" with the driver name, which helps during debugging.

---

## Interrupts and Edge Detection

On a bare-metal MCU, a GPIO interrupt fires and the ISR begins executing within a few clock cycles — typically under 1 µs for a Cortex-M at 100 MHz. On Linux, the path from hardware interrupt to application notification is fundamentally different.

### The Interrupt Path on Linux

1. **Hardware interrupt fires** — The GPIO controller asserts an interrupt line to the ARM GIC (Generic Interrupt Controller).
2. **Kernel interrupt handler runs** — The GIC dispatches to the GPIO controller's IRQ handler, which identifies the specific pin, timestamps the event, and queues it.
3. **Threaded IRQ or workqueue** — If a kernel driver registered for this interrupt, its threaded handler runs in process context (schedulable, preemptible).
4. **Userspace notification** — If a userspace application is waiting via libgpiod's event interface, the kernel wakes the process. The process must be scheduled to run before it can read the event.

Total latency from edge to userspace application: **10 to 100 µs** on an unloaded system, potentially **milliseconds** under heavy system load. The kernel timestamp on the event (step 2) is accurate to within a few microseconds, but the application does not receive it until step 4 completes.

### Implications for Real-Time Response

A bare-metal MCU can respond to a button press, encoder edge, or limit switch within microseconds. On Linux, the same response takes at least 10 µs and has no upper bound on worst-case latency without real-time kernel patches (PREEMPT_RT).

For applications where response latency matters (emergency stop switches, high-speed encoder counting, closed-loop motor control), the standard approach is to handle the time-critical response in a kernel driver or offload it to a coprocessor (PRU on BeagleBone, RP2040 as a coprocessor). The Linux application then handles the non-time-critical aspects: logging, display updates, communication.

---

## Tips

- Default to libgpiod for all new GPIO development — sysfs is deprecated, slower, and missing features like bulk operations and edge detection.
- Use `gpioinfo` to discover available GPIO lines and their current configuration before writing any code. Lines claimed by kernel drivers appear as "used" — attempting to request them from userspace will fail with EBUSY.
- For SPI peripherals requiring sustained throughput above 1 MHz, consider using a kernel driver rather than spidev — the per-transaction ioctl overhead becomes a significant fraction of the transfer time.
- Batch SPI transfers using `SPI_IOC_MESSAGE(N)` with multiple transfer descriptors in a single ioctl call. This avoids chip-select deassertion between transfers and reduces system call overhead.
- Device tree overlay errors are silent on many platforms — always verify that an overlay loaded correctly with `dtoverlay -l` (Pi) or by inspecting `/proc/device-tree/`.
- When bit-banging a protocol from userspace, verify timing with an oscilloscope — Linux scheduling can stretch microsecond-level timing unpredictably, and the stretch varies with system load.
- On Raspberry Pi, use `pinctrl get` (replacing the older `raspi-gpio`) to inspect actual pin state including mux configuration. This shows the hardware truth, not just what the software believes.
- Run `i2cdetect -y <bus>` before writing I²C code to confirm the target device acknowledges at the expected address. An empty scan result points to a wiring problem, wrong bus number, or missing device tree overlay.
- For PRU development on BeagleBone, start with the BeagleBoard.org PRU Cookbook examples rather than the TI documentation — the cookbook provides working, tested code for common use cases.
- When using mmap GPIO for speed, still request the pins through libgpiod first (then release them) as a way to verify they are not already claimed by a kernel driver.

---

## Caveats

- **libgpiod latency is too slow for sub-microsecond protocols.** The 5 to 10 µs toggle time makes it impossible to bit-bang protocols like WS2812 (requires 0.4/0.8 µs timings), SWD, or JTAG from userspace GPIO.
- **SPI via spidev adds 50–100 µs of overhead per transaction** due to the ioctl round-trip into kernel space. For small, frequent transfers (reading a sensor register every millisecond), this overhead dominates the actual data transfer time. Batching transfers reduces but does not eliminate it.
- **Device tree overlays that conflict with existing pin assignments cause silent failures or kernel panics.** Enabling SPI on pins that are already assigned to I²C by another overlay does not produce an error message — one or both peripherals simply fail to work.
- **Raspberry Pi GPIO numbering has three incompatible schemes:** physical pin number (board header position), BCM GPIO number, and the legacy wiringPi number. Code, tutorials, and pinout diagrams mix these freely. The standard convention for new code is BCM GPIO numbering, which is what libgpiod and the device tree use.
- **mmap GPIO access has no kernel protection.** Two processes writing to the same GPIO register simultaneously produces undefined behavior. There is no file lock, no mutex, and no error message — one process's writes silently overwrite the other's.
- **The i2c-dev interface holds the bus lock for each complete transaction.** Rapid polling of multiple devices from separate threads or processes can starve slower devices on the same bus, causing NAKs and timeout errors.
- **Python GPIO libraries add 50–200 µs of overhead per call** on top of the underlying C library latency. Code that appears to toggle a pin in a tight loop is actually spending most of its time in Python interpreter overhead, not in GPIO operations.
- **BeagleBone PRU I/O pins are a fixed subset of the header pins** — not all header GPIOs are PRU-accessible. The PRU can access approximately 16 pins directly; attempting to control other pins from the PRU requires going through the slower shared peripheral registers.
- **Hot-plugging I²C or SPI devices on a live bus can cause bus lockup** if a device drives SDA or SCL low during insertion. Power-cycling the bus or the SBC may be the only recovery method.

---

## In Practice

- **A project driving a SPI display from Python via spidev often shows visible tearing or sluggish refresh rates.** This commonly traces to per-frame ioctl overhead — each call to `spi.xfer2()` incurs a 50–100 µs kernel round-trip, and sending a 320×240 framebuffer as many small transfers multiplies this overhead. Moving to a kernel framebuffer driver (`fbtft` or a DRM-based driver) with DMA eliminates the bottleneck and produces smooth, full-speed updates.

- **Attempting to drive WS2812 LEDs from libgpiod on a Raspberry Pi typically produces garbled or flickering colors.** The WS2812 protocol requires 0.4 µs high / 0.85 µs low for a zero bit and 0.8 µs high / 0.45 µs low for a one bit, with no tolerance for jitter beyond ±150 ns. Userspace GPIO toggle latency of 5–10 µs (with occasional 100+ µs spikes) cannot sustain this. The standard solution is to repurpose the SPI or PWM peripheral with DMA — the `rpi_ws281x` library uses PWM+DMA to generate the waveform entirely in hardware, with the CPU only involved in setting up the DMA buffer.

- **Reading an I²C sensor at high frequency (above ~100 Hz) from a Python script sometimes shows missed reads or bus errors.** The symptom appears as sporadic `IOError` exceptions in the script and NAK entries in `dmesg`. The root cause is typically scheduling delays — the script does not service the bus transaction quickly enough, and the I²C bus timeout (25 ms on most controllers) expires. Reducing the polling rate, moving to C, or using the IIO subsystem with hardware-triggered capture addresses the issue.

- **BeagleBone PRU GPIO toggling measured on an oscilloscope shows clean, jitter-free square waves up to 50 MHz.** Running the same toggle test with libgpiod from Linux userspace produces a waveform with visible jitter above 10 kHz — the oscilloscope shows edge-to-edge period varying by 10–50 µs. The contrast illustrates the fundamental difference between a real-time processor and a general-purpose OS.

- **A device tree overlay that enables SPI1 on a Raspberry Pi but forgets to disable the default GPIO function on those pins commonly shows up as SPI transactions returning all zeros or all ones.** Running `gpioinfo` reveals that the pins are still claimed by the `pinctrl-bcm2711` driver in GPIO mode. The fix is either correcting the overlay or using `dtoverlay=spi1-3cs` (which handles pin muxing internally) instead of a manually written overlay.

- **An I²C device that works reliably in isolation but produces intermittent NAKs when a second device is added to the same bus** often traces to address conflict or to bus capacitance exceeding the spec. Running `i2cdetect` shows the new device's address overlapping with the original, or the bus slew rate (visible on an oscilloscope) showing rounded edges that no longer meet the I²C rise-time specification. Adding a bus buffer (PCA9600) or reducing pull-up resistor values (from 10 kΩ to 2.2 kΩ) typically restores reliable operation.

- **A servo motor connected to a Linux software PWM output jitters visibly at rest.** The PWM signal, toggled from a userspace loop with `usleep()` calls, shows period variation of 100 µs to several milliseconds on an oscilloscope. Switching to the hardware PWM subsystem (`/sys/class/pwm/`) eliminates the jitter entirely — the hardware peripheral generates the signal without CPU intervention, producing a stable pulse width regardless of system load.
