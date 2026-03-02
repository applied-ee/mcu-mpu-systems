---
title: "Ethernet PHY, MAC & RMII/MII"
weight: 10
---

# Ethernet PHY, MAC & RMII/MII

Wired Ethernet on a microcontroller requires two functional blocks: a MAC (Media Access Controller) that handles frame construction, CRC generation, and DMA transfers, and a PHY (Physical Layer Transceiver) that converts digital signals to analog levels on the wire. Some MCUs integrate the MAC as a peripheral — STM32F4/F7/H7, i.MX RT1060, ESP32, SAM E70 — while others lack Ethernet entirely and rely on SPI-attached modules (covered separately). The PHY is almost always a discrete external chip, connected to the MAC through either the MII or RMII interface.

## MAC: Internal vs External

An internal MAC peripheral appears as a memory-mapped register block with DMA descriptor rings. The MCU's DMA engine moves Ethernet frames between SRAM and the MAC without CPU intervention, freeing the core for protocol processing. External MAC+PHY combo modules (like the WIZnet W5500) bundle both layers plus a TCP/IP stack on a single chip, accessed over SPI — a fundamentally different architecture with different trade-offs.

| Feature | Internal MAC + External PHY | SPI MAC+PHY Module (W5500) |
|---------|---------------------------|---------------------------|
| Throughput (TCP) | 50–95 Mbps | 10–15 Mbps |
| CPU overhead | Low (DMA-driven) | Moderate (SPI transfers) |
| Pin count | 7–16 (RMII/MII) | 4 (SPI) |
| TCP/IP stack | Software (lwIP, Zephyr) | Hardware offload |
| Flexibility | Full control over stack | Limited to chip's capabilities |
| Socket count | Limited by RAM | 8 (hardware sockets) |
| Typical PHY cost | $0.80–$2.00 | $3.00–$5.00 (module) |

### MCU Platforms with Internal MAC

**STM32F4/F7/H7** — The STM32 Ethernet peripheral supports both MII and RMII. On STM32F407, the MAC runs at 100 Mbps with a dedicated DMA engine (ETH_DMA). The H7 series adds IEEE 1588 PTP timestamping and enhanced descriptor format. CubeMX generates the pin mapping and clock configuration, but manual verification of the clock source is still essential — an incorrect REF_CLK setup is the most common cause of "PHY detected but no link" failures.

**ESP32** — The original ESP32 includes an internal 10/100 Ethernet MAC accessible via the ESP-IDF ethernet driver. It supports RMII only. GPIO0 must provide or receive the 50 MHz reference clock, which conflicts with the boot strapping function of that pin — a hardware design consideration that requires careful attention.

**i.MX RT1060/1170** — NXP's crossover MCUs include a high-performance ENET peripheral with hardware checksum offload, IEEE 1588, and AVB (Audio Video Bridging) support. These run at 600–1000 MHz with tight integration into the NXP SDK and lwIP.

**SAM E70/V71** — Microchip's Cortex-M7 MCUs include GMAC (Gigabit MAC) peripherals supporting MII and RMII, with priority queuing for real-time traffic.

## RMII vs MII

The interface between the MAC and PHY carries transmit data, receive data, clock signals, and management bus signals. Two variants dominate embedded designs:

| Parameter | MII | RMII |
|-----------|-----|------|
| Data pins (TX) | 4 (TXD[3:0]) | 2 (TXD[1:0]) |
| Data pins (RX) | 4 (RXD[3:0]) | 2 (RXD[1:0]) |
| Clock | TX_CLK + RX_CLK (25 MHz) | REF_CLK (50 MHz, shared) |
| Total signal pins | 16 | 7 |
| Clock source | PHY provides TX_CLK and RX_CLK | External osc, PHY, or MCU |
| Data rate per clock | 25 MHz x 4 bits = 100 Mbps | 50 MHz x 2 bits = 100 Mbps |
| Board routing | More pins, but lower frequency | Fewer pins, higher frequency |
| PCB layers | Manageable on 2-layer | Manageable on 2-layer |

RMII is overwhelmingly preferred in new MCU designs. Fewer pins mean smaller packages and simpler routing. The trade-off — a single 50 MHz reference clock shared between TX and RX paths — requires careful clock distribution but is well understood.

### RMII Signal Definitions

```
MAC (MCU)                          PHY (e.g., LAN8720A)
──────────                         ─────────────────────
TXD0    ──────────────────────►    TXD0
TXD1    ──────────────────────►    TXD1
TX_EN   ──────────────────────►    TX_EN
RXD0    ◄──────────────────────    RXD0
RXD1    ◄──────────────────────    RXD1
CRS_DV  ◄──────────────────────    CRS_DV
REF_CLK ◄────── or ──────────►    REF_CLK (50 MHz)
MDC     ──────────────────────►    MDC     (management clock)
MDIO    ◄─────────────────────►    MDIO    (management data, bidirectional)
```

The `CRS_DV` signal in RMII multiplexes carrier sense and data valid — the PHY asserts it when valid receive data is present on RXD[1:0]. This replaces the separate `RX_DV`, `CRS`, and `COL` signals found in MII.

## Common PHY Chips

Four PHY transceivers appear in the majority of MCU Ethernet designs:

| PHY | Vendor | Interface | Speed | Key Features | Package | Price (qty 1) |
|-----|--------|-----------|-------|-------------|---------|---------------|
| LAN8720A | Microchip | RMII | 10/100 | Lowest pin count (24-QFN), internal regulator | 4x4 mm QFN-24 | ~$1.00 |
| DP83848 | TI | MII/RMII | 10/100 | Flexible clocking, fiber support variant | LQFP-48 | ~$1.50 |
| KSZ8081 | Microchip | RMII/MII | 10/100 | Low power (60 mA active), wake-on-LAN | QFN-32 | ~$1.20 |
| RTL8201 | Realtek | RMII/MII | 10/100 | Low cost, widely cloned | LQFP-48 | ~$0.60 |
| LAN8742A | Microchip | RMII | 10/100 | Successor to LAN8720A, HP Auto-MDIX | QFN-24 | ~$1.10 |

The LAN8720A is the de facto default for STM32 and ESP32 designs. Nearly every development board with Ethernet (Nucleo-F429ZI, Olimex ESP32-EVB, LILYGO T-ETH) uses it. The DP83848 is commonly found on TI evaluation boards and NXP reference designs. The KSZ8081 appears in low-power industrial applications.

### PHY Address Configuration

Each PHY on a shared MDIO bus needs a unique 5-bit address (0–31). This address is typically set by strap pins sampled at power-on reset. On the LAN8720A, the address is configured through PHYAD0 — tying it low gives address 0, tying it high gives address 1. The DP83848 uses PHYAD[4:0] strap pins for a configurable 5-bit address.

A common bench frustration: the PHY does not respond to MDIO reads because the firmware is using the wrong address. Reading register 0x02 (PHY Identifier 1) at all 32 addresses quickly reveals where the PHY actually lives:

```c
/* Scan for PHY on MDIO bus */
for (uint8_t addr = 0; addr < 32; addr++) {
    uint16_t phyid1 = hal_eth_read_phy(addr, 0x02);
    uint16_t phyid2 = hal_eth_read_phy(addr, 0x03);
    if (phyid1 != 0xFFFF && phyid1 != 0x0000) {
        /* Found PHY at this address */
        /* LAN8720A: phyid1 = 0x0007, phyid2 = 0xC0Fx */
        /* DP83848:  phyid1 = 0x2000, phyid2 = 0x5C9x */
    }
}
```

## MDIO Register Access

The MDIO (Management Data Input/Output) bus is a two-wire serial interface (MDC clock + MDIO data) that allows the MAC to read and write the PHY's internal registers. The bus runs at up to 2.5 MHz and uses a 32-bit frame format with preamble, start, opcode, address, and data fields.

Every 802.3-compliant PHY implements the standard register set (registers 0–15). Key registers for embedded work:

| Register | Name | Key Bits |
|----------|------|----------|
| 0x00 | Basic Control | Bit 15: Reset, Bit 12: Auto-neg enable, Bit 13: Speed select, Bit 8: Duplex |
| 0x01 | Basic Status | Bit 5: Auto-neg complete, Bit 2: Link status |
| 0x02 | PHY ID 1 | OUI bits [3:18] — identifies the vendor |
| 0x03 | PHY ID 2 | OUI bits [19:24] + model + revision |
| 0x04 | Auto-Neg Advertisement | Advertised capabilities (10/100, half/full) |
| 0x05 | Auto-Neg Link Partner | Partner's advertised capabilities |
| 0x06 | Auto-Neg Expansion | Page received, parallel detection fault |
| 0x1F | Special Control/Status | Vendor-specific (speed indication on LAN8720A) |

### Reading PHY Status on STM32

```c
/* STM32 HAL — read PHY Basic Status Register */
uint32_t phy_bsr;
HAL_ETH_ReadPHYRegister(&heth, PHY_ADDR, 0x01, &phy_bsr);

if (phy_bsr & (1 << 2)) {
    /* Link is up */
    uint32_t phy_scsr;
    HAL_ETH_ReadPHYRegister(&heth, PHY_ADDR, 0x1F, &phy_scsr);

    /* LAN8720A Special Control/Status Register */
    uint8_t speed_indication = (phy_scsr >> 2) & 0x07;
    switch (speed_indication) {
        case 0x01: /* 10 Mbps, half duplex */  break;
        case 0x05: /* 10 Mbps, full duplex */  break;
        case 0x02: /* 100 Mbps, half duplex */ break;
        case 0x06: /* 100 Mbps, full duplex */ break;
    }
}
```

## Auto-Negotiation

Auto-negotiation is the process by which two Ethernet devices agree on speed (10 or 100 Mbps) and duplex (half or full). It uses Fast Link Pulse (FLP) bursts on the cable to exchange capability advertisements before any data frames flow.

The process takes 2–5 seconds from power-on to link-up:

1. **PHY powers up** and begins transmitting FLP bursts on the cable
2. **Capability exchange** — each side advertises supported modes via link code words in the FLP bursts
3. **Priority resolution** — the highest common capability wins: 100BASE-TX full-duplex > 100BASE-TX half-duplex > 10BASE-T full-duplex > 10BASE-T half-duplex
4. **Link established** — both sides configure their transceivers to the negotiated mode and assert link-up

If auto-negotiation fails (one side has it disabled, or the link partner is a legacy hub), the PHY falls back to parallel detection — monitoring the signal type to determine speed, but always assuming half-duplex. This is a common source of duplex mismatch problems.

### Forcing Speed and Duplex

In controlled environments (industrial networks, point-to-point links), auto-negotiation can be disabled in favor of forced settings:

```c
/* Force 100 Mbps full-duplex on LAN8720A */
uint16_t bcr = 0;
bcr |= (1 << 13);  /* Speed: 100 Mbps */
bcr |= (1 << 8);   /* Duplex: Full */
/* Bit 12 (auto-neg enable) left cleared */
hal_eth_write_phy(PHY_ADDR, 0x00, bcr);
```

Forcing speed on one side while the other runs auto-negotiation creates a duplex mismatch — the auto-negotiating side detects the speed via parallel detection but defaults to half-duplex. The forced side runs full-duplex. The result is late collisions, CRC errors, and severely degraded throughput (often 1–5 Mbps on a 100 Mbps link). Both sides must match.

## Clock Source Choices

The RMII reference clock (50 MHz) can originate from three places, and the choice affects board design, cost, and reliability:

**Option 1: PHY provides the clock** — The PHY has an internal PLL that generates 50 MHz from a 25 MHz crystal on its XTAL pins. The PHY outputs this clock on a dedicated pin (REF_CLK_OUT or nINT/REFCLKO on LAN8720A). The MCU receives it on its REF_CLK input. This is the simplest approach and used on most eval boards. Downside: the clock trace from PHY to MCU must be short and well-routed to avoid jitter at 50 MHz.

**Option 2: MCU provides the clock** — Some STM32 variants can output 50 MHz on MCO (Microcontroller Clock Output) from an internal PLL. The PHY receives this as its reference clock input. This eliminates the need for a crystal on the PHY (LAN8720A can operate in REF_CLK In mode). Risk: the MCO output may have higher jitter than a crystal-driven PLL, causing packet errors at high traffic loads.

**Option 3: External 50 MHz oscillator** — A dedicated 50 MHz crystal oscillator feeds both the MCU and PHY. This provides the cleanest clock with the best jitter performance but adds a $0.30–$0.80 BOM item and a component placement constraint.

```
Option 1: PHY provides clock
┌─────────┐   50 MHz   ┌─────────┐   25 MHz   ┌─────────┐
│   MCU   │◄───────────│   PHY   │◄───────────│  XTAL   │
│ REF_CLK │            │REFCLKO  │            │  25 MHz │
└─────────┘            └─────────┘            └─────────┘

Option 2: MCU provides clock
┌─────────┐   50 MHz   ┌─────────┐
│   MCU   │───────────►│   PHY   │   No crystal needed
│   MCO   │            │REF_CLK  │   on PHY
└─────────┘            └─────────┘

Option 3: External oscillator
                ┌───────────┐
                │  OSC 50   │
                │   MHz     │
                └─────┬─────┘
            ┌─────────┴─────────┐
            ▼                   ▼
       ┌─────────┐        ┌─────────┐
       │   MCU   │        │   PHY   │
       │ REF_CLK │        │ REF_CLK │
       └─────────┘        └─────────┘
```

## Pin Mapping Considerations

Ethernet pin mapping on MCUs with alternate-function multiplexing requires careful attention. On STM32, the RMII signals map to specific alternate function numbers on specific GPIO pins. Common mappings for STM32F407:

| Signal | Pin Options (AF11) | Notes |
|--------|-------------------|-------|
| ETH_RMII_REF_CLK | PA1 | Fixed — no alternate |
| ETH_RMII_CRS_DV | PA7 | Shared with SPI1_MOSI on some packages |
| ETH_RMII_RXD0 | PC4 | |
| ETH_RMII_RXD1 | PC5 | |
| ETH_RMII_TX_EN | PB11 or PG11 | PG11 only on 176-pin packages |
| ETH_RMII_TXD0 | PB12 or PG13 | |
| ETH_RMII_TXD1 | PB13 or PG14 | |
| ETH_MDC | PC1 | |
| ETH_MDIO | PA2 | Shared with USART2_TX |

The PA2/USART2_TX conflict is a recurring issue — USART2 is the default debug UART on many Nucleo boards, and Ethernet needs the same pin for MDIO. Projects that need both Ethernet and a debug UART must remap one of them.

On ESP32, the RMII pins are partially fixed (GPIO0 for REF_CLK) and partially configurable through the EMAC peripheral. GPIO0 serving as both the boot strapping pin and the Ethernet clock input means the clock source must be carefully managed — the pin cannot be pulled high or low for boot mode selection if the PHY is driving a 50 MHz clock on it at reset time.

## Tips

- Start every new Ethernet design by verifying PHY communication over MDIO. Read register 0x02 and 0x03 to confirm the PHY ID matches the datasheet. If these return 0xFFFF or 0x0000, the MDIO bus is not working — check MDC/MDIO routing, pull-up on MDIO (required by some PHYs), and PHY power supply.
- Place the 25 MHz crystal as close to the PHY's XTAL pins as possible (within 5 mm). Long crystal traces add parasitic capacitance and can prevent oscillation. Match the load capacitors to the crystal specification, not the PHY datasheet default — datasheets often list 20 pF as a generic value, but the correct value depends on the crystal's specified load capacitance and trace parasitics.
- Use the PHY's hardware reset pin rather than relying on software reset alone. A 10 ms low pulse on nRST followed by a 50 ms wait before MDIO access ensures clean initialization. Some PHYs (LAN8720A) sample strap pins on the rising edge of nRST — the strap pin states must be stable before the reset is released.
- When routing RMII traces, keep the REF_CLK trace length matched to within 1 inch of the data traces. At 50 MHz, wavelength effects are not critical on short traces, but excessive length mismatch can cause setup/hold timing violations.
- For development boards with RJ45 jacks, choose a magjack (integrated magnetics + RJ45 connector) to simplify layout. Pulse J0011D21BNL and HanRun HR911105A are common choices at $1–$2 each. Discrete transformers offer more layout flexibility but require 4–6 additional components.

## Caveats

- **PHY power supply sequencing matters** — Most PHYs require their core voltage (1.2 V internal LDO from a 3.3 V supply) to be stable before the I/O supply. The LAN8720A's internal regulator handles this automatically from a 3.3 V input, but external regulator configurations on higher-end PHYs (DP83848, KSZ8081) may require explicit sequencing. An unstable supply during power-up can latch the PHY in an undefined state.
- **GPIO0 on ESP32 is a trap** — The RMII REF_CLK input is hardwired to GPIO0, which is also the boot mode strapping pin. If the PHY drives 50 MHz on GPIO0 before the ESP32 samples it at reset, the boot mode may be corrupted. The standard workaround is to gate the PHY clock output until after ESP32 boot, or to use the ESP32's APLL to generate the 50 MHz clock and drive it to the PHY (reversing the clock direction).
- **MDIO pull-up is not optional on all PHYs** — The MDIO line is an open-drain bidirectional signal. Some PHYs include an internal pull-up; others require an external 1.5–10 kOhm pull-up to 3.3 V. Without it, read operations return unpredictable data.
- **Auto-negotiation restart clears the link** — Writing to the auto-negotiation advertisement register and triggering a restart (setting bit 9 in BCR register 0x00) drops the link for 2–5 seconds. Avoid restarting auto-negotiation in application code unless recovering from an error condition.
- **100BASE-TX requires Category 5 or better cabling** — 10BASE-T works over Category 3 cable, but 100 Mbps requires the tighter twist ratios and lower crosstalk of Cat 5. In industrial environments with long cable runs (up to the 100 m limit), cable quality directly affects error rates.

## In Practice

- A new STM32 + LAN8720A board that reads PHY ID registers successfully but never achieves link-up usually has a clock issue. Probing REF_CLK with an oscilloscope should show a clean 50 MHz square wave with less than 1 ns rise/fall time. If the waveform is absent, check whether the PHY's REF_CLK output mode is properly strapped. If the waveform is present but distorted (ringing, slow edges), add a 33 ohm series termination resistor near the source.
- An Ethernet link that comes up at 10 Mbps instead of 100 Mbps on a known-good cable typically indicates a PHY advertising only 10BASE-T capabilities. Reading register 0x04 (Auto-Negotiation Advertisement) confirms what the PHY is offering — the default after reset should advertise both 10 and 100 Mbps in both half and full duplex (register value 0x01E1 on LAN8720A).
- Intermittent CRC errors at high traffic loads on an otherwise working link point to REF_CLK jitter. Moving from MCO-generated clock to a dedicated 25 MHz crystal on the PHY (with the PHY generating 50 MHz) often eliminates the issue. Measuring jitter requires an oscilloscope with at least 200 MHz bandwidth and a jitter measurement function.
- On the ESP32, the `esp_eth` driver in ESP-IDF v5.x wraps the EMAC and PHY initialization into a clean API. Setting `eth_esp32_emac_config_t.smi_mdc_gpio_num` and `smi_mdio_gpio_num` pins, along with the correct PHY address and reset GPIO, is sufficient for most LAN8720A designs. The common failure mode is leaving the PHY address at the default (0) when the hardware straps it to address 1.
- When using STM32CubeMX to configure Ethernet, always verify the generated `MX_ETH_Init()` against the actual board schematic. CubeMX defaults do not always match custom PCB pin assignments, and mismatched pin configuration causes silent failures — the MAC initializes without error, but no frames are transmitted or received because the data pins are routed to the wrong GPIOs.
