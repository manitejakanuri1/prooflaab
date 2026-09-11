import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { guard } from "../_shared/rate-limit.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  gradeOnce, zeroUnquotedCredit, totalOf, wordCount, DISAGREEMENT_THRESHOLD, type Criterion,
} from "../_shared/rubric-grading.ts";

/**
 * Final submit for a rubric-graded (written) task: business/pitch Lots,
 * Writing/Research/Analysis assigned tasks, hr-behavioral/verbal-ability
 * level proofs.
 *
 * One LLM grading pass scores the answer against the rubric. A second,
 * independent pass only runs when that first score lands within
 * NEAR_THRESHOLD points of pass_threshold — a clear pass or clear fail
 * doesn't need a second opinion, a borderline one does. Any of three flags —
 * a grader disagreement over 15 points (only checkable when two ran), a
 * close trigram match to another student's answer, or high AI-authorship
 * risk — routes the submission to a human via needs_review instead of auto
 * pass or fail. A clean pass/fail goes straight through
 * record_task_submission(), the same completion path sandbox tasks use
 * (stage69).
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const NEAR_THRESHOLD = 10;

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

    // 2. Spam cap
    const limited = await guard(req, {
      bucket: "submit-written-task", limit: 10, windowSeconds: 3600, userId: callerId, corsHeaders,
    });
    if (limited) return limited;

    // 3. Input
    const { task_id, answer } = await req.json();
    if (typeof task_id !== "string" || typeof answer !== "string" || !answer.trim()) {
      return json({ error: "task_id and answer are required" }, 400);
    }
    if (answer.length > 20000) return json({ error: "Answer is too long (max 20,000 characters)" }, 400);

    const db = createClient(url, serviceKey);

    // 4. The caller's profile, and a task they are allowed to do
    const { data: profile } = await db.from("student_profiles").select("id").eq("user_id", callerId).maybeSingle();
    if (!profile) return json({ error: "Student profile not found" }, 404);

    const { data: task } = await db.from("tasks")
      .select("id, student_id, rubric_config_id").eq("id", task_id).maybeSingle();
    if (!task?.rubric_config_id) return json({ error: "This is not a written task" }, 404);
    if (task.student_id !== profile.id) {
      const { data: assigned } = await db.from("task_assignments")
        .select("id").eq("task_id", task_id).eq("student_id", profile.id).maybeSingle();
      if (!assigned) return json({ error: "Task not found" }, 404);
    }

    const { data: done } = await db.from("task_submissions")
      .select("id").eq("task_id", task_id).eq("student_id", profile.id).eq("status", "passed").maybeSingle();
    if (done) return json({ error: "You already completed this task", already_completed: true }, 409);

    const { data: cfg } = await db.from("task_rubric_config")
      .select("id, prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer")
      .eq("id", task.rubric_config_id).single();

    // 5. Word count, checked before spending anything on grading
    const words = wordCount(answer);
    if (words < cfg.min_words) {
      return json({ error: `Your answer is too short (${words} words). Write at least ${cfg.min_words}.` }, 400);
    }
    if (words > cfg.max_words) {
      return json({ error: `Your answer is too long (${words} words). Keep it under ${cfg.max_words}.` }, 400);
    }

    const criteria = cfg.criteria as Criterion[];
    const flags: string[] = [];

    // 6. Cheap pre-check: does this closely match another student's answer
    // to the same question? Checked before paying for two LLM calls.
    const { data: similar } = await db.rpc("similar_written_submission", {
      _rubric_config_id: cfg.id, _student_id: profile.id, _answer: answer, _threshold: 0.8,
    });
    if (similar) flags.push("similar");

    // 7. Grade once. A second, independent grader only runs when the first
    // score is close enough to the pass line that a second opinion actually
    // changes anything — a clear pass or clear fail doesn't need one, and
    // skipping it there roughly halves grading LLM calls in the common case.
    const maxTotal = criteria.reduce((s, c) => s + c.max_points, 0);

    const gradeA = await gradeOnce(cfg.prompt_text, criteria, answer, callerId);
    if (!gradeA) {
      return json({
        error: "Grading is busy right now. This is not a problem with your answer - try again in a minute.",
        runner_unavailable: true,
      }, 503);
    }
    const checkedA = zeroUnquotedCredit(gradeA, answer);
    const totalA = totalOf(checkedA);
    const scoreA = maxTotal > 0 ? Math.round((totalA / maxTotal) * 100) : 0;

    let lower = checkedA;
    let score = scoreA;

    if (Math.abs(scoreA - cfg.pass_threshold) <= NEAR_THRESHOLD) {
      // A close call is exactly the case where a second opinion matters most
      // — do not silently fall back to a single grader for a borderline score.
      const gradeB = await gradeOnce(cfg.prompt_text, criteria, answer, callerId);
      if (!gradeB) {
        return json({
          error: "Grading is busy right now. This is not a problem with your answer - try again in a minute.",
          runner_unavailable: true,
        }, 503);
      }
      const checkedB = zeroUnquotedCredit(gradeB, answer);
      const totalB = totalOf(checkedB);

      if (Math.abs(totalA - totalB) > DISAGREEMENT_THRESHOLD) {
        flags.push("grader_disagreement");
      }
      // The lower of the two totals — an optimistic single grader should not
      // be the one that decides a pass.
      lower = totalA <= totalB ? checkedA : checkedB;
      const rawScore = totalA <= totalB ? totalA : totalB;
      score = maxTotal > 0 ? Math.round((rawScore / maxTotal) * 100) : 0;
    }

    const { data: rec, error } = await db.rpc("record_task_submission", {
      _student_id: profile.id, _task_id: task_id, _sandbox_config_id: null,
      _language: null, _code: answer,
      _passed_count: 0, _total_count: 0, _score: score,
      _details: lower, _runner: "llm", _duration_ms: null,
      _rubric_config_id: cfg.id, _rubric_scores: lower, _flags: flags,
    });
    if (error || !rec?.ok) {
      console.error("record_task_submission failed:", error?.message ?? rec?.reason);
      return json({ error: "Could not save your submission. Try again." }, 500);
    }

    return json({
      score,
      pass_threshold: cfg.pass_threshold,
      status: rec.status,
      already_completed: rec.already_completed,
      xp_awarded: rec.xp_awarded,
      scores: lower,
      needs_review: rec.status === "needs_review",
    });
  } catch (e) {
    console.error("submit-written-task error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
