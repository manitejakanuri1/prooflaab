# G01 — production database audit: verification (1 Oct 2026)

Source: `docs/closure/prod-audit-output.txt` (owner command 1, run by the owner; 84 result lines,
`END`, `__EXIT=0`; temporary job `prooflab-prod-readonly-audit` confirmed deleted). Query text:
`docs/closure/PROD-READONLY-AUDIT-2026-09-30.sql`.

**Result: G01 PASS.** Zero unexplained anomalies. Two items needed explaining (O2, S0norls) and
were checked read-only; one hygiene note (table grants) is recorded as accepted P3.

| Line(s) | Check | Result | Verdict |
|---|---|---|---|
| S0 | Session | db `prooflab`, user `prooflab_app`, **read-only = on**, PostgreSQL 17.11 | OK |
| S0db/S0conn | Size / connections | 40 MB; 15 of 50 connections, 1 active | OK |
| S0rls/S0norls | Row security | 89 tables on, 0 forced, 1 off: `skill_aliases` | Explained below |
| A1–A2 | Migration 48 column + check | `text`, nullable; only the 8 runner languages allowed | OK |
| A3 | `rubric_task_view` | contains `scratch_language`; EXECUTE only `prooflab_app` + `authenticated` (not anon) | OK |
| A4, A7 | scratch_language values | 34 NULL, 1 python; invalid values 0 | OK |
| A5 | Generic fallback config | `374ba74e…` scratch_language NULL, origin `auto_fallback` | OK |
| A6 | Python Lot config | `ad5f2c83…` = python, not the fallback, origin `auto` | OK |
| A8 | Origins | auto 29, manual 5, auto_fallback 1 (only the fallback itself; no scratch copies exist) | OK |
| B1 | All submissions | 8 total: 5 coding passed, 2 written failed, 1 written passed | OK |
| B2 | Test student (smoke01) | 7 submissions: 5 coding passed 100/+10 XP, 2 written failed 0; **scratch code never stored in written answers** (`has_scratch_code` = f) | OK |
| B1 vs B2 | Non-test submissions | exactly 1 (a real student's written pass, 30 Sep 10:55 from the preview, before any release work) | OK, matches earlier report |
| C1–C2 | `record_task_submission` | SECURITY DEFINER, pinned search_path, EXECUTE only `prooflab_app` + `service_role`; returns `passed` and `status` | OK |
| D1 | Voice rows | 2, both completed / scored / server | OK |
| D2 | Stale or stuck voice jobs | none | OK |
| D3 | Rows near retry limits | 0 / 0 | OK |
| D4 | Transcript without score | none | OK |
| D5 | Score without transcript | 0 | OK |
| D6 | Score without provenance | 0 | OK |
| D7 | Duplicate live claims | 0 | OK |
| D8 | Test student recording | completed, scored 70, server, 1 attempt, transcript present | OK |
| F (14 functions) | Step 6 + release functions | all SECURITY DEFINER with pinned search_path; **anon EXECUTE = false for all**; server-only functions not executable by `authenticated`; only `rubric_task_view`, `recruiter_talent`, `recruiter_proof_profile` callable by signed-in users (by design) | OK |
| F: 45 | Migration 45 version | `claim/complete/fail_voice_scoring` md5 `934a30f1…`, `a1abecfb…`, `f17ce0e1…` = **byte-identical to `migration/step6dd-migration-45-production-execution.sql`** (CRLF, as pasted in Cloud SQL Studio). Production runs the corrected 6DD version | OK |
| F2 | SECURITY DEFINER without search_path | 0 | OK |
| F3, F4, F7 | Table grants to anon/authenticated | SELECT/INSERT/DELETE (voice), SELECT/UPDATE (rubric), INSERT/UPDATE (submissions) granted at table level | Accepted P3, see below |
| F5 | RLS on key tables | enabled on all 6, not forced | OK |
| F6 | Voice triggers | guard, protect, 2 activity triggers — all enabled | OK |
| F8 | Submission policies | one policy: SELECT for authenticated. **No INSERT/UPDATE policy**, so clients cannot write submissions; only `record_task_submission` can | OK |
| O1 | Broken links (9 checks) | all 0 | OK |
| O2 | Marking configs used by nothing | 13 | Explained below |
| O3 | Unvalidated foreign keys | 0 | OK |
| O4 | Students | 4: CSE-A 1, CSE-B 1, CSE-C 1, TEST-SMOKE 1 (smoke01) | OK |

## Explained items

- **`skill_aliases` has no row security.** It is a public lookup list (for example `py` → Python) with
  no personal data. Non-mutating probes on 1 Oct: anonymous PATCH/DELETE → 401, signed-in test
  student PATCH → 403 "permission denied for table skill_aliases". Readable, not writable. OK.
- **13 unused marking configs (O2).** Read-only listing: 4 `manual` fixtures from 11 Sep (fixed
  `22222222-0001-…` test ids) and 9 `auto` configs from 19–20 Sep whose tasks no longer exist
  (the removed test students). They are marking rules only, with no student data and nothing points
  to them. Harmless leftovers; clean-up optional (P3, needs owner approval to delete).
- **Broad table grants (F3/F4/F7), P3 accepted.** These are the old Supabase-style defaults. They
  are not effective permissions, because RLS is on and the policies decide:
  - voice: read/insert/delete only the student's own rows (`voice_own_*` policies);
  - submissions: select-only policy;
  - rubric: authorization test showed 0 rows changed.

  Anonymous reads return nothing (attack-surface test 66/66). Revoking the unused grants is a
  hygiene follow-up already listed in `docs/STEP6-BACKEND-PROPOSALS.md`.
