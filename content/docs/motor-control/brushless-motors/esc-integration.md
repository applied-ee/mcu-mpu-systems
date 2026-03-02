---
title: "ESC Integration"
weight: 40
---

# ESC Integration

An electronic speed controller (ESC) is a self-contained BLDC driver that handles commutation, current regulation, and protection — reducing the firmware interface to a single control signal. ESCs originated in the RC hobby world but are now used in drones, robots, electric vehicles, and any application where the complexity of building a custom three-phase inverter is not justified. The MCU sends a throttle command; the ESC manages everything else.

## ESC Architecture

A typical ESC contains:

- **Three-phase MOSFET bridge** (6 FETs) rated for the motor's voltage and current
- **Gate drivers** with dead-time insertion
- **Microcontroller** running commutation firmware (usually sensorless six-step or FOC)
- **Current sensing** (shunt or MOSFET RDS(on) sensing)
- **BEC (Battery Elimination Circuit)** — a built-in voltage regulator (usually 5 V) to power the receiver or MCU

## Control Protocols

ESCs accept throttle commands through several protocols, all originating from the RC servo standard and evolving toward lower latency:

### Standard PWM (Servo PWM)

The original protocol. A 1–2 ms pulse at 50–400 Hz:

| Pulse Width | Throttle |
|-------------|----------|
| 1000 µs | 0 % (motor off) |
| 1500 µs | 50 % |
| 2000 µs | 100 % (full throttle) |

```c
/* STM32 — generate 50 Hz servo PWM on TIM3 CH1 */
htim3.Init.Prescaler = 71;         /* 72 MHz / 72 = 1 MHz tick */
htim3.Init.Period = 19999;         /* 20 ms period (50 Hz) */
HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);

/* Set throttle (0–100 %) */
uint16_t pulse_us = 1000 + (throttle_pct * 10);  /* 1000–2000 µs */
__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, pulse_us);
```

### OneShot125

A faster variant where the pulse width is 125–250 µs (8× faster than standard PWM). The frame rate can be up to 4 kHz, reducing latency from 20 ms to ~250 µs.

| Pulse Width | Throttle |
|-------------|----------|
| 125 µs | 0 % |
| 250 µs | 100 % |

### OneShot42

Further reduction: 42–84 µs pulse widths, up to ~12 kHz update rate.

### DShot (Digital Shot)

A fully digital protocol that eliminates analog pulse-width ambiguity. Each frame is a 16-bit packet (11 bits throttle, 1 bit telemetry request, 4-bit CRC) sent as a serial bitstream:

| Variant | Bit Rate | Frame Time | Resolution |
|---------|---------|------------|-----------|
| DShot150 | 150 kbit/s | 106.7 µs | 11-bit (0–2047) |
| DShot300 | 300 kbit/s | 53.3 µs | 11-bit |
| DShot600 | 600 kbit/s | 26.7 µs | 11-bit |
| DShot1200 | 1200 kbit/s | 13.3 µs | 11-bit |

DShot encodes bits by pulse width: a "1" bit has a 75 % duty cycle, a "0" bit has a 37.5 % duty cycle, within each bit period.

```c
/* DShot600 frame generation using DMA + timer */
/* Bit period: 1/600 kHz = 1.67 µs at 600 kbit/s */
/* '1' = 1.25 µs high, 0.42 µs low */
/* '0' = 0.625 µs high, 1.04 µs low */

#define DSHOT_T1H  (timer_period * 3 / 4)  /* 75 % */
#define DSHOT_T0H  (timer_period * 3 / 8)  /* 37.5 % */

void dshot_send(uint16_t throttle, bool telemetry) {
    uint16_t packet = (throttle << 5) | (telemetry << 4);
    packet |= crc4(packet >> 4);

    for (int i = 15; i >= 0; i--) {
        dma_buffer[15 - i] = (packet & (1 << i)) ? DSHOT_T1H : DSHOT_T0H;
    }
    /* Start DMA transfer to timer CCR */
    HAL_TIM_PWM_Start_DMA(&htim_dshot, TIM_CHANNEL_1,
                           (uint32_t *)dma_buffer, 16);
}
```

## ESC Calibration

Most ESCs must be calibrated to map the full throttle range:

1. Power on with throttle at maximum (2000 µs / DShot 2047)
2. ESC beeps to confirm high point
3. Set throttle to minimum (1000 µs / DShot 0)
4. ESC beeps to confirm low point
5. ESC stores the calibration

Without calibration, the ESC may not start until 20–30 % throttle input, or may not reach full speed at 100 %.

## Bidirectional ESCs (3D Mode)

Standard ESCs spin the motor in one direction only. Bidirectional (3D) ESCs map the throttle range symmetrically:

| Throttle Range | Motor |
|---------------|-------|
| 0–47 % (1000–1480 µs) | Reverse, full → zero |
| 48–52 % (1480–1520 µs) | Dead band (motor off) |
| 53–100 % (1520–2000 µs) | Forward, zero → full |

## Telemetry (ESC → MCU)

Many modern ESCs (running BLHeli_32 or AM32 firmware) support bidirectional DShot telemetry, returning RPM data to the flight controller. The ESC sends an eRPM (electrical RPM) packet back on the signal line after each throttle command:

```
Mechanical RPM = eRPM / pole_pairs
```

UART-based telemetry (KISS protocol, BLHeli telemetry) provides additional data: current, voltage, temperature, and RPM over a separate serial link.

## Tips

- Use DShot600 for new designs. It eliminates calibration issues (digital throttle values are absolute), provides CRC error detection, and supports bidirectional telemetry for RPM feedback.
- Keep the signal wire between the MCU and ESC under 30 cm. Longer runs require a ground wire alongside the signal to maintain edge integrity — DShot600 has ~833 ns bit periods that degrade with capacitive loading.
- Arm the ESC by sending minimum throttle (1000 µs or DShot 0) for at least 2 seconds after power-on. Most ESCs will not spin the motor until they see a valid low-throttle signal first.
- For applications requiring braking, select an ESC with active braking or regenerative braking support. Standard ESCs coast to a stop when throttle is reduced.

## Caveats

- Not all ESCs support all protocols. BLHeli_S firmware supports DShot up to 600; BLHeli_32 and AM32 support DShot1200 and bidirectional telemetry. Standard PWM ESCs (older hobby ESCs) often have no DShot support.
- ESC timing advance (typically configurable: low/medium/high) affects efficiency and startup behavior. High timing advance increases high-speed efficiency but can cause stuttering at low throttle.
- The BEC output of an ESC is often a noisy switching regulator. Using it to power sensitive analog circuits (ADCs, sensors) can introduce noise. A separate LDO or filtered supply is preferred for logic power.
- ESC current ratings are often optimistic — specified at 25 °C with direct airflow (propwash). Derate by 30–50 % for enclosed installations without forced cooling.

## In Practice

- **Motor stutters at low throttle instead of spinning smoothly.** The ESC's minimum speed threshold is above the commanded throttle. This commonly appears with high-KV motors on high-timing ESCs — the commutation timing is too aggressive for low-speed operation. Reducing timing advance or switching to an ESC with FOC-based low-speed control resolves the stuttering.

- **Motor spins at different speeds on two "identical" ESCs at the same throttle input.** Calibration offsets differ between the two ESCs. With analog PWM, small variations in the internal reference voltage cause different throttle mappings. Recalibrating both ESCs or switching to DShot (absolute digital values) eliminates the mismatch.

- **ESC does not arm — motor beeps error codes on power-up.** The throttle signal is not at minimum during the arming window. Common causes: the MCU starts with the PWM output in an undefined state, the ESC receives no signal during its 2-second arming timeout, or DShot frames have CRC errors. Ensuring the correct minimum-throttle signal is sent immediately on power-up resolves the arming failure.

- **Reported RPM via DShot telemetry does not match actual RPM.** The telemetry reports electrical RPM, which must be divided by the number of pole pairs to get mechanical RPM. A 14-pole motor (7 pole pairs) showing 70,000 eRPM is actually spinning at 10,000 mechanical RPM.
