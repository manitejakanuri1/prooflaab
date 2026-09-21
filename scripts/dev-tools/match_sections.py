"""Pick, for every lesson step, up to 2 repo sections that teach the same thing.
BM25 over each skill's own open-licence repos. Output: matches.json {level_id: [section,...]}. No AI."""
import json, math, re, collections, os
SC_MIN = float(os.environ.get("SC_MIN", 15))          # loosen with SC_MIN=8
HEAD_REQ = os.environ.get("HEAD_REQ", "1") == "1"       # HEAD_REQ=0: title words may sit in the body, not the heading
from pl import token, http, API
from repo_candidates import C
from add_repo_links import EXTRA

STOP = set("""a an the and or of to in on for with by is are be as at it its this that these those from into your you
your we our how what why when which use using used can will not no do does did get make first basics basic intro introduction
part step steps new more most than then so if about up out like vs via all any one two three way ways work working""".split())
tok = lambda s: [w for w in re.findall(r"[a-z0-9#+]+", s.lower()) if len(w) > 1 and w not in STOP]

def english(t):
    letters = [ch for ch in t if ch.isalpha()]
    return letters and sum(ord(ch) > 0x24F for ch in letters) / len(letters) < 0.03

secs = [s for s in json.load(open("sections.json", encoding="utf-8"))
        if english(s["text"]) and english(s["heading"])
        and not re.search(r"(readme[-.](?!md)|\.(zh|ko|ja|es|fr|de|pt|ru|it|tr|fa|ar|vi|id|pl|uk)[-_.]?)", s["path"].lower())]
by_repo = collections.defaultdict(list)
for s in secs:
    by_repo[s["repo"]].append(s)

H = {"Authorization": f"Bearer {token('svc')}"}
st, levels = http(f"{API}/levels?select=id,track_slug,level_number,sub_level,skill,title,kind&kind=eq.explanation", headers=H, method="GET")
st, content = http(f"{API}/level_content?select=level_id,explanation", headers=H, method="GET")
expl = {c["level_id"]: c["explanation"] or "" for c in content}

class BM25:
    def __init__(self, docs):
        self.docs = docs
        self.tf = []
        df = collections.Counter()
        for d in docs:
            t = collections.Counter(tok(d["heading"]) * 3 + tok(d["text"][:1500]))
            self.tf.append(t); df.update(t.keys())
        n = len(docs); self.avg = sum(sum(t.values()) for t in self.tf) / max(n, 1)
        self.idf = {w: math.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}
    def score(self, q, i):
        t = self.tf[i]; L = sum(t.values()); s = 0.0
        for w, qw in q.items():
            if w in t:
                f = t[w]; s += qw * self.idf[w] * f * 2.2 / (f + 1.2 * (0.25 + 0.75 * L / self.avg))
        return s

pools = {}
def pool(skill):
    if skill not in pools:
        repos = [r for r in dict.fromkeys(C.get(skill, []) + EXTRA.get(skill, [])) if r in by_repo]
        docs = [s for r in repos for s in by_repo[r]]
        pools[skill] = BM25(docs) if docs else None
    return pools[skill]

matches, used = {}, collections.defaultdict(set)
for lv in sorted(levels, key=lambda x: (x["track_slug"], x["level_number"], x["sub_level"])):
    bm = pool(lv["skill"])
    if not bm:
        continue
    title_terms = tok(lv["title"])
    q = collections.Counter()
    for w in title_terms: q[w] += 2.0
    for w in tok(lv["skill"]): q[w] += 1.0
    for w, _ in collections.Counter(tok(expl.get(lv["id"], ""))).most_common(12): q[w] += 0.5
    scored = sorted(((bm.score(q, i), i) for i in range(len(bm.docs))), reverse=True)[:30]
    topic = (lv["track_slug"], lv["level_number"])
    picked = []
    skill_terms = set(tok(lv["skill"]))
    for sc, i in scored:
        d = bm.docs[i]
        key = (d["repo"], d["path"], d["heading"])
        head = set(tok(d["heading"]))
        body = set(tok(d["heading"] + " " + d["text"][:2000]))
        # The heading itself must be about this step, the section must be about
        # this skill, and a second pick must be nearly as good as the first.
        if sc < SC_MIN or (HEAD_REQ and not head & set(title_terms)) or key in used[topic]:
            continue
        if skill_terms and not skill_terms & body:
            continue
        if picked and (sc < 0.8 * picked[0]["score"] or d["heading"].lower() == picked[0]["heading"].lower()):
            continue
        picked.append({"repo": d["repo"], "licence": d["licence"], "heading": d["heading"],
                       "text": d["text"][:3500], "score": round(sc, 1)})
        used[topic].add(key)
        if len(picked) == 3:
            break
    if picked:
        matches[lv["id"]] = picked

json.dump(matches, open("matches.json", "w", encoding="utf-8"))
steps_with_pool = sum(1 for lv in levels if pool(lv["skill"]))
print(f"steps {len(levels)}; with a repo pool {steps_with_pool}; matched {len(matches)}; sections used {sum(len(v) for v in matches.values())}")
by_track = collections.Counter(lv["track_slug"] for lv in levels if lv["id"] in matches)
print(by_track.most_common())
