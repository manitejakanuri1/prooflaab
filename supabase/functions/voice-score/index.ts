import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.3";
import { generateText } from "../_shared/llm.ts";

/**
 * Scores a 60-second spoken explanation.
 *
 * It grades HOW they explained, not whether the code was right — that is what
 * the rest of the verification engine is for. The signal we want is whether
 * this person actually did the work, and the tells for that are in the shape of
 * the speech rather than its correctness: hesitation in the right places,
 * decisions they changed their mind about, and their own vocabulary instead of
 * textbook phrasing.
 *
 * The transcript is captured in the browser while recording. This project has
 * no audio-capable model any more — that went with Gemini — so server-side
 * transcription would need a new provider and a new key. The audio itself is
 * kept as the evidence a human can always fall back on.
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
    const { data: claims, error: claimsError } =
      await authClient.auth.getClaims(authHeader.replace('Bearer ', ''));
    if (claimsError || !claims) return json({ error: 'Invalid token' }, 401);
    const callerId = claims.claims.sub;

    const { voice_id } = await req.json();
    if (!voice_id) return json({ error: 'voice_id is required' }, 400);

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: profile } = await supabase
      .from('student_profiles').select('id').eq('user_id', callerId).maybeSingle();
    if (!profile) return json({ error: 'Student profile not found' }, 404);

    const { data: rec } = await supabase
      .from('voice_explanations')
      .select('id, student_id, transcript, duration_seconds, word_count, task_id')
      .eq('id', voice_id)
      .maybeSingle();
    if (!rec) return json({ error: 'Recording not found' }, 404);
    if (rec.student_id !== profile.id) return json({ error: 'Forbidden' }, 403);

    if (!rec.transcript || (rec.word_count ?? 0) < 12) {
      await supabase.from('voice_explanations')
        .update({ status: 'failed', communication_notes: 'Too little speech to score.' })
        .eq('id', voice_id);
      return json({ success: false, reason: 'transcript too short' });
    }

    // What they were asked to explain, so the grader can tell whether the
    // answer is about this work or a general speech about anything.
    let taskTitle = 'their submitted work';
    if (rec.task_id) {
      const { data: task } = await supabase
        .from('tasks').select('title').eq('id', rec.task_id).maybeSingle();
      if (task?.title) taskTitle = task.title;
    }

    const prompt = `A student recorded a spoken explanation of their own work. You are judging HOW they explained it, not whether the code was correct.

What they were asked to explain: "${taskTitle}"
Length: ${rec.duration_seconds ?? '?'} seconds, ${rec.word_count} words.

Transcript (speech-to-text, so expect missing punctuation and the odd wrong word — do not penalise that):
"""
${rec.transcript}
"""

Score 0-100 on whether this sounds like someone who actually did the work.

Signs they did:
- Mentions something they tried first that did not work
- Names a decision they changed their mind about
- Ordinary spoken grammar, self-correction, their own vocabulary
- Specific details only the author would know
- Admits a part they are unsure about or did not finish

Signs they did not:
- Textbook phrasing that could describe any project
- Perfectly structured sentences with no self-correction
- Only general statements, no specifics from this work
- Confident about everything, uncertain about nothing

Be fair to nervous speakers: hesitation and rambling are NOT evidence of cheating. Fluency is not the thing being measured — ownership is.

Return ONLY JSON:
{"communication_score": <0-100>, "notes": "<two sentences, addressed to the student, plain English>"}`;

    let parsed: { communication_score?: number; notes?: string } = {};
    try {
      const { text } = await generateText(prompt, { temperature: 0.3, maxOutputTokens: 500 },
        { feature: 'voice-score' });
      const match = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : text);
    } catch (e) {
      console.error('voice-score: could not grade', e);
      await supabase.from('voice_explanations')
        .update({ status: 'failed', communication_notes: 'Scoring failed. A person can still listen to this.' })
        .eq('id', voice_id);
      return json({ error: 'Scoring failed' }, 502);
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.communication_score) || 0)));

    await supabase.from('voice_explanations').update({
      communication_score: score,
      communication_notes: parsed.notes ?? null,
      status: 'scored',
    }).eq('id', voice_id);

    // Speaking about your work is work. The streak counts the day either way.
    await supabase.rpc('touch_streak', { _student_id: profile.id });

    return json({ success: true, communication_score: score, notes: parsed.notes ?? null });
  } catch (error) {
    console.error('voice-score error:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
