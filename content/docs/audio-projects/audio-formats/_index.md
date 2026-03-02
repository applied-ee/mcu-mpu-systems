---
title: "Audio Formats & Storage"
weight: 40
bookCollapseSection: true
---

# Audio Formats & Storage

Audio data on a microcontroller exists in one of three states: raw PCM samples in a DMA buffer, encoded bytes in a file or network packet, or a WAV file on an SD card waiting to be streamed into a playback pipeline. The format determines how much storage or bandwidth the audio consumes, how much CPU is needed to decode it, and whether the MCU has enough RAM to buffer it. A one-minute mono recording at 16 kHz / 16-bit PCM occupies 1.92 MB — manageable on an SD card, but impractical for flash storage or wireless transmission without compression.

These pages cover audio data representation, file formats, compression codecs suitable for embedded systems, and protocols for streaming audio over IP networks.

## Pages

- **[PCM, WAV & Raw Audio]({{< relref "pcm-wav-raw-audio" >}})** — PCM encoding conventions (signed/unsigned, endianness, channel interleaving), WAV header structure, SD card streaming, and file size estimation.

- **[Audio Compression Codecs]({{< relref "audio-compression-codecs" >}})** — ADPCM, G.711, Opus, MP3, and FLAC: CPU/RAM requirements, library options, and storage-vs-bandwidth trade-offs for embedded targets.

- **[Streaming Audio Protocols]({{< relref "streaming-audio-protocols" >}})** — RTP/UDP for low-latency audio, HTTP streaming, WebSocket audio, jitter buffers, and packet loss concealment.
