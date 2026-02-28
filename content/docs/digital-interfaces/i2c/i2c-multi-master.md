---
title: "Multi-Master & Arbitration"
weight: 40
---

# Multi-Master & Arbitration

I²C was designed from the start to support multiple masters on the same bus. Arbitration — the mechanism that resolves contention when two masters transmit simultaneously — is built into the protocol at the electrical level, not as an optional extension. In practice, multi-master I²C is uncommon in small embedded systems because the firmware complexity it introduces rarely justifies the architectural benefit. Understanding the arbitration mechanism is still essential, because arbitration loss can occur even in systems that were not designed as multi-master — a stuck slave or a bus fault can trigger arbitration loss interrupts that firmware must handle gracefully.

## How Arbitration Works

I²C arbitration exploits the open-drain nature of SDA. When two masters begin transmitting simultaneously (both detect the bus as idle and generate a START), they each drive SDA while monitoring it. If a master drives SDA high (releases it) but reads SDA as low, another master is driving a dominant zero — and that master wins arbitration. The losing master must immediately stop driving SDA and abort its transfer.

The process proceeds bit by bit:

1. Both masters generate START conditions (which are indistinguishable on the bus)
2. Both transmit the slave address, bit by bit, MSB first
3. On each bit, both masters compare the bit they transmitted with the actual SDA level
4. The first master that transmits a 1 while SDA reads 0 has lost arbitration
5. The losing master releases the bus and may retry after the winning master's transaction completes

Because the 7-bit address determines the arbitration winner, a master sending to address 0x48 (binary 1001000) will lose to a master sending to address 0x20 (binary 0100000) on the first bit — the second master drives SDA low while the first tries to drive it high.

## Clock Synchronization

When multiple masters are active, SCL is also a wired-AND line. The master with the slowest clock pulls SCL low for the longest period, effectively synchronizing all masters to the slowest clock. This mechanism is called clock synchronization (distinct from clock stretching, which is a slave-side feature):

```
Master A SCL:  ____/‾‾‾‾\____/‾‾‾‾\____
Master B SCL:  ______/‾‾\______/‾‾\____
Actual SCL:    ______/‾‾\______/‾‾\____  (AND of both)
```

The result is that both masters see the same SCL transitions. The master with the faster clock releases SCL high, sees it stay low (because the slower master is still holding it), and waits. This ensures that arbitration comparison on SDA occurs at the same clock edge for both masters.

## Detecting Arbitration Loss in Firmware

On STM32, arbitration loss sets the ARLO flag and can generate an interrupt. The HAL reports it through `HAL_I2C_ERROR_ARLO`:

```c
void HAL_I2C_ErrorCallback(I2C_HandleTypeDef *hi2c) {
    if (hi2c->ErrorCode & HAL_I2C_ERROR_ARLO) {
        // Arbitration lost — another master won
        // The I2C peripheral has already released the bus
        // Schedule a retry after a random or incremented delay

        arb_lost_count++;

        // Retry with delay proportional to retry count
        uint32_t delay_ms = 1 + (arb_lost_count % 10);
        schedule_i2c_retry(hi2c, delay_ms);
    }
}
```

After arbitration loss, the I²C peripheral automatically releases SDA and SCL. No peripheral reset is needed — the hardware handles the release cleanly. The firmware only needs to decide when to retry.

For bare-metal arbitration loss handling on STM32F4:

```c
void I2C1_ER_IRQHandler(void) {
    if (I2C1->SR1 & I2C_SR1_ARLO) {
        // Clear the ARLO flag
        I2C1->SR1 &= ~I2C_SR1_ARLO;

        // Peripheral has released the bus — no further action needed
        // Set a flag for the application layer to retry
        i2c_status.arb_lost = 1;
    }
}
```

## Multi-Master Design Patterns

The most common multi-master topology is two MCUs sharing an I²C bus to communicate with shared peripherals (sensors, EEPROM) and optionally with each other. The firmware design for multi-master requires several additional considerations beyond single-master:

```c
HAL_StatusTypeDef multi_master_write(I2C_HandleTypeDef *hi2c,
                                      uint16_t dev_addr,
                                      uint16_t reg_addr,
                                      uint8_t *data,
                                      uint16_t len) {
    HAL_StatusTypeDef status;

    for (int attempt = 0; attempt < 5; attempt++) {
        // Wait for bus to become free
        uint32_t start = HAL_GetTick();
        while (__HAL_I2C_GET_FLAG(hi2c, I2C_FLAG_BUSY)) {
            if ((HAL_GetTick() - start) > 50) {
                return HAL_TIMEOUT;  // Escalate to bus recovery
            }
        }

        status = HAL_I2C_Mem_Write(hi2c, dev_addr, reg_addr,
                                    I2C_MEMADD_SIZE_8BIT,
                                    data, len, 100);

        if (status == HAL_OK) {
            return HAL_OK;
        }

        if (hi2c->ErrorCode & HAL_I2C_ERROR_ARLO) {
            // Arbitration lost — normal in multi-master
            // Add jitter to avoid repeated collisions
            HAL_Delay(1 + (HAL_GetTick() & 0x07));  // 1-8 ms random
            continue;
        }

        // Other error — handle normally
        break;
    }

    return status;
}
```

The random delay after arbitration loss is important. Without it, two masters that are polling the same sensor at the same interval will collide on every transaction, creating a livelock where one master always wins and the other never completes a transfer.

## General Call Address

I²C reserves address 0x00 as the General Call address. A write to address 0x00 is received by all devices on the bus that have General Call enabled. This is occasionally used for bus-wide commands like software reset (second byte 0x06) or programming commands.

```c
// Send General Call reset to all devices
uint8_t reset_cmd = 0x06;
HAL_I2C_Master_Transmit(&hi2c1,
                         0x00,         // General Call address (already 8-bit)
                         &reset_cmd,
                         1,
                         100);
```

Most I²C devices ignore General Call by default — it must be explicitly enabled in the device's configuration register. The practical use of General Call is limited to systems where all devices on the bus are from the same vendor and support the same General Call command set.

## SMBus vs I²C in Multi-Master Context

SMBus (System Management Bus) is derived from I²C with additional constraints that make multi-master operation more deterministic:

| Feature | I²C | SMBus |
|---------|-----|-------|
| Clock speed | Up to 3.4 MHz (HS) | 10–100 kHz only |
| Timeout | None (SCL can be held low indefinitely) | 35 ms clock low timeout |
| Packet Error Checking | Optional | Mandatory (PEC byte) |
| Alert mechanism | None | SMBALERT# pin |
| Clock stretching limit | Unlimited | 25 ms cumulative per message |

The SMBus 35 ms timeout is the most operationally significant difference. In pure I²C, a slave can hold SCL low indefinitely (clock stretching), and the master must wait. SMBus requires the master to declare a bus error and initiate recovery if SCL is held low for more than 35 ms. This prevents the permanent bus lockup that is the most common I²C failure in the field.

On STM32H7 and newer families, the I²C peripheral supports SMBus mode natively, including the 35 ms timeout:

```c
// Enable SMBus timeout on STM32H7
hi2c1.Init.NoStretchMode = I2C_NOSTRETCH_DISABLE;
// Configure TIMEOUTR register for 35ms timeout
I2C1->TIMEOUTR = (35 * (i2c_kernel_clk / 1000)) & 0x0FFF;
I2C1->TIMEOUTR |= I2C_TIMEOUTR_TIMOUTEN;
```

## When to Avoid Multi-Master

Multi-master I²C adds complexity to firmware and introduces failure modes that single-master systems never encounter. Alternative topologies are often simpler:

**Shared bus with single master**: One MCU owns the I²C bus. Other MCUs communicate with the bus master via SPI, UART, or a separate I²C bus where they are slaves. This eliminates arbitration entirely and is the most common architecture for multi-MCU systems.

**Separate buses**: Each master gets its own I²C bus with dedicated peripherals. Most MCUs have 2-4 I²C peripherals, and bus multiplexers (TCA9548A provides 8 channels) extend this further. Separate buses provide full bandwidth to each master and eliminate all contention.

**I²C with interrupt signaling**: One MCU is the bus master; other MCUs signal data availability through a dedicated GPIO interrupt line. The master polls the slave MCU only when the interrupt fires. This provides the simplicity of single-master with the responsiveness of multi-master.

The decision matrix:

| Criterion | Multi-Master | Single Master + IPC | Separate Buses |
|-----------|-------------|---------------------|----------------|
| Bus utilization | Shared | Shared | Dedicated |
| Firmware complexity | High | Medium | Low |
| Latency | Non-deterministic | Deterministic | Deterministic |
| Failure isolation | None | Partial | Full |
| Hardware cost | Lowest | Low | Moderate |

Multi-master is justified when two independently operating MCUs must access shared sensors without any coordination channel between them. In every other case, a single-master architecture is simpler, more deterministic, and easier to debug.

## Tips

- Add a random delay (1-10 ms) after every arbitration loss before retrying — without jitter, two masters polling at the same rate will collide indefinitely in a livelock pattern
- Enable the ARLO interrupt even in single-master systems — arbitration loss in a single-master system indicates a bus fault (noise, stuck slave, or undocumented second master) and should be logged as a diagnostic event
- Prefer the SMBus 35 ms timeout on any bus where clock stretching is possible — this converts the worst I²C failure mode (permanent bus hang) into a recoverable timeout
- Use `TCA9548A` or similar I²C multiplexers to isolate bus segments rather than implementing multi-master — a multiplexer adds one address byte of overhead but eliminates all arbitration complexity
- In multi-master systems, stagger polling intervals between masters by at least 10% to reduce collision probability — two masters polling a sensor at exactly 100 ms intervals will collide every time

## Caveats

- **Arbitration is not fair** — The master sending the lower address value always wins. If one master repeatedly accesses address 0x20 and another repeatedly accesses address 0x50, the first master wins every collision. The second master may be starved indefinitely if the first master has a high transaction rate
- **Not all I²C devices tolerate mid-transaction bus release** — When a master loses arbitration mid-byte, it releases SDA immediately. If the winning master's transaction also involves the same slave, the slave may see a garbled sequence. Some devices handle this gracefully; others latch into an error state requiring a power cycle
- **Multi-master with clock stretching creates unpredictable latency** — A slave that clock-stretches for 10 ms blocks all masters on the bus, not just the master communicating with it. In time-sensitive systems, one slow device can cause deadline violations across the entire bus
- **The General Call address (0x00) conflicts with some address assignment protocols** — Devices that use address 0x00 for configuration (some PMBus devices, I²C address translators) may misinterpret General Call broadcasts as configuration commands. Verify that all devices on the bus correctly handle or ignore General Call before enabling it
- **DMA-based I²C transfers complicate arbitration loss recovery** — When arbitration is lost during a DMA transfer, the DMA channel may still be active and expecting data. The arbitration loss handler must abort the DMA transfer, reset the DMA channel, and reinitialize the I²C peripheral before retrying. Simply retrying the I²C transaction without cleaning up DMA state causes hard faults or data corruption

## In Practice

- A multi-master bus that works during development but fails intermittently in the field often traces to both masters starting their polling loops at power-on with the same interval. Adding a randomized startup delay (50-200 ms, derived from a unique ID or ADC noise) to one master's initialization eliminates the synchronization that causes repeated collisions
- **Arbitration loss interrupts firing in a single-master system** indicate a bus-level fault. The most common cause is a slave device that is driving SDA when it should not — often due to an incomplete previous transaction. This shows up as an ARLO flag on every transaction attempt, combined with apparent bus traffic that the master did not initiate. Bus recovery (9 SCL pulses plus STOP) typically resolves it
- A system where one master's transactions always succeed but the other's fail with `HAL_I2C_ERROR_ARLO` indicates an address imbalance: the failing master always targets a higher address and always loses arbitration. Restructuring the polling to use fewer, larger burst reads (reducing the number of arbitration points) or assigning time-critical devices to the lower-numbered addresses reduces the starvation
- **Unexplained bus lockups in multi-master systems where both masters use DMA** commonly appear when arbitration loss occurs mid-DMA-transfer. The logic analyzer shows one master releasing the bus mid-byte (correct arbitration behavior), but the system never recovers because the DMA controller is still waiting for data that will never arrive. Adding DMA abort handling to the arbitration loss callback resolves this class of failure
