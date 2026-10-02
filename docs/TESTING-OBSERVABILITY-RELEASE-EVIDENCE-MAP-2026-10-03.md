# Testing, observability and release evidence map (3 Oct 2026)

Read-only.

## 1. Test inventory (SRC)

| Mechanism | What it really tests | In CI? | Latest evidence | False-positive risk |
|---|---|---|---|---|
| Frontend unit (`node --test src/lib/*.test.ts`, 10 files) | pure helpers (voice lifecycle, written submit body, scratch, and so on) | ✔ (Node 22) | 92/92 EARLIER 2 Oct | helper tests ≠ E2E |
| Typecheck (`tsconfig.app.json`, `strict:false`) | syntax/types, loosely | ✔ | clean EARLIER | wrong columns not caught |
| ESLint | — | ✖ | about 150 errors (pre-existing) | — |
| Deno tests (11 files) | `_shared/` + `transcription-reap/` in CI; `bridge_test.ts`, `files_test.ts` not in CI | partial | 93/93 EARLIER | — |
| Python worker `test_server.py` | worker logic with fakes | ✖ | 27 passed EARLIER 29 Sep | fakes |
| Code runner tests | **none exist** | — | — | — |
| Migration self-checks (`do $$`) | per migration on apply | ✖ | rehearsed on staging | — |
| Playwright/browser scripts (15 in `scripts/dev-tools`) | specific screens | ✖ manual | various EARLIER | some used simulated servers (voice harness) |
| `healthcheck.py` (24 checks) | live core journey with the smoke student | manual | **5/6 on 2 Oct, stops early**: smoke student deleted | — |
| `attack_surface_check.py` (66) | anonymous/forged requests are refused | manual | **66/66 RUN 3 Oct** | positive paths not covered |
| `authz_matrix_check.py` | role boundaries | manual | 58/58 EARLIER 2 Oct; **cannot run fully now** (N1) | fixed 2 Oct: a 204/0-rows result had counted as denied |
| `staging_load_test.py` | browse/run/voice load on staging | manual | EARLIER 1 Oct | staging is half size |
| `staging_reaper_fixture.py` | voice recovery | manual | EARLIER | staging only |
| Bug finder light (job, 5×/day) | sign-in + dashboards for student/college/admin | scheduled | **failing since 2 Oct** (test student deleted) | — |
| Bug finder deep (daily 04:00) | AI resume journey | scheduled | **not running: trigger code 7** | — |
| `/ready` | all 40 functions imported | uptime | 40/40 RUN 3 Oct | import ≠ working |

## 2. CI/CD trace (F16, SRC)

```text
push main → GitHub Actions deploy.yml
  job test (Node 22): npm ci → unit tests → typecheck → deno test (_shared, transcription-reap) → npm run build (discarded)
  job deploy (needs test; Node 20): npm ci → npm run build (REBUILT) → scripts/deploy-hosting.py (Firebase Hosting, github-deploy SA) → verifies the entry script in index.html
backends (functions, bridge, files, accounts, runner, transcriber, worker, crawler, bug finder):
  built by hand with Cloud Build / docker, deployed with gcloud run deploy: no CI, no test gate
```

- The deployed website is **not** the artifact that was tested: it is rebuilt on Node 20.
- Backend images are not tied to commits by CI.
- Python and most Deno tests never gate anything.

## 3. Code Runner test gap (point 93)

No tests. Needed later:
- per-language hello world;
- compile error;
- runtime error;
- timeout;
- output cap;
- stdin;
- the Java class-name rule;
- fork / background-process cleanup (F8);
- memory bomb (F9);
- network egress (F9);
- the secret header;
- concurrent requests.

## 4. Cross-role E2E chains (current; where each breaks)

| Chain | Status | Breaks at |
|---|---|---|
| College import → student login → intake → resume → assessment → coding → scorecard → Daily Lot → submit → voice → Build-log → squad | each step worked EARLIER (30 Sep–2 Oct); **NOT RE-RUN** | not broken in code. Risks: F4 at import; N20 at assessment; resume tests unvalidated |
| Student → TPO (insights, profile, learning) | works EARLIER (2 Oct) | — |
| Student → Recruiter (Talent / ProofProfile) | works for aggregates EARLIER | recruiter counts browser voice too (migration 46 on hold) |
| Company "Post Task" → student submit → company Submissions | **BROKEN** | Submissions reads `proof_uploads` (L1) |
| Recruiter Sponsored Lot → student → recruiter review | **BROKEN** | the student gets a generic-checklist task; `recruiter_lots` reads `proof_uploads` (N24) |
| Admin review of current work | partial | Proof Review is legacy; Flagged shows current flags |

## 5. Observability inventory and blind spots

See `CLOUD-INFRA-IAM-COST-CAPACITY-MAP` §6. Structured logs (`_shared/log.ts`: request_id, session_id, trace), Error Reporting, Query Insights, `app_events` step trail (851 rows), `security_events` (client only), `audit_logs` (DB triggers: squads, interventions).

Missing:
- server security events and AI usage (F3);
- removal alerts (F6);
- an alert for crawler "0 new";
- an alert for the deep-run trigger;
- per-student cost.

## 6. Backup and DR (CFG + EARLIER)

| Item | Evidence |
|---|---|
| Cloud SQL daily backups, PITR on, 7 days | CFG |
| Restore drill | 9 min 28 s (G02, EARLIER 1 Oct) |
| Migration rollbacks | 45/46/49 rollback scripts, rehearsed on staging (EARLIER) |
| Storage recovery | bucket versioning + 7-day soft delete (EARLIER); no lifecycle |
| Artifact rollback | previous Cloud Run revisions retained; Hosting versions (EARLIER rollback drill, G29) |
| Identity Platform recovery | **none**: a deleted login is gone; `removed_students` keeps a snapshot only |

## 7. Proposed release gates (measurable; not executed)

| Area | Gate |
|---|---|
| Student | Scripted E2E with a protected test student: import → … → Build-log; all DB rows asserted |
| TPO | Insights/report RPCs return only own-college rows (authz matrix full pass) |
| Recruiter | Post Task and Sponsored Lot results visible from `task_submissions`; cross-role script passes |
| Admin | Current review queue lists flagged `task_submissions` |
| Security | F1/F3/F4/F8/N20/N24 closed with negative tests; attack surface 66/66; authz matrix full |
| Code Runner | runner test suite green; fork/memory/egress probes refused on staging |
| Voice | required after Submit; one per task; length gate; immutable audio; burst of 100 on staging cleared without loss |
| AI | every call has a timeout; `llm_usage` and `rate_limits` rows appear on staging and production; alert proven |
| DB | one migration folder + applied table; staging = production for 41–49 (except intentional 46) |
| 15k scale | staging 100 → 250 → 500 concurrent with recruiter search over 10k seeded candidates; p95 and error budget recorded |
| Cost | per-feature AI spend visible for 7 days; budget alert proven |
| Rollback | revision + DB PITR rollback rehearsed for each release |
