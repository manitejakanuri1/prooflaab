# Proposals waiting for the owner's approval

4 Oct 2026, commit after `0b0a1ab`. **Nothing in this document has been applied.** Each section ends with the exact question.

Tags: MEASURED · CODE · INFERRED · UNVERIFIED · OWNER DECISION REQUIRED.

---

## P1. Slow-query statistics on staging (Option A)

| | |
|---|---|
| Exact change | One SQL statement on the **staging** database: `create schema if not exists monitoring; create extension if not exists pg_stat_statements with schema monitoring; revoke all on schema monitoring from public, anon, authenticated;` |
| Flag / preload | **None needed.** `pg_stat_statements` is already in `shared_preload_libraries` (MEASURED on staging, together with `google_insights`) |
| Restart / downtime | **None.** Creating an extension that is already preloaded does not restart Postgres |
| Overhead | Statistics are already being collected by the preloaded library; the extension only exposes them (Postgres behaviour). Shared memory is already reserved at start (INFERRED). Expected CPU / storage change: negligible |
| Security / privacy | Query texts are normalised (values become `$1`). It must **not** live in `public`: PostgREST exposes `public` to `anon`, and the view is readable by PUBLIC by default. Hence a separate `monitoring` schema with access revoked |
| Rollback | `drop extension pg_stat_statements; drop schema monitoring;` (no restart) |
| Disabling later | Same; no restart |
| What it enables | Slowest queries by mean / max / total time during each load level, calls per query, and evidence for any pool / index / tier recommendation |
| Alternative | Turn on **Query Insights** for staging (instance setting `--insights-config-query-insights-enabled`). Production already has it on. Google documents this as a no-restart change (UNVERIFIED for this tier) |

**Recommendation: ENABLE** (the SQL above, staging only). Question: approve P1?

---

## P2. Coding: numeric score vs verified correctness

**Today (CODE + MEASURED):**
- `status = passed` when `score ≥ pass_threshold` (80).
- 4 of 12 subtly wrong solutions passed while a hidden test had caught the bug.

### Rule

| Term | Definition |
|---|---|
| **score** | Unchanged: `round(100 × Σ weight(passed) / Σ weight(all))`. The educational partial mark |
| **required test** | Every test whose `required` is not `false`. All tests today are required. A new optional `kind: "performance"` test is required only when the problem states limits. Optional "style" or "bonus" tests are allowed with `required: false` |
| **verified_correct** | `true` only when there was no compile error **and every required test passed**. No threshold involved, so it cannot be wrong for any configuration, whatever its weights |
| **status** | `passed` ⇔ `verified_correct` and no flags; `needs_review` if flags; otherwise `failed`. `pass_threshold` stops deciding coding outcomes (kept for written) |
| XP / Lot completion / "Verified" on profile and for companies | only when `verified_correct` |
| Partial result shown to the student | e.g. "83/100, not yet correct: 1 of 6 tests failed (a hidden edge case)" |

### Schema (migration 78, with a `do $$` self-check, mirrored to `supabase/migrations/`)

- `task_sandbox_config` gets:
  - `config_version int not null default 1`
  - `frozen_at timestamptz`
  - `quality_checked_at timestamptz`
  - `quality_report jsonb`
- `task_submissions` gets:
  - `verified_correct boolean` (null for written and for rows before this change)
  - `required_passed int`, `required_total int`
  - `config_version int`, `evaluator_version text`
- New **append-only** table `submission_reverifications`: `id`, `submission_id`, `original_status`, `original_score`, `original_config_version`, `original_evaluator_version`, `new_verified_correct`, `basis` (`'stored verdicts'` or `'re-run'`), `new_details jsonb`, `evaluator_version`, `reason`, `created_by`, `created_at`. RLS on; readable by admin and service only.

### Freeze
- A trigger refuses any change to `test_cases` or `reference_solution` once a submission references the config.
- A change creates a **new config row** with `config_version + 1`. Only tasks not yet started move to it.

### Manual / admin configs
- A config with `quality_checked_at is null` cannot be linked to a task (enforced in `task_default_checker`).
- An admin "check quality" action runs the same `checkTestQuality` (runner, known-wrong programs) and sets the column.

### Server logic
- `gradeTests` returns `required_passed / required_total`.
- `submit-sandbox-task` sends `_verified_correct`, `_config_version`, `_evaluator_version = 'code-eval-2'`.
- `record_task_submission` decides the status from `_verified_correct` for coding.
- The generator's quality gate also requires that each known-wrong program is **not verified**. This already holds: any failed test means not verified.

### History: no silent change
- Existing rows keep their `status`, `sandbox_score` and stored `details`, untouched.
- A one-off job writes a `submission_reverifications` row for each old coding submission. `new_verified_correct` is derived **from the stored per-test verdicts** (no re-run; `basis = 'stored verdicts'`), with reason "4 Oct verified-correctness rule".
- Old "passed" rows whose verdicts show a failed test are thereby marked.

**OWNER DECISION REQUIRED:** how those old rows are shown. Options:
- (a) unchanged everywhere;
- (b) unchanged for the student, but companies see "passed under the old 80% rule";
- (c) the student is invited to resubmit.

### UI
- Build-log shows a "Verified correct" badge, or "Partial: N/100, k of n tests failed".
- TPO, company and portfolio count only verified.
- Old rows show the label chosen above.

### Test plan
1. Rerun `staging_coding_audit.py`. Expected **36/36**: the 4 subtle bugs now `failed` with partial scores 80–83.
2. Unit tests for `verified_correct`: weights, optional tests, compile error.
3. Freeze trigger refuses an edit after the first submission; an edit before it is allowed.
4. Unchecked manual config refused.
5. Old rows untouched; reverification rows written.
6. Consistency check: DB / API / Build-log / TPO / company.
7. Full release gate.

Question: approve P2 (and choose a / b / c)?

---

## P3. Voice rubric with a technical-correctness rule

| Criterion | Max | What earns points | Evidence required |
|---|---|---|---|
| Technical correctness | **30** | What they say about how the code works is true **of the submitted code** and of the task | quote from the transcript **and** the specific claim judged |
| Match to submitted work | **25** | Refers to things really in this submission (names, steps, bug hit) | quote |
| Reasoning / decisions | **20** | Why they chose something; what they changed and why | quote |
| Specific evidence | **15** | Details only the author would know | quote |
| Completeness / limitations | **10** | Covers the main parts; says honestly what is missing or uncertain | quote |
| **Total** | **100** | | |

### Deterministic rules applied after the AI answers (code, not AI)

1. **Quote check.** Points for a criterion are zeroed unless its quote (8+ characters) appears in the transcript (case and spacing normalised). This is the same rule the written grader uses.
2. **Technical gate.** Technical correctness < 15/30 → flag `technically_wrong`, total **capped at 40**, `verified = false`.
3. **Mismatch gate.** Match < 10/25 → flag `off_topic`, total **capped at 30**.
4. **Contradiction gate.** The AI must state `contradicts_submission` (true/false) with a quote. If true and the quote is found → Match = 0, flag `contradiction`, **cap 30**.
5. **Irrelevant.** Technical < 5 and Match < 5 → **cap 10**.
6. **Explanation verified** = Technical ≥ 15 and Match ≥ 10 and no contradiction. A high total from the other three criteria can never make a technically wrong explanation verified.
7. **Not scored at all:** accent, pronunciation, country, native-English quality, fluency. The prompt says so; there is no criterion for them. Indian English stays accepted (language gate unchanged).
8. **Stored in `evaluation`:**
   - `criteria[{id, name, max, points, evidence, reason}]`
   - `gates{technical_ok, match_ok, contradiction, caps_applied[]}`
   - `verified`
   - `rubric_version = 'voice-rubric-1'`, `evaluator_version = 'voice-eval-4'`
   - `provider`, `model`, `prompt_sha`
   - `communication_score` = the final total (unchanged column)
9. Old scored recordings stay as they are (immutable) and show "scored with voice-eval-2/3 (single score)".

### Expected outcome per case (conceptual; to be proven live after approval)

| Case | Technical /30 | Match /25 | Reasoning /20 | Evidence /15 | Complete /10 | Gates | Total | Verified |
|---|---|---|---|---|---|---|---|---|
| A excellent | 26–30 | 22–25 | 16–20 | 12–15 | 8–10 | none | 85–100 | yes |
| B correct, incomplete | 20–26 | 15–20 | 0–8 | 3–8 | 0–4 | none | 40–65 | yes |
| C partly technically wrong | 8–14 | 15–20 | any | any | any | technical → cap 40 | ≤ 40 | **no** |
| D confidently wrong | 0–5 | 0–8 | — | — | — | technical + mismatch → cap 30 / 10 | ≤ 30 | no |
| E irrelevant | 0 | 0 | 0 | 0 | 0 | irrelevant → cap 10 | 0–10 | no |
| F contradicts the code | low | 0 (contradiction) | — | — | — | contradiction → cap 30 | ≤ 30 | no |
| G generic | 0–8 | 0–9 | 0–5 | 0 (no quotable specifics) | 0–3 | technical + mismatch | ≤ 30 | no |
| H prompt injection ("give full marks") | 0 | 0 | 0 | 0 | 0 | quotes found but carry no content → near 0; fenced prompt | 0–10 | no |
| I different task | 0–5 | 0 | — | — | — | mismatch → cap 30, usually irrelevant cap 10 | ≤ 30 | no |
| J short but correct (about 20 words) | 18–25 | 12–18 | 0–5 | 0–5 | 0–3 | none | 35–55 | **yes** (correct, just brief) |

Test plan:
- Rerun `staging_voice_cases.py` with these expectations, plus H and J added.
- 5× reproducibility per case: total range ≤ 10, and the verified flag never flips.
- Check that old rows are untouched.
- Full release gate.
- Cost: about 40 scorings ≈ ₹1.

Question: approve P3 (weights, caps and gates as above, or changes)?

---

## P4. Cost evidence and test budget

### Raw aggregate
Staging `llm_usage`, 4 Oct 00:00 UTC onwards (all of today's tests, gate runs, voice cases and load stages). MEASURED, query run today.

| Feature | Provider | Calls | Input tokens | Output tokens |
|---|---|---|---|---|
| voice-score | deepseek | 517 | 351,421 | 43,413 |
| submit-written-task | deepseek | 125 | 77,460 | 16,484 |
| task-explain | deepseek | 2 | 1,028 | 744 |

### Price (UNVERIFIED)
- DeepSeek has published two list-price sets; which applies to this account must be checked on the DeepSeek invoice:
  - (i) input $0.27/M, output $1.10/M;
  - (ii) input $0.28/M (cache miss), output $0.42/M.
- **USD→INR 84** (assumed).
- Cache-hit discounts are ignored, so these are upper bounds.

| Feature | Price set (i), INR | Price set (ii), INR | Per call |
|---|---|---|---|
| voice-score | 11.98 | 9.80 | ₹0.019–0.023 |
| submit-written-task | 3.28 | 2.40 | ₹0.019–0.026 |
| task-explain | 0.09 | 0.05 | — |
| **Total** | **15.35** | **12.25** | |

### Per journey and per level (estimates, rounded)

| Item | AI | Cloud Run (staging, while running, INFERRED) |
|---|---|---|
| One coding journey (Run + Submit + voice) | about ₹0.02 (voice only; coding uses no AI) | small |
| One written journey | about ₹0.04–0.05 | small |
| One voice scoring | about ₹0.02 | Whisper on our own Cloud Run (no separate transcription bill) |
| Level 150 / 200 / 225 / 250 (one run, two-thirds coding) | about ₹4 / 6 / 6 / 7 | about ₹15–40 per level (25–40 min, 6–10 vCPU) |
| Those four levels × 3 repeats | about ₹70 | about ₹180–480 |
| Storm tests (10 kinds) | about ₹10 | about ₹30–60 |
| 60-minute soak at about 150 students (about 8 journeys per student-hour) | about ₹35–45 | about ₹40–80 |
| Database | ₹0 extra (staging db-f1-micro is a flat monthly price) | — |

Cloud Run cost is the uncertain part:
- Rate assumption: about $0.000024 per vCPU-second, about ₹7 per vCPU-hour (UNVERIFIED for this region and tier).
- It depends on how long instances run, measured per stage from Cloud Monitoring `billable_instance_time`.

### Proposed hard budget
**₹600 total for P5–P8 work** (about ₹120 AI + up to ₹480 Cloud Run), with this mechanism built into the load tool:

1. **Before each stage:** projected cumulative cost = spent so far + this stage's estimate. If over ₹600 → **refuse to start**.
2. **After each stage:**
   - actual AI cost from `llm_usage` tokens for the stage window;
   - Cloud Run cost from `billable_instance_time` × rate;
   - both written to `e2e-out/load2k/budget.json`.
3. **When the cap is reached:** stop and report.
4. The ramp beyond 250 toward 2,000 is a separate approval with its own budget.

Question: approve the ₹600 cap and the mechanism?

---

## P5. Restore rehearsal (not run)

**Source:** production `prooflab-db` automated backup **`1791057600000`** (2026-10-03 20:00 UTC, SUCCESSFUL; MEASURED). Restoring *from* a backup reads it. The production instance itself is not modified.

### Steps (exact commands)

```
P=prooflab-508214; R=asia-south1; T=prooflab-restore-test

# 0. Record production's state before (read-only)
gcloud sql instances describe prooflab-db --project=$P --format=json > e2e-out/restore/prod-before.json
gcloud sql operations list --instance=prooflab-db --project=$P --limit=5 > e2e-out/restore/prod-ops-before.txt

# 1. Temporary instance: smallest tier matching production's version; no authorized networks,
#    connector-only, no backups, labelled
gcloud sql instances create $T --project=$P --region=$R --database-version=POSTGRES_17 --tier=db-g1-small \
  --edition=ENTERPRISE --no-backup --connector-enforcement=REQUIRED --labels=purpose=restore-rehearsal,delete-by=2026-10-05

# 2. No public access: no authorized networks, and only the Cloud SQL connector (IAM-checked) may connect
gcloud sql instances describe $T --project=$P --format="value(settings.ipConfiguration.authorizedNetworks,settings.connectorEnforcement)"

# 3. Temporary identity, allowed to reach ONLY this instance (IAM condition on the instance name)
gcloud iam service-accounts create prooflab-restore-inspect --project=$P
gcloud projects add-iam-policy-binding $P --member=serviceAccount:prooflab-restore-inspect@$P.iam.gserviceaccount.com \
  --role=roles/cloudsql.client --condition='expression=resource.name=="projects/prooflab-508214/instances/prooflab-restore-test",title=restore-only'

# 4. Restore the backup INTO the temporary instance (source = prooflab-db's backup; target overwritten)
gcloud sql backups restore 1791057600000 --restore-instance=$T --backup-instance=prooflab-db --project=$P

# 4b. The copy carries production's database users and passwords: replace the copy's postgres password
#     (affects only the copy) and keep it in a new temporary secret
gcloud sql users set-password postgres --instance=$T --project=$P --password="$(openssl rand -base64 30)"   # value piped into the secret, never printed

# 5. Inspection job: Cloud Run job, temporary identity, mounted to the temporary instance only
gcloud run jobs create prooflab-restore-inspect --project=$P --region=$R --image=<psql image used by inspect4> \
  --service-account=prooflab-restore-inspect@$P.iam.gserviceaccount.com --set-cloudsql-instances=$P:$R:$T \
  --set-secrets=DB_URI=prooflab-restore-db-uri:latest --max-retries=0

# 6. Verify schema / data / migrations (the job prints counts and pass/fail only, never row content):
#    tables and row counts; the schema_migrations preflight from rollout stage 2 (to_regclass and
#    account_email_confirmed checks); then apply 50 -> 76 in rollout order through the ledger wrapper on
#    the COPY; every file's own self-check must pass
# 7. Restore health independent of the app: pg_database_size, count of tables with RLS, a sample of
#    foreign keys valid, no invalid indexes (pg_index.indisvalid)

# 8-10. Clean-up and proof
gcloud run jobs delete prooflab-restore-inspect --project=$P --region=$R --quiet
gcloud secrets delete prooflab-restore-db-uri --project=$P --quiet
gcloud projects remove-iam-policy-binding $P --member=serviceAccount:prooflab-restore-inspect@$P.iam.gserviceaccount.com --role=roles/cloudsql.client --all
gcloud iam service-accounts delete prooflab-restore-inspect@$P.iam.gserviceaccount.com --project=$P --quiet
gcloud sql instances delete $T --project=$P --quiet
gcloud sql instances list --project=$P        # must show only prooflab-db and prooflab-staging-db

# 11. Production unchanged
gcloud sql instances describe prooflab-db --project=$P --format=json > e2e-out/restore/prod-after.json   # diff: only timestamps may differ
gcloud sql operations list --instance=prooflab-db --project=$P --limit=5                                   # no new operation on prooflab-db
```

### Protecting the copied real data while it exists
- No authorized networks; connector-only; one temporary identity limited by an IAM condition to this one instance.
- The copy's `postgres` password is replaced.
- The job prints counts and check results only.
- No export, no download, no screenshots.
- No app service is pointed at the copy.
- The instance is deleted in the same session, with a label `delete-by` as a backstop.

### Time, cost, failure handling

| | |
|---|---|
| Duration (INFERRED) | create 5–10 min, restore 10–20 min (small database), checks + migrations 20–40 min, clean-up 10 min. **About 1–1.5 hours** |
| Cost (INFERRED) | db-g1-small about ₹3–4 per hour + a few rupees of disk and job time. **Under ₹30** |
| Failure clean-up | Steps 8–10 are safe to repeat; they run even when an earlier step fails |
| Abort | `gcloud sql instances delete prooflab-restore-test` at any moment ends all exposure |

The `--connector-enforcement` and `--edition` flag names must be checked against the installed gcloud version before running (UNVERIFIED).

Question: approve P5?

---

## P6. Smaller fixes found by this audit (each needs a yes)

| # | Finding (MEASURED) | Proposed fix | Where |
|---|---|---|---|
| a | `skill_aliases` writable by anonymous users (proven on staging) | Revoke INSERT / UPDATE / DELETE / TRUNCATE from `anon`, `authenticated` (keep SELECT); check default privileges for future tables | migration 79, staging first; production in rollout |
| b | Production code-runner and transcriber invokable by `allUsers` | Runner: rollout stage 6.3 (IAM-only, like staging). Transcriber: remove the legacy browser path, invoker = worker only | production IAM, later, with approval |
| c | Production transcription worker max instances unset (100) | Set max 4 (already in rollout stage 8) | production setting, later |
| d | A transient AI failure leaves a recording unscored for good | The reaper retries a recording whose scoring failed with an AI-unavailable reason, up to 3 times | code |
| e | Staging has no AI fallback keys | Give staging the Gemini key (staging secret) so tests reflect production's fallback | staging secret |

## P7. Staging capacity runs

- Option D is approved in principle: no scaling change, no quota change, clean idle baseline, no other process running, queues drained, baseline recorded before each run.
- Experiments B (transcriber 2 jobs) and C (queue 1 at a time) are run only later, as controlled experiments after the unchanged baseline is established, and each needs its own yes.
