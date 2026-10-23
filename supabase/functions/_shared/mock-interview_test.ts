import { mergeGrades } from "./mock-interview.ts";

const assert = (ok: boolean, why: string) => {
  if (!ok) throw new Error(why);
};

Deno.test("Q1's grade lands on the first answer (n = 0) and the last question keeps its own grade", () => {
  const answers = [0, 1, 2, 3].map((n) => ({ n, transcript: `a${n}` }));
  const grades = [1, 2, 3, 4].map((q) => ({ q, score: q * 10, note: `about Q${q}` }));
  const merged = mergeGrades(answers, grades);
  assert(merged.every((a) => a.feedback === `about Q${a.n + 1}` && a.score === (a.n + 1) * 10), JSON.stringify(merged));
});

Deno.test("a question the AI did not grade says not scored, the rest are untouched", () => {
  const merged = mergeGrades([{ n: 0 }, { n: 1 }], [{ q: 2, score: 50, note: "ok" }]);
  assert(merged[0].score === null && merged[0].feedback === null, "first ungraded");
  assert(merged[1].score === 50, "second graded");
});
