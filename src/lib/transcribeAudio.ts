/**
 * Turns a recorded clip into text using Whisper, running entirely in the
 * browser (Transformers.js, WebAssembly) — no server, no API key, no per-use
 * cost, and unlike the old live-captions approach it works in every modern
 * browser rather than only Chrome and Edge.
 *
 * The model (~40MB) downloads once per device and is cached by the browser
 * after; the first transcription on a new device is slower than every one
 * after it.
 *
 * Whisper's raw output goes through cleanTranscript() before it's returned —
 * fixes technical terms ASR reliably mishears ("get hub" -> "GitHub"), never
 * touches "um"/"uh"/"hmm". Those stay in on purpose: the grading prompt reads
 * hesitation as a sign of an authentic answer, not noise to strip.
 */
import { cleanTranscript } from "./cleanTranscript";

const WHISPER_SAMPLE_RATE = 16000;

async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx({ sampleRate: WHISPER_SAMPLE_RATE });
  try {
    const buffer = await audioCtx.decodeAudioData(bytes);
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) mono[i] = (left[i] + right[i]) / 2;
    return mono;
  } finally {
    void audioCtx.close();
  }
}

export interface TranscribeProgress {
  stage: "decoding" | "loading" | "transcribing";
  percent?: number;
}

/** en-IN by default — this platform's students, same as the API it replaces. */
export async function transcribeAudio(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
  language: string = "en",
): Promise<string> {
  onProgress?.({ stage: "decoding" });
  const audio = await decodeToMono16k(blob);

  const worker = new Worker(new URL("../workers/whisper-worker.ts", import.meta.url), { type: "module" });

  return new Promise((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "loading") onProgress?.({ stage: "loading", percent: msg.percent });
      if (msg.type === "ready") onProgress?.({ stage: "transcribing" });
      if (msg.type === "done") {
        worker.terminate();
        resolve(cleanTranscript(msg.text as string));
      }
      if (msg.type === "error") {
        worker.terminate();
        reject(new Error(msg.message));
      }
    });
    worker.addEventListener("error", (e) => { worker.terminate(); reject(new Error(e.message)); });
    worker.postMessage({ audio, language }, [audio.buffer]);
  });
}
