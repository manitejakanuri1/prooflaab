/**
 * One place for how the platform records a voice, used by the 60-second
 * explanation and the mock interview.
 *
 * `getUserMedia({ audio: true })` leaves echo cancellation, noise suppression
 * and gain to the browser's mood, and `new MediaRecorder(stream)` picks its own
 * codec and a low bitrate. Asking explicitly gives a clearer recording to play
 * back and a cleaner signal for the transcriber.
 */
export const openMic = () =>
  navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

/** Opus in WebM where supported (Chrome, Firefox, Edge); MP4/AAC on Safari. */
export function makeRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
    .find((t) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(t));
  return new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 96000 });
}

/** The blob type and file extension that match what the recorder really produced. */
export function recordingFormat(rec: MediaRecorder): { type: string; ext: string } {
  const type = (rec.mimeType || "audio/webm").split(";")[0];
  return { type, ext: type === "audio/mp4" ? "m4a" : "webm" };
}
