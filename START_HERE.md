# Start here

Read this first — on a new laptop, in a new session, or with a different
account. It is the only document in this repository that is kept current.

Last updated: 7 September 2026

---

## What this is

ProofLabAI turns student claims into evidence. A college uploads a CSV of
students; each student gets one real piece of work a day (a **Lot**), submits
it, and explains it out loud for sixty seconds. The platform scores the work,
groups students into **squads** of eleven that compete weekly, and builds a
proof profile a recruiter can inspect.

Four dashboards exist — Student, College/TPO, Admin and Recruiter.

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
- Squads: formation inside a **cohort** (the academic section, CSE-A), sizes
  10-12 with a snake draft so capability is spread, weekly scoring, a round
  robin per cohort, qualification, an inter-cohort championship, seeding, semi
  finals and a final. Twelve-week season by default, fifteen at most. Failing
  to qualify ends a squad's championship race and nothing else - see
  [SQUAD_SYSTEM.md](SQUAD_SYSTEM.md)
- Individual leaderboards (overall, weekly, growth, consistency, participation,
  skill) and the seven IPL-style awards. They never stop for anybody, whatever
  happened to their squad
- College dashboard: Home, Students, Squads, Insights — all four complete
- Admin dashboard
- Assign Tasks — one shared component (`AssignTasksScreen.tsx`, `scope:
  "admin"|"college"`) now used by both dashboards. College's copy was
  previously unreachable (no button pointed at it) — fixed, it now opens from
  `TpoStudents.tsx`.
- Daily Lots grounded in a real job description when one exists —
  `lot-writer` looks up the newest approved `job_opportunities` row matching
  the topic's skill and writes the scenario from it instead of inventing one.
  Reuses `job_opportunities` + `lot_templates`, no new table. **Caveat:**
  `lot_templates` is one row per topic, written once, cached forever — a new
  JD only affects topics not yet AI-written, never retroactive.
- College can post real job descriptions too (`PostJobDescription.tsx`, on
  `TpoHome.tsx`) — same `job_opportunities` table, `source: "college"`.
  **This needs migration `stage45_real_jd_lots` applied first — see below.**

**Not built:**

- The Recruiter role in full — discovery, proof profile, shortlist, sponsored
  tasks, hiring outcomes (steps 19–21 of the master flow)
- Server-side speech-to-text (the browser writes the transcript today —
  checked this session, confirmed this is intentional and sufficient, not a
  gap)
- Per-student improvement reports at the end of a season
- Crawl4AI / automated scraping for job postings — wanted eventually "for
  real," not manual paste. Recommended path (not yet built): free public
  job-board APIs (Greenhouse, Lever, RemoteOK) instead of general scraping —
  no new server, no ToS risk.
- Per-topic Elo-style skill rating (800–2200) with adaptive topic selection,
  replacing the fixed 146-step ladder order. This is the Master Spec's core
  idea but is NOT built and needs its own separate scoping — it's the one
  change that could break current student progression if done carelessly.
- WhatsApp notifications — deprioritized, no business account exists.

**Written but deliberately NOT applied to the live database** (two migration
files sitting in `supabase/migrations/`, held back on purpose — decide with
the project owner before applying):

- `20260917000000_stage45_real_jd_lots.sql` — fixes `job_opportunities_post`
  RLS (today it only allows `source = 'startup'`, so Admin's own "Add New
  Job" button and the new College "Post Job Description" button both get
  silently rejected by RLS) and extends the `source` check constraint to
  allow `'college'`. **Without this, college job-posting and admin
  job-posting are both broken at the DB level.**
- `20260915000000_stage43_fundamentals_prompting_placement_prep.sql` — seeds
  5 new tracks into `level_tracks`/`levels`: Prompt Engineering (Prompt
  Basics, Few-Shot, Chain-of-Thought, System Prompts, Structured Output, RAG
  Basics, **Agentic Loops** [agentic/tool-use looping, not for/while loop
  syntax], Evaluating Prompts) and the non-technical placement-prep branch —
  Quantitative Aptitude, Logical Reasoning, Verbal Ability, HR & Behavioral
  Prep. `StudentWizard.tsx` already lists these as onboarding interests.
  **Without this migration, those interests exist in the UI with no track
  data behind them.**

**Fixed live this session** (already applied, already in `main`):

- `tasks_assigned_read` RLS policy on `public.tasks` compared
  `task_assignments.task_id = task_assignments.id` — always false, never
  actually checked the `tasks` row. Effect: any admin-assigned task that
  wasn't public visibility was invisible to the student it was assigned to
  (silently returned null through the embedded join in
  `useAllStudentTasks.tsx`). Migration
  `20260916000000_stage44_fix_tasks_assigned_read.sql`.

**Security/performance audit — started, not finished** (`get_advisors` via
Supabase MCP). Still open:

- 3 views (`admin_users`, `llm_usage_by_student`, `public_resume_scorecards`)
  have `security_invoker=off` (ERROR-level lint). First two have their own
  internal `WHERE is_admin()` clause so are probably not exploitable, but
  should still get `security_invoker=on` for defense-in-depth.
  `public_resume_scorecards` is reachable by `anon` (logged-out) and filters
  on `student_portfolios.is_public = true` — looks intentional but confirm
  with the project owner before deciding whether to restrict it.
- 66+14 WARN `security_definer_function` lints — not reviewed yet.
- 6 tables with RLS on and zero policies (`ai_templates`,
  `conceptual_answer_keys`, `level_content`, `llm_cache`, `llm_usage`,
  `rate_limits`) — fine if only edge functions (service_role) touch them,
  need to confirm nothing expects direct client access.
- `auth_leaked_password_protection` WARN — Supabase dashboard setting, not a
  migration fix.
- Not yet run: a fresh `npm run build`, and a browser click-through of
  admin-assigns-private-task → student-sees-it, college-posts-JD →
  admin-sees-it-in-Manage-Jobs, recruiter-shortlist → student-visibility.

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
