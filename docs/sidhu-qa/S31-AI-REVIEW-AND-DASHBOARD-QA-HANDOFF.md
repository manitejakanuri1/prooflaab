# S31 — AI-first review and four-dashboard QA: integration handoff to TEJA (10 Oct 2026)

Branch `fix/sidhu-s31-ai-review-and-dashboard-qa-2026-10-10` on `prooflaab`.
**Parent commit: TEJA's release candidate `c2a4fe8b95d7c445af6bfe4dd14dcb55be7b1644`.** The branch was fast-forwarded to it, with no merge commit and no rebase, so the S31 commit's diff against `c2a4fe8` is exactly the S31 work.
No deploy, migration execution, staging or production write, or traffic change.

## Answer first

| Area | Status | Proof (offline; nothing verified live) |
|---|---|---|
| Similarity-only false positives no longer reach humans | **DONE in source** | Real-Postgres tests 9/9; Deno 5 tests; mutation 5/5 caught |
| Grader disagreement settled by a bounded third AI opinion, not a human | **DONE in source** | At most 3 AI calls per answer |
| Human review only for a serious copy signal | **DONE in source** | `copied_answer` is the only flag `submit-written-task` sets |
| Review resolution: exactly once, task + evidence + XP | **DONE in source**, plus a fix for a stuck-review bug | Real-Postgres tests |
| Badges, batched reminder, student outcome message | **DONE in source** | Browser 28/28; digest dedupe test |
| Four-dashboard QA | 0 release blockers open | S28 suite 134 PASS / 0 FAIL; S31 browser 28/28 incl. all 16 Squad tabs |

## 1. Integration map (relative to `c2a4fe8`)

### Comparison of my S30 work with TEJA's commit

TEJA's `c2a4fe8` already contains my S30 package. Line endings ignored, these are **byte-identical**:
- `migration/103-task-provenance-and-authz-repair.sql`, its rollback and `supabase/migrations/20261103005300_*`. TEJA's 103 is the in-place-patch version that keeps 91/93; **no material difference, so TEJA's copy is kept and not replaced.**
- `_shared/submission.ts`, `_shared/submission_test.ts`, `submit-sandbox-task/index.ts`, the S30 report, `sidhu_s30_permission*`, `sidhu_s30_policy_model.mjs`, `sidhu_s30_pg_harness.test.mjs`.
- `src/hooks/useStudentProfile.tsx`: TEJA's commit **already has** the `retryOnMount: false` fix (S28). My copy differed only in comment wording, so **TEJA's version is kept and my edit is dropped.**

### Files the S31 commit changes (integrate these)

| File | Kind | Note |
|---|---|---|
| `migration/104-ai-first-review-and-safe-resolution.sql` | new | needs 103 (checked by its self-check) |
| `supabase/migrations/20261103005400_ai_first_review_and_safe_resolution.sql` | new | identical mirror |
| `migration/104-rollback-ai-first-review-and-safe-resolution.sql` | new | restores migration 86's function byte for byte |
| `supabase/functions/_shared/review-policy.ts` + `review-policy_test.ts` | new | decision rules + 5 Deno tests |
| `supabase/functions/submit-written-task/index.ts` | modified | **only** S31 hunks on top of TEJA's (= S30) version |
| `supabase/functions/scheduled-job/index.ts` | modified | digest after `daily-lots`; TEJA did not touch this file |
| `src/hooks/usePendingReviewCount.ts` | new | |
| `src/components/dashboard/college/TpoStudents.tsx` | modified | badge; TEJA did not touch it |
| `src/pages/AdminDashboard.tsx` | modified | tab count; TEJA did not touch it |
| `src/components/dashboard/admin/ReviewedSubmissions.tsx` | modified | label + messages; TEJA did not touch it |
| `scripts/dev-tools/sidhu_s30_pg_harness.mjs` | modified | backward-compatible `extensions` option only |
| `scripts/dev-tools/sidhu_s31_review.test.mjs`, `sidhu_s31_dashboards_browser.mjs` | new | tests |
| `docs/sidhu-qa/S31-AI-REVIEW-AND-DASHBOARD-QA-HANDOFF.md` | new | this file |

**Everything else in `c2a4fe8` must remain unchanged by S31**: migration 103 and its rollback/mirror, the BFF / gateway / portfolio work, `useStudentProfile.tsx`, the S30 files above, and all other 54 files of TEJA's commit. No S31 file collides with a new file of TEJA's. Migration number 104 is free in `c2a4fe8`.

Not in Git (kept as local evidence only): test logs, screenshots, build output, PGlite, backups, staging query output.

## 2. Mission A — how assessment and review now work

```
answer → word-count check → similar_written_answer (DB, no AI)
       → AI grade 1
           borderline (within 10 of the pass mark)? → AI grade 2
               graders differ by > 15 points? → AI grade 3 → median decides
       → record_task_submission (unchanged: 91 / 93 / 103 rules)
       → human review ONLY if copied_answer
```

| Signal | Before | Now |
|---|---|---|
| Resembles another student's answer (≥ 0.8) on the same checklist | Human review | Ignored unless **all three** hold: ≥ 0.92 similarity to an earlier answer **to the same question** (same checklist **and** same task title + description), ≥ 40 words, and the answer does not mostly restate the prompt / reference answer (`word_similarity` < 0.6). Then `copied_answer` goes to a human. |
| Two AI graders disagree by > 15 | Human review | One extra AI opinion, median of three. Never a human. |
| The similarity check errors | n/a | Logged; the student is never blocked or flagged |

- **Cost.** At most 3 AI calls per written answer (was 2). The third runs only for a borderline answer whose two graders disagree. The similarity check is SQL. The per-student limit is unchanged.
- **Privacy.** No answer text is logged. Students never see similarity scores. The student's messages contain no accusation (tested).

**Resolving a review** (admin or the student's own approved college only; tested):

| Case | Result |
|---|---|
| Approve | passed; task (or assignment) completed; XP once; activity logged; student told "confirmed" |
| Approve twice | second call: "not awaiting review", nothing repeated (`FOR UPDATE`) |
| Approve after a later attempt already passed | **was stuck forever** (one-pass index error). Now closed (`failed`, the only non-pass status allowed); no XP; student told nothing more is needed |
| Reject | failed; no XP; student told "did not pass this time, read the feedback and try again" |
| Other college / company / student / anonymous | refused |

Reaching people:
- **Admin:** a count on Work → "Flags & reviews".
- **The student's college:** a count badge on Students → "Flagged Submissions".
- **Reviewers:** at most one daily digest each (admins, and each approved and active college for its own students), inside the existing `daily-lots` scheduler call.
- **Student:** one outcome notification per resolved review.

Duplicates are impossible because the notifications use migration 40's `(user_id, type, dedupe_key)` unique index. There are no new pages and no new scheduler jobs.

**Not built (owner decisions):** a student appeal flow (none exists; students can retry); selective quality sampling (needs a rate); the `ai_risk` flag (nothing produces it).

## 3. Mission B — four-dashboard QA

| Check | Result |
|---|---|
| S28 browser suite rerun | 134 PASS / 0 FAIL / 5 KNOWN_BROKEN / 2 NOT-PROVEN. The NOT-PROVEN rows (Squad tabs) are covered by S31: 16/16 render. |
| S31 browser checks | 28 / 28 |
| Release blockers | 1 found (outage spinner/storm); fixed. TEJA's `c2a4fe8` has the same fix, which is kept. |

### Unresolved launch decisions (flagged, not fixed: they need the owner)

| Control | Where | Today | Decision needed |
|---|---|---|---|
| **Delete Account** (student) | Profile → Settings (`StudentSettingsPage.tsx:675`) | enabled, red, **does nothing** | disable with "handled by your college / an admin" (as the company screen does), or build self-delete with a policy |
| **Configure Email Templates** | Admin → People → Admins & roles (`SystemSettings.tsx:229`) | enabled, **does nothing** | remove, or mark "coming soon" |
| **Manage Notification Rules** | same screen (`SystemSettings.tsx:235`) | enabled, **does nothing** | remove, or mark "coming soon" |
| **Voice "Play"** on a candidate's 60-second explanation (company) | Talent → proof profile (`ProofProfile.tsx:144`) | **does nothing**; the server sends no audio | may companies hear student voice (consent / privacy)? Then either wire audio or remove the button |

"View Submission" (student) is owned by TEJA R2/S30 and is not duplicated here.

## 4. CRITICAL: staging discrepancy (evidence preserved; nothing applied)

My read-only staging queries (S30 live preflight):

| Item | Value |
|---|---|
| Runner | Cloud Run job `prooflab-staging-inspect4` (repo `scripts/dev-tools/staging_sql.sh`), project `prooflab-508214` |
| Database credential | env `STAGING_DB_URI` ← secret **`prooflab-staging-db-uri`, version `latest`**. That secret has **one version only, created 2026-09-24T15:02:38**, so every staging runner since then reaches the same database. |
| Database identity returned | `current_database() = prooflab`, **PostgreSQL 17.11** |
| Execution 1 (preflight) | `prooflab-staging-inspect4-4xzsd`, ran **2026-10-09 04:26:44 → 04:26:53 UTC** (09:56 IST) |
| Execution 2 (definitions) | `prooflab-staging-inspect4-t9lmw`, ran **2026-10-09 04:31:12 → 04:31:23 UTC** (10:01 IST) |
| Both ran inside | `begin transaction read only … rollback` |

What they returned:
- Ledger rows 90, 91, 92, 95, 96, 97, 98, 100, 101, 102. **93, 94 and 103 absent.**
- `tasks.inserted_by` absent; `tasks_own_insert/update` present, so **103 not applied at 04:26 UTC.**
- `record_task_submission` md5 `f0930e15…`: contains 91's rule, **not 93's** (`hidden-summary` absent).

Reading:
- **103:** my queries ran **before** TEJA's release-candidate commit (`c2a4fe8`, 2026-10-09 15:10 IST = 09:40 UTC). "103 absent at 04:26 UTC" does not contradict a later application. It must be re-checked now.
- **93:** absent from the ledger **and** absent from the live function body at 04:31 UTC. If TEJA's report says 93 was applied to staging **before** that time, the two observations conflict, and the likely causes are (a) applied to a different database (e.g. production), or (b) applied outside the ledger and later replaced. If it was applied **after** 04:31 UTC, there is no conflict.
- Not captured: `inet_server_addr()` and the cluster system identifier. Those would prove which physical instance answered.

**Reconciliation (owner / TEJA; read-only, same runner, before applying anything):**

```sql
begin transaction read only;
select current_database(), inet_server_addr(), (select system_identifier from pg_control_system()), now();
select version, left(checksum, 16), applied_at from public.schema_migrations where version ~ '^(9[0-9]|10[0-9])' order by version;
select md5(pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure)),
       position('hidden-summary' in pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure)) > 0 as has_93,
       position('-- 103: a task its own student inserted is never evidence.' in pg_get_functiondef('public.record_task_submission(uuid,uuid,uuid,text,text,integer,integer,integer,jsonb,text,integer,uuid,jsonb,text[])'::regprocedure)) > 0 as has_103;
rollback;
```

Run it on staging and on production with each environment's own runner, and compare with TEJA's application logs (execution names and times). **Do not apply 103 or 104 anywhere until this table is filled in.**

## 5. Tests and gates (on the final tree = `c2a4fe8` + S31)

See the commit message and `evidence/` in the review ZIP for the run logs. Suites: S31 review (Postgres), S30 Postgres + model suites, S31 browser, the Deno CI set, `deno check`, `web-bff`, `src/lib`, typecheck + build + browser security gate, `migrations.py check`, atomic/release guard tests, secret scan, legacy guard, `git diff --check`.

Limits:
- PGlite is a single session, so simultaneous reviewers cannot be raced (`FOR UPDATE` is standard; the sequential double-approve is tested).
- Similarity scans answers to the same question; add a trigram index if one question collects many thousands.

## 6. Deploy order (after the discrepancy is reconciled)

1. **Staging:** confirm the ledger state. Apply 103 (if absent), then 104, via `staging_migrate.sh`. Each self-check refuses on surprises.
2. **Staging:** deploy `submit-written-task`, `submit-sandbox-task` and `scheduled-job`. If they deploy before 104, they log a missing function and flag nothing: no outage.
3. Frontend.
4. **Staging checks:**
   - a written answer, and a borderline one;
   - approve and reject as admin and as the college;
   - the student's notification;
   - `select public.notify_pending_reviews()` twice: the second call adds nothing.
5. Production only after staging passes, same order.

**Rollback:** `104-rollback` restores migration 86's function exactly and drops the new functions. The functions keep working without copy flags. Frontend changes are display-only. Rolling back reintroduces the stuck moot-review bug.

**Recommendation:** GO for integration and staging rehearsal. **Production NO-GO** for these changes until the staging discrepancy is reconciled and steps 1–4 pass.
