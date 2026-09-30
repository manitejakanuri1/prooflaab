// Run: deno test supabase/functions/_shared/submission_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { submissionPassed } from "./submission.ts";

Deno.test("record_task_submission status maps to a real boolean `passed`", () => {
  assertEquals(submissionPassed({ status: "passed" }), true);
  assertEquals(submissionPassed({ status: "failed" }), false);
  assertEquals(submissionPassed({ status: "needs_review" }), false);
  assertEquals(submissionPassed({}), false);           // the old bug: no `passed` field -> undefined
  assertEquals(submissionPassed(null), false);
});
