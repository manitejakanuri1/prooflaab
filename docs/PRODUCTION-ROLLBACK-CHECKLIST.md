# Production rollback checklist

How to go back, stage by stage, if the rollout in `PRODUCTION-ROLLOUT-CHECKLIST.md` goes wrong. Roll back in the **reverse** order of the rollout: website → services → database.

**Rule:** if a check fails and the cause is not obvious in 10 minutes, roll back that stage. Do not debug on the live site.

---

## Quick table

| What went wrong | Roll back | Time | Data lost |
|---|---|---|---|
| Website broken after merge | Stage 4 | 5–10 min | none |
| A service fails `/ready` or errors | Stage 3, that service only | 2 min | none |
| A migration fails its self-check | nothing to do — it undid itself | 0 | none |
| A migration applied but something misbehaves | Stage 2, that migration's rollback file | 5–15 min | see per migration |
| Logins fail after the token cutover | Stage 6 | 5 min | none |
| Cleanup (66) was a mistake | Stage 7 | 30–60 min | none if restored from `legacy_archive`; anything after the backup if restored from backup |
| Everything | restore the Stage 1 backup + previous images + revert `main` | 60+ min | everything written after the backup |

---

## Stage 4 — Website

1. `git revert` the merge commit on `main` and push. The normal deploy publishes the previous site.
2. If the deploy job itself is what broke (new "download the tested build" step): restore `.github/workflows/deploy.yml` from `d736e4d`, push.
3. Check: `prooflab.co.in` serves the old bundle name.

Note: the old website expects some things the new database no longer allows (delete a recording, sponsor a Lot from the browser, explain before submit). If the website is rolled back but the database is not, those three buttons show an error. Nothing is damaged.

## Stage 3 — Services

For each service, point it back at the image noted in Stage 1.4 (also in `infra/production/services.json` at commit `2e5d6e8`):

```
gcloud run services update-traffic <service> --region=asia-south1 --to-revisions=<previous revision>=100
```

The old functions image has 40/41 functions and still expects the proof tables; it works as long as migration 66 has **not** been applied.

## Stage 2 — Database

Every migration has a rollback file or note in `migration/`. Apply in **reverse** order, only as far back as needed.

| Migration | Rollback | What you lose |
|---|---|---|
| 68 | `68-rollback-daily-lots.sql` (or the body saved in Stage 1.3) | per-student safety in the nightly job |
| 67 | `67-rollback-…` | the ledger |
| 65 | body saved in Stage 1.3 (`65-rollback…staging` is for staging) | — |
| 64 | body saved in Stage 1.3 (`64-rollback…staging` is for staging) | — |
| 63 | `63-rollback-portfolio.sql` | portfolio list (old site does not use it) |
| 62 | `62-rollback-import-student.sql` — **first** put the old functions image back | — |
| 61 | `61-rollback-voice-bound-to-submission.sql` (two steps, read the file) | attempt numbers, authority flags, withdrawal marks, saved evaluations; transcripts erased by a withdrawal stay erased |
| 60 | `60-rollback-…` | teammate names |
| 59 | body saved in Stage 1.3 (`59-rollback…` holds staging bodies) | — |
| 58 | `58-rollback-…` | the visibility column on source pages |
| 57, 57b, 56 | `56-rollback-company-lots.sql`, `52-rollback…` | company Lots created meanwhile keep working as tasks |
| 55 | `55-rollback-…` | suspension marks, protected-account list |
| 54 | `54-rollback-…` | company review decisions (`submission_reviews`) |
| 53, 52, 51, 50 | their rollback files | — |

After any database rollback: `notify pgrst, 'reload schema';`.

**Important:** staging and production had different bodies for the company and TPO functions. The staging rollback files restore **staging** bodies. For production use the file saved in Stage 1.3.

## Stage 6 — Token signing

Works at any point of the cutover:

1. API: `PGRST_JWT_SECRET` back to the original secret (`prooflab-jwt-secret`).
2. Bridge: remove `APP_SIGNING_KEY` (it signs the old way again).
3. Every service: put `PGRST_JWT_SECRET` back; remove `SIGNER_URL` (the code falls back to the old path by itself).
4. People signed in during the change sign in again.

Until step 7 of the cutover (removing the old key) nothing needs rolling back: both kinds of token work.

## Stage 7 — Cleanup (migration 66)

See `migration/66-rollback-NOTES.md`. Two ways:

1. Restore the backup taken just before 66 (loses anything written after it).
2. Re-create the objects from the old migrations and reload the rows from `legacy_archive`.

Only needed if the **old** website or functions must run again; the new ones never read those objects.

---

## What cannot be rolled back

| Thing | Why |
|---|---|
| A student's recording withdrawn through Privacy after the rollout | the transcript is erased on purpose |
| Old proof files deleted from storage (Stage 7.3) | permanent — that is why it has its own approval |
| Emails already sent | — |

## After any rollback

1. `python scripts/healthcheck.py` — all PASS.
2. `python scripts/infra_snapshot.py --check` — matches the recorded state.
3. Write what happened in `docs/STABILIZATION-EXECUTION-REGISTER.md` under the item that failed.
