import { generateText } from "./llm.ts";

/**
 * Grades one recording's transcript. Shared by voice-score (a student's own
 * request, or transcription-worker's server-side request) and
 * transcription-reap (recovery of a server transcript that was never scored),
 * so every path goes through the same migration-45 claim/complete/fail fence.
 *
 * `rec` must already be authorised by the caller - this function does not
 * decide who may score what, only how, and only once.
 *
 * Every write to the row happens under a scoring claim (lease) - including
 * the "too little speech" decision - so nothing here can change a recording
 * that is already scored, or one another caller is scoring right now.
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

export type ScoreOutcome =
  | 'scored'      // this call graded it and the result was saved
  | 'already'     // it already had a saved score; nothing was done
  | 'pending'     // another caller holds a live claim and no score is saved yet
  | 'too_short'   // too little speech; marked failed under this call's claim
  | 'failed'      // AI error or unusable AI answer; marked failed under this call's claim
  | 'lost_race'   // this call's claim went stale and a newer claim owns the result
  | 'not_found'   // the recording no longer exists
  | 'error';      // a database call failed; nothing is claimed to have happened

export type ScoreResult = { status: number; outcome: ScoreOutcome; body: Record<string, unknown> };

/** Minimum words before a transcript is worth grading (unchanged). */
export const MIN_WORDS = 12;
/** Same default TTL claim_voice_scoring uses (migration 45). */
export const SCORE_CLAIM_TTL_SECONDS = 120;

type Generate = (prompt: string, opts: { temperature: number; maxOutputTokens: number },
  track: { feature: string; studentId?: string | null }) => Promise<{ text: string }>;

const dbError = (step: string, voice_id: string, err: unknown): ScoreResult => {
  const message = (err as { message?: string })?.message ?? String(err);
  console.error(`VOICE-SCORE: ${step} failed for ${voice_id}: ${message}`);
  return { status: 503, outcome: 'error', body: { success: false, error: `database error during ${step}` } };
};

/**
 * Strict check of the AI's answer. Only a real number from 0 to 100 counts
 * (a numeric string like "72" is accepted, since that is still a number the
 * model meant). Missing, empty, non-numeric, NaN, Infinity or out-of-range is
 * NOT turned into 0 - it is reported as unusable so the failure path runs.
 */
export function parseAiScore(text: string): { score: number; notes: string | null } | null {
  let parsed: unknown;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = (parsed as Record<string, unknown>).communication_score;
  let n: number;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw.trim());
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  const notes = (parsed as Record<string, unknown>).notes;
  return { score: Math.round(n), notes: typeof notes === 'string' ? notes : null };
}

export async function scoreRecording(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  rec: VoiceRec,
  generate: Generate = generateText,
): Promise<ScoreResult> {
  const voice_id = rec.id;

  // Step 6F/6G: an atomic claim, not a read-then-write - two concurrent
  // calls for the same recording (two tabs, a retry racing a reopen, or the
  // worker racing transcription-reap) can never both pass this. It refuses
  // a scored row, and a row whose current claim is still live.
  //
  // The lease token it returns is what every write below is fenced on, so a
  // claim that has since gone stale - a slow DeepSeek call outliving its own
  // TTL - can never overwrite what a NEWER claim already saved (migration 45).
  const { data: claimRows, error: claimError } =
    await supabase.rpc('claim_voice_scoring', { _id: voice_id });
  if (claimError) return dbError('claim', voice_id, claimError);
  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
    { claimed?: boolean; lease_token?: string } | undefined;

  if (!claim?.claimed) {
    // Not claimed: it is scored already, someone else holds a live claim, or
    // the row is gone. Re-read to tell which - never guess.
    const { data: current, error: readError } = await supabase
      .from('voice_explanations')
      .select('status, communication_score, communication_notes')
      .eq('id', voice_id).maybeSingle();
    if (readError) return dbError('read after unclaimed', voice_id, readError);
    if (!current) return { status: 404, outcome: 'not_found', body: { success: false, error: 'Recording not found' } };
    if (current.status === 'scored') {
      console.log(`VOICE-SCORE: already scored ${voice_id}`);
      return {
        status: 200, outcome: 'already',
        body: { success: true, communication_score: current.communication_score, notes: current.communication_notes },
      };
    }
    console.log(`VOICE-SCORE: pending ${voice_id} - another claim is scoring it`);
    return {
      status: 202, outcome: 'pending',
      body: { success: false, pending: true, communication_score: null, notes: null },
    };
  }
  const leaseToken = claim.lease_token;
  console.log(`VOICE-SCORE: claimed ${voice_id}`);

  // Releases this call's claim as a failure. Fenced on this lease, so it
  // cannot touch a row a newer claim took over (and, from migration 45 as
  // applied by Step 6DD, never a scored row).
  const failUnderClaim = async (notes: string, outcome: ScoreOutcome, status: number, body: Record<string, unknown>) => {
    const { data: released, error: failError } = await supabase.rpc('fail_voice_scoring', {
      _id: voice_id, _lease_token: leaseToken, _notes: notes,
    });
    if (failError) return dbError('fail', voice_id, failError);
    if (!released) {
      console.log(`VOICE-SCORE: lost race ${voice_id} - claim went stale before recording the failure`);
      return { status: 200, outcome: 'lost_race' as ScoreOutcome, body: { success: false, lost_race: true } };
    }
    return { status, outcome, body };
  };

  // Too little speech: decided only now, under this claim, so it can never
  // mark an already-scored recording failed or overwrite another claim's work.
  if (!rec.transcript || (rec.word_count ?? 0) < MIN_WORDS) {
    console.log(`VOICE-SCORE: too short ${voice_id}`);
    return await failUnderClaim('Too little speech to score.', 'too_short', 200,
      { success: false, reason: 'transcript too short' });
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

  let graded: { score: number; notes: string | null } | null;
  try {
    const { text } = await generate(prompt, { temperature: 0.3, maxOutputTokens: 500 },
      { feature: 'voice-score', studentId: rec.student_id });
    graded = parseAiScore(text);
    if (!graded) console.error(`VOICE-SCORE: unusable AI answer for ${voice_id}: ${String(text).slice(0, 200)}`);
  } catch (e) {
    console.error(`VOICE-SCORE: AI call failed for ${voice_id}`, e);
    graded = null;
  }
  if (!graded) {
    return await failUnderClaim('Scoring failed. A person can still listen to this.', 'failed', 502,
      { success: false, error: 'Scoring failed' });
  }

  const { data: committed, error: completeError } = await supabase.rpc('complete_voice_scoring', {
    _id: voice_id, _lease_token: leaseToken, _score: graded.score, _notes: graded.notes,
  });
  if (completeError) return dbError('complete', voice_id, completeError);
  if (!committed) {
    // This claim went stale before the write and a newer claim took over;
    // the newer claim owns the result. Report what is actually saved now.
    console.log(`VOICE-SCORE: lost race ${voice_id} - a newer claim owns the result`);
    const { data: current, error: readError } = await supabase
      .from('voice_explanations').select('status, communication_score, communication_notes')
      .eq('id', voice_id).maybeSingle();
    if (readError) return dbError('read after lost race', voice_id, readError);
    return {
      status: 200, outcome: 'lost_race',
      body: {
        success: current?.status === 'scored', lost_race: true,
        communication_score: current?.communication_score ?? null, notes: current?.communication_notes ?? null,
      },
    };
  }
  console.log(`VOICE-SCORE: scored ${voice_id} = ${graded.score}`);

  // Speaking about your work is work. The streak counts the day either way.
  await supabase.rpc('touch_streak', { _student_id: rec.student_id });

  return { status: 200, outcome: 'scored', body: { success: true, communication_score: graded.score, notes: graded.notes } };
}
