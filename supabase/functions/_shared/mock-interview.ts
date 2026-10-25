/**
 * Puts the AI's per-question grades on the right answers. The transcript shows the questions as Q1, Q2, ...
 * and the AI numbers its grades the same way ("q": 1 for Q1); answers are stored from n = 0. Reading the AI's
 * number as n put every feedback line one question too low until 23 Oct 2026 (migration 139 repaired them).
 */
export interface Graded { q: number; score: number; note: string }

export function mergeGrades<A extends { n: number }>(answers: A[], grades: Graded[]) {
  return answers.map((a) => {
    const g = grades.find((p) => Number(p.q) === a.n + 1);
    return { ...a, score: g?.score ?? null, feedback: g?.note ?? null };
  });
}
