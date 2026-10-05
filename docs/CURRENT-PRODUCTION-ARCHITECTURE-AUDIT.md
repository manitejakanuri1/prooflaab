

## 19. Last three staging DB-security findings closed (migration 86, staging, 5 Oct 2026)

- Starting commit `714a66d`. Code commit `0b74f67`.
- Ledger: `86-close-remaining-db-findings`.
- Raw evidence (local): `e2e-out/f3/`.

| Finding | Before (MEASURED) | Fix | After (MEASURED) |
|---|---|---|---|
| **1. MEDIUM** — TRUNCATE / REFERENCES / TRIGGER | anon and authenticated each held all three on **76 of 83** public tables. Direct grants, not via PUBLIC, no role membership. A student's `truncate public.rate_limits` **succeeded** in a rolled-back transaction (1814 → 1814 after rollback) | `revoke truncate, references, trigger on all tables in schema public from anon, authenticated` | **0 tables** for both roles. The student's TRUNCATE is denied (`42501`). service_role (81) and postgres (83) unchanged. SELECT / INSERT / UPDATE / DELETE unchanged. Future tables are still closed by default (83; checked in 86) |
| **2. LOW** — `student_credits` self-entitlement | policies `own_read`, `own_insert`, `own_update`; `protect_student_credits` guards UPDATE only. A student's own INSERT of 99,999 credits / premium **succeeded** (rolled back). 0 rows; no code reads or writes the table | insert and update policies dropped; INSERT / UPDATE / DELETE revoked from authenticated; anon nothing; own-row SELECT kept | API: the student's POST is 403 and no row is created; the student's PATCH is 403 with no change; the backend can insert (201) and update (200); the student can read their own row; the test row is removed and the table is unchanged |
| **3. LOW** — `review_task_submission` status oracle | answered "no such submission" / "not awaiting review" **before** authorization, to every caller, even **anonymous** (PUBLIC execute). Measured for student A, wrong college, owning college, admin and random ids | authorize first; strangers always get `forbidden`; only an admin can learn a submission does not exist; anonymous execute removed; review body (XP, completion, activity, daily-Lot effects) unchanged | anonymous 401. Student A, wrong college, company, random ids → `forbidden`. Owning college and admin → `not awaiting review`. Admin + random id → `no such submission`. Needs-review submission probed by strangers → `forbidden`, nothing changed. Admin approve and owning-college reject still work (rolled back; status restored) |

**Permanent gates:**
- `staging_rpc_authz_check.py` 22 checks. New: effective rights over every public table, backend still reads every table, credits ownership.
- `staging_d4_behaviour_check.py` 12 checks. New: credits attack plus backend control; 12 review answers compared by body, not status code.

**Observation, not part of this task:** authenticated still holds `MAINTAIN` on public tables (PostgreSQL 17 `m`: VACUUM / ANALYZE / LOCK through direct SQL only, not reachable through the API). LOW, for a later decision.

**Regression (MEASURED):**
- `FINAL STAGING RELEASE GATE [NOLOAD]: PASS (commit 0b74f67, 2026-10-05T07:47Z)`, exit 0, 29 / 29. The two load steps were not run; this is **not** a capacity result.
- D1 regression 10/10.
- CI on `0b74f67`: test / code-runner / artifact-handoff = success, **deploy = skipped**.

**Staging HTTP during this task** (05:00–07:47 UTC):
- **4xx:** 204 × 400, 335 × 401, 85 × 403, 109 × 404, 3 × 409. These are the security gates' own refusal probes:
  - 401 / 403 / `PGRST202` 404: server-only / SQL-internal / revoked functions;
  - 400 `P0001`: guarded functions saying no.
  - The 409s: the voice test's duplicate-upload / already-queued checks.
- **5xx (46):**
  - 31 × voice worker: application retries of fixture recordings with no audio file (storage 404);
  - 8 × `admin_users`: the gate's DELETE probes;
  - 6 × pgcrypto: dummy input from the anonymous sweep;
  - 1 × `scheduled-job`: the deliberate daily-Lots failure case.

**Production:** 0 errors; not touched.

**Conclusion:** the final three known staging DB-security findings are closed. Staging DB security is clean under the current audit. Capacity, evaluator correctness, restore rehearsal, transcriber architecture and production security remain separate phases.
