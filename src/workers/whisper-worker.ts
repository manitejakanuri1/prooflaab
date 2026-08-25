// Runs Whisper entirely inside a Web Worker, off the main thread, so the
// level meter and the rest of the recording UI stay responsive while a
// ~40MB model downloads (once — cached by the browser after) and a clip is
// transcribed. This is the client-side half of speech-to-text: no server,
// no API key, works in every modern browser rather than just Chrome/Edge.
import { pipeline, env } from "@xenova/transformers";

// Fetch the model from Hugging Face's CDN rather than expecting it to be
// bundled locally — there is no local copy to allow.
env.allowLocalModels = false;

const MODEL = "onnx-community/whisper-tiny";

let instance: any = null;

async function getPipeline(onProgress: (file: string, percent: number) => void) {
  if (!instance) {
    instance = await pipeline("automatic-speech-recognition", MODEL, {
      progress_callback: (p: any) => {
        if (p.status === "progress") onProgress(p.file, Math.round(p.progress ?? 0));
      },
    } as any);
  }
  return instance;
}

self.addEventListener("message", async (event: MessageEvent) => {
  const { audio, language } = event.data as { audio: Float32Array; language?: string };

  try {
    const transcriber = await getPipeline((file, percent) => {
      (self as any).postMessage({ type: "loading", file, percent });
    });

    (self as any).postMessage({ type: "ready" });

    const options: Record<string, unknown> = {
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (language && language !== "auto") {
      options.language = language;
      options.task = "transcribe";
    }

    const output = await transcriber(audio, options);
    (self as any).postMessage({ type: "done", text: (output.text || "").trim() });
  } catch (err) {
    (self as any).postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
