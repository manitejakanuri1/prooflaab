/**
 * Turns a recorded clip into text using Whisper, running entirely in the
 * browser — no server, no API key, no per-use cost, and it works in every
 * modern browser rather than only Chrome and Edge.
 *
 * The model runs via public/whisper-worker.js, loaded from Hugging Face's
 * CDN rather than bundled — Transformers.js's WebGPU runtime chunks use
 * `import.meta` in a form Vite's bundler refuses to process, and there is
 * nothing bundling that file would buy anyway. It downloads once per device
 * (cached by the browser after); the first transcription on a new device is
 * slower than every one after it.
 *
 * Whisper's raw output goes through cleanTranscript() before it's returned —
 * fixes technical terms ASR reliably mishears ("get hub" -> "GitHub"), never
 * touches "um"/"uh"/"hmm". Those stay in on purpose: the grading prompt reads
 * hesitation as a sign of an authentic answer, not noise to strip.
 */
import { cleanTranscript } from "./cleanTranscript";

const WHISPER_SAMPLE_RATE = 16000;
const MODEL = "onnx-community/whisper-tiny";

/** One spoken stretch and where it sits in the recording, in seconds. */
export interface TranscriptSegment {
  start: number;
  end: number | null;
  text: string;
}

/** Decode any browser-readable audio blob into the mono 16 kHz signal Whisper expects. */
async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error("This browser cannot decode audio.");

  const audioCtx = new AudioCtx({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const buffer = await audioCtx.decodeAudioData(bytes);
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    // Average the channels rather than dropping one, so a recording panned to one
    // side doesn't come back silent.
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } finally {
    void audioCtx.close();
  }
}

/** WebGPU when the browser has it, WebAssembly otherwise — both work, GPU is just faster. */
function detectDevice(): "webgpu" | "wasm" {
  const hasWebGPU = typeof (navigator as unknown as { gpu?: unknown }).gpu !== "undefined";
  return hasWebGPU ? "webgpu" : "wasm";
}

export interface TranscribeProgress {
  stage: "decoding" | "loading" | "transcribing";
  percent?: number;
}

export async function transcribeWithTimestamps(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  onProgress?.({ stage: "decoding" });
  const audio = await decodeToMono16k(blob);
  const device = detectDevice();

  // Served straight from /public, not bundled — see the note at the top of this file.
  const worker = new Worker("/whisper-worker.js", { type: "module" });

  try {
    return await new Promise((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent) => {
        const msg = event.data;
        if (msg.type === "loading") onProgress?.({ stage: "loading", percent: msg.progress });
        if (msg.type === "ready") onProgress?.({ stage: "transcribing" });
        if (msg.type === "done") {
          const segments = ((msg.chunks ?? []) as { timestamp: [number, number | null]; text: string }[])
            .map((c) => ({ start: c.timestamp[0], end: c.timestamp[1], text: cleanTranscript(c.text).trim() }))
            .filter((s) => s.text);
          resolve({ text: cleanTranscript(msg.text as string), segments });
        }
        if (msg.type === "error") reject(new Error(msg.message));
      });
      worker.addEventListener("error", (e) => reject(new Error(e.message || "Worker failed")));

      // Hand the samples over rather than copying them — a 90-second recording is
      // several megabytes, and cloning that stalls the page.
      worker.postMessage({ type: "transcribe", audio, model: MODEL, device }, [audio.buffer]);
    });
  } finally {
    worker.terminate();
  }
}

export const transcribeAudio = (blob: Blob, onProgress?: (p: TranscribeProgress) => void) =>
  transcribeWithTimestamps(blob, onProgress).then((r) => r.text);

/** 0:07 style, for showing a segment's start. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
