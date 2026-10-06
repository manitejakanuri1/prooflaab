import { generateText } from "./llm.ts";
import { gradeTests, type SandboxTest } from "./sandbox.ts";
import { checkTestQuality } from "./test-quality.ts";
import { gradeOnce, zeroUnquotedCredit, totalOf, type Criterion } from "./rubric-grading.ts";

/**
 * One place that turns a topic/task spec into a LIVE, VALIDATED grading
 * config — a task_sandbox_config or task_rubric_config row — so nothing
 * created after stage71 ever has to fall back to a human uploading a proof.
 *
 * Validation reuses the exact same code that later grades a real student
 * submission (gradeTests for sandbox, gradeOnce/zeroUnquotedCredit for
 * rubric), so "what passes validation here" and "what a real answer scores
 * later" can never drift apart.
 *
 * Every path terminates in a usable config — see the three-step fallback
 * in generateGradedConfig's doc comment below. This function never returns
 * ok:false except on an outright LLM/infra exception (all providers down),
 * which callers already know how to handle (their existing 502/500 paths).
 */

/** Minimal duck-typed surface, same pattern as authz.ts's Queryable — avoids
 * pulling in the full supabase-js client type for a module that only ever
 * does .from(table).insert/select. */
type Db = { from: (table: string) => any };

export type AutoConfigMode = "sandbox" | "rubric";

const SANDBOX_LANGUAGES = new Set(["python", "javascript", "java", "cpp", "c", "go", "ruby", "php"]);

export interface ScenarioSpec {
  kind: "scenario";
  /** Caller's own prompt, WITHOUT a "reply with JSON" trailer — one gets appended here. */
  promptBody: string;
  /** Extra JSON fields the caller wants back alongside the grading config, e.g. {title: '...', scenario: '...'}. */
  fields: Record<string, string>;
  /**
   * Optional wording check on the model's reply, run before anything is
   * executed or stored. Each returned problem is fed back on the next attempt;
   * a reply with problems is never accepted (lot-wording.ts).
   */
  validate?: (parsed: Record<string, unknown>, mode: AutoConfigMode) => string[];
}

function wordingProblems(content: ScenarioSpec | FixedContent, parsed: Record<string, unknown>, mode: AutoConfigMode): string[] {
  return content.kind === "scenario" && content.validate ? content.validate(parsed, mode) : [];
}

function wordingRetry(problems: string[]): string {
  return `\n\nYour previous reply broke the wording rules:\n- ${problems.join("\n- ")}\n\nRewrite it so every rule is met.`;
}

export interface FixedContent {
  kind: "fixed";
  title: string;
  description: string;
}

export interface GenerateConfigParams {
  db: Db;
  mode: AutoConfigMode;
  content: ScenarioSpec | FixedContent;
  feature: string;
  usageCtx: { userId?: string | null; studentId?: string | null };
  createdBy?: string | null;
  passThreshold?: number;
}

export interface GenerateConfigResult {
  ok: boolean;
  mode: AutoConfigMode;
  configId: string | null;
  scenarioFields: Record<string, unknown>;
  usedFallback: "none" | "rubric_downgrade" | "generic_fallback";
  reason?: string;
}

const SANDBOX_SCHEMA = `"language": one of "python","javascript","java","cpp","c","go","ruby","php" — pick the one this task is written in/for,
"starter_code": short starter stub, string (may be ""),
"constraints_text": string or null,
"reference_solution": a COMPLETE, CORRECT solution in that language, reading from stdin and writing to stdout exactly as the test cases expect,
"test_cases": array of objects {"id": string, "stdin": string, "expected_output": string, "visible": boolean, "weight": integer 1-5, "kind": "normal" | "boundary" | "edge"}.
  How many: if the surrounding task has difficulty "Easy", create 4 to 5 tests; "Medium", 6 to 8; "Hard", 8 to 10. Do not pad with duplicate or meaningless tests.
  Cover: at least one normal case, one boundary case (smallest/largest allowed input, empty list, zero) and one edge case (duplicates, negatives, unusual but valid input).
  Every test has a DIFFERENT stdin. Exactly 1 or 2 are "visible": true (the examples the student sees); the rest are hidden, and hidden tests are at least as many as visible ones.
  expected_output must be EXACTLY what reference_solution prints (trailing newline agnostic).
"buggy_solution": a plausible but WRONG solution in the same language - the kind of mistake a student makes (off-by-one, ignores an edge case, hardcodes the example). Your tests must make it fail at least one test.`;

const RUBRIC_SCHEMA = `"criteria": array of 2 to 8 objects {"id": string, "name": string, "description": string, "max_points": integer}, max_points summing to 100,
"min_words": integer >= 20,
"max_words": integer <= 3000,
"reference_answer": a strong model answer, written the way a student would write it (not a rubric-style list), that would score close to full marks against your own criteria above.`;

function schemaFor(mode: AutoConfigMode): string {
  return mode === "sandbox" ? SANDBOX_SCHEMA : RUBRIC_SCHEMA;
}

function buildPrompt(content: ScenarioSpec | FixedContent, mode: AutoConfigMode, retryNote?: string): string {
  const schema = schemaFor(mode);
  if (content.kind === "scenario") {
    const fieldLines = Object.entries(content.fields).map(([k, v]) => `"${k}": ${v}`).join(",\n ");
    return `${content.promptBody}${retryNote ?? ""}

Reply with JSON only, exactly these keys:
{${fieldLines},
 ${schema}}`.trim();
  }
  return `You are producing an automatic grading config for a task already written. Do not rewrite the task.

Task title: ${content.title}
Task description: ${content.description}
${retryNote ?? ""}

Reply with JSON only, exactly these keys:
{${schema}}`.trim();
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    return null;
  }
}

export interface SandboxAttempt {
  language: string;
  starter_code: string;
  constraints_text: string | null;
  reference_solution: string;
  test_cases: SandboxTest[];
  buggy_solution: string | null;
}

function parseSandboxFields(parsed: Record<string, unknown>): SandboxAttempt | null {
  const language = SANDBOX_LANGUAGES.has(String(parsed.language)) ? String(parsed.language) : null;
  const reference_solution = typeof parsed.reference_solution === "string" ? parsed.reference_solution : "";
  const rawTests = Array.isArray(parsed.test_cases) ? parsed.test_cases : [];
  if (!language || !reference_solution.trim() || rawTests.length < 1 || rawTests.length > 10) return null;

  const test_cases: SandboxTest[] = [];
  for (const t of rawTests as any[]) {
    if (typeof t?.id !== "string" || typeof t?.stdin !== "string" || typeof t?.expected_output !== "string") return null;
    test_cases.push({
      id: t.id,
      stdin: t.stdin,
      expected_output: t.expected_output,
      visible: Boolean(t.visible),
      weight: Number.isFinite(Number(t.weight)) ? Math.max(1, Math.min(5, Math.round(Number(t.weight)))) : 1,
      ...(["normal", "boundary", "edge"].includes(t.kind) ? { kind: t.kind } : {}),
    });
  }
  if (!test_cases.some((t) => t.visible)) test_cases[0].visible = true;

  return {
    language,
    starter_code: typeof parsed.starter_code === "string" ? parsed.starter_code : "",
    constraints_text: typeof parsed.constraints_text === "string" ? parsed.constraints_text : null,
    reference_solution,
    test_cases,
    buggy_solution: typeof parsed.buggy_solution === "string" && parsed.buggy_solution.trim() ? parsed.buggy_solution : null,
  };
}

interface RubricAttempt {
  criteria: Criterion[];
  min_words: number;
  max_words: number;
  reference_answer: string;
}

function parseRubricFields(parsed: Record<string, unknown>): RubricAttempt | null {
  const rawCriteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  if (rawCriteria.length < 2 || rawCriteria.length > 8) return null;
  const criteria: Criterion[] = [];
  for (const c of rawCriteria as any[]) {
    const max_points = Number(c?.max_points);
    if (typeof c?.id !== "string" || typeof c?.name !== "string" || typeof c?.description !== "string" || !Number.isFinite(max_points)) {
      return null;
    }
    criteria.push({ id: c.id, name: c.name, description: c.description, max_points: Math.round(max_points) });
  }
  const reference_answer = typeof parsed.reference_answer === "string" ? parsed.reference_answer : "";
  if (!reference_answer.trim()) return null;

  const min_words = Number.isFinite(Number(parsed.min_words)) ? Math.max(20, Math.round(Number(parsed.min_words))) : 100;
  const max_words = Number.isFinite(Number(parsed.max_words)) ? Math.min(3000, Math.round(Number(parsed.max_words))) : 800;

  return { criteria, min_words, max_words: Math.max(max_words, min_words + 50), reference_answer };
}

export interface AttemptOutcome<T> {
  ok: boolean;
  attempt: T | null;
  /** Best-effort — whatever scenario/title text the model produced, even on
   * a run whose grading config failed validation. A caller writing a Lot or
   * task still needs SOME text to show the student regardless of how the
   * grading side landed. */
  scenarioFields: Record<string, unknown>;
  promptText?: string;
}

export async function tryGenerateSandbox(
  content: ScenarioSpec | FixedContent,
  feature: string,
  usageCtx: { userId?: string | null; studentId?: string | null },
): Promise<AttemptOutcome<SandboxAttempt>> {
  let retryNote = "";
  let lastFields: Record<string, unknown> = {};
  // Three tries, not two: the quality gate rejects first drafts that only looked fine.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text } = await generateText(
      buildPrompt(content, "sandbox", retryNote),
      { temperature: attempt === 0 ? 0.7 : 0.4, maxOutputTokens: 2600, json: true },
      { feature, ...usageCtx },
    );
    const parsed = parseJson(text);
    if (!parsed) continue;
    lastFields = parsed;
    const wording = wordingProblems(content, parsed, "sandbox");
    if (wording.length) {
      console.warn(`LOT WORDING REJECTED (${feature}): ${wording.join(" | ")}`);
      retryNote = wordingRetry(wording);
      continue;
    }
    const fields = parseSandboxFields(parsed);
    if (!fields) continue;

    const graded = await gradeTests(fields.language, fields.reference_solution, fields.test_cases);
    if (graded.ok && graded.passedCount === fields.test_cases.length) {
      // Consistent is not enough: obviously wrong programs must fail (test-quality.ts).
      const difficulty = ["Easy", "Medium", "Hard"].includes(String(parsed.difficulty))
        ? String(parsed.difficulty)
        : undefined;
      const quality = await checkTestQuality(
        fields.language,
        fields.test_cases,
        fields.buggy_solution,
        difficulty,
      );
      if (quality.ok) return { ok: true, attempt: fields, scenarioFields: parsed };
      console.warn(`TEST QUALITY REJECTED (${feature}): ${quality.problems.join(" | ")}`);
      retryNote = `\n\nYour reference solution passes, but the tests are too weak:\n- ${quality.problems.join("\n- ")}\n\nReturn improved test_cases (and a buggy_solution they catch). Keep the same problem.`;
      continue;
    }

    if (graded.ok) {
      const failing = graded.results.filter((r) => !r.passed).slice(0, 3)
        .map((r) => `stdin=${JSON.stringify(r.stdin)} expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}`)
        .join("\n");
      retryNote = `\n\nYour previous reference_solution failed ${graded.results.length - graded.passedCount} of ${graded.results.length} tests. Failing cases:\n${failing}\n\nReturn a corrected, complete solution (and corrected test cases if the expected_output was wrong). It must pass every test case.`;
    } else {
      retryNote = "\n\nYour previous submission could not be parsed or run. Return valid JSON in exactly the shape asked, with a complete, runnable reference_solution.";
    }
  }
  return { ok: false, attempt: null, scenarioFields: lastFields };
}

async function tryGenerateRubric(
  content: ScenarioSpec | FixedContent,
  feature: string,
  usageCtx: { userId?: string | null; studentId?: string | null },
  fixedCriteria?: Criterion[],
): Promise<AttemptOutcome<RubricAttempt>> {
  let retryNote = "";
  let lastFields: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text } = await generateText(
      buildPrompt(content, "rubric", retryNote),
      { temperature: attempt === 0 ? 0.7 : 0.4, maxOutputTokens: 1200, json: true },
      { feature, ...usageCtx },
    );
    const parsed = parseJson(text);
    if (!parsed) continue;
    lastFields = parsed;
    const wording = wordingProblems(content, parsed, "rubric");
    if (wording.length) {
      console.warn(`LOT WORDING REJECTED (${feature}): ${wording.join(" | ")}`);
      retryNote = wordingRetry(wording);
      continue;
    }
    let fields = parseRubricFields(parsed);
    if (!fields) continue;
    if (fixedCriteria) fields = { ...fields, criteria: fixedCriteria };

    // For a ScenarioSpec caller the scenario text only exists in THIS
    // response (that's the whole point of the combined call) — read it back
    // out for grading rather than requiring it up front.
    const promptText = promptTextFor(content, parsed);
    const graded = await gradeOnce(promptText, fields.criteria, fields.reference_answer, usageCtx.userId ?? "system");
    if (!graded) {
      retryNote = "\n\nGrading was unavailable last time — return valid JSON in exactly the shape asked.";
      continue;
    }
    const checked = zeroUnquotedCredit(graded, fields.reference_answer);
    const maxTotal = fields.criteria.reduce((s, c) => s + c.max_points, 0);
    const score = maxTotal > 0 ? Math.round((totalOf(checked) / maxTotal) * 100) : 0;
    if (score >= 90) return { ok: true, attempt: fields, scenarioFields: parsed, promptText };

    const weak = checked.filter((s) => s.points === 0).map((s) => s.criterion_id).join(", ") || "none";
    retryNote = `\n\nYour previous reference_answer scored only ${score}/100 against your own criteria. Weak criteria: ${weak}. Rewrite reference_answer so it clearly earns credit on every criterion — make sure it directly demonstrates each one, quoting nothing, just writing a strong genuine answer.`;
  }
  return { ok: false, attempt: null, scenarioFields: lastFields };
}

const DOWNGRADE_CRITERIA: Criterion[] = [
  { id: "effort", name: "Effort & Relevance", description: "The answer directly addresses the task and shows real engagement with it, not a generic or evasive response.", max_points: 40 },
  { id: "soundness", name: "Correctness / Soundness", description: "The explained approach is technically correct and would actually work.", max_points: 30 },
  { id: "clarity", name: "Clarity of Explanation", description: "A reader unfamiliar with the task could follow the reasoning.", max_points: 30 },
];

async function insertSandboxConfig(
  db: Db, attempt: SandboxAttempt, createdBy: string | null | undefined, passThreshold: number,
): Promise<string | null> {
  const { data, error } = await db.from("task_sandbox_config").insert({
    language: attempt.language,
    starter_code: attempt.starter_code,
    constraints_text: attempt.constraints_text,
    test_cases: attempt.test_cases,
    reference_solution: attempt.reference_solution,
    pass_threshold: passThreshold,
    created_by: createdBy ?? null,
    origin: "auto",
  }).select("id").single();
  if (error) {
    console.error("insertSandboxConfig failed:", error.message);
    return null;
  }
  return data.id as string;
}

async function insertRubricConfig(
  db: Db, attempt: RubricAttempt, promptText: string, createdBy: string | null | undefined, passThreshold: number,
): Promise<string | null> {
  const { data, error } = await db.from("task_rubric_config").insert({
    prompt_text: promptText,
    criteria: attempt.criteria,
    min_words: attempt.min_words,
    max_words: attempt.max_words,
    pass_threshold: passThreshold,
    reference_answer: attempt.reference_answer,
    created_by: createdBy ?? null,
    origin: "auto",
  }).select("id").single();
  if (error) {
    console.error("insertRubricConfig failed:", error.message);
    return null;
  }
  return data.id as string;
}

async function genericFallbackId(db: Db): Promise<string | null> {
  const { data } = await db.from("task_rubric_config").select("id").eq("is_generic_fallback", true).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function promptTextFor(content: ScenarioSpec | FixedContent, parsed: Record<string, unknown>): string {
  if (content.kind === "fixed") return content.description;
  // ScenarioSpec callers always ask for a "scenario" or "description" field back.
  return String(parsed.scenario ?? parsed.description ?? "");
}

export async function generateGradedConfig(params: GenerateConfigParams): Promise<GenerateConfigResult> {
  const { db, mode, content, feature, usageCtx, createdBy, passThreshold } = params;

  if (mode === "sandbox") {
    const result = await tryGenerateSandbox(content, feature, usageCtx);
    if (result.ok && result.attempt) {
      const configId = await insertSandboxConfig(db, result.attempt, createdBy, passThreshold ?? 80);
      if (configId) return { ok: true, mode: "sandbox", configId, scenarioFields: result.scenarioFields, usedFallback: "none" };
    }
    // Sandbox generation failed twice (or the insert itself failed) — downgrade
    // to a rubric grading the SAME topic instead of leaving it ungradeable.
    // Fresh generation (own scenario+criteria+answer call), fixed criteria.
    const rubricResult = await tryGenerateRubric(content, feature, usageCtx, DOWNGRADE_CRITERIA);
    if (rubricResult.ok && rubricResult.attempt) {
      const configId = await insertRubricConfig(db, rubricResult.attempt, rubricResult.promptText!, createdBy, passThreshold ?? 90);
      if (configId) return { ok: true, mode: "rubric", configId, scenarioFields: rubricResult.scenarioFields, usedFallback: "rubric_downgrade" };
    }
    const fallbackId = await genericFallbackId(db);
    // Best-effort scenario text: prefer whatever the rubric-downgrade attempt
    // produced (closer to the final schema), else whatever sandbox produced.
    const scenarioFields = Object.keys(rubricResult.scenarioFields).length ? rubricResult.scenarioFields : result.scenarioFields;
    return {
      ok: true, mode: "rubric", configId: fallbackId,
      scenarioFields,
      usedFallback: "generic_fallback",
      reason: fallbackId ? undefined : "generic fallback rubric config is not seeded",
    };
  }

  // mode === "rubric"
  const result = await tryGenerateRubric(content, feature, usageCtx);
  if (result.ok && result.attempt) {
    const configId = await insertRubricConfig(db, result.attempt, result.promptText!, createdBy, passThreshold ?? 70);
    if (configId) return { ok: true, mode: "rubric", configId, scenarioFields: result.scenarioFields, usedFallback: "none" };
  }
  const fallbackId = await genericFallbackId(db);
  return {
    ok: true, mode: "rubric", configId: fallbackId,
    scenarioFields: result.scenarioFields,
    usedFallback: "generic_fallback",
    reason: fallbackId ? undefined : "generic fallback rubric config is not seeded",
  };
}
