---
title: "Cameras & Image Capture"
weight: 50
---

# Cameras & Image Capture

Camera modules are optical sensors operating at far higher data rates than photodiodes or color sensors — a single 320×240 RGB565 frame is 150 KB, and a 640×480 frame reaches 600 KB. This shifts the engineering challenge from analog front-end design to high-speed digital interfaces, memory management, and image compression. The underlying sensor is a CMOS image array (typically with a Bayer color filter), but the firmware and hardware surrounding it look nothing like a simple I²C light sensor.

## CMOS Image Sensor Fundamentals

Modern camera modules use CMOS active-pixel sensors where each photosite includes its own amplifier and readout circuitry. A Bayer color filter array overlays the pixel grid — alternating red, green, and blue filters in a 2×2 pattern (two green, one red, one blue) that a demosaicing algorithm interpolates into full-color pixels. The two dominant shutter mechanisms affect motion capture:

- **Rolling shutter** — Each row of pixels is exposed sequentially, top to bottom. Fast-moving objects or vibration produce skew, wobble, and partial-exposure artifacts. Rolling shutter is standard on low-cost modules (OV2640, OV7670, OV5640) because it requires less silicon.
- **Global shutter** — All pixels are exposed simultaneously, then read out. Eliminates motion artifacts but requires per-pixel storage capacitors, increasing die area and cost. Found on industrial and machine-vision sensors (e.g., OV9281, MT9V034).

## Common Modules

| Module | Resolution | Interface | JPEG HW | Typical Use |
|--------|-----------|-----------|---------|-------------|
| OV7670 | 640×480 (VGA) | Parallel DVP (8-bit) | No | Learning, basic vision |
| OV2640 | 1600×1200 (2MP) | Parallel DVP (8-bit) | Yes | IoT stills, ESP32-CAM |
| OV5640 | 2592×1944 (5MP) | Parallel DVP / MIPI CSI-2 | Yes | Higher-res stills, MPU boards |
| ArduCAM Mini | 2MP/5MP | SPI | Yes | MCU-friendly, low pin count |

## Interface Options

### Parallel DVP (Digital Video Port)

The most common interface for MCU-class camera capture. An 8-bit (or 10/12-bit) parallel data bus clocks pixel data out on every rising edge of PCLK, synchronized by VSYNC (frame start) and HREF/HSYNC (line valid). A typical connection requires 8 data lines + PCLK + VSYNC + HREF — 11 GPIOs minimum, plus XCLK (master clock output to the sensor), SDA, and SCL for configuration.

On STM32 devices, the DCMI (Digital Camera Interface) peripheral handles parallel capture in hardware. DCMI latches pixel data from the parallel bus, packs bytes into 32-bit words, and feeds them to memory through DMA — firmware only needs to configure the peripheral and process complete frames.

```c
/* DCMI configuration for OV2640 on STM32F4 — QVGA RGB565 */

#include "stm32f4xx_hal.h"

static DCMI_HandleTypeDef hdcmi;
static DMA_HandleTypeDef hdma_dcmi;

/* Framebuffer in SRAM — 320×240 RGB565 = 153,600 bytes */
/* Place in a region with enough contiguous RAM */
__attribute__((section(".dma_buffer")))
static uint16_t framebuffer[320 * 240];

void dcmi_init(void)
{
    hdcmi.Instance = DCMI;
    hdcmi.Init.SynchroMode   = DCMI_SYNCHRO_HARDWARE;
    hdcmi.Init.PCKPolarity    = DCMI_PCKPOLARITY_RISING;
    hdcmi.Init.VSPolarity     = DCMI_VSPOLARITY_LOW;
    hdcmi.Init.HSPolarity     = DCMI_HSPOLARITY_LOW;
    hdcmi.Init.CaptureRate    = DCMI_CR_ALL_FRAME;
    hdcmi.Init.ExtendedDataMode = DCMI_EXTEND_DATA_8B;
    hdcmi.Init.JPEGMode       = DCMI_JPEG_DISABLE;
    HAL_DCMI_Init(&hdcmi);
}

void dcmi_capture_frame(void)
{
    /* Snapshot mode: capture exactly one frame, then stop */
    HAL_DCMI_Start_DMA(&hdcmi, DCMI_MODE_SNAPSHOT,
                       (uint32_t)framebuffer,
                       (320 * 240 * 2) / 4);  /* Length in 32-bit words */
}

void HAL_DCMI_FrameEventCallback(DCMI_HandleTypeDef *hdcmi)
{
    /* Frame complete — framebuffer now contains one QVGA RGB565 image */
    HAL_DCMI_Stop(hdcmi);
    /* Process or transmit the frame */
}
```

### SPI Camera Modules (ArduCAM)

SPI camera modules like ArduCAM integrate a FIFO buffer between the image sensor and the SPI interface. The sensor captures a frame into an onboard SRAM buffer, then firmware reads it out over SPI at whatever pace the MCU can sustain. This decouples the high-speed pixel clock from the MCU's read rate, requiring only 4 SPI pins + 2 I²C pins instead of 11+ parallel GPIOs.

The tradeoff is frame rate — reading a full VGA JPEG frame (typically 20–50 KB compressed) over SPI at 8 MHz takes 20–50 ms for the transfer alone, limiting throughput to roughly 10–15 fps for compressed stills.

### MIPI CSI-2

For MPU-class devices (Raspberry Pi, i.MX, Allwinner), MIPI CSI-2 is the standard camera interface. It uses differential signaling (1–4 data lanes) at speeds up to several Gbps, supporting high resolution and frame rates that parallel DVP cannot match. CSI-2 is not practical for bare-metal MCU projects — it requires a PHY, complex timing calibration, and typically a Linux camera stack (V4L2, libcamera) to manage.

## Sensor Configuration via SCCB/I²C

All OmniVision sensors use SCCB (Serial Camera Control Bus) for register configuration — electrically identical to I²C but with subtle protocol differences. SCCB uses 8-bit register addresses (the OV5640 extends this with a 16-bit address space), and the sensor responds at a fixed address (typically 0x30 for OV2640, 0x21 for OV7670).

Configuration involves writing dozens to hundreds of register values to set resolution, pixel format, white balance, exposure, and compression parameters. Most implementations use a table-driven approach:

```c
typedef struct {
    uint8_t reg;
    uint8_t val;
} sensor_reg_t;

/* OV2640 QVGA JPEG output configuration (excerpt) */
static const sensor_reg_t ov2640_qvga_jpeg[] = {
    {0xFF, 0x01},  /* Select sensor register bank */
    {0x12, 0x40},  /* JPEG mode */
    {0x17, 0x11},  /* HSTART */
    {0x18, 0x75},  /* HSTOP */
    {0x32, 0x36},  /* HREF */
    {0x19, 0x01},  /* VSTART */
    {0x1A, 0x97},  /* VSTOP */
    {0x03, 0x0F},  /* VREF */
    {0x37, 0x40},
    {0x4F, 0xBB},
    {0x50, 0x9C},
    {0xFF, 0x00},  /* Select DSP register bank */
    {0xE0, 0x04},  /* Reset DVP */
    {0xC0, 0xC8},  /* Image size */
    {0xC1, 0x96},
    {0x86, 0x3D},
    {0x50, 0x89},  /* Downscale */
    {0x51, 0x90},
    {0x52, 0x2C},
    {0x53, 0x00},
    {0x54, 0x00},
    {0x55, 0x88},
    {0x57, 0x00},
    {0x5A, 0x40},  /* Output width: 320 */
    {0x5B, 0xF0},  /* Output height: 240 */
    {0x5C, 0x01},
    {0xD3, 0x04},
    {0xE0, 0x00},  /* Release DVP reset */
    {0x00, 0x00},  /* End marker */
};

void ov2640_write_regs(I2C_HandleTypeDef *hi2c, const sensor_reg_t *regs)
{
    while (regs->reg != 0x00 || regs->val != 0x00) {
        uint8_t buf[2] = { regs->reg, regs->val };
        HAL_I2C_Master_Transmit(hi2c, 0x30 << 1, buf, 2, 100);
        regs++;
        HAL_Delay(1);  /* Some registers need settling time */
    }
}
```

## Memory Constraints and Compression

Framebuffer sizing is the primary constraint for MCU-based camera capture:

| Resolution | Format | Frame Size | Fits in Cortex-M SRAM? |
|-----------|--------|-----------|------------------------|
| 160×120 (QQVGA) | RGB565 | 37.5 KB | Most Cortex-M4 |
| 320×240 (QVGA) | RGB565 | 150 KB | STM32F4/F7 (192–512 KB SRAM) |
| 640×480 (VGA) | RGB565 | 600 KB | Only with external SRAM/SDRAM |
| 320×240 (QVGA) | JPEG | 10–30 KB | Most Cortex-M4 |
| 640×480 (VGA) | JPEG | 20–60 KB | Most Cortex-M4 |

Hardware JPEG compression in the OV2640 reduces a QVGA frame from 150 KB to 10–30 KB, bringing it within reach of MCUs with modest SRAM. The sensor performs compression internally and outputs a variable-length JPEG stream over the parallel interface. Firmware must detect the JPEG end-of-image marker (0xFF 0xD9) since the output length varies per frame.

Software JPEG encoding on a Cortex-M4 at 168 MHz takes 200–500 ms per QVGA frame — practical only for infrequent snapshot applications, not continuous capture.

## MCU vs MPU Boundary

Bare-metal MCU camera capture is practical for:

- **Low-resolution snapshots** — QVGA or smaller, JPEG-compressed, captured periodically for upload (IoT environmental monitoring, wildlife cameras)
- **Simple image processing** — Thresholding, edge detection, or barcode/QR code decoding on small frames
- **Motion detection** — Frame differencing at QQVGA resolution to trigger events

An MPU with Linux becomes necessary when the application requires:

- **Video streaming** — Continuous capture above 5–10 fps at VGA or higher
- **Complex image processing** — OpenCV, neural network inference, multi-stage pipelines
- **Standard camera APIs** — V4L2, libcamera, GStreamer for interoperability with existing software
- **High resolution** — Anything above VGA uncompressed, or multi-megapixel stills at interactive rates
- **MIPI CSI-2 interface** — Requires a PHY and driver stack that only MPU SoCs provide

The ESP32-CAM module sits at the boundary — it pairs an ESP32 (dual-core 240 MHz, 520 KB SRAM + 4 MB PSRAM) with an OV2640 and provides WiFi streaming at QVGA/SVGA resolution. The external PSRAM is what makes this possible; without it, even the ESP32's relatively generous SRAM could not hold a full VGA framebuffer.

## Tips

- Provide a clean, stable XCLK to the camera module — the sensor's internal PLL multiplies this clock to generate PCLK, so jitter or frequency drift on XCLK propagates into pixel timing; a dedicated timer output (e.g., TIM1 PWM at 24 MHz) is more reliable than a software-toggled GPIO
- Place the DCMI DMA on a high-priority stream and use double-buffering when continuous capture is needed — DMA transfers one frame to buffer A while firmware processes buffer B, preventing torn frames
- Start with JPEG output mode on the OV2640 rather than raw RGB — the compressed output fits in smaller buffers, simplifies DMA configuration, and avoids the need for external SRAM; switch to raw only when pixel-level processing is required
- Keep SCCB/I²C writes slow and insert delays between register writes — some OmniVision sensors need 1–3 ms settling time after certain register changes (especially bank-select and reset registers), and burst-writing the full configuration table without delays causes silent misconfiguration
- For snapshot applications, use DCMI in snapshot mode rather than continuous mode — snapshot mode captures exactly one frame and stops DMA automatically, avoiding the complexity of circular buffers and frame-boundary detection

## Caveats

- **SCCB is not fully I²C-compliant** — SCCB does not use ACK/NACK in the same way as I²C; some sensors drive SDA during the ACK phase regardless of bus state, which can confuse I²C peripherals that check for ACK; configuring the I²C peripheral to ignore NACK errors (or using GPIO bit-banging) is sometimes necessary
- **OV7670 has no hardware JPEG compression** — Every frame must be transferred as raw pixel data; at VGA RGB565 (600 KB per frame), this exceeds the SRAM of most Cortex-M devices and effectively limits the OV7670 to QVGA or smaller on MCUs without external memory
- **Clock configuration mismatches cause subtle failures** — If XCLK is too fast or too slow for the sensor's PLL lock range, the module may partially initialize (SCCB responds, registers read back correctly) but produce no valid pixel output or output at the wrong resolution
- **Parallel DVP requires precise GPIO timing** — On STM32 devices without a DCMI peripheral, bit-banging the parallel interface in software is impractical above QQVGA; the pixel clock runs at 12–48 MHz, far beyond GPIO polling speed
- **JPEG output length is variable and unpredictable** — The DMA transfer size must be set to the maximum possible JPEG size, and firmware must scan the received data for the end-of-image marker (0xFF 0xD9) to determine the actual frame length; failing to do this results in stale data from the previous frame appended to the current one

## In Practice

- A DCMI capture that produces an image with correct dimensions but vertically shifted content (top rows appearing at the bottom) typically indicates a VSYNC polarity mismatch — toggling the VSPolarity setting in the DCMI configuration corrects the frame alignment
- Garbled or color-shifted images where the resolution is correct but the pixel data looks scrambled often trace back to a pixel format mismatch — the sensor is configured for YUV422 but the framebuffer is interpreted as RGB565, or the byte order is swapped; checking the sensor's format register and the DCMI byte-select configuration resolves this
- An OV2640 in JPEG mode that produces valid images for the first few captures but then returns corrupted or zero-length frames commonly indicates that the DMA transfer was not properly restarted between captures — each snapshot-mode capture requires re-calling `HAL_DCMI_Start_DMA` after the previous transfer completes
- Intermittent horizontal lines or banding in captured images that appear only under artificial lighting are typically caused by the sensor's exposure time interacting with the flicker frequency of the light source — setting the sensor's banding filter registers to match the local mains frequency (50 Hz or 60 Hz) eliminates the artifact
- An ESP32-CAM that captures a few frames successfully then crashes or produces heap allocation failures is running out of PSRAM or has PSRAM access conflicts — enabling PSRAM in the build configuration and ensuring the framebuffer allocation uses `ps_malloc()` rather than standard `malloc()` addresses this
