# Step 6 handoff — read this first if you're picking this up fresh

Last updated: 2026-09-28 (migration 44 applied), on branch `work/step6j-release-gates`, at or after commit `36e6c39`.

If you're a new Claude Code session (or a new person) starting on this
work, read this whole file before touching anything. It replaces having
to re-explain the engagement from scratch.

---

## What this project is

ProofLabAI — a proof-of-skill platform for Indian engineering colleges.
Live at prooflab.co.in. GitHub repo `manitejakanuri1/prooflaab` (remote
name `prooflaab`), working directory `E:\Projects\prooflabai-mvp`.

Backend runs on Google Cloud (`prooflab-508214`, region `asia-south1`):
Cloud Run services + PostgREST on Cloud SQL, not Supabase-hosted (some
older docs in this repo — `START_HERE.md`, `HANDOFF-SECURITY-2026-09-11.md`,
`DEPLOYING.md` — describe an earlier Supabase+Vercel plan that was later
superseded; ignore those for anything related to Step 6).

- Production Cloud SQL instance: `prooflab-db`, database `prooflab`,
  table owner role `prooflab_app`
- Staging Cloud SQL instance: `prooflab-staging-db`
- Production and staging are the **same GCP project** — "production"
  just means any resource without a `staging-` prefix

---

## Standing rules — do not violate these, ever, without asking first

These have applied for the entire engagement (Steps 6B through 6BB) and
still apply:

1. **STAGING ONLY** for code/DB/deploy changes, unless explicitly
   approved for production, one specific change at a time.
2. **Never deploy to production, run production migrations, rotate
   secrets, reset passwords, or change Identity Platform settings**
   without the project owner's explicit approval for that *specific*
   action.
3. **Never merge this branch into `main`** without asking first, and
   actually stop and wait — don't just ask and proceed.
4. **Do not touch Step 7, or anything related to "the other laptop's"
   parallel work.** A second collaborator is working on a separate part
   of this project; stay out of their files/scope entirely.
5. **Never claim a test passed with weaker evidence than what was
   actually gathered.** A `service_role` query is not a "real user
   test." A read-only check is not an "end-to-end test." If something
   wasn't tested, say NOT TESTED — don't round up.
6. **Never retrieve, print, or expose database passwords, connection
   strings, or tokens.** The production DB password lives in Secret
   Manager as `prooflab-db-uri` — only the project owner (Yashwanth)
   should ever read that value himself.
7. **If you need permission, ask and wait.** Don't assume approval
   carries over from a previous, differently-scoped approval.

---

## The methodology used for every production change so far

1. Read the exact migration file(s) involved.
2. Audit: exact SQL, ownership, `SECURITY DEFINER`, `search_path`,
   default `PUBLIC EXECUTE` grants, whether `anon`/`authenticated` could
   invoke anything they shouldn't.
3. Write a **self-contained execution script**: one transaction, with
   fail-closed verification checks *inside* the transaction, *before*
   `COMMIT` — so any unexpected result aborts the whole thing
   automatically. (A check placed *after* `COMMIT` can't undo anything
   once `COMMIT` succeeds — learned this the hard way in Step 6U.)
4. **Rehearse the exact script against staging** before ever proposing
   it for production — using the existing `prooflab-staging-inspect4`
   Cloud Run job (bound to `STAGING_DB_URI`), with its execution-time
   `--args` overridden for one run only. This never creates new
   infrastructure — same job, same service account, same secret, every
   time.
   - **Important gotcha, hit more than once:** staging is *already past*
     several of these migrations. Never blindly add a defensive
     `DROP FUNCTION IF EXISTS` before a `CREATE OR REPLACE` just to make
     a script "idempotent" — if staging (or production, later) already
     has a *newer* migration's version of that function under the same
     name, a blind drop-and-recreate will silently **regress** it back
     to the older shape. See migration 44's script for the correct
     pattern: a pre-check that refuses to run at all if the target
     already has a different, newer shape, instead of forcing it.
   - When testing something that would risk changing a real, currently-
     active object, use an isolated proxy object (a differently-named
     copy) or wrap the whole test in `BEGIN … ROLLBACK` instead of
     `COMMIT`.
5. Get the project owner's **explicit approval for that one specific
   change** — never batch approvals, never assume a prior approval
   covers a new action.
6. The project owner runs it himself, manually, via **Google Cloud
   Console → SQL → `prooflab-db` → Studio**, signed in as `prooflab_app`
   (the confirmed table owner). Claude does not execute production SQL
   directly — that path was tried early on and blocked by this
   environment's own safety classifier; the manual-Studio path is what
   actually works.
7. He reports the verification results back. Docs get updated and
   committed to reflect exactly what's applied, with the real evidence.

**On production DB access**: a temporary Cloud SQL IAM database user
(for the project owner's own Google identity) was used a few times for
*read-only* inspection only — created, used, and deleted in the same
session each time, never left standing, never granted any write
privilege.

---

## Exact current state of production (2026-09-28)

| Migration | Status | Notes |
|---|---|---|
| 41 + 42 | **APPLIED** | Together, in one transaction — never 41 alone. 41 alone has a real security exposure (grants `authenticated` EXECUTE on a function with no ownership/lease-token check, and never revokes the Postgres-default `PUBLIC EXECUTE`). Script: `migration/step6u-combined-41-42-production-execution.sql` |
| 43 | **APPLIED** | Script: `migration/step6y-migration-43-production-execution.sql`. Includes a fix beyond the original migration file — an explicit revoke of default `PUBLIC EXECUTE` on the `guard_voice_explanations_insert()` trigger function, which the original migration never had |
| 47 | **APPLIED** | Script: `migration/47-production-voice-explanations-update-revoke.sql`. Removes `UPDATE` on `voice_explanations` from `authenticated`/`anon` — nothing legitimate ever used that grant |
| 44 | **APPLIED (2026-09-28)** | Script: `migration/step6bb-migration-44-production-execution.sql` (commit `c890889`). Applied manually by the project owner via Cloud SQL Studio, connected as `prooflab_app`, and independently verified: `scoring_claimed_at` column exists; `claim_voice_scoring(uuid, integer)` returning `boolean` exists, owner `prooflab_app`, `SECURITY DEFINER`; EXECUTE for `service_role` only (`anon`/`authenticated`/`PUBLIC` = false). Recorded in the runbook and architecture doc in commit `36e6c39` |
| 45 | Not started — **this is the next step** | Depends on 44 (now applied). Do NOT combine 44+45 into one script — unlike 41/42, each is independently self-contained and safe to apply separately (see runbook §1) |
| 46 | Not started | Independent of 41–45 in practice; ships with them because it closes a gap they collectively created |
| Async pipeline infrastructure | **Does not exist in production** | No Cloud Tasks queue, no dedicated worker/functions deploy for this, no dedicated IAM/service account, no scheduler, no webhook-secret rotation, no cost limits/budget scoping specific to this, no Firebase preview-channel canary. All of migrations 41–47 so far are dormant schema/function additions — nothing in currently-deployed production code calls any of them yet |

**Full detail, exact SQL, and the reasoning behind every decision is in:**
- `docs/step6-production-rollout-runbook.md` — the authoritative rollout doc
- `docs/PROOFLABAI-COMPLETE-ARCHITECTURE-AND-STATUS.md` — architecture + status matrix

Read both before doing anything else. They are kept accurate and are
the actual source of truth, more so than any chat summary (including
this file, if it ever goes stale).

---

## File inventory — everything added this branch, in order

All in `migration/` (repo root), all committed to
`work/step6j-release-gates`:

- `47-production-voice-explanations-update-revoke.sql` — applied
- `step6u-combined-41-42-production-execution.sql` — applied
- `step6y-migration-43-production-execution.sql` — applied (fixed once
  more in a later commit — see its own header comments for the full
  history)
- `step6bb-migration-44-production-execution.sql` — applied
  (2026-09-28)

Plus the two docs listed above, updated after every applied change.

---

## What your machine needs to continue this

1. Clone/pull the repo, check out `work/step6j-release-gates` at or
   after commit `36e6c39`.
2. `gcloud` CLI authenticated to GCP project `prooflab-508214`, with
   whatever account has Owner role there (needed for any read-only
   inspection via the existing staging job, and for anything Claude does
   on your behalf).
3. The project owner needs `prooflab_app`'s actual database password to
   run anything in production himself — that's stored in Secret Manager
   (`prooflab-db-uri`), and Claude should never read or display it.

---

## How to resume this in a fresh Claude Code session

Point Claude at this file directly. A prompt like:

> Read `docs/STEP6-HANDOFF.md` first. Continue ProofLabAI Step 6 from
> there. Branch `work/step6j-release-gates`, at or after commit `36e6c39`.
> Next action: [whatever you actually want — e.g. "prepare migration 45
> and rehearse it against staging"].

That's enough — it does not need the full chat history re-pasted. The
runbook and architecture doc carry all the technical detail; this file
carries the constraints and the "how we work" methodology so a fresh
session doesn't have to rediscover them (or re-break the same things
this session already found and fixed) the hard way.
