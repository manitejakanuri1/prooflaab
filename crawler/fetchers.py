"""Getting readable text out of a URL, whatever kind of URL it is.

Replaces Crawl4AI, which drove a local Chromium. That worked, but it meant a
browser download on every run, and it only ever handled web pages.

Each fetcher returns (content, title, kind) where kind is 'html' or 'markdown',
because the caller must know whether to run an article extractor over it. Jina
and the platform APIs already return clean text; running trafilatura over
markdown would strip most of it.

On agent-reach, which this was going to use: for plain web pages its own
documentation says it calls Jina Reader with "no wrapper layer", and that is
what happens below. The rest of it is a CLI that installs Node, the GitHub CLI
and mcporter so an AI agent on a laptop can reach Twitter and Xiaohongshu. This
crawler runs in GitHub Actions on a fresh machine every week to read five
public pages, so installing four tools each run to obtain one HTTP call would
cost minutes and buy nothing. If Twitter or Xiaohongshu ever become sources,
that is the moment to revisit it.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlparse

import httpx

USER_AGENT = "ProofLabAI-Crawler/1.0 (+https://prooflab.co.in)"
TIMEOUT = 45

# Jina Reader fronts any URL and returns markdown. Free, no key, no account.
JINA = "https://r.jina.ai/"


class Fetched(tuple):
    """(content, title, kind). A tuple so existing unpacking keeps working."""

    def __new__(cls, content: str, title: str, kind: str):
        return super().__new__(cls, (content, title, kind))


# ---------------------------------------------------------------------------
# which fetcher handles which URL
# ---------------------------------------------------------------------------

def platform_for(url: str) -> str:
    """The kind of source this URL is, decided from the address alone."""
    host = (urlparse(url).netloc or "").lower().removeprefix("www.")

    if host in ("github.com", "gist.github.com"):
        return "github"
    if host in ("youtube.com", "m.youtube.com", "youtu.be"):
        return "youtube"
    if host in ("reddit.com", "old.reddit.com", "np.reddit.com"):
        return "reddit"
    path = (urlparse(url).path or "").lower()
    if path.endswith((".rss", ".xml", ".atom")) or "/feed" in path or "/rss" in path:
        return "rss"
    return "web"


# ---------------------------------------------------------------------------
# web pages
# ---------------------------------------------------------------------------

def fetch_web(url: str) -> Fetched | None:
    """A web page as markdown, via Jina Reader.

    Jina prefixes the body with `Title:`, `URL Source:` and `Markdown Content:`
    lines. The title is taken from there rather than parsed out of HTML, and the
    preamble is stripped so it does not end up hashed as part of the content -
    it would make two genuinely different pages look more alike than they are.
    """
    try:
        r = httpx.get(
            JINA + url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/plain"},
            timeout=TIMEOUT,
            follow_redirects=True,
        )
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or not r.text.strip():
        return None

    body = r.text
    title = ""
    match = re.match(r"Title:\s*(.+)", body)
    if match:
        title = match.group(1).strip()

    # Jina returns 200 with the upstream error page inside it, so the status
    # code alone cannot be trusted. A short body whose title announces an error
    # is not content, and storing it would put "Error 404 (Not Found)!!1" in
    # front of a student.
    if len(body) < 600 and re.search(r"(4\d\d|5\d\d)|not found|forbidden", title, re.I):
        return None

    marker = "Markdown Content:"
    if marker in body:
        body = body.split(marker, 1)[1].lstrip()

    return Fetched(body, title, "markdown")


def fetch_web_raw(url: str) -> Fetched | None:
    """The page's own HTML, as a fallback when Jina is unavailable.

    Kept because Jina is a third party: if it is down or rate-limiting, a plain
    GET still works for the static pages that make up most of the registry.
    """
    try:
        r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
        return None

    title = ""
    if "<title>" in r.text:
        title = r.text.split("<title>", 1)[1].split("</title>", 1)[0].strip()
    return Fetched(r.text, title, "html")


# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------

def fetch_github(url: str) -> Fetched | None:
    """A repository's README, through the public API.

    No token needed for public repositories. GITHUB_PAT is used when present
    only to lift the hourly rate limit, which matters if the registry ever
    holds more than a handful of repos.
    """
    import os

    parts = [p for p in urlparse(url).path.split("/") if p]
    if len(parts) < 2:
        return None
    owner, repo = parts[0], parts[1].removesuffix(".git")

    headers = {"User-Agent": USER_AGENT, "Accept": "application/vnd.github.raw+json"}
    token = os.environ.get("GITHUB_PAT")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        r = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo}/readme",
            headers=headers, timeout=TIMEOUT, follow_redirects=True,
        )
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or not r.text.strip():
        return None

    return Fetched(r.text, f"{owner}/{repo}", "markdown")


# ---------------------------------------------------------------------------
# YouTube
# ---------------------------------------------------------------------------

def fetch_youtube(url: str) -> Fetched | None:
    """A video's transcript, which is the only part worth turning into questions."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
    except ImportError:
        return None

    parsed = urlparse(url)
    if parsed.netloc.endswith("youtu.be"):
        video_id = parsed.path.lstrip("/")
    else:
        match = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", url)
        video_id = match.group(1) if match else ""
    if not video_id:
        return None

    try:
        parts = YouTubeTranscriptApi.get_transcript(video_id)
    except Exception:
        # No captions, captions disabled, or the video is gone. All the same
        # outcome here: nothing to read.
        return None

    text = " ".join(p.get("text", "") for p in parts).strip()
    if not text:
        return None

    title = ""
    try:
        meta = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            headers={"User-Agent": USER_AGENT}, timeout=20,
        )
        if meta.status_code == 200:
            title = meta.json().get("title", "")
    except (httpx.HTTPError, json.JSONDecodeError):
        pass

    return Fetched(text, title, "markdown")


# ---------------------------------------------------------------------------
# Reddit
# ---------------------------------------------------------------------------

def fetch_reddit(url: str) -> Fetched | None:
    """A thread, through Reddit's JSON view.

    Reddit has tightened this repeatedly. As of September 2026, www.reddit.com
    answers an unauthenticated caller with 403 and an HTML block page, and
    old.reddit.com returns HTML for a listing rather than JSON. Individual
    thread URLs may still work; listings do not.

    It is left in place because it costs nothing and may come back, and it fails
    cleanly - returning None, so the URL is reported as fetch_failed rather than
    storing a block page as if it were content. No Reddit source is in the
    registry today. If one is wanted, it needs a registered Reddit app and an
    OAuth token, which is a decision about accounts rather than code.
    """
    # www.reddit.com answers a non-browser caller with a 403 and an HTML block
    # page; old.reddit.com serves the same thread as JSON without complaint.
    base = url.split("?")[0].rstrip("/")
    base = base.replace("://www.reddit.com", "://old.reddit.com")
    base = base.replace("://reddit.com", "://old.reddit.com")
    base = base.replace("://np.reddit.com", "://old.reddit.com")
    api = base if base.endswith(".json") else base + ".json"
    try:
        r = httpx.get(api, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None

    # A block page is served with 200 and text/html, so the content type is
    # checked rather than trusting the status.
    if "json" not in r.headers.get("content-type", ""):
        return None
    try:
        data = r.json()
    except json.JSONDecodeError:
        return None
    if not isinstance(data, list) or not data:
        return None

    post = (data[0].get("data", {}).get("children") or [{}])[0].get("data", {})
    title = post.get("title", "")
    pieces = [title, post.get("selftext", "")]

    # Top-level replies only. Deeper threads are mostly argument, and the point
    # is the question and the answers to it.
    if len(data) > 1:
        for child in (data[1].get("data", {}).get("children") or [])[:25]:
            body = child.get("data", {}).get("body")
            if body:
                pieces.append(body)

    text = "\n\n".join(p for p in pieces if p).strip()
    return Fetched(text, title, "markdown") if text else None


# ---------------------------------------------------------------------------
# RSS
# ---------------------------------------------------------------------------

def fetch_rss(url: str) -> Fetched | None:
    """A feed, flattened into one document of its entries."""
    try:
        import feedparser
    except ImportError:
        return None

    feed = feedparser.parse(url)
    if getattr(feed, "bozo", 0) and not feed.entries:
        return None

    title = getattr(feed.feed, "title", "") if hasattr(feed, "feed") else ""
    pieces = []
    for entry in feed.entries[:30]:
        heading = entry.get("title", "")
        summary = entry.get("summary", "") or entry.get("description", "")
        if heading or summary:
            pieces.append(f"## {heading}\n\n{summary}")

    text = "\n\n".join(pieces).strip()
    return Fetched(text, title, "markdown") if text else None


# ---------------------------------------------------------------------------
# the one entry point the crawler calls
# ---------------------------------------------------------------------------

FETCHERS = {
    "github": fetch_github,
    "youtube": fetch_youtube,
    "reddit": fetch_reddit,
    "rss": fetch_rss,
    "web": fetch_web,
}


def fetch(url: str) -> tuple[Fetched, str] | None:
    """(Fetched, method) for any supported URL, or None if nothing could be read.

    `method` is recorded on the row, so a later question about where a piece of
    content came from has an answer without guessing from the address.
    """
    platform = platform_for(url)
    fetched = FETCHERS[platform](url)

    if fetched is None and platform == "web":
        # Jina is a third party and this crawler should not stop when it has a
        # bad day. The page's own HTML is enough for the static pages that make
        # up most of the registry.
        fetched = fetch_web_raw(url)
        if fetched is not None:
            return fetched, "web-raw"

    return (fetched, platform) if fetched is not None else None
