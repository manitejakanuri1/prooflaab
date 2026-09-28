import { generateText } from "./llm.ts";

/**
 * Grades one recording's transcript. Shared by voice-score (a student's own
 * request, or transcription-worker's server-side request) and
 * transcription-reap (recovery of a server transcript that was never scored),
 * so every path goes through the same migration-45 claim/complete/fail fence.
 *
 * `rec` must already be authorised by the caller - this function does not
 * decide who may score what, only how, and only once.
 */
export const VOICE_SCORE_COLUMNS =
  'id, student_id, transcript, duration_seconds, word_count, task_id, communication_score, communication_notes, transcript_source, transcription_status, status';

export interface VoiceRec {
  id: string;
  student_id: string;
  transcript: string | null;
  duration_seconds: number | null;
  word_count: number | null;
  task_id: string | null;
  communication_score: number | null;
  communication_notes: string | null;
}

export type ScoreOutcome = 'scored' | 'already' | 'too_short' | 'failed' | 'lost_race';

export async function scoreRecording(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rec: VoiceRec,
): Promise<{ status: number; outcome: ScoreOutcome; body: Record<string, unknown> }> {
  const voice_id = rec.id;

  if (!rec.transcript || (rec.word_count ?? 0) < 12) {
    await supabase.from('voice_explanations')
      .update({ status: 'failed', communication_notes: 'Too little speech to score.' })
      .eq('id', voice_id);
    return { status: 200, outcome: 'too_short', body: { success: false, reason: 'transcript too short' } };
  }

  // Step 6F/6G: an atomic claim, not a read-then-write - two concurrent
  // calls for the same recording (two tabs, a retry racing a reopen, or the
  // worker racing transcription-reap) can never both pass this. The loser
  // skips DeepSeek entirely and hands back whatever score already exists
  // rather than grading twice.
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
    console.log(`VOICE-SCORE: not claimed ${voice_id} - already scored or another claim holds it`);
    const { data: current } = await supabase
      .from('voice_explanations').select('communication_score, communication_notes')
      .eq('id', voice_id).maybeSingle();
    return {
      status: 200, outcome: 'already',
      body: {
        success: true,
        communication_score: current?.communication_score ?? rec.communication_score,
        notes: current?.communication_notes ?? rec.communication_notes,
      },
    };
  }
  const leaseToken = claim.lease_token;
  console.log(`VOICE-SCORE: claimed ${voice_id}`);

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
      { feature: 'voice-score', studentId: rec.student_id });
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
    return { status: 502, outcome: 'failed', body: { error: 'Scoring failed' } };
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
    console.log(`VOICE-SCORE: lost race ${voice_id} - a newer claim owns the result`);
    const { data: current } = await supabase
      .from('voice_explanations').select('communication_score, communication_notes')
      .eq('id', voice_id).maybeSingle();
    return {
      status: 200, outcome: 'lost_race',
      body: { success: true, communication_score: current?.communication_score ?? null, notes: current?.communication_notes ?? null },
    };
  }
  console.log(`VOICE-SCORE: scored ${voice_id} = ${score}`);

  // Speaking about your work is work. The streak counts the day either way.
  await supabase.rpc('touch_streak', { _student_id: rec.student_id });

  return { status: 200, outcome: 'scored', body: { success: true, communication_score: score, notes: parsed.notes ?? null } };
}
