---
title: "GPS/GNSS Module Integration"
weight: 10
---

# GPS/GNSS Module Integration

GPS and GNSS modules provide absolute position on the Earth's surface by receiving satellite signals and computing a navigation solution. In embedded systems, the module handles all the RF and DSP work internally — the MCU's job is to configure the module, parse its output, and react to fix data. The u-blox NEO series (NEO-6M, NEO-M8N, NEO-M9N) dominates hobbyist and mid-tier commercial designs due to wide availability, solid documentation, and a consistent UART/I2C interface across generations. Integration involves two main data paths: NMEA sentences for standard position/velocity/time data, and the proprietary UBX binary protocol for configuration and advanced features.

## UART Interface and Electrical Connection

Most GNSS modules expose a UART at 9600 baud by default (the NMEA standard rate), though this can be reconfigured to 115200 baud or higher via UBX commands. The typical wiring is four connections: VCC (3.3V, with some modules tolerating 5V via an onboard regulator), GND, TX (module transmits NMEA/UBX data), and RX (module receives UBX configuration commands). A fifth pin, PPS (pulse per second), provides a precise 1 Hz timing edge synchronized to GPS time.

The TX line from the module streams data continuously once powered. At 9600 baud with the default NMEA sentence set (GGA, GSA, GSV, RMC, VTG), the data throughput reaches roughly 500-600 bytes per second. At higher update rates (5 Hz or 10 Hz), the baud rate must be increased to avoid sentence truncation — 5 Hz output at 9600 baud is insufficient for the full NMEA sentence set.

A common pattern is to connect the module TX to an MCU UART RX with DMA or interrupt-driven reception into a ring buffer. Polling-based reception at 9600 baud is feasible but fragile under heavy MCU load.

## NMEA Sentence Parsing

NMEA 0183 sentences are ASCII lines starting with `$` and ending with `*` followed by a two-character hex checksum and `\r\n`. The three most useful sentence types are:

| Sentence | Purpose | Key Fields |
|----------|---------|------------|
| **GGA** | Fix data | Time, latitude, longitude, fix quality, satellites used, HDOP, altitude |
| **RMC** | Recommended minimum | Time, status (A=valid/V=void), lat, lon, speed over ground, course, date |
| **GSV** | Satellites in view | Total messages, satellite PRN, elevation, azimuth, SNR for each satellite |

GGA provides the richest per-fix data. The fix quality field distinguishes no fix (0), GPS fix (1), DGPS fix (2), and RTK solutions (4=fixed, 5=float). HDOP (Horizontal Dilution of Precision) indicates geometric quality — values below 2.0 represent good geometry, while values above 5.0 indicate poor satellite distribution.

### NMEA GGA Parser in C

```c
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

typedef struct {
    float    latitude;       /* Decimal degrees, negative = South */
    float    longitude;      /* Decimal degrees, negative = West */
    uint8_t  fix_quality;    /* 0=no fix, 1=GPS, 2=DGPS, 4=RTK fixed */
    uint8_t  satellites;     /* Number of satellites used in solution */
    float    hdop;           /* Horizontal dilution of precision */
    float    altitude_m;     /* Altitude above mean sea level in meters */
    uint8_t  hour, min, sec;
    uint8_t  valid;
} gnss_fix_t;

/* Extract field N (0-indexed) from NMEA sentence */
static const char *nmea_field(const char *sentence, int field_num) {
    for (int i = 0; i < field_num; i++) {
        sentence = strchr(sentence, ',');
        if (!sentence) return NULL;
        sentence++;
    }
    return sentence;
}

/* Convert NMEA latitude/longitude (ddmm.mmmm) to decimal degrees */
static float nmea_to_decimal(const char *field, const char *hemisphere) {
    if (!field || *field == ',') return 0.0f;

    float raw = strtof(field, NULL);
    int degrees = (int)(raw / 100);
    float minutes = raw - (degrees * 100);
    float decimal = degrees + (minutes / 60.0f);

    if (*hemisphere == 'S' || *hemisphere == 'W') {
        decimal = -decimal;
    }
    return decimal;
}

/* Verify NMEA checksum: XOR of all bytes between '$' and '*' */
static int nmea_checksum_valid(const char *sentence) {
    if (*sentence == '$') sentence++;
    uint8_t calc = 0;
    while (*sentence && *sentence != '*') {
        calc ^= (uint8_t)*sentence++;
    }
    if (*sentence != '*') return 0;
    uint8_t expected = (uint8_t)strtol(sentence + 1, NULL, 16);
    return (calc == expected);
}

int parse_gga(const char *sentence, gnss_fix_t *fix) {
    if (strncmp(sentence, "$GPGGA", 6) != 0 &&
        strncmp(sentence, "$GNGGA", 6) != 0) {
        return -1;  /* Not a GGA sentence */
    }

    if (!nmea_checksum_valid(sentence)) {
        return -2;  /* Checksum failure */
    }

    const char *f;

    /* Field 1: UTC time (hhmmss.ss) */
    f = nmea_field(sentence, 1);
    if (f && *f != ',') {
        fix->hour = (f[0] - '0') * 10 + (f[1] - '0');
        fix->min  = (f[2] - '0') * 10 + (f[3] - '0');
        fix->sec  = (f[4] - '0') * 10 + (f[5] - '0');
    }

    /* Fields 2-3: Latitude + N/S */
    f = nmea_field(sentence, 2);
    const char *h = nmea_field(sentence, 3);
    fix->latitude = nmea_to_decimal(f, h);

    /* Fields 4-5: Longitude + E/W */
    f = nmea_field(sentence, 4);
    h = nmea_field(sentence, 5);
    fix->longitude = nmea_to_decimal(f, h);

    /* Field 6: Fix quality */
    f = nmea_field(sentence, 6);
    fix->fix_quality = f ? atoi(f) : 0;

    /* Field 7: Satellites used */
    f = nmea_field(sentence, 7);
    fix->satellites = f ? atoi(f) : 0;

    /* Field 8: HDOP */
    f = nmea_field(sentence, 8);
    fix->hdop = f ? strtof(f, NULL) : 99.9f;

    /* Field 9: Altitude (meters) */
    f = nmea_field(sentence, 9);
    fix->altitude_m = f ? strtof(f, NULL) : 0.0f;

    fix->valid = (fix->fix_quality > 0);
    return 0;
}
```

The parser handles both `$GPGGA` (GPS-only) and `$GNGGA` (multi-constellation) talker IDs. Multi-constellation modules like the NEO-M8N and NEO-M9N emit `$GN` prefixes when using GPS + GLONASS or GPS + Galileo + BeiDou simultaneously.

## UBX Binary Protocol

The UBX protocol uses a binary framing format: two sync bytes (`0xB5 0x62`), a message class, message ID, 16-bit payload length (little-endian), the payload, and a two-byte Fletcher checksum. UBX is used to configure the module — setting update rate, enabling/disabling NMEA sentences, entering power save modes, and querying module status.

### Setting Update Rate via UBX

The UBX-CFG-RATE message (class 0x06, ID 0x08) sets the measurement and navigation rate:

```c
/* UBX-CFG-RATE: Set measurement rate to 5 Hz (200 ms period) */
static void ubx_set_rate_5hz(UART_HandleTypeDef *huart) {
    uint8_t msg[] = {
        0xB5, 0x62,       /* Sync chars */
        0x06, 0x08,       /* Class: CFG, ID: RATE */
        0x06, 0x00,       /* Payload length: 6 bytes */
        0xC8, 0x00,       /* measRate: 200 ms (little-endian) */
        0x01, 0x00,       /* navRate: 1 (every measurement) */
        0x01, 0x00,       /* timeRef: 1 = GPS time */
        0x00, 0x00        /* Checksum placeholder */
    };

    /* Calculate Fletcher checksum over class, ID, length, payload */
    uint8_t ck_a = 0, ck_b = 0;
    for (int i = 2; i < sizeof(msg) - 2; i++) {
        ck_a += msg[i];
        ck_b += ck_a;
    }
    msg[sizeof(msg) - 2] = ck_a;
    msg[sizeof(msg) - 1] = ck_b;

    HAL_UART_Transmit(huart, msg, sizeof(msg), 100);
}
```

After sending a UBX-CFG command, the module responds with UBX-ACK-ACK (class 0x05, ID 0x01) on success or UBX-ACK-NAK (class 0x05, ID 0x00) on failure. Robust firmware waits for the ACK with a timeout rather than assuming success.

## PPS (Pulse Per Second) Timing

The PPS output provides a rising edge synchronized to the GPS second boundary, with accuracy on the order of 10-30 ns once the module has a stable fix. This pulse is invaluable for calibrating the MCU's local oscillator, timestamping events with GPS-grade accuracy, or disciplining an RTOS tick.

### PPS Capture with Timer Input Capture

```c
/* Capture PPS rising edge on TIM2 Channel 1 (PA0 on STM32F4) */
TIM_HandleTypeDef htim2;
volatile uint32_t pps_capture = 0;
volatile uint32_t pps_period  = 0;

void pps_timer_init(void) {
    __HAL_RCC_TIM2_CLK_ENABLE();

    htim2.Instance = TIM2;
    htim2.Init.Prescaler = 0;            /* Full 84 MHz resolution */
    htim2.Init.CounterMode = TIM_COUNTERMODE_UP;
    htim2.Init.Period = 0xFFFFFFFF;       /* 32-bit free-running */
    htim2.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
    HAL_TIM_IC_Init(&htim2);

    TIM_IC_InitTypeDef ic_config = {0};
    ic_config.ICPolarity  = TIM_ICPOLARITY_RISING;
    ic_config.ICSelection = TIM_ICSELECTION_DIRECTTI;
    ic_config.ICPrescaler = TIM_ICPSC_DIV1;
    ic_config.ICFilter    = 0x0;
    HAL_TIM_IC_ConfigChannel(&htim2, &ic_config, TIM_CHANNEL_1);

    HAL_TIM_IC_Start_IT(&htim2, TIM_CHANNEL_1);
}

void HAL_TIM_IC_CaptureCallback(TIM_HandleTypeDef *htim) {
    if (htim->Instance == TIM2 && htim->Channel == HAL_TIM_ACTIVE_CHANNEL_1) {
        uint32_t new_capture = HAL_TIM_ReadCapturedValue(htim, TIM_CHANNEL_1);
        pps_period  = new_capture - pps_capture;
        pps_capture = new_capture;
        /* pps_period should be ~84000000 for 84 MHz timer clock */
        /* Deviation from this indicates local oscillator drift */
    }
}
```

The measured period between PPS edges, divided by the expected timer clock frequency, reveals the actual oscillator frequency. A period of 84,000,150 counts at a nominal 84 MHz indicates the oscillator is running ~1.8 ppm fast.

## Cold, Warm, and Hot Start

| Start Type | Condition | Typical TTFF |
|-----------|-----------|--------------|
| **Cold start** | No almanac, no ephemeris, no time/position estimate | 25-35 seconds |
| **Warm start** | Valid almanac, approximate time/position, no ephemeris | 25-30 seconds |
| **Hot start** | Valid ephemeris, recent time/position (module was off < 2 hours) | 1-2 seconds |

The hot start time is why backup battery connections on GNSS modules (VBAT pin) matter — the battery keeps the RTC and ephemeris data alive in the module's SRAM during power-off, enabling sub-2-second fixes on power-on. Without a backup battery, every power cycle is a cold start.

## u-blox Module Comparison

| Feature | NEO-6M | NEO-M8N | NEO-M9N |
|---------|--------|---------|---------|
| Constellations | GPS only | GPS + GLONASS + BeiDou + Galileo | GPS + GLONASS + BeiDou + Galileo |
| Max channels | 50 | 72 | 92 |
| Position accuracy | 2.5 m CEP | 2.5 m CEP | 1.5 m CEP |
| Max update rate | 5 Hz | 10 Hz (single), 5 Hz (multi) | 25 Hz |
| Cold start TTFF | 27 s | 26 s | 24 s |
| Hot start TTFF | 1 s | 1 s | 2 s |
| Power (continuous) | 45 mA | 25 mA | 22 mA |
| Backup supply | Yes (VBAT) | Yes (V_BCKP) | Yes (V_BCKP) |
| Protocol | UBX 7, NMEA | UBX 8, NMEA | UBX 9, NMEA |
| Approx. price | $3-5 | $8-12 | $18-25 |

The NEO-M9N's 25 Hz output rate and 1.5 m accuracy make it suitable for drone and robotics applications where position updates at walking speed (1 Hz) are insufficient. The NEO-6M remains adequate for asset tracking and basic geofencing where cost dominates.

## Low-Power Modes

u-blox modules support Power Save Mode (PSM), which cycles between tracking and sleep states. In PSM, the module acquires a fix, enters a low-power state for a configurable interval (1-300 seconds), then wakes to update the fix. Current consumption drops from 22-45 mA continuous to an average of 5-10 mA depending on the duty cycle.

Backup mode is even more aggressive — the module shuts down everything except the VBAT-powered RTC and SRAM, drawing under 15 µA. Waking from backup mode triggers a hot start if the sleep duration was under 2 hours.

Configuration of PSM uses UBX-CFG-PM2 (class 0x06, ID 0x3B) with fields for update period, search period, and on/off mode selection. The on/off mode is simplest: the module fully powers on, gets a fix, then fully powers off for the specified interval.

## Antenna Considerations

| Antenna Type | Gain | Size | Use Case |
|-------------|------|------|----------|
| Chip antenna | -3 to 0 dBi | 5x5 mm | Ultra-compact, clear sky only |
| Passive patch | 2-4 dBi | 25x25 mm | General purpose, ground plane needed |
| Active patch | 15-25 dB (with LNA) | 25x25 mm | Best sensitivity, needs DC bias on RF line |

Active antennas contain a built-in LNA (Low Noise Amplifier) and require DC power on the antenna cable, typically 3.3V fed through the RF connector via an inductor. Most u-blox modules support active antenna detection and can supply this bias voltage directly from an antenna pin. The module can also detect antenna short circuits and open circuits, reporting the status via UBX-MON-HW.

Chip antennas work in open-sky conditions but suffer heavily near buildings, under tree canopy, or inside enclosures with metallic surfaces. For any application where fix reliability matters, a passive or active patch antenna on a ground plane is the minimum viable approach.

## Tips

- Always connect a backup battery to the GNSS module's VBAT pin — the difference between a 1-second hot start and a 27-second cold start dramatically affects the usability of any GPS-enabled device
- Increase the baud rate to 115200 before raising the update rate above 1 Hz — at 9600 baud, there is insufficient bandwidth to transmit the full NMEA sentence set at 5 Hz, causing sentence truncation
- Disable unused NMEA sentences (GSV, GSA, VTG) via UBX-CFG-MSG to reduce bus traffic and parsing overhead — most applications only need GGA and RMC
- Use DMA-based UART reception with a ring buffer and line-detection parsing — the continuous data stream from GNSS modules makes polling-based reception unreliable under any MCU load
- Place the GNSS antenna as far as possible from switching regulators and high-speed digital traces — GPS signals arrive at approximately -130 dBm, making them extremely vulnerable to broadband noise

## Caveats

- **First fix requires open sky** — A GNSS module will never acquire a fix indoors, in a garage, or under dense metal roofing. Testing must occur outdoors or near a window with substantial sky visibility
- **NMEA sentence arrival is not instantaneous** — At 9600 baud, a full GGA sentence takes roughly 10 ms to transmit; the position data within it was computed up to one update period earlier. For 1 Hz updates, the data can be up to 1 second old when fully received
- **Multi-constellation mode reduces max update rate** — On the NEO-M8N, enabling GPS + GLONASS + Galileo simultaneously limits the update rate to 5 Hz; single-constellation mode allows 10 Hz
- **UBX configuration is not persistent by default** — Configuration written via UBX-CFG commands is lost on power cycle unless explicitly saved to flash using UBX-CFG-CFG. Forgetting this step means re-sending the entire configuration on every boot
- **HDOP is not accuracy** — An HDOP of 1.0 does not mean 1-meter accuracy. HDOP is a dimensionless multiplier applied to the base accuracy of the system. With a base UERE (User Equivalent Range Error) of ~6 m, an HDOP of 1.0 corresponds to ~6 m horizontal accuracy

## In Practice

- A module that reports fix quality 0 indefinitely despite being outdoors typically has an antenna problem — either a chip antenna with no ground plane, an active antenna without DC bias, or an RF connector with a cold solder joint
- Observing the satellite count in the GGA sentence climb from 0 to 4 (minimum for 3D fix) over 20-30 seconds during cold start is normal behavior — fix quality jumps from 0 to 1 the moment the fourth satellite is acquired
- A PPS signal that is present but irregularly spaced (varying by more than 100 ns) indicates the module does not have a stable fix — the PPS output is only GPS-synchronized once the navigation solution converges
- NMEA parsing bugs most often manifest as latitude/longitude values that are offset by a factor related to the degrees-minutes-to-decimal-degrees conversion — a raw NMEA value of 4807.038 (48 degrees, 7.038 minutes) equals 48.1173 degrees, not 4807.038 degrees
- Modules running at 5 Hz or 10 Hz on a 9600 baud UART produce truncated or garbled sentences — the symptom is checksums failing on every other sentence, or sentences running together without proper `\r\n` termination
