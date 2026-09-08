# prooflab-crawler

Standalone Crawl4AI collector for ProofLabAI, per Master Spec Section 07.
Feeds `source_registry` -> `source_content`. Does not touch the main app
repo. Local only — nothing here is pushed or deployed yet.

## What it does

For each active row in `source_registry`:
1. Fetch each `seed_url` — static HTTP fetch first (`httpx`), no browser cost.
2. Escalate to Crawl4AI browser rendering if `known_dynamic` is true, or
   the static fetch comes back empty/JS-shell.
3. Convert to Markdown, hash it (SHA-256 exact + SimHash near-dup).
4. Skip exact and near-duplicates already in `source_content`.
5. Insert the new row, carrying the source's `rights_flag`.

Respects `robots.txt` and each source's `rate_limit_per_min`. Only crawls
the literal `seed_urls` — no recursive spidering (`max_depth` in the schema
is not used yet; add when a source needs more than its seed pages).

## Setup

```sh
cd E:/Projects/prooflab-crawler
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/crawl4ai-setup   # one-time: downloads Chromium for the browser-render path
cp .env.example .env
```

Edit `.env` and paste your Supabase **service role** key (Project Settings
-> API -> service_role). `source_content` has RLS with no policies, so
only the service role can write to it — this key never goes near the
frontend or the git repo.

## Run

```sh
.venv/Scripts/python crawl.py
```

Prints one line per URL: `inserted`, `exact_duplicate`, `near_duplicate`,
`blocked_by_robots`, `fetch_failed`, or `too_short`.

## Self-check (no network, no DB)

```sh
.venv/Scripts/python dedupe.py
```

## Adding sources

Not this service's job — `source_registry` rows are managed wherever the
app's admin source-registry screen (or direct SQL/Supabase MCP) writes
them. This script only reads `retired_at is null` rows and crawls their
`seed_urls`.

## Not built here (matches HANDOFF.md's scope for "the collector")

- AI question enrichment (DeepSeek) — separate worker, reads `source_content`
- Quality gates, question bank — separate workers
- Scheduling — run manually or wire to cron / Task Scheduler yourself
- Deployment to the new server — explicitly on hold, everything here stays local until you say go
