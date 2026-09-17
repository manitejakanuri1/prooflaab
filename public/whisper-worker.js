// Deliberately a plain file in /public rather than a bundled module: transformers.js
// ships WebGPU runtime chunks that use `import.meta` in a form Vite's bundler refuses
// to process, and none of that wrestling buys anything. Served as-is, the browser loads
// it natively and it just works.
//
// The library comes from the same CDN that serves the model weights, so this adds no
// dependency that wasn't already there — and nothing to `npm install` or audit.
import {
  pipeline,
  env,
} from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";

// Model files are fetched from the Hub; there is no local model directory to check.
env.allowLocalModels = false;

let transcriber = null;
let loadedKey = "";

async function getTranscriber(model, device) {
  const key = `${model}:${device}`;
  if (transcriber && loadedKey === key) return transcriber;

  transcriber = await pipeline("automatic-speech-recognition", model, {
    device,
    // fp32 everywhere. Tested 17 Sep 2026 on a 53-second spoken explanation:
    // "q8" no longer loads at all on WASM with this transformers.js version
    // ("Missing required scale"), so every student without a GPU got an empty
    // transcript; "fp16" is refused by GPUs without shader-f16, and where it runs
    // Whisper's decoder degrades after the first stretch - the "first few words,
    // then random text" students reported. fp32 transcribed the test nearly word
    // for word with clean timestamps.
    dtype: "fp32",
    progress_callback: (p) => {
      if (p && p.status === "progress" && typeof p.progress === "number") {
        self.postMessage({
          type: "loading",
          message: "Downloading the speech model (one time only)…",
          progress: Math.round(p.progress),
        });
      }
    },
  });

  loadedKey = key;
  return transcriber;
}

self.addEventListener("message", async (event) => {
  const data = event.data || {};
  if (data.type !== "transcribe") return;

  try {
    self.postMessage({ type: "loading", message: "Preparing the speech model…" });
    const asr = await getTranscriber(data.model, data.device);
    self.postMessage({ type: "ready" });

    // English only — this platform's students, not a general-purpose dictation tool.
    // Fixing the language rather than auto-detecting also stops Whisper guessing wrong
    // on an accented recording and transcribing into the wrong language entirely.
    const output = await asr(data.audio, {
      // Whisper only sees 30 seconds at a time; the overlap stops words being clipped
      // where one window ends and the next begins.
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
      language: "en",
      task: "transcribe",
      // Each window is decoded independently. Carrying context forward is what lets
      // one bad guess seed the same phrase over and over through the whole file.
      condition_on_previous_text: false,
      no_repeat_ngram_size: 4,
    });

    self.postMessage({
      type: "done",
      text: ((output && output.text) || "").trim(),
      // Where each stretch of speech sits in the recording, for timestamps.
      chunks: (output && output.chunks) || [],
    });
  } catch (e) {
    self.postMessage({ type: "error", message: (e && e.message) || String(e) });
  }
});
