---
title: "Oversampling & Noise Reduction"
weight: 30
---

# Oversampling & Noise Reduction

A 12-bit ADC does not always deliver 12 bits of useful information. Noise — from the power supply, the analog front end, the ADC's own quantization process, and thermal agitation in resistors — fills the least significant bits with random variation. Oversampling and averaging are firmware techniques that trade sample rate for effective resolution, pushing the noise floor down and extracting meaningful information from those lower bits. But oversampling is not magic: it only works when the noise has the right statistical properties, and it cannot fix systematic errors like offset drift or nonlinearity.

## Noise Sources in ADC Measurements

Understanding where noise enters the signal chain determines which techniques are effective against it.

| Noise Source         | Origin                                         | Character        | Typical Magnitude (12-bit, 3.3 V) |
|----------------------|------------------------------------------------|------------------|------------------------------------|
| Quantization noise   | ADC digitization (inherent)                    | Uniform, white   | 0.5 LSB RMS = 0.40 mV             |
| Thermal noise        | Resistors in signal path                       | Gaussian, white  | 1–10 uV RMS per kohm (1 kHz BW)   |
| Power supply noise   | VDDA ripple from switching regulators          | Periodic spikes  | 5–50 mV peak on unfiltered VDDA   |
| ADC internal noise   | Comparator and capacitor mismatch              | Gaussian, white  | 1–3 LSB RMS (device-dependent)     |
| Ground bounce        | Digital switching currents in shared ground    | Impulsive        | 10–100 mV on poor layouts          |
| EMI pickup           | External RF or nearby switching signals        | Narrowband       | Variable                           |

Oversampling and averaging are effective against **white noise** (quantization, thermal, ADC internal) because these sources are uncorrelated between samples. They are **not effective** against periodic noise (power supply ripple at a fixed frequency), systematic offset, or gain errors — those require filtering, better hardware design, or calibration.

## Software Averaging

The simplest noise reduction technique: sum N consecutive ADC readings and divide by N. The RMS noise decreases by sqrt(N):

```
Noise_averaged = Noise_single / sqrt(N)
```

16 samples averaged reduce noise by a factor of 4 (sqrt(16) = 4). This improves the signal-to-noise ratio by 12 dB.

```c
/* Simple software averaging — 16 samples */
#define AVG_SAMPLES  16

static uint16_t adc_read_averaged(ADC_HandleTypeDef *hadc)
{
    uint32_t sum = 0;

    for (int i = 0; i < AVG_SAMPLES; i++) {
        HAL_ADC_Start(hadc);
        HAL_ADC_PollForConversion(hadc, 10);
        sum += HAL_ADC_GetValue(hadc);
    }

    return (uint16_t)(sum / AVG_SAMPLES);
}
```

Averaging reduces the effective sample rate proportionally. Sampling at 10 kSPS with 16x averaging yields 625 effective samples per second. For slowly varying signals (temperature, battery voltage), this is an acceptable tradeoff. For signals with frequency content approaching the effective sample rate, averaging acts as a low-pass filter and attenuates the signal itself.

## Oversampling with Decimation for Extra Resolution

Oversampling with decimation goes beyond noise reduction: it genuinely increases the effective resolution of the ADC. The principle relies on dithering — the noise present in the signal must be at least 1 LSB peak-to-peak to ensure the ADC toggles between adjacent codes. When this condition is met, oversampling by a factor of 4^n and then right-shifting by n bits yields n additional bits of effective resolution.

| Oversampling Ratio | Right Shift | Extra Bits | Effective Resolution (12-bit ADC) | Sample Rate Reduction |
|--------------------|-------------|------------|-----------------------------------|-----------------------|
| 4x                 | 1           | +1 bit     | 13-bit (8192 levels)              | 4x                   |
| 16x                | 2           | +2 bits    | 14-bit (16384 levels)             | 16x                  |
| 64x                | 3           | +3 bits    | 15-bit (32768 levels)             | 64x                  |
| 256x               | 4           | +4 bits    | 16-bit (65536 levels)             | 256x                 |

The critical requirement is that the input signal plus noise must cause the ADC to produce a distribution of codes across at least 1 LSB. If the input is perfectly stable and the noise is below 1 LSB, the ADC returns the same code every time, and no amount of averaging or decimation can extract sub-LSB information. In practice, most real-world signals have sufficient noise naturally, but a clean signal from a precision reference may not.

```c
/* Oversampling with decimation: 16x oversample for +2 bits (14-bit result) */
#define OVERSAMPLE_RATIO  16
#define DECIMATION_SHIFT  2

static uint16_t adc_read_oversampled(ADC_HandleTypeDef *hadc)
{
    uint32_t accumulator = 0;

    for (int i = 0; i < OVERSAMPLE_RATIO; i++) {
        HAL_ADC_Start(hadc);
        HAL_ADC_PollForConversion(hadc, 10);
        accumulator += HAL_ADC_GetValue(hadc);
    }

    /* Right-shift by decimation factor to get extra resolution bits */
    return (uint16_t)(accumulator >> DECIMATION_SHIFT);
}
```

Note the distinction: **averaging** divides by N and returns a result in the original 12-bit range (0–4095) with less noise. **Decimation** right-shifts by fewer bits than the full division, producing a result in a wider range (0–16383 for 14-bit) with actual sub-LSB resolution. Both reduce noise, but decimation preserves the extra information in the lower bits.

## DMA-Based Oversampling

For continuous sampling, oversampling integrates naturally with the DMA circular buffer pattern. The DMA fills a buffer with raw samples, and firmware processes blocks of N samples at a time:

```c
#define RAW_BUF_SIZE    256   /* Must be multiple of OVERSAMPLE_RATIO */
#define OVERSAMPLE_N    16
#define DECIM_SHIFT     2
#define RESULT_COUNT    (RAW_BUF_SIZE / OVERSAMPLE_N)

static volatile uint16_t raw_buf[RAW_BUF_SIZE];
static uint16_t result_buf[RESULT_COUNT];

/* Called from DMA transfer-complete interrupt */
void HAL_ADC_ConvCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Process second half of buffer (first half still being filled) */
    const volatile uint16_t *src = &raw_buf[RAW_BUF_SIZE / 2];
    uint16_t *dst = &result_buf[RESULT_COUNT / 2];

    for (int i = 0; i < RESULT_COUNT / 2; i++) {
        uint32_t acc = 0;
        for (int j = 0; j < OVERSAMPLE_N; j++) {
            acc += src[i * OVERSAMPLE_N + j];
        }
        dst[i] = (uint16_t)(acc >> DECIM_SHIFT);
    }
}

/* Called from DMA half-transfer interrupt */
void HAL_ADC_ConvHalfCpltCallback(ADC_HandleTypeDef *hadc)
{
    /* Process first half of buffer */
    const volatile uint16_t *src = &raw_buf[0];
    uint16_t *dst = &result_buf[0];

    for (int i = 0; i < RESULT_COUNT / 2; i++) {
        uint32_t acc = 0;
        for (int j = 0; j < OVERSAMPLE_N; j++) {
            acc += src[i * OVERSAMPLE_N + j];
        }
        dst[i] = (uint16_t)(acc >> DECIM_SHIFT);
    }
}
```

This double-buffering approach ensures that the DMA and firmware never access the same buffer half simultaneously.

## STM32 Hardware Oversampling

Several STM32 families (L4, G4, H7, U5) include a hardware oversampler built into the ADC peripheral. It accumulates multiple conversions and optionally right-shifts the result — performing decimation entirely in hardware with no CPU or DMA overhead for the individual samples.

```c
/* STM32G4 / STM32H7 hardware oversampling configuration */
static void adc_hw_oversample_init(ADC_HandleTypeDef *hadc)
{
    hadc->Init.OversamplingMode = ENABLE;

    /* 16x oversampling with 2-bit right shift = 14-bit result */
    hadc->Init.Oversampling.Ratio                 = ADC_OVERSAMPLING_RATIO_16;
    hadc->Init.Oversampling.RightBitShift         = ADC_RIGHTBITSHIFT_2;
    hadc->Init.Oversampling.TriggeredMode         = ADC_TRIGGEREDMODE_SINGLE_TRIGGER;
    hadc->Init.Oversampling.OversamplingStopReset  = ADC_REGOVERSAMPLING_CONTINUED_MODE;

    HAL_ADC_Init(hadc);
}
```

| STM32 Family | HW Oversample Ratios | Max Accumulation | Right Shift Options |
|--------------|----------------------|------------------|---------------------|
| STM32L4      | 2x – 256x           | 16-bit sum       | 0–8 bits            |
| STM32G4      | 2x – 256x           | 16-bit sum       | 0–8 bits            |
| STM32H7      | 2x – 1024x          | 26-bit sum       | 0–11 bits           |
| STM32U5      | 2x – 1024x          | 26-bit sum       | 0–11 bits           |

Hardware oversampling is transparent to DMA — the DMA receives one already-oversampled result per trigger, reducing both bus bandwidth and buffer size requirements. The tradeoff is that the conversion time per result increases by the oversampling ratio.

## Exponential Moving Average (EMA)

For real-time systems where a fixed block of N samples introduces unacceptable latency, an exponential moving average provides smoothing with constant memory usage and no block boundaries:

```c
/* Exponential moving average with integer arithmetic
   alpha = 1/16 (shift = 4), equivalent to ~16-sample smoothing */
#define EMA_SHIFT  4

static uint32_t ema_state = 0;
static bool ema_initialized = false;

static uint16_t adc_ema_filter(uint16_t raw)
{
    if (!ema_initialized) {
        ema_state = (uint32_t)raw << EMA_SHIFT;
        ema_initialized = true;
        return raw;
    }

    /* EMA: state = state + (raw - (state >> shift)) */
    ema_state = ema_state - (ema_state >> EMA_SHIFT) + raw;

    return (uint16_t)(ema_state >> EMA_SHIFT);
}
```

The effective time constant of the EMA is approximately 2^EMA_SHIFT samples. An EMA with shift = 4 responds similarly to a 16-sample moving average but updates every sample and uses only 4 bytes of state. Unlike block averaging, the EMA does not increase effective resolution — it only reduces noise variance.

## When Oversampling Does Not Help

Oversampling assumes noise is white (equal energy at all frequencies) and uncorrelated between samples. Several real-world scenarios violate these assumptions:

**Periodic noise at a submultiple of the sample rate:** If a 50/60 Hz power supply ripple is present on the ADC input and the sample rate is an integer multiple of 50/60 Hz, every sample captures the same phase of the ripple. Averaging does not reduce it — it preserves it. The solution is to set the averaging window to an exact integer number of mains cycles (20 ms for 50 Hz, 16.67 ms for 60 Hz), which integrates the full sine wave to zero.

**Systematic offset or gain error:** If the ADC reads 15 counts too high due to an offset error, averaging 1000 readings still returns a value 15 counts too high. Calibration (zero-point and gain correction) is required — no amount of oversampling fixes a DC error.

**Noise below 1 LSB with no dithering:** If the signal is perfectly stable and noise is below the quantization step, the ADC returns the same code repeatedly. Summing and shifting produces no new information. In this situation, intentionally adding a small amount of noise (dithering) — as little as 0.5 LSB RMS — reactivates the oversampling benefit.

**Correlated noise from a shared source:** If the ADC's own reference voltage is noisy, every conversion is affected identically. Averaging does not reduce noise that is common to all samples in the block. A better reference or a ratiometric measurement architecture addresses this.

## Tips

- Start with 16x oversampling (2 extra bits) as a baseline for any analog sensor — the sample rate cost is modest, and the noise reduction is immediately visible on a serial plotter.
- Use hardware oversampling on STM32L4/G4/H7 whenever possible — it reduces DMA bandwidth by the oversampling ratio and requires no CPU time.
- For mains-frequency rejection, set the total averaging window to 20 ms (50 Hz regions) or 16.67 ms (60 Hz regions). At 10 kSPS, this means averaging 200 or 167 samples respectively.
- Check for sufficient dithering noise by reading the ADC repeatedly with a stable DC input and plotting a histogram. A healthy distribution spans 3–5 codes; a single code repeated means oversampling will not add resolution.
- The accumulator variable must be wide enough to hold the full sum without overflow. For 16x oversampling of a 12-bit ADC: max sum = 16 * 4095 = 65520, which fits in a uint16_t but leaves no margin. A uint32_t accumulator is the safe default.

## Caveats

- **Oversampling does not improve ENOB beyond the ADC's linearity limit** — A 12-bit ADC with +/-3 LSB INL error has a linearity floor around 10 ENOB. Oversampling can push noise below 10 ENOB, but the INL errors remain and bound the overall accuracy. The result may have 14-bit resolution but only 10-bit accuracy.
- **Software oversampling increases CPU load** — Accumulating 256 samples in a polling loop blocks the CPU for 256 conversion times. DMA-based approaches keep the CPU free but require buffer memory (256 samples * 2 bytes = 512 bytes per channel).
- **Averaging a signal that is changing during the averaging window produces a smeared result** — If a pressure sensor responds to a 50 Hz vibration and the averaging window is 10 ms, the averaged value represents the mean over half a vibration cycle — the peak and trough are attenuated. The averaging window must be short relative to the signal's rate of change, or the signal bandwidth is effectively reduced.
- **Integer overflow in the accumulator is a silent bug** — 256 samples of a 12-bit ADC sum to 256 * 4095 = 1,048,320, which overflows a uint16_t (max 65535). The resulting modular arithmetic produces values that look plausible but are wrong. Always use uint32_t for accumulators.
- **EMA filters have a long settling time at startup** — An EMA with shift = 8 (256-sample equivalent) takes approximately 256 samples to converge from its initial value to the true signal level. During this settling period, the output ramps toward the correct value. Initializing the state with the first raw reading (as shown in the code above) reduces but does not eliminate this transient.

## In Practice

**An ADC reading that fluctuates by +/-5 counts on a stable signal, dropping to +/-1 count after 16x averaging,** confirms that the noise is predominantly white and uncorrelated. The expected reduction factor is sqrt(16) = 4, turning +/-5 into +/-1.25 — rounding to +/-1 is consistent.

**Readings that fluctuate by exactly the same amount regardless of how many samples are averaged** point to a periodic or systematic noise source. Checking the ADC input with an oscilloscope typically reveals a periodic signal — often at 50/60 Hz from mains coupling or at the switching frequency of a nearby DC-DC converter. The frequency of the noise determines the correct mitigation: synchronize the averaging window to the noise period, or add hardware filtering.

**A histogram of raw ADC readings that shows a single code (e.g., code 2048 appearing 100% of the time)** indicates that the signal and noise together are not spanning more than 1 LSB. Oversampling and decimation will return the same value with additional zero bits appended — apparent resolution without actual information. Adding a small resistor in the signal path (to inject thermal noise) or enabling the ADC's dithering feature (available on some STM32H7 configurations) restores the distribution needed for oversampling to function.

**14-bit oversampled readings that track a known reference voltage accurately at mid-scale but show 5–10 count errors near the top and bottom of the range** reveal the ADC's integral nonlinearity. The oversampling successfully resolved sub-LSB noise, but the INL errors — which are deterministic and code-dependent — remain. Multi-point calibration (see Calibration & Linearization) corrects these residual errors.
