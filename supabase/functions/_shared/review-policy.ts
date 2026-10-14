/**
 * When does a written answer need a person? (S31, migration 104.)
 *
 * The AI grader decides normal cases. A human sees an answer only for a serious, unresolved
 * evidence-integrity signal: a near-verbatim copy of another student's earlier answer to the
 * SAME question, long enough to be meaningful, that is not just both students restating the
 * prompt or the reference answer. Similar correct answers and shared terminology are normal.
 *
 * Grader disagreement is a grading problem, not an integrity problem: it is settled by one
 * bounded extra AI opinion (the median of three), never by a human.
 */

/** Trigram similarity at or above this between two answers to the same question = a copy candidate. */
export const COPY_SIMILARITY = 0.92;
/** Shorter answers are too generic to call copied. */
export const COPY_MIN_WORDS = 40;
/** An answer this contained in the prompt + reference answer is restating them, not copying a peer. */
export const PROMPT_OVERLAP_MAX = 0.6;
/** Hard cap on AI grading calls for one submission (first opinion, second when borderline, third to settle). */
export const MAX_GRADER_CALLS = 3;

export interface SimilarityResult {
  /** Highest trigram similarity to another student's passed/pending answer to the same question (0..1). */
  score?: number | null;
  /** How much of this answer is contained in the prompt + reference answer (pg_trgm word_similarity, 0..1). */
  prompt_overlap?: number | null;
  /** Word count of this answer. */
  answer_words?: number | null;
}

/** True only for a serious copy signal (see the module comment). Missing data is never an accusation. */
export function seriousCopy(r: SimilarityResult | null | undefined): boolean {
  if (!r) return false;
  const score = Number(r.score ?? 0), overlap = Number(r.prompt_overlap ?? 1), words = Number(r.answer_words ?? 0);
  if (!Number.isFinite(score) || !Number.isFinite(overlap) || !Number.isFinite(words)) return false;
  return score >= COPY_SIMILARITY && words >= COPY_MIN_WORDS && overlap < PROMPT_OVERLAP_MAX;
}

/** The two graders disagree enough that a third opinion is worth its cost. */
export function needsThirdOpinion(totalA: number, totalB: number, disagreement: number): boolean {
  return Math.abs(totalA - totalB) > disagreement;
}

/**
 * Index of the grade that decides: one grade -> it; two -> the lower (an optimistic single grader
 * should not decide a pass); three -> the median. Returns the index into `totals`.
 */
export function decidingGrade(totals: number[]): number {
  if (totals.length === 0) throw new Error("no grades");
  if (totals.length > MAX_GRADER_CALLS) throw new Error("more grades than the cap");
  if (totals.length === 1) return 0;
  if (totals.length === 2) return totals[0] <= totals[1] ? 0 : 1;
  const order = totals.map((t, i) => [t, i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return order[1][1];
}
