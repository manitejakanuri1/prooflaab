// Two small rules for the resume / interests coding round, kept apart from the
// handlers so they can be unit-tested.

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * The two problems of a round are generated in parallel from near-identical
 * prompts, and the model sometimes writes the same problem twice (seen on
 * staging, 16 Oct 2026). Same title, same statement or same function name = same problem.
 */
export function sameProblem(
  a: { title?: unknown; prompt?: unknown; function_name?: unknown },
  b: { title?: unknown; prompt?: unknown; function_name?: unknown },
): boolean {
  return (!!norm(a.title) && norm(a.title) === norm(b.title))
    || (!!norm(a.prompt) && norm(a.prompt) === norm(b.prompt))
    || (!!norm(a.function_name) && norm(a.function_name) === norm(b.function_name));
}

/**
 * Tests the untouched starter code already passes (it returns the empty/zero
 * value, so any test expecting 0, "" or [] passes) prove nothing about the
 * student. They are left out of the score: a student who submitted the starter
 * unchanged scored 40 before this. If the starter could not be checked
 * (starterPassed null) every test counts, as before.
 */
export function scoreWithoutFreeTests(
  results: { id?: string; passed: boolean }[],
  total: number,
  starterPassed: Set<string> | null,
): { pass_count: number; total: number; free: number } {
  if (!starterPassed || starterPassed.size === 0 || starterPassed.size >= total) {
    return { pass_count: results.filter((r) => r.passed).length, total, free: 0 };
  }
  return {
    pass_count: results.filter((r) => r.passed && !starterPassed.has(String(r.id))).length,
    total: total - starterPassed.size,
    free: starterPassed.size,
  };
}
