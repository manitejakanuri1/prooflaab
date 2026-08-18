import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { advanceUnlock, LEVEL_CLEAR_XP, QUIZ_PASS_MARK } from "../_shared/levels.ts";

/**
 * Grade a level's quiz and, if they passed, open the next level and hand them
 * the thing they have to build.
 *
 * Passing the quiz is what unlocks the next level; finishing the proof task is
 * what earns the star. That split is deliberate. Requiring a verified proof to
 * move on would leave a student stuck behind a review queue with nothing to do,
 * and a path you can get stuck on is not a path. Requiring nothing but a quiz
 * would make this a course website. So: the quiz moves you, the proof marks you.
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

/** How long a student gets to finish a level's proof task. */
const PROOF_DUE_DAYS = 14;
const PROOF_TASK_XP = 40;

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

    const { level_id, answers } = await req.json();
    if (typeof level_id !== 'string' || !Array.isArray(answers)) {
      return json({ error: 'level_id and an answers array are required' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles')
      .select('id, total_xp')
      .eq('user_id', callerId)
      .maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    const { data: level } = await supabase
      .from('levels')
      .select('id, track_slug, level_number, sub_level, kind, skill, title')
      .eq('id', level_id)
      .maybeSingle();
    if (!level) return json({ error: 'That level does not exist' }, 404);
    if (level.kind !== 'checkpoint') {
      // Explanation steps have no quiz to grade — they're cleared via
      // level-open's advance_step instead.
      return json({ error: 'This step has no quiz. Read it and move to the next one.' }, 400);
    }

    const { data: content } = await supabase
      .from('level_content')
      .select('quiz, proof_title, proof_brief')
      .eq('level_id', level_id)
      .maybeSingle();
    if (!content) return json({ error: 'Open the level before answering it' }, 409);

    const { data: track } = await supabase
      .from('student_tracks')
      .select('unlocked_through')
      .eq('student_id', profile.id)
      .eq('track_slug', level.track_slug)
      .maybeSingle();

    const { data: progress } = await supabase
      .from('student_levels')
      .select('id, status, best_score, attempts, task_id')
      .eq('student_id', profile.id)
      .eq('level_id', level_id)
      .maybeSingle();

    const alreadyDone = ['placed', 'cleared', 'mastered'].includes(progress?.status ?? '');
    // Checked again here, not only in level-open: the browser is not the thing
    // that decides which levels a student may answer.
    if (!track || (level.level_number > track.unlocked_through && !alreadyDone)) {
      return json({ error: 'This level is still locked.', locked: true }, 403);
    }

    // ---- grade ------------------------------------------------------------
    const quiz = content.quiz as {
      id: string;
      prompt: string;
      options: string[];
      correct_index: number;
      explanation: string;
    }[];

    const selectedById = new Map<string, number>();
    for (const a of answers) {
      if (typeof a?.question_id === 'string' && Number.isInteger(a?.selected_index)) {
        selectedById.set(a.question_id, a.selected_index);
      }
    }

    // Grade only the questions this attempt actually served, not the whole
    // pool a topic's checkpoint stores — level-open hands out a random
    // QUIZ_LENGTH subset of up to QUIZ_POOL_SIZE questions per attempt, so
    // "everything in content.quiz" is the wrong denominator once pools are
    // bigger than what's shown. Ordered by the submitted answers, which is
    // the order the student was shown them in — not content.quiz's storage
    // order, which the shuffle at serve time no longer matches.
    const quizById = new Map(quiz.map((q) => [q.id, q]));
    const presented = [...selectedById.keys()]
      .map((id) => quizById.get(id))
      .filter((q): q is (typeof quiz)[number] => !!q);

    const results = presented.map((q) => {
      const selected = selectedById.has(q.id) ? selectedById.get(q.id)! : null;
      const correct = selected === q.correct_index;
      return {
        question_id: q.id,
        prompt: q.prompt,
        selected_index: selected,
        correct_index: q.correct_index,
        correct,
        // Released only now that the answers are in — this is the teaching bit,
        // and it is worth reading whether they got it right or wrong.
        explanation: q.explanation,
      };
    });

    const score = results.filter((r) => r.correct).length;
    const passed = score >= QUIZ_PASS_MARK;

    // ---- record -----------------------------------------------------------
    const attempts = (progress?.attempts ?? 0) + 1;
    const bestScore = Math.max(progress?.best_score ?? 0, score);
    // Status only ever moves up.
    //
    // Passing upgrades a 'placed' level to 'cleared', which is the honest answer
    // to "how do you actually know they know Git?" — placement assumed it from
    // their resume, and taking the quiz is how that assumption becomes a fact.
    // Failing never demotes: a student who revisits a skipped level and stumbles
    // should not be pushed backwards for having checked.
    const newStatus = progress?.status === 'mastered'
      ? 'mastered'
      : passed
        ? 'cleared'
        : progress?.status ?? 'opened';

    // Counted the first time a level is genuinely earned, including a placed
    // level they have now proved rather than merely been credited with.
    const firstClear = passed && !['cleared', 'mastered'].includes(progress?.status ?? '');

    const row = {
      student_id: profile.id,
      level_id,
      status: newStatus,
      best_score: bestScore,
      attempts,
      ...(firstClear ? { cleared_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await supabase
      .from('student_levels')
      .upsert(row, { onConflict: 'student_id,level_id' });
    if (saveError) {
      console.error('Could not save quiz result:', saveError.message);
      return json({ error: 'Could not save your answers' }, 500);
    }

    // ---- the proof task ---------------------------------------------------
    let taskId = progress?.task_id ?? null;
    if (passed && !taskId) {
      const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
          student_id: profile.id,
          title: `Level ${level.level_number}: ${content.proof_title}`,
          description: `${content.proof_brief}\n\nFrom the ${level.skill} level of your path.`,
          due_date: new Date(Date.now() + PROOF_DUE_DAYS * 86400_000).toISOString(),
          xp_reward: PROOF_TASK_XP,
          level_id,
          category: 'Learning Path',
          source: 'levels',
        })
        .select('id')
        .single();

      if (taskError) {
        // The level still counts as cleared. Losing the task is worth a log, not
        // a failed request that makes the student redo a quiz they just passed.
        console.error('Could not create the level proof task:', taskError.message);
      } else {
        taskId = task.id;
        await supabase.from('student_levels').update({ task_id: taskId }).eq('student_id', profile.id).eq('level_id', level_id);
      }
    }

    // ---- XP ---------------------------------------------------------------
    if (firstClear) {
      const { error: xpError } = await supabase.from('xp_logs').insert({
        student_id: profile.id,
        xp_points: LEVEL_CLEAR_XP,
        source: `Level cleared: ${level.skill}`,
      });
      if (xpError) console.error('XP log failed:', xpError.message);
      else {
        await supabase
          .from('student_profiles')
          .update({ total_xp: (profile.total_xp ?? 0) + LEVEL_CLEAR_XP })
          .eq('id', profile.id);
      }
    }

    const unlockedThrough = await advanceUnlock(supabase, profile.id, level.track_slug);

    // The checkpoint is always a topic's last row, so passing it always
    // finishes that topic — unlockedThrough has moved to whatever topic comes
    // next (or nothing, if this was the last one). Point at that topic's
    // first step, not simply the one after this row.
    const { data: nextLevel } = await supabase
      .from('levels')
      .select('level_number, sub_level, skill, title')
      .eq('track_slug', level.track_slug)
      .eq('level_number', unlockedThrough)
      .eq('sub_level', 1)
      .maybeSingle();

    return json({
      passed,
      score,
      out_of: presented.length,
      pass_mark: QUIZ_PASS_MARK,
      attempts,
      best_score: bestScore,
      status: newStatus,
      results,
      task_id: taskId,
      proof: passed ? { title: content.proof_title, brief: content.proof_brief } : null,
      xp_awarded: firstClear ? LEVEL_CLEAR_XP : 0,
      unlocked_through: unlockedThrough,
      next_level: passed ? nextLevel ?? null : null,
      track_complete: passed && !nextLevel,
    });
  } catch (error) {
    console.error('Error in level-quiz-submit:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
