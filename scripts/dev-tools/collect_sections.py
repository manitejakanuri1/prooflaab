"""Download the teaching text of every open-licence repo and cut it into sections.
Output: sections.json = [{repo, licence, path, heading, text}]. No AI."""
import json, re, subprocess, urllib.request
from concurrent.futures import ThreadPoolExecutor
from repo_candidates import C
from add_repo_links import EXTRA  # noqa: only the dict is used

info = json.load(open("repo_info.json"))
SKIP = {"public-apis/public-apis", "ellisonleao/magictools", "trimstray/the-book-of-secret-knowledge",
        "splunk/security_content", "spring-projects/spring-petclinic", "firebase/quickstart-android",
        "firebase/quickstart-js", "android/compose-samples", "android/codelab-android-room-with-a-view",
        "ethers-io/ethers.js", "FreeRTOS/FreeRTOS", "fastlane/fastlane", "vercel/examples", "esp-idf",
        "espressif/esp-idf", "MicrosoftDocs/azure-docs", "jenkinsci/pipeline-examples", "opencv/opencv"}
EXTRA_LIC = {"trekhleb/javascript-algorithms": "MIT", "airbnb/javascript": "MIT",
             "Chalarangelo/30-seconds-of-code": "CC-BY-4.0", "microsoft/generative-ai-for-beginners": "MIT"}

SCAN = json.load(open("licence_scan.json")) if __import__("os").path.exists("licence_scan.json") else {}
CODE_REPOS = {"TheAlgorithms/Python": (".py",), "TheAlgorithms/Java": (".java",)}      # sections are whole source files
MDN_KEEP = ("files/en-us/learn/", "files/en-us/web/javascript/guide/", "files/en-us/web/html/element/", "files/en-us/web/http/")
LINK_LISTS = {"practical-tutorials/project-based-learning", "EbookFoundation/free-programming-books",
              "ZOUHAIRFGRA/100-Project-Ideas-for-Full-Stack-Developers", "codecrafters-io/build-your-own-x"}   # links, no lessons

def repos():
    out = {}
    for rs in list(C.values()) + list(EXTRA.values()):
        for r in rs:
            i = info.get(r, {})
            if r in EXTRA_LIC:
                out[r] = EXTRA_LIC[r]
            elif i.get("copy_ok") and "awesome" not in r.lower() and r not in SKIP:
                out[r] = i["lic"]
            elif SCAN.get(r, {}).get("class") == "OK" and "awesome" not in r.lower() and r not in SKIP | LINK_LISTS:
                out[r] = "see LICENSE"          # GitHub could not name it, its own LICENSE file says OK
    for r in ["ossu/computer-science", "d2l-ai/d2l-en", "donnemartin/system-design-primer"]:
        if SCAN.get(r, {}).get("class") == "OK": out[r] = "see LICENSE"
    return out

LANG_DIR = re.compile(r"(^|/)(translations?|translated_images|i18n|locales?|zh|zh-cn|zh-tw|cn|es|ja|ko|fr|de|pt|pt-br|ru|it|tr|hi|ar|fa|id|vi|pl|uk|bn|ta|te|he|th|nl|sw|ms|el)(/|$)", re.I)
TEXT_EXT = (".md", ".mdx", ".markdown", ".ipynb")

def tree(repo):
    branch = info.get(repo, {}).get("branch") or subprocess.run(
        ["gh", "api", f"repos/{repo}", "--jq", ".default_branch"], capture_output=True, text=True).stdout.strip() or "main"
    p = subprocess.run(["gh", "api", f"repos/{repo}/git/trees/{branch}?recursive=1", "--jq",
                        '.tree[] | select(.type=="blob") | "\\(.size) \\(.path)"'],
                       capture_output=True, text=True, encoding="utf-8")
    files = []
    for line in p.stdout.splitlines():
        size, path = line.split(" ", 1)
        low = path.lower()
        if repo in CODE_REPOS or repo.startswith("spring-guides/"):
            exts = CODE_REPOS.get(repo, (".java",))
            spring_ok = not repo.startswith("spring-guides/") or "/complete/src/main/" in "/" + low   # the finished guide code only
            if low.endswith(exts) and 300 < int(size) < 9000 and "test" not in low and spring_ok:
                files.append(path)
            continue
        if repo == "mdn/content" and not low.startswith(MDN_KEEP):
            continue
        if not low.endswith(TEXT_EXT) or int(size) > 400_000 or LANG_DIR.search(low):
            continue
        if re.search(r"(changelog|license|contributing|code_of_conduct|security|\.github/)", low):
            continue
        if re.search(r"\.(zh|es|ja|ko|fr|de|pt|ru|it|tr|fa|ar)\.mdx?$", low):
            continue
        files.append(path)
    # Repos that keep every language side by side: keep English only.
    if any("/en/" in f or f.startswith("en/") for f in files):
        files = [f for f in files if "/en/" in f or f.startswith("en/")] or files
    return branch, files[:400 if repo not in CODE_REPOS else 1600]

def fetch(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return ""

def notebook_to_md(raw):
    try:
        nb = json.loads(raw)
    except Exception:
        return ""
    parts = []
    for c in nb.get("cells", []):
        src = "".join(c.get("source", []))
        if c.get("cell_type") == "markdown":
            parts.append(src)
        elif c.get("cell_type") == "code" and src.strip() and len(src) < 1500:
            parts.append("```python\n" + src + "\n```")
    return "\n\n".join(parts)

def clean(md):
    md = re.sub(r"^---\n.*?\n---\n", "", md, flags=re.S)             # front matter
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)
    md = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", md)                     # images
    md = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", md)                 # links -> text
    md = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", md)
    md = re.sub(r"^\[[^\]]+\]:\s*\S+.*$", "", md, flags=re.M)        # link refs
    md = re.sub(r"https?://\S+", "", md)                             # bare urls
    md = re.sub(r"^(import|export) .*$", "", md, flags=re.M)         # mdx
    md = re.sub(r"</?[A-Za-z][^>]*>", "", md)                        # html / jsx tags
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()

def split_sections(md):
    out, heading, buf = [], None, []
    in_code = False
    for line in md.splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
        m = None if in_code else re.match(r"^(#{1,3})\s+(.+?)\s*#*\s*$", line)
        if m:
            if heading:
                out.append((heading, "\n".join(buf).strip()))
            heading, buf = re.sub(r"[`*_]", "", m.group(2)).strip(), []
        else:
            buf.append(line)
    if heading:
        out.append((heading, "\n".join(buf).strip()))
    return out

def good(text):
    prose = re.sub(r"```.*?```", "", text, flags=re.S)
    words = len(prose.split())
    bullets = sum(1 for l in text.splitlines() if l.strip().startswith(("-", "*", "|")))
    return 40 <= words and len(text) <= 6000 and bullets <= 25

def do_repo(item):
    repo, lic = item
    branch, files = tree(repo)
    base = f"https://raw.githubusercontent.com/{repo}/{branch}/"
    secs = []
    with ThreadPoolExecutor(12) as ex:
        raws = list(ex.map(lambda f: (f, fetch(base + f)), files))
    if repo in CODE_REPOS or repo.startswith("spring-guides/"):
        lang = "python" if repo.endswith("Python") else "java"
        for f, raw in raws:
            if raw.strip():
                title = f.rsplit("/", 1)[-1].rsplit(".", 1)[0].replace("_", " ")
                secs.append({"repo": repo, "licence": lic, "path": f, "heading": f"{f.rsplit('/',2)[-2]}: {title}"[:120],
                             "text": "```" + lang + "\n" + raw[:5800] + "\n```"})
        print(f"{repo}: {len(files)} files, {len(secs)} sections", flush=True)
        return secs
    for f, raw in raws:
        md = notebook_to_md(raw) if f.endswith(".ipynb") else raw
        for h, t in split_sections(clean(md)):
            if good(t) and not re.search(r"(table of contents|contents|license|contribut|acknowledg|references|further reading)", h, re.I):
                secs.append({"repo": repo, "licence": lic, "path": f, "heading": h[:120], "text": t[:6000]})
    print(f"{repo}: {len(files)} files, {len(secs)} sections", flush=True)
    return secs

if __name__ == "__main__":
    rs = repos()
    only = set(__import__("os").environ.get("ONLY", "").split())
    if __import__("os").environ.get("SPRING"):      # Spring guides: the writing is CC BY-ND (no changes allowed), the code is Apache-2.0
        names = subprocess.run(["gh", "api", "orgs/spring-guides/repos?per_page=100", "--jq", ".[].name"], capture_output=True, text=True).stdout.split()
        rs = {f"spring-guides/{n}": "Apache-2.0 (code)" for n in names if n.startswith("gs-")}
        only = set(rs)
    if only:
        rs = {r: l for r, l in rs.items() if r in only}
    print(len(rs), "repos")
    allsecs = []
    with ThreadPoolExecutor(4) as ex:
        for secs in ex.map(do_repo, rs.items()):
            allsecs += secs
    if only:                                        # add to the corpus we already have
        old = [x for x in json.load(open("sections.json", encoding="utf-8")) if x["repo"] not in only]
        allsecs = old + allsecs
    json.dump(allsecs, open("sections.json", "w", encoding="utf-8"))
    print("TOTAL sections", len(allsecs))
