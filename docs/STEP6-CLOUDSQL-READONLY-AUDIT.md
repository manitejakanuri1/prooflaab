# Step 6 — Cloud SQL read-only audit (staging)

| | |
|---|---|
| Timestamp | 2026-09-30 04:50:56 UTC (10:20 IST), from the database's own `now()` |
| Environment inspected | **Staging only**: Cloud SQL instance `prooflab-508214:asia-south1:prooflab-staging-db`, database `prooflab`, PostgreSQL 17.11. Production was **not** touched or queried. |
| Expected state (GitHub) | `manitejakanuri1/prooflaab`, branch `work/step6j-release-gates`, commit `25a26e5d4bb590ee18a9581e3419c03a23cd4f71`. The migration files are byte-identical at the current head `a16aab2` (`git diff 25a26e5 a16aab2 -- migration` is empty). |
| Method | The existing Cloud Run job `prooflab-staging-inspect4` (`postgres:17`, connects with the Secret Manager secret `prooflab-staging-db-uri`, never printed), run **once** with a one-off `--args` override. The job's saved settings were not changed. Execution **`prooflab-staging-inspect4-6mdlf`**. |
| Read-only guarantees | 1. `PGOPTIONS='-c default_transaction_read_only=on'` (the session refuses writes). 2. The whole script is `begin transaction read only; … rollback;`. The output confirms `transaction_read_only = on`, `default_transaction_read_only = on` and ends with `ROLLBACK`. Only SELECT and catalog functions were used. There was no INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, GRANT, REVOKE, migration, deploy, or Cloud Run or Cloud Tasks change. |
| Privacy | Output contains structure, function source, privileges and **counts**. The only IDs printed are the 4 rows whose file path is outside their own folder (row id, student id, first path segment, date). No transcripts or personal data. |
| Evidence files | `STEP6-CLOUDSQL-READONLY-AUDIT.sql` (every query) and `STEP6-CLOUDSQL-READONLY-AUDIT-output.txt` (raw output), next to this report |

---

## Part 1 — GitHub migrations (expected)

| File | What it defines |
|---|---|
| `41-transcription-jobs.sql` | Transcription columns + UNIQUE key + partial index; claim/complete/fail **without** lease tokens; grants to service_role |
| `42-transcription-jobs-hardening.sql` | `transcription_lease_token`. Lease-token versions of claim/complete/fail (claim returns the token; complete/fail require it). `reap_stale_transcription_jobs`. **Revoke from PUBLIC/anon/authenticated, grant service_role.** Revoke UPDATE on the table from anon/authenticated. |
| `43-transcription-durable-recovery.sql` | `_enqueued_at`, `_reap_claimed_at`, `_reap_attempts`; drops `reap_stale_…`; `claim_transcription_recovery` (service_role); `guard_voice_explanations_insert()` + BEFORE INSERT trigger. The production script `step6y-…43…` has the same logic, plus a revoke of PUBLIC EXECUTE on the guard function. |
| `44-voice-scoring-claim.sql` | `scoring_claimed_at`; `claim_voice_scoring(uuid,int)` returning **boolean** |
| `45-voice-scoring-lease-token.sql` (**original, known defects**) | `scoring_lease_token`; claim returns `(claimed, lease_token)`; complete/fail require the token. **No** TTL check, **no** score-range check, **no** "already scored" protection. |
| `step6dd-migration-45-production-execution.sql` (**corrected 6DD**) | Same signatures, plus: claim refuses `_claim_ttl_seconds` NULL or < 1; complete refuses a score that is NULL or outside 0–100, and only updates rows where `status <> 'scored'`; fail only updates rows where `status <> 'scored'` |
| `47-production-voice-explanations-update-revoke.sql` | `revoke update on public.voice_explanations from authenticated, anon` |

## Part 2 — Columns (query Q1)

| Column | Live type / null / default | Expected (migration) | Match |
|---|---|---|---|
| transcription_status | text, NOT NULL, `'completed'` + CHECK pending/processing/completed/failed | 41 | ✅ |
| transcription_claimed_at | timestamptz, null | 41 | ✅ |
| transcription_attempts | integer, NOT NULL, 0 | 41 | ✅ |
| transcription_error | text, null | 41 | ✅ |
| transcription_idempotency_key | text, null, **UNIQUE** (`…_key`) | 41 | ✅ |
| transcription_lease_token | uuid, null | 42 | ✅ |
| transcription_enqueued_at | timestamptz, null | 43 | ✅ |
| transcription_reap_claimed_at | timestamptz, null | 43 | ✅ |
| transcription_reap_attempts | integer, NOT NULL, 0 | 43 | ✅ |
| scoring_claimed_at | timestamptz, null | 44 | ✅ |
| scoring_lease_token | uuid, null | 45 | ✅ |
| storage_path | text, NOT NULL, no default | original schema | ✅ (no ownership CHECK — see Part 6) |
| status | text, NOT NULL, `'recorded'` + CHECK recorded/scored/failed | original schema | ✅ |
| communication_score | integer, null, **no range CHECK** | original schema | ✅ (the 0–100 range is enforced only by 6DD's function) |
| communication_notes | text, null | original schema | ✅ |

The partial index `voice_explanations_transcription_status_idx` (pending/processing) is present (41).

## Part 3 — Live function definitions (Q3 summary, Q4 EXECUTE, Q5 full `pg_get_functiondef`)

"Body" = `md5(prosrc)` on staging, compared with the body in each repository file (round-7 matcher,
`staging-function-version-match.txt`), **and** read line by line from Q5.

| Function | Signature / return | SECURITY DEFINER | search_path | Owner | EXECUTE | Body matches | Verdict |
|---|---|---|---|---|---|---|---|
| claim_transcription_job | `(_id uuid, _stale_after_seconds int=180)` → `TABLE(id, student_id, storage_path, task_id, attempts, lease_token)` | yes | public, pg_temp | postgres | service_role only (anon f, authenticated f, no PUBLIC) | **42** (= step6u combined) exactly | ✅ matches 42 |
| complete_transcription_job | `(_id, _lease_token, _transcript, _segments=null, _word_count=null)` → boolean | yes | public, pg_temp | postgres | service_role only | **42** exactly | ✅ |
| fail_transcription_job | `(_id, _lease_token, _error, _terminal=true)` → boolean | yes | public, pg_temp | postgres | service_role only | **42** exactly | ✅ |
| claim_transcription_recovery | `(_stale 180, _grace 20, _reap_ttl 60, _max_reap 8)` → `TABLE(id, storage_path, kind, attempt)` | yes | public, pg_temp | postgres | service_role only | **step6y** exactly (the same logic as 43; differs only in comments) | ✅ |
| guard_voice_explanations_insert | `()` → trigger | yes | public, pg_temp | postgres | service_role only (**no PUBLIC** = the step6y fix) | **step6y** exactly | ✅ |
| claim_voice_scoring | `(_id uuid, _claim_ttl_seconds int=120)` → `TABLE(claimed boolean, lease_token uuid)` | yes | public, pg_temp | postgres | service_role only | **ORIGINAL 45** exactly (`8246246…`); **no TTL check** | ❌ not 6DD |
| complete_voice_scoring | `(_id, _lease_token, _score int, _notes text)` → boolean | yes | public, pg_temp | postgres | service_role only | **ORIGINAL 45** exactly (`ed6fa70…`); no range check, no `status <> 'scored'` | ❌ not 6DD |
| fail_voice_scoring | `(_id, _lease_token, _notes=null)` → boolean | yes | public, pg_temp | postgres | service_role only | **ORIGINAL 45** exactly (`ab4cf7b…`); no `status <> 'scored'` | ❌ not 6DD |

`reap_stale_transcription_jobs` does not exist (correct: 43 drops it). `prooflab_app` does not exist
on staging (it is the production application role).

## Part 4 — Triggers (Q6)

| Trigger | Timing / event | Function | Enabled | Can modify |
|---|---|---|---|---|
| **guard_voice_explanations_insert** | **BEFORE INSERT**, FOR EACH ROW, on `public.voice_explanations` | `guard_voice_explanations_insert()` | O (origin/enabled) | Yes. For non-service inserts it **forces** `transcript_source='browser'`, `status='recorded'`, `communication_score/notes = NULL`, `transcription_status='completed'`, and **nulls the idempotency key**, lease token, claim and reap fields. It does **not** touch `storage_path`. ✅ as designed |
| protect_voice_explanations | BEFORE UPDATE, per row | `protect_columns('communication_score','communication_notes','status','transcript')` | O | For an `authenticated` non-admin JWT it **restores the old values** of those 4 columns. It is a no-op for service_role, for direct DB access, or when `app.system_write=on`. It does not touch transcription fields or `storage_path`. |
| voice_explanations_activity | AFTER INSERT | `activity_from_voice()` → `log_activity(...)` | O | No column changes (writes an activity log) |
| voice_explanations_record_activity | AFTER INSERT | `on_voice_recorded()` → `record_activity(...)` | O | No column changes |

The last three triggers come from earlier (pre-Step-6) migrations. None of them changes `storage_path`
or the transcription fields.

## Part 5 — RLS and privileges (Q7)

- RLS **enabled**: true. **FORCE RLS: false** (the owner `postgres` bypasses RLS, which is normal).
- Policies:
  - `voice_own_read`: SELECT to authenticated, own rows or admin.
  - `voice_own_insert`: INSERT to authenticated, `with check student_id = auth.uid()`.
  - `voice_own_delete`: DELETE to authenticated, own rows.
  - There is **no UPDATE policy** and no policy for anon.
- Table privileges (`has_table_privilege`):

| Role | SELECT | INSERT | **UPDATE** | DELETE | TRUNCATE | REFERENCES | TRIGGER |
|---|---|---|---|---|---|---|---|
| anon | t | t | **f** | t | t | t | t |
| authenticated | t | t | **f** | t | t | t | t |
| service_role | t | t | t | t | t | t | t |
| prooflab_app | — (role does not exist on staging) | | | | | | |

  **UPDATE is revoked** from anon/authenticated (42/47 hold). There are no column-level UPDATE grants
  either (the `COLPRIV-UPDATE` query returned no rows). Note: TRUNCATE/REFERENCES/TRIGGER remain for
  anon/authenticated. RLS does not govern TRUNCATE. PostgREST cannot issue TRUNCATE, so it is not
  reachable through the API. GitHub never revokes these, so this is a gap in both, **not** a
  GitHub-vs-staging mismatch.
- EXECUTE on the 8 Step 6 functions: **service_role only**. anon = false, authenticated = false, and no
  PUBLIC entry in any of their ACLs. Students cannot call them. ✅

## Part 6 — Storage path ownership gap (confirmed)

The live `guard_voice_explanations_insert()` (Q5) checks **task_id** and **proof_id** ownership only.
It has **no check that `storage_path` starts with `student_id || '/'`**, and there is no table CHECK
for it either. Combined with `voice_own_insert` (which checks only `student_id = auth.uid()`), a
signed-in student can insert their own row naming another student's file path. The files-service
folder rule still stops them downloading it.
**→ Confirmed database integrity gap.** Not fixed. The repository has the same gap (GitHub = staging here).

## Part 7 — Which scoring implementation staging has

| Question | Live staging | Original 45 | 6DD corrected |
|---|---|---|---|
| claim returns boolean, or `(claimed, lease_token)`? | `TABLE(claimed boolean, lease_token uuid)` | same | same → **not "44 only"** |
| claim rejects TTL < 1? | **No**: no check; `now() - make_interval(secs => _claim_ttl_seconds)` with 0 or negative makes every live claim look stale | No | **Yes** (raises) |
| complete prevents overwriting an already-scored row? | **No**: `where id = _id and scoring_lease_token = _lease_token` only | No | **Yes** (`and status <> 'scored'`) |
| complete validates the score is 0–100? | **No** | No | **Yes** (raises) |
| fail prevents a late failure turning a scored row into failed? | **No**: fail sets `status='failed'` for the matching token even after scoring, and **keeps the score** | No | **Yes** (`and status <> 'scored'`) |

**Result:** staging runs the **original migration 45** (bodies match it exactly), not the corrected
Step 6DD version. This agrees with `migration/step6dd-staging-rehearsal-2026-09-28.txt`. There the
exact 6DD production script **aborted by design** at its pre-check on staging ("already past migration
44 … refusing to drop and recreate"), and a throwaway schema reproduced all four defects.

## Part 8 — Data health (counts only, Q8)

| Measure | Count |
|---|---|
| voice_explanations total | **109** |
| transcription_status pending / processing / completed / failed | 0 / 0 / 98 / 11 |
| status recorded / scored / failed | 15 / 77 / 17 |
| pending with `transcription_enqueued_at IS NULL` | 0 |
| processing with `transcription_claimed_at` older than 180 s (the configured stale window) | 0 |
| `transcription_reap_attempts >= 8` (the configured/default limit) | 0 |
| server transcript completed but status still `recorded` | 0 (0 with a scoring claim) |
| `storage_path` NULL or empty | 0 |
| suspicious path (`..`, `//`, leading `/`, whitespace, more than one folder level) | 0 |
| `storage_path` not starting with `student_id/` | **4**: `99999999-0006-…-000000000001/2/3` (path folder `fake`, 2026-09-25 fixtures) and `6fbf2d96-53c0-49af-b824-893816374919` (student t16, file in t07's folder: the deliberate `g1_access_test.py` "other_browser" fixture, created with the service role) |
| score outside 0–100 / scored without score / score present but not scored | 0 / 0 / 0 |

Nothing is stuck in the pipeline. No row currently shows the damage the original 45 permits
(no out-of-range score, and no "failed" row that still carries a score).

## Part 9 — GitHub vs Cloud SQL

| Area | GitHub expected | Cloud SQL actual | Match | Severity | Why it matters |
|---|---|---|---|---|---|
| 41 transcription schema | columns, UNIQUE key, partial index, status CHECK | all present, same types and defaults | ✅ Match | — | — |
| 42 privilege hardening | lease-token claim/complete/fail; service_role-only EXECUTE; no PUBLIC; UPDATE revoked | bodies = 42 exactly; service_role only; no PUBLIC; UPDATE false | ✅ Match | — | — |
| 43 durable recovery | columns + `claim_transcription_recovery` (service_role) | present; body = step6y (same logic as 43) | ✅ Match | — | — |
| 43 insert guard | BEFORE INSERT trigger forcing safe values; PUBLIC EXECUTE revoked (step6y) | exact step6y body; trigger BEFORE INSERT per row, enabled; no PUBLIC | ✅ Match | — | — |
| 44 scoring claim | `scoring_claimed_at`; boolean claim (superseded by 45) | column present; claim is 45's TABLE version | ✅ Match (superseded as intended) | — | — |
| **45 scoring lease behaviour** | **corrected 6DD**: TTL ≥ 1, score 0–100, saved score final, no late fail after scoring | **original 45**: none of the four protections | ❌ **Mismatch** | **High** | Staging tests exercise scoring code production doesn't run, and staging permits score overwrite, scored→failed, TTL takeover and out-of-range scores |
| 47 UPDATE revoke | no UPDATE for anon/authenticated | UPDATE false for both, no column grants | ✅ Match | — | — |
| storage_path ownership | not enforced in GitHub either (N3 is a proposal only) | not enforced | ✅ Same gap in both (**not** a mismatch) | Medium (integrity) | A student could insert a row pointing at another student's file path; the audio stays protected by the files-service folder rule |
| extra table privileges (TRUNCATE/REFERENCES/TRIGGER for anon/authenticated) | never revoked in GitHub | present | ✅ Same in both (**not** a mismatch) | Low | Not reachable through PostgREST; unnecessary privilege |

## Part 10 — Root-cause decision

**Classification: B — Cloud SQL is behind GitHub.** Specifically, the corrected Step 6DD migration 45
was never applied to staging. Everything else (41, 42, 43 and its guard, 44, 47) matches GitHub exactly,
body for body. The storage-path and privilege gaps are **shared** by GitHub and staging, so they are not
mismatches.

### The FIRST root cause to fix
1. **Exact mismatch:** staging's `claim_voice_scoring`, `complete_voice_scoring` and `fail_voice_scoring` are the **original migration 45** bodies. They are not the corrected Step 6DD bodies in `migration/step6dd-migration-45-production-execution.sql`.
2. **Exact evidence:**
   - Q3: `md5(prosrc)` = `8246246163ba025bed98c67738005a63`, `ed6fa7097e73b92ec563559135fb770c` and `ab4cf7b84cbc46ba2de5ab1dbd20dd48`. These equal the original `45-voice-scoring-lease-token.sql` bodies and not the 6DD bodies.
   - Q5 (full definitions): no TTL check in claim; no range check and no `status <> 'scored'` in complete; no `status <> 'scored'` in fail.
   - This agrees with the 2026-09-28 staging rehearsal log, where the 6DD script aborted at its pre-check on staging.
3. **Why it can cause recording problems:**
   - After the transcription worker hands a recording to `voice-score` (and `transcription-reap` re-scores stale ones), staging's scoring functions allow:
     - a second completion to **overwrite a score the student already saw**;
     - a late failure (the same lease) to flip a **scored** recording to `failed` while keeping the number. The app then hides the score (`scoreToShow` shows a number only for `scored`), so the student sees "not scored" for a recording that was scored;
     - a zero or negative TTL to let a second scorer **take over a live claim**, giving duplicate AI calls and costs;
     - scores outside 0–100.
   - And because production runs the corrected version, **any recording or scoring test done on staging tests different database logic from production**, so a staging pass or failure does not predict production.
   - No damaged rows exist on staging today (Part 8), so this is a risk and a test-validity problem, not an incident found in the data.
4. **Staging-only or production?** **Staging-only**, as far as the records show: `docs/STEP6-HANDOFF.md` records the owner applying the 6DD script in production on 2026-09-28 and 22/22 verification checks passing. Production was **not** queried in this audit, so that remains the owner's verification, not re-verified here.
5. **Safest proposed correction (NOT applied):**
   - Write a **staging-only** script that replaces just these three functions with the exact 6DD bodies:
     - same signatures, so no DROP is needed (the return types already match);
     - the same `revoke … from public, anon, authenticated` / `grant … to service_role`.
   - Its fail-closed self-check, inside the same transaction, must confirm that the three new `md5(prosrc)` values equal the 6DD bodies, that EXECUTE is service_role only, and that the four behaviours hold (tested in a savepoint, then rolled back).
   - Run it only after a staging backup.
   - Then run the existing read-only `step6dd-migration-45-production-verify-readonly.sql` against staging: rows 18–21, which today are expected false on staging, must become true.
   - The production script cannot be reused as-is on staging, because it deliberately refuses a database that already has 45.
   - Needs your approval. **Not done.**

## Part 11 — Still unverified
- Production (not queried): 6DD and grants there are the owner's 2026-09-28 verification.
- The behaviour of the four defects on the **live** staging functions was read from their code and matches the earlier throwaway-schema reproduction. It was not re-executed live, because that would need writes.
- `storage_path` gap exploitation (a real signed-in insert) was not attempted; it would need a write.
- Migration 46 objects were not inspected (out of scope, on hold).
- `accept_voice_consent` is still callable by anon (seen in the round-7 audit); its effect is untested.
- Whether the deployed functions and worker images correspond exactly to GitHub (they are probably built from `58c7368` and `3a93b0c`; images record only a build time).

This audit does not make Step 6 complete and is not a production-readiness statement.
