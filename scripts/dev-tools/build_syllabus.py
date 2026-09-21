"""Build one complete, ordered syllabus per course from what the open repos actually teach.
Input : sections.json (the corpus) + the live levels table (what each track already has).
Output: content/syllabus/<course>.json  { course, title, topics:[{title, why, steps:[{title, existing}]}] }
AI    : DeepSeek reads only the OUTLINE (headings), never the book text -> cheap.
usage : python build_syllabus.py --dry        (prints token counts, no AI)
        python build_syllabus.py [course ...] (runs)"""
import json, sys, re, collections, subprocess, urllib.request, os
from pl import token, http, API
from repo_candidates import C
from add_repo_links import EXTRA

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "content", "syllabus")
ADD = {  # repos that are new to a track (not tied to one skill in repo_candidates)
    "web-development": ["mdn/content", "freeCodeCamp/freeCodeCamp", "airbnb/javascript", "Chalarangelo/30-seconds-of-code",
                        "trekhleb/javascript-algorithms", "vuejs/docs", "expressjs/express"],
    "mobile-development": ["dart-lang/site-www", "flutter/samples"],
    "machine-learning": ["d2l-ai/d2l-en"], "cybersecurity": ["OWASP/Top10"], "blockchain": ["wevm/viem"],
    "robotics": ["AtsushiSakai/PythonRobotics"], "data-science": ["rougier/scientific-visualization-book"],
    "cloud-computing": ["donnemartin/system-design-primer"],
}
NEW = {  # courses that did not exist as a track
    "python": ("Python, start to finish", ["trekhleb/learn-python", "TheAlgorithms/Python", "jakevdp/PythonDataScienceHandbook", "ossu/computer-science"]),
    "java": ("Java and Spring backend", ["TheAlgorithms/Java", "iluwatar/java-design-patterns", "spring-guides"]),
    "dsa": ("Data structures and algorithms", ["TheAlgorithms/Python", "TheAlgorithms/Java", "trekhleb/javascript-algorithms", "ossu/computer-science"]),
    "computer-science": ("Computer science foundations", ["ossu/computer-science"]),
    "system-design": ("System design", ["donnemartin/system-design-primer", "microsoft/api-guidelines"]),
    "deep-learning": ("Deep learning and LLMs", ["d2l-ai/d2l-en", "ageron/handson-ml3", "huggingface/course", "mrdbourke/pytorch-deep-learning"]),
}
# One standalone course per skill that role tracks teach only as a short primer.
SKILL_COURSES = {  # slug: (title, skill, role, extra repos beyond repo_candidates)
    "sql": ("SQL and databases", "SQL", "database developer", ["pingcap/awesome-database-learning"]),
    "docker": ("Docker and containers", "Docker", "DevOps engineer", []),
    "cpp": ("C++", "C++", "C++ developer", ["AnthonyCalandra/modern-cpp-features"]),
    "linux": ("Linux", "Linux", "systems engineer", []),
    "networking": ("Computer networking", "Networking", "network engineer", ["donnemartin/system-design-primer", "ossu/computer-science"]),
    "html-css": ("HTML and CSS", "HTML/CSS", "front-end developer", ["mdn/content", "freeCodeCamp/freeCodeCamp"]),
    "javascript": ("JavaScript", "JavaScript", "JavaScript developer", ["mdn/content", "airbnb/javascript", "Chalarangelo/30-seconds-of-code", "trekhleb/javascript-algorithms"]),
    "react": ("React", "React", "React developer", []),
    "pandas": ("Pandas", "Pandas", "data analyst", ["jakevdp/PythonDataScienceHandbook"]),
    "numpy": ("NumPy", "NumPy", "data analyst", ["jakevdp/PythonDataScienceHandbook"]),
    "aws": ("Amazon Web Services", "AWS", "cloud engineer", []),
    "terraform": ("Terraform", "Terraform", "DevOps engineer", []),
    "linear-algebra": ("Linear algebra", "Linear Algebra", "machine learning engineer", ["d2l-ai/d2l-en"]),
    "probability": ("Probability", "Probability", "data scientist", ["d2l-ai/d2l-en"]),
    "rest-apis": ("REST APIs", "REST APIs", "backend developer", ["microsoft/api-guidelines"]),
    "bash": ("Bash and the command line", "Bash", "systems engineer", []),
    "kubernetes": ("Kubernetes", "Kubernetes", "DevOps engineer", []),
    "git": ("Git and GitHub", "Git", "software engineer", ["git-tips/tips"]),
}
for _slug, (_t, _skill, _role, _extra) in SKILL_COURSES.items():
    NEW[_slug] = (_t, list(dict.fromkeys(C.get(_skill, []) + EXTRA.get(_skill, []) + _extra)))

TITLES = {"web-development": "Web development", "mobile-development": "Mobile development", "data-science": "Data science",
          "machine-learning": "Machine learning", "cloud-computing": "Cloud computing", "devops": "DevOps", "cybersecurity": "Cybersecurity",
          "ui-ux-design": "UI/UX design", "game-development": "Game development", "blockchain": "Blockchain", "iot": "IoT and embedded",
          "robotics": "Robotics", "prompt-engineering": "Prompt engineering", "hr-behavioral": "HR and behavioural interviews",
          "logical-reasoning": "Logical reasoning", "quant-aptitude": "Quantitative aptitude", "verbal-ability": "Verbal ability"}


def load():
    secs = json.load(open("sections.json", encoding="utf-8"))
    by = collections.defaultdict(list)
    for s in secs:
        by["spring-guides" if s["repo"].startswith("spring-guides/") else s["repo"]].append(s)
    H = {"Authorization": f"Bearer {token('svc')}"}
    st, lv = http(f"{API}/levels?select=track_slug,level_number,sub_level,skill,title&kind=eq.explanation&order=track_slug,level_number,sub_level",
                  headers=H, method="GET")
    return by, lv


def outline(repo, secs, cap=110):
    files = collections.OrderedDict()
    for s in secs:
        files.setdefault(s["path"], []).append(re.sub(r"\s+", " ", s["heading"])[:60])
    lines = []
    for p, hs in files.items():
        parts = p.rsplit("/", 2)
        lines.append((parts[-2] + "/" if len(parts) > 1 else "") + parts[-1] + ": " + "; ".join(hs[:8]))
    if len(lines) > cap:                                    # keep the spread, not just the start
        step = len(lines) / cap
        lines = [lines[int(i * step)] for i in range(cap)]
    return f"## {repo}\n" + "\n".join(l[:230] for l in lines)


def existing(lv, track):
    topics = collections.OrderedDict()
    for r in lv:
        if r["track_slug"] == track:
            topics.setdefault(r["level_number"], []).append(r["title"])
    return "\n".join(f"{n}. " + " | ".join(t) for n, t in topics.items())


def courses(by, lv):
    out = {}
    for tr in sorted({r["track_slug"] for r in lv}):
        skills = {r["skill"] for r in lv if r["track_slug"] == tr}
        repos = list(dict.fromkeys([x for s in skills for x in C.get(s, []) + EXTRA.get(s, [])] + ADD.get(tr, [])))
        out[tr] = (TITLES.get(tr, tr), [r for r in repos if r in by], existing(lv, tr))
    for k, (title, repos) in NEW.items():
        out[k] = (title, [r for r in repos if r in by], "")
    return out


PROMPT = """You design a complete beginner-to-job-ready course called "{title}" for Indian engineering students.
Below: (A) what the course ALREADY has, (B) the outlines of open-licence books/repos that teach this subject.
Write the FULL ordered syllabus: simplest first, every idea after the ones it needs, nothing important left out.
Rules:
- Cover everything the books cover (unless it is only a link list or a version-specific detail).
- Keep every existing step title from (A) exactly as written, and mark it existing; add the missing ones as new.
- 8 to 30 topics; each topic has 4 to 10 short steps. Titles are plain and specific, no marketing words.
- "why" is one plain sentence a 12-year-old understands.
Return JSON only: {{"topics":[{{"t":"topic title","w":"why","s":[["step title",1 if existing else 0]]}}]}}

(A) ALREADY HAS:
{have}

(B) BOOK OUTLINES:
{books}"""


def deepseek(prompt):
    key = subprocess.run("gcloud secrets versions access latest --secret=deepseek-api-key", shell=True, capture_output=True, text=True).stdout.strip()
    body = json.dumps({"model": "deepseek-chat", "messages": [{"role": "user", "content": prompt}], "temperature": 0.2,
                       "max_tokens": 8000, "response_format": {"type": "json_object"}}).encode()
    req = urllib.request.Request("https://api.deepseek.com/chat/completions", body,
                                 {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        j = json.load(r)
    return j["choices"][0]["message"]["content"], j.get("usage", {})


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    only = [a for a in sys.argv[1:] if not a.startswith("--")]
    by, lv = load()
    cs = courses(by, lv)
    tin = tout = 0
    for k, (title, repos, have) in cs.items():
        if only and k not in only:
            continue
        books = "\n\n".join(outline(r, by[r]) for r in repos)
        prompt = PROMPT.format(title=title, have=have or "(nothing yet)", books=books or "(no book text; use your own knowledge of the subject)")
        est = len(prompt) // 4
        if dry:
            print(f"{k:20} repos={len(repos):2} prompt~{est:6} tokens")
            tin += est
            continue
        text, usage = deepseek(prompt)
        try:
            data = json.loads(text)
        except Exception:
            print(k, "BAD JSON")
            continue
        topics = [{"n": i + 1, "title": t["t"], "why": t.get("w", ""),
                   "steps": [{"n": j + 1, "title": s[0], "existing": bool(s[1])} for j, s in enumerate(t["s"])]}
                  for i, t in enumerate(data["topics"])]
        json.dump({"course": k, "title": title, "sources": repos, "topics": topics},
                  open(os.path.join(ROOT, f"{k}.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        tin += usage.get("prompt_tokens", 0)
        tout += usage.get("completion_tokens", 0)
        print(f"{k:20} topics={len(topics):2} steps={sum(len(t['steps']) for t in topics):3}  in={usage.get('prompt_tokens')} out={usage.get('completion_tokens')}", flush=True)
    print(f"TOTAL in~{tin} out~{tout}  cost ~ Rs {(tin + tout) * 67 / 1e6:.1f}")
