import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";

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
      .select('id, student_id, transcript, duration_seconds, word_count, task_id, communication_score, communication_notes')
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

    // Step 6F/6G: an atomic claim, not a read-then-write - two concurrent
    // calls for the same recording (two tabs, or a retry racing a reopen)
    // can never both pass this. The loser skips DeepSeek entirely and hands
    // back whatever score already exists rather than grading twice.
    //
    // The claim itself is not enough on its own: a lease token (minted
    // fresh by every successful claim) is what actually prevents a claim
    // that has since gone stale - a slow DeepSeek call outliving its own
    // TTL - from overwriting a result a NEWER claim already saved. Every
    // write below is fenced on this exact token, not just "is there a
    // score now" (migration 45).
    const { data: claimRows } = await supabase.rpc('claim_voice_scoring', { _id: voice_id });
    const claim = claimRows?.[0] as { claimed?: boolean; lease_token?: string } | undefined;
    if (!claim?.claimed) {
      // Either already scored, or another live claim currently holds this
      // recording - re-read rather than trust rec's now-possibly-stale
      // values, since a concurrent winner may have just finished.
      const { data: current } = await supabase
        .from('voice_explanations').select('communication_score, communication_notes')
        .eq('id', voice_id).maybeSingle();
      return json({
        success: true,
        communication_score: current?.communication_score ?? rec.communication_score,
        notes: current?.communication_notes ?? rec.communication_notes,
      });
    }
    const leaseToken = claim.lease_token;

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
      // fail_voice_scoring only releases THIS lease - if this claim has
      // already gone stale and a newer one has since taken over, this
      // correctly does nothing rather than clearing the newer claim's lock
      // out from under it.
      await supabase.rpc('fail_voice_scoring', {
        _id: voice_id, _lease_token: leaseToken, _notes: 'Scoring failed. A person can still listen to this.',
      });
      return json({ error: 'Scoring failed' }, 502);
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.communication_score) || 0)));

    const { data: committed } = await supabase.rpc('complete_voice_scoring', {
      _id: voice_id, _lease_token: leaseToken, _score: score, _notes: parsed.notes ?? null,
    });
    if (!committed) {
      // This claim went stale before the write - a newer claim already
      // holds (or has already saved) this recording's result. Report
      // whatever is actually in the database now, never this now-discarded
      // grading, so the caller never sees a result that lost the race.
      const { data: current } = await supabase
        .from('voice_explanations').select('communication_score, communication_notes')
        .eq('id', voice_id).maybeSingle();
      return json({ success: true, communication_score: current?.communication_score ?? null, notes: current?.communication_notes ?? null });
    }

    // Speaking about your work is work. The streak counts the day either way.
    await supabase.rpc('touch_streak', { _student_id: profile.id });

    return json({ success: true, communication_score: score, notes: parsed.notes ?? null });
  } catch (error) {
    console.error('voice-score error:', error);
    return json({ error: (error as Error).message || 'Internal server error' }, 500);
  }
});
