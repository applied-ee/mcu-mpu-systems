---
title: "Multi-Byte Read/Write Patterns"
weight: 20
---

# Multi-Byte Read/Write Patterns

Most I²C devices expose a register-based interface: a write transaction sends the register address, and a read transaction retrieves the data at that address. The protocol detail that makes this work is the repeated start condition — a start without a preceding stop — which allows the master to switch from write mode (sending the register address) to read mode (receiving data) without releasing the bus. Nearly every sensor, EEPROM, and I/O expander uses this pattern, and understanding the transaction structure at the byte level is essential for debugging transfers that silently return stale or incorrect data.

## Register-Addressed Read Pattern

A typical register read on an I²C sensor involves two phases within a single logical transaction:

1. **Write phase**: START → slave address + W → register address → (no STOP)
2. **Read phase**: REPEATED START → slave address + R → data byte(s) → STOP

The repeated start (Sr) is critical. Without it, the master would issue a STOP after sending the register address, and another device could seize the bus before the read completes. The repeated start holds bus ownership.

On STM32 HAL, the `HAL_I2C_Mem_Read` function encapsulates this entire sequence:

```c
#define MPU6050_ADDR     0x68   // 7-bit address
#define WHO_AM_I_REG     0x75

uint8_t who_am_i;
HAL_StatusTypeDef status;

status = HAL_I2C_Mem_Read(&hi2c1,
                          MPU6050_ADDR << 1,  // HAL expects 8-bit address
                          WHO_AM_I_REG,
                          I2C_MEMADD_SIZE_8BIT,
                          &who_am_i,
                          1,                   // 1 byte
                          100);                // timeout ms

// who_am_i should read 0x68 for genuine MPU6050
```

The address shift (`<< 1`) is an STM32 HAL convention — the HAL expects the 7-bit address in bits [7:1] of an 8-bit value. Forgetting this shift is one of the most common I²C bugs on STM32, producing NACKs for every transaction because the address is wrong.

## Raw Repeated Start Sequence

When the HAL `Mem_Read`/`Mem_Write` functions do not fit — for example, devices that require multi-byte commands before the read phase — the raw transaction must be assembled manually:

```c
// Phase 1: Write the register address
uint8_t reg = 0x75;
HAL_I2C_Master_Transmit(&hi2c1, MPU6050_ADDR << 1, &reg, 1, 100);

// Phase 2: Read the data (separate START)
uint8_t data;
HAL_I2C_Master_Receive(&hi2c1, MPU6050_ADDR << 1, &data, 1, 100);
```

This two-call approach generates START–address+W–reg–STOP–START–address+R–data–STOP, which includes a STOP between phases. Most devices tolerate this, but some — particularly devices with auto-incrementing register pointers — may reset their pointer on the STOP, causing the read to return data from the wrong register. The `HAL_I2C_Mem_Read` approach uses a true repeated start and is always preferred when the device protocol permits it.

## Burst Reads from Sensors

IMUs and multi-axis sensors pack related data into consecutive registers to enable efficient burst reads. The MPU6050 stores accelerometer data in registers 0x3B–0x40 (6 bytes: ACCEL_XOUT_H/L, ACCEL_YOUT_H/L, ACCEL_ZOUT_H/L) and gyroscope data in 0x43–0x48 (6 bytes). Reading all six accelerometer bytes in a single transaction:

```c
#define ACCEL_XOUT_H  0x3B

uint8_t raw[6];
HAL_I2C_Mem_Read(&hi2c1,
                 MPU6050_ADDR << 1,
                 ACCEL_XOUT_H,
                 I2C_MEMADD_SIZE_8BIT,
                 raw,
                 6,        // 6 consecutive bytes
                 100);

int16_t accel_x = (int16_t)((raw[0] << 8) | raw[1]);
int16_t accel_y = (int16_t)((raw[2] << 8) | raw[3]);
int16_t accel_z = (int16_t)((raw[4] << 8) | raw[5]);
```

The device auto-increments its internal register pointer after each byte ACK. This is more efficient than six individual register reads — a single 6-byte burst takes approximately 200 µs at 400 kHz, while six separate reads take roughly 600 µs due to repeated start/address overhead. Burst reads also guarantee that all axes are sampled from the same measurement cycle, avoiding skew between axes.

On ESP-IDF, the equivalent burst read:

```c
#include "driver/i2c.h"

uint8_t raw[6];
i2c_cmd_handle_t cmd = i2c_cmd_link_create();
i2c_master_start(cmd);
i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_WRITE, true);
i2c_master_write_byte(cmd, ACCEL_XOUT_H, true);
i2c_master_start(cmd);  // Repeated start
i2c_master_write_byte(cmd, (MPU6050_ADDR << 1) | I2C_MASTER_READ, true);
i2c_master_read(cmd, raw, 5, I2C_MASTER_ACK);
i2c_master_read_byte(cmd, &raw[5], I2C_MASTER_NACK);  // NACK last byte
i2c_master_stop(cmd);
esp_err_t ret = i2c_master_cmd_begin(I2C_NUM_0, cmd, pdMS_TO_TICKS(100));
i2c_cmd_link_delete(cmd);
```

The last byte in a multi-byte read must be NACKed — this signals to the slave that the master is done reading. Sending ACK on the last byte causes many devices to continue clocking out data, potentially corrupting the next transaction.

## Register Write Pattern

Writing to a device register is simpler — no repeated start is needed. The master sends START, slave address + W, register address, then one or more data bytes, followed by STOP:

```c
#define PWR_MGMT_1   0x6B

// Wake up MPU6050: write 0x00 to PWR_MGMT_1
uint8_t wake_cmd = 0x00;
HAL_I2C_Mem_Write(&hi2c1,
                  MPU6050_ADDR << 1,
                  PWR_MGMT_1,
                  I2C_MEMADD_SIZE_8BIT,
                  &wake_cmd,
                  1,
                  100);
```

For devices requiring multi-byte writes to consecutive registers, the same auto-increment behavior applies: the device increments its register pointer after each byte.

## EEPROM Page Writes

EEPROMs like the AT24C256 (256 Kbit / 32 KB) accept page writes of up to 64 bytes. The transaction sends a 16-bit memory address followed by up to 64 data bytes:

```c
#define AT24C256_ADDR  0x50

uint8_t data[66];  // 2 address bytes + 64 data bytes
data[0] = 0x00;    // Address high byte
data[1] = 0x00;    // Address low byte
memcpy(&data[2], page_buffer, 64);

HAL_I2C_Master_Transmit(&hi2c1,
                        AT24C256_ADDR << 1,
                        data,
                        66,
                        100);

// EEPROM write cycle: device NACKs during internal programming
// Poll for ACK to detect completion (typically 3-5 ms)
HAL_StatusTypeDef poll;
do {
    poll = HAL_I2C_IsDeviceReady(&hi2c1, AT24C256_ADDR << 1, 1, 10);
} while (poll != HAL_OK);
```

Alternatively, using the `HAL_I2C_Mem_Write` function with 16-bit addressing:

```c
HAL_I2C_Mem_Write(&hi2c1,
                  AT24C256_ADDR << 1,
                  0x0000,
                  I2C_MEMADD_SIZE_16BIT,
                  page_buffer,
                  64,
                  100);
```

The write cycle time — typically 5 ms for the AT24C series — means the EEPROM will NACK all transactions during its internal programming phase. The ACK polling loop is the standard method for detecting write completion without relying on a fixed delay.

## 8-bit vs 16-bit Register Addresses

Most sensors (MPU6050, BME280, BMP280, SHT31) use 8-bit register addresses, limiting the register space to 256 locations. EEPROMs larger than 256 bytes (AT24C32 and above) use 16-bit addresses, sending the high byte first:

| Device | Address Size | Address Range | HAL Constant |
|--------|-------------|---------------|-------------|
| MPU6050 | 8-bit | 0x00–0xFF | `I2C_MEMADD_SIZE_8BIT` |
| BME280 | 8-bit | 0x00–0xFF | `I2C_MEMADD_SIZE_8BIT` |
| AT24C256 | 16-bit | 0x0000–0x7FFF | `I2C_MEMADD_SIZE_16BIT` |
| AT24C02 | 8-bit | 0x00–0xFF | `I2C_MEMADD_SIZE_8BIT` |

Using the wrong address size produces predictable failures: an 8-bit address sent to a 16-bit device means the first data byte is interpreted as the address low byte, and the actual data starts writing one byte later at the wrong location. A 16-bit address sent to an 8-bit device sends an extra byte that the device may interpret as the first data byte, overwriting register 0x00.

## Sequential Reads with Auto-Increment

Some devices support a "current address read" — sending only START, address+R, and reading without specifying a register address. The device responds from its current internal pointer, which auto-increments from the last transaction. This is efficient for streaming sequential data but fragile: any intervening transaction to a different register resets the pointer, and power glitches reset it to zero.

```c
// After a Mem_Read from register 0x3B, the pointer is at 0x41
// A current-address read continues from 0x41
uint8_t next_bytes[2];
HAL_I2C_Master_Receive(&hi2c1, MPU6050_ADDR << 1, next_bytes, 2, 100);
```

This pattern is rarely used outside of EEPROM sequential reads, where reading an entire 32 KB chip in one stream is faster than issuing 512 individual page reads.

## Tips

- Always use `HAL_I2C_Mem_Read` / `HAL_I2C_Mem_Write` instead of separate Transmit/Receive calls — the Mem functions generate a proper repeated start, which is required by many devices and eliminates the risk of bus release between address and data phases
- NACK the last byte in a multi-byte read — failing to do so leaves some devices in an undefined state where they continue driving SDA, potentially locking the bus
- For EEPROM writes, always implement ACK polling rather than a fixed delay — the actual write cycle time varies by device, temperature, and number of bytes written. A 5 ms `HAL_Delay` wastes time on short writes and risks data corruption on devices with longer write cycles
- When burst-reading sensor data, read all related registers in a single transaction — this guarantees all values are from the same sample and reduces bus overhead by 60-70% compared to individual register reads
- Verify the device address convention (7-bit vs 8-bit) before the first write — STM32 HAL expects the 7-bit address shifted left by one, while many datasheets list the 8-bit address with R/W bit included

## Caveats

- **Writing past a page boundary wraps to the beginning of the same page** — An EEPROM page write that crosses a 64-byte page boundary does not continue to the next page. Instead, the address wraps and overwrites the beginning of the current page. For the AT24C256, a write starting at address 0x3F (63) with 4 bytes writes to 0x3F, 0x00, 0x01, 0x02 — not 0x3F, 0x40, 0x41, 0x42. The datasheet specifies the page size, but firmware must enforce boundary alignment
- **Auto-increment behavior is device-specific and not guaranteed by the I²C specification** — Some devices wrap their register pointer to 0x00 after reaching the last register. Others stop incrementing. A few devices do not auto-increment at all, returning the same register repeatedly. The device datasheet is the only reliable reference
- **Sending a 16-bit address to an 8-bit device silently overwrites register 0x00** — There is no protocol-level mechanism for a device to reject an unexpected extra byte. The slave accepts every byte it receives after the register address as data
- **HAL timeout does not distinguish between NACK and bus busy** — Both conditions cause `HAL_I2C_Mem_Read` to return `HAL_ERROR` or `HAL_TIMEOUT` without indicating whether the slave NACKed or the bus was stuck. Checking `hi2c1.ErrorCode` after a failure provides finer diagnostics: `HAL_I2C_ERROR_AF` indicates address or data NACK, while `HAL_I2C_ERROR_TIMEOUT` indicates bus-level timeout

## In Practice

- A sensor burst read that returns correct values for the first axis but garbage for subsequent axes often indicates that the device does not auto-increment as expected. This commonly appears when the wrong device variant is used — some MPU6050 clones do not auto-increment across non-contiguous register blocks
- **EEPROM data corruption concentrated at page boundaries** — typically at 64-byte intervals — is the signature symptom of page-wrap writes. The corruption pattern is distinctive: data near the end of a page is correct, but the first few bytes of the page contain data that was intended for the next page
- A read transaction that consistently returns 0xFF from every register, despite the device ACKing its address, usually indicates the register address phase was skipped or malformed. The device responds to its address but has no valid register pointer, returning its default value (0xFF for most EEPROMs, 0x00 for some sensors)
- **Transactions that work with one sensor but fail with another at the same address** often trace to differences in repeated start behavior. Some cheaper sensor modules include a level shifter that introduces a delay between the write and read phases, violating the repeated start timing. Reducing the I²C clock to 100 kHz or bypassing the level shifter typically resolves this
