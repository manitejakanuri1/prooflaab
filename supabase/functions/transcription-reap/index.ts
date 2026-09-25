import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";

/**
 * Step 6B/6C (staging only): recovers a transcription job stuck in one of two
 * ways - a worker claimed it and went silent (crashed, OOM-killed, network
 * partitioned) before calling complete or fail, or the job's own enqueue
 * (transcription-enqueue's first attempt, or an earlier run of this same
 * function) never actually reached Cloud Tasks. Cloud Tasks' own retries
 * cannot be relied on for the first case: the queue's 3 attempts at 5-30s
 * backoff exhaust in under a minute, well before the 180s staleness window
 * that separates "still working" from "actually dead."
 *
 * claim_transcription_recovery (migration 43) does not change
 * transcription_status at all - it only marks "a recovery attempt is in
 * flight" via a separate reap-claim column, bounded by a max-attempts count,
 * so a row is never left depending on THIS function's own Cloud Tasks call
 * having worked: if that call fails, the row is exactly as it was before,
 * and the next scheduled run (once the short reap-claim window has expired)
 * finds it again. See the migration file for why.
 *
 * Same auth pattern as scheduled-job: a shared webhook secret, meant to be
 * called by Cloud Scheduler on a fixed interval, not by any student-facing
 * path.
 *
 * FAULT_INJECT_REAP_FAIL=true (staging test use only): skips the actual
 * Cloud Tasks call for every candidate this run, so a "replacement task
 * enqueue failed" scenario can be tested without a real outage. Must not be
 * left set after a test.
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

  const PROJECT = Deno.env.get("GCP_PROJECT") ?? "prooflab-508214";
  const LOCATION = Deno.env.get("TASKS_LOCATION") ?? "asia-south1";
  const QUEUE = Deno.env.get("TRANSCRIPTION_QUEUE") ?? "prooflab-staging-transcription";
  const WORKER_URL = Deno.env.get("TRANSCRIPTION_WORKER_URL") ?? "";
  const INVOKER_SA = Deno.env.get("TASKS_INVOKER_SA") ?? "";
  const STALE_AFTER_SECONDS = Number(Deno.env.get("STALE_AFTER_SECONDS") ?? "180");

  const FAULT_INJECT_REAP_FAIL = Deno.env.get("FAULT_INJECT_REAP_FAIL") === "true";

  try {
    const db = createClient("", "");
    const { data: candidates, error } = await db.rpc("claim_transcription_recovery", {
      _stale_after_seconds: STALE_AFTER_SECONDS,
    });
    if (error) throw error;

    const rows: { id: string; storage_path: string; kind: string; attempt: number }[] = candidates ?? [];
    const token = await googleToken();
    const reenqueued: string[] = [];
    const failed: string[] = [];
    for (const row of rows) {
      if (FAULT_INJECT_REAP_FAIL) {
        console.error(`transcription-reap: FAULT INJECTION - skipping enqueue for ${row.id} (${row.kind})`);
        failed.push(row.id);
        continue;
      }
      // Named by this row's own reap-attempt count (already incremented by
      // the claim above), not a timestamp or just "pending/processing" - two
      // different attempt numbers must get two different names (a row can
      // legitimately be reaped more than once), while a retried call of the
      // SAME attempt (Cloud Scheduler retrying its own HTTP request before
      // this ran again) reuses the name and hits Cloud Tasks' ALREADY_EXISTS
      // instead of creating a second task. The database's lease token is
      // what actually prevents duplicate work once a task is delivered; this
      // name only avoids duplicate creation.
      const taskName =
        `projects/${PROJECT}/locations/${LOCATION}/queues/${QUEUE}/tasks/transcribe-${row.id}-reap-${row.attempt}`;
      const res = await fetch(
        `https://cloudtasks.googleapis.com/v2/projects/${PROJECT}/locations/${LOCATION}/queues/${QUEUE}/tasks`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            task: {
              name: taskName,
              httpRequest: {
                httpMethod: "POST",
                url: `${WORKER_URL}/transcribe-job`,
                headers: { "Content-Type": "application/json" },
                body: btoa(JSON.stringify({ voice_id: row.id })),
                oidcToken: { serviceAccountEmail: INVOKER_SA, audience: WORKER_URL },
              },
            },
          }),
        },
      );
      if (res.ok || res.status === 409) reenqueued.push(row.id);
      else {
        failed.push(row.id);
        console.error(`transcription-reap: re-enqueue failed for ${row.id}: ${res.status} ${await res.text()}`);
      }
    }

    return new Response(JSON.stringify({
      ok: true, candidates: rows.length, reenqueued: reenqueued.length, failed: failed.length,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    console.error("transcription-reap error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

async function googleToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  const body = await res.json();
  return body.access_token;
}
