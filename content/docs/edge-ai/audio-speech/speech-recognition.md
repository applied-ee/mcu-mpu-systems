---
title: "Speech Recognition"
weight: 30
---

# Speech Recognition

Speech recognition at the edge spans a vast range of complexity — from a Cortex-M4 classifying one of 20 fixed commands in 50 milliseconds, to an NVIDIA Jetson running the full OpenAI Whisper model for open-vocabulary transcription in multiple languages. The right approach depends on vocabulary size, acceptable latency, available hardware, and whether network connectivity is reliable enough for a cloud fallback.

The architecture decision is not just about accuracy. A 100-command voice interface that responds in 200 ms with 95% accuracy feels better to use than one that achieves 99% accuracy but takes 3 seconds. Latency, power, and reliability — not just word error rate — determine whether a speech recognition system is practical at the edge.

## The Speech Recognition Spectrum

### Tier 1: Fixed-Command Recognition on MCU

The simplest form of speech recognition: classify a short utterance (0.5–1.5 seconds) into one of a fixed set of commands. This is an extension of [keyword spotting]({{< relref "keyword-spotting" >}}) — the model architecture is similar (CNN on mel spectrograms), but the vocabulary is larger (10–50 commands instead of 1–5 keywords).

**Architecture:** A DS-CNN or small CNN takes a mel spectrogram (typically 49–99 frames x 40 mel bins) and produces a softmax output over the command vocabulary. The model is a classifier, not a sequence generator — it outputs one label per utterance, not a sequence of characters or words.

**Model size:** 100–300 KB (int8 quantized TFLite). Larger vocabularies require wider or deeper networks, pushing model size up proportionally. A 10-command model might be 50 KB; a 50-command model might be 200–300 KB.

**Inference latency:**

| Platform | 30-command model | Notes |
|----------|-----------------|-------|
| Cortex-M4 @ 80 MHz | 30–50 ms | CMSIS-NN, int8 |
| Cortex-M7 @ 480 MHz | 5–10 ms | CMSIS-NN, int8 |
| ESP32-S3 @ 240 MHz | 10–20 ms | ESP-NN, int8 |

**Vocabulary design** is critical. Commands should be phonetically distinct from each other and from common background speech:

- "lights on" and "lights off" are phonetically close — replacing with "lights on" and "lights down" improves accuracy.
- Single-word commands ("play", "stop", "next") work best when the words have distinct vowel structures.
- Multi-word commands ("turn left", "volume up") provide more phonetic context and improve accuracy over single-word equivalents.

**Limitations:** The model cannot generalize to unseen words. Adding a new command requires retraining. The vocabulary is baked into the model at training time. There is no decoding, no language model, no ability to handle free-form speech.

### Tier 2: Medium-Vocabulary ASR on Linux SBC

Moving beyond fixed commands requires a fundamentally different architecture: a model that outputs a sequence of characters or subwords, not a single class label. This is automatic speech recognition (ASR) in the traditional sense.

**CTC-based models** (Connectionist Temporal Classification) are the workhorse of medium-vocabulary edge ASR:

- **DeepSpeech (Mozilla):** An RNN-based model that takes mel spectrogram input and outputs a sequence of characters via CTC decoding. The original DeepSpeech model is ~180 MB (float32); the quantized TFLite version is ~45 MB. Runs on Raspberry Pi 4 with ~500 ms latency for a 3-second utterance.
- **Wav2Letter (Facebook/Meta):** A fully convolutional model (no recurrence) that takes raw waveform or spectrogram input. Faster than DeepSpeech due to parallelizable convolutions, but similar accuracy tier. Quantized models are 20–50 MB.
- **Smaller CTC models:** Custom architectures with 5–15 convolutional layers, trained on domain-specific data, can be 5–15 MB and run on Cortex-A class processors (Raspberry Pi, i.MX8M) with 100–300 ms latency for short utterances.

**How CTC decoding works:**

CTC addresses the alignment problem: speech has variable speed, so the model does not know which output character corresponds to which input frame. CTC introduces a "blank" token that represents "no output at this frame." The model outputs a probability distribution over (alphabet + blank) at each time step. Decoding collapses repeated characters and removes blanks:

```
Raw CTC output: _hh_ee_ll_ll_oo_  →  "hello"
(where _ is the blank token)
```

**Greedy decoding** simply takes the argmax at each time step — fast but suboptimal. **Beam search decoding** maintains multiple hypotheses and scores them, optionally incorporating a language model. Beam search with a 4-gram language model typically improves word error rate by 5–15% over greedy decoding, at the cost of higher latency (50–200 ms additional on a Pi 4).

**Language model integration:**

- **N-gram LM (KenLM):** A 4-gram or 5-gram language model trained on domain-specific text. Typical size: 50–200 MB for a general English LM, 1–10 MB for a constrained domain (home automation commands, medical terminology). The LM rescores CTC beam search hypotheses to favor linguistically plausible sequences.
- **Domain-specific vocabulary boost:** Injecting domain terms (product names, technical jargon) into the LM with high probability ensures the ASR system can recognize vocabulary that does not appear frequently in general text corpora.

**Performance envelope for CTC-based edge ASR:**

| Metric | Small custom CTC | DeepSpeech (quantized) |
|--------|-----------------|----------------------|
| Model size | 5–15 MB | 45 MB |
| RAM requirement | 50–150 MB | 200–400 MB |
| Latency (3s utterance) | 100–300 ms | 400–800 ms |
| Word error rate (clean) | 15–25% | 8–12% |
| Word error rate (noisy) | 25–40% | 15–25% |
| Hardware | Pi 4, i.MX8M | Pi 4, Jetson Nano |

### Tier 3: Open-Vocabulary ASR with Whisper on Jetson

OpenAI's Whisper is an encoder-decoder transformer trained on 680,000 hours of multilingual audio. It represents a qualitative leap over CTC-based models: Whisper handles accents, background noise, multiple languages, and code-switching with dramatically higher accuracy than any model that fits on a Raspberry Pi.

**Architecture:**

Whisper is a sequence-to-sequence transformer:

1. **Audio encoder:** Takes a log mel spectrogram (80 mel bins, 30-second window) and produces a sequence of encoder states through transformer encoder layers (multi-head self-attention + feed-forward).
2. **Text decoder:** An autoregressive transformer decoder that generates output tokens one at a time, attending to the encoder states and previously generated tokens. The decoder handles language identification, timestamps, and transcription in a single model.

The autoregressive decoding means latency scales with output length — transcribing a 10-word sentence requires 10+ decoder steps, while transcribing a single word requires only 1–2 steps.

**Whisper model sizes:**

| Model | Parameters | Disk Size | RAM (FP16) | RAM (INT8) |
|-------|-----------|-----------|------------|------------|
| tiny | 39M | 75 MB | ~1 GB | ~500 MB |
| base | 74M | 145 MB | ~1.5 GB | ~750 MB |
| small | 244M | 488 MB | ~3 GB | ~1.5 GB |
| medium | 769M | 1.5 GB | ~7 GB | ~3.5 GB |
| large-v3 | 1,550M | 3 GB | ~14 GB | ~7 GB |

For edge deployment, **tiny** and **base** are the practical options on Jetson Orin Nano (8 GB RAM). The **small** model fits on Jetson Orin NX (16 GB) or Jetson AGX Orin (32/64 GB).

**Whisper performance on Jetson Orin Nano (8 GB, 1024 CUDA cores, 32 Tensor Cores):**

| Model | Real-Time Factor (FP16) | Real-Time Factor (TensorRT) | Latency for 5s audio |
|-------|------------------------|---------------------------|---------------------|
| tiny | 0.15x | 0.08x | 0.4–0.75 s |
| base | 0.30x | 0.15x | 0.75–1.5 s |
| small | 0.80x | 0.40x | 2–4 s |

Real-time factor (RTF) is the ratio of processing time to audio duration. An RTF of 0.1x means a 10-second clip is processed in 1 second. Values below 1.0x mean faster-than-real-time processing.

**TensorRT optimization:**

NVIDIA's TensorRT compiler optimizes Whisper for GPU execution by:

- Fusing operations (layer normalization + activation, QKV projection + attention)
- Converting to FP16 or INT8 precision
- Optimizing memory layout for GPU cache hierarchy
- Using CUDA graph capture to minimize kernel launch overhead

TensorRT typically halves Whisper's latency compared to native PyTorch FP16 inference. The `whisper-trt` and `faster-whisper` projects provide pre-built TensorRT engines for Whisper.

**faster-whisper** uses CTranslate2 (a C++ inference engine with INT8 quantization) and achieves 2–4x speedup over the original OpenAI implementation. On Jetson Orin Nano, faster-whisper with the tiny model processes audio at approximately 12x real-time speed.

### Vocabulary and Latency Trade-offs — Summary

| Approach | Vocabulary | Latency | Hardware | Model Size | WER (clean) |
|----------|-----------|---------|----------|------------|-------------|
| Fixed command (MCU) | 10–50 words | <50 ms | Cortex-M4/M7 | 50–300 KB | 3–7% (acc.) |
| CTC ASR (SBC) | 1K–50K words | 100–500 ms | Pi 4, i.MX8M | 5–50 MB | 10–25% |
| Whisper tiny (Jetson) | Open | 0.5–1.5 s | Orin Nano | 75 MB | 7–10% |
| Whisper base (Jetson) | Open | 1–2 s | Orin Nano | 145 MB | 5–7% |
| Whisper small (Jetson) | Open | 2–4 s | Orin NX | 488 MB | 3–5% |

Note: WER (Word Error Rate) for CTC and Whisper models; classification accuracy for fixed-command models. These numbers are representative of English speech in moderate noise conditions.

## CTC Decoding in Detail

CTC decoding is the core algorithm that converts a frame-level probability sequence into a text output. Understanding its behavior is essential for optimizing edge ASR quality.

### Greedy Decoding

At each time step t, take the most probable token:

```
output[t] = argmax(P(token | t))
```

Then collapse: remove consecutive duplicates and strip blank tokens. Fast (O(T) where T is the number of frames) but ignores linguistic context. A greedy decoder might output "hellp" instead of "hello" because the probability at one frame slightly favored "p" over "o".

### Beam Search Decoding

Maintain the top-B hypotheses at each time step, scoring each by the product of frame-level probabilities. B (beam width) is typically 10–100. Wider beams improve accuracy but increase latency linearly.

Adding a language model to beam search reranks hypotheses by combining the acoustic model score (from CTC) with a language model score:

```
score(hypothesis) = α * log_prob_CTC + β * log_prob_LM + γ * word_count
```

The word insertion bonus γ prevents the decoder from favoring shorter hypotheses (which have higher CTC probability because fewer non-blank frames are needed).

### Beam Search Latency

On a Raspberry Pi 4 (Cortex-A72, 1.8 GHz):

- Greedy decoding: <10 ms for a 3-second utterance
- Beam search (width 32, no LM): ~50 ms
- Beam search (width 32, 4-gram LM): ~150 ms
- Beam search (width 100, 4-gram LM): ~400 ms

The LM lookup dominates beam search cost. Using a smaller, domain-specific LM (1–5 MB) instead of a general English LM (100+ MB) reduces both latency and memory.

## Attention-Based Decoding

Whisper and other encoder-decoder models use attention-based decoding instead of CTC. The decoder generates one token at a time, attending to the full encoder output through cross-attention:

1. The encoder processes the entire audio input and produces a sequence of hidden states.
2. The decoder starts with a "start of text" token.
3. At each step, the decoder attends to the encoder states and all previously generated tokens, then predicts the next token.
4. Generation stops when an "end of text" token is predicted, or a maximum length is reached.

**Key differences from CTC:**

- **Non-monotonic alignment:** The decoder can attend to any part of the audio at any time. This enables handling of reordering (relevant for some languages) but also allows hallucination — the decoder can generate text that does not correspond to any audio.
- **Autoregressive latency:** Each output token requires a full decoder forward pass. A 20-word transcription requires 20+ decoder steps. On a GPU, each step takes 5–20 ms (Whisper tiny), so a 20-word output adds 100–400 ms of decoding time.
- **No blank token:** The decoder explicitly decides when to emit each token, so there is no collapsing step. This generally produces cleaner output but removes the ability to detect "no speech" through blank dominance.

## Hybrid Architecture: Local VAD + Cloud ASR

For applications that need open-vocabulary ASR but cannot run Whisper locally (no GPU, tight power budget), a hybrid architecture combines local voice activity detection with cloud-based speech recognition.

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│ Microphone  │────→│  MCU (VAD)   │────→│ Cloud ASR   │
│ (PDM MEMS)  │     │ + Recording  │     │ (API call)  │
└─────────────┘     └──────────────┘     └─────────────┘
                           │                     │
                    Detects speech          Transcribes
                    onset/offset           full utterance
                           │                     │
                           └───── Fallback ──────┘
                           to local command
                           recognition if
                           network unavailable
```

The MCU runs continuously with a VAD model to detect when speech begins and ends. When speech is detected:

1. **Record** the utterance to a buffer (RAM or external flash, depending on length).
2. **Compress** the audio (Opus or Speex codec, typically 16 kbps for speech = 2 KB/s).
3. **Transmit** to a cloud ASR service (Google Speech-to-Text, AWS Transcribe, Azure Speech Service).
4. **Receive** the transcription (typically as a JSON response with text and confidence).
5. **Act** on the transcription locally.

Total round-trip latency: VAD endpointing delay (200–500 ms after speech ends) + compression (~50 ms) + network transmission (100–500 ms) + cloud processing (200–1000 ms) + response transmission (50–200 ms) = **0.6–2.2 seconds total**.

### VAD Models

Voice Activity Detection determines when speech is present in the audio stream. Several options exist at different complexity levels:

**Energy-based VAD:** Compute the RMS energy of each frame and compare to a threshold. Simple and fast (<0.1 ms per frame on any MCU), but highly sensitive to background noise. A fixed threshold that works in a quiet room fails in a noisy environment.

**WebRTC VAD:** Google's open-source VAD from the WebRTC project. Uses a Gaussian Mixture Model (GMM) to classify each 10 ms frame as speech or non-speech. Runs in ~0.01 ms per frame on a Cortex-M4. Available quality settings: 0 (most aggressive, more false positives) to 3 (least aggressive, more false negatives). Approximately 10 KB of code and data.

**Silero VAD:** A small neural network (~1 MB ONNX model) that provides state-of-the-art VAD accuracy. Runs in ~1 ms per frame on a Cortex-A72 (Pi 4). More accurate than WebRTC VAD in noisy environments but too large and slow for most MCU targets. Well-suited for Linux SBC-based hybrid systems.

**Endpointing** (detecting speech end) is as important as onset detection. The VAD must determine when the speaker has stopped talking, which requires a silence timeout:

- **Too short** (100–200 ms): clips the end of words, especially plosives and trailing fricatives.
- **Too long** (>1000 ms): adds unnecessary latency before cloud submission.
- **Typical setting:** 300–500 ms of continuous non-speech triggers endpointing.

### Offline Fallback

A robust hybrid system includes a local command recognition model as a fallback when network connectivity is unavailable. The MCU runs the VAD continuously. If network is available, detected speech is sent to the cloud. If not, the same audio is fed to a local command classifier with a reduced vocabulary (e.g., 10–20 essential commands).

This dual-path design requires the MCU to buffer enough audio for both the cloud path (full utterance, potentially 5–10 seconds) and the local path (1 second for command classification). On an MCU with 256 KB SRAM, the audio buffer at 16 kHz 16-bit mono consumes 32 KB per second — limiting local recording to approximately 5–7 seconds before running out of RAM.

### Cloud ASR Service Comparison

| Service | Latency (3s utterance) | Cost | Streaming | Offline |
|---------|----------------------|------|-----------|---------|
| Google Speech-to-Text | 300–800 ms | $0.006/15s | Yes | No |
| AWS Transcribe | 500–1500 ms | $0.024/min | Yes | No |
| Azure Speech Service | 300–700 ms | $1/hr streaming | Yes | No |
| Whisper API (OpenAI) | 500–2000 ms | $0.006/min | No | No |

Streaming APIs (Google, AWS, Azure) can begin returning partial results while audio is still being transmitted, reducing perceived latency by 200–500 ms compared to batch APIs.

## Streaming vs Batch ASR

### Batch ASR

The simpler approach: record the entire utterance, then process it as a single block.

- **Simpler implementation:** feature extraction and inference run once on the complete audio.
- **Higher latency:** processing cannot begin until the utterance is complete (detected by VAD endpointing).
- **More accurate:** the model has access to the full utterance context, including future frames that inform earlier predictions.
- **Appropriate for:** command recognition, short utterances, offline transcription.

### Streaming ASR

Process audio in overlapping chunks, producing partial transcriptions as audio arrives:

- **Lower perceived latency:** partial results appear within 200–500 ms of speech onset.
- **More complex:** the model must handle chunk boundaries without introducing artifacts (repeated or dropped words at boundaries).
- **Slightly lower accuracy:** each chunk lacks future context, so early predictions may be revised as more audio arrives.
- **Appropriate for:** live captioning, real-time translation, conversational interfaces.

On-device streaming ASR typically uses a CTC model processing 500 ms chunks with 100–200 ms overlap. Each chunk produces a partial character sequence. A merging algorithm stitches consecutive chunk outputs, handling boundary overlaps:

```
Chunk 1 output: "hel"
Chunk 2 output: "ello worl"
Chunk 3 output: "orld"
Merged: "hello world"
```

The merging logic must handle partial words at boundaries — a character-level CTC model facilitates this because characters at chunk boundaries can be merged by overlap alignment. Word-level models are significantly harder to stream.

Whisper does not natively support streaming — it processes 30-second audio blocks. Pseudo-streaming can be achieved by processing overlapping 5–10 second windows and merging transcriptions, but this is compute-intensive (each window requires full encoder + decoder processing) and introduces boundary artifacts.

## Tips

- Start with command recognition if the vocabulary is under 50 words. The simplicity, latency, and power advantages of a classifier model on an MCU far outweigh the accuracy gains of a full ASR system for constrained vocabularies.
- Whisper tiny is surprisingly capable for English speech recognition. For edge applications that need open vocabulary, Whisper tiny with TensorRT on a Jetson Orin Nano provides the best accuracy-per-watt ratio in the open-vocabulary tier.
- VAD quality determines hybrid system UX. A VAD that endpoints too early clips words; one that endpoints too late adds perceived latency. Silero VAD with 300 ms silence timeout is a reliable default for hybrid systems on Linux SBCs.
- Always benchmark real-time factor (RTF) on the target hardware with representative audio. Marketing RTF numbers often use short, clean utterances that are best-case scenarios. Test with 10–30 second clips in noisy conditions.
- TensorRT Whisper tiny on Jetson Orin Nano is the sweet spot for open-vocabulary edge ASR: RTF of ~0.08x, 500 MB RAM footprint, 5–7% WER on English.
- For CTC models, a domain-specific language model (trained on expected utterances) often provides more accuracy improvement than a larger acoustic model. A 2 MB LM trained on 10,000 domain sentences can outperform a 100 MB general LM.
- When designing a command vocabulary, test all pairs of commands for phonetic confusion by running the model on each command and checking the second-highest prediction. If two commands consistently confuse each other, replace one.
- Compress audio before cloud transmission in hybrid systems. Opus at 16 kbps preserves speech intelligibility while reducing bandwidth by 16x compared to raw PCM (256 kbps at 16 kHz 16-bit).

## Caveats

- **Whisper hallucinates on silence or noise.** When fed audio containing no speech — ambient noise, music, silence — Whisper's decoder can generate fluent but entirely fabricated text. This is a property of autoregressive decoding: the model always tries to generate the most probable next token, even when the correct output is "nothing." A VAD gate before Whisper inference is mandatory in any production system.
- **CTC models struggle with rare words not in the language model.** Without LM rescoring, CTC output for unusual proper nouns, technical terms, or foreign words is often garbled. The acoustic model produces plausible-sounding but incorrect character sequences. Domain-specific vocabulary must be explicitly injected into the LM.
- **Attention-based decoding latency is proportional to output length.** A 50-word transcription takes 5–10x longer to decode than a 5-word transcription, even if the audio duration is the same. For real-time applications, the worst-case latency depends on the longest expected utterance, not the average utterance.
- **Streaming ASR introduces word boundary artifacts.** Processing audio in chunks can produce duplicated or dropped words at chunk boundaries. The overlap-and-merge strategy mitigates this but does not eliminate it entirely, especially for words that fall exactly on a boundary.
- **Command recognition accuracy is highly sensitive to vocabulary design.** Two phonetically similar commands ("forward" / "four words") will degrade overall accuracy because the model cannot reliably distinguish them. Vocabulary design is an engineering task, not just a product decision.
- **Cloud ASR latency is variable and network-dependent.** On cellular connections, round-trip latency can spike to 2–5 seconds during congestion. The hybrid system must handle this gracefully — either by increasing the audio buffer or by falling back to local recognition after a timeout.
- **Whisper's 30-second processing window means it buffers significant audio before producing output.** For short commands (1–2 seconds), Whisper processes 28 seconds of silence/padding along with the actual speech. Truncating the input to the VAD-detected speech segment dramatically reduces inference time.

## In Practice

- **Whisper generates text from silence.** This is the hallucination problem: the decoder invents plausible transcriptions for audio that contains no speech. The symptom is phantom text appearing during quiet periods. The fix is always gating Whisper inference with a VAD — only feed audio segments where the VAD detected speech. Silero VAD or WebRTC VAD are both effective gates.
- **Command recognition triggers on the wrong command.** This commonly appears when two commands in the vocabulary are phonetically similar. Running the model on each command in a quiet room and examining the full softmax output (not just the top prediction) reveals which commands the model confuses. The solution is redesigning the confusing commands to be more phonetically distinct, or adding a rejection threshold where low-confidence predictions are treated as "not recognized."
- **Hybrid system latency feels slow despite fast cloud ASR.** The perceived latency often traces to VAD endpointing delay, not cloud processing time. If the silence timeout is set to 1 second, the system waits 1 second after the speaker stops before sending audio to the cloud — adding 1 second to every interaction. Reducing the silence timeout to 300 ms (with the risk of cutting off trailing speech) or using a more sophisticated endpointing model (energy decay detection) reduces perceived latency.
- **ASR accuracy degrades in a specific room.** Reverberation — reflections from walls, ceiling, and floor — smears the temporal structure of speech in ways that the model did not encounter in training. The mel spectrogram shows "blurred" formant transitions. Dereverberation algorithms (e.g., WPE — Weighted Prediction Error) can be applied as a preprocessing step, or training data can be augmented with room impulse responses matching the deployment environment.
- **CTC model output contains repeated characters or stuttered words.** This indicates the CTC decoder is not properly collapsing repeated tokens. The typical cause is a bug in the post-processing code — the collapse step must remove consecutive duplicate characters first, then remove blank tokens (or vice versa, depending on the convention). Swapping the order of these two steps produces visibly garbled output.
- **Whisper inference on Jetson takes much longer than expected for short utterances.** If the audio is not truncated to the speech segment (via VAD), Whisper processes the full 30-second window. A 2-second command padded to 30 seconds takes 15x longer than necessary. Truncating the input to the VAD-detected segment (plus 500 ms padding) dramatically reduces latency without affecting accuracy.
- **Cloud ASR returns empty or error responses intermittently.** The most common cause is audio encoding mismatch: the cloud API expects a specific format (e.g., 16 kHz, 16-bit, linear PCM or FLAC) and the device sends a different format (e.g., 8 kHz, or Opus-compressed without the correct headers). Verifying the audio format against the API documentation and testing with a known-good audio sample isolates the issue.
- **Streaming ASR shows words appearing and then changing (flickering).** This is expected behavior in streaming mode — partial results are provisional and get revised as more context arrives. The UX solution is to display partial results in a visually distinct style (lighter color, italics) and finalize them only when the next chunk confirms or the endpointing triggers. Displaying every partial result as final text produces a disorienting experience.
