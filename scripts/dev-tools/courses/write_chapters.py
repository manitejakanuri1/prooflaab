"""Owner 12 Nov 2026 (approved, cap Rs 100): AI-written course chapters for roadmap topics that had no chapter in
any full course, plus a new AWS course. TEST only.

  plan  <gaps.json> <subs.out> <CLEAN>        -> jobs.json (which chapters, which course, where they go). No AI.
  write <jobs.json> <outdir>                   -> one markdown file per job (DeepSeek, resumable, cost-capped).
  emit  <jobs.json> <outdir> <CLEAN> <out.sql> -> files + manifest/order in CLEAN, and the TEST load SQL.

Cost: deepseek-flash list price (api-docs.deepseek.com/quick_start/pricing, read 12 Nov 2026), peak or off-peak
by call time, cache hits counted as misses, $1 = Rs 90 (both on the high side). Stops before Rs 95.
"""
import json
import re
import subprocess
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from load_courses import chapters  # noqa: E402

CREDIT = "Written for ProofLab"
INR, CAP = 90.0, 95.0
STOP = set("a an the and or of to in on for with by is are be as at it its this that how what why your you vs".split())
toks = lambda s: {w for w in re.findall(r"[a-z0-9#+]+", s.lower()) if len(w) > 1 and w not in STOP}
slugify = lambda s: re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")[:50]

# AWS Cloud Fundamentals: 40 chapters, easy to hard, each with the roadmap topic numbers it covers (aws track).
AWS = [("What Cloud Computing Is", [1]), ("Why Companies Use AWS", [1]), ("Creating Your AWS Account Safely", [2]),
       ("The AWS Console: A First Tour", [2]), ("Billing, Free Tier and Budgets", [2, 18]),
       ("Regions and Availability Zones", [3]), ("IAM Users, Groups and Roles", [4]),
       ("IAM Policies and Least Privilege", [4]), ("MFA and Keeping the Root Account Safe", [4, 17]),
       ("The AWS CLI", [5]), ("AWS SDKs: Calling AWS from Code", [5]), ("EC2: Your First Virtual Server", [6]),
       ("EC2 Instance Types and Pricing", [6]), ("Security Groups and Key Pairs", [6]),
       ("EBS Volumes and Snapshots", [7]), ("S3 Buckets and Objects", [7]), ("S3 Storage Classes and Lifecycle Rules", [7]),
       ("VPC Basics: Subnets and Route Tables", [8]), ("Internet Gateways and NAT Gateways", [8]),
       ("Elastic Load Balancing", [9]), ("Auto Scaling Groups", [9]), ("RDS: Managed Relational Databases", [10]),
       ("DynamoDB: NoSQL on AWS", [10]), ("Route 53 and DNS", [11]), ("CloudFront: Content Delivery", [11]),
       ("SQS and SNS: Messaging Between Services", [12]), ("AWS Lambda: Serverless Functions", [13]),
       ("API Gateway with Lambda", [13]), ("Containers on AWS: ECR and ECS", [14]), ("EKS and Fargate in Brief", [14]),
       ("CloudFormation: Infrastructure as Code", [15]), ("CloudWatch Metrics and Alarms", [16]),
       ("CloudWatch Logs and CloudTrail", [16]), ("The Shared Responsibility Model and Security Basics", [17]),
       ("Encryption with KMS and Secrets Manager", [17]), ("Cost Explorer and Ways to Save Money", [18]),
       ("Getting Help: Documentation and Support Plans", [19]), ("The Well-Architected Framework", [20]),
       ("Project: Deploy a Real Web App on AWS", [21]), ("AWS Certifications and Your Career", [22])]
NEW_COURSE_TITLE: dict[str, str] = {}  # a track with no course at all gets one named after it


def course_for(track: str, name: str, links: dict[str, list[str]], existing: dict) -> str:
    """The track's own course (same slug); else the linked course whose chapter titles share most words with
    the topic (linux -> bash, web-development -> html-css/javascript/...); a track with no course gets a new one."""
    have = links.get(track, [])
    if track in have or not have:
        return track
    return max(have, key=lambda c: sum(len(toks(t) & toks(name)) for t, _ in existing[c]))


def plan(gaps_file: str, subs_file: str, clean: str) -> None:
    root = Path(clean)
    gaps = json.load(open(gaps_file, encoding="utf-8"))
    subs: dict[tuple, list] = {}
    for line in open(subs_file, encoding="utf-8"):
        if line.startswith("SUB "):
            d = json.loads(line[4:])
            subs.setdefault((d["t"], d["n"]), []).append(d)
    links: dict[str, list[str]] = {}
    for line in open(Path(subs_file).with_name("ct.out"), encoding="utf-8"):
        if line.startswith("CT "):
            t, c = line.split()[1:3]
            links.setdefault(t, []).append(c)
    jobs, topics = [], {}
    for g in gaps:
        if g["t"] != "aws":
            topics.setdefault((g["t"], g["n"]), set()).add(g["title"])
    # Existing chapters of every course a gap lands in: (title, sort) in reading order (sort = position).
    existing: dict[str, list[tuple[str, int]]] = {}
    track_size: dict[str, int] = {}
    for t, n in topics:
        track_size[t] = max(track_size.get(t, 0), n)
    for (t, n), titles in sorted(topics.items()):
        steps = [s for s in subs[(t, n)] if s["title"] in titles] or subs[(t, n)]
        name = steps[0]["title"]
        for c in links.get(t, []) + [t]:
            if c not in existing:
                existing[c] = [(ti, i + 1) for i, (ti, *_) in enumerate(chapters(root / c))] if (root / c / "manifest.json").exists() else []
        c = course_for(t, name, links, existing)
        # Place it after the existing chapter that shares the most title words; none: early topics go first, others last.
        # ponytail: word overlap, not meaning - good enough for a reading order; fix a bad spot by hand in order.json.
        best = max(existing[c], key=lambda e: len(toks(e[0]) & toks(name)), default=None)
        if best and toks(best[0]) & toks(name):
            sort = best[1] + 0.01 * n / 100 + 0.001
        elif n <= max(1, track_size[t] // 4):
            sort = 1 + n / 1000  # after the course's own first (intro) chapter
        else:
            sort = len(existing[c]) + 1 + n / 1000
        jobs.append({"id": f"{t}-{n}", "track": t, "course": c, "title": name, "sort": round(sort, 6),
                     "steps": [{"title": s["title"], "text": s["x"]} for s in steps]})
    aws_steps = {}
    for (t, n), rows in subs.items():
        if t == "aws":
            aws_steps[n] = rows
    for i, (title, ns) in enumerate(AWS, 1):
        jobs.append({"id": f"aws-{i}", "track": "aws", "course": "aws", "title": title, "sort": i,
                     "steps": [{"title": r["title"], "text": r["x"]} for n in ns for r in aws_steps.get(n, [])]})
    json.dump(jobs, open(Path(gaps_file).with_name("jobs.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    by = {}
    for j in jobs:
        by[j["course"]] = by.get(j["course"], 0) + 1
    print(f"jobs {len(jobs)}; courses {len(by)}; new courses {[c for c in by if not (root / c / 'manifest.json').exists() or c == 'aws']}")


PROMPT = """You write one chapter of the course "{course}" for ProofLab. Readers are Indian engineering students, many with
English as a second language. Chapter title: "{title}".
It must teach these roadmap lesson steps (use them as the base, in this order):
{steps}

Rules:
- 450 to 850 words of Markdown. Start with the line "# {title}".
- First paragraph: a real-life comparison from everyday Indian life that explains the idea.
- Short, simple sentences. Use "##" subheadings. Explain every new term the first time.
- Where it helps, small correct code or command examples in fenced code blocks with a language tag.
- A "## Common mistakes" section with 2 or 3 bullets (the mistake and the fix).
- End with "## Try this": one small exercise the student can do in 10 minutes (no answer).
- No links, no URLs, no website or book names, no greetings, never mention AI or this prompt.
Return only the Markdown chapter."""

PEAK = [(1, 4), (6, 10)]


def rate() -> tuple[float, float]:
    """USD per 1M tokens (input, output) for deepseek-flash right now."""
    now = datetime.now(timezone.utc)
    peak = now.weekday() < 5 and any(a <= now.hour < b for a, b in PEAK)
    return (0.30, 1.20) if peak else (0.15, 0.60)


def gate(md: str) -> str | None:
    """Why a chapter is not good enough, or None."""
    words = len(md.split())
    if words < 300:
        return f"too short ({words} words)"
    if md.count("```") % 2:
        return "unclosed code block"
    # Same rule as the course reports: no link a student could follow. A URL inside code (curl localhost,
    # a git remote) is example text, not a link. "Language model" is a real topic in some courses.
    prose = re.sub(r"`[^`\n]*`", "", re.sub(r"^```.*?^```[^\n]*$", "", md, flags=re.S | re.M))
    if re.search(r"https?://|www\.|\]\(|<a\s+href", prose, re.I):
        return "has a link"
    if re.search(r"\bas an ai\b", md, re.I):
        return "mentions AI"
    if not md.lstrip().startswith("# "):
        return "no title line"
    return None


def write(jobs_file: str, outdir: str) -> None:
    key = subprocess.run(["gcloud", "secrets", "versions", "access", "latest", "--secret=deepseek-api-key",
                          "--project=prooflab-508214"], capture_output=True, text=True, shell=True).stdout.strip()
    assert key, "no DeepSeek key"
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    tally_file = out / "_cost.json"
    tally = json.loads(tally_file.read_text()) if tally_file.exists() else {"inr": 0.0, "calls": 0, "in": 0, "out": 0, "models": {}}
    lock = threading.Lock()
    course_titles = {"aws": "AWS Cloud Fundamentals", **NEW_COURSE_TITLE}
    cat = json.load(open(Path(r"C:\Users\manit\Downloads\ProofLab_Courses_CLEAN") / "CATALOG.json", encoding="utf-8"))
    course_titles = {**{c["slug"]: c["title"] for c in cat}, **course_titles}
    jobs = json.load(open(jobs_file, encoding="utf-8"))
    failed = []

    def call(prompt: str) -> str:
        with lock:
            if tally["inr"] >= CAP:
                raise RuntimeError("cost cap")
        body = json.dumps({"model": "deepseek-chat", "temperature": 0.5, "max_tokens": 3000,
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                     {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(req, timeout=300) as r:
            j = json.loads(r.read())
        u = j.get("usage", {})
        pin, pout = rate()
        cost = (u.get("prompt_tokens", 0) * pin + u.get("completion_tokens", 0) * pout) / 1e6 * INR
        with lock:
            tally["inr"] += cost; tally["calls"] += 1
            tally["in"] += u.get("prompt_tokens", 0); tally["out"] += u.get("completion_tokens", 0)
            tally["models"][j.get("model", "?")] = tally["models"].get(j.get("model", "?"), 0) + 1
            tally_file.write_text(json.dumps(tally))
        return j["choices"][0]["message"]["content"].strip()

    def one(job: dict) -> None:
        f = out / f"{job['id']}.md"
        if f.exists():
            return
        steps = "\n".join(f"- {s['title']}: {s['text'][:900] or '(not written yet)'}" for s in job["steps"]) or f"- {job['title']}"
        prompt = PROMPT.format(course=course_titles.get(job["course"], job["course"]), title=job["title"], steps=steps)
        for attempt in (1, 2):
            md = re.sub(r"\A```(?:markdown|md)?\s*\n|\n```\s*\Z", "", call(prompt))
            why = gate(md)
            if not why:
                f.write_text(md + "\n", encoding="utf-8")
                return
        with lock:
            failed.append((job["id"], why))

    todo = [j for j in jobs if not (out / f"{j['id']}.md").exists()]
    print(f"to write {len(todo)}, spent so far Rs {tally['inr']:.2f}", flush=True)
    with ThreadPoolExecutor(6) as ex:
        for i, _ in enumerate(ex.map(lambda j: _safe(one, j), todo), 1):
            if i % 20 == 0:
                print(time.strftime("%H:%M:%S"), f"{i}/{len(todo)} Rs {tally['inr']:.2f} calls {tally['calls']}", flush=True)
    (out / "_failed.json").write_text(json.dumps(failed))
    print(f"done; Rs {tally['inr']:.2f}; calls {tally['calls']}; tokens in {tally['in']} out {tally['out']}; "
          f"models {tally['models']}; failed {failed}")


def _safe(fn, job):
    try:
        fn(job)
    except Exception as e:  # one bad call never stops the rest; the cap stops everything
        print("ERR", job["id"], str(e)[:120], flush=True)


def q(s):
    return "null" if s is None else "'" + s.replace("'", "''") + "'"


def emit(jobs_file: str, outdir: str, clean: str, out_sql: str) -> None:
    root, out = Path(clean), Path(outdir)
    jobs = [j for j in json.load(open(jobs_file, encoding="utf-8")) if (out / f"{j['id']}.md").exists()]
    # TEST only: refuse to run anywhere the staging test admin does not exist.
    lines = ["do $g$ begin if not exists (select 1 from auth.users where email = 'e2e.admin@staging.prooflab.invalid') "
             "then raise exception 'not the TEST database'; end if; end $g$;", "begin;"]
    by: dict[str, list] = {}
    for j in jobs:
        by.setdefault(j["course"], []).append(j)
    listing = []
    for c, js in by.items():
        folder = root / c
        new_course = c == "aws" or not (folder / "manifest.json").exists()
        if c == "aws" and (folder / "manifest.json").exists() and not (root / "aws_old_s3_guide").exists():
            folder.rename(root / "aws_old_s3_guide")  # the NOT READY S3-guide copy is kept, not deleted
        folder.mkdir(exist_ok=True)
        man = [] if new_course else json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        order = [] if new_course else (json.loads((folder / "order.json").read_text(encoding="utf-8"))
                                       if (folder / "order.json").exists() else [m["mdFile"] for m in man])
        base = len(man)
        placed = [(i + 1.0, f) for i, f in enumerate(order)]
        if new_course:
            lines.append(f"insert into public.courses (slug, title, credit, chapters) values ({q(c)}, "
                         f"{q('AWS Cloud Fundamentals' if c == 'aws' else NEW_COURSE_TITLE.get(c, c.title()))}, null, 0) "
                         "on conflict (slug) do nothing;")
            lines.append(f"insert into public.course_tracks (track_slug, course_slug) values ({q(js[0]['track'])}, {q(c)}) on conflict do nothing;")
        for k, j in enumerate(sorted(js, key=lambda j: j["sort"]), 1):
            md = (out / f"{j['id']}.md").read_text(encoding="utf-8")
            title = re.match(r"#\s+(.+)", md).group(1).strip()
            fname = f"{base + k:03d}_{slugify(title)}.md"
            (folder / fname).write_text(md, encoding="utf-8", newline="\n")
            man.append({"index": base + k, "slug": slugify(title), "title": title, "mdFile": fname, "source": CREDIT})
            placed.append((j["sort"], fname))
            body = re.sub(r"\A\s*#\s+[^\n]*\n", "", md, count=1).strip()
            lines.append(f"insert into public.course_chapters (course_slug, position, title, body, sort, credit) values "
                         f"({q(c)}, (select coalesce(max(position), 0) + 1 from public.course_chapters where course_slug = {q(c)}), "
                         f"{q(title)}, {q(body)}, {j['sort']}, {q(CREDIT)});")
            listing.append(f"| {c} | {title} | {j['track']} |")
        (folder / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
        (folder / "order.json").write_text(json.dumps([f for _, f in sorted(placed)], indent=1), encoding="utf-8")
        lines.append(f"update public.courses set chapters = (select count(*) from public.course_chapters where course_slug = {q(c)}) where slug = {q(c)};")
    lines.append("commit;")
    Path(out_sql).write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    if "aws" in by:  # the catalog entry now describes the rebuilt course
        cat = json.loads((root / "CATALOG.json").read_text(encoding="utf-8"))
        for c in cat:
            if c["slug"] == "aws":
                words = sum(len((root / "aws" / m["mdFile"]).read_text(encoding="utf-8").split())
                            for m in json.loads((root / "aws" / "manifest.json").read_text(encoding="utf-8")))
                c.update(chaptersCount=len(by["aws"]), words=words, contentSource="written for ProofLab with AI",
                         sources="Written for ProofLab", license="ProofLab")
        (root / "CATALOG.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    tally = json.loads((out / "_cost.json").read_text())
    (root / "AI_WRITTEN.md").write_text(
        "# Chapters written with AI (12 Nov 2026, owner approved, cap Rs 100)\n\n"
        f"Model deepseek-flash, {tally['calls']} calls, about Rs {tally['inr']:.2f} (list price, high side).\n"
        "Each chapter's credit line is \"Written for ProofLab\". The old AWS folder (Amazon S3 guide) is kept as aws_old_s3_guide.\n\n"
        "| Course | Chapter | Roadmap track |\n|---|---|---|\n" + "\n".join(listing) + "\n", encoding="utf-8")
    print(f"emitted {len(jobs)} chapters in {len(by)} courses -> {out_sql}")


if __name__ == "__main__":
    ok = "# T\n\n" + "word " * 300
    assert gate(ok) is None and gate(ok + "\n```bash\ncurl https://localhost\n```\n") is None
    assert gate(ok + "see https://x.com") == "has a link" and gate(ok + "```py") == "unclosed code block"
    assert gate(ok + "As an AI, I") == "mentions AI" and gate("# T\nshort") == "too short (3 words)"
    {"plan": plan, "write": write, "emit": emit}[sys.argv[1]](*sys.argv[2:])
