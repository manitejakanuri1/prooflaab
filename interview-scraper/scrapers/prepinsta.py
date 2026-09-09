"""PrepInsta company interview-experience pages.

Real page structure (checked live against prepinsta.com/tcs-interview-experience/
before writing this, not guessed): a WordPress/Elementor blog page. Each
round is an <h3>Round N:- ...</h3> heading; each question is bold text
(<strong>) directly under it, usually "N. <question text>" or
"Question N: <question text>". No distinctive CSS class exists for
"question" — a CSS-selector schema would return nothing on this site, so
this uses a markdown + regex heuristic instead, verified against the real
page (25 real questions extracted correctly in testing).

robots.txt checked live: prepinsta.com disallows /interview-experience/*,
but that pattern doesn't match any of these URLs (they're top-level slugs
like /tcs-interview-experience/, not nested under /interview-experience/).
Confirmed clear to crawl.
"""
import re

from models import InterviewQuestion
from scrapers import fetch_static, to_markdown

SOURCE_SITE = "prepinsta"

# Confirmed real, live URLs (found via prepinsta.com's own homepage links).
# Add more by pasting any real prepinsta.com/*-interview-experience/ URL here.
SEED_URLS = [
    "https://prepinsta.com/tcs-interview-experience/",
    "https://prepinsta.com/interview-preparation/infosys-interview-experience/",
    "https://prepinsta.com/interview-preparation/accenture-interview-experience/",
    "https://prepinsta.com/interview-preparation/wipro-interview-experience/",
    "https://prepinsta.com/interview-preparation/capgemini-interview-experience/",
    "https://prepinsta.com/interview-preparation/cognizant-interview-experience/",
    "https://prepinsta.com/interview-preparation/deloitte-interview-experience/",
    "https://prepinsta.com/interview-preparation/microsoft-interview-experience/",
    "https://prepinsta.com/interview-preparation/paypal-interview-experience/",
    "https://prepinsta.com/interview-preparation/mindtree-interview-experience/",
]

_ROUND_SPLIT = re.compile(r"(?=^###\s.*Round\s*\d)", re.M | re.I)
_ROUND_NAME = re.compile(r"^###\s*(.+)")
_BOLD = re.compile(r"\*\*(.+?)\*\*")
_QUESTION_LIKE = re.compile(r"^(question\s*\d*[:.]?|\d+[.:])", re.I)
_YEAR = re.compile(r"\b(20\d{2})\b")

# Known acronyms that title-casing a slug would mangle (tcs -> Tcs, not TCS).
_ACRONYMS = {"tcs", "zs", "ibm", "hcl"}


def _company_from_url(url: str) -> str:
    slug = url.rstrip("/").split("/")[-1]
    slug = re.sub(r"-interview-experience$", "", slug)
    slug = re.sub(r"-coding-questions$", "", slug)
    words = slug.split("-")
    return " ".join(w.upper() if w in _ACRONYMS else w.capitalize() for w in words)


def _extract_questions(markdown: str, title: str, url: str) -> list[InterviewQuestion]:
    company = _company_from_url(url)
    year_match = _YEAR.search(title)
    year = int(year_match.group(1)) if year_match else None

    out: list[InterviewQuestion] = []
    for section in _ROUND_SPLIT.split(markdown):
        m = _ROUND_NAME.match(section.strip())
        round_name = m.group(1).strip() if m else None
        if round_name is None and out:
            continue  # text before the first Round heading isn't a question

        for bold in _BOLD.findall(section):
            text = bold.strip()
            if len(text) < 8:
                continue
            if not (_QUESTION_LIKE.match(text) or text.endswith("?")):
                continue
            # strip the leading "1." / "Question 2:" marker, keep the question itself
            text = _QUESTION_LIKE.sub("", text).strip(" .:")
            if len(text) < 8:
                continue
            out.append(InterviewQuestion(
                company=company, round=round_name, question=text,
                source_site=SOURCE_SITE, url=url, year=year,
            ))
    return out


def scrape_page(url: str) -> list[InterviewQuestion]:
    html = fetch_static(url)
    if html is None:
        return []
    title_match = re.search(r"<title>([^<]*)</title>", html)
    title = title_match.group(1) if title_match else ""
    markdown = to_markdown(html)
    return _extract_questions(markdown, title, url)


def scrape_all() -> list[InterviewQuestion]:
    results: list[InterviewQuestion] = []
    for url in SEED_URLS:
        results.extend(scrape_page(url))
    return results
