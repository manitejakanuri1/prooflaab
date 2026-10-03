import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";

/**
 * Step 6 (staging only): the async replacement for the browser calling
 * prooflab-staging-transcriber directly. The browser still uploads the audio
 * itself, unchanged - this only creates the tracking row and hands the actual
 * work to Cloud Tasks, so the browser is free the moment this returns instead
 * of blocking on Whisper.
 *
 * Not wired into any UI yet. VoiceExplainModal.tsx is untouched; this exists
 * to prove the pipeline end to end before anything real calls it.
 */

const PROJECT = Deno.env.get("GCP_PROJECT") ?? "prooflab-508214";
const LOCATION = Deno.env.get("TASKS_LOCATION") ?? "asia-south1";
const QUEUE = Deno.env.get("TRANSCRIPTION_QUEUE") ?? "prooflab-staging-transcription";
const WORKER_URL = Deno.env.get("TRANSCRIPTION_WORKER_URL") ?? "";
const INVOKER_SA = Deno.env.get("TASKS_INVOKER_SA") ?? "";

async function googleToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  const body = await res.json();
  return body.access_token;
}

/**
 * The task name is derived from the row's own id, not left to auto-generate.
 * Cloud Tasks refuses to create a second task with a name already in use
 * (ALREADY_EXISTS) - so a client retry of this whole enqueue call, even one
 * that lands after the row already exists, cannot also create a second task
 * for it. That is the ENQUEUE-side half of idempotency; claim_transcription_job
 * is the PROCESSING-side half.
 */
async function enqueueTask(voiceId: string): Promise<{ already: boolean }> {
  const token = await googleToken();
  const taskName =
    `projects/${PROJECT}/locations/${LOCATION}/queues/${QUEUE}/tasks/transcribe-${voiceId}`;
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
            body: btoa(JSON.stringify({ voice_id: voiceId })),
            oidcToken: { serviceAccountEmail: INVOKER_SA, audience: WORKER_URL },
          },
        },
      }),
    },
  );
  if (res.status === 409) return { already: true };
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloud Tasks enqueue failed: ${res.status} ${body.slice(0, 300)}`);
  }
  return { already: false };
}

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);

    const authClient = createClient("", "", { global: { headers: { Authorization: authHeader } } });
    const { data: claims, error: claimsError } =
      await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claims) return json({ error: "Invalid token" }, 401);
    const callerId = claims.claims.sub;

    const { storage_path, task_id, duration_seconds, idempotency_key } = await req.json();
    if (!storage_path || !idempotency_key) {
      return json({ error: "storage_path and idempotency_key are required" }, 400);
    }

    const supabase = createClient("", "");
    const { data: profile } = await supabase
      .from("student_profiles").select("id").eq("user_id", callerId).maybeSingle();
    if (!profile) return json({ error: "Student profile not found" }, 404);

    // (Step 6B) storage_path names an object inside the student's OWN folder
    // (files-service enforces this exact "<uid>/<file>" shape for a real
    // upload - matching it here rather than trusting the client's claim,
    // since this is the only thing standing between a caller and enqueueing
    // someone else's audio under their own name).
    if (!storage_path.startsWith(`${profile.id}/`)) {
      return json({ error: "storage_path does not belong to you" }, 403);
    }

    // (Step 6B) task_id must belong to this student - otherwise a completed
    // transcript could be attached to someone else's task.
    if (task_id) {
      const { data: task } = await supabase.from("tasks")
        .select("id").eq("id", task_id).eq("student_id", profile.id).maybeSingle();
      if (!task) return json({ error: "task_id does not belong to you" }, 403);
      // (Wave 6) An explanation is evidence about a submission. The database
      // binds it (migration 61) and refuses when there is none; answering here
      // first gives the student a clear message instead of a failed insert.
      const { data: sub } = await supabase.from("task_submissions")
        .select("id").eq("task_id", task_id).eq("student_id", profile.id).limit(1).maybeSingle();
      if (!sub) {
        return json({ error: "Submit your work first, then record your explanation.", code: "submission_required" }, 409);
      }
    } else {
      return json({ error: "task_id is required", code: "task_required" }, 400);
    }

    const { data: inserted } = await supabase.from("voice_explanations").insert({
      student_id: profile.id,
      task_id: task_id ?? null,
      proof_id: null,   // the proof link is retired; a recording belongs to a submission
      storage_path,
      duration_seconds: duration_seconds ?? null,
      transcript: null,
      transcript_source: "server",
      transcription_status: "pending",
      transcription_idempotency_key: idempotency_key,
    }).select("id").maybeSingle();

    let voiceId: string | undefined = inserted?.id;
    if (!voiceId) {
      // A retried enqueue call with the same key: the row already exists,
      // reuse it rather than erroring or creating a duplicate. Scoped to
      // THIS student (Step 6B) - a key collision with a row that belongs to
      // someone else is a rejection, never a silent handoff of their job,
      // and the existing row's storage_path is never touched here even if
      // this retry supplied a different one.
      const { data: existing } = await supabase.from("voice_explanations")
        .select("id, student_id")
        .eq("transcription_idempotency_key", idempotency_key).maybeSingle();
      if (existing && existing.student_id !== profile.id) {
        return json({ error: "idempotency_key is already in use" }, 403);
      }
      voiceId = existing?.id;
    }
    if (!voiceId) return json({ error: "Could not create or find the recording" }, 500);

    const { already } = await enqueueTask(voiceId);
    // (Step 6C) Marks this row as "a task was actually handed to Cloud Tasks" -
    // the signal transcription-reap uses to tell a row whose enqueue is still
    // in flight from one whose enqueue never happened at all (see reap.ts's
    // grace-period check). Only reached when enqueueTask did not throw.
    await supabase.from("voice_explanations")
      .update({ transcription_enqueued_at: new Date().toISOString() })
      .eq("id", voiceId);
    return json({ voice_id: voiceId, status: "pending", already_enqueued: already });
  } catch (error) {
    console.error("transcription-enqueue error:", error);
    return json({ error: (error as Error).message || "Internal server error" }, 500);
  }
});
