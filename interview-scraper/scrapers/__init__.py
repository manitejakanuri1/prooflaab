"""Shared fetch helpers. Static-fetch-first, same pattern as the rest of
the project's crawler: no browser cost unless a page actually needs it.

Real page inspection (not guessed): PrepInsta pages are plain server-rendered
WordPress/Elementor HTML with no JS-rendering requirement, so httpx alone
is enough — checked live before writing this. The Crawl4AI browser fallback
below exists for a future site that does need it, and is untested here
because nothing in this scraper currently needs it.
"""
import urllib.robotparser as robotparser
from urllib.parse import urlparse

import httpx
from markdownify import markdownify

from config import MAX_PAGES_PER_DOMAIN, PROXY_URL, REQUEST_TIMEOUT, USER_AGENT

# ponytail: process-lifetime dict, not a DB/cache library, for a script
# that runs once and exits.
_pages_fetched_per_domain: dict[str, int] = {}


def robots_allows(url: str) -> bool:
    parsed = urlparse(url)
    rp = robotparser.RobotFileParser()
    rp.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
    try:
        rp.read()
    except Exception:
        return True
    return rp.can_fetch(USER_AGENT, url)


def _under_page_budget(url: str) -> bool:
    domain = urlparse(url).netloc
    n = _pages_fetched_per_domain.get(domain, 0)
    if n >= MAX_PAGES_PER_DOMAIN:
        return False
    _pages_fetched_per_domain[domain] = n + 1
    return True


def fetch_static(url: str) -> str | None:
    """Plain HTTP GET. Returns raw HTML, or None if blocked/failed/empty."""
    if not robots_allows(url) or not _under_page_budget(url):
        return None
    kwargs = {"headers": {"User-Agent": USER_AGENT}, "timeout": REQUEST_TIMEOUT, "follow_redirects": True}
    if PROXY_URL:
        kwargs["proxy"] = PROXY_URL
    try:
        r = httpx.get(url, **kwargs)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
        return None
    return r.text


async def fetch_browser(url: str) -> str | None:
    """Crawl4AI browser render. Only for a site that genuinely needs JS —
    costs real time/CPU, so callers should try fetch_static() first."""
    if not robots_allows(url) or not _under_page_budget(url):
        return None
    from crawl4ai import AsyncWebCrawler

    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(url=url)
    return result.html if result and result.success else None


def to_markdown(html: str) -> str:
    return markdownify(html, heading_style="ATX")
