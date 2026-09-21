"""Read each repo's own LICENSE text and sort it: OK (permissive / attribution / share-alike),
NC (non-commercial), ND (no-derivatives), GPL (copyleft), or UNKNOWN. No AI.
GitHub's licence field says NOASSERTION for many book repos whose LICENSE is a Creative Commons text."""
import json, re, subprocess, sys, base64
from concurrent.futures import ThreadPoolExecutor

def gh(path):
    p = subprocess.run(["gh", "api", path], capture_output=True, text=True, encoding="utf-8")
    try: return json.loads(p.stdout)
    except Exception: return None

def classify(text):
    t = text[:6000]
    if re.search(r"non-?commercial", t, re.I): return "NC"
    if re.search(r"no ?derivati|noderivs", t, re.I): return "ND"
    if re.search(r"GNU (Affero )?General Public|GNU Lesser", t, re.I): return "GPL"
    if re.search(r"MIT License|Permission is hereby granted|Apache License|BSD|Attribution 4\.0|Attribution-ShareAlike|CC0|Unlicense|Mozilla Public|Creative Commons Attribution|CC BY", t, re.I): return "OK"
    return "UNKNOWN"

def scan(repo):
    files = gh(f"repos/{repo}/contents") or []
    if not isinstance(files, list): return repo, "UNKNOWN", "no root listing"
    names = [f["name"] for f in files if re.match(r"(licen[sc]e|copying|unlicense)", f["name"], re.I)]
    verdicts = []
    for n in names[:3]:
        d = gh(f"repos/{repo}/contents/{n}")
        if d and d.get("content"):
            verdicts.append((classify(base64.b64decode(d["content"]).decode("utf-8", "replace")), n))
    if not verdicts: return repo, "UNKNOWN", "no LICENSE file"
    order = ["NC", "ND", "GPL", "UNKNOWN", "OK"]           # the strictest one wins
    v = min(verdicts, key=lambda x: order.index(x[0]))
    return repo, v[0], v[1]

if __name__ == "__main__":
    repos = sys.argv[1:]
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(scan, repos))
    out = {}
    for r, v, n in res:
        out[r] = {"class": v, "file": n}
        print(f"{v:8} {r}  ({n})")
    json.dump(out, open("licence_scan.json", "w"), indent=1)
