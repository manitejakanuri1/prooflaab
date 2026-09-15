"""Prove each agent-reach tool can actually read from where the crawler runs.

agent-reach's doctor says whether a tool is installed. That is not the same as
working: YouTube in particular refuses many data-centre addresses, and a doctor
run cannot tell. This reads one real thing per tool and says what came back.

    python tools_check.py        (on Cloud Run: --command=python --args=tools_check.py)
"""
import crawl
from fetchers import fetch_github, fetch_rss, fetch_web, fetch_youtube, fetch_youtube_ytdlp

CHECKS = [
    ("web (Jina Reader)", fetch_web, "https://docs.python.org/3/tutorial/introduction.html"),
    ("GitHub (gh CLI)", fetch_github, "https://github.com/public-apis/public-apis"),
    ("RSS (feedparser)", fetch_rss, "https://realpython.com/atom.xml"),
    ("YouTube (yt-dlp)", fetch_youtube_ytdlp, "https://www.youtube.com/watch?v=rfscVS0vtbw"),
    ("YouTube (any route)", fetch_youtube, "https://www.youtube.com/watch?v=rfscVS0vtbw"),
]

if __name__ == "__main__":
    crawl.report_tools()
    print("--- live reads ---")
    for label, fn, url in CHECKS:
        try:
            got = fn(url)
        except Exception as err:  # a check, not the crawler: report and carry on
            print(f"{label:22} ERROR {type(err).__name__}: {err}")
            continue
        if got is None:
            print(f"{label:22} FAILED  nothing readable from {url}")
        else:
            content, title, _ = got
            print(f"{label:22} OK      {len(content):>7} chars  {title[:60]!r}")
