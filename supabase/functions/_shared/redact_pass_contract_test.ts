// Contract between redact() (what submit-sandbox-task stores as task_submissions.details) and the
// database pass rule (migrations 91 + 93, record_task_submission): every stored entry counts as one
// test, except the hidden summary, which counts as its hidden_count tests. If redact() changes its
// shape, this fails here instead of every correct submission being recorded 'failed' in production
// (the 444b2f3 incident: 91 counted rows, redact() had started storing one summary row).
import { redact, type GradedTest } from "./sandbox.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** The SQL rule of migration 93, in TypeScript. */
function databaseWouldPass(details: unknown[], total: number, passedCount: number): boolean {
  const counted = details.reduce<number>((n, d) => {
    const r = d as { id?: unknown; hidden_count?: unknown };
    return n + (r.id === "hidden-summary" && typeof r.hidden_count === "number" ? r.hidden_count : 1);
  }, 0);
  return total > 0 && passedCount === total && counted === total &&
    details.every((d) => (d as { passed?: unknown }).passed === true);
}

const t = (id: string, visible: boolean, passed: boolean): GradedTest =>
  ({ id, visible, passed, verdict: passed ? "accepted" : "wrong_answer", stdin: "s", expected: "e", actual: passed ? "e" : "x" });

Deno.test("a submission passing every test is stored in a shape the database counts as passed", () => {
  for (const hidden of [0, 1, 2, 3, 8]) {
    for (const visible of [1, 2]) {
      const results = [
        ...Array.from({ length: visible }, (_, i) => t(`v${i}`, true, true)),
        ...Array.from({ length: hidden }, (_, i) => t(`h${i}`, false, true)),
      ];
      const stored = redact(results);
      assert(databaseWouldPass(stored, results.length, results.length),
        `${visible} visible + ${hidden} hidden, all passed: the database would record 'failed'`);
    }
  }
});

Deno.test("any failing test - visible or hidden - is never counted as passed", () => {
  const cases: GradedTest[][] = [
    [t("v0", true, true), t("h0", false, true), t("h1", false, false)],
    [t("v0", true, false), t("h0", false, true), t("h1", false, true)],
    [t("v0", true, true), t("h0", false, false)],
  ];
  for (const results of cases) {
    const passed = results.filter((r) => r.passed).length;
    assert(!databaseWouldPass(redact(results), results.length, passed), "a failing test was counted as passed");
  }
});

Deno.test("stored details carry no hidden inputs, outputs or ids", () => {
  const stored = JSON.stringify(redact([t("v0", true, true), t("SECRET-ID", false, false), t("SECRET-ID-2", false, true)]));
  assert(!stored.includes("SECRET-ID"), "hidden test id stored");
  assert((stored.match(/"stdin"/g) ?? []).length === 1, "hidden stdin stored");
});
