---
title: "lwIP & Embedded TCP/IP Stacks"
weight: 30
---

# lwIP & Embedded TCP/IP Stacks

lwIP (lightweight IP) is the dominant TCP/IP stack for bare-metal and RTOS-based microcontrollers. Written by Adam Dunkels and maintained as an open-source project, it runs on platforms with as little as 40 KB of RAM and provides a functional IPv4/IPv6 stack with TCP, UDP, DHCP, DNS, ICMP, IGMP, and ARP. ESP-IDF, STM32 CubeMX, NXP MCUXpresso, and TI SimpleLink all ship lwIP as their default network stack. Understanding its internal architecture — particularly the three API levels, memory management, and RTOS integration — is essential for debugging the throughput bottlenecks, memory leaks, and connection failures that inevitably arise in embedded networking.

## Three API Levels

lwIP provides three distinct programming interfaces, each with different complexity, performance, and RTOS requirements:

### Raw (Callback) API

The raw API is the lowest-level and most performant interface. Application code registers callback functions that lwIP invokes directly from the network stack's context when events occur (data received, connection established, data sent acknowledged). No RTOS is required — lwIP can run in a bare-metal superloop with periodic calls to `sys_check_timeouts()`.

```c
/* Raw API — TCP echo server */
static err_t echo_recv_cb(void *arg, struct tcp_pcb *pcb,
                          struct pbuf *p, err_t err) {
    if (p == NULL) {
        /* Connection closed by remote */
        tcp_close(pcb);
        return ERR_OK;
    }
    /* Echo data back */
    tcp_write(pcb, p->payload, p->len, TCP_WRITE_FLAG_COPY);
    tcp_output(pcb);
    pbuf_free(p);
    return ERR_OK;
}

static err_t echo_accept_cb(void *arg, struct tcp_pcb *newpcb, err_t err) {
    tcp_recv(newpcb, echo_recv_cb);
    return ERR_OK;
}

void echo_server_init(void) {
    struct tcp_pcb *pcb = tcp_new();
    tcp_bind(pcb, IP_ADDR_ANY, 7);  /* Port 7 = echo */
    pcb = tcp_listen(pcb);
    tcp_accept(pcb, echo_accept_cb);
}

/* In main loop (bare-metal): */
while (1) {
    ethernetif_input(&netif);    /* Poll for received frames */
    sys_check_timeouts();         /* Process lwIP timers */
}
```

**Advantages**: Zero-copy possible (no data copying between stack and application), lowest RAM overhead, no RTOS dependency. **Disadvantages**: Complex flow control, callbacks execute in interrupt or stack context, reentrancy pitfalls, difficult to write sequential protocol logic.

### Netconn API

The netconn API provides a sequential (blocking) interface that wraps the raw API. It requires an RTOS because blocking calls suspend the calling thread while waiting for network events. An internal `tcpip_thread` processes raw API callbacks and communicates with application threads through mailboxes.

```c
/* Netconn API — TCP echo server */
void echo_server_task(void *arg) {
    struct netconn *conn = netconn_new(NETCONN_TCP);
    netconn_bind(conn, IP_ADDR_ANY, 7);
    netconn_listen(conn);

    while (1) {
        struct netconn *newconn;
        if (netconn_accept(conn, &newconn) == ERR_OK) {
            struct netbuf *buf;
            while (netconn_recv(newconn, &buf) == ERR_OK) {
                /* Echo data back */
                netconn_write(newconn, netbuf_data(buf),
                             netbuf_len(buf), NETCONN_COPY);
                netbuf_delete(buf);
            }
            netconn_close(newconn);
            netconn_delete(newconn);
        }
    }
}
```

**Advantages**: Sequential code flow, easier to write and debug than raw callbacks, reasonable performance. **Disadvantages**: Requires RTOS, one thread per connection model can exhaust task stack space with many connections, slight overhead from mailbox communication.

### Socket (BSD) API

The socket API provides a POSIX-like BSD socket interface built on top of the netconn API. It maps `socket()`, `bind()`, `listen()`, `accept()`, `recv()`, `send()`, `select()`, and `close()` to lwIP operations.

```c
/* Socket API — TCP echo server */
void echo_server_task(void *arg) {
    int listenfd = socket(AF_INET, SOCK_STREAM, 0);

    struct sockaddr_in addr;
    addr.sin_family = AF_INET;
    addr.sin_port = htons(7);
    addr.sin_addr.s_addr = INADDR_ANY;

    bind(listenfd, (struct sockaddr *)&addr, sizeof(addr));
    listen(listenfd, 5);

    while (1) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        int clientfd = accept(listenfd, (struct sockaddr *)&client_addr,
                              &client_len);

        char buf[1024];
        int n;
        while ((n = recv(clientfd, buf, sizeof(buf), 0)) > 0) {
            send(clientfd, buf, n, 0);
        }
        close(clientfd);
    }
}
```

**Advantages**: Portable code (same API as Linux/BSD), easiest to write, familiar to most developers. **Disadvantages**: Highest overhead (extra layer of indirection over netconn), file descriptor table consumes RAM, `select()` implementation is less efficient than Linux's.

### API Comparison

| Feature | Raw API | Netconn API | Socket API |
|---------|---------|-------------|------------|
| RTOS required | No | Yes | Yes |
| Code complexity | High (callbacks) | Medium (sequential) | Low (BSD standard) |
| RAM overhead | Lowest | Moderate | Highest |
| Throughput | Best | Good | Good (slightly less) |
| Portability | lwIP-specific | lwIP-specific | POSIX-compatible |
| Zero-copy | Possible | No | No |
| Concurrent connections | Manual management | One thread per conn | One thread per conn |
| Typical use case | Bare-metal, high perf | RTOS applications | RTOS, ported code |

## Memory Configuration

lwIP memory management is the most common source of runtime failures in embedded networking. Two memory systems operate in parallel:

### MEMP Pools

MEMP pools are fixed-size pools of pre-allocated structures. Each pool holds a specific object type (TCP PCBs, UDP PCBs, PBUFs, timers). The pool sizes are set at compile time via `lwipopts.h` and cannot grow at runtime.

Key pool configuration parameters:

| Parameter | Default | Description | Typical Embedded Value |
|-----------|---------|-------------|----------------------|
| `MEMP_NUM_TCP_PCB` | 5 | Active TCP connections | 4–16 |
| `MEMP_NUM_TCP_PCB_LISTEN` | 8 | Listening TCP sockets | 2–4 |
| `MEMP_NUM_UDP_PCB` | 4 | UDP endpoints | 2–8 |
| `MEMP_NUM_PBUF` | 16 | Protocol/header PBUFs | 16–32 |
| `MEMP_NUM_TCP_SEG` | 16 | Queued TCP segments | 16–64 |
| `MEMP_NUM_NETCONN` | 4 | Netconn/socket structures | 4–8 |
| `MEMP_NUM_NETBUF` | 2 | Netbuf structures | 2–8 |
| `MEMP_NUM_SYS_TIMEOUT` | 6 | Pending timeout callbacks | 8–12 |

### PBUF Allocation

PBUFs (packet buffers) are lwIP's fundamental data container. Three types exist:

- **PBUF_POOL** — Allocated from a pool of fixed-size chunks (default 1536 bytes = Ethernet MTU + headers). Used for incoming packets from the network driver. Pool size set by `PBUF_POOL_SIZE` (default 16).
- **PBUF_RAM** — Allocated from the heap (`MEM_SIZE`). Used for outgoing data created by the application. Variable size, subject to heap fragmentation.
- **PBUF_REF/ROM** — References existing data without copying. Zero-copy for constant data (HTTP response headers, static web pages).

```c
/* lwipopts.h — memory configuration for STM32F407 (192 KB SRAM) */

/* Heap for PBUF_RAM and general allocations */
#define MEM_SIZE                (16 * 1024)   /* 16 KB heap */
#define MEM_ALIGNMENT           4             /* ARM Cortex-M alignment */

/* PBUF pool for incoming packets */
#define PBUF_POOL_SIZE          12            /* 12 buffers */
#define PBUF_POOL_BUFSIZE       1536          /* Ethernet MTU + headers */
/* Total PBUF pool: 12 * 1536 = ~18 KB */

/* TCP configuration */
#define MEMP_NUM_TCP_PCB        8
#define MEMP_NUM_TCP_PCB_LISTEN 4
#define MEMP_NUM_TCP_SEG        32
#define TCP_MSS                 1460          /* Standard for Ethernet */
#define TCP_WND                 (4 * TCP_MSS) /* 5840 bytes recv window */
#define TCP_SND_BUF             (4 * TCP_MSS) /* 5840 bytes send buffer */
#define TCP_SND_QUEUELEN        (2 * TCP_SND_BUF / TCP_MSS)

/* Total lwIP RAM: ~40 KB (heap + pools + PCBs + segments) */
```

### Memory Budget Estimation

| Component | Formula | Typical Size |
|-----------|---------|-------------|
| PBUF pool | `PBUF_POOL_SIZE * PBUF_POOL_BUFSIZE` | 16 * 1536 = 24 KB |
| Heap | `MEM_SIZE` | 8–16 KB |
| TCP PCBs | `MEMP_NUM_TCP_PCB * ~160 bytes` | 8 * 160 = 1.3 KB |
| TCP segments | `MEMP_NUM_TCP_SEG * ~32 bytes` | 32 * 32 = 1 KB |
| UDP PCBs | `MEMP_NUM_UDP_PCB * ~48 bytes` | 4 * 48 = 192 B |
| Netconn structs | `MEMP_NUM_NETCONN * ~64 bytes` | 4 * 64 = 256 B |
| **Total** | | **30–45 KB** |

On an STM32F407 with 192 KB SRAM, lwIP typically consumes 30–45 KB, leaving 147–162 KB for the application, RTOS stacks, and peripheral buffers. On a Pico W with 264 KB, lwIP plus the CYW43 driver together consume approximately 50–60 KB.

## RTOS Integration

When running with an RTOS (FreeRTOS, Zephyr, ThreadX), lwIP uses a dedicated `tcpip_thread` that processes all stack operations. Application threads communicate with `tcpip_thread` through a mailbox (message queue). This architecture ensures thread safety — the lwIP core is single-threaded and does not require internal locking.

```
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  App Thread 1 │   │  App Thread 2 │   │  App Thread 3 │
│  (HTTP client)│   │  (MQTT)       │   │  (TCP server) │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │ netconn/socket    │                   │
        ▼                   ▼                   ▼
┌────────────────────────────────────────────────────────┐
│                    Mailbox (Queue)                      │
└────────────────────────────┬───────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  tcpip_thread   │
                    │  (lwIP core)    │
                    │  - TCP/UDP      │
                    │  - IP routing   │
                    │  - ARP/ICMP     │
                    │  - Timers       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Network Driver │
                    │  (ethernetif)   │
                    └─────────────────┘
```

The `tcpip_thread` stack size should be set to at least 1024–2048 bytes for basic TCP/UDP, or 4096+ bytes if running a DNS resolver or DHCP client (both use stack-allocated buffers for hostname processing).

### Thread-Safety Rules

- **Never call raw API functions from application threads** — raw API functions are not thread-safe and must only run in `tcpip_thread` context.
- **Use `tcpip_callback()` to execute code in stack context** — pass a function pointer that will be called from `tcpip_thread`.
- **Netconn and socket APIs are thread-safe** — they internally post messages to `tcpip_thread` and block until completed.
- **Guard `netif` operations** — adding, removing, or modifying network interfaces must happen from `tcpip_thread` or be wrapped in `LOCK_TCPIP_CORE()` / `UNLOCK_TCPIP_CORE()`.

## DHCP Client

lwIP includes a DHCP client that handles address acquisition, renewal, and rebinding. Activation is straightforward:

```c
/* Start DHCP on a network interface */
#include "lwip/dhcp.h"

netif_set_up(&netif);
dhcp_start(&netif);

/* Check for address assignment (polling) */
while (netif.ip_addr.addr == 0) {
    vTaskDelay(pdMS_TO_TICKS(100));
}
/* Address assigned — netif.ip_addr now valid */
```

DHCP adds approximately 2–4 KB of code and requires `LWIP_DHCP = 1` in `lwipopts.h`. The typical lease acquisition takes 1–3 seconds. The DHCP client handles lease renewal automatically in the background through lwIP's timer system.

## DNS Resolver

lwIP's DNS resolver supports up to `DNS_MAX_SERVERS` (default 2) servers and caches results with TTL-based expiration:

```c
/* DNS resolution (netconn/socket API) */
ip_addr_t resolved;
err_t err = netconn_gethostbyname("api.example.com", &resolved);
if (err == ERR_OK) {
    /* resolved contains the IP address */
}

/* Raw API — asynchronous DNS */
void dns_found_cb(const char *name, const ip_addr_t *ipaddr, void *arg) {
    if (ipaddr != NULL) {
        /* Resolution successful */
    } else {
        /* Resolution failed */
    }
}

ip_addr_t cached;
err_t err = dns_gethostbyname("api.example.com", &cached, dns_found_cb, NULL);
if (err == ERR_OK) {
    /* Result was cached — use cached immediately */
} else if (err == ERR_INPROGRESS) {
    /* Query sent — callback will fire when resolved */
}
```

## Alternative Embedded TCP/IP Stacks

While lwIP dominates, several alternatives exist for specific use cases:

| Stack | License | RTOS | RAM Footprint | Key Strength |
|-------|---------|------|--------------|-------------|
| lwIP | BSD | Any / bare-metal | 30–50 KB | Universal support, massive community |
| Zephyr native | Apache 2.0 | Zephyr only | 20–40 KB | Tight Zephyr integration, IPv6-first |
| NuttX netstack | Apache 2.0 | NuttX only | 40–60 KB | Full POSIX socket support |
| picoTCP | GPL 2.0 | Any | 20–40 KB | Modular, good for custom stacks |
| CycloneTCP | Commercial/GPL | Any | 30–50 KB | Certified for safety (IEC 62443) |
| FreeRTOS+TCP | MIT | FreeRTOS | 20–35 KB | Native FreeRTOS integration |

**Zephyr native stack** is worth noting — Zephyr RTOS includes its own TCP/IP implementation that does not use lwIP. It supports IPv6 natively (IPv4 is available but IPv6 is the default), includes 6LoWPAN for IEEE 802.15.4, and integrates with Zephyr's net_buf zero-copy buffer system. For Zephyr-based projects, using the native stack avoids the complexity of integrating lwIP as an external component.

**FreeRTOS+TCP** is Amazon's alternative to lwIP specifically for FreeRTOS. It uses FreeRTOS primitives directly (tasks, queues, semaphores) rather than lwIP's portable OS abstraction layer. Configuration is simpler than lwIP, but the ecosystem of examples and community support is smaller.

## Tips

- Start with the socket API for initial development, then profile and drop to netconn or raw API only if socket overhead is measurable. On a 240 MHz Cortex-M7, the difference between socket and raw API throughput is typically less than 5%.
- Set `LWIP_STATS = 1` during development to enable internal statistics counters. `stats_display()` prints protocol-level counters (TCP retransmissions, PBUF allocation failures, dropped packets) that reveal problems invisible at the application layer.
- Configure `TCP_WND` (receive window) to at least 4x `TCP_MSS` for reasonable throughput. A 1x MSS window forces stop-and-wait behavior, limiting throughput to one segment per round-trip time. On a LAN with 1 ms RTT, a 1460-byte window caps throughput at ~11 Mbps. A 5840-byte window (4x MSS) reaches ~46 Mbps theoretical.
- Use `PBUF_REF` for static content like HTTP headers or web page templates. This avoids copying constant data into heap-allocated PBUFs and saves both RAM and CPU cycles.
- Set `LWIP_TCP_KEEPALIVE = 1` and configure keepalive interval/count to detect silently dropped connections. The default TCP keepalive (2 hours) is too slow for most embedded applications — 30–60 seconds is more appropriate for IoT devices.

## Caveats

- **PCB exhaustion is the most common lwIP failure mode** — When all `MEMP_NUM_TCP_PCB` slots are occupied (by active connections or TIME_WAIT sockets), new connections silently fail. TCP connections remain in TIME_WAIT for 2x MSL (Maximum Segment Lifetime, default 120 seconds in lwIP). A device that opens and closes many short-lived connections can exhaust PCBs with TIME_WAIT entries. Setting `MEMP_NUM_TCP_PCB` high enough to cover peak concurrent connections plus TIME_WAIT count is essential.
- **PBUF starvation causes received packets to be silently dropped** — When the PBUF pool is exhausted, the network driver cannot allocate buffers for incoming frames, and they are discarded. The symptom is mysterious "connection reset" or "timeout" errors with no obvious cause. Monitoring `lwip_stats.memp[MEMP_PBUF_POOL].err` reveals how many allocations failed.
- **`MEM_SIZE` too small causes `tcp_write()` to return `ERR_MEM`** — Outgoing data is allocated from the heap (`MEM_SIZE`). If the heap is exhausted, `tcp_write()` fails. The fix is either increasing `MEM_SIZE` or throttling the application's send rate. Heap fragmentation can cause allocation failures even when total free heap appears sufficient.
- **lwIP timers must fire on schedule** — The DHCP client, ARP cache, TCP retransmission, and keepalive timers all depend on `sys_check_timeouts()` being called at least every 250 ms. In a bare-metal application, a long-running computation that blocks the main loop can cause DHCP lease expiration, TCP retransmission storms, or ARP cache corruption.
- **The default lwIP configuration is tuned for minimal RAM, not performance** — Most SDK-provided `lwipopts.h` files use conservative defaults (small windows, few PCBs, tiny heap). Increasing `TCP_WND`, `TCP_SND_BUF`, `PBUF_POOL_SIZE`, and `MEM_SIZE` typically doubles or triples throughput at the cost of 10–20 KB additional RAM.

## In Practice

- An HTTP server that handles 3–4 simultaneous clients but hangs when a 5th client connects is typically hitting `MEMP_NUM_TCP_PCB` exhaustion. Increasing the value from the default 5 to 12–16 resolves the immediate symptom, but auditing connection lifecycle to ensure `tcp_close()` or socket `close()` is called promptly prevents the underlying accumulation.
- A device that runs for hours then suddenly cannot resolve DNS names often has a DNS cache entry that expired while the DNS server became temporarily unreachable. lwIP's DNS client does not retry aggressively — configuring a secondary DNS server and setting `DNS_MAX_RETRIES = 4` improves resilience.
- TCP throughput that measures 2 Mbps on a 100 Mbps link is almost always a window size issue. Setting `TCP_WND = (8 * TCP_MSS)` (11,680 bytes) and `TCP_SND_BUF = (8 * TCP_MSS)` typically brings throughput to 30–50 Mbps on a Cortex-M4 at 168 MHz, assuming the MAC and DMA are properly configured.
- An MQTT client that connects to a broker but receives `ERR_MEM` when publishing large payloads (> 1 KB) is running into `TCP_SND_BUF` limits. The default send buffer is often 2x MSS (2920 bytes). Increasing to 4x or 8x MSS accommodates larger application-layer messages without fragmentation at the lwIP level.
- On ESP-IDF, lwIP configuration is managed through `menuconfig` (Component config → LWIP). The ESP-IDF defaults are more generous than stock lwIP but still conservative. For data-intensive applications, increasing `CONFIG_LWIP_TCP_WND_DEFAULT`, `CONFIG_LWIP_TCP_SND_BUF_DEFAULT`, and `CONFIG_LWIP_TCPIP_RECVMBOX_SIZE` from their defaults improves both throughput and connection stability.
- A common pattern when transitioning from prototype to production is observing intermittent connectivity under load that worked fine during bench testing. The root cause is almost always memory pool sizing — bench tests with 1–2 connections do not stress the PCB or PBUF pools, but production traffic with concurrent HTTP requests, MQTT keepalives, and NTP queries exhausts them. Enabling `LWIP_STATS` during load testing catches this before deployment.
