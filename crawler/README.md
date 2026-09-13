# ProofLabAI collector

Reads the addresses in `source_registry`, fetches each one, and stores the clean
text in `source_content`. The app turns those rows into a student's daily Lot.

## How a page is read

`fetchers.py` picks a reader from the address alone:

| Address | Reader | Notes |
|---|---|---|
| anything else | Jina Reader | returns markdown, free, no key |
| github.com | GitHub API | the repository readme |
| youtube.com, youtu.be | transcript API | the captions, not the page |
| *.rss, *.xml, /feed, /rss | feedparser | the entries, flattened |
| reddit.com | Reddit JSON | see the note below |

If Jina is unavailable, a plain GET of the page's own HTML is used instead, and
`trafilatura` extracts the article from it. That fallback is why the extractor is
still here: markdown from Jina is already just the content and is stored as-is.

**Reddit** currently fails cleanly and stores nothing. `www.reddit.com` answers
an unauthenticated caller with 403, and `old.reddit.com` returns HTML for a
listing. Making it work needs a registered Reddit app and an OAuth token, which
is a decision about accounts rather than code. No Reddit source is in the
registry today.

**On agent-reach.** For plain web pages its own documentation says it calls Jina
Reader with "no wrapper layer", which is exactly what happens here. The rest of
it is a CLI that installs Node, the GitHub CLI and mcporter so an AI agent on a
laptop can reach Twitter and Xiaohongshu. This crawler runs on a fresh GitHub
Actions machine every week to read a handful of public pages, so installing four
tools per run to obtain one HTTP call would cost minutes and buy nothing. If
Twitter or Xiaohongshu become sources, that is the moment to revisit it.

## What it writes to

`db.py`, and by default that is Cloud SQL through PostgREST - where the live site
reads. Set `BACKEND` to anything other than `google` to use Supabase instead.

    BACKEND=google
    POSTGREST_URL=https://prooflab-api-ysn2mpe6sa-el.a.run.app
    PGRST_JWT_SECRET=<the Google secret prooflab-jwt-secret>

Writing to the wrong database is the failure this guards against, because it is
silent: every run would report success while students saw no new material.

## Same page twice

A page is identified by its address, not by its text. Re-reading a stored page
updates that row; it never adds a second one. This matters more than it sounds:
when the fetch engine changed, the same pages produced different text and
thirteen of them were stored twice, which would have served a student the same
material under two names.

Outcomes printed per URL:

    inserted      a page not seen before
    updated       a stored page whose text has changed
    unchanged     a stored page that has not moved - the steady state
    near_duplicate  different address, near-identical text
    too_short     under 200 characters, so a shell or an error page
    fetch_failed  nothing readable came back
    blocked_by_robots

## Running it

    pip install -r requirements.txt
    python crawl.py

Weekly on Sundays via `.github/workflows/crawl.yml`. The only secret it needs is
`PGRST_JWT_SECRET`; `GITHUB_PAT` is optional and only lifts GitHub's rate limit.

## Left alone deliberately

`dedupe.py`, robots.txt, the per-source rate limit, the shape of
`source_registry`, and everything downstream that reads `source_content`.
