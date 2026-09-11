import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { guard } from "../_shared/rate-limit.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { gradeTests, redact, type SandboxTest } from "../_shared/sandbox.ts";

/**
 * Final submit for a sandbox task: grades against EVERY test (visible and
 * hidden), stores the graded submission, and — on a pass — completes the
 * task/assignment and pays XP exactly once, all through
 * record_task_submission() so sandbox and rubric (stage70) tasks share one
 * completion path.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // 1. Who is calling
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: claims } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = claims?.claims?.sub as string | undefined;
    if (!callerId) return json({ error: "Unauthorized" }, 401);

    // 2. Spam cap, counted per user in Postgres
    const limited = await guard(req, {
      bucket: "submit-sandbox-task", limit: 20, windowSeconds: 3600, userId: callerId, corsHeaders,
    });
    if (limited) return limited;

    // 3. Input
    const { task_id, code } = await req.json();
    if (typeof task_id !== "string" || typeof code !== "string" || !code.trim()) {
      return json({ error: "task_id and code are required" }, 400);
    }
    if (code.length > 20000) return json({ error: "Code is too long (max 20,000 characters)" }, 400);

    const db = createClient(url, serviceKey);

    // 4. The caller's profile, and a task they are allowed to do
    const { data: profile } = await db.from("student_profiles").select("id").eq("user_id", callerId).maybeSingle();
    if (!profile) return json({ error: "Student profile not found" }, 404);

    const { data: task } = await db.from("tasks")
      .select("id, student_id, sandbox_config_id").eq("id", task_id).maybeSingle();
    if (!task?.sandbox_config_id) return json({ error: "This is not a coding task" }, 404);
    if (task.student_id !== profile.id) {
      const { data: assigned } = await db.from("task_assignments")
        .select("id").eq("task_id", task_id).eq("student_id", profile.id).maybeSingle();
      if (!assigned) return json({ error: "Task not found" }, 404);
    }

    // 5. Already done: do not spend runner calls (the unique index is the real guard)
    const { data: done } = await db.from("task_submissions")
      .select("id").eq("task_id", task_id).eq("student_id", profile.id).eq("status", "passed").maybeSingle();
    if (done) return json({ error: "You already completed this task", already_completed: true }, 409);

    // 6. Grade against ALL tests
    const { data: cfg } = await db.from("task_sandbox_config")
      .select("id, language, test_cases, pass_threshold").eq("id", task.sandbox_config_id).single();

    const started = Date.now();
    const graded = await gradeTests(cfg.language, code, cfg.test_cases as SandboxTest[]);
    if (!graded.ok) {
      console.error("submit-sandbox-task: runner unavailable:", graded.reason);
      return json({
        error: "The code runner is busy right now. This is not a problem with your code. Try again in a minute.",
        runner_unavailable: true,
      }, 503);
    }

    // 7. Store and return the REDACTED details only (students can read their own rows)
    const safe = redact(graded.results);
    const { data: rec, error } = await db.rpc("record_task_submission", {
      _student_id: profile.id, _task_id: task_id, _sandbox_config_id: cfg.id,
      _language: cfg.language, _code: code,
      _passed_count: graded.passedCount, _total_count: graded.results.length, _score: graded.score,
      _details: safe, _runner: graded.runner, _duration_ms: Date.now() - started,
    });
    if (error || !rec?.ok) {
      console.error("record_task_submission failed:", error?.message ?? rec?.reason);
      return json({ error: "Could not save your submission. Try again." }, 500);
    }

    return json({
      score: graded.score,
      pass_threshold: cfg.pass_threshold,
      passed: rec.passed,
      already_completed: rec.already_completed,
      xp_awarded: rec.xp_awarded,
      results: safe,
    });
  } catch (e) {
    console.error("submit-sandbox-task error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
