/**
 * Pure decisions for coding-task generation: stdio vs function mode, the
 * difficulty a generated test set is held to, and when a failed coding
 * generation may (or may not) fall back to a written task. No I/O, no AI.
 */

export type SandboxKind = "stdio" | "function";
export type Difficulty = "Easy" | "Medium" | "Hard";

export const DIFFICULTIES: readonly Difficulty[] = ["Easy", "Medium", "Hard"];

/** Test counts per difficulty; the same table test-quality.ts enforces. */
export const TEST_COUNT_RANGE: Readonly<Record<Difficulty, readonly [number, number]>> = {
  Easy: [4, 5],
  Medium: [6, 8],
  Hard: [8, 10],
};

export function normalizeDifficulty(value: unknown): Difficulty | null {
  const s = String(value ?? "").trim().toLowerCase();
  return DIFFICULTIES.find((d) => d.toLowerCase() === s) ?? null;
}

/**
 * The difficulty a sandbox generation is held to. An explicit caller value
 * wins; otherwise the value the model wrote for the task; otherwise Medium -
 * the same default a Lot row is saved with, so the stored difficulty and the
 * enforced test count can never disagree.
 */
export function resolveDifficulty(explicit: unknown, parsed?: Record<string, unknown> | null): Difficulty {
  return normalizeDifficulty(explicit) ?? normalizeDifficulty(parsed?.difficulty) ?? "Medium";
}

// "Implement twoSum(nums, target)", "write a function that returns...",
// "complete the method isValid", "reverse(s) returns ..."
const FUNCTION_STYLE: RegExp[] = [
  /\b(?:implement|write|complete|define|create|code)\s+(?:a|an|the)?\s*(?:function|method)\b/i,
  /\b(?:function|method)\s+[`"']?[A-Za-z_][A-Za-z0-9_]*[`"']?\s*\(/i,
  /\bimplement\s+[`"']?[A-Za-z_][A-Za-z0-9_]*\s*\(/i,
  /\b[a-z][A-Za-z0-9_]*\s*\([^()\n]{0,80}\)\s*(?:that|which|should|must)?\s*returns?\b/i,
];

// Whole-program tasks: anything that talks about reading input or printing output.
const STDIO_STYLE: RegExp[] = [
  /\bstdin\b|\bstdout\b|\bstandard (?:input|output)\b/i,
  /\breads?\s+(?:the\s+|an?\s+)?(?:input|lines?|numbers?|integers?)\b/i,
  /\bprints?\b|\boutput format\b|\binput format\b/i,
];

/**
 * Deterministic choice for a task whose text already exists (assign_tasks).
 * Function mode only when the task is clearly "implement this function" and
 * says nothing about reading input or printing; everything else stays stdio,
 * the long-standing behaviour.
 */
export function chooseSandboxKind(title: string, description: string): SandboxKind {
  const text = `${title}\n${description}`;
  if (STDIO_STYLE.some((r) => r.test(text))) return "stdio";
  return FUNCTION_STYLE.some((r) => r.test(text)) ? "function" : "stdio";
}

/**
 * Whether a coding request whose sandbox generation failed may fall back to a
 * written (rubric) task. An explicit coding request never may: a Coding task is
 * graded by real tests or it is not created. Only an auto-guessed mode may.
 */
export function rubricFallbackAllowed(explicitSandbox: boolean): boolean {
  return !explicitSandbox;
}

/**
 * After a Lot generation: the reason it must NOT be published, or null.
 * An explicit coding Lot (grading_mode_hint "sandbox") is published only with
 * a real sandbox config - never as the written fallback.
 */
export function explicitCodingProblem(
  explicitSandbox: boolean,
  result: { ok: boolean; mode: string; configId: string | null },
): string | null {
  if (!explicitSandbox) return null;
  if (result.ok && result.mode === "sandbox" && result.configId) return null;
  return "working tests could not be built for this coding Lot; it was not published as a written Lot";
}
