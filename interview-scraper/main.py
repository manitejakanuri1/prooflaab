"""Runs every scraper, writes one JSON per site plus a combined file.

    python main.py

To add a new site: write scrapers/<site>.py with a scrape_all() that
returns list[InterviewQuestion] (see scrapers/prepinsta.py for the
pattern), then add it to SCRAPERS below.
"""
import json
import time
from pathlib import Path

from config import OUTPUT_DIR
from models import InterviewQuestion
from scrapers import prepinsta

# GeeksforGeeks and BeyondLeet are not here on purpose:
#   - GFG's robots.txt disallows "anthropic-ai" from the entire site.
#   - beyondleet.com is an unlaunched GoDaddy "coming soon" page, no content.
# Checked live before deciding this, not assumed. Add a new module here
# once a real, crawlable site is found and verified the same way.
SCRAPERS = {
    "prepinsta": prepinsta.scrape_all,
}


def main() -> None:
    out_dir = Path(OUTPUT_DIR)
    out_dir.mkdir(exist_ok=True)

    all_questions: list[InterviewQuestion] = []
    for site, scrape_fn in SCRAPERS.items():
        print(f"--- {site} ---")
        t0 = time.time()
        questions = scrape_fn()
        print(f"{len(questions)} questions in {time.time() - t0:.1f}s")

        site_path = out_dir / f"{site}_questions.json"
        site_path.write_text(
            json.dumps([q.model_dump() for q in questions], indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        all_questions.extend(questions)

    combined_path = out_dir / "all_interview_questions.json"
    combined_path.write_text(
        json.dumps([q.model_dump() for q in all_questions], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"\n{len(all_questions)} total questions -> {combined_path}")


if __name__ == "__main__":
    main()
