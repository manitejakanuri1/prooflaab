# Deploying

`git push` alone does **not** deploy this project. It never has. This explains why,
and what to do instead.

## Why pushing is not enough

The Vercel team is on the **Hobby** plan. Hobby only builds a *production*
deployment when the git commit author is the Hobby team owner
(`prooflaab@gmail.com` / `manitejakanuri1`). A commit authored by anyone else
comes back `state: BLOCKED` and never builds — no error in GitHub, no failed
check to click, just a deployment that quietly never happens.

Vercel's own wording, from *Troubleshoot project collaboration*:

> To deploy commits under a Hobby team, the commit author must be the owner of
> the Hobby team containing the Vercel project connected to the Git repository.

There is no setting that turns this off. The only true fixes are the Pro plan or
making the repository public, and neither is available here.

## What was actually tested

Guessing here wastes hours, so these were all tried against the real project:

| Trigger | Target | Result |
| --- | --- | --- |
| `git push` (GitHub webhook) | production | **BLOCKED** |
| Deploy Hook (`POST` to hook URL) | production | **BLOCKED** — author is still resolved from branch HEAD |
| Vercel API, `target: preview` | preview | **READY** |
| Promote that preview → production | production | **READY** |

Two useful conclusions:

- The check applies to **production** deployments, not previews.
- **Promoting** an already-built preview does not re-run the check.

Deploy hooks look like the obvious answer and are not. They were tried and
revoked again.

## How to deploy

### Option A — the script (recommended)

```bash
git push                       # get your commits onto main first
export VERCEL_TOKEN=...        # https://vercel.com/account/settings/tokens
./scripts/deploy.sh
```

It builds `main` as a preview, waits for the build, then promotes it to
production. A Vercel API token is free on Hobby and belongs to whoever creates
it — the owner's token is not required.

### Option B — by hand, in the dashboard

1. Push to `main`.
2. Open the project on Vercel → **Deployments**.
3. Find the latest `main` deployment. If it says **BLOCKED**, that is the author
   check — ignore it, it will never build.
4. Trigger a fresh **preview** build of `main` (any API/tool route that creates a
   preview works; the blocked one cannot be revived).
5. On the preview that reaches **Ready**: `⋯` → **Promote to Production** →
   confirm.

### Option C — have the owner author the commit

If `manitejakanuri1` makes the commit themselves, the normal `git push` flow
works with no extra steps. An empty commit is enough to carry someone else's
already-pushed work:

```bash
git pull
git commit --allow-empty -m "Trigger deploy"
git push
```

## Always confirm it actually shipped

A promote can succeed while the browser still serves the old bundle from cache.
Check the hash actually changed:

```bash
curl -s https://prooflaab.vercel.app/ | grep -oE 'assets/index-[^"]+\.js'
```

Compare it with your local `npm run build` output — if the hashes match, the
deployed code is exactly what you built.

## Database changes

Schema and data changes are **not** deployed by Vercel. They go to Supabase
separately, as migrations in `supabase/migrations/`.

One caveat worth knowing: the repo's migration filenames and Supabase's applied
-migration ledger use different version numbers (the folder was renamed and
reorganised at some point). Every repo migration has been registered in the
ledger so the two agree, but if you add migrations, apply them as migrations
rather than pasting SQL into the dashboard — otherwise the ledger drifts again
and a future `supabase db push` tries to re-run work that is already applied.
