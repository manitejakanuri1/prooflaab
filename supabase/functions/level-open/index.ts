import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import {
  advanceUnlock,
  ensureTopicSteps,
  quizForStudent,
  type LevelRow,
} from "../_shared/levels.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

/**
 * Open one topic and serve whichever of its steps is next for this student.
 *
 * A topic is now several rows (levels.sub_level 1..N are explanation steps,
 * the last is the checkpoint quiz). Reading a step does not clear it on its
 * own — that would mean a page refresh mid-read silently skips ahead. Clearing
 * only happens when the caller explicitly passes advance_step: true, which the
 * "Got it, next" button sends for the step currently on screen.
 */

const DONE_STATUSES = new Set(['placed', 'cleared', 'mastered']);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsStatic, 'Content-Type': 'application/json' },
  });

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

    const { track_slug, level_number, advance_step, skip_to_checkpoint } = await req.json();
    if (typeof track_slug !== 'string' || !Number.isInteger(level_number)) {
      return json({ error: 'track_slug and level_number are required' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    // The seed row (sub_level=1) always exists — it's what the original
    // curriculum migration/seed created. ensureTopicSteps expands it into the
    // full step set the first time anyone opens this topic.
    const { data: seed } = await supabase
      .from('levels')
      .select('id, track_slug, level_number, sub_level, kind, skill, title')
      .eq('track_slug', track_slug)
      .eq('level_number', level_number)
      .eq('sub_level', 1)
      .maybeSingle();
    if (!seed) return json({ error: 'That topic does not exist' }, 404);

    // Joining a track is not a privilege — the map is public and picking a new
    // path should not need a separate round trip. What is gated is how far in
    // they may go, and that starts at level 1 for anyone who was never placed.
    let { data: track } = await supabase
      .from('student_tracks')
      .select('placed_at_level, unlocked_through')
      .eq('student_id', profile.id)
      .eq('track_slug', track_slug)
      .maybeSingle();

    if (!track) {
      const { data: created, error: createError } = await supabase
        .from('student_tracks')
        .insert({ student_id: profile.id, track_slug, placed_at_level: 1, unlocked_through: 1 })
        .select('placed_at_level, unlocked_through')
        .single();
      if (createError) {
        console.error('Could not enrol student on track:', createError.message);
        return json({ error: 'Could not start this track' }, 500);
      }
      track = created;
    }

    let steps: LevelRow[];
    let contentByLevelId: Record<string, any>;
    try {
      const ensured = await ensureTopicSteps(supabase, seed as LevelRow, {
        userId: callerId,
        studentId: profile.id,
      });
      steps = ensured.levels;
      contentByLevelId = ensured.contentByLevelId;
    } catch (err) {
      console.error('Topic content generation failed:', err);
      return json(
        {
          error: 'This topic is still being written. Give it a few seconds and try again.',
          content_unavailable: true,
        },
        503,
      );
    }

    const { data: progressRows } = await supabase
      .from('student_levels')
      .select('level_id, status, best_score, attempts, task_id, evidence')
      .eq('student_id', profile.id)
      .in('level_id', steps.map((s) => s.id));

    const progressById = new Map<string, any>((progressRows ?? []).map((p: any) => [p.level_id, p]));

    const pickTarget = () => {
      for (const s of steps) {
        if (!DONE_STATUSES.has(progressById.get(s.id)?.status ?? '')) return s;
      }
      return steps[steps.length - 1]; // everything done — reopen the last for review
    };

    let target = pickTarget();

    // Explicit advance: the step currently on screen is done, mark it and move on.
    if (advance_step === true && target.kind === 'explanation') {
      const already = progressById.get(target.id);
      if (!DONE_STATUSES.has(already?.status ?? '')) {
        const { error } = await supabase.from('student_levels').upsert(
          {
            student_id: profile.id,
            level_id: target.id,
            status: 'cleared',
            cleared_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'student_id,level_id' },
        );
        if (error) console.error('Could not advance step:', error.message);
        else progressById.set(target.id, { ...already, status: 'cleared' });
      }
      target = pickTarget();
    }

    // "I already know this" lane: mark every remaining explanation step
    // cleared in one shot and land straight on the checkpoint, instead of
    // clicking "Got it, next" N times. Same DB effect as reading them one by
    // one — no shortcut around the checkpoint quiz itself.
    if (skip_to_checkpoint === true) {
      while (target.kind === 'explanation') {
        const already = progressById.get(target.id);
        if (!DONE_STATUSES.has(already?.status ?? '')) {
          const { error } = await supabase.from('student_levels').upsert(
            {
              student_id: profile.id,
              level_id: target.id,
              status: 'cleared',
              cleared_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'student_id,level_id' },
          );
          if (error) console.error('Could not skip step:', error.message);
          else progressById.set(target.id, { ...already, status: 'cleared' });
        }
        target = pickTarget();
      }
    }

    const progress = progressById.get(target.id);
    const alreadyDone = DONE_STATUSES.has(progress?.status ?? '');
    if (level_number > track!.unlocked_through && !alreadyDone) {
      return json(
        {
          error: 'This topic is still locked. Finish the one before it first.',
          locked: true,
          unlocked_through: track!.unlocked_through,
        },
        403,
      );
    }

    const content = contentByLevelId[target.id];

    // Mark it opened, but never downgrade a step they have already finished.
    if (!progress) {
      const { error: openError } = await supabase.from('student_levels').insert({
        student_id: profile.id,
        level_id: target.id,
        status: 'opened',
      });
      if (openError) console.error('Could not record level open:', openError.message);
    }

    const unlockedThrough = await advanceUnlock(supabase, profile.id, track_slug);

    const explanationSteps = steps.filter((s) => s.kind === 'explanation');
    const stepIndex = target.kind === 'explanation'
      ? explanationSteps.findIndex((s) => s.id === target.id) + 1
      : null;

    return json({
      level: {
        id: target.id,
        track_slug: target.track_slug,
        level_number: target.level_number,
        sub_level: target.sub_level,
        kind: target.kind,
        skill: target.skill,
        title: target.title,
      },
      step_index: stepIndex,
      total_steps: explanationSteps.length,
      explanation: content?.explanation ?? '',
      sandbox: content?.sandbox ?? null,
      code_example: content?.code_example ?? null,
      quiz: target.kind === 'checkpoint' ? quizForStudent(content?.quiz ?? []) : [],
      proof: content?.proof_title ? { title: content.proof_title, brief: content.proof_brief } : null,
      // Only on the checkpoint: an explanation step has nothing to look up yet.
      resources: target.kind === 'checkpoint' ? (content?.resources ?? null) : null,
      status: progressById.get(target.id)?.status ?? 'opened',
      evidence: progress?.evidence ?? null,
      best_score: progress?.best_score ?? 0,
      attempts: progress?.attempts ?? 0,
      task_id: progress?.task_id ?? null,
      unlocked_through: unlockedThrough,
    });
  } catch (error) {
    console.error('Error in level-open:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
