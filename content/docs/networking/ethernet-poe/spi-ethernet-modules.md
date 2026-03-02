---
title: "SPI Ethernet Modules"
weight: 20
---

# SPI Ethernet Modules

Not every MCU has an integrated Ethernet MAC. Many popular platforms — RP2040, STM32F1/L4, nRF52, ATmega — lack native Ethernet. SPI-attached Ethernet controllers bridge this gap by providing a complete MAC + PHY + magnetics interface accessible over a standard 4-wire SPI bus. Two chips dominate this space: the WIZnet W5500, which offloads the entire TCP/IP stack into hardware, and the Microchip ENC28J60, which provides only raw Ethernet frame access and relies on the host MCU to run a software TCP/IP stack like lwIP.

## W5500: Hardware TCP/IP Offload

The WIZnet W5500 integrates a 10/100 Ethernet PHY, MAC, and a hardwired TCP/IP stack (TCP, UDP, IPv4, ICMP, ARP, IGMP, PPPoE) in a single 48-pin LQFP package. The host MCU communicates through SPI at up to 80 MHz, sending socket-level commands ("open socket," "connect to IP," "send data") rather than constructing raw Ethernet frames.

### Key Specifications

| Parameter | Value |
|-----------|-------|
| Ethernet speed | 10/100 Mbps |
| SPI clock max | 80 MHz |
| Hardware sockets | 8 simultaneous |
| TX/RX buffer | 32 KB total, configurable per socket |
| Protocol support | TCP, UDP, IPv4, ICMP, ARP, IGMP, PPPoE, raw MAC |
| Operating voltage | 3.3 V (I/O 5 V tolerant) |
| Active current draw | ~130 mA |
| Sleep current | ~15 mA |
| Package | LQFP-48 (7x7 mm) |
| Module price | ~$3–$6 (breakout board with RJ45) |

### Architecture

```
┌────────────────────────────────────────────┐
│                   W5500                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │   SPI    │  │ TCP/IP   │  │ Ethernet │ │
│  │Interface │─►│ Engine   │─►│ MAC+PHY  │─────► RJ45
│  │          │  │          │  │          │ │
│  └──────────┘  └──────────┘  └──────────┘ │
│       ▲              │                     │
│       │         ┌────┴─────┐               │
│       │         │ 32 KB    │               │
│       │         │ Buffer   │               │
│       │         │ RAM      │               │
│       │         └──────────┘               │
└───────┼────────────────────────────────────┘
        │ SPI (MOSI, MISO, SCK, CS)
   ┌────┴─────┐
   │   Host   │
   │   MCU    │
   └──────────┘
```

The 32 KB buffer is shared across all 8 sockets. The default allocation gives each socket 2 KB TX + 2 KB RX. For applications using only 1–2 sockets, reallocating the buffer (e.g., 16 KB TX + 16 KB RX for a single socket) significantly improves throughput for bulk transfers.

### SPI Communication Protocol

The W5500 uses a variable-length data frame with a 3-byte header:

```
┌──────────────────┬──────────────────┬──────────────┐
│  Address (16-bit) │ Control (8-bit)  │  Data (N)    │
│  Offset in block  │ BSB[4:0]+RW+OM  │  Read/Write  │
└──────────────────┴──────────────────┴──────────────┘

BSB = Block Select Bits (selects common register, socket register, or TX/RX buffer)
RW  = 0 for read, 1 for write
OM  = Operating Mode (variable length, 1/2/4 byte, or variable)
```

A socket send operation involves:
1. Write payload data to the socket TX buffer
2. Update the TX write pointer register
3. Issue the SEND command to the socket command register
4. Poll the interrupt register (or use the IRQ pin) for send completion

```c
/* W5500 — send data on socket 0 (simplified) */
uint16_t tx_wr = w5500_read_sock_reg16(0, Sn_TX_WR);
uint16_t offset = tx_wr & 0x07FF;  /* 2 KB buffer mask */

w5500_write_buf(0, offset, data, len);

tx_wr += len;
w5500_write_sock_reg16(0, Sn_TX_WR, tx_wr);
w5500_write_sock_reg8(0, Sn_CR, SEND);

/* Wait for send complete */
while (!(w5500_read_sock_reg8(0, Sn_IR) & IR_SENDOK)) {
    /* Timeout check needed here */
}
w5500_write_sock_reg8(0, Sn_IR, IR_SENDOK);  /* Clear flag */
```

### Throughput Reality

The theoretical SPI throughput at 80 MHz is 10 MB/s (80 Mbps), but practical TCP throughput through the W5500 tops out at 10–15 Mbps. The limiting factors:

| Factor | Impact |
|--------|--------|
| SPI protocol overhead | 3-byte header per transaction, CS toggling |
| Host MCU SPI speed | Many MCUs max at 20–40 MHz SPI clock |
| Buffer management latency | Reading/writing TX/RX pointers per socket |
| TCP ACK processing | Hardware TCP stack adds per-segment latency |
| DMA availability | Without DMA, CPU copies every byte through SPI |

On an RP2040 at 125 MHz with PIO-driven SPI at 62.5 MHz, measured TCP throughput reaches approximately 12 Mbps. On an Arduino Uno (ATmega328P, 8 MHz SPI), throughput drops to 1–2 Mbps due to the slow SPI clock and CPU-bound byte copying.

## ENC28J60: Raw Frame Access

The Microchip ENC28J60 is an older but still widely used SPI Ethernet controller. Unlike the W5500, it provides only raw Ethernet frame transmission and reception — the host MCU must run the full TCP/IP stack in software.

| Parameter | Value |
|-----------|-------|
| Ethernet speed | 10 Mbps only |
| SPI clock max | 20 MHz |
| TX/RX buffer | 8 KB total |
| Protocol support | Raw Ethernet frames only |
| Operating voltage | 3.3 V |
| Active current draw | ~160 mA |
| Package | SSOP-28 or QFN-28 |
| Module price | ~$2–$4 |

The ENC28J60 is limited to 10 Mbps, which caps practical throughput at 3–5 Mbps with lwIP. Its 8 KB buffer is divided between TX and RX, and the small buffer size means the host must service received frames promptly or risk overflow. The 20 MHz SPI clock is adequate for 10 Mbps Ethernet but leaves no headroom.

### ENC28J60 vs W5500 Decision Matrix

| Criterion | ENC28J60 | W5500 |
|-----------|----------|-------|
| Maximum throughput | ~5 Mbps | ~15 Mbps |
| TCP/IP stack | Software (lwIP on host) | Hardware (on-chip) |
| Host RAM for networking | 10–30 KB (lwIP + buffers) | ~1 KB (SPI driver only) |
| Host CPU load | High (TCP processing) | Low (socket API only) |
| Socket count | Limited by host RAM | 8 (hardware) |
| Flexibility | Full — custom protocols, raw sockets | Limited to supported protocols |
| Cost | Lower ($2) | Higher ($4) |
| DHCP/DNS | Software (host) | Software (host) — not offloaded |

The W5500 wins for resource-constrained MCUs (ATmega, small Cortex-M0) that cannot spare 20–30 KB of RAM for lwIP. The ENC28J60 makes sense when the host already runs lwIP for other interfaces (WiFi, cellular) and adding Ethernet as another netif is straightforward.

## W5100S: Budget Alternative

The WIZnet W5100S is a cost-reduced variant with the same hardwired TCP/IP architecture as the W5500 but with some limitations:

| Parameter | W5100S | W5500 |
|-----------|--------|-------|
| Sockets | 4 | 8 |
| Buffer | 16 KB | 32 KB |
| SPI clock | 33.3 MHz max | 80 MHz max |
| Parallel bus | 8-bit direct/indirect | No |
| Price | ~$2.50 | ~$4.00 |

The W5100S is notable for its use on the Raspberry Pi Pico-based "W5100S-EVB-Pico" board, making it a popular prototyping option. The reduced socket count and buffer size rarely matter for typical IoT use cases (1–3 connections).

## Driver Integration Patterns

### Arduino (W5500 with Ethernet library)

The Arduino Ethernet library provides the most accessible API for W5500-based networking:

```cpp
#include <SPI.h>
#include <Ethernet.h>

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };

void setup() {
    Ethernet.init(10);  /* CS pin */
    Ethernet.begin(mac);  /* DHCP */

    /* Static IP alternative */
    /* IPAddress ip(192, 168, 1, 100); */
    /* Ethernet.begin(mac, ip); */
}

void loop() {
    EthernetClient client;
    if (client.connect("httpbin.org", 80)) {
        client.println("GET /ip HTTP/1.1");
        client.println("Host: httpbin.org");
        client.println("Connection: close");
        client.println();

        while (client.connected()) {
            while (client.available()) {
                char c = client.read();
                Serial.print(c);
            }
        }
        client.stop();
    }
    delay(10000);
}
```

### ESP-IDF (W5500)

ESP-IDF v5.x includes a native W5500 driver that integrates with the lwIP stack running on the ESP32, making the SPI Ethernet interface appear as a standard netif alongside WiFi:

```c
/* ESP-IDF W5500 initialization */
spi_bus_config_t buscfg = {
    .miso_io_num = GPIO_NUM_19,
    .mosi_io_num = GPIO_NUM_23,
    .sclk_io_num = GPIO_NUM_18,
    .quadwp_io_num = -1,
    .quadhd_io_num = -1,
};
spi_bus_initialize(SPI3_HOST, &buscfg, SPI_DMA_CH_AUTO);

spi_device_interface_config_t spi_devcfg = {
    .mode = 0,
    .clock_speed_hz = 36 * 1000 * 1000,  /* 36 MHz */
    .spics_io_num = GPIO_NUM_5,
    .queue_size = 20,
};

eth_w5500_config_t w5500_config = ETH_W5500_DEFAULT_CONFIG(SPI3_HOST, &spi_devcfg);
w5500_config.int_gpio_num = GPIO_NUM_4;

eth_mac_config_t mac_config = ETH_MAC_DEFAULT_CONFIG();
esp_eth_mac_t *mac = esp_eth_mac_new_w5500(&w5500_config, &mac_config);

eth_phy_config_t phy_config = ETH_PHY_DEFAULT_CONFIG();
esp_eth_phy_t *phy = esp_eth_phy_new_w5500(&phy_config);

esp_eth_config_t eth_config = ETH_DEFAULT_CONFIG(mac, phy);
esp_eth_handle_t eth_handle = NULL;
esp_eth_driver_install(&eth_config, &eth_handle);

/* Register with netif (lwIP) */
esp_netif_config_t netif_cfg = ESP_NETIF_DEFAULT_ETH();
esp_netif_t *eth_netif = esp_netif_new(&netif_cfg);
esp_netif_attach(eth_netif, esp_eth_new_netif_glue(eth_handle));

esp_eth_start(eth_handle);
```

### Zephyr RTOS

Zephyr supports the W5500 through a device tree overlay and built-in driver. The application uses standard Zephyr socket APIs without knowing the underlying hardware:

```dts
/* Device tree overlay for W5500 on SPI1 */
&spi1 {
    status = "okay";
    cs-gpios = <&gpio0 5 GPIO_ACTIVE_LOW>;

    w5500: w5500@0 {
        compatible = "wiznet,w5500";
        reg = <0>;
        spi-max-frequency = <33000000>;
        int-gpios = <&gpio0 4 GPIO_ACTIVE_LOW>;
        reset-gpios = <&gpio0 22 GPIO_ACTIVE_LOW>;
    };
};
```

```c
/* Zephyr application code — standard BSD sockets */
#include <zephyr/net/socket.h>

int sock = zsock_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
struct sockaddr_in addr = {
    .sin_family = AF_INET,
    .sin_port = htons(80),
};
net_addr_pton(AF_INET, "93.184.216.34", &addr.sin_addr);
zsock_connect(sock, (struct sockaddr *)&addr, sizeof(addr));
```

## When SPI Ethernet Makes Sense

SPI Ethernet is not a universal solution. The decision between integrated MAC and SPI-attached module depends on several factors:

| Scenario | Recommendation |
|----------|---------------|
| MCU has no Ethernet MAC (RP2040, nRF52) | SPI module is the only option |
| Throughput requirement > 15 Mbps | Use MCU with integrated MAC + external PHY |
| Need 8 simultaneous connections | W5500 hardware sockets handle this efficiently |
| Host MCU has < 32 KB SRAM | W5500 offloads TCP/IP stack, saves ~20 KB RAM |
| Multiple network interfaces needed | ESP32 + W5500 gives WiFi + wired Ethernet |
| Industrial with existing Ethernet infrastructure | Integrated MAC preferred for reliability |
| Prototype / proof of concept | SPI module is fastest path to a working demo |

## Tips

- Always use DMA for SPI transfers to the W5500. CPU-driven SPI (bit-banging or polling) cuts throughput by 3–5x. On STM32, configure the SPI DMA channel in CubeMX. On RP2040, use PIO-driven SPI for maximum clock rate.
- Configure the W5500 interrupt pin (INTn) rather than polling status registers. The interrupt signals socket events (data received, connection established, connection closed) and eliminates the overhead of periodic SPI reads. Connect INTn to a GPIO with external interrupt capability.
- For the W5500, set the socket buffer allocation to match the application. A single HTTP client using one socket benefits from a 16 KB TX + 16 KB RX allocation, while an MQTT broker serving 8 clients needs the default 2 KB per socket.
- The W5500 CS (chip select) line must be driven cleanly — avoid sharing the SPI bus with slow devices that hold CS low for extended periods. If bus sharing is necessary, ensure the W5500 CS toggles completely between transactions to avoid state machine corruption.
- When using the ENC28J60, allocate the 8 KB buffer asymmetrically: 6.5 KB for RX and 1.5 KB for TX. Most embedded applications receive more data than they send, and a small RX buffer causes overflow-induced packet loss under load.

## Caveats

- **W5500 hardware TCP has limited configurability** — The hardwired stack does not support TCP options like window scaling, selective acknowledgments (SACK), or timestamps. For LAN applications this is irrelevant, but over high-latency or lossy links, the fixed 16 KB window size limits throughput to approximately 1.6 Mbps per 100 ms of RTT (bandwidth-delay product).
- **The ENC28J60 silicon has known errata** — Revision B7 (the most common) has issues with receive buffer pointer wraparound and SPI clock timing. The workaround is to read the EPKTCNT register to determine if packets are available rather than relying on the PKTIF flag, and to ensure SPI clock does not exceed 8 MHz during certain register access patterns. The Microchip errata document (DS80349C) is required reading.
- **SPI bus contention causes subtle failures** — If the W5500 shares an SPI bus with an SD card, display, or sensor, bus arbitration delays can cause socket timeouts. The W5500 expects prompt servicing of its internal state machine, and holding off SPI access for more than a few milliseconds during an active TCP connection can trigger retransmissions.
- **W5500 power supply decoupling is critical** — The chip draws current spikes of 200–300 mA during transmission. A 10 uF + 100 nF decoupling capacitor pair close to the VCC pins prevents supply droops that cause SPI communication errors or PHY link drops.
- **MAC address management is the application's responsibility** — Both W5500 and ENC28J60 require the host MCU to provide a MAC address. Using a hardcoded address in firmware works for single devices but causes collisions in production. WIZnet sells pre-programmed OUI chips, or the MAC can be derived from the MCU's unique ID.

## In Practice

- A W5500 module that initializes successfully (version register reads 0x04) but never achieves a link typically has a magnetics or RJ45 wiring issue on the module. Checking the link LED on the magjack confirms whether the PHY layer is functioning independently of the SPI interface.
- An application that sends small MQTT messages (< 100 bytes) every 5 seconds does not benefit from throughput optimization. At this data rate, even a CPU-polled SPI at 1 MHz is more than sufficient. The engineering effort is better spent on robust reconnection logic and socket timeout handling.
- A Raspberry Pi Pico (RP2040) with a W5500 module makes an effective wired IoT sensor node at ~$8 total BOM cost. The RP2040's dual cores allow running the network stack on core 1 while sensor acquisition runs on core 0, avoiding timing conflicts.
- When debugging W5500 communication failures, reading the chip version register (address 0x0039 in Common Register block, expected value 0x04) is the first diagnostic step. If this read returns 0x00 or 0xFF, the SPI connection is not working — check MOSI/MISO wiring, CS polarity, SPI mode (Mode 0 or Mode 3 both work), and clock speed.
- Switching from ENC28J60 to W5500 in an existing design typically saves 15–25 KB of host MCU RAM by eliminating the lwIP stack. On an ATmega2560 with 8 KB SRAM, this is the difference between a working and a non-working design.
