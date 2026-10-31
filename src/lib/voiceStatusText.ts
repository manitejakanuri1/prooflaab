/** MF-114: where the newest recording for a task stands, as the server decided it. */
export type VoiceStatus = "checking" | "scored" | "failed";

export function voiceStatusOf(status: string | null | undefined): VoiceStatus {
  if (status === "scored") return "scored";
  if (status === "failed") return "failed";
  return "checking";
}

/** MF-042: why the microphone did not open, and what to do, in plain words. */
export function micErrorText(err: unknown, answerSaved = true): string {
  const name = (err as { name?: string } | null)?.name;
  const later = answerSaved ? " Your answer is saved: you can close this and record later." : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone found. Plug in earphones with a mic, or open ProofLab on your phone, then try again." + later;
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "Another app is using your microphone. Close it (for example a video call), then try again." + later;
  }
  return "Your browser blocked the microphone. On a computer: click the lock icon next to the web address, set Microphone to Allow, then reload the page. On a phone: open the browser settings, find Site settings > Microphone, and allow this site." + later;
}
