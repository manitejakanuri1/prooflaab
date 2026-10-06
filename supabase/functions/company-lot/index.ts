import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { cors } from "../_shared/cors.ts";
import { rateLimitResponse } from "../_shared/rate-limit.ts";
import { generateGradedConfig, type AutoConfigMode } from "../_shared/auto-config.ts";
import { lotWordingProblems } from "../_shared/lot-wording.ts";
import { lotPrompt, SCENARIO_FIELDS } from "../_shared/lot-pipeline.ts";

/**
 * A company sets a Lot for shortlisted students (Recruiter = Company, §15).
 *
 * The company's brief is turned into a Lot by the SAME engine as Daily Lots:
 * the wording contract (lot-wording.ts), and an evaluator that validated -
 * coding: reference solution passes, test-quality gate (constant/empty/echo/buggy
 * programs fail); written: a task-specific rubric. If no reliable evaluator can
 * be built the Lot is refused, never handed out with the generic checklist.
 * Then company_create_lot (migration 56) assigns it with the old sponsor rules.
 *
 * POST { student_ids: uuid[], title, brief, criteria?, days?, mode: 'coding' | 'written' }
 */
serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const { data: claims } = await db.auth.getClaims(auth.slice(7));
    const companyId = claims?.claims?.sub as string | undefined;
    if (!companyId) return json({ error: "Unauthorized" }, 401);

    const { data: rec } = await db.from("recruiters").select("id, company, verified").eq("id", companyId).maybeSingle();
    if (!rec?.verified) return json({ error: "Your company account is awaiting approval." }, 403);

    const body = await req.json().catch(() => ({}));
    const studentIds = Array.isArray(body?.student_ids) ? body.student_ids.filter((x: unknown) => typeof x === "string").slice(0, 50) : [];
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
    const brief = typeof body?.brief === "string" ? body.brief.trim().slice(0, 4000) : "";
    const criteria = typeof body?.criteria === "string" ? body.criteria.trim().slice(0, 1000) : "";
    const days = Number.isFinite(Number(body?.days)) ? Math.min(30, Math.max(1, Math.round(Number(body.days)))) : 7;
    const mode: AutoConfigMode | null = body?.mode === "coding" ? "sandbox" : body?.mode === "written" ? "rubric" : null;
    if (!studentIds.length) return json({ error: "Choose at least one shortlisted student." }, 400);
    if (!title || brief.length < 40) return json({ error: "Give the Lot a title and a brief of at least a few sentences." }, 400);
    if (!mode) return json({ error: "Say whether this is coding work (checked by tests) or written work." }, 400);

    // Nothing is generated (and paid for) unless at least one student can receive it.
    const { data: shortlisted } = await db.from("recruiter_shortlists")
      .select("student_id").eq("recruiter_id", companyId).in("student_id", studentIds);
    const eligible: string[] = [];
    for (const sid of (shortlisted ?? []).map((r: { student_id: string }) => r.student_id)) {
      const { data: ok } = await db.rpc("student_is_discoverable", { _student_id: sid });
      if (ok === true) eligible.push(sid);
    }
    if (!eligible.length) return json({ error: "Shortlist the student (with a public profile) before setting them a Lot." }, 400);

    // The brief is the grounding material: the model rewrites it into the Lot
    // contract without changing what the company asked for.
    const promptBody = lotPrompt(title, {
      kind: "content", origin: "web", title: `${title} (a brief written by ${rec.company})`,
      excerpt: `${brief}${criteria ? `\n\nWhat the company will look for: ${criteria}` : ""}`,
    }) + `\n- This Lot was set by a company for specific students: keep exactly the work the company asked for, in the company's own context; only make it clear and complete.`;

    const result = await generateGradedConfig({
      db,
      mode,
      content: { kind: "scenario", promptBody, fields: SCENARIO_FIELDS, validate: (p, m) => lotWordingProblems(p, m) },
      feature: "company-lot",
      usageCtx: { userId: companyId },
      // The company chose the mode: a coding brief is graded by real tests or refused,
      // never turned into a written Lot (no wasted rubric call, no orphan config).
      explicitSandbox: mode === "sandbox",
      // Company briefs describe whole programs (input and output), like every Lot.
      sandboxKind: "stdio",
      // The Lot's difficulty comes from the same reply; the tests are held to it.
      difficulty: "from_reply",
    });

    // Coding must be graded by validated tests; written by its own rubric. A
    // downgrade or the generic checklist means the brief could not be turned
    // into a reliable evaluator: refuse rather than mis-grade students.
    if (result.usedFallback !== "none" || result.mode !== mode || !result.configId) {
      return json({
        error: mode === "sandbox"
          ? "We could not build reliable tests for this brief. Make the expected input and output more specific and try again."
          : "We could not build a reliable marking rubric for this brief. Add more detail and try again.",
      }, 422);
    }
    const f = result.scenarioFields;
    const wording = lotWordingProblems(f, mode);
    if (wording.length) return json({ error: `The Lot wording could not be made clear enough: ${wording[0]}` }, 422);

    const { data, error } = await db.rpc("company_create_lot", {
      _company: companyId, _student_ids: eligible,
      _title: String(f.title ?? title).slice(0, 90), _scenario: String(f.scenario ?? ""),
      _code_sample: typeof f.code_sample === "string" ? f.code_sample : null,
      _criteria: criteria || null, _days: days,
      _sandbox_config_id: mode === "sandbox" ? result.configId : null,
      _rubric_config_id: mode === "rubric" ? result.configId : null,
      _difficulty: result.difficulty ?? (["Easy", "Medium", "Hard"].includes(String(f.difficulty)) ? String(f.difficulty) : "Medium"),
      _estimate_minutes: Math.min(45, Math.max(10, Number(f.estimate_minutes) || 30)),
      _lot_category: ["technical", "business", "pitch"].includes(String(f.lot_category)) ? String(f.lot_category) : "technical",
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ...data, grading: mode === "sandbox" ? "tests" : "rubric", title: f.title });
  } catch (err) {
    const limited = rateLimitResponse(err, corsHeaders);
    if (limited) return limited;
    console.error("company-lot error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});
