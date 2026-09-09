# Interview question scraper

Free, local, open-source. Pulls real company interview questions from
sites that actually allow it — checked live before building, not assumed.

## Sites, and why each is (or isn't) included

| Site | Status | Why |
|---|---|---|
| PrepInsta | ✅ included | robots.txt allows it, real content confirmed, extraction tested against a live page (25 real questions, correctly attributed to rounds) |
| GeeksforGeeks | ❌ not included | robots.txt explicitly blocks `anthropic-ai` from the entire site |
| BeyondLeet | ❌ not included | `beyondleet.com` is an unlaunched GoDaddy "coming soon" placeholder — no content exists there yet |
| LinkedIn, Naukri | ❌ never | CAPTCHA-walled / network-blocked for any automated request — not attempting to bypass either |

## Setup

```sh
cd E:/Projects/prooflab-interview-scraper
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
cp .env.example .env
```

No API keys needed. No proxy needed. `.env` defaults work as-is.

## Run

```sh
.venv/Scripts/python main.py
```

Writes `output/prepinsta_questions.json` and `output/all_interview_questions.json`.

## Adding a new site

1. Check its `robots.txt` for your crawler's user agent first — if it
   blocks AI crawlers by name or blocks the pages you want, stop, don't
   build it.
2. Fetch one real page and look at the actual HTML — don't guess CSS
   selectors. `curl` it, look for real patterns (heading tags, bold text,
   whatever actually marks a question on that specific site).
3. Write `scrapers/<site>.py` with a `scrape_all() -> list[InterviewQuestion]`,
   using `scrapers.fetch_static()` (or `fetch_browser()` if the site needs
   JS rendering — check that live too, don't assume).
4. Add it to `SCRAPERS` in `main.py`.
5. Test against a real page before trusting the output.

## What's honestly NOT filled in

`topics` and `difficulty` are left empty/`None` on every question. Getting
those right needs real classification (NLP or an LLM pass) — a guessed
topic tag is worse than no tag, so this doesn't fake it. Add a separate
enrichment pass later if you want them filled.

## Respecting robots.txt and terms

Every fetch checks `robots.txt` first (`scrapers/robots_allows()`) and
skips the page if disallowed. `MAX_PAGES_PER_DOMAIN` caps how much any one
site gets hit per run. Nothing here attempts to defeat CAPTCHAs, rotate
IPs to evade blocks, or fake being a different crawler than it is.
