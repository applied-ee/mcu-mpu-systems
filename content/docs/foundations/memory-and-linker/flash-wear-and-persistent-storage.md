---
title: "Flash Wear & Persistent Storage"
weight: 40
---

# Flash Wear & Persistent Storage

Internal MCU flash is designed for firmware storage, but it also serves as the only non-volatile memory on many low-cost designs. Using it for runtime data — calibration values, configuration, event counters — is common but comes with hard constraints. Flash has limited erase endurance (typically 10,000 cycles on STM32, up to 100,000 on some NOR flash parts), erase must happen at sector granularity (not byte-level), and writes can only clear bits from 1 to 0. Working within these constraints requires deliberate strategies to avoid wearing out sectors that the firmware also depends on.

## Flash Write and Erase Mechanics

Flash memory stores data as trapped charge in floating-gate transistors. A freshly erased flash cell reads as 0xFF (all bits set). Writing can only change bits from 1 to 0 — to restore any bit to 1, the entire sector (or page) must be erased. On STM32F4, sector sizes range from 16 KB to 128 KB; on STM32L4 and G4 families, pages are a more manageable 2 KB. Erasing a 128 KB sector takes 1-2 seconds and blocks all flash reads on single-bank parts, meaning firmware execution stalls unless the erase code runs from RAM.

## Wear-Leveling Strategies

The simplest wear-leveling approach rotates writes across multiple pages. Instead of always writing a configuration struct to the same page, firmware appends sequential entries with a monotonic counter. When the active page fills up, the latest valid entry is compacted to a fresh page and the old one is erased. With 10 pages and a 10K-cycle endurance limit, this extends effective endurance to 100K write operations. A write counter or sequence number in each entry header allows firmware to find the latest valid record after a power cycle.

## Lightweight Key-Value Storage

Many embedded projects need to store a handful of parameters: a device ID, calibration offsets, WiFi credentials, a boot counter. A lightweight KV pattern stores each key-value pair as a tagged, length-prefixed record appended to a flash page. Lookups scan backward from the most recent entry to find the latest value for a given key. This pattern avoids a full filesystem, uses minimal flash, and handles power-loss safety — if a write is interrupted, the partial record fails a CRC check and the previous valid entry is used.

## Emulated EEPROM and Vendor Solutions

ST provides an "emulated EEPROM" software library (X-CUBE-EEPROM) that implements a virtual EEPROM on top of internal flash. It uses two flash pages in a ping-pong scheme: writes go to the active page until it fills, then valid entries are compacted to the alternate page and the original is erased. This limits wear to roughly N/2 erases per page for N writes total. NXP and TI offer similar flash-based EEPROM emulation in their SDKs. These libraries handle the complexity of wear leveling and power-loss safety, but they consume 2-4 flash sectors that are unavailable for firmware storage.

## External Alternatives: EEPROM and FRAM

When flash endurance is insufficient — logging applications that write every second can exhaust 10K cycles in under 3 hours — external non-volatile memory is the answer. I2C/SPI EEPROMs (e.g., AT24C256, 32 KB, 1M write cycles) offer much higher endurance and byte-level write granularity. FRAM (e.g., FM25V10, 128 KB) provides virtually unlimited endurance (100 trillion cycles), byte-level writes, and no erase requirement, but costs more per byte. These external parts add a BOM line and a bus interface, but eliminate flash wear as a design constraint entirely.

## Tips

- Reserve the last one or two flash sectors for persistent data, keeping them separate from firmware sectors — this avoids accidental erasure during firmware updates and simplifies the linker script.
- Always include a CRC or checksum in persistent records to detect partial writes from power loss during flash programming.
- Use the smallest available erase granularity — choose a part with 2 KB pages over 128 KB sectors if runtime data storage is a design requirement.
- Track erase counts in a reserved field at the start of each data sector to monitor wear during the product lifetime.
- Test power-loss robustness by cutting power during flash writes in a loop — this is the only way to verify that the recovery logic actually works.

## Caveats

- **Flash erase times are long and variable** — A 128 KB sector erase on STM32F4 can take up to 2 seconds, during which all flash reads stall on single-bank devices; interrupt handlers that run from flash will not execute.
- **Writing the same byte twice without erasing is undefined behavior** — Even if the second write would only clear additional bits, many flash controllers prohibit double-programming and may set error flags or corrupt adjacent cells.
- **Sector size mismatches catch developers off guard** — STM32F4 sectors range from 16 KB to 128 KB within the same device; assuming uniform sector size leads to erasing far more data than intended.
- **Flash endurance is per-sector, not per-device** — Writing to the same sector repeatedly wears it out while other sectors remain pristine; a single hot sector can fail while the rest of flash is fine.
- **ECC flash (STM32L4/G4/H7) restricts write granularity** — These parts use 64-bit or 128-bit ECC words; writing less than a full ECC word, or writing to the same ECC word twice without erasing, triggers a bus fault.

## In Practice

- A device that works for weeks but then starts booting with default configuration has likely worn out the flash sector used for settings storage — reading the sector shows all 0x00 or ECC errors instead of valid data.
- A configuration write that works 99% of the time but occasionally saves corrupt data is typically caused by power loss during the flash program cycle — adding a CRC check to the read path makes this failure visible immediately at boot.
- A system that freezes for 1-2 seconds at unpredictable intervals is often performing a flash sector erase in the foreground on a single-bank flash part — moving the erase routine to execute from RAM eliminates the stall.
- Firmware that hard-faults when writing persistent data on an STM32L4 or G4 but works fine on an F4 is usually attempting sub-doubleword writes or reprogramming an ECC word — the stricter write granularity on newer parts requires updating the storage library.
- A logging application that fills a flash page and then resets is missing compaction logic — without copying valid entries to a new page before erasing the old one, the erase wipes all accumulated data.
