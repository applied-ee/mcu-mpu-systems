---
title: "Link Management & Diagnostics"
weight: 50
---

# Link Management & Diagnostics

An Ethernet link is not a fire-and-forget connection. Cables get unplugged, switches reboot, duplex mismatches degrade throughput silently, and long cable runs develop faults over time. On MCU-based devices that often run unattended for months or years, robust link management — detecting link state changes, diagnosing failures, and recovering automatically — is as important as getting the initial connection working. The PHY provides the raw link status and diagnostic capabilities through MDIO registers; the firmware must poll or react to these signals and take appropriate action.

## Link Up/Down Detection

The PHY reports link status in the Basic Status Register (BSR, register 0x01), bit 2. When the link is established (both the local PHY and the link partner have completed auto-negotiation), this bit is set. When the cable is disconnected or the link partner is powered off, this bit clears.

### Polling Approach

The simplest method reads BSR periodically from the main loop or a timer task:

```c
/* Link status polling — 500 ms interval */
#define PHY_BSR       0x01
#define BSR_LINK_UP   (1 << 2)

static bool link_was_up = false;

void link_check_task(void *arg) {
    while (1) {
        uint16_t bsr = phy_read(PHY_ADDR, PHY_BSR);
        /* Note: BSR link status is latched-low — read twice
         * to get current status after a link-down event */
        bsr = phy_read(PHY_ADDR, PHY_BSR);

        bool link_is_up = (bsr & BSR_LINK_UP) != 0;

        if (link_is_up && !link_was_up) {
            /* Link just came up */
            on_link_up();
        } else if (!link_is_up && link_was_up) {
            /* Link just went down */
            on_link_down();
        }
        link_was_up = link_is_up;

        vTaskDelay(pdMS_TO_TICKS(500));
    }
}
```

The BSR link status bit is **latched-low** — once it reads as 0 (link down), it remains 0 even if the link recovers, until the register is read again. This means a transient link drop between two polls will be detected. The double-read pattern in the code above ensures the second read returns the current state rather than the latched state.

### Interrupt Approach

Most PHYs provide an interrupt output (active-low open-drain) that fires on link status changes. This eliminates polling overhead and provides faster response:

```c
/* PHY interrupt configuration — LAN8720A example */

/* Enable link-up and link-down interrupts */
#define PHY_IMR       0x1E    /* Interrupt Mask Register */
#define IMR_LINK_DOWN (1 << 4)
#define IMR_LINK_UP   (1 << 0) /* Varies by PHY — check datasheet */

void phy_configure_interrupt(void) {
    /* Enable interrupt sources */
    uint16_t imr = IMR_LINK_DOWN | IMR_LINK_UP;
    phy_write(PHY_ADDR, PHY_IMR, imr);
}

/* GPIO EXTI ISR on the PHY interrupt pin */
void EXTI_PHY_IRQHandler(void) {
    /* Read interrupt status register to clear the interrupt */
    uint16_t isr = phy_read(PHY_ADDR, 0x1D);  /* ISR address */

    /* Defer processing to a task — do not call lwIP from ISR */
    BaseType_t higher_prio_woken = pdFALSE;
    xTaskNotifyFromISR(link_task_handle, isr,
                       eSetValueWithOverwrite, &higher_prio_woken);
    portYIELD_FROM_ISR(higher_prio_woken);
}

void link_event_task(void *arg) {
    while (1) {
        uint32_t isr_value;
        xTaskNotifyWait(0, ULONG_MAX, &isr_value, portMAX_DELAY);

        uint16_t bsr = phy_read(PHY_ADDR, PHY_BSR);
        bsr = phy_read(PHY_ADDR, PHY_BSR);  /* Double-read */

        if (bsr & BSR_LINK_UP) {
            on_link_up();
        } else {
            on_link_down();
        }
    }
}
```

The PHY interrupt pin needs a pull-up (typically 10 kOhm to 3.3 V) since it is open-drain. Some eval boards omit this pull-up, causing the interrupt to never trigger — a common source of "interrupt not working" issues.

### Link State Machine

A robust Ethernet application implements a state machine that tracks the link and network layer status:

```
┌──────────┐   PHY link up   ┌───────────────┐
│  LINK    │────────────────►│  LINK UP      │
│  DOWN    │                 │  (no IP yet)  │
└──────────┘                 └───────┬───────┘
     ▲                               │ DHCP complete
     │                               ▼
     │                       ┌───────────────┐
     │ PHY link down         │  CONNECTED    │
     │◄──────────────────────│  (IP assigned)│
     │                       └───────┬───────┘
     │                               │ Application timeout
     │                               │ or keepalive failure
     │                               ▼
     │                       ┌───────────────┐
     │◄──────────────────────│  DISCONNECTED │
     │                       │  (stale IP)   │
                             └───────────────┘
```

The distinction between LINK UP and CONNECTED matters: the link can be up (PHY layer established) while the IP address is not yet assigned (DHCP in progress) or has expired. Similarly, the link can be up and the IP assigned, but the remote server is unreachable (application-layer disconnect).

## Auto-MDIX

Auto-MDIX (Automatic Medium-Dependent Interface Crossover) eliminates the need for crossover cables. The PHY detects whether a straight-through or crossover cable is connected and internally swaps the TX/RX pairs if necessary. All modern PHYs (LAN8720A, DP83848, KSZ8081) support auto-MDIX by default.

When auto-MDIX is enabled, the PHY performs the following at link negotiation:

1. Transmits pulses on the TX pair
2. Listens for link partner pulses on the RX pair
3. If no partner pulses are detected on RX, swaps TX and RX internally and retries
4. Link negotiation proceeds once the correct pairing is found

This adds 200–500 ms to the link-up time compared to a correctly wired connection, since the PHY may need one failed attempt before swapping.

Auto-MDIX can be disabled for deterministic behavior in point-to-point industrial links:

```c
/* Disable auto-MDIX on DP83848 */
/* PHYCR register (0x19), bit 15 = MDIX_EN, bit 14 = FORCE_MDIX */
uint16_t phycr = phy_read(PHY_ADDR, 0x19);
phycr &= ~(1 << 15);  /* Disable auto-MDIX */
phycr &= ~(1 << 14);  /* Force MDI (straight-through) */
phy_write(PHY_ADDR, 0x19, phycr);
```

## Cable Diagnostics (TDR)

Some higher-end PHYs include Time-Domain Reflectometry (TDR) — a diagnostic mode that sends a pulse down the cable and measures the reflection to determine cable length, detect opens, shorts, and impedance mismatches.

PHYs with TDR capability:

| PHY | Vendor | TDR Features | Accuracy |
|-----|--------|-------------|----------|
| 88E1512 | Marvell | Per-pair length, open/short/impedance mismatch | +/- 1 m |
| DP83869 | TI | Per-pair cable diagnostics | +/- 2 m |
| KSZ9131 | Microchip | LinkMD cable diagnostics | +/- 2 m |
| RTL8211F | Realtek | Cable length estimation | +/- 5 m |

TDR is not available on the low-cost PHYs commonly used in MCU designs (LAN8720A, DP83848, KSZ8081). Adding TDR diagnostics requires selecting a more capable (and more expensive, $3–$5) PHY.

### TDR Operation on Marvell 88E1512

```c
/* Marvell 88E1512 TDR diagnostics (simplified) */

/* Step 1: Select page 7 (cable diagnostics) */
phy_write(PHY_ADDR, 22, 7);  /* Page register */

/* Step 2: Start TDR on pair A */
phy_write(PHY_ADDR, 21, 0x8000 | (0 << 13));  /* Enable TDR, pair A */

/* Step 3: Wait for completion */
uint16_t result;
do {
    result = phy_read(PHY_ADDR, 21);
} while (result & 0x8000);  /* Wait for TDR complete */

/* Step 4: Read results */
uint16_t status = (result >> 13) & 0x03;
/*   0 = pair OK
 *   1 = pair open
 *   2 = pair short
 *   3 = impedance mismatch */

uint16_t distance = result & 0x00FF;  /* Distance in meters */

/* Step 5: Restore page 0 */
phy_write(PHY_ADDR, 22, 0);
```

For PHYs without TDR, cable length can be roughly estimated from the signal attenuation. Some PHYs expose a signal quality indicator (SQI) or SNR estimate through vendor-specific registers. A 10 m cable shows significantly better SNR than a 90 m cable, but the mapping from SNR to distance is approximate at best.

## Duplex Mismatch Detection

A duplex mismatch — one side running full-duplex while the other runs half-duplex — is one of the most insidious Ethernet problems. The link appears up, and low-traffic operation works normally. Under load, performance degrades severely because the full-duplex side transmits without checking for carrier sense, while the half-duplex side detects collisions and backs off.

### Symptoms

| Symptom | Measurement |
|---------|-------------|
| Throughput far below expected | 1–5 Mbps on a 100 Mbps link |
| Late collision counter increasing | Read from MAC statistics or PHY vendor registers |
| FCS (CRC) errors on receive | Frames corrupted by collision |
| High retransmission rate | TCP retransmissions > 5% |
| Asymmetric performance | Upload OK, download degraded (or vice versa) |

### Detection

```c
/* Check for duplex mismatch indicators */

/* Read local PHY negotiated duplex */
uint16_t anar = phy_read(PHY_ADDR, 0x04);  /* Our advertisement */
uint16_t anlpar = phy_read(PHY_ADDR, 0x05); /* Partner advertisement */

bool local_fd = /* from vendor-specific register or BCR forced setting */;
bool partner_advertises_fd = (anlpar & (1 << 8)) ||  /* 100BASE-TX FD */
                              (anlpar & (1 << 6));    /* 10BASE-T FD */

if (local_fd && !partner_advertises_fd) {
    /* Potential duplex mismatch — local is full-duplex but
     * partner did not advertise full-duplex capability.
     * This usually means the partner is forced to half-duplex
     * while the local side auto-negotiated. */
    log_warning("Duplex mismatch suspected: local FD, partner HD");
}

/* Also check MAC-level statistics if available */
/* On STM32, read ETH_MMCTGFMSCCR (TX frames with multiple collision) */
/* High late-collision counts confirm the mismatch */
```

The fix is always the same: ensure both sides use auto-negotiation, or ensure both sides are forced to the same speed and duplex. Never force one side while leaving the other on auto-negotiation.

## TCP Keepalive for Silent Disconnects

A physical link can remain up while the logical path to a remote server is broken — a router reboots, a VLAN is reconfigured, or the server crashes without sending a TCP FIN. TCP keepalive sends periodic probes on idle connections to detect this condition.

### lwIP Keepalive Configuration

```c
/* lwipopts.h */
#define LWIP_TCP_KEEPALIVE          1

/* Keepalive timing */
#define TCP_KEEPIDLE_DEFAULT        30000   /* 30 seconds idle before probes */
#define TCP_KEEPINTVL_DEFAULT       5000    /* 5 seconds between probes */
#define TCP_KEEPCNT_DEFAULT         4       /* 4 failed probes = dead */
/* Total detection time: 30 + (5 * 4) = 50 seconds */
```

```c
/* Enable keepalive on a specific socket (Socket API) */
int optval = 1;
setsockopt(sock, SOL_SOCKET, SO_KEEPALIVE, &optval, sizeof(optval));

/* Optionally override per-socket timing (lwIP extension) */
int idle = 15;    /* seconds */
int intvl = 3;    /* seconds */
int cnt = 5;      /* probes */
setsockopt(sock, IPPROTO_TCP, TCP_KEEPIDLE, &idle, sizeof(idle));
setsockopt(sock, IPPROTO_TCP, TCP_KEEPINTVL, &intvl, sizeof(intvl));
setsockopt(sock, IPPROTO_TCP, TCP_KEEPCNT, &cnt, sizeof(cnt));
```

Application-layer keepalives (MQTT PINGREQ, WebSocket ping frames) provide an additional detection layer and are preferable when the protocol supports them, since they validate the full application path rather than just TCP connectivity.

## DHCP Re-Lease on Link Restore

When a link drops and recovers, the device's IP address may no longer be valid — the DHCP lease may have expired during the outage, or the device may have been moved to a different network segment. Proper handling requires restarting DHCP on link-up:

```c
void on_link_up(void) {
    /* Read negotiated speed/duplex and configure MAC accordingly */
    uint16_t scsr = phy_read(PHY_ADDR, 0x1F);  /* LAN8720A-specific */
    configure_mac_speed_duplex(scsr);

    /* Bring the network interface up */
    netif_set_link_up(&eth_netif);

    /* Restart DHCP to acquire or renew address */
    dhcp_release(&eth_netif);
    dhcp_start(&eth_netif);

    log_info("Ethernet link up — DHCP restarted");
}

void on_link_down(void) {
    netif_set_link_down(&eth_netif);

    /* Optionally stop DHCP to prevent timeouts */
    dhcp_stop(&eth_netif);

    /* Notify application layer */
    notify_app_disconnect();

    log_info("Ethernet link down");
}
```

On STM32 with CubeMX-generated code, the `ethernetif_notify_conn_changed()` callback in `ethernetif.c` provides the hook for link change events. This function is generated as a weak symbol and should be overridden in application code.

### Static IP Considerations

For devices with static IP addresses, link-down/link-up does not require DHCP handling, but the network interface still needs to be brought down and back up. Sending a gratuitous ARP on link-up ensures that switches and routers update their ARP tables:

```c
void on_link_up_static(void) {
    configure_mac_speed_duplex();
    netif_set_link_up(&eth_netif);

    /* Send gratuitous ARP to update network ARP caches */
    etharp_gratuitous(&eth_netif);
}
```

## PHY LED Configuration

Most PHYs provide two LED outputs that indicate link status and activity. The LED behavior is configurable through vendor-specific registers, allowing the firmware to customize what each LED shows.

### Common LED Modes

| Mode | LED behavior |
|------|-------------|
| Link | Solid on when link is up, off when link is down |
| Activity | Blinks on TX/RX frame activity |
| Link + Activity | Solid on when link up, blinks on activity |
| Speed | On for 100 Mbps, off for 10 Mbps |
| Full-duplex | On when full-duplex negotiated |
| Collision | Blinks on collision detection |

### LAN8720A LED Configuration

The LAN8720A has two LED outputs (LED1 and LED2) configurable through the Special Modes Register (0x12) and the PHY Special Control/Status Register (0x1F):

```c
/* LAN8720A default LED behavior:
 * LED1 (green): Speed — ON for 100 Mbps, OFF for 10 Mbps
 * LED2 (yellow): Link + Activity — ON when link up, blinks on activity
 *
 * To customize (example: LED1=Link, LED2=Activity):
 */

/* Read current PSCSR */
uint16_t pscsr = phy_read(PHY_ADDR, 0x1F);

/* Modify LED mode bits [5:4] */
pscsr &= ~(0x03 << 4);
pscsr |= (0x01 << 4);  /* Mode 01: LED1=Link, LED2=TX/RX activity */
phy_write(PHY_ADDR, 0x1F, pscsr);
```

LED outputs are typically active-low open-drain, sinking current through the LED and its series resistor to VCC. A 1–2 mA drive (330–1 kOhm resistor with 3.3 V supply) provides visible indication without contributing significant power draw.

## Ethernet Frame Counters

The MAC peripheral on most MCUs maintains hardware frame counters that are invaluable for debugging network issues. On STM32, the MAC Management Counters (MMC) provide per-counter statistics:

| Counter Register | Description | Diagnostic Use |
|-----------------|-------------|----------------|
| ETH_MMCTGFCR | TX good frames | Baseline TX activity |
| ETH_MMCTGFMSCCR | TX frames with multiple collisions | Duplex mismatch indicator |
| ETH_MMCRGUFCR | RX good unicast frames | Baseline RX activity |
| ETH_MMCRFCECR | RX frames with CRC error | Cable or EMI problems |
| ETH_MMCRFAECR | RX frames with alignment error | PHY or timing issues |
| ETH_MMCRGOFCR | RX overflow frames | DMA or PBUF starvation |

```c
/* Reading STM32 MAC MMC counters */
typedef struct {
    uint32_t tx_good;
    uint32_t tx_multi_collision;
    uint32_t rx_good_unicast;
    uint32_t rx_crc_error;
    uint32_t rx_alignment_error;
    uint32_t rx_overflow;
} eth_stats_t;

void read_eth_stats(eth_stats_t *stats) {
    stats->tx_good           = ETH->MMCTGFCR;
    stats->tx_multi_collision = ETH->MMCTGFMSCCR;
    stats->rx_good_unicast   = ETH->MMCRGUFCR;
    stats->rx_crc_error      = ETH->MMCRFCECR;
    stats->rx_alignment_error = ETH->MMCRFAECR;
    stats->rx_overflow       = ETH->MMCRGOFCR;
}

void print_eth_stats(const eth_stats_t *stats) {
    printf("TX good:        %lu\n", stats->tx_good);
    printf("TX multi-coll:  %lu\n", stats->tx_multi_collision);
    printf("RX good uni:    %lu\n", stats->rx_good_unicast);
    printf("RX CRC err:     %lu\n", stats->rx_crc_error);
    printf("RX align err:   %lu\n", stats->rx_alignment_error);
    printf("RX overflow:    %lu\n", stats->rx_overflow);
}
```

Sampling these counters every 10–60 seconds and logging the deltas reveals trends that are invisible to the application layer. A steady trickle of CRC errors (1–10 per minute) suggests marginal cable quality or EMI, while a burst of overflow errors indicates the MCU is not servicing DMA descriptors fast enough (often due to a higher-priority task starving the network processing).

## Tips

- Always double-read the BSR link status register. The latched-low behavior means the first read after a link-down event returns 0 regardless of the current link state. The second read returns the actual current status. Forgetting this causes false link-down detection.
- Use the PHY interrupt pin whenever possible — polling MDIO at 500 ms intervals means link changes are detected with up to 500 ms latency. The PHY interrupt fires within microseconds of the link state change, enabling faster recovery.
- Log the negotiated speed and duplex on every link-up event. This catches duplex mismatches and unexpected fallback to 10 Mbps early, before they manifest as mysterious throughput problems.
- Wire both PHY LEDs to visible indicators on the enclosure. Even in production, a quick visual check ("is the link LED on? is the activity LED blinking?") saves minutes of remote debugging. Many field failures are simply unplugged cables.
- Include a CLI command or diagnostic endpoint that prints MAC frame counters and PHY register dumps. This allows remote troubleshooting without physical access to the device. A JSON endpoint at `/api/eth/diag` that returns counters and PHY status is invaluable for fleet management.

## Caveats

- **PHY interrupt registers are clear-on-read** — Reading the interrupt status register clears the pending interrupt flags. If the ISR reads the register but fails to process the event (e.g., due to a task notification failure), the event is lost. Always process or queue the interrupt status value atomically.
- **Link-down does not invalidate TCP connections immediately** — TCP connections survive brief link-down periods (a few seconds). The TCP stack retransmits unacknowledged data when the link returns. For longer outages, TCP timeouts eventually close the connection, but this can take minutes with default timeout values. Application-layer keepalives provide faster detection.
- **MDIO bus errors are not recoverable without PHY reset** — If the MDIO bus gets into an undefined state (noise on MDC, glitch on MDIO during a transaction), subsequent reads may return garbage. Toggling the PHY hardware reset pin is the only reliable recovery. Including a PHY reset GPIO in the design enables software-initiated recovery.
- **Auto-MDIX interacts with link-up timing** — If auto-MDIX needs to swap the TX/RX pairs, the link-up takes an additional 200–500 ms. Applications that measure "time to network ready" should account for this variable.
- **MAC counter overflow is not signaled** — The 32-bit MMC counters roll over silently at 2^32. For a device transmitting at 100 Mbps (approximately 8,000 frames/second for 1500-byte frames), the TX good frame counter overflows after approximately 6 days. Read and accumulate counters at intervals shorter than the overflow period if long-term statistics are needed.

## In Practice

- A device that works on the bench but loses connectivity in the field every few hours is often experiencing link flaps caused by marginal cable connections, electromagnetic interference near the cable run, or a switch port with an intermittent hardware fault. Adding link-up/link-down event logging with timestamps reveals the pattern. If link flaps correlate with nearby machinery activation, the cable needs shielded (STP) replacement or rerouting.
- A field device reporting "connected but unable to reach server" while the link is up and the IP address is valid is typically experiencing a routing or VLAN issue. Sending a ping to the default gateway (if ICMP is implemented) distinguishes between "gateway unreachable" (layer 2/3 problem) and "server unreachable" (layer 3/4 problem). lwIP includes an ICMP implementation that can be used for diagnostic pings.
- An STM32 + LAN8720A design that shows an increasing RX CRC error count (hundreds per hour) on a known-good cable and switch port is likely experiencing ground noise coupling into the RMII data signals. Verifying the ground plane continuity under the RMII traces and adding ferrite beads on the power supply lines often resolves this. The CRC error counter is the first indicator — application-layer symptoms (slow throughput, occasional disconnects) only appear when the error rate exceeds 1–2%.
- A device with DHCP that occasionally comes up with an IP of 0.0.0.0 (or 169.254.x.x link-local) after a power cycle is failing the DHCP exchange. The most common cause is the network interface starting before the switch port is ready — managed switches often take 30–45 seconds after power-on to enable ports (due to Spanning Tree Protocol). Adding a configurable DHCP retry delay (3–5 seconds between attempts, up to 5 attempts) handles this gracefully.
- Monitoring frame counters across a fleet of deployed devices reveals systemic issues. If 10% of devices in a building show elevated CRC errors, the building's cabling infrastructure (patch panels, wall jacks, cable runs) is suspect. If a single device shows errors, the problem is local to that device or its cable. This aggregate analysis is only possible when the firmware exposes counters through a management interface.
