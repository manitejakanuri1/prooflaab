"""ProofLabAI Crawl4AI collector.

Reads active rows from source_registry, fetches each seed_url (static
fetch first, browser render fallback for known_dynamic / failed static
fetches per Master Spec Section 07 / 17.02), dedupes against existing
source_content, and inserts new rows.

Standalone service. Does not touch the ProofLabAI app repo. Run manually
or on a schedule (cron / Task Scheduler) once SUPABASE_SERVICE_ROLE_KEY
is set in .env.

    python crawl.py
"""
import os
import time
import urllib.robotparser as robotparser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from markdownify import markdownify
from supabase import create_client

from dedupe import canonicalize_url, compute_simhash, content_hash, is_near_duplicate

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_AGENT = "ProofLabAI-Crawler/1.0 (+https://prooflab.ai)"
MIN_TEXT_CHARS = 200  # below this, static fetch is treated as a JS-shell and escalated to browser render

sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def robots_allows(url: str) -> bool:
    parsed = urlparse(url)
    rp = robotparser.RobotFileParser()
    rp.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
    try:
        rp.read()
    except Exception:
        return True  # no robots.txt reachable -> not blocked
    return rp.can_fetch(USER_AGENT, url)


def static_fetch(url: str) -> tuple[str, str] | None:
    """Returns (html, title) or None if the page needs browser rendering."""
    try:
        r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=15, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
        return None
    html = r.text
    text_len = len(markdownify(html).strip())
    if text_len < MIN_TEXT_CHARS:
        return None  # likely a JS-rendered shell
    title = ""
    if "<title>" in html:
        title = html.split("<title>", 1)[1].split("</title>", 1)[0].strip()
    return html, title


def browser_fetch(url: str) -> tuple[str, str] | None:
    """Crawl4AI browser render, for known_dynamic sources or static-fetch failures."""
    import asyncio
    from crawl4ai import AsyncWebCrawler

    async def _run():
        async with AsyncWebCrawler(verbose=False) as crawler:
            result = await crawler.arun(url=url)
            return result

    result = asyncio.run(_run())
    if not result or not result.success:
        return None
    return result.html, (result.metadata or {}).get("title", "")


def existing_for_source(source_id: str) -> list[dict]:
    res = sb.table("source_content").select("content_hash,simhash").eq("source_id", source_id).execute()
    return res.data or []


def process_url(source: dict, url: str, existing: list[dict]) -> str:
    """Returns a short status string for logging."""
    if not robots_allows(url):
        return "blocked_by_robots"

    fetched = None
    fetch_method = "static"
    if not source["known_dynamic"]:
        fetched = static_fetch(url)
    if fetched is None:
        fetched = browser_fetch(url)
        fetch_method = "browser"
    if fetched is None:
        return "fetch_failed"

    html, title = fetched
    markdown = markdownify(html).strip()
    if len(markdown) < MIN_TEXT_CHARS:
        return "too_short"

    c_hash = content_hash(markdown)
    s_hash = compute_simhash(markdown)

    if any(row["content_hash"] == c_hash for row in existing):
        return "exact_duplicate"
    if any(row["simhash"] is not None and is_near_duplicate(s_hash, row["simhash"]) for row in existing):
        return "near_duplicate"

    sb.table("source_content").insert({
        "source_id": source["id"],
        "url": url,
        "canonical_url": canonicalize_url(url),
        "title": title[:500] if title else None,
        "markdown": markdown,
        "content_hash": c_hash,
        "simhash": s_hash,
        "fetch_method": fetch_method,
        "rights_flag": source["rights_flag"],
    }).execute()
    existing.append({"content_hash": c_hash, "simhash": s_hash})
    return "inserted"


def run() -> None:
    sources = sb.table("source_registry").select("*").is_("retired_at", "null").execute().data or []
    print(f"{len(sources)} active source(s) in source_registry")

    for source in sources:
        if source["rights_flag"] == "BLOCKED_SOURCE":
            print(f"[{source['domain']}] skipped: BLOCKED_SOURCE")
            continue

        existing = existing_for_source(source["id"])
        delay = 60.0 / max(source["rate_limit_per_min"], 1)

        for url in source["seed_urls"]:
            status = process_url(source, url, existing)
            print(f"[{source['domain']}] {url} -> {status}")
            time.sleep(delay)


if __name__ == "__main__":
    run()
