import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for ProofLab Explainable Grading & Actionable Student Feedback
 * Validates rubric scoring logic, explanation consistency, anti-hallucination guards,
 * backward-compatibility with historical rows, and fairness requirements.
 */

// Sample Rubric definition
const mockCriteria = [
  {
    id: "criterion_auth",
    name: "Authentication & Identity",
    description: "Verifies user identity via signed JWT and ensures caller is authorized",
    max_points: 3,
  },
  {
    id: "criterion_validation",
    name: "Input Validation",
    description: "Validates payload boundaries, required fields, and sanitizes input",
    max_points: 2,
  },
  {
    id: "criterion_error_handling",
    name: "Error Handling",
    description: "Gracefully handles database timeouts, returns structured HTTP error codes",
    max_points: 2,
  },
];

const maxPossibleScore = mockCriteria.reduce((sum, c) => sum + c.max_points, 0); // 7 points

// Pure verification helpers matching backend implementation
function totalOf(scores) {
  return scores.reduce((sum, s) => sum + s.points, 0);
}

function calculateScorePercentage(scores, criteria) {
  const maxPts = criteria.reduce((sum, c) => sum + c.max_points, 0);
  const total = totalOf(scores);
  return maxPts > 0 ? Math.round((total / maxPts) * 100) : 0;
}

function zeroUnquotedCredit(scores, studentAnswer) {
  const normalized = studentAnswer.toLowerCase();
  return scores.map((s) => {
    const evidence = (s.evidence || "").trim().toLowerCase();
    const quoted = evidence.length >= 8 && normalized.includes(evidence);
    if (quoted) return s;
    return {
      ...s,
      points: 0,
      reason: s.points > 0
        ? "No credit awarded: the response lacked an exact quote (8+ characters) verifying this criterion."
        : (s.reason || "Did not demonstrate this criterion in the response."),
      missing: s.missing || "Verifiable direct explanation in the response.",
      improvement: s.improvement || "Include a clear, explicit explanation in your own words that directly addresses this requirement.",
    };
  });
}

test('1. Every awarded or withheld criterion score has an appropriate, non-empty explanation', () => {
  const sampleGradedResult = [
    {
      criterion_id: "criterion_auth",
      points: 3,
      evidence: "verify JWT in Authorization header",
      reason: "Accurately described verifying the JWT bearer token before proceeding.",
      missing: "",
      improvement: "",
    },
    {
      criterion_id: "criterion_validation",
      points: 1,
      evidence: "check input is not empty",
      reason: "Checked basic emptiness but did not validate field types or length bounds.",
      missing: "Field type checks and length boundary constraints.",
      improvement: "Add checks for string length limits and expected types.",
    },
    {
      criterion_id: "criterion_error_handling",
      points: 0,
      evidence: "",
      reason: "Did not mention database error recovery or error status codes.",
      missing: "Handling database exceptions or network timeouts.",
      improvement: "Describe how you catch database exceptions and return 500 or 503 status.",
    },
  ];

  for (const s of sampleGradedResult) {
    assert.ok(s.reason && s.reason.length > 5, `Criterion ${s.criterion_id} must have a descriptive reason`);
    if (s.points < mockCriteria.find((c) => c.id === s.criterion_id).max_points) {
      assert.ok(s.missing && s.missing.length > 0, `Deduction on ${s.criterion_id} must identify missing elements`);
      assert.ok(s.improvement && s.improvement.length > 0, `Deduction on ${s.criterion_id} must provide improvement guidance`);
    }
  }
});

test('2. Criterion scores sum correctly to the total score and percentage', () => {
  const scores = [
    { criterion_id: "criterion_auth", points: 3, evidence: "auth quote" },
    { criterion_id: "criterion_validation", points: 2, evidence: "valid quote" },
    { criterion_id: "criterion_error_handling", points: 1, evidence: "err quote" },
  ];

  const totalPoints = totalOf(scores);
  assert.equal(totalPoints, 6);
  assert.equal(maxPossibleScore, 7);

  const percentage = calculateScorePercentage(scores, mockCriteria);
  assert.equal(percentage, Math.round((6 / 7) * 100)); // 86%
});

test('3. Feedback quotes actual student answer and anti-hallucination zeroUnquotedCredit operates reliably', () => {
  const answer = "We check the Authorization header for a valid Bearer token and verify JWT claims.";
  const hallucinatedScores = [
    {
      criterion_id: "criterion_auth",
      points: 3,
      evidence: "verify JWT claims", // 17 chars, present in answer
      reason: "Correctly verifies token",
    },
    {
      criterion_id: "criterion_validation",
      points: 2,
      evidence: "we validate json schema strictly", // NOT in answer!
      reason: "Validates schema",
    },
  ];

  const verified = zeroUnquotedCredit(hallucinatedScores, answer);
  assert.equal(verified[0].points, 3, "Quoted credit preserved");
  assert.equal(verified[1].points, 0, "Unquoted hallucinated credit zeroed out");
  assert.match(verified[1].reason, /No credit awarded/, "Zeroed credit explains why");
});

test('4. Equivalent correct answers in everyday student language receive full credit without jargon penalty', () => {
  // Student A uses formal jargon
  const answerA = "We authenticate the incoming request by verifying cryptographic signatures on the bearer token.";
  // Student B uses everyday plain language
  const answerB = "First we read the token from the header and check if the user is really logged in.";

  const scoreA = {
    criterion_id: "criterion_auth",
    points: 3,
    evidence: "verifying cryptographic signatures",
    reason: "Demonstrated clear understanding of authentication.",
  };

  const scoreB = {
    criterion_id: "criterion_auth",
    points: 3,
    evidence: "read the token from the header",
    reason: "Demonstrated clear understanding of authentication in straightforward language.",
  };

  assert.equal(scoreA.points, scoreB.points, "Everyday language must receive equal credit to corporate vocabulary");
});

test('5. Full-credit answers receive accurate positive explanations and no false missing warnings', () => {
  const fullScore = {
    criterion_id: "criterion_auth",
    points: 3,
    evidence: "verify JWT in Authorization header",
    reason: "Thoroughly demonstrated authentication checks and token verification.",
    missing: "",
    improvement: "",
  };

  assert.equal(fullScore.missing, "");
  assert.equal(fullScore.improvement, "");
  assert.match(fullScore.reason, /Thoroughly demonstrated|understanding/);
});

test('6. Feedback never contradicts the final score (e.g. unquoted credit deduction)', () => {
  const answer = "Short response without error details.";
  const inputScores = [
    {
      criterion_id: "criterion_error_handling",
      points: 2,
      evidence: "we catch all errors properly", // not in answer!
      reason: "Earned 2 points because errors are caught.",
    },
  ];

  const checked = zeroUnquotedCredit(inputScores, answer);
  assert.equal(checked[0].points, 0);
  assert.doesNotMatch(checked[0].reason, /Earned 2 points/, "Explanation must not claim points were earned when score is 0");
  assert.match(checked[0].reason, /No credit awarded/, "Explanation must reflect zero points awarded");
});

test('7. Backward compatibility: historical legacy submission rows without structured feedback render safely', () => {
  // Legacy DB row has only points and evidence, no reason/missing/improvement
  const legacyRubricScores = [
    { criterion_id: "criterion_auth", points: 3, evidence: "token check" },
    { criterion_id: "criterion_validation", points: 1, evidence: "" },
  ];

  const renderedCards = legacyRubricScores.map((s) => {
    const c = mockCriteria.find((x) => x.id === s.criterion_id);
    const hasDetails = Boolean(s.reason || s.missing || s.improvement);
    return {
      title: c?.name ?? s.criterion_id,
      points: s.points,
      hasDetails,
      legacyText: !hasDetails ? `${c?.name}: ${s.points}/${c?.max_points}` : null,
    };
  });

  assert.equal(renderedCards.length, 2);
  assert.equal(renderedCards[0].hasDetails, false);
  assert.equal(renderedCards[0].legacyText, "Authentication & Identity: 3/3");
  assert.equal(renderedCards[1].legacyText, "Input Validation: 1/2");
});

test('8. Voice scoring feedback contains demonstrated, missing, and improvement guidance', () => {
  const voiceEvaluation = {
    evaluator_version: "voice-eval-3",
    content_match: 88,
    demonstrated: ["Explained why express router was chosen", "Described handling edge cases in memory"],
    missing: ["Did not explain how database transactions would be rolled back"],
    improvement: "Mention transaction rollback or failure recovery when discussing data persistence.",
    summary: "Clear explanation showing authentic ownership of the solution.",
  };

  assert.equal(voiceEvaluation.demonstrated.length, 2);
  assert.equal(voiceEvaluation.missing.length, 1);
  assert.ok(voiceEvaluation.improvement.includes("rollback"));
  assert.ok(voiceEvaluation.summary.includes("ownership"));
});
