---
title: "Timing & Frame Rate"
weight: 30
---

# Timing & Frame Rate

LED animation is a real-time rendering problem. Each frame must be computed and transmitted within a fixed time budget to maintain smooth motion. The frame rate depends on three factors: how long the animation computation takes, how long the strip transmission takes, and how much time is left for other firmware tasks. Getting the timing architecture wrong leads to either dropped frames (jerky animation) or starved peripherals (missed sensor reads, unresponsive inputs).

## Frame Time Budget

At 60fps, the total time budget per frame is 16.7ms. That budget must cover:

1. **Animation computation**: Updating all pixel values in the framebuffer. For a simple palette cycle on 300 LEDs, this might take 0.5–2ms. For composited multi-layer effects, 3–8ms.
2. **Strip transmission**: Serializing the framebuffer to the LED protocol. For 300 WS2812B LEDs: ~9ms. For 300 APA102 at 8MHz SPI: ~1.5ms.
3. **Other tasks**: Sensor reading, input handling, communication, housekeeping.

For WS2812B strips, the transmission alone consumes over half the 60fps budget at 300 LEDs. With 600 LEDs, transmission takes ~18ms — making 60fps physically impossible without reducing LED count. APA102 strips, with their faster SPI transmission, leave more time for computation and other tasks.

## Decoupling Computation from Transmission

The key architectural pattern is to separate "compute the next frame" from "send the current frame to the strip." On platforms with DMA (STM32, ESP32, RP2040), the transmission runs in the background via DMA while the CPU computes the next frame in parallel. This effectively removes transmission time from the CPU budget:

```
Frame N:  [Compute N+1] [DMA sends N] [idle or other tasks]
Frame N+1:[Compute N+2] [DMA sends N+1] [idle or other tasks]
```

With this pipeline, the frame rate bottleneck is `max(computation_time, transmission_time)` rather than `computation_time + transmission_time`. Double buffering is required to prevent the CPU from writing to the buffer that DMA is currently reading.

## Fixed vs Variable Time Steps

Animations that increment state by a fixed amount per frame (e.g., `offset++` each frame) run faster or slower depending on the actual frame rate. If the frame rate drops due to computation load, the animation slows down visibly. Fixed time-step animation ties the speed to frame rate, which is simple but fragile.

Delta-time animation scales each update by the elapsed time since the last frame:

```c
uint32_t now = millis();
uint32_t dt = now - last_frame_time;
last_frame_time = now;

offset += speed * dt; // Speed in units per millisecond
```

This produces consistent animation speed regardless of frame rate variations. The visual smoothness still depends on frame rate (lower fps = choppier motion), but the speed of the animation remains constant. Delta-time is the standard approach for any animation that needs to maintain consistent timing.

## Timer-Driven vs Free-Running Loops

A free-running animation loop computes and sends frames as fast as possible, with no frame rate control. This maximizes frame rate but makes the animation speed dependent on computation complexity (which may vary frame-to-frame) and wastes power on platforms where idle time could be spent in a low-power sleep state.

Timer-driven rendering uses a hardware timer interrupt or a software timer to trigger frame computation at a fixed interval:

```c
// In timer ISR or RTOS task:
if (millis() - last_frame >= FRAME_INTERVAL) {
    last_frame += FRAME_INTERVAL;
    compute_frame();
    send_to_strip();
}
```

Fixed-interval rendering provides predictable timing, consistent animation speed, and defined idle periods for other tasks. The frame interval must be longer than the worst-case computation + transmission time to avoid frame drops.

## Tips

- Target 30–60fps for most LED animations — above 60fps the visual improvement is negligible for LED applications, and the extra CPU time is better spent on other tasks
- Use DMA for strip transmission on platforms that support it (STM32, ESP32, RP2040) — the CPU cycles saved are substantial, especially for WS2812B's slow protocol
- Use delta-time for animation speed calculations to decouple visual speed from frame rate — this prevents animations from speeding up or slowing down when the computational load changes
- Profile the actual frame time early in development — add a GPIO toggle at frame start/end and measure with an oscilloscope or logic analyzer to identify the real bottleneck

## Caveats

- **WS2812B transmission time is a hard limit on frame rate** — At 30µs per LED (24 bits × 1.25µs), 500 LEDs take 15ms just for transmission. No amount of CPU optimization can make the strip accept data faster. APA102's variable clock speed avoids this ceiling
- **millis() resolution limits timing precision** — On Arduino, `millis()` has 1ms resolution. For frame intervals below ~5ms (200fps), use `micros()` or a hardware timer for accurate timing
- **Blocking transmission stalls everything** — Libraries that block during WS2812B transmission (e.g., Adafruit NeoPixel's `show()`) halt all other code for the duration. On an RTOS, this blocks the calling task. Using DMA or interrupt-driven transmission is essential for responsive multi-task firmware
- **Frame rate jitter is more visible than low frame rate** — A consistent 30fps looks smoother than a 60fps animation that occasionally drops to 20fps. Stable, predictable timing matters more than raw speed

## In Practice

- An animation that appears smooth on a short strip but jerky on a longer strip is hitting the transmission time limit — the added LEDs pushed the total frame time past the target frame interval
- An animation that runs at the expected speed on one MCU but faster or slower on another is using fixed-increment timing instead of delta-time — the different CPU speeds produce different frame rates, which change the animation speed
- A strip that shows a brief flash or partial update at the start of each frame may have a single-buffer architecture where the computation is modifying the buffer during DMA transmission — double buffering eliminates the artifact
- A firmware that becomes unresponsive to button presses or serial commands during LED animation is likely using a blocking strip transmission — the CPU is locked for the entire transmission duration, unable to service other inputs
