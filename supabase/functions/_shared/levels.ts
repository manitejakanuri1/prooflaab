/**
 * The skill-level path: placement, unlocking, and level content.
 *
 * The generated roadmap answers "what did I just get wrong". This answers the
 * question that was missing: "where am I on the path, and what is next". The
 * order lives in the `levels` table; everything here is the rules that run over
 * it.
 */

import { generateText } from './llm.ts';

/** Out of five, for the one checkpoint quiz at the end of a topic. */
export const QUIZ_PASS_MARK = 3;
export const QUIZ_LENGTH = 5;

/** A topic's explanation steps, not counting its checkpoint. */
export const MIN_TOPIC_STEPS = 3;
export const MAX_TOPIC_STEPS = 8;

/** XP for clearing a topic's checkpoint quiz. The proof task carries its own, larger reward. */
export const LEVEL_CLEAR_XP = 15;

export interface LevelRow {
  id: string;
  track_slug: string;
  level_number: number;
  sub_level: number;
  kind: 'explanation' | 'checkpoint';
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

/** A live embedded code editor (StackBlitz) shown beside an explanation step. */
export interface SandboxSpec {
  template: 'html' | 'javascript';
  files: Record<string, string>;
}

export interface LevelContentRow {
  level_id: string;
  explanation: string;
  quiz: QuizQuestion[];
  proof_title: string | null;
  proof_brief: string | null;
  sandbox: SandboxSpec | null;
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
  // A topic is now possibly several rows (one per sub_level) sharing one
  // level_number. Ordering by sub_level too keeps every row of a topic
  // contiguous, which is what lets the loop below work unmodified: it only
  // moves unlockedThrough past a level_number once every row sharing it is
  // done, because a not-done row anywhere in the group breaks before that
  // level_number's rows are behind it.
  const { data: levels } = await supabase
    .from('levels')
    .select('id, level_number')
    .eq('track_slug', trackSlug)
    .order('level_number', { ascending: true })
    .order('sub_level', { ascending: true });

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
      .order('level_number', { ascending: true })
      .order('sub_level', { ascending: true });
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

const SANDBOX_TEMPLATES = new Set(['html', 'javascript']);

function buildTopicPrompt(
  topic: LevelRow,
  trackName: string,
  role: string,
  totalTopics: number,
  before: string[],
  after: string[],
): string {
  // One call writes the whole topic — every sub-step plus the checkpoint —
  // rather than one call per step. Same total depth, same one-time-per-topic
  // cost as before, just organised as several small steps instead of one blob.
  return `Write ONE topic of a game-style learning path for a student becoming a ${role}, broken into small sequential steps — like a good tutorial site breaks "HTML" into Introduction, Basics, Elements, Attributes... in order, each step small and building on the last.

Path "${trackName}", topic ${topic.level_number}/${totalTopics}. Teaches: ${topic.skill}. Called: "${topic.title}".
Just covered: ${before.length ? before.join(', ') : 'nothing, this is the first topic'}. Coming next: ${after.length ? after.join(', ') : 'nothing, this is the last'}.

Return JSON:
{"steps":[{"title":"...","explanation":"...","needs_sandbox":false,"sandbox_template":null,"sandbox_files":null},...],"quiz":[{"prompt":"...","options":["a","b","c","d"],"correct_index":0,"explanation":"..."},...],"proof_title":"...","proof_brief":"..."}

steps — between ${MIN_TOPIC_STEPS} and ${MAX_TOPIC_STEPS} of them, however many the topic actually needs (a small topic gets fewer, a broad one gets more — you decide). Each step:
- title: short, specific (e.g. "Reading a Stack Trace", not "Debugging Part 1").
- explanation: 80-120 words, a message from a funny senior who has the job, not a lecture. Plain sentences, blank lines between them, one idea per step — don't try to cover the whole topic in step 1. No headings, bullets, markdown, code blocks or emoji. Funny and warm, never patronising, never "Hey champ!".
- needs_sandbox: true ONLY if this step teaches something runnable as plain HTML/CSS/JS in a browser (a web page, DOM manipulation, a JS snippet). False for anything else — conceptual topics (networking, soft skills, architecture), and any language that isn't HTML/CSS/JS (Python, SQL, shell commands etc. have no sandbox here, "what is X").
- sandbox_template: "html" for a page/markup/CSS step, "javascript" for a JS-logic step, when needs_sandbox is true, else null.
- sandbox_files: when needs_sandbox is true, an object of {filename: starter code} — a minimal, runnable starting point illustrating THIS step, not a finished solution (e.g. {"index.html": "<!doctype html>..."}). Else null.

quiz — exactly ${QUIZ_LENGTH} questions covering the WHOLE topic (draw from across the steps, not just the last one), answerable by someone who went through all the steps. Test understanding, not trivia. At least one realistic "what happens if" or "why did this break". Exactly 4 options, one correct, wrong ones genuinely tempting. Vary which index is correct. Each explanation is one short sentence in the same voice.

proof — a real thing finishable in 30-90 minutes that ends in an artefact (repo, link, screenshot, recording), and that needs what MULTIPLE steps taught, not just one. proof_brief is 2-3 sentences: what to build and what counts as done. Specific and checkable.

Return ONLY the JSON.`;
}

function validSandbox(s: any): s is SandboxSpec {
  return (
    s &&
    typeof s === 'object' &&
    SANDBOX_TEMPLATES.has(s.template) &&
    s.files &&
    typeof s.files === 'object' &&
    Object.keys(s.files).length > 0 &&
    Object.values(s.files).every((v) => typeof v === 'string')
  );
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

interface ParsedStep {
  title: string;
  explanation: string;
  sandbox: SandboxSpec | null;
}

function validSteps(steps: unknown): steps is ParsedStep[] {
  return (
    Array.isArray(steps) &&
    steps.length >= MIN_TOPIC_STEPS &&
    steps.length <= MAX_TOPIC_STEPS &&
    steps.every(
      (s: any) =>
        typeof s?.title === 'string' &&
        s.title.trim().length > 0 &&
        typeof s?.explanation === 'string' &&
        s.explanation.trim().length > 40,
    )
  );
}

/**
 * Make sure a topic has its sub-steps (and their content) generated, and
 * return every row that belongs to it plus each row's content.
 *
 * A brand-new topic is one seed row (from the original migration, sub_level=1,
 * kind='checkpoint' by default). The first call here expands it: the seed row
 * becomes step 1 (kind flips to 'explanation'), new rows are inserted for the
 * remaining steps, and one final row is added as the checkpoint. The seed
 * row's id is kept rather than replaced so any progress or content already
 * tied to it survives the expansion instead of being orphaned.
 *
 * Cached like the old per-level content was: generated once, for everyone,
 * not once per student.
 */
export async function ensureTopicSteps(
  supabase: any,
  seed: LevelRow,
  ctx: { userId?: string | null; studentId?: string | null; skipRateLimit?: boolean },
): Promise<{ levels: LevelRow[]; contentByLevelId: Record<string, LevelContentRow> }> {
  const { data: existingRows } = await supabase
    .from('levels')
    .select('id, track_slug, level_number, sub_level, kind, skill, title')
    .eq('track_slug', seed.track_slug)
    .eq('level_number', seed.level_number)
    .order('sub_level', { ascending: true });

  const rows = (existingRows ?? []) as LevelRow[];

  if (rows.length > 1) {
    // Already expanded. Just fetch content for each row.
    const { data: contentRows } = await supabase
      .from('level_content')
      .select('level_id, explanation, quiz, proof_title, proof_brief, sandbox')
      .in('level_id', rows.map((r) => r.id));
    const contentByLevelId: Record<string, LevelContentRow> = {};
    for (const c of contentRows ?? []) contentByLevelId[c.level_id] = c as LevelContentRow;
    return { levels: rows, contentByLevelId };
  }

  // 0 or 1 row: needs generating. (0 should not happen — the seed itself is
  // always the row passed in — but treat it the same rather than assume.)
  const { data: track } = await supabase
    .from('level_tracks')
    .select('name, role')
    .eq('slug', seed.track_slug)
    .maybeSingle();

  const { data: siblings } = await supabase
    .from('levels')
    .select('level_number, skill')
    .eq('track_slug', seed.track_slug)
    .eq('sub_level', 1);

  const allTopics = (siblings ?? []) as { level_number: number; skill: string }[];
  const before = allTopics
    .filter((l) => l.level_number < seed.level_number)
    .slice(-3)
    .map((l) => l.skill);
  const after = allTopics
    .filter((l) => l.level_number > seed.level_number)
    .slice(0, 3)
    .map((l) => l.skill);

  const prompt = buildTopicPrompt(
    seed,
    track?.name ?? seed.track_slug,
    track?.role ?? 'developer',
    allTopics.length,
    before,
    after,
  );

  const result = await generateText(
    prompt,
    // A whole topic (up to 8 steps + a 5-question quiz) needs more headroom
    // than the old single-level call did.
    { temperature: 0.8, maxOutputTokens: 3000, skipRateLimit: ctx.skipRateLimit },
    { feature: 'level-content', userId: ctx.userId ?? null, studentId: ctx.studentId ?? null },
  );

  const jsonMatch = result.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Topic content came back in a shape we could not read');
  const parsed = JSON.parse(jsonMatch[0]);

  if (
    !validSteps(parsed?.steps) ||
    !validQuiz(parsed?.quiz) ||
    typeof parsed?.proof_title !== 'string' ||
    typeof parsed?.proof_brief !== 'string'
  ) {
    // Thrown rather than patched up: a half-written topic would silently
    // mis-teach or mis-grade every student who opens it.
    throw new Error('Topic content failed validation');
  }

  const steps: ParsedStep[] = parsed.steps.map((s: any) => ({
    title: s.title.trim(),
    explanation: s.explanation.trim(),
    sandbox: s.needs_sandbox && validSandbox({ template: s.sandbox_template, files: s.sandbox_files })
      ? { template: s.sandbox_template, files: s.sandbox_files }
      : null,
  }));

  // Row 1 reuses the seed's id (preserves any existing progress/content on
  // it). The rest are new rows. The final row is the checkpoint.
  const newLevels: LevelRow[] = steps.map((_, i) => ({
    id: i === 0 ? seed.id : crypto.randomUUID(),
    track_slug: seed.track_slug,
    level_number: seed.level_number,
    sub_level: i + 1,
    kind: 'explanation' as const,
    skill: seed.skill,
    title: steps[i].title,
  }));
  const checkpoint: LevelRow = {
    id: crypto.randomUUID(),
    track_slug: seed.track_slug,
    level_number: seed.level_number,
    sub_level: steps.length + 1,
    kind: 'checkpoint',
    skill: seed.skill,
    title: 'Check yourself',
  };
  const allRows = [...newLevels, checkpoint];

  const { error: updateSeedError } = await supabase
    .from('levels')
    .update({ sub_level: 1, kind: 'explanation', title: newLevels[0].title })
    .eq('id', seed.id);
  if (updateSeedError) console.error('Could not expand seed level:', updateSeedError.message);

  const toInsert = allRows.filter((r) => r.id !== seed.id);
  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from('levels').insert(
      toInsert.map((r) => ({
        id: r.id,
        track_slug: r.track_slug,
        level_number: r.level_number,
        sub_level: r.sub_level,
        kind: r.kind,
        skill: r.skill,
        title: r.title,
      })),
    );
    if (insertError) console.error('Could not insert topic steps:', insertError.message);
  }

  const contentRows = newLevels.map((row, i) => ({
    level_id: row.id,
    explanation: steps[i].explanation,
    quiz: [] as QuizQuestion[],
    proof_title: null,
    proof_brief: null,
    sandbox: steps[i].sandbox,
  }));
  contentRows.push({
    level_id: checkpoint.id,
    explanation: `You've been through ${steps.length} steps on ${seed.skill}. Let's see what stuck.`,
    quiz: parsed.quiz.map((q: any, i: number) => ({
      id: `${checkpoint.id}-q${i + 1}`,
      prompt: q.prompt.trim(),
      options: q.options.map((o: string) => o.trim()),
      correct_index: q.correct_index,
      explanation: (q.explanation ?? '').trim(),
    })),
    proof_title: parsed.proof_title.trim(),
    proof_brief: parsed.proof_brief.trim(),
    sandbox: null,
  });

  const { error: contentError } = await supabase.from('level_content').upsert(contentRows, { onConflict: 'level_id' });
  if (contentError) console.error('Caching topic content failed:', contentError.message);

  const contentByLevelId: Record<string, LevelContentRow> = {};
  for (const c of contentRows) contentByLevelId[c.level_id] = c as LevelContentRow;

  return { levels: allRows, contentByLevelId };
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
