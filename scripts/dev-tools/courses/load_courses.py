"""Write the SQL that loads the cleaned course folder into the course tables (migration 241). No AI.
Chapters go in reading order: <course>/order.json when present (order.py), else manifest order.
Usage: python -I load_courses.py <ProofLab_Courses_CLEAN> <out.sql> <track slugs, space separated>
Then (TEST): gzip, upload to the staging private bucket, gcloud sql import sql prooflab-staging-db ..."""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from course_meta import SKIP, credit_line, tracks_for  # noqa: E402


def q(s: str | None) -> str:
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def chapters(folder: Path) -> list[tuple[str, str]]:
    m = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    title = {c["mdFile"]: c["title"] for c in m}
    files = json.loads((folder / "order.json").read_text(encoding="utf-8")) if (folder / "order.json").exists() else [c["mdFile"] for c in m]
    out = []
    for f in files:
        text = (folder / f).read_text(encoding="utf-8", errors="replace").replace("\x00", "")
        body = re.sub(r"\A\s*#\s+[^\n]*\n", "", text, count=1).strip()  # the reader shows the title itself
        out.append((title[f], body))
    return out


def main(root: Path, out: Path, track_slugs: set[str]) -> None:
    cat = json.loads((root / "CATALOG.json").read_text(encoding="utf-8"))
    lines = ["begin;", "delete from public.course_tracks;", "delete from public.courses;"]
    unmatched, total = [], 0
    for c in cat:
        if c["slug"] in SKIP:
            continue
        ch = chapters(root / c["slug"])
        total += len(ch)
        lines.append(f"insert into public.courses (slug, title, credit, chapters) values ({q(c['slug'])}, {q(c['title'])}, {q(credit_line(c['slug']))}, {len(ch)});")
        for i in range(0, len(ch), 50):
            rows = ",\n".join(f"({q(c['slug'])}, {i + j + 1}, {q(t)}, {q(b)})" for j, (t, b) in enumerate(ch[i:i + 50]))
            lines.append(f"insert into public.course_chapters (course_slug, position, title, body) values\n{rows};")
        ts = tracks_for(c["slug"], track_slugs)
        unmatched += [] if ts else [c["slug"]]
        lines += [f"insert into public.course_tracks (track_slug, course_slug) values ({q(t)}, {q(c['slug'])});" for t in ts]
    lines.append("commit;")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(f"courses {len(cat) - len(SKIP)}, chapters {total}, no track: {unmatched}, tracks with no course: "
          f"{sorted(track_slugs - {t for c in cat if c['slug'] not in SKIP for t in tracks_for(c['slug'], track_slugs)})}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), set(sys.argv[3].split()))
