import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";
import { generateGradedConfig, type AutoConfigMode } from "../_shared/auto-config.ts";

/**
 * Writes the Lot behind a piece of real content — once, for everybody.
 *
 * stage75: a Lot is no longer written "for a Track level." It is written for
 * one source_content row (the crawler's own pages, or something a college
 * submitted) — Lots and Tracks are unrelated. Generating one per student per
 * day would be a huge number of duplicate model calls for identical work, so
 * a Lot is written once per source_content row and stored in lot_templates,
 * keyed by source_content_id. Whoever is first to reach a given piece of
 * content pays for it once; everyone after reads the cached result for free.
 *
 * The student who is first to reach a piece of content gets the plain seed
 * version instantly, this runs while they are looking at it, and their card
 * is rewritten in place the moment it lands — so nobody stares at a spinner
 * and nobody is left with the plain one.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

const CATEGORIES = new Set(['technical', 'business', 'pitch']);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard']);

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

interface RealJob {
  kind: 'job';
  role: string;
  company: string;
  excerpt: string;
}

interface RealContent {
  kind: 'content';
  title: string;
  origin: 'college' | 'web';
  excerpt: string;
}

type RealSource = RealJob | RealContent;

/**
 * Fallback only — source_content.grading_mode_hint (stage76) is checked
 * first. This keyword guess exists for content nobody has tagged yet: fresh
 * crawler runs and fresh college submissions land with no hint set. Grading
 * mode has to be picked BEFORE generateGradedConfig runs — it needs to know
 * which schema to ask the model for.
 */
const CODE_SIGNALS = /\b(code|coding|program(ming)?|algorithm|function|syntax|debug|compile|array|loop|api|sql|query|script|variable|data structure)\b/i;

function guessGradingMode(title: string, excerpt: string): AutoConfigMode {
  return CODE_SIGNALS.test(title) || CODE_SIGNALS.test(excerpt.slice(0, 400)) ? 'sandbox' : 'rubric';
}

const prompt = (
  contentTitle: string,
  realSource: RealSource | null,
) => `
You write daily work orders ("Lots") for Indian engineering students preparing for their first job.

A Lot is one concrete piece of work someone would actually be handed at a company — not a tutorial exercise, not a quiz. It names a situation, says what is wrong or wanted, and says what to hand back.

Grounding material: ${contentTitle}

Rules:
- The scenario is 3 to 5 sentences, in plain English, second person ("you").
- It must be doable in under an hour by one student on their own laptop.
- Say exactly what to submit at the end.
- No greeting, no praise, no "in this task you will learn".
- If a short piece of starter or broken code makes the work concrete, include it (max 15 lines). Otherwise use null.
${realSource?.kind === 'job' ? `- A real job posting for "${realSource.role}" at ${realSource.company} is the source for this Lot. Ground the scenario in what it actually asks for, quoted below. Do not invent a different company or role.
- Leave source_jd as null — the real posting is attached separately, you do not need to name it.

Real posting excerpt:
"""
${realSource.excerpt}
"""` : realSource?.kind === 'content' ? `- Real ${realSource.origin === 'college' ? "material submitted by the student's own college" : 'reference material'} titled "${realSource.title}" is the source for this Lot. Ground the scenario in what it actually covers — do not invent unrelated specifics.
- Leave source_jd as null — the real source is attached separately, you do not need to name it.

Real source excerpt:
"""
${realSource.excerpt}
"""` : `- source_jd is a short phrase naming the kind of job this work comes from, e.g. "a fresher backend JD, Hyderabad". Never invent a company name.`}
`.trim();

const SCENARIO_FIELDS = {
  title: "string, max 90 chars, names the work, not the topic",
  scenario: "string, 3 to 5 sentences",
  code_sample: "string or null, max 15 lines",
  source_jd: "string or null",
  difficulty: '"Easy" | "Medium" | "Hard"',
  estimate_minutes: "integer between 10 and 45",
  lot_category: '"technical" | "business" | "pitch"',
};

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing authorization' }, 401);

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsError } = await authClient.auth.getClaims(
      authHeader.replace('Bearer ', ''),
    );
    if (claimsError || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const callerId = claims.claims.sub as string;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const sourceContentId: string | undefined =
      typeof body?.source_content_id === 'string' ? body.source_content_id : undefined;
    if (!sourceContentId) return json({ error: 'source_content_id is required' }, 400);

    const { data: roles } = await supabase
      .from('user_roles').select('role').eq('user_id', callerId);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');

    // A student may only pay for content their own Lot is about. Without
    // this one account could walk the whole pool and spend the model budget
    // on content nobody has reached.
    if (!isAdmin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: mine } = await supabase
        .from('tasks')
        .select('id')
        .eq('student_id', callerId)
        .eq('lot_date', today)
        .eq('source_content_id', sourceContentId)
        .maybeSingle();
      if (!mine) return json({ error: 'That is not your Lot for today.' }, 403);
    }

    const { data: existing } = await supabase
      .from('lot_templates')
      .select('source_content_id, origin')
      .eq('source_content_id', sourceContentId)
      .maybeSingle();

    if (existing?.origin === 'ai') {
      return json({ ok: true, source_content_id: sourceContentId, written: false, reason: 'already written' });
    }

    // Claim before spending anything — same fenced-lease pattern as before,
    // just keyed on source_content_id now. See the long comment this
    // replaced in git history (stage69/stage31) for why the claim exists.
    const { data: claimed } = await supabase.rpc('ensure_and_claim_lot_template', {
      _source_content_id: sourceContentId,
    });
    const token = (claimed as string | null) ?? null;
    if (!token) {
      return json({
        ok: true, source_content_id: sourceContentId, written: false,
        reason: 'another request is writing this content',
      });
    }

    const heartbeat = setInterval(() => {
      supabase.rpc('touch_lot_template', { _source_content_id: sourceContentId, _token: token })
        .then(() => {}, () => {});
    }, 30_000);

    const letGo = async () => {
      clearInterval(heartbeat);
      await supabase.rpc('release_lot_template', { _source_content_id: sourceContentId, _token: token });
    };

    const { data: content } = await supabase
      .from('source_content')
      .select('id, title, markdown, submitted_by_college_id, grading_mode_hint')
      .eq('id', sourceContentId)
      .maybeSingle();
    if (!content) {
      await letGo();
      return json({ error: 'No such content' }, 404);
    }

    const contentTitle = String(content.title ?? 'today\'s work').slice(0, 200);

    // A real matching job posting still beats plain grounding in the source
    // content itself, when one exists for roughly the same subject.
    const { data: realJobRow } = await supabase
      .from('job_opportunities')
      .select('role, company_name, description')
      .eq('status', 'approved')
      .ilike('description', `%${contentTitle.split(' ')[0]}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const realSource: RealSource = realJobRow?.description
      ? {
          kind: 'job',
          role: realJobRow.role,
          company: realJobRow.company_name,
          excerpt: String(realJobRow.description).slice(0, 800),
        }
      : {
          kind: 'content',
          title: contentTitle,
          origin: content.submitted_by_college_id ? 'college' : 'web',
          excerpt: String(content.markdown ?? '').slice(0, 800),
        };

    // stage76: a real, hand-checked signal beats the keyword guess whenever
    // it exists. New content (fresh crawler runs, fresh college submissions)
    // has no hint yet and falls back to the heuristic below.
    const gradingMode: AutoConfigMode =
      content.grading_mode_hint === 'sandbox' || content.grading_mode_hint === 'rubric'
        ? content.grading_mode_hint
        : guessGradingMode(contentTitle, String(content.markdown ?? ''));

    const genResult = await generateGradedConfig({
      db: supabase,
      mode: gradingMode,
      content: {
        kind: 'scenario',
        promptBody: prompt(contentTitle, realSource),
        fields: SCENARIO_FIELDS,
      },
      feature: 'lot-writer',
      usageCtx: { userId: callerId, studentId: callerId },
    });

    const parsed = genResult.scenarioFields;
    const title = String(parsed.title ?? contentTitle).slice(0, 90);
    const scenario = String(parsed.scenario ?? '').trim();
    if (scenario.length < 80) {
      await letGo();
      return json({ error: 'The model returned an empty scenario' }, 502);
    }

    const row = {
      source_content_id: sourceContentId,
      title,
      scenario,
      code_sample: typeof parsed.code_sample === 'string' && parsed.code_sample.trim()
        ? parsed.code_sample : null,
      source_jd: realSource.kind === 'job'
        ? `${realSource.role} at ${realSource.company}`
        : `Real source: ${realSource.title}${realSource.origin === 'college' ? ' (from your college)' : ''}`,
      difficulty: DIFFICULTIES.has(String(parsed.difficulty)) ? String(parsed.difficulty) : 'Medium',
      estimate_minutes: clampInt(parsed.estimate_minutes, 10, 45, 20),
      lot_category: CATEGORIES.has(String(parsed.lot_category))
        ? String(parsed.lot_category)
        : (gradingMode === 'rubric' ? 'pitch' : 'technical'),
      origin: 'ai',
      generating_since: null,
      updated_at: new Date().toISOString(),
      sandbox_config_id: genResult.mode === 'sandbox' ? genResult.configId : null,
      rubric_config_id: genResult.mode === 'rubric' ? genResult.configId : null,
    };

    clearInterval(heartbeat);

    const { data: saved, error: saveError } = await supabase.rpc('save_lot_template', {
      _source_content_id: sourceContentId,
      _token: token,
      _title: row.title,
      _scenario: row.scenario,
      _code_sample: row.code_sample,
      _source_jd: row.source_jd,
      _difficulty: row.difficulty,
      _estimate_minutes: row.estimate_minutes,
      _lot_category: row.lot_category,
      _sandbox_config_id: row.sandbox_config_id,
      _rubric_config_id: row.rubric_config_id,
    });
    if (saveError) return json({ error: saveError.message }, 500);
    if (saved !== true) {
      return json({
        ok: true, source_content_id: sourceContentId, written: false,
        reason: 'another request finished this content first',
      });
    }

    // Rewrite today's cards that are still on the seed version. Only ones
    // nobody has started.
    const today = new Date().toISOString().slice(0, 10);
    const { data: updated } = await supabase
      .from('tasks')
      .update({
        title: row.title,
        description: row.scenario,
        code_sample: row.code_sample,
        source_jd: row.source_jd,
        difficulty: row.difficulty,
        estimate_minutes: row.estimate_minutes,
        lot_category: row.lot_category,
        is_ai_generated: true,
        sandbox_config_id: row.sandbox_config_id,
        rubric_config_id: row.rubric_config_id,
      })
      .eq('source_content_id', sourceContentId)
      .eq('lot_date', today)
      .eq('status', 'pending')
      .is('started_at', null)
      .select('id');

    return json({
      ok: true,
      source_content_id: sourceContentId,
      written: true,
      grading_mode: genResult.mode,
      used_fallback: genResult.usedFallback,
      cards_refreshed: (updated ?? []).length,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
