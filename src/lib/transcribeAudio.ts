/**
 * Turns a recorded clip into text on ProofLab's own transcriber service
 * (transcriber/ - faster-whisper on CPU, VoxScript AI's settings).
 *
 * The device only records and uploads, so a cheap phone and a laptop get the
 * same result in the same few seconds. This replaced a Whisper model that ran
 * inside the browser: it downloaded ~150 MB per device, needed a GPU to be
 * quick, failed to load at all without one, and on some GPUs turned everything
 * after the first few words into noise.
 *
 * The transcript goes through cleanTranscript() before it is returned — fixes
 * technical terms speech recognition reliably mishears ("get hub" -> "GitHub"),
 * never touches "um"/"uh"/"hmm". Those stay in on purpose: the grading prompt
 * reads hesitation as a sign of an authentic answer, not noise to strip.
 */
import { cleanTranscript } from "./cleanTranscript.ts";

/** One spoken stretch and where it sits in the recording, in seconds. */
export interface TranscriptSegment {
  start: number;
  end: number | null;
  text: string;
}

export interface TranscribeProgress {
  stage: "decoding" | "loading" | "transcribing";
  percent?: number;
}

export async function transcribeWithTimestamps(
  blob: Blob,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<{ text: string; segments: TranscriptSegment[] }> {
  onProgress?.({ stage: "transcribing" });
  // The transcriber handles three recordings at a time and answers "busy" (429/503,
  // or Google's own HTML 500 page) to the rest instead of queueing them. With eleven
  // students recording together, nine used to see an error. Wait a moment and try
  // again: the recording is still in memory, and the free slots come back in seconds.
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch("/api/transcriber/transcribe", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type":
          blob.type || "audio/webm",
      },
      body: blob,
    });
    const busy = [429, 502, 503, 504].includes(res.status)
      || (res.status === 500 && (res.headers.get("content-type") ?? "").includes("text/html"));
    if (!busy || attempt >= 10) break;
    await new Promise((r) => setTimeout(r, 1500 + attempt * 800 + Math.random() * 1000));
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Could not write down the recording.");

  const segments = ((json.segments ?? []) as TranscriptSegment[])
    .map((s) => ({ ...s, text: cleanTranscript(s.text).trim() }))
    .filter((s) => s.text);
  return { text: cleanTranscript(json.text ?? ""), segments };
}

export const transcribeAudio = (blob: Blob, onProgress?: (p: TranscribeProgress) => void) =>
  transcribeWithTimestamps(blob, onProgress).then((r) => r.text);

/** 0:07 style, for showing a segment's start. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
