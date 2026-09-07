# ProofLabAI — instructions for Claude

Loaded automatically in every session in this repository. Read
[START_HERE.md](START_HERE.md) for the full picture; this file is the part you
must not get wrong.

## What this is

A proof-of-skill platform. A college uploads a student CSV; each student gets
one real piece of work a day (a **Lot**), submits it, and explains it out loud
for sixty seconds. Work is scored, students compete in **squads** of eleven,
and the result is a proof profile a recruiter can inspect.

React + TypeScript + Vite · Supabase (Postgres, Auth, Storage) · 36 Deno edge
functions on DeepSeek · Vercel. Dashboards: Student, College/TPO, Admin and
Recruiter — all four are built. A recruiter signs themselves up and sees
nothing until an administrator approves them on Admin -> Recruiters.

## Hard rules

- **Never push to `origin`.** It is a different person's diverged fork
  (`Yashwanth-pilli/prooflabai-mvp`). Every push goes to `prooflaab`
  (`manitejakanuri1/prooflaab`). Do not offer to push to origin.
- **Never run `supabase db push`.** Apply migrations with the Supabase MCP
  `apply_migration`, then save the identical SQL into `supabase/migrations/`
  and commit it. The folder and the live database must stay the same thing.
- **The database is shared and live.** Two laptops work on this project. Ask
  before applying a migration if you are not certain this machine owns the
  database right now.
- **Delete nothing without asking** — data, branches, files, test fixtures.
- **Regenerate `src/integrations/supabase/types.ts`** after any schema change,
  or the editor will not know the new columns exist.
- **`strict: false`** in `tsconfig.app.json`. The typechecker will not catch a
  renamed or missing column. Prove work by running it against the live database
  with a real signed-in session — not by compiling.
- **After `revoke all on function … from public, anon, authenticated`, grant it
  back to `service_role` by name** if an edge function calls it. That revoke
  strips service_role too, because its EXECUTE came through PUBLIC. This has
  already caused two bugs.
- **Edge functions deploy separately:** `supabase functions deploy <name>`.

## How work is done here

Each machine has its own branch (`work/a`, `work/b`) and merges into `main`
when a piece is finished. Pushing `main` deploys the live site.

One commit per finished thing, with a message saying what was tested and what
came back. Report honestly: if something is half-done, say which half.

## Style

The owner is not a developer. Explain in plain English, prefer a diagram to a
paragraph, and give steps as numbered lists. Say what changed, what you tested,
and what you deliberately did not touch.
