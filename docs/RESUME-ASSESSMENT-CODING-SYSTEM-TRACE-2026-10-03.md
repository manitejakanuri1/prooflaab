# Resume → claims → assessment → coding round → scorecard: pin-to-pin trace (3 Oct 2026)

Read-only. All flows are **SOURCE CONFIRMED** at HEAD `d736e4d`.
- The live deep journey last ran on 30 Sep (EARLIER, deep bug finder 6/6).
- It is **NOT RE-RUN**: the smoke student is deleted (N1), and the deep bug-finder trigger fails with code 7.

## A. Current reality

```mermaid
flowchart TB
  START[/student/start → IntakeChoice/] -->|upload| UP[files service: resumes/<uid>/file]
  START -->|Skip| INT[StudentInterestOnboarding → InterestReview]
  UP --> PDF[browser pdf.js text<br/>(DOCX unzipped server-side)]
  PDF --> RP[resume-parser<br/>DeepSeek, whole text]
  RP --> RC[(resume_claims status=extracted<br/>skills, certs, projects, target_role,<br/>quality+ATS scores, resume_text ≤30k)]
  RC --> CONF[ResumeCheckFlow confirm/edit claims]
  INT --> IA[interests-analyze<br/>DeepSeek, cache:true]
  IA --> SI[(student_interests)]
  CONF --> RQG[resume-question-generator<br/>5 MCQ + short answers]
  SI --> RQG
  RQG --> RA[(resume_assessments.questions<br/>incl. correct_index)]
  RA --> TRA[TimedResumeAssessment<br/>30 s MCQ / 90 s written, localStorage resume]
  TRA --> RAS[resume-assessment-submit<br/>MCQ: server key · short: DeepSeek cache:true<br/>+ roadmap DeepSeek]
  RAS --> SCORE[(resume_scorecards)]
  RAS --> RT[(tasks 'Roadmap: …'<br/>generic written checklist)]
  TRA --> RCG[resume-coding-generate<br/>2 problems × 3 tests, ai_templates cache]
  RCG --> RCE[resume-code-execute<br/>run = test 1 · submit = all 3]
  RCE --> SCORE
  SCORE --> RET[resume-retest-generate<br/>cooldown, weak topics]
  RC --> IMP[resume-improve<br/>DeepSeek rewrite]
```

### A1. Upload and parsing: `resume-parser` (SRC)

| Aspect | Reality |
|---|---|
| File | Uploaded by the browser to the private bucket. `storage_path` must start with `<callerId>/` (403 otherwise) |
| Text | PDF text extracted **in the browser by pdf.js** (OCR for scans in the browser) and sent as `resume_text`. If it is missing, the server downloads the file and unzips DOCX. The server **does not verify** that the text matches the file |
| AI | `generateText(prompt + "RESUME TEXT:\n" + full text)`: DeepSeek `deepseek-chat`, temperature 0.2, max 4,000 tokens, JSON mode. **The whole resume is sent** (name, phone, email and so on as written). No truncation before the AI; the DB copy is truncated to 30,000 chars. **Synchronous**: the browser waits. No timeout on the AI fetch (F14) |
| Output | `target_role`, skills, certifications, projects, `resume_quality_score`, `ats_match_score`, notes, into `resume_claims` (status `extracted`) |
| Duplicates | Every upload makes a new `resume_claims` row (9 rows in production) |
| Stale comment | `_shared/llm.ts` header says resume-parser needs Gemini for PDFs. **False today**: the parser is text-only (contradiction C-12) |

### A2. Claim confirmation (SRC)
- In `ResumeCheckFlow` the student can edit skills, certifications, projects and target role, then confirm (`confirmed_at`).
- The student can **add claims freely**. Nothing marks a claim as verified at this step. Verification is only the later quiz and coding score; claims themselves are never marked proven or unproven.
- Downstream trust:
  - the question generator uses the claimed skills and projects;
  - the coding round language is the first claimed skill that maps to a language;
  - recruiter views show the scorecard numbers.

### A3. Question generator: `resume-question-generator` (SRC)
- **Content:** exactly 5 MCQs, plus short-answer "defence" questions about claimed projects. The fallback count is computed from the projects.
- **Prompt wording:** the prompt says "15-second timer". The UI gives 30 s per MCQ and 90 s per short answer (`TimedResumeAssessment.secondsFor`), and the server allowance uses the same 30/90 plus grace. This is a wording mismatch.
- **Answer key:** `correct_index` is stored in `resume_assessments.questions`. The response strips `correct_index` and `explanation` before it reaches the browser.
- **Cache:** none for MCQs. The questions are meant to differ between students.

### A4. Assessment submit: `resume-assessment-submit` (SRC)

| Part | Deterministic? | Authority |
|---|---|---|
| MCQ | yes: `selected_index === correct_index`, 100 or 0 | server reads `correct_index` **from the stored row** |
| Short answer | no: DeepSeek, temperature 0.3, `cache:true` keyed on prompt + answer | server |
| Timer | `elapsed = now − started_at`, compared with the sum of 30/90 s plus grace; over the limit means `expired` | server, but `started_at` lives on the same row (see N20) |
| Roadmap | DeepSeek ("witty mentor, roast with love") stages, saved as `tasks` "Roadmap: …" with no grading config | the trigger assigns the generic written checklist. **72 of 83 production tasks are these** (DATA) |
| Retake | `resume-retest-generate`: only after `status='graded'`, plus a cooldown (`COOLDOWN_MS`) | server |
| Refresh | progress is saved in `localStorage` per assessment; timers reset to full on resume | browser |

### A5. Coding round: `resume-coding-generate` and `resume-code-execute` (SRC, DATA)

| Question | Reality |
|---|---|
| Language | First claimed skill in `LANGUAGE_MAP`, default python. **`typescript` is mapped, but no runner supports it**: the own runner returns "Unsupported language" as `compile_error`, and Wandbox/Godbolt/Glot have no typescript entry, so a TypeScript student fails every test |
| Problems | 2, "solvable in under 15 lines", easy |
| Tests | **Exactly 3 per problem**, written by the AI. `test_cases[0]` is the visible sample; the other 2 are hidden |
| Reference solution | **None. The tests are never executed against a known-good solution**, unlike Daily Lots, where `auto-config` validates. A wrong `expected_output` is served as truth |
| Cache | `ai_templates`, key `template_key('coding_round', role, sorted skills, language)`. **Students with the same profile get identical problems and identical hidden tests.** 24 templates in production, 31 cache hits (DATA) |
| Run | Runs only test 1 (the visible one). Returns stdin, expected and actual |
| Submit | Runs all 3 through `runCode` (own runner, then **Wandbox/Godbolt public fallbacks: hidden tests can leave ProofLab**, F10). **The response returns stdin, expected and actual for every test, hidden ones included. No `redact()`** |
| Denominator | A `compile_error` breaks the loop, so `total = results.length` (1, not 3). This changes the problem's weight in the final `coding_score = Σpass / Σtotal` |
| Storage | `coding_results` on `resume_assessments`; the final `coding_score` is written to `resume_scorecards` |
| Rate limit | `guard(bucket 'resume-code-execute', 60/h)`: a **no-op in production** (F3) |
| Production data | 10 assessments; 60 coding tests and 50 MCQ keys are stored (DATA) |

### A6. N20 (new): answer keys and hidden tests sit on a student-writable row (SRC + DATA; live exploit NOT TESTED)
- **Policy:** `resume_assessments_own_all` is `for all to authenticated using (student_id = auth.uid() or is_admin()) with check (same)` (`20260815000000_stage1_identity_and_intake.sql:422`).
- **Identity mapping:** in production `student_profiles.id = user_id` for **17 of 17** students (DATA), so `student_id = auth.uid()` holds for the owner.
- **What a student could do** through PostgREST, which every browser can reach with its own ticket:
  - read `questions` (with `correct_index`) and `coding_questions` (with hidden tests);
  - by the policy, also **UPDATE** them, along with `started_at`, before calling submit, which **trusts the stored key and tests**.
- **Not verified:** no migration in `migration/` changes grants on this table, but the production column grants were **not inspected**.
- **Classification:** P1 candidate. To settle it, do a staging probe with a test student: GET and PATCH on own `resume_assessments`.

### A7. Other resume pieces (SRC)

| Piece | Status |
|---|---|
| `resume-improve` (DeepSeek rewrite, `improved_*` columns) | current, reachable from `ResumeCheckFlow` |
| `resume-retest-generate` | current |
| `interests-analyze` (Skip path) | current; `cache:true` |
| ATS / quality scores | AI estimates from the parser, not a real ATS |
| Voice verification of the resume (`voice_authenticity_score` column) | column exists; no current writer found among the 40 slugs (the old `resume-voice-verify` mentioned in the `llm.ts` header is not registered). UNKNOWN whether any row has it |
| JD matching / certification radar (`resume-jobmatch`, `resume-certs` tabs) | **retired**: the legacy tab ids map to Profile (`StudentDashboardContent.LEGACY`) |
| Public scorecard | view `public_resume_scorecards` (2 rows) |

### A8. Skip-resume path (SRC)
- It shares the question generator, assessment, coding round, scorecard and retest (`student_interest_id` instead of `resume_claims_id`; exactly one, enforced by a check constraint).
- For the coding language, interests are treated as skills.
- There is no duplicated logic. One code path has two inputs, which is good design.

## B. Product intent
- Resume claims should be verified by real assessment.
- Coding should be graded by actual execution with hidden tests.
- Questions should be clear.

## C. Gaps

| # | Gap | Severity guess |
|---|---|---|
| R1 | N20: answer keys and hidden tests readable (and by policy writable) by the student | P1 (to verify on staging) |
| R2 | Hidden tests are returned in the Submit response; templates are shared across students | P2 |
| R3 | AI-written expected outputs are never validated by execution | P2 |
| R4 | Only 3 tests per problem; constant-output or overfitting risk; "easy, under 15 lines" barely distinguishes ability | P3 (product) |
| R5 | TypeScript is mapped but cannot run | P3 |
| R6 | A compile error shrinks the denominator | P4 |
| R7 | The whole resume, PII included, goes to DeepSeek (F15) | P2 (legal review) |
| R8 | 15 s in the prompt vs 30/90 s in practice | P4 |
| R9 | Roadmap tasks are graded by the generic checklist and flood "Your tasks" (72 rows) | P3 (product) |
