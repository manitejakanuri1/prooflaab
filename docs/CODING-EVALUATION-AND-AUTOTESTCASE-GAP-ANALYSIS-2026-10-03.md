# Coding evaluation, Code Runner and AutoTestCase gap analysis (3 Oct 2026)

Read-only. AutoTestCase was inspected read-only on GitHub. **No code was copied and nothing was integrated.**

## 1. Every path where a student writes or runs code (SRC)

| # | Path | Question source | Editor | Run | Submit | Tests | Runner | Authority | Downstream |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Daily Lot, sandbox mode | `lot-writer` → `auto-config` (DeepSeek) | `SandboxTaskPanel` | `run-sandbox`: **visible tests only**, through `gradeTests` → `runCode` | `submit-sandbox-task`: **all tests**, `redact()` hidden, `record_task_submission` | `task_sandbox_config.test_cases` (3–8 asked; production has 1–5, 1–2 visible); **validated against the reference solution by real execution** | `runCode`: own runner, then Wandbox ×2, then Godbolt, then Glot (off) | **execution** | `task_submissions` → Build-log, XP |
| 2 | Admin/college assigned coding task | `assign_tasks` → `generateGradedConfig` | same panel | same | same | same | same | execution | same |
| 3 | Admin config preview | `run-sandbox` with `config_id` | admin UI | runs the **reference solution** on all tests | n/a | same table | same | validation tool | none |
| 4 | Resume coding round | `resume-coding-generate` (DeepSeek, cached per profile) | `TimedResumeAssessment` | `resume-code-execute mode=run`: test 1 | `mode=submit`: all 3, **not redacted** | 3 AI tests, **never validated** | `runCode` (with public fallbacks) | execution against **unvalidated** expectations | `resume_scorecards.coding_score` |
| 5 | Written Lot "try your code" scratchpad (migration 48) | n/a | `CodeRunBox` in `WrittenTaskPanel` | `run-code` (own runner only, `guard` 120/h no-op) | none: the written answer is graded by rubric | none | own runner only (busy if down) | not graded | none |
| 6 | Tracks lesson code examples | level content | `CodeRunBox` in `LevelDetail` | `run-code` | none | none | own runner only | not graded | none |
| 7 | Track quiz | level content MCQs | `LevelDetail` | n/a | `level-quiz-submit`: server `correct_index`, pass mark | MCQ | none | deterministic | `student_levels` |
| 8 | Old conceptual questions after proof upload | `question-generator` / `submit-conceptual-answers` | `ConceptualQuestionsModal` | n/a | legacy | AI | none | AI | `conceptual_tests` (0 rows); **unreachable** (the upload-proof modal never opens) |
| 9 | Recruiter Sponsored Lot | recruiter writes title and brief | written panel | none | `submit-written-task` | none: **the generic written checklist** (migration 21 trigger) | none | AI rubric | `task_submissions`, but `recruiter_lots` reads `proof_uploads`, so **invisible to the recruiter** |
| 10 | Company "Post Task" | company form | written panel | none | generic written checklist | none | none | AI rubric | `StartupSubmissionsPage` reads `proof_uploads` (L1), so invisible |

Production reality (DATA): **0 sandbox tasks and 0 code submissions** exist right now. All 14 `task_submissions` are written. 7 of 37 Lot templates are sandbox; none was handed out in the visible window.

## 2. Run vs Submit (SRC)

| Path | Run | Submit | Can "program ran" become "solved"? |
|---|---|---|---|
| Daily sandbox | visible tests, compared output | all tests, weighted, `pass_threshold` (80 auto) | **No.** Verdict = exact `stdout.trim() === expected.trim()` |
| Resume coding | test 1 only | all 3 | **No**, but the tests may be wrong (unvalidated) and are leaked |
| Scratchpad / lessons | free run, no tests | n/a | Not graded, so no |
| Any AI-as-judge for code? | — | — | **None found.** No coding path lets an AI decide pass/fail of code (point 126). The **rubric downgrade** in `auto-config`, though, turns a coding-intended Lot into an AI-graded written task when test generation fails twice (`usedFallback='rubric_downgrade'`). The student then explains instead of codes |

## 3. Code Runner architecture (SRC, CFG)

```text
browser → functions (run-sandbox / submit-sandbox-task / resume-code-execute / run-code)
        → _shared/sandbox.ts runOnOwnRunner (POST /run, x-runner-secret, 70 s timeout)
        → prooflab-code-runner (Python ThreadingHTTPServer, root process)
            → per run: mkdtemp, write file, chown runner, compile (40 s) and run (10 s)
              as uid 'runner' with setsid, RLIMIT_CPU, RLIMIT_FSIZE 16 MB,
              RLIMIT_NPROC 256, RLIMIT_CORE 0; stdout/stderr cut to 64 KB
        ← {status ok|compile_error|runtime_error|time_limit, stdout, stderr}
fallback (runCode only, not run-code): Wandbox (2 tries, 15 s) → Godbolt (no java/js/php) → Glot (needs GLOT_API_TOKEN: not set)
```

| Language | Runtime | Compile | File |
|---|---|---|---|
| python | python3 (Debian bookworm) | — | main.py |
| javascript | node | — | main.js |
| ruby | ruby | — | main.rb |
| php | php-cli | — | main.php |
| c | gcc -O2 -lm | 40 s | main.c |
| cpp | g++ -O2 -std=c++17 | 40 s | main.cpp |
| go | go build (GO111MODULE off) | 40 s | main.go |
| java | javac -J-Xmx512m; java -Xmx256m -Xss64m | 40 s | `<public class>.java` or the class declaring main |

Not supported: typescript, kotlin, C#, rust.

**Scale (CFG):**

| Setting | Value |
|---|---|
| CPU / RAM | 2 vCPU / 2 GiB |
| Concurrency | 1 |
| Instances | min 0, max 6; scales to zero, so cold starts happen |
| Timeout | 120 s |

At most 6 simultaneous runs; a Submit with N tests is N sequential runs. EARLIER staging load: 40 concurrent "Run" requests gave p95 0.74 s, about 105 runs/s (staging, half size). **1,000 concurrent code runs: NOT TESTED.** INFERRED: with 6 runners, requests beyond 6 queue at Cloud Run or fall back to the public runners.

**Security, re-confirmed (SRC + CFG):**

| Finding | Status |
|---|---|
| **F8** | `os.killpg` only in the `TimeoutExpired` branch. A normal exit leaves children of the session alive, under the same uid `runner` for every run, on a reused instance. Open |
| **F9** | No `RLIMIT_AS` (memory); `RLIMIT_NPROC` is 256 for the whole uid; no VPC/egress control (CFG); metadata server not blocked (INFERRED: reachable from a child process); `/tmp` shared. Open |
| **F10** | `runCode` falls back to Wandbox, Godbolt and Glot for **graded paths, hidden tests included** (Daily sandbox submit, resume Submit, auto-config validation of the reference solution). `run-code` (scratchpad) is own-runner only. Open |
| N10 | Invoker is `allUsers`; protected only by `x-runner-secret` (`hmac.compare_digest`). Open |
| Tests | **No automated code-runner tests exist** (`code-runner/` has 2 files) |

## 4. Existing test-generation logic in ProofLab (SRC)

| Component | What it already does |
|---|---|
| `_shared/auto-config.ts` | Asks DeepSeek for `language`, `starter_code`, `constraints_text`, **`reference_solution`** and 3–8 `test_cases` with visibility and weight 1–5. **Executes the reference solution on every test with the real runner.** Retries once with the failing cases quoted. On a second failure, downgrades to rubric; then falls back to the generic checklist |
| `_shared/sandbox.ts gradeTests` | Weighted scoring; a compile error short-circuits; `redact()` for hidden tests |
| `run-sandbox` (admin) | Re-validates a config's reference solution |
| Resume coding | A **second, separate generator** with no reference and no validation (duplicate logic) |

## 5. AutoTestCase (github.com/SRIRAM-OG/AutoTestCase): read-only comparison

| Item | Finding |
|---|---|
| LICENSE | **None** (GitHub API `license: null`). With no licence, no permission to reuse is granted, so **do not copy code or prompts** |
| What it is | A Google AI Studio template app: Express `server/index.ts` + React UI. One `POST /api/generate` sends user code to Gemini (`gemini-3-flash-preview`) with a JSON schema |
| Test generation | The prompt asks for 2–5 tests for short code and 8–10 for long code, a runnable test-suite string, and `edgeCases` / `coveragePercent` / `confidence` numbers |
| Pass/fail | **Simulated by the AI**: "simulate running the tests against the ORIGINAL buggy code. Mark the tests that would fail as passed:false". **Nothing is executed** |
| Coverage | An AI estimate (`coveragePercent`), not measured |
| Also | Rewrites the user's code (`updatedCode`): a repair feature |

**What its concepts would add to ProofLab (backend-only, if adopted later):**
1. A test count scaled to problem size, instead of a fixed 3.
2. An explicit **edge-case category** list (empty input, boundaries, large n, invalid input) inside the existing `auto-config` prompt.
3. A per-test **`errorReason`** that explains a failure, generated **after** real execution from the real diff, not simulated.

**What ProofLab already has, so these would be duplicates:** AI test generation (auto-config), structured JSON schema, retry on failure, runnable tests.

**What must never be copied:**
- AI-simulated pass/fail;
- AI "coverage %" or "confidence" shown as fact;
- auto-repair of student code;
- a student-visible "AutoTestCase" page;
- sending student code to a second AI provider (Gemini) for test generation.

**Key distinction:** AI generating **candidate** tests (fine, when validated by execution against a reference and against known-wrong solutions) vs AI **pretending tests passed** (never acceptable as grading).

## 6. Shared evaluation engine: what is shared vs duplicated (analysis only)

| Already shared | Duplicated or divergent |
|---|---|
| `sandbox.ts runCode / gradeTests / redact / verdictFor` used by run-sandbox, submit-sandbox-task, auto-config, resume-code-execute (the last uses `runCode` plus its own loop and **skips `redact`**) | Resume coding has its own generator (no reference), its own result loop and its own denominator rule |
| `auto-config.generateGradedConfig` used by lot-writer and assign_tasks | `run-code` calls `runOnOwnRunner` directly (intentionally no fallback) |
| `rubric-grading.gradeOnce` used by submit-written-task and auto-config | Sponsored Lots and company tasks bypass grading-config generation (generic checklist) |

INFERRED feasibility: one internal evaluator, `generate → validate (reference + known-wrong) → store versioned config → grade by execution → redact`, is reachable by routing the resume round through `auto-config`'s sandbox path and extending `gradeTests`. Nothing here is implemented.

## 7. Gaps vs intent

| Gap | Evidence |
|---|---|
| Hidden tests leave ProofLab via the public fallbacks (F10) | SRC |
| Resume tests are unvalidated, leaked in responses, shared via cache (R2/R3) and readable from the row (N20) | SRC + DATA |
| No test versioning: a config edit changes the grading of past and future submissions; `task_submissions` stores `sandbox_config_id`, not a version | SRC |
| No known-wrong-solution check: a weak test set that accepts constant output passes validation | SRC |
| No code-runner tests; F8/F9 open | SRC |
| No coding Lots are being handed out at all in production right now | DATA |
