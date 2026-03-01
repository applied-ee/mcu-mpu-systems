---
title: "Profiling & Benchmarking Inference"
weight: 40
---

# Profiling & Benchmarking Inference

A model that meets its accuracy target after [quantization]({{< relref "quantization" >}}) and [conversion]({{< relref "model-conversion" >}}) is only half deployed. The other half is meeting latency, memory, and power constraints on the target hardware. A MobileNetV2 int8 model that achieves 71% top-1 accuracy is useless for a 30 fps video pipeline if it takes 50 ms per inference on the target SBC — that leaves only 16 ms for preprocessing, postprocessing, and frame capture. Profiling and benchmarking on the actual deployment hardware — not on a development workstation — is the only way to validate that the optimized model meets its operational requirements.

## TFLite benchmark_model Tool

The `benchmark_model` tool is the standard profiling utility for TFLite models. It runs repeated inference passes with random or provided input data and reports latency statistics:

```bash
# Basic latency benchmark
benchmark_model \
    --graph=model.tflite \
    --num_threads=4 \
    --warmup_runs=50 \
    --num_runs=300

# With per-operator profiling
benchmark_model \
    --graph=model.tflite \
    --num_threads=4 \
    --warmup_runs=50 \
    --num_runs=300 \
    --enable_op_profiling=true

# With GPU delegate
benchmark_model \
    --graph=model.tflite \
    --use_gpu=true \
    --warmup_runs=50 \
    --num_runs=300 \
    --enable_op_profiling=true

# With XNNPACK delegate (optimized CPU)
benchmark_model \
    --graph=model.tflite \
    --num_threads=4 \
    --use_xnnpack=true \
    --warmup_runs=50 \
    --num_runs=300
```

The tool outputs a summary like:

```
Inference (avg): 12.34 ms
Inference (std dev): 0.56 ms
Inference timings in us:
    Init: 1523
    First inference: 15234
    Warmup (avg): 12890
    Inference (avg): 12340
```

### Per-Operator Profiling

The `--enable_op_profiling=true` flag produces a breakdown of time spent in each operator:

```
============================== Run Order ==============================
                [node type]    [start]    [first]    [avg ms]    [%]    [cdf%]    [mem KB]    [times called]    [Name]
              CONV_2D          0.000      1.234      1.198      9.71%   9.71%     0.000       1                 [input]:0
        DEPTHWISE_CONV_2D      1.198      0.876      0.845      6.85%   16.56%    0.000       1                 [expanded_conv/depthwise]:1
              CONV_2D          2.043      0.654      0.634      5.14%   21.70%    0.000       1                 [expanded_conv/project]:2
        ...
              SOFTMAX          11.987     0.023      0.021      0.17%   100.00%   0.000       1                 [output]:35

============================== Summary by node type ==============================
                [Node type]    [count]    [avg ms]    [avg %]    [cdf %]    [mem KB]    [times called]
              CONV_2D          17         7.234       58.63%     58.63%     0.000       17
        DEPTHWISE_CONV_2D      13         3.456       28.01%     86.64%     0.000       13
              ADD              10         0.987       8.00%      94.64%     0.000       10
        AVERAGE_POOL_2D        1          0.345       2.80%      97.44%     0.000       1
            ...
```

This output reveals which operators dominate inference time. In the example above, `CONV_2D` operations consume 58.63% of total time — these are the primary optimization targets. If a `CONV_2D` layer is running significantly slower than expected, it may be falling back to a non-optimized kernel (e.g., the model uses a dilation parameter that the accelerated kernel does not support).

### Delegate Fallback Detection

When using a delegate (GPU, Edge TPU, NNAPI, Hailo), per-operator profiling reveals which operators are executed by the delegate and which fall back to CPU. A model partitioned across delegate and CPU incurs data transfer overhead at each partition boundary. The profiling output annotates each operator with its execution context — operators tagged `[delegate]` run on the accelerator, and those without the tag run on CPU.

A common pattern: 30 of 35 operators run on the GPU delegate, but 5 fall back to CPU. The data transfers between GPU and CPU memory at those 5 boundaries add more latency than the GPU acceleration saves. In such cases, running the entire model on CPU with XNNPACK may be faster than the partially-delegated execution.

## ONNX Runtime Profiling

ONNX Runtime supports built-in profiling through session options:

```python
import onnxruntime as ort

options = ort.SessionOptions()
options.enable_profiling = True
options.profile_file_prefix = "model_profile"

session = ort.InferenceSession("model.onnx", options)

# Run inference
input_data = np.random.randn(1, 3, 224, 224).astype(np.float32)
for _ in range(100):
    session.run(None, {"input": input_data})

# End profiling
profile_file = session.end_profiling()
```

The profiling output is a JSON file compatible with Chrome's `chrome://tracing` viewer. Each operator execution appears as a span on a timeline, showing:

- Operator type and name
- Execution time in microseconds
- Thread assignment
- Memory allocation events

This visualization is particularly useful for identifying pipeline stalls, memory allocation bottlenecks, and thread contention on multi-core edge devices.

## TensorRT Profiling

TensorRT provides multiple profiling levels:

### trtexec Verbose Output

```bash
trtexec --loadEngine=model.engine \
        --verbose \
        --iterations=200 \
        --warmUp=5000 \
        --duration=0
```

The verbose output includes per-layer timing:

```
[Layer: Conv_0] Execution time: 0.234 ms
[Layer: Conv_0 + Relu_0 (fused)] Execution time: 0.198 ms
[Layer: DWConv_1] Execution time: 0.156 ms
...
Throughput: 85.3 qps
Latency: mean = 11.72 ms, median = 11.65 ms, percentile(99%) = 12.34 ms
```

TensorRT automatically fuses layers (Conv + BatchNorm + ReLU → single kernel), so the per-layer output shows the fused layer names, which may not correspond one-to-one with the original model layers.

### NVIDIA Nsight Systems

For deeper GPU profiling on Jetson platforms:

```bash
nsys profile --trace=cuda,osrt \
             --output=model_profile \
             ./inference_app
```

Nsight Systems captures CUDA kernel launches, memory transfers, CPU thread activity, and GPU utilization on a unified timeline. This reveals:

- Whether the GPU is saturated or idle between kernel launches.
- CPU-GPU synchronization stalls.
- Memory copy overhead between host and device memory.
- The actual CUDA kernels selected by TensorRT for each layer.

## Latency Metrics

Reporting mean latency alone is insufficient for real-time systems. The distribution of latency values determines whether the system meets its deadline reliably:

- **Mean** — Average across all measurement runs. Dominated by the majority of runs and hides worst-case behavior.
- **P50 (median)** — The latency at the 50th percentile. Represents the typical case.
- **P95** — 95th percentile. One in 20 inferences will exceed this value.
- **P99** — 99th percentile. One in 100 inferences will exceed this value. This is the metric that determines real-time feasibility — a system targeting 33 ms frame time (30 fps) must have P99 latency below 33 ms, not just mean.
- **Min / Max** — The absolute extremes. Max latency reveals worst-case behavior, often caused by thermal throttling, garbage collection (in managed runtimes), or OS scheduling.

A model with mean = 10 ms but P99 = 25 ms has a latency distribution with a long tail. In a 30 fps pipeline (33 ms budget), this model will miss its deadline approximately 1% of the time — which may be acceptable for some applications and unacceptable for others.

```python
import numpy as np

latencies = [run_inference() for _ in range(1000)]
print(f"Mean:   {np.mean(latencies):.2f} ms")
print(f"Median: {np.percentile(latencies, 50):.2f} ms")
print(f"P95:    {np.percentile(latencies, 95):.2f} ms")
print(f"P99:    {np.percentile(latencies, 99):.2f} ms")
print(f"Max:    {np.max(latencies):.2f} ms")
```

## Memory Profiling

Model size on disk does not represent runtime memory usage. During inference, the runtime allocates memory for:

- **Model weights** — Loaded from the model file into RAM (or accessed directly from flash on MCUs).
- **Activation tensors** — Intermediate results between layers. The peak activation memory depends on the model architecture, not just the parameter count. A model with 1 MB of weights may require 5 MB of activation memory.
- **Runtime overhead** — Interpreter state, operator scratch buffers, delegate-specific allocations (GPU texture memory, NPU command buffers).
- **Input/output buffers** — The data fed into and received from the model.

### TFLite Memory Arena

TFLite allocates all tensor memory from a pre-planned arena. The `benchmark_model` tool reports the arena size:

```bash
benchmark_model --graph=model.tflite --print_preinvoke_state=true
```

On TFLM (microcontrollers), the `interpreter.arena_used_bytes()` API reports actual arena usage after `AllocateTensors()`, as described in the [TFLite Micro]({{< relref "tflite-micro" >}}) documentation.

### Linux Memory Tools

On Linux-based edge devices (Raspberry Pi, Jetson, Hailo SBC):

```bash
# Peak RSS during inference
/usr/bin/time -v ./inference_app 2>&1 | grep "Maximum resident set size"

# Detailed memory timeline with Valgrind Massif
valgrind --tool=massif --pages-as-heap=yes ./inference_app
ms_print massif.out.<pid>
```

Valgrind Massif produces a timeline of heap allocations, showing peak memory usage and which allocations contribute to the peak. This is essential for identifying memory leaks in inference loops and understanding the memory profile of delegate initialization.

### Jetson Memory

On Jetson platforms, `tegrastats` provides real-time memory monitoring:

```bash
tegrastats --interval 100 --logfile tegrastats.log &
./inference_app
kill %1
```

The output includes RAM usage, swap usage, GPU memory, and EMC (external memory controller) bandwidth utilization. GPU memory is particularly important for TensorRT — a model that fits in GPU memory during single-image inference may exceed available memory at larger batch sizes.

## Power Measurement

Power consumption determines battery life for portable edge devices and thermal constraints for enclosed deployments. Software-reported power values (e.g., from `/sys/class/power_supply/`) are approximate. Accurate power measurement requires external instrumentation.

### Hardware Power Monitors

- **INA219/INA226 on shunt resistor** — A current-sense amplifier placed in series with the device's power supply rail. The INA226 provides 16-bit resolution and can sample at up to 1 kHz, sufficient to capture per-inference power spikes. Connect via I2C and log readings during inference.
- **Monsoon Power Monitor** — A USB power monitor designed for mobile device power measurement. Provides 5 kHz sampling with microwatt resolution. Standard tool for Android ML power benchmarking.
- **Nordic Power Profiler Kit II (PPK2)** — Measures current from 200 nA to 1 A with microsecond resolution. Particularly useful for MCU-based edge AI where inference power is in the milliwatt range.

### Software Power Reporting

On Jetson:

```bash
# Instantaneous power readings
cat /sys/bus/i2c/drivers/ina3221x/*/iio:device*/in_power*_input

# Or via tegrastats (includes GPU, CPU, SOC power rails)
tegrastats --interval 100
```

On Raspberry Pi 5 (with PMIC):

```bash
vcgencmd measure_volts
vcgencmd measure_temp
```

These software readings are useful for relative comparisons (model A vs model B) but should not be trusted for absolute power measurements.

### Energy per Inference

The metric that determines battery life for inference workloads is **energy per inference**:

```
energy_per_inference = average_power_during_inference × inference_latency
```

A model that draws 2 W for 10 ms consumes 20 mJ per inference. A model that draws 500 mW for 50 ms consumes 25 mJ per inference. Despite the first model drawing 4x more power, it uses less energy per inference and is the better choice for battery-powered deployment.

For a 3.7V, 1000 mAh battery (3.7 Wh = 13,320 J):

```
inferences_per_charge = battery_energy / energy_per_inference
                      = 13,320 J / 0.020 J
                      = 666,000 inferences
```

This calculation assumes inference is the dominant power consumer. In practice, the MCU/SoC idle power, sensor power, and communication power must also be included. A system that performs one inference per second with 20 mJ per inference but draws 50 mW idle between inferences has a total power budget dominated by idle power, not inference.

## Thermal Profiling

Edge devices in enclosed deployments (outdoor cameras, industrial sensors) experience thermal throttling that degrades inference performance over time:

### Sustained vs Burst Performance

Most SoCs run at maximum clock speed for a limited time before thermal limits force frequency reduction. A Jetson Orin Nano may deliver 8 ms inference latency for the first 30 seconds, then throttle to 12 ms as junction temperature reaches 85 C. An ESP32-S3 running continuous inference may throttle from 240 MHz to 160 MHz after several minutes in an enclosed housing.

### Monitoring Thermal Behavior

```bash
# Jetson: monitor thermal zones during sustained inference
watch -n 1 cat /sys/devices/virtual/thermal/thermal_zone*/temp

# Raspberry Pi
watch -n 1 vcgencmd measure_temp

# Generic Linux
watch -n 1 cat /sys/class/thermal/thermal_zone*/temp
```

The benchmarking methodology should include a sustained test: run inference continuously for 5–10 minutes and record latency over time. If latency increases after the first minute, thermal throttling is occurring, and the sustained (throttled) latency — not the burst latency — represents real deployment performance.

## Benchmarking Methodology

A rigorous benchmark produces reproducible results that accurately predict deployment performance. The methodology:

1. **Warm-up phase**: Run 50+ inference passes before collecting measurements. The first inference is always slow due to model loading, memory allocation, cache population, and JIT compilation (for runtimes that JIT-compile kernels). CMSIS-NN on Cortex-M does not JIT-compile, but instruction cache effects still make the first inference 10–30% slower.

2. **Measurement phase**: Run 200+ inference passes and collect individual latency values for each pass. Record wall-clock time, not just CPU time — wall-clock time includes OS scheduling delays that affect real deployment.

3. **Input data**: Use representative input data from the deployment domain, not random tensors. Some operators — particularly attention mechanisms and conditional operations — have data-dependent execution paths. A model benchmarked with random noise may show different latency characteristics than the same model processing real camera frames.

4. **Thermal state**: Run the benchmark in the deployment thermal environment. A Raspberry Pi on a desk with open airflow will benchmark 10–20% faster than the same Raspberry Pi in an enclosed weatherproof housing with no active cooling.

5. **System load**: Run the benchmark with the same background processes as the deployment configuration. An inference runtime sharing CPU cores with a video capture pipeline, a network stack, and an RTOS scheduler will have different P99 latency than a benchmark running in isolation.

6. **Report percentiles**: Provide P50, P95, P99, and max, not just mean. Include the measurement methodology (warm-up count, run count, input type, thermal state) in the benchmark report.

### Comparative Benchmarking

When comparing optimization strategies (float32 vs int8, CPU vs GPU delegate, 2 threads vs 4 threads), run all configurations on the same hardware in the same thermal state. A common protocol:

```bash
# Cool-down between configurations (2 minutes idle)
sleep 120

# Configuration A: CPU, 2 threads, float32
benchmark_model --graph=model_f32.tflite --num_threads=2 --warmup_runs=50 --num_runs=300

sleep 120

# Configuration B: CPU, 4 threads, int8
benchmark_model --graph=model_int8.tflite --num_threads=4 --warmup_runs=50 --num_runs=300

sleep 120

# Configuration C: GPU delegate, int8
benchmark_model --graph=model_int8.tflite --use_gpu=true --warmup_runs=50 --num_runs=300
```

The 2-minute cool-down between configurations ensures consistent thermal state. Without cool-down, Configuration C inherits the thermal load from Configuration B and may show higher latency due to accumulated heat.

## Tips

- Always profile on the target hardware, not the development machine. A model that runs in 5 ms on a laptop with an 8-core x86 CPU may run in 50 ms on a Cortex-A53 quad-core. The profiling results from the laptop have no predictive value for the edge target.
- 50 warm-up runs and 200 measurement runs produce stable latency statistics for most models. If P99 varies by more than 10% between repeated benchmark sessions, increase the measurement count or investigate sources of non-determinism (thermal throttling, background processes).
- Profile with representative input data, not random tensors. Attention-based models, conditional architectures, and sparse operations can have input-dependent latency. Random data may produce artificially uniform latency that does not reflect real-world variance.
- P99 latency determines real-time feasibility, not mean latency. A system that meets its latency budget on average but misses it 1% of the time will produce visible frame drops, audio glitches, or missed control deadlines in real deployment.
- Measure power under sustained inference load, not burst. The first 10 seconds of inference before thermal throttling sets in do not represent steady-state power consumption. Run inference for 5+ minutes before collecting power measurements.
- Compute energy per inference (power x latency) for battery-life estimation. A faster model at higher power may use less energy per inference than a slower model at lower power.

## Caveats

- The first inference is always slower than subsequent inferences due to model loading, memory allocation, cache warm-up, and (on some runtimes) JIT kernel compilation. Reporting first-inference latency without flagging it as such produces misleading benchmarks. The warm-up phase must be long enough to amortize all initialization effects.
- Random input data can produce different execution paths than real data, especially for models with attention mechanisms (where attention patterns depend on input content), conditional branches, or early-exit architectures. Benchmarking with random data may understate or overstate real-world latency.
- GPU profiling tools (Nsight Systems, nvprof) instrument the runtime and add overhead, which slows execution. The profiled latency is higher than un-profiled latency by 5–20%. Use profiling tools to identify bottleneck operators and relative proportions, but use un-instrumented benchmarks for absolute latency numbers.
- `benchmark_model` with `--use_gpu` includes CPU-to-GPU and GPU-to-CPU memory transfer time in the reported latency. This is correct for deployment (where the transfers are real overhead) but may surprise developers comparing against GPU-only kernel execution time reported by framework-specific profilers.
- Thread count does not always improve performance linearly. Setting `--num_threads=4` on a 4-core Cortex-A53 may be slower than `--num_threads=2` if the model's operators do not parallelize well or if thread synchronization overhead dominates. Profile at multiple thread counts to find the optimum.
- Overclocked or "performance mode" SoC settings produce benchmark numbers that are not sustainable in deployment. A Jetson Orin NX at `MAXN` power mode draws 25 W and cannot sustain thermal equilibrium in most embedded enclosures. Benchmark at the power mode and clock frequencies that will be used in production.

## In Practice

- **Inference latency varies 2–3x between runs.** The warm-up phase is insufficient, or thermal throttling is occurring during the benchmark. Checking the SoC temperature during benchmarking (`thermal_zone` readings climbing past 80 C) confirms throttling. Extending the warm-up or adding a heatsink stabilizes the measurements. On Cortex-M devices, interrupt handlers running during inference cause latency spikes — disabling non-critical interrupts during the inference window isolates ML latency from system overhead.
- **GPU delegate shows worse latency than CPU execution.** The model is too small for GPU execution to overcome the data transfer overhead. Models below approximately 5 ms CPU inference time on mobile SoCs rarely benefit from GPU delegation because the CPU↔GPU memory copy takes 1–3 ms each way. CPU with XNNPACK is the correct choice for small models.
- **Per-operator profiling shows one operator consuming 80% of inference time.** This operator is the optimization target. Common causes: the operator is falling back to a non-optimized kernel (check delegate partitioning), the operator has unexpectedly large input dimensions (check tensor shapes in Netron), or the operator type is inherently compute-heavy (depthwise convolution with large kernel size). Targeted [quantization]({{< relref "quantization" >}}) of that layer, or restructuring the model to use a more efficient operator, addresses the bottleneck.
- **Power draw spikes during inference then drops to idle.** This is the expected pattern for burst inference (run model, return to idle, wait for next trigger). The relevant metric is energy per inference (power x time during the spike), not peak power. For battery estimation, multiply energy per inference by the expected inference rate and add idle power for the remaining time.
- **Benchmark results on the desk do not match field deployment performance.** Thermal conditions differ. A Raspberry Pi with no enclosure on a 22 C desk sustains maximum clock speed indefinitely. The same Raspberry Pi in a sealed IP67 enclosure at 35 C ambient throttles within minutes. The field-representative benchmark must run in the deployment enclosure at the expected ambient temperature for at least 10 minutes before collecting latency measurements.
- **Model fits in memory during testing but OOM-kills in deployment.** The benchmark ran in isolation, but the deployment application also loads a camera driver, a network stack, and a display framebuffer. Measuring peak RSS of the complete deployment application (not just the inference component) reveals the true memory requirement. On Linux SBCs, `cgroup` memory limits can enforce deployment-realistic memory constraints during benchmarking.
