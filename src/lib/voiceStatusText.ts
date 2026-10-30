/** MF-114: where the newest recording for a task stands, as the server decided it. */
export type VoiceStatus = "checking" | "scored" | "failed";

export function voiceStatusOf(status: string | null | undefined): VoiceStatus {
  if (status === "scored") return "scored";
  if (status === "failed") return "failed";
  return "checking";
}
