---
title: "Streaming Audio Protocols"
weight: 30
---

# Streaming Audio Protocols

Streaming audio from an MCU to a server (or between devices) over an IP network introduces challenges that do not exist in local playback: variable network latency, packet loss, jitter, and the need to maintain a continuous audio stream despite an unreliable transport. The protocol choice determines whether the system achieves low-latency monitoring (tens of milliseconds), reliable recording (no lost samples), or efficient broadcast to multiple listeners. Most embedded audio streaming runs over UDP (for low latency) or HTTP/WebSocket (for simplicity and firewall traversal).

## RTP/UDP for Low-Latency Audio

RTP (Real-time Transport Protocol) over UDP is the standard for low-latency audio streaming. RTP adds a 12-byte header with a timestamp, sequence number, and payload type identifier, enabling the receiver to detect packet loss and reorder out-of-sequence packets.

### RTP Packet Structure

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|X|  CC   |M|     PT      |       Sequence Number         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                           Timestamp                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                             SSRC                              |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Audio Payload                          |
|                            ...                                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### ESP32 RTP Audio Sender

```c
/* ESP32 — Minimal RTP sender for 16 kHz mono PCM */
#include "lwip/sockets.h"

#define RTP_HEADER_SIZE  12
#define SAMPLES_PER_PKT  320     /* 20 ms at 16 kHz */
#define PAYLOAD_SIZE     (SAMPLES_PER_PKT * 2)  /* 16-bit samples */

typedef struct {
    int sock;
    struct sockaddr_in dest;
    uint16_t seq;
    uint32_t timestamp;
    uint32_t ssrc;
} rtp_sender_t;

void rtp_send_audio(rtp_sender_t *rtp, const int16_t *samples)
{
    uint8_t packet[RTP_HEADER_SIZE + PAYLOAD_SIZE];

    /* RTP header */
    packet[0] = 0x80;  /* V=2, no padding, no extension, CC=0 */
    packet[1] = 11;    /* PT=11 (L16 mono), no marker */
    packet[2] = rtp->seq >> 8;
    packet[3] = rtp->seq & 0xFF;
    packet[4] = (rtp->timestamp >> 24) & 0xFF;
    packet[5] = (rtp->timestamp >> 16) & 0xFF;
    packet[6] = (rtp->timestamp >> 8) & 0xFF;
    packet[7] = rtp->timestamp & 0xFF;
    packet[8] = (rtp->ssrc >> 24) & 0xFF;
    packet[9] = (rtp->ssrc >> 16) & 0xFF;
    packet[10] = (rtp->ssrc >> 8) & 0xFF;
    packet[11] = rtp->ssrc & 0xFF;

    /* Payload — network byte order (big-endian) for L16 */
    for (int i = 0; i < SAMPLES_PER_PKT; i++) {
        packet[RTP_HEADER_SIZE + i * 2]     = (samples[i] >> 8) & 0xFF;
        packet[RTP_HEADER_SIZE + i * 2 + 1] = samples[i] & 0xFF;
    }

    sendto(rtp->sock, packet, sizeof(packet), 0,
           (struct sockaddr *)&rtp->dest, sizeof(rtp->dest));

    rtp->seq++;
    rtp->timestamp += SAMPLES_PER_PKT;
}
```

### Packet Size and Latency

Each RTP packet carries a fixed number of audio samples. The packet duration determines the minimum end-to-end latency:

| Samples/Packet | Duration (16 kHz) | Duration (48 kHz) | Packet Rate | Bandwidth (16-bit mono) |
|---|---|---|---|---|
| 80 | 5 ms | 1.67 ms | 200 pps | ~15 KB/s |
| 160 | 10 ms | 3.33 ms | 100 pps | ~14 KB/s |
| 320 | 20 ms | 6.67 ms | 50 pps | ~13 KB/s |
| 480 | 30 ms | 10 ms | 33 pps | ~13 KB/s |

Smaller packets reduce latency but increase per-packet overhead (UDP/IP headers add 28 bytes per packet). The 20 ms packet (320 samples at 16 kHz) is the standard trade-off, matching the Opus codec frame size.

## HTTP Streaming

For applications where latency is not critical (>500 ms acceptable), HTTP streaming is the simplest approach. The MCU acts as an HTTP server that streams audio data in response to GET requests, or as a client that POSTs audio to a server.

### Chunked Transfer Encoding

HTTP/1.1 chunked transfer encoding allows the MCU to stream audio of unknown duration:

```c
/* ESP32 HTTP server — stream WAV audio */
esp_err_t audio_stream_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "audio/wav");
    httpd_resp_set_hdr(req, "Transfer-Encoding", "chunked");

    /* Send WAV header */
    wav_header_t header = create_wav_header(16000, 1, 16, 0xFFFFFFFF);
    httpd_resp_send_chunk(req, (char *)&header, sizeof(header));

    /* Stream audio in chunks */
    int16_t buffer[512];
    while (is_recording) {
        size_t samples = capture_audio(buffer, 512);
        httpd_resp_send_chunk(req, (char *)buffer, samples * sizeof(int16_t));
    }

    httpd_resp_send_chunk(req, NULL, 0);  /* End of stream */
    return ESP_OK;
}
```

A browser or media player connecting to `http://<esp32-ip>/audio` receives a continuous WAV stream. This approach is simple and works through firewalls/NAT but adds 200–2000 ms of buffering latency in the player.

## WebSocket Audio

WebSocket provides a persistent, bidirectional connection suitable for real-time audio with moderate latency. Compared to raw UDP/RTP, WebSocket works through firewalls and proxies. Compared to HTTP streaming, it supports bidirectional communication (the server can send commands back to the MCU).

```c
/* ESP32 — WebSocket audio sender (binary frames) */
void websocket_audio_task(void *param)
{
    esp_websocket_client_handle_t client = /* ... initialized elsewhere ... */;
    int16_t buffer[256];

    while (1) {
        size_t samples = capture_audio(buffer, 256);
        esp_websocket_client_send_bin(client, (char *)buffer,
                                       samples * sizeof(int16_t),
                                       portMAX_DELAY);
    }
}
```

On the server side (Python example):

```python
import asyncio, websockets, struct

async def receive_audio(websocket):
    async for message in websocket:
        samples = struct.unpack(f'<{len(message)//2}h', message)
        # Process or save samples...

asyncio.run(websockets.serve(receive_audio, "0.0.0.0", 8765))
```

## Jitter Buffers

Network jitter — variation in packet arrival time — causes gaps or bunching in the audio stream. A jitter buffer sits between the network receiver and the audio output, accumulating packets and releasing them at a steady rate.

```
Network ──→ [Jitter Buffer] ──→ Playback (steady rate)
             (50-200 ms)
```

The jitter buffer introduces additional latency equal to its depth. A 100 ms jitter buffer absorbs network jitter up to ±50 ms but adds 100 ms to the end-to-end latency.

### Adaptive Jitter Buffer

A fixed-size jitter buffer wastes latency when the network is stable and underruns when it is not. An adaptive jitter buffer monitors packet arrival statistics and adjusts its depth:

- When packets arrive consistently, shrink the buffer (reduce latency).
- When jitter increases, grow the buffer (prevent underruns).

The adjustment is done by occasionally dropping a sample (to shrink) or inserting a duplicate sample (to grow) — these micro-adjustments are inaudible when spread over hundreds of milliseconds.

## Packet Loss Concealment

UDP does not guarantee delivery — packets can be lost, especially on WiFi. RTP sequence numbers detect gaps, and the receiver must decide how to fill them:

| Technique | Quality | CPU Cost | Description |
|---|---|---|---|
| Silence insertion | Poor | Zero | Replace lost packet with zeros — produces an audible click |
| Repeat last packet | Fair | Zero | Repeat the last successfully received packet — sounds frozen |
| Interpolation | Good | Low | Fade between last good sample and first sample of next packet |
| PLC (codec-internal) | Good | Low | Opus and G.711 Appendix I include built-in PLC algorithms |

Opus includes a native PLC mode: passing `NULL` as the input to `opus_decode()` generates a concealment frame based on the codec's internal state. This produces better results than any external technique because the codec has access to the decoded signal history.

## Tips

- For WiFi audio streaming on ESP32, use UDP with a jitter buffer rather than TCP. TCP retransmissions add unpredictable latency (100–500 ms on retransmit), which is worse than the occasional dropped packet that PLC can conceal.
- Send compressed audio (Opus, ADPCM) over the network rather than raw PCM. At 16 kbps Opus vs 256 kbps PCM (16 kHz mono), the compressed stream is 16x smaller, reducing WiFi contention and power consumption.
- Include a simple sequence counter even when not using full RTP — this allows the receiver to detect lost or out-of-order packets and apply concealment.

## Caveats

- ESP32 WiFi introduces periodic latency spikes of 50–150 ms during background operations (DHCP renewal, beacon reception, channel scanning). Audio streaming must absorb these spikes in the jitter buffer. A buffer smaller than 150 ms will underrun during WiFi housekeeping events.
- HTTP chunked streaming is not truly real-time — the browser or media player applies its own buffering (typically 2–10 seconds) that cannot be controlled from the server side. For latency below 500 ms, WebSocket or raw UDP is required.
- RTP payload type for uncompressed audio (L16, PT=10 or 11) uses network byte order (big-endian). ARM MCUs are little-endian. Each 16-bit sample must be byte-swapped in the RTP packet, which the sender and receiver must both handle correctly.

## In Practice

- **Audio stream has gaps every 30–60 seconds on WiFi** — correlates with WiFi DTIM beacon intervals or DHCP lease renewal. The jitter buffer is too small to absorb the WiFi stack's periodic latency. Increasing the jitter buffer to 200 ms typically resolves WiFi-related dropouts.
- **Streaming audio has increasing delay over time** — the sender and receiver clocks are drifting. Without clock synchronization, the jitter buffer slowly fills (if the sender is faster) or drains (if slower). RTCP sender reports or a custom timestamp-based rate adjustment keeps the clocks aligned.
- **WebSocket connection drops after 60 seconds of streaming** — a reverse proxy or load balancer is enforcing a WebSocket idle timeout. Sending periodic ping/pong frames (every 30 seconds) keeps the connection alive. Alternatively, check proxy timeout settings.
