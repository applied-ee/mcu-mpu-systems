---
title: "ADC Configuration & Sampling Strategy"
weight: 10
---

# ADC Configuration & Sampling Strategy

The ADC peripheral is the bridge between the analog world and firmware. Configuring it correctly — resolution, sample time, channel sequencing, reference voltage, and data transfer — determines whether the digitized values represent the sensor signal or an artifact of the measurement setup. A 12-bit ADC on an STM32 can theoretically resolve 0.8 mV steps on a 3.3 V range, but only if the input signal has time to settle, the reference is stable, and the conversion results reach memory without CPU bottlenecks.

## Resolution and LSB Size

ADC resolution defines the smallest voltage step the converter can distinguish. The relationship is straightforward:

```
LSB = VREF / 2^N
```

where N is the number of bits.

| Resolution | Levels | LSB at 3.3 V VREF | LSB at 2.5 V VREF |
|------------|--------|--------------------|--------------------|
| 8-bit      | 256    | 12.89 mV           | 9.77 mV            |
| 10-bit     | 1024   | 3.22 mV            | 2.44 mV            |
| 12-bit     | 4096   | 0.806 mV           | 0.610 mV           |
| 14-bit     | 16384  | 0.201 mV           | 0.153 mV           |
| 16-bit     | 65536  | 0.050 mV           | 0.038 mV           |

Higher resolution is not always better. A 12-bit conversion on an STM32F4 completes in 12 ADC clock cycles plus sample time, while a 16-bit conversion on an STM32H7 takes longer and generates more data. If the signal itself has 10 mV of noise riding on it, the extra bits below that noise floor carry no useful information.

## ADC Specifications Across Common MCUs

| Parameter          | STM32F4 (12-bit) | STM32H7 (16-bit) | ESP32 (12-bit) | RP2040 (12-bit) |
|--------------------|-------------------|-------------------|-----------------|-----------------|
| Max resolution     | 12-bit            | 16-bit            | 12-bit          | 12-bit          |
| Max sample rate    | 2.4 MSPS          | 3.6 MSPS          | ~200 kSPS       | 500 kSPS        |
| INL (typ)          | +/-1.5 LSB        | +/-2 LSB          | +/-12 LSB       | +/-1 LSB        |
| DNL (typ)          | +/-1 LSB          | +/-1 LSB          | +/-7 LSB        | +/-0.5 LSB      |
| Input channels     | Up to 19          | Up to 20          | 18 (2 ADCs)     | 4 + temp sensor |
| Internal VREF      | 1.21 V (VREFINT)  | 1.216 V (VREFINT) | 1.1 V (atten.)  | No              |
| VREF source        | VDDA or ext VREF+ | VDDA or ext VREF+ | VDDA            | VDDA (3.3 V)    |
| HW oversampling    | No (F4)           | Yes (up to 1024x) | No              | No              |

The ESP32 ADC is notably nonlinear, especially near the rail voltages. The eFuse calibration values stored during factory test improve accuracy significantly when applied, but the effective number of bits (ENOB) is closer to 9-10 even after calibration. The RP2040 ADC is compact and adequate for simple sensor reads but has no DMA-driven scan mode in the same sense as STM32.

## Sample Time and Input Impedance

The ADC's sample-and-hold capacitor (CSAMPLE, typically 4-8 pF on STM32) must charge to within 0.5 LSB of the input voltage during the sample phase. The charge time depends on the total resistance in the path: the source impedance of the signal conditioning circuit plus any series resistance on the PCB.

The required sample time follows the RC settling equation. For N-bit accuracy:

```
t_sample >= (N + 2) * R_total * C_sample * ln(2)
```

For a 12-bit STM32F4 ADC with 7 pF sample capacitor and a 10 kohm source impedance:

```
t_sample >= 14 * 10e3 * 7e-12 * 0.693
         >= 0.68 us
```

STM32 ADC sample time settings are specified in ADC clock cycles:

| Setting (cycles) | Time at 30 MHz ADCCLK | Max source R (12-bit) |
|-------------------|-----------------------|-----------------------|
| 3                 | 0.1 us                | ~1 kohm               |
| 15                | 0.5 us                | ~5 kohm               |
| 28                | 0.93 us               | ~10 kohm              |
| 56                | 1.87 us               | ~20 kohm              |
| 84                | 2.8 us                | ~30 kohm              |
| 112               | 3.73 us               | ~40 kohm              |
| 144               | 4.8 us                | ~50 kohm              |
| 480               | 16 us                 | ~170 kohm             |

When the source impedance is unknown or variable — as with many resistive sensors — a voltage follower (op-amp buffer) with sub-100 ohm output impedance eliminates the guesswork entirely.

## Reference Voltage Selection

The ADC reference voltage determines the full-scale range. On STM32 devices, VDDA serves as the positive reference (VREF+) unless an external reference pin is available and connected.

**Internal reference (VDDA):** Simplest option. The 3.3 V supply rail serves as VREF. Accuracy is limited by supply regulation — a 3.3 V LDO with 1% tolerance means the full-scale range varies by 33 mV, which is 40 LSB at 12-bit resolution. Any supply noise rides directly onto every conversion.

**External voltage reference:** Dedicated reference ICs like the REF3033 (3.3 V, 0.05% initial accuracy, 3 ppm/C drift) or LM4040 (various voltages, 0.1%) provide a stable, low-noise reference that decouples ADC accuracy from power supply quality. The external VREF pin is available on higher pin-count STM32 packages (LQFP-100 and above, typically).

**VREFINT for self-calibration:** STM32 devices include an internal reference voltage (VREFINT, nominally 1.21 V) connected to an internal ADC channel. By reading VREFINT and comparing against the factory-calibrated value stored in system memory, firmware can calculate the actual VDDA voltage and compensate for supply variations:

```c
/* Read factory calibration value (stored at production) */
uint16_t vrefint_cal = *((uint16_t *)0x1FFF7A2A); /* STM32F4 address */

/* Convert VREFINT ADC reading to actual VDDA */
float vdda_actual = 3.3f * (float)vrefint_cal / (float)adc_vrefint_raw;
```

## Single vs Continuous Conversion

**Single conversion** triggers one conversion per software or hardware trigger. Suitable for low-rate measurements where firmware explicitly decides when to sample — temperature readings, battery voltage checks, or any signal that changes slowly relative to the polling rate.

**Continuous conversion** starts a new conversion immediately after the previous one completes, saturating the ADC at its maximum sample rate. Useful for high-speed signal capture, but generates data continuously — without DMA, the overrun flag sets quickly and data is lost.

**Scan mode** converts multiple channels in sequence per trigger. Combined with DMA, this enables sampling N channels in a round-robin pattern without CPU intervention — the standard approach for systems reading multiple analog sensors.

## DMA Circular Buffer Pattern

The most robust ADC data acquisition pattern on STM32 combines scan mode with DMA in circular mode. The DMA controller writes conversion results directly into a RAM buffer, looping back to the start when the buffer is full. Firmware reads values from the buffer at any time without synchronization overhead.

```c
/* STM32 HAL: ADC + DMA circular buffer for 4 channels */

#define ADC_NUM_CHANNELS  4
#define ADC_BUF_DEPTH     16  /* samples per channel */
#define ADC_BUF_SIZE      (ADC_NUM_CHANNELS * ADC_BUF_DEPTH)

static volatile uint16_t adc_buf[ADC_BUF_SIZE];

/* ADC configuration (generated by CubeMX, key settings shown) */
static void adc_init(void)
{
    ADC_HandleTypeDef hadc1 = {0};
    ADC_ChannelConfTypeDef sConfig = {0};

    hadc1.Instance = ADC1;
    hadc1.Init.ClockPrescaler        = ADC_CLOCK_PCLK_DIV4;
    hadc1.Init.Resolution            = ADC_RESOLUTION_12B;
    hadc1.Init.ScanConvMode          = ENABLE;
    hadc1.Init.ContinuousConvMode    = ENABLE;
    hadc1.Init.DiscontinuousConvMode = DISABLE;
    hadc1.Init.NbrOfConversion       = ADC_NUM_CHANNELS;
    hadc1.Init.DMAContinuousRequests = ENABLE;
    hadc1.Init.EOCSelection          = ADC_EOC_SEQ_CONV;
    HAL_ADC_Init(&hadc1);

    /* Channel 0: thermistor, high impedance — long sample time */
    sConfig.Channel      = ADC_CHANNEL_0;
    sConfig.Rank         = 1;
    sConfig.SamplingTime = ADC_SAMPLETIME_144CYCLES;
    HAL_ADC_ConfigChannel(&hadc1, &sConfig);

    /* Channel 1: buffered pressure sensor — short sample time */
    sConfig.Channel      = ADC_CHANNEL_1;
    sConfig.Rank         = 2;
    sConfig.SamplingTime = ADC_SAMPLETIME_15CYCLES;
    HAL_ADC_ConfigChannel(&hadc1, &sConfig);

    /* Channel 4: current sense amplifier output */
    sConfig.Channel      = ADC_CHANNEL_4;
    sConfig.Rank         = 3;
    sConfig.SamplingTime = ADC_SAMPLETIME_28CYCLES;
    HAL_ADC_ConfigChannel(&hadc1, &sConfig);

    /* Internal VREFINT for supply voltage monitoring */
    sConfig.Channel      = ADC_CHANNEL_VREFINT;
    sConfig.Rank         = 4;
    sConfig.SamplingTime = ADC_SAMPLETIME_480CYCLES;
    HAL_ADC_ConfigChannel(&hadc1, &sConfig);

    /* Start ADC with DMA in circular mode */
    HAL_ADC_Start_DMA(&hadc1, (uint32_t *)adc_buf, ADC_BUF_SIZE);
}

/* Access latest conversion result for a given channel */
static uint16_t adc_read_channel(uint8_t channel_index)
{
    /* In circular mode, the most recent complete sample set
       is at the tail of the buffer. A simple approach: average
       all samples for the channel across the buffer depth. */
    uint32_t sum = 0;
    for (int i = 0; i < ADC_BUF_DEPTH; i++) {
        sum += adc_buf[i * ADC_NUM_CHANNELS + channel_index];
    }
    return (uint16_t)(sum / ADC_BUF_DEPTH);
}
```

The buffer layout in memory with 4 channels and depth of 4 looks like:

```
Index:   [0]  [1]  [2]  [3]  [4]  [5]  [6]  [7]  [8] ...
Channel:  CH0  CH1  CH4  VREF CH0  CH1  CH4  VREF CH0 ...
          |--- sample set 0 ---|--- sample set 1 ---| ...
```

DMA half-transfer and transfer-complete interrupts can signal firmware to process one half of the buffer while DMA fills the other — a double-buffering approach that prevents reading partially-updated data.

## Channel Sequencing Strategy

When scanning multiple channels, the conversion order matters. Channels with high source impedance benefit from being placed after a low-impedance channel, because the internal sample-and-hold capacitor retains charge from the previous conversion. If channel N-1 was at 3.0 V and channel N is a high-impedance source at 0.5 V, the residual charge bleeds into the new sample and pulls the reading upward. This crosstalk effect is worst when adjacent channels in the scan sequence have large voltage differences and high source impedances.

The mitigation is straightforward: assign the longest sample time to high-impedance channels, and where possible, order channels so that adjacent entries in the sequence have similar voltage levels or low source impedance.

## ESP32 ADC Configuration (ESP-IDF)

The ESP32 ADC uses a different programming model. Attenuation settings control the input voltage range rather than a separate VREF:

```c
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

static adc_oneshot_unit_handle_t adc1_handle;
static adc_cali_handle_t adc1_cali_handle;

static void adc_init(void)
{
    /* Initialize ADC unit */
    adc_oneshot_unit_init_cfg_t init_cfg = {
        .unit_id = ADC_UNIT_1,
    };
    adc_oneshot_new_unit(&init_cfg, &adc1_handle);

    /* Configure channel with 11 dB attenuation (0-3.1 V range) */
    adc_oneshot_chan_cfg_t chan_cfg = {
        .atten    = ADC_ATTEN_DB_11,
        .bitwidth = ADC_BITWIDTH_12,
    };
    adc_oneshot_config_channel(adc1_handle, ADC_CHANNEL_6, &chan_cfg);

    /* Apply eFuse calibration for improved linearity */
    adc_cali_curve_fitting_config_t cali_cfg = {
        .unit_id  = ADC_UNIT_1,
        .atten    = ADC_ATTEN_DB_11,
        .bitwidth = ADC_BITWIDTH_12,
    };
    adc_cali_create_scheme_curve_fitting(&cali_cfg, &adc1_cali_handle);
}

static int adc_read_mv(void)
{
    int raw, voltage_mv;
    adc_oneshot_read(adc1_handle, ADC_CHANNEL_6, &raw);
    adc_cali_raw_to_voltage(adc1_cali_handle, raw, &voltage_mv);
    return voltage_mv;
}
```

| ESP32 Attenuation | Input Range   | Best Linearity Range |
|--------------------|--------------|----------------------|
| 0 dB               | 0 – 1.1 V   | 100 – 950 mV        |
| 2.5 dB             | 0 – 1.5 V   | 100 – 1250 mV       |
| 6 dB               | 0 – 2.2 V   | 150 – 1750 mV       |
| 11 dB              | 0 – 3.1 V   | 150 – 2450 mV       |

The "best linearity range" is narrower than the full-scale range. Readings near 0 V and near the rail exhibit significant nonlinearity and should be avoided or compensated with calibration curves.

## Tips

- Start with the longest sample time setting during initial development and reduce it only after confirming the signal chain works — debugging ADC accuracy issues is much harder when insufficient sample time is also in the mix.
- Always include VREFINT in the scan sequence on STM32 — it costs one extra conversion per cycle but enables supply voltage compensation and catches power rail problems early.
- Use DMA circular mode for any application sampling more than one channel or sampling faster than a few hundred hertz — polling with `HAL_ADC_PollForConversion` works for one-off reads but falls apart under load.
- On ESP32, always apply eFuse calibration. The raw 12-bit values without calibration can be off by 100-200 mV, especially at the ends of the attenuation range.
- Set the ADC clock prescaler so that ADCCLK does not exceed the maximum specified in the datasheet (typically 36 MHz for STM32F4) — overclocking the ADC silently degrades accuracy.

## Caveats

- **Insufficient sample time is silent** — The ADC reports a conversion result regardless of whether the sample capacitor fully settled. The reading is simply wrong by an amount that depends on source impedance and the voltage difference from the previous channel. No flag or error is set.
- **DMA overrun loses data without warning on some configurations** — If firmware does not consume data quickly enough and the DMA buffer wraps, old data is silently overwritten. The `OVR` flag in the ADC status register can indicate this, but it must be explicitly checked or its interrupt enabled.
- **ESP32 ADC2 conflicts with Wi-Fi** — ADC2 channels cannot be used while the Wi-Fi driver is active. Only ADC1 channels are safe for concurrent use with wireless.
- **VDDA noise couples into every conversion** — On boards where VDDA is connected directly to the 3.3 V digital supply without filtering, switching noise from the MCU's own core appears as 5-20 mV of noise on every ADC reading. A simple LC filter (ferrite bead + 1 uF ceramic + 100 nF ceramic) on VDDA reduces this dramatically.
- **12-bit resolution does not mean 12-bit accuracy** — INL and DNL errors, reference voltage tolerance, and noise floor all reduce the effective number of bits. A typical STM32F4 achieves 10-11 ENOB under real-world conditions.

## In Practice

**Readings that drift by 10-30 counts with no signal change** often indicate power supply noise coupling through VDDA. Checking the VDDA pin with an oscilloscope (AC-coupled, 20 MHz bandwidth limit) typically reveals switching transients from the MCU's own digital core or nearby DC-DC converters. Adding VDDA filtering or switching to an external reference resolves the drift.

**A channel that consistently reads 50-100 counts higher or lower than expected**, especially when other channels in the scan sequence are at very different voltages, points to crosstalk from insufficient sample time. Increasing the sample time for the affected channel or inserting a dummy conversion between the high-voltage and low-voltage channels reduces the error.

**ESP32 ADC readings that are accurate at mid-range but show large errors near 0 V and 3.3 V** are the expected nonlinearity of the SAR ADC at the attenuation extremes. Applying eFuse calibration corrects much of this, but the best approach is to design the signal conditioning so that the sensor's operating range maps to the middle 20-80% of the ADC input range.

**Sporadic readings of 0 or 4095 (full-scale)** on an otherwise well-behaved channel suggest the input voltage is occasionally exceeding VREF or dropping below ground, likely due to transient events. Input clamping diodes or a series resistor limit the excursion and protect the ADC input.
