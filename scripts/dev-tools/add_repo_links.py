"""Put the checked GitHub repos (per skill) + the track's roadmap.sh page on every topic's
'Learn it properly' card. No AI. Safe to re-run: earlier repo/roadmap links are replaced."""
import json, sys, urllib.parse
from pl import token, http, API
from repo_candidates import C

# Repos from the owner's md file, added where they fit.
EXTRA = {
 "HTML/CSS": ["freeCodeCamp/freeCodeCamp", "thedaviddias/Front-End-Checklist"],
 "JavaScript": ["airbnb/javascript", "trekhleb/javascript-algorithms", "Chalarangelo/30-seconds-of-code", "freeCodeCamp/freeCodeCamp"],
 "Express": ["expressjs/express"],
 "Python": ["practical-tutorials/project-based-learning", "jackfrued/Python-100-Days", "EbookFoundation/free-programming-books"],
 "Java": ["krahets/hello-algo", "Snailclimb/JavaGuide", "doocs/advanced-java", "spring-projects/spring-boot"],
 "REST APIs": ["donnemartin/system-design-primer", "ZOUHAIRFGRA/100-Project-Ideas-for-Full-Stack-Developers"],
 "React": ["practical-tutorials/project-based-learning"],
 "Git": ["codecrafters-io/build-your-own-x"],
 "C": ["codecrafters-io/build-your-own-x"], "C++": ["codecrafters-io/build-your-own-x"],
 "Docker": ["codecrafters-io/build-your-own-x"],
}
CHINESE = {"jackfrued/Python-100-Days", "Snailclimb/JavaGuide", "doocs/advanced-java"}
ROADMAP = {"web-development": "full-stack", "mobile-development": "android", "data-science": "ai-data-scientist",
           "machine-learning": "machine-learning", "cloud-computing": "aws", "devops": "devops",
           "cybersecurity": "cyber-security", "ui-ux-design": "ux-design", "game-development": "game-developer",
           "blockchain": "blockchain", "prompt-engineering": "prompt-engineering"}
MAX_REPOS = 4

def repo_link(r):
    return {"kind": "repo", "url": f"https://github.com/{r}", "search": None,
            "label": f"GitHub · {r}" + (" (Chinese)" if r in CHINESE else "")}

def main():
    H = {"Authorization": f"Bearer {token('svc')}", "Content-Type": "application/json"}
    st, levels = http(f"{API}/levels?select=id,track_slug,skill&kind=eq.checkpoint", headers=H, method="GET")
    st, content = http(f"{API}/level_content?select=level_id,resources", headers=H, method="GET")
    have = {c["level_id"]: c for c in content}
    done = skipped = 0
    for lv in levels:
        c = have.get(lv["id"])
        if not c:
            skipped += 1; continue  # not written yet; re-run after pre-writing
        repos = list(dict.fromkeys(C.get(lv["skill"], []) + EXTRA.get(lv["skill"], [])))[:MAX_REPOS]
        links = [repo_link(r) for r in repos]
        if lv["track_slug"] in ROADMAP:
            links.append({"kind": "docs", "url": f"https://roadmap.sh/{ROADMAP[lv['track_slug']]}", "search": None,
                          "label": "roadmap.sh · the full path for this track"})
        ours = {"repo"}
        old = [r for r in (c["resources"] or []) if r.get("kind") not in ours and "roadmap.sh" not in (r.get("url") or "")]
        new = links + old[:3]
        if new == (c["resources"] or []):
            continue
        st, out = http(f"{API}/level_content?level_id=eq.{lv['id']}", new and {"resources": new},
                       {**H, "Prefer": "return=minimal"}, "PATCH")
        if st >= 300:
            print("FAIL", lv["skill"], st, str(out)[:200]); sys.exit(1)
        done += 1
    print(f"updated {done} topics; {skipped} not written yet")


if __name__ == "__main__":
    main()
