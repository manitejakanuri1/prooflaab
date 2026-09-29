import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { scoreRecording, VOICE_SCORE_COLUMNS } from "../_shared/voiceScore.ts";
import { EXHAUSTED_ERROR, logReport, runReap } from "./reap.ts";

/**
 * Step 6B/6C/G1: scheduled recovery, called by Cloud Scheduler with the shared
 * webhook secret (same auth pattern as scheduled-job; never student-facing).
 *
 *  A. Transcription jobs stuck because a worker died mid-job, or because the
 *     job's enqueue never reached Cloud Tasks: claim_transcription_recovery
 *     (migration 43) hands them out, bounded to 8 attempts per job; each is
 *     re-enqueued to Cloud Tasks independently.
 *  B. Server transcripts saved but never scored (G1).
 *
 * A and B are independent, and every job is handled on its own, so one
 * failure never blocks the rest. Logic and settings checks: ./reap.ts.
 *
 * Settings (no defaults for the queue/worker/account - production must never
 * fall back to staging's): ENVIRONMENT (staging|production),
 * TRANSCRIPTION_QUEUE, TRANSCRIPTION_WORKER_URL, TASKS_INVOKER_SA; optional
 * GCP_PROJECT, TASKS_LOCATION, STALE_AFTER_SECONDS. Staging-only test
 * switches, refused in production: FAULT_INJECT_REAP_FAIL=true (skip the
 * Cloud Tasks call to simulate an enqueue outage), MAX_REAP_ATTEMPTS (lower
 * the recovery limit to prove it in real time).
 *
 * The run answers 500 whenever anything failed (bad settings, a failed
 * enqueue, jobs that hit the recovery limit, a scoring database error), so
 * the existing "scheduler job failed" alert fires; the body and the log line
 * say exactly what.
 */
serve(async (req) => {
  const expected = Deno.env.get("WEBHOOK_SECRET");
  if (!expected) {
    console.error("WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "not configured" }), { status: 500 });
  }
  if (req.headers.get("x-webhook-secret") !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const db = createClient("", "");
  const report = await runReap((k) => Deno.env.get(k), {
    listAtLimit: async (max) => await db.from("voice_explanations")
      .select("id")
      .in("transcription_status", ["pending", "processing"])
      .gte("transcription_reap_attempts", max),
    confirmExhausted: async (ids) => await db.from("voice_explanations")
      .select("id")
      .in("id", ids)
      .eq("transcription_status", "failed")
      .eq("transcription_error", EXHAUSTED_ERROR),
    claimRecovery: async (args) => await db.rpc("claim_transcription_recovery", args),
    googleToken,
    createTask: async (token, body, cfg) => {
      const res = await fetch(
        `https://cloudtasks.googleapis.com/v2/projects/${cfg.project}/locations/${cfg.location}/queues/${cfg.queue}/tasks`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      await res.body?.cancel();
      return { ok: res.ok, status: res.status };
    },
    listUnscored: async (cutoffIso, limit) => await db.from("voice_explanations")
      .select(VOICE_SCORE_COLUMNS)
      .eq("transcript_source", "server")
      .eq("transcription_status", "completed")
      .eq("status", "recorded")
      .or(`scoring_claimed_at.is.null,scoring_claimed_at.lt.${cutoffIso}`)
      .order("created_at", { ascending: true })
      .limit(limit),
    score: (rec) => scoreRecording(db, rec as never),
  });
  logReport(report);
  return new Response(JSON.stringify(report), {
    status: report.ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  });
});

async function googleToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!res.ok) throw new Error(`metadata token HTTP ${res.status}`);
  const body = await res.json();
  if (!body?.access_token) throw new Error("metadata token missing access_token");
  return body.access_token;
}
