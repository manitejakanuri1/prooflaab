# ProofLabAI

> Working on a second machine, or with a different account?
> Read **[CLAUDE.md](CLAUDE.md)** and **[docs/PRODUCTION-ARCHITECTURE.md](docs/PRODUCTION-ARCHITECTURE.md)** first (START_HERE.md is historical) — they carry the branch rules,
> the shared-database rule, and what is and is not built.


A proof-of-work platform for engineering students. A student is handed one real
piece of work a day, submits what they built, and explains it out loud for sixty
seconds. The platform judges whether they actually did it, and their college can
see who is moving and who has gone quiet.

Live at https://prooflab.co.in

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

Nothing else is needed: the public service addresses come from the committed
`.env*` files, so there is nothing secret to copy between machines. Your GitHub
credentials for pushing (and `gcloud` sign-in for operator work) stay per-machine.

## Stack

- React 18 + TypeScript + Vite, Tailwind and shadcn/ui; TanStack Query, React Router v6.
  The code still uses the `supabase-js` client, pointed at the Google Cloud services below.
- Google Cloud, project `prooflab-508214`, region `asia-south1`: Cloud SQL `prooflab-db`,
  PostgREST `prooflab-api`, Identity Platform + `prooflab-auth-bridge`, `prooflab-functions`
  (all Deno handlers in one service; AI = DeepSeek), `prooflab-files`, `prooflab-accounts`,
  `prooflab-transcriber` + private `prooflab-transcription-worker`, the code runner in its own
  project (`prooflab-runner-508214`), crawler and bug-finder jobs, Firebase Hosting.
- Supabase and Vercel are retired. Full picture: [docs/PRODUCTION-ARCHITECTURE.md](docs/PRODUCTION-ARCHITECTURE.md).

## Working on the database

Migrations are `migration/NN-*.sql` (self-check + rollback file) with an identical copy in
`supabase/migrations/`; `python scripts/migrations.py check` must pass. They are rehearsed on
staging and applied to production through the ledger wrapper - never `supabase db push`.
Regenerate `src/integrations/supabase/types.ts` after a schema change.

## Deploying

See [DEPLOYING.md](DEPLOYING.md). In short: a push to `main` on `prooflaab` publishes the
website (Firebase Hosting, after the CI gate); server services and the database are deployed
separately, by hand, with the owner's yes.

## What the docs in here are worth

`PROJECT_OVERVIEW.md`, `PROJECT_STATUS.md`, `RESUME_FEATURE_STATUS.md` and
`HANDOFF.md` describe the product per role and the end-to-end journey. The
product descriptions still hold. Any table, policy or row count in them is out of
date — read the live database instead.
