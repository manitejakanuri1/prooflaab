/**
 * The skill-level path: placement, unlocking, and level content.
 *
 * The generated roadmap answers "what did I just get wrong". This answers the
 * question that was missing: "where am I on the path, and what is next". The
 * order lives in the `levels` table; everything here is the rules that run over
 * it.
 */

import { generateText } from './llm.ts';

/** Out of three. Two right means they understood it; three means no room to slip. */
export const QUIZ_PASS_MARK = 2;
export const QUIZ_LENGTH = 3;

/** XP for clearing a level's quiz. The proof task carries its own, larger reward. */
export const LEVEL_CLEAR_XP = 15;

export interface LevelRow {
  id: string;
  track_slug: string;
  level_number: number;
  skill: string;
  title: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export interface LevelContentRow {
  level_id: string;
  explanation: string;
  quiz: QuizQuestion[];
  proof_title: string;
  proof_brief: string;
}

/** Same normalisation as skill-map, so "Node.js" and "nodejs" are one skill. */
export const normSkill = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '');

/** Statuses that mean "this level no longer stands between you and the next one". */
const DONE_STATUSES = new Set(['placed', 'cleared', 'mastered']);

/**
 * Recompute how far a student may go on a track.
 *
 * Unlocking stays contiguous on purpose: the first level they have not finished
 * is the wall. A student who already knows level 7 still sees it ticked on the
 * map, but the wall is wherever the first real gap is — that is the whole point
 * of an ordered path, and letting them jump the gap would turn it back into the
 * unordered list this replaced.
 */
export async function advanceUnlock(
  supabase: any,
  studentId: string,
  trackSlug: string,
): Promise<number> {
  const { data: levels } = await supabase
    .from('levels')
    .select('id, level_number')
    .eq('track_slug', trackSlug)
    .order('level_number', { ascending: true });

  const { data: progress } = await supabase
    .from('student_levels')
    .select('level_id, status')
    .eq('student_id', studentId);

  const statusById = new Map<string, string>(
    (progress ?? []).map((p: any) => [p.level_id, p.status]),
  );

  let unlockedThrough = 1;
  for (const level of levels ?? []) {
    if (DONE_STATUSES.has(statusById.get(level.id) ?? '')) {
      // Finished, so the wall moves past it. +1 rather than +0 so a fully
      // finished track unlocks one past the end and the map can say "done"
      // instead of pointing at the last level forever.
      unlockedThrough = level.level_number + 1;
    } else {
      unlockedThrough = level.level_number;
      break;
    }
  }

  await supabase
    .from('student_tracks')
    .update({ unlocked_through: unlockedThrough, updated_at: new Date().toISOString() })
    .eq('student_id', studentId)
    .eq('track_slug', trackSlug);

  return unlockedThrough;
}

/** The parts of a parsed resume that can justify crediting a skill. */
export interface ResumeEvidenceSource {
  skills?: string[];
  projects?: { name?: string; description?: string; tech_stack?: string[] }[];
  certifications?: string[];
}

/**
 * Say, in one sentence, what in their resume made us tick this level off.
 *
 * Deliberately a lookup and not a model call. It runs for every matched skill of
 * every placed student, it has an exactly correct answer sitting in the resume
 * already, and paying a model to restate a string it was handed is the clearest
 * possible waste of tokens.
 */
export function evidenceForSkill(
  skill: string,
  source: ResumeEvidenceSource,
): string | null {
  const target = normSkill(skill);
  const parts: string[] = [];

  const listed = (source.skills ?? []).find((s) => normSkill(s) === target);
  if (listed) parts.push(`listed in your skills as "${listed}"`);

  const project = (source.projects ?? []).find((p) =>
    [...(p.tech_stack ?? []), p.name ?? '', p.description ?? ''].some((field) =>
      normSkill(String(field)).includes(target),
    ),
  );
  if (project?.name) parts.push(`used in your project "${project.name}"`);

  const cert = (source.certifications ?? []).find((c) => normSkill(c).includes(target));
  if (cert) parts.push(`covered by your "${cert}" certificate`);

  if (parts.length === 0) return null;
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
}

export interface PlacementResult {
  track_slug: string;
  track_name: string;
  total_levels: number;
  placed_at_level: number;
  unlocked_through: number;
  skipped: number;
}

/**
 * Put a student on the map.
 *
 * Every level whose skill they have already proved is marked `placed` — a tick
 * on the map rather than a lesson they have to sit through again. This is the
 * difference between "here are 4 things you got wrong" and "you're at level 7
 * of 16": the same test result, but it now says where they are instead of only
 * what they missed.
 *
 * Safe to call more than once. Existing progress is never overwritten, so a
 * retest cannot take away a level someone has already cleared.
 */
export async function placeStudent(
  supabase: any,
  studentId: string,
  opts: {
    interests?: string[];
    skills?: string[];
    trackSlugs?: string[];
    /** Used only to explain each tick back to the student. */
    resume?: ResumeEvidenceSource;
  },
): Promise<PlacementResult[]> {
  const skills = (opts.skills ?? []).filter(Boolean);
  const have = new Set(skills.map(normSkill));

  // Which tracks: an explicit choice wins, otherwise whatever their interests
  // map onto. An interest with no track (a free-text answer) is simply skipped.
  let trackSlugs = opts.trackSlugs ?? [];
  if (trackSlugs.length === 0 && (opts.interests ?? []).length > 0) {
    const { data: tracks } = await supabase
      .from('level_tracks')
      .select('slug, interest')
      .in('interest', opts.interests as string[]);
    trackSlugs = (tracks ?? []).map((t: any) => t.slug);
  }
  if (trackSlugs.length === 0) return [];

  const { data: trackRows } = await supabase
    .from('level_tracks')
    .select('slug, name')
    .in('slug', trackSlugs);
  const nameBySlug = new Map<string, string>((trackRows ?? []).map((t: any) => [t.slug, t.name]));

  // Whichever track they were put on first stays the one the map opens to.
  // Without this, adding a second track later also claimed "primary" and the map
  // opened on whichever row the database happened to return first.
  const { data: primaryRows } = await supabase
    .from('student_tracks')
    .select('track_slug')
    .eq('student_id', studentId)
    .eq('is_primary', true);
  const existingPrimary: string | null = primaryRows?.[0]?.track_slug ?? null;

  const results: PlacementResult[] = [];

  for (const [index, slug] of trackSlugs.entries()) {
    if (!nameBySlug.has(slug)) continue;

    const { data: levels } = await supabase
      .from('levels')
      .select('id, level_number, skill')
      .eq('track_slug', slug)
      .order('level_number', { ascending: true });
    if (!levels || levels.length === 0) continue;

    const { data: existingRows } = await supabase
      .from('student_levels')
      .select('level_id, status')
      .eq('student_id', studentId)
      .in('level_id', levels.map((l: any) => l.id));
    const existing = new Map<string, string>(
      (existingRows ?? []).map((r: any) => [r.level_id, r.status]),
    );

    const toInsert = levels
      .filter((l: any) => have.has(normSkill(l.skill)) && !existing.has(l.id))
      .map((l: any) => ({
        student_id: studentId,
        level_id: l.id,
        status: 'placed',
        // No quiz was taken for these, so no score is claimed.
        best_score: 0,
        // What in the resume earned the tick, so the student can check our
        // working rather than being told "you know this" and having to take it
        // on faith. Falls back to the skill list they gave us if there is no
        // parsed resume behind it.
        evidence:
          evidenceForSkill(l.skill, opts.resume ?? { skills }) ??
          `You told us you know ${l.skill}.`,
      }));

    if (toInsert.length > 0) {
      const { error } = await supabase.from('student_levels').insert(toInsert);
      if (error) console.error(`Placement insert failed for ${slug}:`, error.message);
    }

    // First level they have not finished — where the map should point them.
    const finished = new Set<string>([
      ...toInsert.map((r: any) => r.level_id),
      ...[...existing.entries()].filter(([, s]) => DONE_STATUSES.has(s)).map(([id]) => id),
    ]);
    let placedAt = levels.length + 1;
    for (const level of levels) {
      if (!finished.has(level.id)) {
        placedAt = level.level_number;
        break;
      }
    }

    // upsert, not insert: placement runs again after every retest.
    const { error: trackError } = await supabase
      .from('student_tracks')
      .upsert(
        {
          student_id: studentId,
          track_slug: slug,
          placed_at_level: placedAt,
          unlocked_through: placedAt,
          is_primary: existingPrimary ? existingPrimary === slug : index === 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'student_id,track_slug', ignoreDuplicates: false },
      );
    if (trackError) console.error(`Track upsert failed for ${slug}:`, trackError.message);

    const unlockedThrough = await advanceUnlock(supabase, studentId, slug);

    results.push({
      track_slug: slug,
      track_name: nameBySlug.get(slug)!,
      total_levels: levels.length,
      placed_at_level: placedAt,
      unlocked_through: unlockedThrough,
      skipped: finished.size,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Level content
// ---------------------------------------------------------------------------

function buildContentPrompt(
  level: LevelRow,
  trackName: string,
  role: string,
  totalLevels: number,
  before: string[],
  after: string[],
): string {
  // Kept deliberately tight. Every word here is paid for on all 137 levels, and
  // the long version of this prompt was mostly restating the same rule three
  // ways — which cost tokens without improving a single generated level.
  return `Write ONE level of a game-style learning path for a student becoming a ${role}.

Path "${trackName}", level ${level.level_number}/${totalLevels}. Teaches: ${level.skill}. Called: "${level.title}".
Just covered: ${before.length ? before.join(', ') : 'nothing, this is level 1'}. Coming next: ${after.length ? after.join(', ') : 'nothing, this is the last'}.

Return JSON: {"explanation":"...","quiz":[{"prompt":"...","options":["a","b","c","d"],"correct_index":0,"explanation":"..."},{...},{...}],"proof_title":"...","proof_brief":"..."}

explanation — 130-180 words, a message from a funny senior who has the job, not a lecture. In order: one joke or everyday analogy that makes it click; what ${level.skill} actually is in plain words; the one thing beginners get wrong; one line on why a ${role} can't skip it. Plain sentences, blank lines between them. No headings, bullets, markdown, code blocks or emoji. Funny and warm, never patronising, never "Hey champ!".

quiz — exactly 3 questions on ${level.skill}, answerable by someone who understood the explanation. Test the idea, not trivia or memorised syntax. At least one realistic "what happens if" or "why did this break". Exactly 4 options, one correct, wrong ones genuinely tempting. Vary which index is correct. Each explanation is one short sentence in the same voice.

proof — a real thing finishable in 30-90 minutes that ends in an artefact (repo, link, screenshot, recording). proof_brief is 2-3 sentences: what to build and what counts as done. Specific and checkable.

Return ONLY the JSON.`;
}

function validQuiz(quiz: unknown): quiz is Omit<QuizQuestion, 'id'>[] {
  return (
    Array.isArray(quiz) &&
    quiz.length === QUIZ_LENGTH &&
    quiz.every(
      (q: any) =>
        typeof q?.prompt === 'string' &&
        q.prompt.trim().length > 0 &&
        Array.isArray(q?.options) &&
        q.options.length === 4 &&
        q.options.every((o: any) => typeof o === 'string' && o.trim().length > 0) &&
        Number.isInteger(q?.correct_index) &&
        q.correct_index >= 0 &&
        q.correct_index < 4 &&
        typeof q?.explanation === 'string',
    )
  );
}

/**
 * Fetch this level's content, generating it once if it does not exist yet.
 *
 * Cached in the table rather than regenerated per student so every student sees
 * the same level — a level that says something different each time it is opened
 * is not a level — and so the model is paid for once per level instead of once
 * per student per open.
 */
export async function ensureLevelContent(
  supabase: any,
  level: LevelRow,
  ctx: { userId?: string | null; studentId?: string | null; skipRateLimit?: boolean },
): Promise<LevelContentRow> {
  const { data: cached } = await supabase
    .from('level_content')
    .select('level_id, explanation, quiz, proof_title, proof_brief')
    .eq('level_id', level.id)
    .maybeSingle();
  if (cached) return cached as LevelContentRow;

  const { data: track } = await supabase
    .from('level_tracks')
    .select('name, role')
    .eq('slug', level.track_slug)
    .maybeSingle();

  const { data: siblings } = await supabase
    .from('levels')
    .select('level_number, skill')
    .eq('track_slug', level.track_slug)
    .order('level_number', { ascending: true });

  const all = (siblings ?? []) as { level_number: number; skill: string }[];
  // Only the immediate neighbours. The model needs to know what it can assume
  // and what not to steal from the next level — the full history of fifteen
  // earlier skills told it nothing extra and grew the prompt with every level.
  const before = all
    .filter((l) => l.level_number < level.level_number)
    .slice(-3)
    .map((l) => l.skill);
  const after = all.filter((l) => l.level_number > level.level_number).slice(0, 3).map((l) => l.skill);

  const prompt = buildContentPrompt(
    level,
    track?.name ?? level.track_slug,
    track?.role ?? 'developer',
    all.length,
    before,
    after,
  );

  const result = await generateText(
    prompt,
    // skipRateLimit is for the warm-up job only: writing 36 levels in one run is
    // legitimate batch work, and counting it against a student-sized hourly cap
    // would stop the job halfway and leave half the tracks cold.
    // 1200, not 2000: measured completions land around 680 tokens, so this is
    // still ample headroom while capping what a rambling response can cost.
    { temperature: 0.8, maxOutputTokens: 1200, skipRateLimit: ctx.skipRateLimit },
    { feature: 'level-content', userId: ctx.userId ?? null, studentId: ctx.studentId ?? null },
  );

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Level content came back in a shape we could not read');
  const parsed = JSON.parse(jsonMatch[0]);

  if (
    typeof parsed?.explanation !== 'string' ||
    parsed.explanation.trim().length < 80 ||
    !validQuiz(parsed?.quiz) ||
    typeof parsed?.proof_title !== 'string' ||
    typeof parsed?.proof_brief !== 'string'
  ) {
    // Thrown rather than patched up: a half-written level with two questions or
    // a missing answer key would silently mis-grade every student who took it.
    throw new Error('Level content failed validation');
  }

  const quiz: QuizQuestion[] = parsed.quiz.map((q: any, i: number) => ({
    id: `${level.id}-q${i + 1}`,
    prompt: q.prompt.trim(),
    options: q.options.map((o: string) => o.trim()),
    correct_index: q.correct_index,
    explanation: (q.explanation ?? '').trim(),
  }));

  const row: LevelContentRow = {
    level_id: level.id,
    explanation: parsed.explanation.trim(),
    quiz,
    proof_title: parsed.proof_title.trim(),
    proof_brief: parsed.proof_brief.trim(),
  };

  // Ignore a duplicate: two students opening a brand-new level at the same
  // moment both generate it, and whichever lands first is as good as the other.
  const { error } = await supabase.from('level_content').upsert(row, { onConflict: 'level_id' });
  if (error) console.error('Caching level content failed:', error.message);

  return row;
}

/**
 * The quiz as the browser is allowed to see it.
 *
 * correct_index and the per-question explanation stay on the server until the
 * answers are in. Sending the whole question object is how the earlier
 * assessment leaked its own answer key to anyone who opened the network tab.
 */
export function quizForStudent(quiz: QuizQuestion[]) {
  return quiz.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options }));
}
