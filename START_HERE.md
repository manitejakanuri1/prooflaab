# Start here

Read this first — on a new laptop, in a new session, or with a different
account. It is the only document in this repository that is kept current.

Last updated: 24 August 2026 · live commit `0d98ad4`

---

## What this is

ProofLabAI turns student claims into evidence. A college uploads a CSV of
students; each student gets one real piece of work a day (a **Lot**), submits
it, and explains it out loud for sixty seconds. The platform scores the work,
groups students into **squads** of eleven that compete weekly, and builds a
proof profile a recruiter can inspect.

Three dashboards exist — Student, College/TPO, Admin. A fourth, Recruiter, does
not exist yet and is the largest remaining piece of work.

---

## Two laptops, one database — the three rules

The code lives in git and git will protect you. The database does not: there is
**one** live Supabase project and both laptops talk to the same rows.

### 1 · Each laptop works on its own branch

```sh
# laptop A
git checkout work/a

# laptop B
git checkout work/b
```

Merge into `main` when a piece of work is finished. Pushing `main` deploys to
Vercel, so `main` is always the live site.

```sh
git checkout main && git pull prooflaab main
git merge work/a
git push prooflaab main          # this deploys
git checkout work/a && git merge main   # bring your branch back in line
```

### 2 · One laptop owns the database at a time

Migrations are applied to the **shared live database**. If both laptops apply
migrations in the same hour you will not get a merge conflict — you will get a
database that neither file set describes.

```
   the laptop applying migrations   applies them, saves the .sql,
                                    commits, pushes
   the other laptop                 pulls the .sql files and does
                                    NOT re-apply them — they are
                                    already live
```

Say out loud who has the database before either of you starts.

### 3 · Do not edit the same file at the same time

Parallel works when the work is split by area:

```
   laptop A → recruiter screens, edge functions
   laptop B → college screens, migrations
```

Same file, same hour, two laptops: a conflict every time.

---

## Running it

Either works. Docker guarantees an identical setup; plain Node is faster to
start and perfectly fine, because there is no local database to run.

```sh
# with Docker
docker compose up                    # http://localhost:8080

# without Docker (Node 20+)
npm install
npm run dev                          # http://localhost:8080
```

No `.env` is needed. The Supabase URL and publishable key are compiled into
`src/integrations/supabase/client.ts`.

---

## Rules that are not obvious

- **Never push to `origin`.** That remote is a different person's fork of this
  project (`Yashwanth-pilli/prooflabai-mvp`) and the two have diverged. Every
  push goes to `prooflaab` (`manitejakanuri1/prooflaab`).
- **Never run `supabase db push`.** Migrations are applied through the Supabase
  MCP tools, and the same SQL is then saved into `supabase/migrations/` and
  committed. The folder and the live database are meant to be the same thing.
- **Regenerate types after any schema change.** `src/integrations/supabase/
  types.ts` is generated; the editor reads it to know what columns exist.
- **`tsconfig.app.json` has `strict: false`.** The typechecker will not catch a
  renamed or missing column. Screens have to be clicked, and flows have to be
  run against the live database, before anything is called done.
- **Do not delete anything without asking.** That includes test data, branches
  and old files.
- **Edge functions deploy separately** from the site:
  `supabase functions deploy <name>`.
- **After `revoke all on function … from public, anon, authenticated`, grant it
  back to `service_role` by name** if an edge function calls it. That revoke
  strips service_role too, because its EXECUTE came through PUBLIC. This has
  bitten twice.

---

## Where things stand

**Working end to end, live:**

- CSV import with validation, duplicate detection and an error report
- Email invitations, onboarding, resume upload, ATS score, AI rebuild
- Validation assessment: 5 multiple-choice, written project defence, 2 coding
- The Daily Lot engine — written once per topic by AI, shared by everyone who
  reaches that topic, created nightly at 00:10
- The 146-topic ladder, weekly plan, checkpoints, XP, streaks, badges
- Squads: formation, IPL-style naming, reserve pool, weekly scoring,
  round robin with draws and a real tie-break, season podium
- College dashboard: Home, Students, Squads, Insights — all four complete
- Admin dashboard

**Not built:**

- The Recruiter role in full — discovery, proof profile, shortlist, sponsored
  tasks, hiring outcomes (steps 19–21 of the master flow)
- Daily Lots sourced from real job descriptions (they come from the ladder)
- Server-side speech-to-text (the browser writes the transcript today)
- WhatsApp invitations (the phone column now exists, so this is startable)
- Per-student improvement reports at the end of a season

**Before real students arrive:**

- Delete the test fixture: `supabase/seed_test_accounts_cleanup.sql`
- Reset the admin password (currently a shared test one)
- Empty the four storage buckets of test files

---

## Test accounts

All plus-addressed to the owner's inbox, all sharing one throwaway password.

```
   vidyuthsetu+college@gmail.com     college — Pragati Engineering College
   vidyuthsetu+student1..6@gmail.com students
   vidyuthsetu+admin@gmail.com       admin
   vidyuthsetu+startup@gmail.com     startup
```

There is no recruiter account, because there is no recruiter role.

---

## The other documents

`README.md` is current. `HANDOFF.md`, `PROJECT_OVERVIEW.md`,
`PROJECT_STATUS.md` and `RESUME_FEATURE_STATUS.md` describe the product well but
their table names, counts and migration references are out of date — check the
live database instead of trusting them.
