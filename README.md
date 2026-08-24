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

## Running it in Docker

For a second machine, or any machine where you would rather not match Node
versions by hand. Install Docker Desktop, then:

```sh
git clone https://github.com/manitejakanuri1/prooflaab.git
cd prooflaab
docker compose up
```

The app is on http://localhost:8080 and reloads when you edit a file.

```sh
docker compose up --build      # after package.json changes
docker compose exec web sh     # a shell inside the container
docker compose down            # stop
```

Nothing else is needed: the Supabase URL and publishable key are compiled into
the client, so there is no .env to copy between machines. Two things do not
live in the container and are per-machine: your GitHub credentials for pushing,
and `supabase login` if you intend to deploy edge functions from there.

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
