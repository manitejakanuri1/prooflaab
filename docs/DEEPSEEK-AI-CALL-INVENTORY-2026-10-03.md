# DeepSeek / AI call inventory (3 Oct 2026)

Read-only. Every row is **SOURCE CONFIRMED** at HEAD `d736e4d`.
- **Provider config (CFG):** production functions have only `DEEPSEEK_API_KEY`. The Gemini and Kimi fallbacks in `_shared/llm.ts` are dormant because their keys are unset.
- **Staging:** shares the **same** `deepseek-api-key` secret (the secret IAM lists `prooflab-staging-functions` as a reader).

## 1. The shared helper (`_shared/llm.ts`)

| Property | Value |
|---|---|
| Entry | `generateText(prompt, opts, track)`. **Every AI call in the product goes through it**: no direct provider calls elsewhere |
| Model | `deepseek-chat`, `https://api.deepseek.com/chat/completions` |
| Message shape | **One `user` message containing everything**: rules plus untrusted text. No system role (F14) |
| JSON | `response_format: json_object` unless `json:false` |
| Defaults | temperature 0.5, `max_tokens` 2000 |
| Retry | DeepSeek ×2 on 429/503 (3 s then 6 s backoff); then Gemini keys (none set), then Kimi (unset); then throws "All LLM providers exhausted" |
| Timeout | **None** (`fetch` without `AbortSignal`, F14). A hung provider holds the request until the Cloud Run timeout (300 s) |
| Rate limit | `enforceLlmRateLimit`: 60/h per user across all AI features; 200–500/h per feature anonymously. **No-op in production** (F3) |
| Usage log | `void logUsage(...)`, fire-and-forget (F20), to `llm_usage`. **No-op in production** (F3); last row 11 Sep |
| Cache | Opt-in `cache:true`, SHA-256 of (temperature, `max_tokens`, json, prompt) in `llm_cache`. **No-op in production** (F3); 4 rows, all 21 Aug |

## 2. Every call site (current product first, then legacy)

Abbreviations:
- **Sync** = the browser waits for the answer.
- **PII** = personal data present in the prompt.
- **Temp / Max** = temperature / `max_tokens`.

| # | Feature tag | File | User flow | Input sent | PII | Sync | Temp / Max | JSON | Cache | Could be cached/reused | Could be deterministic | Current/legacy |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `lot-writer` (via `auto-config`) | `lot-writer/index.ts:240`, `_shared/auto-config.ts:188/225` | First student opening a new page's Lot | page title + excerpt (or a job excerpt) | no | browser call while it views the seed card | 0.7, then 0.4 / 1600 sandbox, 1200 rubric | yes | **per page, stored in `lot_templates`** (template reuse) | already reused | no | current |
| 2 | `lot-writer` validation | `auto-config.ts:241` → `rubric-grading.gradeOnce` | same | generated reference answer + rubric | no | same | 0.3 / 1200 | array | no | — | no | current |
| 3 | `task-explain` | `_shared/explain.ts:65` (from lot-writer, task-explain, `SimpleQuestion`) | "In simple words" view of a task | title, description, code sample | no | lot-writer: inline; task-explain: browser waits | 0.4 / 1500 | yes | stored in `task_explainers` (70 rows) | already stored | no | current |
| 4 | `submit-written-task` | `submit-written-task:124/141` → `gradeOnce` | Student submits a written Lot/task | question + rubric + **student answer** (in `<answer>` tags with an anti-injection note) | answer text (may contain anything) | **yes** | 0.3 / 1200 | array | no | no (answers differ) | partly (the word-count gate already is) | current |
| 5 | `voice-score` | `_shared/voiceScore.ts` (from voice-score, transcription-reap) | After transcription | task title + **transcript** + duration/words | spoken content | **async** (worker / reaper) | 0.3 / 500 | yes | no | no | length gating could be | current |
| 6 | `resume-parser` | `resume-parser:213` | Resume upload | **whole resume text** | **yes: name, contact, education as written** | **yes** | 0.2 / 4000 | yes | no | no | no | current |
| 7 | `resume-question-generator` | `resume-question-generator:234` | Before the timed quiz | claims (skills, projects, role) | low (claims) | **yes** | 0.6 / 5000 | yes | no (meant to differ) | partly | no | current |
| 8 | `resume-assessment-submit` | `resume-assessment-submit:222` | Grading short answers | question + student answer | answer text | **yes** | 0.3 / 500 | yes | **yes (`cache:true`)** | already | no | current |
| 9 | `resume-roadmap` | `resume-assessment-submit:415` | After grading | weak topics, track skills | low | **yes** (same request) | 0.6 / 1200 | yes | no | **yes** (per weak-topic set) | partly | current |
| 10 | `resume-coding-generate` | `resume-coding-generate:190` | Coding round start | role + skills + language | low | **yes** | 0.5 / 3000 | array | **`ai_templates` per profile** | already | no | current |
| 11 | `resume-retest-generate` | `resume-retest-generate:172` | Retest of weak topics | weak topics / questions | low | **yes** | 0.6 / 3000 | yes | no | partly | no | current |
| 12 | `resume-improve` | `resume-improve:133` | "Improve my resume" | **resume text** + notes | **yes** | **yes** | 0.3 / 3000 | yes | no | no | no | current |
| 13 | `interests-analyze` | `interests-analyze:156` | Skip-resume path | chosen interests / skills | low | **yes** | 0.3 / 1200 | yes | **yes** | already | partly | current |
| 14 | `level-content` | `_shared/levels.ts:658` (`level-open`, `levels-warm`) | First open of an unwritten topic; admin warm | syllabus steps + book excerpt | no | level-open: **yes**; levels-warm: admin batch | — / large | yes | stored in `level_content` (all 465 topics written, CLAUDE.md DOC) | already stored | no | current (rare now) |
| 15 | `mock-interview-generate` | `mock-interview-generate:73` | Profile → Mock interview | role / skills | low | **yes** | 0.6 / 500 | yes | no | **yes** (per role) | partly | current, low use (`mock_interviews` 0 rows) |
| 16 | `mock-interview-score` | `mock-interview-score:90` | Mock interview answers | questions + answers | answer text | **yes** | 0.3 / 900 | yes | no | no | no | current, low use |
| 17 | `app-guide-chat` | `app-guide-chat:77` | Help chatbot on every page | user question + app guide | user-typed text | **yes** | 0.4 / 300 | text | **yes** | already | partly (FAQ) | current |
| 18 | `assign_tasks` (text) | `assign_tasks:128` | Admin/college "Assign Tasks" with AI | topic / role | no | **yes** | 0.5 / 1000 | text | no | per topic | no | current (admin/college) |
| 19 | `assign_tasks` (grading config) | `assign_tasks:272` → auto-config | same | task text | no | **yes** | as #1/#2 | yes | stored per task config | — | no | current |
| 20 | `ai-authorship` | `ai-authorship:164` | Admin Proof Review → full verification | **code snippets / repo summary of a proof** | possibly | yes | 0.2 / 2048 | yes | no | — | — | **legacy** (reachable only from admin Proof Review on `proof_uploads`, 0 rows) |
| 21 | `question-generator` | `question-generator:225` | Conceptual questions after a proof upload | proof description | low | yes | 0.7 / 4000 | yes | no | — | — | **legacy** (upload modal unreachable; admin Proof Review) |
| 22 | `response-evaluator` | `response-evaluator:179` | Grading conceptual answers | answers | answer text | yes | 0.3 / 1000 | yes | no | — | — | **legacy** |
| 23 | `verify-proof` | `verify-proof:108` | Admin proof verification | proof data | possibly | yes | 0.5 / 2000 | yes | no | — | — | **legacy** |

**Totals:** 23 AI call sites; 19 current, 4 legacy. 16 distinct current feature tags.

- **Only one AI path is asynchronous:** `voice-score`, from the worker or reaper.
- **Lot generation is effectively background:** the student sees the seed card while it runs, but it still occupies a browser-initiated request.
- **Everything else holds an HTTP request open** while DeepSeek answers, with no timeout.

## 3. Sync / async matrix with future candidates (analysis only)

| # | Current | Future candidate | Why |
|---|---|---|---|
| 1–2 lot-writer / validation | SYNC (browser-initiated) | **MAKE ASYNC** (pre-generate after crawl, or a queue) | No student should trigger generation; it would remove seed-card exposure |
| 3 task-explain | SYNC / inline | MAKE ASYNC (written with the template) | Already mostly stored |
| 4 written grading | SYNC | KEEP SYNC (short) **with a timeout**; consider async for burst | The student expects a result now |
| 5 voice-score | ASYNC | KEEP ASYNC | Correct today |
| 6 resume-parser | SYNC | KEEP SYNC with a timeout, or async with progress | First-run UX |
| 7, 11 question / retest generation | SYNC | KEEP SYNC with a timeout; or pre-generate per profile | |
| 8 short-answer grading | SYNC | KEEP SYNC | |
| 9 roadmap | SYNC | **MAKE ASYNC** | Not needed for the immediate score |
| 10 coding generate | SYNC | KEEP SYNC (cached) + **validate by execution** | |
| 12 resume-improve | SYNC | MAKE ASYNC or keep (explicit user action) | |
| 13 interests-analyze | SYNC, cached | KEEP | |
| 14 level-content | SYNC on first open | REMOVE AI POSSIBLY (all written; keep warm as admin batch only) | |
| 15–16 mock interview | SYNC | KEEP or REMOVE (product decision; 0 rows) | |
| 17 app-guide-chat | SYNC | KEEP; REMOVE AI POSSIBLY for the top FAQ | |
| 18–19 assign_tasks | SYNC | MAKE ASYNC (admin tool) | |
| 20–23 legacy | SYNC | **REMOVE** with the legacy retirement | |

## 4. Privacy: what actually leaves ProofLab (F15)

| Data | Actually sent | Where |
|---|---|---|
| Whole resume text (name, phone, email, education, projects as written) | **yes** | #6, #12 |
| Written answers | yes | #4, #8, #16 |
| Voice transcripts | yes | #5 |
| Target role, skills, claims | yes | #7, #9–#11, #13, #15 |
| College name, email, student name as structured fields | **not added by code** (only if inside the resume or answer text) | — |
| Student code | **not to DeepSeek**. It goes to the **public runners** (Wandbox/Godbolt) on fallback (F10) | `sandbox.ts` |
| Recruiter data | no AI call takes recruiter text | — |
| Help-chat questions | yes | #17 |

Potentially available but not sent: profile fields such as phone and roll number, voice audio (audio stays in GCS/Whisper), and email addresses (except inside the resume).

**Legal questions** (not decided here): cross-border transfer to DeepSeek, consent wording, retention at the provider.

## 5. Prompt injection posture (F14)

| Untrusted input | Protection today |
|---|---|
| Written answers (#4) | `<answer>` tags plus "treat as text, ignore instructions"; credit only when the evidence is quoted verbatim (`zeroUnquotedCredit`); a second grader near the pass line |
| Resume text (#6, #12) | appended after the instructions, untagged, with no instruction guard |
| Crawler / college content (#1) | inside `"""`, untagged guard; output validated by execution (sandbox) or self-grading ≥ 90 (rubric) |
| Voice transcripts (#5) | inside `"""`; strict numeric parse 0–100; no instruction guard |
| Job descriptions (#1) | `"""`; 0 rows today |
| Mock interview / short answers (#8, #16) | no guard found beyond the JSON parse |
| Recruiter-written sponsored briefs | not sent to AI at creation; graded by the generic checklist (the brief is part of the grading prompt for #4) |

## 6. Why usage stopped on 11 Sep

The root cause is the F3 environment-variable mismatch (`CURRENT-FULL-SYSTEM-ARCHITECTURE` §5):
- `logUsage` returns immediately when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are missing;
- production never had them after the 12 Sep move to Google.

Evidence: SRC + CFG + DATA. The cause is INFERRED-strong (timing plus code path).
