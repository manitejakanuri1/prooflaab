// Nightly Lot job status (migrations 75/76).
import { assertEquals } from "jsr:@std/assert@1";
import { dailyLotsStatus, jobState } from "../scheduled-job/index.ts";

Deno.test("daily-lots status: success, partial_failure, failure thresholds", () => {
  assertEquals(dailyLotsStatus(0, 15000), "success");
  assertEquals(dailyLotsStatus(10, 15000), "partial_failure");
  assertEquals(dailyLotsStatus(49, 15000), "partial_failure");
  assertEquals(dailyLotsStatus(50, 15000), "failure");          // 50 students is a failure at any size
  assertEquals(dailyLotsStatus(3, 40), "failure");              // 7.5% of a small college
  assertEquals(dailyLotsStatus(15000, 15000), "failure");       // what used to answer ok:true
});

Deno.test("a job result is a failure when it says so; jobs without a status are successes", () => {
  assertEquals(jobState({ status: "failure" }), "failure");
  assertEquals(jobState({ ok: false }), "failure");
  assertEquals(jobState({ status: "partial_failure" }), "partial_failure");
  assertEquals(jobState({ squads_created: 0 }), "success");
  assertEquals(jobState(null), "success");
});
