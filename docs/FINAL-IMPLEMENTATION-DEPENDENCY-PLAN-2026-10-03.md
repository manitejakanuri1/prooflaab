# Final implementation dependency plan — RECOMMENDATION ONLY (3 Oct 2026)

Nothing here has been executed. Every wave follows the same steps:
1. plan;
2. owner "yes";
3. branch;
4. staging;
5. evidence;
6. production with approval;
7. verification.

The order comes from the dependencies found in the discovery, not from the request's example list.

## Wave 0: Baseline and safety net (prerequisite for everything)

| # | Item | Why first |
|---|---|---|
| 0.1 | Tag `d736e4d`; freeze feature work | rollback anchor |
| 0.2 | Protected test college with test student, company and admin logins that the team does not touch (N1, N19) | every later proof needs them; bug finder and healthcheck are blind now |
| 0.3 | Fix the deep bug-finder trigger permission (N26) | restores the AI-journey canary |
| 0.4 | Staging probe for **N20** (GET/PATCH own `resume_assessments`) and F8/F9 (fork, memory, egress on the staging runner) | settles U10, U2, U3 before prioritising |

## Wave 1: Cheap, high-value hardening (no product change)

| # | Item | Depends on |
|---|---|---|
| 1.1 | **F3**: `llm.ts` / `rate-limit.ts` / `audit.ts` via the `backend.ts` client; fail loudly; alert on silent `llm_usage` | 0.2 |
| 1.2 | AI call timeouts (F14 part) | — |
| 1.3 | **N20** fix: move answer keys and hidden tests off the student-writable row, or restrict column grants | 0.4 |
| 1.4 | **N21**: redact hidden tests in `resume-code-execute` | — |
| 1.5 | **F10**: disable public runner fallbacks in production (return "busy") | — |
| 1.6 | **F6**: delete ceiling + dry run + alert | — |
| 1.7 | **N25 / F7**: restrict `/password-link`; constant-time compare everywhere | — |
| 1.8 | **F4**: server-side verified-email check in import and the bridge | 0.2 |

## Wave 2: Dead code (zero behaviour change)

| # | Item | Depends on |
|---|---|---|
| 2.1 | Delete the 30 orphan/unreachable files and the realtime subscriptions on `proof_uploads` / `conceptual_tests` | 0.1; bundle-diff proof |

## Wave 3: Product decisions (owner)

Required voice after Submit; one recording per task; length gate; Lot personalisation; GitHub/LinkedIn links; `/recruiter/:linkId`; migration 46; Recruiter = Company naming; whether to keep roadmap tasks, mock interview and coding streaks.

Waves 4, 6 and 7 depend on this.

## Wave 4: Modern replacements (unblock legacy removal)

| # | Item | Depends on |
|---|---|---|
| 4.1 | **L1 + N24**: company Submissions, Stats, Activity and `recruiter_lots` read `task_submissions` + voice | 3 (naming) |
| 4.2 | Recruiter = Company: one org entity, one role, one Work system (Lots + Submissions + Review) | 4.1, 3 |
| 4.3 | Admin current review queue (flags from `task_submissions`), admin stats on current tables | — |
| 4.4 | Build-log Entries = `task_submissions` + voice; Portfolio from passed work | 3 |
| 4.5 | Squad names RPC (N3); "Your tasks" moved into the Roadmap (N7) | 3 |

## Wave 5: Coding evaluation engine (can run in parallel with Wave 4)

| # | Item | Depends on |
|---|---|---|
| 5.1 | Code-runner tests + F8 / F9 fixes + internal ingress (N10) | 0.4 |
| 5.2 | Test-quality validator (distinct inputs, known-wrong solution) inside `auto-config` (N23) | 5.1 |
| 5.3 | Route the resume coding round through the shared engine (validated, versioned, redacted) (N22) | 1.3, 1.4, 5.2 |
| 5.4 | Sponsored / company coding Lots through the engine instead of the generic checklist | 4.2, 5.2 |
| 5.5 | AutoTestCase concepts (edge-case taxonomy, size-scaled counts, post-execution failure reasons) inside `auto-config` | 5.2 |

## Wave 6: Question quality and Lot pipeline

| # | Item | Depends on |
|---|---|---|
| 6.1 | Wording contract validator (N30) between generation and save | — |
| 6.2 | Lot pre-generation after the crawl (queue), not from the student's browser | 6.1 |
| 6.3 | Set `grading_mode_hint` at ingest; review the keyword heuristic | 6.2 |
| 6.4 | Crawler: discovery within scope, job sources (API / college JDs), "0 new" alert; legal review of sources | owner/legal |
| 6.5 | Personalised Lot order (N6) | 3 |

## Wave 7: Voice integrity

Required voice after Submit, one per task, length gate (N4/N5); score against the submission; write-once audio (F11); retire the browser path and decide migration 46 (F12); measure language accuracy (F13).

Depends on: 3, 4.4.

## Wave 8: Legacy retirement (strict order)

1. Remove the visible legacy UI (L2/L3).
2. Remove the 9 slugs + `/ready` + authz list (L6).
3. Rewrite the DB readers (`form_squads`, leaderboard, `tpo_students`, compat branches) (L7).
4. Drop the legacy RPCs, triggers, tables and `trust_score` after a backup.
5. Clean storage orphans (N2, D5).

Depends on: 4.x, 7.

## Wave 9: Trust model (architecture)

F1 (asymmetric signer, service identity) and F2 (caller-token default, narrow definer RPCs).

Depends on: 1.1 (logging working), 8 (fewer functions to migrate), full authz matrix (0.2).

## Wave 10: Pipeline, schema, infra

F16 (build once, test, deploy; backends in CI), F17 (one migration folder + applied table), F18 (IaC), docs refresh (contradiction list).

Can start in parallel from Wave 2. It must finish before Wave 11.

## Wave 11: Performance and scale

Staging load 100 → 250 → 500 (F21, U6) with seeded recruiter search; daily-job fan-out; pool sizing; recruiter search pre-aggregation; transcriber tuning.

Depends on: 4, 5, 9 (final shapes).

## Wave 12: Release-candidate rehearsal and controlled rollout

Gates from `TESTING-OBSERVABILITY-RELEASE-EVIDENCE-MAP` §7; per-change owner approval.

## Parallel workstreams

| Stream | Waves | Can run in parallel with | Must not overlap with |
|---|---|---|---|
| A. Safety / security quick wins | 0, 1 | everything | — |
| B. Product/data cleanup | 2, 4, 8 | C, E | 9 (both touch functions; sequence 8 before 9) |
| C. Coding evaluation | 5 | B, D | 1.3 / 1.4 must land first |
| D. Lot / question quality | 6 | B, C | — |
| E. Voice | 7 | C, D | 4.4 (Build-log) must land first |
| F. Infra / CI / schema | 10 | all | migrations in B / 8 must use the new folder once it exists |
| G. Performance | 11 | — | runs after B, C, 9 |
