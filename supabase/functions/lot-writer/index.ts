import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";

/**
 * Writes the Lot behind a topic — once, for everybody.
 *
 * A Lot is a piece of real work: a situation, the thing to build or fix, and
 * what to hand back. Generating one per student per day would be ten thousand
 * model calls every morning for work that is word-for-word identical, so a Lot
 * is written once per topic and stored in lot_templates. There are 146 topics,
 * which caps the lifetime spend of this endpoint at 146 calls.
 *
 * The student who is first to reach a topic gets the plain seed version
 * instantly, this runs while they are looking at it, and their card is rewritten
 * in place the moment it lands — so nobody stares at a spinner and nobody is
 * left with the plain one.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const CATEGORIES = new Set(['technical', 'business', 'pitch']);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard']);

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

interface RealJob {
  role: string;
  company: string;
  excerpt: string;
}

const prompt = (
  level: { skill: string; title: string; track_slug: string; level_number: number; kind: string },
  realJob: RealJob | null,
) => `
You write daily work orders ("Lots") for Indian engineering students preparing for their first job.

A Lot is one concrete piece of work someone would actually be handed at a company — not a tutorial exercise, not a quiz. It names a situation, says what is wrong or wanted, and says what to hand back.

Topic: ${level.title}
Skill: ${level.skill}
Track: ${level.track_slug}
Position on the ladder: step ${level.level_number} of 146 (early steps are basics, later steps are advanced)
Type: ${level.kind === 'explanation' ? 'explaining and communicating' : 'building or fixing'}

Rules:
- The scenario is 3 to 5 sentences, in plain English, second person ("you").
- It must be doable in under an hour by one student on their own laptop.
- Say exactly what to submit at the end.
- No greeting, no praise, no "in this task you will learn".
- If a short piece of starter or broken code makes the work concrete, include it (max 15 lines). Otherwise use null.
${realJob ? `- A real job posting for "${realJob.role}" at ${realJob.company} is the source for this Lot. Ground the scenario in what it actually asks for, quoted below. Do not invent a different company or role.
- Leave source_jd as null — the real posting is attached separately, you do not need to name it.

Real posting excerpt:
"""
${realJob.excerpt}
"""` : `- source_jd is a short phrase naming the kind of job this work comes from, e.g. "a fresher backend JD, Hyderabad". Never invent a company name.`}

Reply with JSON only, exactly these keys:
{"title": string (max 90 chars, names the work, not the topic),
 "scenario": string,
 "code_sample": string or null,
 "source_jd": string or null,
 "difficulty": "Easy" | "Medium" | "Hard",
 "estimate_minutes": integer between 10 and 45,
 "lot_category": "technical" | "business" | "pitch"}
`.trim();

serve(async (req) => {
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
    const levelId: string | undefined =
      typeof body?.level_id === 'string' ? body.level_id : undefined;
    if (!levelId) return json({ error: 'level_id is required' }, 400);

    const { data: roles } = await supabase
      .from('user_roles').select('role').eq('user_id', callerId);
    const isAdmin = (roles ?? []).some((r: { role: string }) => r.role === 'admin');

    // A student may only pay for the topic their own Lot is about. Without this
    // one account could walk the whole ladder and spend the model budget on
    // topics nobody has reached.
    if (!isAdmin) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: mine } = await supabase
        .from('tasks')
        .select('id')
        .eq('student_id', callerId)
        .eq('lot_date', today)
        .eq('level_id', levelId)
        .maybeSingle();
      if (!mine) return json({ error: 'That is not your Lot for today.' }, 403);
    }

    const { data: existing } = await supabase
      .from('lot_templates')
      .select('level_id, origin')
      .eq('level_id', levelId)
      .maybeSingle();

    // Somebody else reached this topic first and already paid for it.
    if (existing?.origin === 'ai') {
      return json({ ok: true, level_id: levelId, written: false, reason: 'already written' });
    }

    // Claim the topic before spending anything.
    //
    // Two students reaching a new topic within the same few seconds both read a
    // seed template, both call the model, and the write only converges them
    // after both calls have been paid for. The claim is a conditional UPDATE, so
    // exactly one caller can hold it, and it hands back a token.
    //
    // The lease is two minutes and the model can take longer than that — the
    // provider chain has a retry and two fallbacks behind it — so the token is
    // heartbeated while the call is in flight. The lease therefore only lapses
    // when this isolate has actually stopped running, and the write at the end
    // is fenced on the same token so a caller that did lose its claim cannot
    // overwrite whatever replaced it.
    // Seeding and claiming happen in one statement, so there is no window in
    // which a caller can reach a topic with no row yet and generate without
    // holding the claim. Three concurrent requests on a brand-new topic all
    // generated before this was one call.
    const { data: claimed } = await supabase.rpc('ensure_and_claim_lot_template', {
      _level_id: levelId,
    });
    const token = (claimed as string | null) ?? null;
    if (!token) {
      return json({
        ok: true, level_id: levelId, written: false,
        reason: 'another request is writing this topic',
      });
    }

    const heartbeat = setInterval(() => {
      supabase.rpc('touch_lot_template', { _level_id: levelId, _token: token })
        .then(() => {}, () => {});
    }, 30_000);

    const letGo = async () => {
      clearInterval(heartbeat);
      await supabase.rpc('release_lot_template', { _level_id: levelId, _token: token });
    };

    const { data: level } = await supabase
      .from('levels')
      .select('id, skill, title, track_slug, level_number, kind')
      .eq('id', levelId)
      .maybeSingle();
    if (!level) return json({ error: 'No such topic' }, 404);

    // A real posting beats an invented one. Match on the skill appearing
    // anywhere in the description text — eligible_branch is a student's
    // academic branch (CSE/ECE/...), not a skill area, so it is not a useful
    // filter here. A plain ilike, not .or(), so a skill name with a comma or
    // parenthesis cannot break PostgREST's filter-string parsing.
    const { data: realJobRow } = await supabase
      .from('job_opportunities')
      .select('role, company_name, description')
      .eq('status', 'approved')
      .ilike('description', `%${level.skill}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const realJob: RealJob | null = realJobRow?.description
      ? {
          role: realJobRow.role,
          company: realJobRow.company_name,
          // A whole posting is more than a Lot needs and costs more tokens for
          // no benefit past the first few hundred characters of substance.
          excerpt: String(realJobRow.description).slice(0, 800),
        }
      : null;

    const { text, provider } = await generateText(
      prompt(level as never, realJob),
      { temperature: 0.8, maxOutputTokens: 900, json: true },
      { feature: 'lot-writer', userId: callerId, studentId: callerId },
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
    } catch {
      // Hand the topic back so the next caller can try rather than waiting out
      // the lease.
      await letGo();
      return json({ error: 'The model did not return usable JSON' }, 502);
    }

    const title = String(parsed.title ?? level.title).slice(0, 90);
    const scenario = String(parsed.scenario ?? '').trim();
    // A Lot with no situation in it is the thing this endpoint exists to
    // replace, so a short answer is refused rather than saved over the seed.
    if (scenario.length < 80) {
      await letGo();
      return json({ error: 'The model returned an empty scenario' }, 502);
    }

    const row = {
      level_id: levelId,
      title,
      scenario,
      code_sample: typeof parsed.code_sample === 'string' && parsed.code_sample.trim()
        ? parsed.code_sample : null,
      // A real posting's label is deterministic, never left to the model to
      // restate — that is the whole point of grounding this in something real.
      source_jd: realJob
        ? `${realJob.role} at ${realJob.company}`
        : (typeof parsed.source_jd === 'string' && parsed.source_jd.trim() ? parsed.source_jd : null),
      difficulty: DIFFICULTIES.has(String(parsed.difficulty)) ? String(parsed.difficulty) : 'Medium',
      estimate_minutes: clampInt(parsed.estimate_minutes, 10, 45, 20),
      lot_category: CATEGORIES.has(String(parsed.lot_category))
        ? String(parsed.lot_category)
        : (level.kind === 'explanation' ? 'pitch' : 'technical'),
      origin: 'ai',
      generating_since: null,
      updated_at: new Date().toISOString(),
    };

    clearInterval(heartbeat);

    // Fenced on the same token: a caller whose lease lapsed and was taken by
    // somebody else writes nothing rather than overwriting what replaced it.
    const { data: saved, error: saveError } = await supabase.rpc('save_lot_template', {
      _level_id: levelId,
      _token: token,
      _title: row.title,
      _scenario: row.scenario,
      _code_sample: row.code_sample,
      _source_jd: row.source_jd,
      _difficulty: row.difficulty,
      _estimate_minutes: row.estimate_minutes,
      _lot_category: row.lot_category,
    });
    if (saveError) return json({ error: saveError.message }, 500);
    if (saved !== true) {
      return json({
        ok: true, level_id: levelId, written: false,
        reason: 'another request finished this topic first',
      });
    }

    // Rewrite today's cards that are still on the seed version. Only ones
    // nobody has started: a student who has already begun keeps the wording
    // they read, because changing the work under someone mid-task is worse
    // than leaving them on the plain version.
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
      })
      .eq('level_id', levelId)
      .eq('lot_date', today)
      .eq('status', 'pending')
      .is('started_at', null)
      .select('id');

    return json({
      ok: true,
      level_id: levelId,
      written: true,
      provider,
      cards_refreshed: (updated ?? []).length,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
