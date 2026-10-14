// Run: deno test supabase/functions/_shared/review-policy_test.ts
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { COPY_MIN_WORDS, decidingGrade, needsThirdOpinion, seriousCopy } from "./review-policy.ts";

Deno.test("similar correct answers and common terminology are not a copy", () => {
  assertEquals(seriousCopy({ score: 0.85, prompt_overlap: 0.2, answer_words: 120 }), false);   // similar, not verbatim
  assertEquals(seriousCopy({ score: 0.97, prompt_overlap: 0.75, answer_words: 120 }), false);  // both restate the prompt/reference
  assertEquals(seriousCopy({ score: 0.99, prompt_overlap: 0.1, answer_words: COPY_MIN_WORDS - 1 }), false); // too short to tell
});

Deno.test("a long near-verbatim copy of a peer's answer to the same question is serious", () => {
  assertEquals(seriousCopy({ score: 0.95, prompt_overlap: 0.2, answer_words: 80 }), true);
  assertEquals(seriousCopy({ score: 0.92, prompt_overlap: 0.59, answer_words: COPY_MIN_WORDS }), true);
});

Deno.test("missing or odd similarity data never accuses a student", () => {
  assertEquals(seriousCopy(null), false);
  assertEquals(seriousCopy(undefined), false);
  assertEquals(seriousCopy({}), false);
  assertEquals(seriousCopy({ score: 0.99, answer_words: 200 }), false);       // no prompt-overlap measure: not serious
  assertEquals(seriousCopy({ score: Number.NaN, prompt_overlap: 0, answer_words: 200 }), false);
});

Deno.test("a third opinion only when the two graders really disagree", () => {
  assertEquals(needsThirdOpinion(40, 50, 15), false);
  assertEquals(needsThirdOpinion(40, 56, 15), true);
  assertEquals(needsThirdOpinion(56, 40, 15), true);
});

Deno.test("deciding grade: one -> it, two -> lower, three -> median; never more than three", () => {
  assertEquals(decidingGrade([70]), 0);
  assertEquals(decidingGrade([70, 62]), 1);
  assertEquals(decidingGrade([62, 70]), 0);
  assertEquals(decidingGrade([40, 90, 70]), 2);   // median 70
  assertEquals(decidingGrade([90, 40, 60]), 2);   // median 60
  assertEquals(decidingGrade([50, 50, 90]), 1);   // ties: stable
  assertThrows(() => decidingGrade([]));
  assertThrows(() => decidingGrade([1, 2, 3, 4]));
});
