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
  communication_score?: number | null;
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

/**
 * Where the transcript came from, as the student sees it.
 *
 *   transcription pending / processing -> Verifying (only the server pipeline
 *                                          has these states; never "Self-reported")
 *   transcription failed               -> Verification failed
 *   completed + server transcript      -> Server-verified
 *   completed + browser / manual / old -> Self-reported (legacy synchronous path)
 */
export type ProvenanceKind = "verifying" | "verification_failed" | "server_verified" | "self_reported";

export const PROVENANCE_LABEL: Record<ProvenanceKind, string> = {
  verifying: "Verifying",
  verification_failed: "Verification failed",
  server_verified: "Server-verified",
  self_reported: "Self-reported",
};

export function provenance(v: RecordingStatusInput): ProvenanceKind {
  const t = v.transcription_status ?? "completed";
  if (t === "pending" || t === "processing") return "verifying";
  if (t === "failed") return "verification_failed";
  return v.transcript_source === "server" ? "server_verified" : "self_reported";
}

/**
 * The number to show next to a recording, or null. A score is shown only when
 * the recording's status is Scored; a stray number on a Not scored, Failed,
 * Scoring or Transcribing record is never displayed (no "Not scored 85/100").
 */
export function displayScore(v: RecordingStatusInput): number | null {
  if (recordingStatus(v) !== "scored") return null;
  const s = v.communication_score;
  return typeof s === "number" && Number.isFinite(s) ? s : null;
}
