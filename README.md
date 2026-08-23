# ProofLabAI

A proof-of-work platform for engineering students. A student is handed one real
piece of work a day, submits what they built, and explains it out loud for sixty
seconds. The platform judges whether they actually did it, and their college can
see who is moving and who has gone quiet.

Live at https://prooflaab.vercel.app

## The four roles

| Role | Lands on | Has |
| --- | --- | --- |
| Student | Daily Card | Build-Log, Squad, Profile |
| College / TPO | Home | Students, Squads, Insights |
| Admin | Overview | Students, colleges, proofs, tasks, system settings |
| Startup | Dashboard | Posts work, reviews submissions |

## Running it

Requires Node 18+.

```sh
npm install
npm run dev        # http://localhost:8080
npm run typecheck  # the same check the build gate runs
npm run build      # typecheck, then build — fails the build if types fail
```

The Supabase URL and publishable key are compiled into
`src/integrations/supabase/client.ts`, so no `.env` file is needed to run the app.

## Stack

- React 18 + TypeScript + Vite, Tailwind and shadcn/ui
- TanStack Query for server state, React Router v6
- Supabase — Postgres with row-level security, Auth, Storage
- 36 Deno edge functions in `supabase/functions`, on DeepSeek for anything generative
- Vercel hosting, deployed from `main`

## Working on the database

Migrations live in `supabase/migrations` and are applied through the Supabase
MCP tools, never `supabase db push`. Every applied change is saved back into that
folder and committed, so the folder and the live database stay the same thing.

Regenerate `src/integrations/supabase/types.ts` after any schema change — the
editor reads it to know what tables and columns exist.

## Deploying

```sh
git push prooflaab deploy/prooflaab:main   # Vercel builds automatically
supabase functions deploy <name>           # edge functions deploy separately
```

## What the docs in here are worth

`PROJECT_OVERVIEW.md`, `PROJECT_STATUS.md`, `RESUME_FEATURE_STATUS.md` and
`HANDOFF.md` describe the product per role and the end-to-end journey. The
product descriptions still hold. Any table, policy or row count in them is out of
date — read the live database instead.
