import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";

/**
 * Step 6B (staging only): recovers a transcription job whose worker claimed
 * it and then went silent - crashed, OOM-killed, network-partitioned - before
 * calling complete or fail. Cloud Tasks' own retries cannot be relied on for
 * this: the queue's 3 attempts at 5-30s backoff exhaust in under a minute,
 * well before the 180s staleness window that separates "still working" from
 * "actually dead" - by the time a claim is provably stale, the task that
 * would have redelivered it is already gone.
 *
 * Same auth pattern as scheduled-job: a shared webhook secret, meant to be
 * called by Cloud Scheduler on a fixed interval, not by any student-facing
 * path.
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

  try {
    const db = createClient("", "");
    const { data: released, error } = await db.rpc("reap_stale_transcription_jobs", {
      _stale_after_seconds: STALE_AFTER_SECONDS,
    });
    if (error) throw error;

    const ids: string[] = (released ?? []).map((r: { id: string }) => r.id);
    const token = await googleToken();
    const reenqueued: string[] = [];
    for (const id of ids) {
      // A fresh, unique name every time - unlike the initial enqueue, this is
      // not trying to prevent a duplicate task, only to avoid Cloud Tasks'
      // "task name recently used" restriction on reusing the original name.
      // The database's lease token is what actually prevents duplicate work,
      // not this name.
      const taskName =
        `projects/${PROJECT}/locations/${LOCATION}/queues/${QUEUE}/tasks/transcribe-${id}-reap-${Date.now()}`;
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
                body: btoa(JSON.stringify({ voice_id: id })),
                oidcToken: { serviceAccountEmail: INVOKER_SA, audience: WORKER_URL },
              },
            },
          }),
        },
      );
      if (res.ok) reenqueued.push(id);
      else console.error(`transcription-reap: re-enqueue failed for ${id}: ${res.status} ${await res.text()}`);
    }

    return new Response(JSON.stringify({ ok: true, released: ids.length, reenqueued: reenqueued.length }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
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
