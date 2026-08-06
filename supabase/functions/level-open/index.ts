import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import {
  advanceUnlock,
  ensureLevelContent,
  quizForStudent,
  type LevelRow,
} from "../_shared/levels.ts";

/**
 * Open one level: its explanation, its quiz, and the proof it asks for.
 *
 * Everything a student is allowed to see about a level comes from here, because
 * the alternative — letting the browser read level_content directly — would hand
 * over the answer key with it.
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

    const { track_slug, level_number } = await req.json();
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

    const { data: level } = await supabase
      .from('levels')
      .select('id, track_slug, level_number, skill, title')
      .eq('track_slug', track_slug)
      .eq('level_number', level_number)
      .maybeSingle();
    if (!level) return json({ error: 'That level does not exist' }, 404);

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

    const { data: progress } = await supabase
      .from('student_levels')
      .select('status, best_score, attempts, task_id')
      .eq('student_id', profile.id)
      .eq('level_id', level.id)
      .maybeSingle();

    // A level they have already finished stays readable — going back to reread
    // something you passed is not cheating.
    const alreadyDone = ['placed', 'cleared', 'mastered'].includes(progress?.status ?? '');
    if (level_number > track!.unlocked_through && !alreadyDone) {
      return json(
        {
          error: 'This level is still locked. Finish the one before it first.',
          locked: true,
          unlocked_through: track!.unlocked_through,
        },
        403,
      );
    }

    let content;
    try {
      content = await ensureLevelContent(supabase, level as LevelRow, {
        userId: callerId,
        studentId: profile.id,
      });
    } catch (err) {
      // Generation is the one part of this that depends on an outside service.
      // Say so plainly instead of showing an empty level: an empty level looks
      // like the student's fault, and a retry actually fixes this one.
      console.error('Level content generation failed:', err);
      return json(
        {
          error: 'This level is still being written. Give it a few seconds and try again.',
          content_unavailable: true,
        },
        503,
      );
    }

    // Mark it opened, but never downgrade a level they have already finished.
    if (!progress) {
      const { error: openError } = await supabase.from('student_levels').insert({
        student_id: profile.id,
        level_id: level.id,
        status: 'opened',
      });
      if (openError) console.error('Could not record level open:', openError.message);
    }

    // Placement may have ticked levels above this one; keep the wall honest.
    const unlockedThrough = await advanceUnlock(supabase, profile.id, track_slug);

    return json({
      level: {
        id: level.id,
        track_slug: level.track_slug,
        level_number: level.level_number,
        skill: level.skill,
        title: level.title,
      },
      explanation: content.explanation,
      quiz: quizForStudent(content.quiz),
      proof: { title: content.proof_title, brief: content.proof_brief },
      status: progress?.status ?? 'opened',
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
