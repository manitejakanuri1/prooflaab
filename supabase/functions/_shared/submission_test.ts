// Run: deno test supabase/functions/_shared/submission_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { selfAuthoredTask, submissionPassed } from "./submission.ts";

Deno.test("record_task_submission status maps to a real boolean `passed`", () => {
  assertEquals(submissionPassed({ status: "passed" }), true);
  assertEquals(submissionPassed({ status: "failed" }), false);
  assertEquals(submissionPassed({ status: "needs_review" }), false);
  assertEquals(submissionPassed({}), false);           // the old bug: no `passed` field -> undefined
  assertEquals(submissionPassed(null), false);
});

Deno.test("a task its own student inserted is refused as evidence; server and college tasks are not", () => {
  const sa = "00000000-0000-4000-8000-0000000000a1", college = "00000000-0000-4000-8000-0000000000c1";
  assertEquals(selfAuthoredTask({ student_id: sa, inserted_by: sa }), true);
  assertEquals(selfAuthoredTask({ student_id: sa, inserted_by: college }), false);   // college manual assignment
  assertEquals(selfAuthoredTask({ student_id: sa, inserted_by: null }), false);      // daily / company / roadmap Lot
  assertEquals(selfAuthoredTask({ student_id: sa }), false);                         // row from before migration 103
  assertEquals(selfAuthoredTask({ student_id: sa, inserted_by: "" }), false);
  assertEquals(selfAuthoredTask(null), false);
});
