# Target system architecture — RECOMMENDATION ONLY (3 Oct 2026)

This is **not current reality**. Current reality is in `CURRENT-FULL-SYSTEM-ARCHITECTURE-2026-10-03.md`. Nothing here is built.

It is derived from:
- the owner's product intent;
- what the current-state discovery shows is already sound.

## 1. Principles

1. Keep what works. Async voice with leases, Cloud Tasks, the separate code runner (concurrency 1), crawler → `source_content`, Lot template reuse, Deno/TypeScript functions, Cloud SQL and Cloud Storage are good foundations (see the dossier §Good).
2. **Simple on top, complex underneath.**
   - Student: Floor · Build-log · Squad · Profile.
   - TPO: Home · Students · Squads · Insights.
   - Recruiter (organisation = Company): Home · Talent · Shortlist · Lots · Submissions · Review.
3. `task_submissions` is the single source of student work. Old Proof/Trust is retired.
4. **Execution, not AI, decides coding results.** AI may draft tests; only real runs validate and grade.
5. Heavy or slow work is asynchronous. A student never waits on generation.
6. Every AI call is metered, capped, timed out and logged.

## 2. Target diagram

```mermaid
flowchart TB
  subgraph Edge
    SPA[SPA: 4 student areas / 4 TPO / 6 recruiter / admin ops]
  end
  IDP[Identity Platform] --> BR[auth-bridge: ONLY signer<br/>asymmetric key, short TTL, verified-email claim]
  SPA --> BR
  SPA -->|ticket| API[PostgREST: verifies public key; RLS]
  SPA -->|ticket| FN[functions: caller token by default;<br/>narrow definer RPCs; no minted service_role]
  FN -->|Cloud Run identity / OIDC| CR[Code runner: internal ingress,<br/>per-run sandbox, kill group, RLIMIT_AS, no egress]
  FN --> EVAL[Shared evaluation engine<br/>generate → validate (reference + known-wrong) → versioned config → grade by execution → redact]
  EVAL --> CR
  subgraph Content
    CRAWL[Crawler / research agent<br/>seed + discovery, rights per source] --> SC[(source_content<br/>+ grading_mode_hint set at ingest)]
    JOBS[(job_opportunities<br/>job API / college JDs)] --> GEN
    SC --> GEN[Lot generator (queue, after crawl)<br/>wording contract + test-quality validator]
    GEN --> LT[(lot_templates versioned)]
  end
  LT --> FLOOR[Daily Lot (personalised order)]
  FLOOR --> SUB[(task_submissions)]
  SUB --> VREQ[Required voice after Submit<br/>one per task, length-gated]
  VREQ --> Q[(Cloud Tasks)] --> WK[worker] --> TR[Whisper (model per language)] --> VS[voice-score: compares to the submission]
  VS --> BL[Build-log = task_submissions + voice]
  BL --> TPO[TPO insights] & REC[Recruiter Talent / Submissions / Review]
  subgraph Ops
    AIGW[AI gateway in llm.ts: timeout, per-user cap, usage rows, cache — via backend.ts]
    MON[Alerts: AI usage silent, removals spike, crawler 0-new, trigger failures]
    IAC[Terraform / IaC for Run, Scheduler, Tasks, IAM, buckets]
  end
```

## 3. Target per subsystem (and the gap it closes)

| Subsystem | Target | Closes |
|---|---|---|
| Auth | The bridge is the only signer, with an asymmetric key. Services use Cloud Run identity. A separate file-grant key. Server-side verified-email checks in import and the bridge | F1, F2, F4, F5 |
| Rate / cost | `llm.ts`, `rate-limit.ts` and `audit.ts` use the `backend.ts` client. Startup fails if they cannot write. Timeouts on every provider call. An alert when `llm_usage` is silent | F3, F14 (timeouts), F20 |
| Crawler → Lot | Seed lists plus discovery within `path_scope`; job sources via APIs or college JDs. `grading_mode_hint` set at ingest by rule plus human/AI tag. **Lots pre-generated after each crawl through a queue**, not by the first student's browser | crawler gaps, seed-card exposure |
| Question quality | Wording contract: Title, Context, Your task, Input, Output, Constraints, Example + explanation, Starter code. Reject "file", "attached" or "below" references without material; reject fabricated first-person premises | N30 |
| Coding evaluation | **One engine** for Daily Lots, Sponsored Lots, resume round and calibration. AI drafts candidate tests (AutoTestCase-style edge-case categories, size-scaled counts). **Validated** against the reference solution and ≥ 1 known-wrong solution. Distinct-input check. Versioned test sets stored on the submission. Hidden tests redacted everywhere. Keys never on student-readable rows | N20–N23, F10 |
| Code runner | Internal ingress plus OIDC. Kill the process group or uid after each run (or a fresh sandbox per run). `RLIMIT_AS`. Egress denied. No public fallbacks in production ("busy" instead). A runner test suite | F8, F9, F10, N10 |
| Written grading | Keep the quote-checked rubric with a second grader near the line. System/user separation. Resubmit cap. Similarity also on the generic checklist | F14, cost |
| Voice | Required after Submit, one per task, minimum length, scored against the **submitted work**. Server transcript only. Write-once audio | N4, N5, F11, F12 |
| Build-log | Exactly `task_submissions` + `voice_explanations`, one timeline | L-items |
| Recruiter = Company | One org entity (Company) and one role (recruiter). Lots, Submissions and Review read `task_submissions` and voice. Sponsored Lots use the shared evaluation engine | L1, N24 |
| Admin | Users, colleges, companies, tasks/submissions, flagged queue, jobs/ops health, AI spend | L2 |
| Legacy | Proof/Trust/Cosigns/conceptual/LeetCode removed in dependency order | L-map |
| Data authority | `task_submissions` = work; `voice_explanations` = voice; scorecards = resume; squad tables = squad; one task-status rule | §99 conflicts |
| Accounts sync | Max-delete threshold, dry-run diff, alert before delete, soft delete, file cleanup | F6, N2 |
| Schema | One migration folder, an applied-migrations table, generated types in CI | F17 |
| CI/CD | Build once, test that artifact, deploy it; backends built and tested in CI | F16 |
| Infra | IaC for Run, Scheduler, Tasks, IAM, buckets, secrets bindings | F18 |
| Scale (15k registered) | Batch the daily job per college (queue fan-out). PostgREST pool and instances sized from staging load data. Pre-aggregated recruiter search (materialised or summary table). Transcriber capacity tuned from queue metrics | F21, U6 |

## 4. AutoTestCase role in the target (point 123)

- **No** AutoTestCase page, feature, navigation or service.
- Its useful ideas live **inside `auto-config`'s sandbox path**: an edge-case taxonomy in the prompt, a test count scaled to problem size, and a per-test failure explanation generated **after real execution**.
- AI-simulated pass/fail and AI "coverage %" are excluded.
- **No code is reused, because the repo has no licence.**

## 5. Test-case validation target (point 125, analysis)

```text
candidate tests (AI) → run reference → all pass?
                     → run ≥ 1 known-wrong solution (AI-written or mutation) → at least one test must fail
                     → distinct stdin count ≥ 3; at least one boundary case; hidden ≥ visible
                     → store test_set_version; submissions record the version
                     → grade students only by execution; redact hidden tests
```

## 6. Sync / async target (summary)

- **ASYNC:** Lot generation, roadmap, transcription, voice scoring, imports (large), notifications.
- **SYNC with timeouts:** login, Run/Submit code, written grading, resume parse and quiz.
- **SCHEDULED:** daily Lots (fanned out), squads, seasons, crawler, sync.

## 7. Gaps current → target (the main ones)

1. F1/F2 trust model (architecture change).
2. One coding evaluation engine; resume round folded in.
3. Lot pre-generation and the wording contract.
4. Recruiter = Company unification on `task_submissions`.
5. Required, content-linked voice.
6. Retire Proof/Trust.
7. Working cost controls (F3).
8. Pipeline and IaC (F16–F18).
9. Measured capacity (F21).
