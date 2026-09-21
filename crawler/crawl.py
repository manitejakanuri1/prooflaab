"""ProofLabAI content collector.

Reads active rows from source_registry, fetches each seed_url, dedupes against
what is already stored, and inserts new rows into source_content. The app turns
those rows into a student's daily Lot.

Two things changed when the platform moved to Google:

  * The fetch engine is no longer Crawl4AI. It drove a local Chromium, which
    meant a browser download on every run and only ever handled web pages.
    fetchers.py now covers web pages, GitHub, YouTube transcripts, Reddit and
    RSS, all over plain HTTP.
  * The destination is Cloud SQL through PostgREST, not Supabase. Writing to the
    old database would have failed silently - every run reporting success while
    students saw no new material.

Unchanged on purpose: robots.txt, the per-source rate limit, the dedupe rules in
dedupe.py, the shape of source_registry, and everything downstream that reads
source_content.

    python crawl.py
"""
import os
import time
import urllib.robotparser as robotparser
from urllib.parse import urlparse

import httpx
import trafilatura
from dotenv import load_dotenv
from markdownify import markdownify

from db import Database
from dedupe import canonicalize_url, compute_simhash, content_hash, is_near_duplicate
from fetchers import USER_AGENT, fetch

load_dotenv()

# Below this, whatever came back is a navigation shell or an error page rather
# than something worth asking a student about.
MIN_TEXT_CHARS = 200

db = Database()


ROBOTS_TIMEOUT = 15
_robots: dict[str, "robotparser.RobotFileParser | bool"] = {}


def robots_allows(url: str) -> bool:
    """May our crawler read this page, according to the site's robots.txt?

    Asked with our own name, with a time limit. urllib's RobotFileParser.read() has no time
    limit: Naukri's server holds that connection open, and the weekly job sat there for 30
    minutes. A site that refuses our name (403), errors (5xx) or does not answer in time is
    skipped this week: better a skipped page than reading around a block. Only a missing
    robots.txt (404/410) means "no rules".
    """
    parsed = urlparse(url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    if host not in _robots:
        try:
            r = httpx.get(f"{host}/robots.txt", headers={"User-Agent": USER_AGENT},
                          timeout=ROBOTS_TIMEOUT, follow_redirects=True)
        except Exception:
            _robots[host] = False
        else:
            if r.status_code in (404, 410):
                _robots[host] = True
            elif r.status_code != 200:
                _robots[host] = False
            else:
                rp = robotparser.RobotFileParser()
                rp.parse(r.text.splitlines())
                _robots[host] = rp
    rules = _robots[host]
    if isinstance(rules, bool):
        return rules
    return rules.can_fetch(USER_AGENT, url)


def to_markdown(content: str, kind: str) -> str:
    """Article text, whatever shape the fetcher handed back.

    A real bug found live, and the reason extraction happens at all: hashing a
    whole page - nav, footer, sidebar - makes every page on a site read as a
    near-duplicate of every other, because shared template text swamps the
    actual content. Measured on prepinsta.com: 1-3 bits apart for genuinely
    different pages, 10-14 once the boilerplate is stripped.

    Markdown from Jina or a platform API is already just the content, so running
    an HTML extractor over it would strip most of it and leave nothing to hash.
    """
    if kind == "markdown":
        return content.strip()
    return trafilatura.extract(content, output_format="markdown") or markdownify(content).strip()


def process_url(source: dict, url: str, existing: list[dict]) -> str:
    """Returns a short status string for logging."""
    if not robots_allows(url):
        return "blocked_by_robots"

    result = fetch(url)
    if result is None:
        return "fetch_failed"

    (content, title, kind), method = result
    markdown = to_markdown(content, kind)
    if len(markdown) < MIN_TEXT_CHARS:
        return "too_short"

    c_hash = content_hash(markdown)
    s_hash = compute_simhash(markdown)
    canonical = canonicalize_url(url)

    row = {
        "source_id": source["id"],
        "url": url,
        "canonical_url": canonical,
        "title": title[:500] if title else None,
        "markdown": markdown,
        "content_hash": c_hash,
        "simhash": s_hash,
        "fetch_method": method,
        "rights_flag": source["rights_flag"],
    }

    # Has this exact page been stored before? Content hashing alone cannot
    # answer that: change how the text is extracted - as the move off Crawl4AI
    # did - and the same page produces different text, so it reads as new. The
    # first run after that change stored thirteen pages twice, and a student
    # would have been served the same material under two names.
    #
    # The address is what identifies a page. Same address means the same page,
    # updated rather than added, which is also what makes "re-crawl to catch
    # changes" work at all.
    for prior in existing:
        if prior.get("canonical_url") != canonical:
            continue
        if prior["content_hash"] == c_hash:
            return "unchanged"
        db.update_content(prior["id"], row)
        prior["content_hash"] = c_hash
        prior["simhash"] = s_hash
        return f"updated ({method})"

    if any(r["content_hash"] == c_hash for r in existing):
        return "exact_duplicate"
    if any(r["simhash"] is not None and is_near_duplicate(s_hash, r["simhash"]) for r in existing):
        return "near_duplicate"

    db.insert_content(row)
    existing.append({"id": None, "canonical_url": canonical,
                     "content_hash": c_hash, "simhash": s_hash})
    return f"inserted ({method})"


def run() -> None:
    print(f"writing to {db.describe()}")
    sources = db.active_sources()
    print(f"{len(sources)} active source(s) in source_registry")

    for source in sources:
        if source["rights_flag"] == "BLOCKED_SOURCE":
            print(f"[{source['domain']}] skipped: BLOCKED_SOURCE")
            continue

        try:
            existing = db.existing_for_source(source["id"])
        except Exception as err:
            # Skip this source, keep the others. Without this a single failed
            # read ended the whole crawl, and the sources after it in the list
            # were never even attempted.
            print(f"[{source['domain']}] skipped: could not read what is already stored - {str(err)[:100]}")
            continue

        delay = 60.0 / max(source["rate_limit_per_min"], 1)

        for url in source["seed_urls"] or []:
            try:
                status = process_url(source, url, existing)
            except Exception as err:
                # One bad URL must not end the run. The next source may be fine,
                # and a half-finished crawl is worse than a reported failure.
                status = f"error: {str(err)[:120]}"
            print(f"[{source['domain']}] {url} -> {status}")
            time.sleep(delay)


def report_tools() -> None:
    """Print agent-reach's health check, so each run's log says what it could reach."""
    import shutil
    import subprocess

    if not shutil.which("agent-reach"):
        print("agent-reach: not installed here - using plain HTTP fallbacks")
        return
    try:
        out = subprocess.run(["agent-reach", "doctor"], capture_output=True, text=True, timeout=120)
        print(out.stdout.strip() or out.stderr.strip())
    except (subprocess.TimeoutExpired, OSError) as err:
        print(f"agent-reach doctor could not run: {err}")


if __name__ == "__main__":
    report_tools()
    run()
