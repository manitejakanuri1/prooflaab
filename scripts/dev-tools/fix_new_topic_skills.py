"""New topics added inside role tracks were named by their own title. Resume matching works on the
`skill` name, so give each the skill of its nearest earlier (else later) OLD topic, never a course-link primer.
Safe to re-run."""
import sys
from pl import token, http, API
H = {"Authorization": f"Bearer {token('svc')}", "Prefer": "return=minimal"}
get = lambda p: http(f"{API}/{p}", headers=H, method="GET")[1]
COURSES = {"python", "java", "dsa", "computer-science", "system-design", "deep-learning"}
new_ids = {r["level_id"] for r in get("level_syllabus?select=level_id&limit=2000")}
link_ids = {r["level_id"] for r in get("topic_links?select=level_id")}
seeds = get("levels?select=id,track_slug,level_number,skill&sub_level=eq.1&order=track_slug,level_number&limit=5000")
by = {}
for s in seeds:
    by.setdefault(s["track_slug"], []).append(s)
changed = 0
for track, rows in by.items():
    if track in COURSES:
        continue
    old = [r for r in rows if r["id"] not in new_ids and r["id"] not in link_ids]
    for r in rows:
        if r["id"] not in new_ids:
            continue
        before = [o for o in old if o["level_number"] < r["level_number"]]
        src = before[-1] if before else next((o for o in old if o["level_number"] > r["level_number"]), None)
        if src and src["skill"] != r["skill"]:
            st, _ = http(f"{API}/levels?track_slug=eq.{track}&level_number=eq.{r['level_number']}", {"skill": src["skill"]}, H, "PATCH")
            changed += st < 300
print("topics re-skilled:", changed)
