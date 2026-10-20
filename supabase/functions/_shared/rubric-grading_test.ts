import { assertEquals, assert } from "jsr:@std/assert@1";
import {
  parseGradedFeedback,
  parseGrade,
  zeroUnquotedCredit,
  totalOf,
  wordCount,
  defaultSummary,
  defaultNextStep,
  type Criterion,
  type CriterionScore,
} from "./rubric-grading.ts";

const sampleCriteria: Criterion[] = [
  {
    id: "c_logic",
    name: "Business Logic",
    description: "Explains how the core transaction is calculated and verified",
    max_points: 3,
  },
  {
    id: "c_errors",
    name: "Error Handling",
    description: "Handles boundary conditions and invalid input gracefully",
    max_points: 2,
  },
];

Deno.test("wordCount counts whitespace-delimited tokens correctly", () => {
  assertEquals(wordCount(""), 0);
  assertEquals(wordCount("   "), 0);
  assertEquals(wordCount("One two three four five."), 5);
  assertEquals(wordCount("  Lots   of \n messy   spaces \t here  "), 5);
});

Deno.test("parseGradedFeedback parses complete structured feedback object", () => {
  const json = JSON.stringify({
    scores: [
      {
        criterion_id: "c_logic",
        points: 3,
        evidence: "we check balance first",
        reason: "Clearly explained the core validation step.",
        missing: "",
        improvement: "No changes needed.",
      },
      {
        criterion_id: "c_errors",
        points: 1,
        evidence: "returns null on error",
        reason: "Mentions basic error return but does not log or handle network timeouts.",
        missing: "Handling network timeout failures.",
        improvement: "Add a try/catch or timeout fallback.",
      },
    ],
    summary: "Good grasp of business logic with room for better error recovery.",
    next_step: "Study timeout retry patterns.",
  });

  const parsed = parseGradedFeedback(json, sampleCriteria);
  assert(parsed !== null);
  assertEquals(parsed.scores.length, 2);
  assertEquals(parsed.scores[0].points, 3);
  assertEquals(parsed.scores[0].reason, "Clearly explained the core validation step.");
  assertEquals(parsed.scores[1].points, 1);
  assertEquals(parsed.scores[1].missing, "Handling network timeout failures.");
  assertEquals(parsed.summary, "Good grasp of business logic with room for better error recovery.");
  assertEquals(parsed.next_step, "Study timeout retry patterns.");
});

Deno.test("parseGradedFeedback clamps out-of-range points", () => {
  const json = JSON.stringify({
    scores: [
      { criterion_id: "c_logic", points: 99, evidence: "some evidence" },
      { criterion_id: "c_errors", points: -5, evidence: "other evidence" },
    ],
  });

  const parsed = parseGradedFeedback(json, sampleCriteria);
  assert(parsed !== null);
  assertEquals(parsed.scores[0].points, 3); // clamped to max_points (3)
  assertEquals(parsed.scores[1].points, 0); // clamped to 0
});

Deno.test("parseGradedFeedback handles legacy array format and creates constructive defaults", () => {
  const json = JSON.stringify([
    { criterion_id: "c_logic", points: 3, evidence: "we calculate total by multiplying" },
    { criterion_id: "c_errors", points: 0, evidence: "" },
  ]);

  const parsed = parseGradedFeedback(json, sampleCriteria);
  assert(parsed !== null);
  assertEquals(parsed.scores[0].points, 3);
  assert(parsed.scores[0].reason?.includes("understanding"));
  assertEquals(parsed.scores[1].points, 0);
  assert(parsed.scores[1].missing?.length! > 0);
  assert(parsed.scores[1].improvement?.length! > 0);
  assert(parsed.summary.length > 0);
  assert(parsed.next_step.length > 0);
});

Deno.test("parseGradedFeedback rejects output missing required criteria", () => {
  const json = JSON.stringify({
    scores: [
      { criterion_id: "c_logic", points: 3, evidence: "we check balance first" },
    ],
  });

  const parsed = parseGradedFeedback(json, sampleCriteria);
  assertEquals(parsed, null);
});

Deno.test("parseGradedFeedback handles markdown code fences around JSON", () => {
  const text = "Here is your grading result:\n```json\n" + JSON.stringify({
    scores: [
      { criterion_id: "c_logic", points: 2, evidence: "balance check" },
      { criterion_id: "c_errors", points: 2, evidence: "try catch block" },
    ],
    summary: "Solid work overall.",
    next_step: "Review edge cases.",
  }) + "\n```\nHope this helps!";

  const parsed = parseGradedFeedback(text, sampleCriteria);
  assert(parsed !== null);
  assertEquals(parsed.scores.length, 2);
  assertEquals(parsed.summary, "Solid work overall.");
});

Deno.test("parseGrade attaches summary and next_step to returned array", () => {
  const json = JSON.stringify({
    scores: [
      { criterion_id: "c_logic", points: 3, evidence: "we calculate the price" },
      { criterion_id: "c_errors", points: 2, evidence: "catch any errors" },
    ],
    summary: "Great job meeting all rubric requirements.",
    next_step: "Try building a full end-to-end service.",
  });

  const res = parseGrade(json, sampleCriteria);
  assert(res !== null);
  assertEquals(Array.isArray(res), true);
  assertEquals(res.length, 2);
  assertEquals(res.summary, "Great job meeting all rubric requirements.");
  assertEquals(res.next_step, "Try building a full end-to-end service.");
});

Deno.test("zeroUnquotedCredit validates verbatim student answer quotes", () => {
  const studentAnswer = "First we calculate the total by multiplying quantity by unit price, then we catch any invalid entries.";
  const scores: CriterionScore[] = [
    {
      criterion_id: "c_logic",
      points: 3,
      evidence: "calculate the total by multiplying",
      reason: "Calculates total correctly.",
      missing: "",
      improvement: "",
    },
    {
      criterion_id: "c_errors",
      points: 2,
      evidence: "unquoted hallucinated phrase",
      reason: "Student wrote about error handling.",
      missing: "",
      improvement: "",
    },
  ];

  const checked = zeroUnquotedCredit(scores, studentAnswer);
  assertEquals(checked[0].points, 3);
  assertEquals(checked[0].reason, "Calculates total correctly.");

  // Second criterion was unquoted: points set to 0, reason updated so it doesn't contradict score
  assertEquals(checked[1].points, 0);
  assert(checked[1].reason?.includes("No credit awarded"));
  assert(checked[1].missing?.length! > 0);
  assert(checked[1].improvement?.length! > 0);
});

Deno.test("zeroUnquotedCredit requires at least 8 characters", () => {
  const studentAnswer = "We use if statements to catch bugs.";
  const scores: CriterionScore[] = [
    {
      criterion_id: "c_logic",
      points: 2,
      evidence: "if", // only 2 chars -> not long enough to prevent hallucination
      reason: "Used if statement.",
    },
    {
      criterion_id: "c_errors",
      points: 2,
      evidence: "to catch bugs", // 13 chars -> valid verbatim quote
      reason: "Catches bugs explicitly.",
    },
  ];

  const checked = zeroUnquotedCredit(scores, studentAnswer);
  assertEquals(checked[0].points, 0);
  assert(checked[0].reason?.includes("8+ characters"));
  assertEquals(checked[1].points, 2);
  assertEquals(checked[1].reason, "Catches bugs explicitly.");
});

Deno.test("totalOf accurately sums points across criteria", () => {
  const scores: CriterionScore[] = [
    { criterion_id: "c1", points: 3, evidence: "a" },
    { criterion_id: "c2", points: 2, evidence: "b" },
    { criterion_id: "c3", points: 0, evidence: "" },
  ];
  assertEquals(totalOf(scores), 5);
});

Deno.test("defaultSummary and defaultNextStep produce constructive guidance", () => {
  const passingScores: CriterionScore[] = [
    { criterion_id: "c_logic", points: 3, evidence: "quote" },
    { criterion_id: "c_errors", points: 2, evidence: "quote" },
  ];
  const summary1 = defaultSummary(passingScores, sampleCriteria);
  assert(summary1.includes("Excellent"));
  const nextStep1 = defaultNextStep(passingScores, sampleCriteria);
  assert(nextStep1.includes("voice explanation"));

  const failingScores: CriterionScore[] = [
    { criterion_id: "c_logic", points: 1, evidence: "quote" },
    { criterion_id: "c_errors", points: 0, evidence: "" },
  ];
  const summary2 = defaultSummary(failingScores, sampleCriteria);
  assert(summary2.includes("Partially") || summary2.includes("did not meet"));
  const nextStep2 = defaultNextStep(failingScores, sampleCriteria);
  assert(nextStep2.includes("Business Logic") || nextStep2.includes("Error Handling"));
});
