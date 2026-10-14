import { selfAuthoredTask } from "../_shared/submission.ts";
import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard } from "../_shared/rate-limit.ts";
import { cors } from "../_shared/cors.ts";
import {
  gradeOnce, zeroUnquotedCredit, totalOf, wordCount, DISAGREEMENT_THRESHOLD, type Criterion,
} from "../_shared/rubric-grading.ts";
import { decidingGrade, needsThirdOpinion, seriousCopy, type SimilarityResult } from "../_shared/review-policy.ts";

/**
 * Final submit for a rubric-graded (written) task: business/pitch Lots,
 * Writing/Research/Analysis assigned tasks, hr-behavioral/verbal-ability
 * level proofs.
 *
 * One LLM grading pass scores the answer against the rubric. A second,
 * independent pass only runs when that first score lands within
 * NEAR_THRESHOLD points of pass_threshold — a clear pass or clear fail
 * doesn't need a second opinion, a borderline one does. If those two disagree
 * by more than DISAGREEMENT_THRESHOLD, ONE third pass settles it (median of
 * three; never more than three calls). AI decides normal cases (S31).
 * Only a serious evidence-integrity signal routes the answer to a human via
 * needs_review: a near-verbatim copy of another student's earlier answer to
 * the SAME question that is not just a restatement of the prompt or reference
 * answer (_shared/review-policy.ts). A clean pass/fail goes straight through
 * record_task_submission(), the same completion path sandbox tasks use
 * (stage69).
 */

const NEAR_THRESHOLD = 10;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  // Request-specific CORS on every reply, not only the preflight.
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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
      .select("id, student_id, rubric_config_id, title, description, inserted_by").eq("id", task_id).maybeSingle();
    if (!task?.rubric_config_id) return json({ error: "This is not a written task" }, 404);
    // A task its own student created is never evidence (migration 103; the database refuses it too).
    if (selfAuthoredTask(task)) return json({ error: "This task cannot be submitted as evidence" }, 403);
    if (task.student_id !== profile.id) {
      const { data: assigned } = await db.from("task_assignments")
        .select("id").eq("task_id", task_id).eq("student_id", profile.id).maybeSingle();
      if (!assigned) return json({ error: "Task not found" }, 404);
    }

    const { data: done } = await db.from("task_submissions")
      .select("id").eq("task_id", task_id).eq("student_id", profile.id).eq("status", "passed").maybeSingle();
    if (done) return json({ error: "You already completed this task", already_completed: true }, 409);

    const { data: cfg } = await db.from("task_rubric_config")
      .select("id, prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, is_generic_fallback, origin")
      .eq("id", task.rubric_config_id).single();
    if (!cfg) return json({ error: "This task has no checklist yet" }, 404);

    // 5. Word count, checked before spending anything on grading
    const words = wordCount(answer);
    if (words < cfg.min_words) {
      return json({ error: `Your answer is too short (${words} words). Write at least ${cfg.min_words}.` }, 400);
    }
    if (words > cfg.max_words) {
      return json({ error: `Your answer is too long (${words} words). Keep it under ${cfg.max_words}.` }, 400);
    }

    const criteria = cfg.criteria as Criterion[];
    // The grader must see what was asked. A task-specific checklist already
    // describes it; the shared one (used by every task without its own) only
    // works together with the task's own title and description.
    const gradingPrompt = `${cfg.prompt_text}

THE TASK CARD THE STUDENT WAS GIVEN:
Title: ${task.title ?? ""}
${task.description ?? ""}`;
    const flags: string[] = [];

    // 6. Integrity pre-check, before paying for grading: compared ONLY with other students'
    // answers to this exact question (same checklist and same task text), and judged by
    // review-policy.seriousCopy. Similar correct answers and shared terminology are normal.
    // A failure of this check never blocks or accuses the student (missing data = no flag).
    const { data: similarity, error: simError } = await db.rpc("similar_written_answer", {
      _task_id: task_id, _student_id: profile.id, _answer: answer,
    });
    if (simError) console.error("similar_written_answer failed:", simError.message);
    else if (seriousCopy(similarity as SimilarityResult)) flags.push("copied_answer");

    // 7. Grade once. A second, independent grader only runs when the first
    // score is close enough to the pass line that a second opinion actually
    // changes anything — a clear pass or clear fail doesn't need one, and
    // skipping it there roughly halves grading LLM calls in the common case.
    const maxTotal = criteria.reduce((s, c) => s + c.max_points, 0);

    const gradeA = await gradeOnce(gradingPrompt, criteria, answer, callerId);
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
      const gradeB = await gradeOnce(gradingPrompt, criteria, answer, callerId);
      if (!gradeB) {
        return json({
          error: "Grading is busy right now. This is not a problem with your answer - try again in a minute.",
          runner_unavailable: true,
        }, 503);
      }
      const checkedB = zeroUnquotedCredit(gradeB, answer);
      const totalB = totalOf(checkedB);
      const graded = [checkedA, checkedB];
      const totals = [totalA, totalB];

      // Two graders far apart on a borderline answer: ONE more opinion settles it (median of
      // three). A grading disagreement is not an integrity problem, so it never goes to a human.
      if (needsThirdOpinion(totalA, totalB, DISAGREEMENT_THRESHOLD)) {
        const gradeC = await gradeOnce(gradingPrompt, criteria, answer, callerId);
        if (!gradeC) return json({
          error: "Grading is busy right now. This is not a problem with your answer - try again in a minute.",
          runner_unavailable: true,
        }, 503);
        const checkedC = zeroUnquotedCredit(gradeC, answer);
        graded.push(checkedC);
        totals.push(totalOf(checkedC));
      }
      // Two grades: the lower (an optimistic single grader should not decide a pass). Three: the median.
      const pick = decidingGrade(totals);
      lower = graded[pick];
      score = maxTotal > 0 ? Math.round((totals[pick] / maxTotal) * 100) : 0;
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
