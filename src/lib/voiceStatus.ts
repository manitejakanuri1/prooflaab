/**
 * The one status a student sees for a saved recording (Build-Log list and
 * detail). Kept free of React so it can be tested (voiceStatus.test.ts).
 *
 *   transcription failed                    -> Failed
 *   transcription pending / processing      -> Transcribing
 *   status 'scored'                         -> Scored
 *   status 'failed' (incl. too little speech, AI failure) -> Not scored
 *   status 'recorded', server transcript    -> Scoring (the server scores it: worker, then reap)
 *   status 'recorded', self-reported/legacy -> Not scored (nothing will score it automatically)
 */
export type RecordingStatusKind = "failed" | "transcribing" | "scored" | "not_scored" | "scoring";

export interface RecordingStatusInput {
  transcription_status: "pending" | "processing" | "completed" | "failed" | null;
  transcript_source: "browser" | "server" | "manual" | null;
  status: string | null;
}

export const STATUS_LABEL: Record<RecordingStatusKind, string> = {
  failed: "Failed",
  transcribing: "Transcribing",
  scored: "Scored",
  not_scored: "Not scored",
  scoring: "Scoring",
};

export function recordingStatus(v: RecordingStatusInput): RecordingStatusKind {
  // Legacy synchronous rows predate transcription_status: they were complete on insert.
  const t = v.transcription_status ?? "completed";
  if (t === "failed") return "failed";
  if (t === "pending" || t === "processing") return "transcribing";
  if (v.status === "scored") return "scored";
  if (v.status === "failed") return "not_scored";
  // Only a server transcript is scored automatically; a self-reported one is
  // never picked up by server scoring, so it must not look pending.
  return v.transcript_source === "server" ? "scoring" : "not_scored";
}
