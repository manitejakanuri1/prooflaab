"""Check every candidate repo on GitHub: exists, real name, stars, licence, archived, last push."""
import json, subprocess
from concurrent.futures import ThreadPoolExecutor
from repo_candidates import C

COPY_OK = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC-BY-4.0", "CC-BY-SA-4.0",
           "CC0-1.0", "Unlicense", "ISC", "MPL-2.0"}

def info(r):
    p = subprocess.run(["gh", "api", f"repos/{r}", "--jq",
                        "{name:.full_name,stars:.stargazers_count,lic:(.license.spdx_id//\"none\"),"
                        "archived:.archived,pushed:.pushed_at[:10],branch:.default_branch,desc:.description}"],
                       capture_output=True, text=True, encoding="utf-8")
    return r, (json.loads(p.stdout) if p.returncode == 0 else {"error": p.stderr.strip()[:80]})

repos = sorted({r for v in C.values() for r in v})
with ThreadPoolExecutor(8) as ex:
    res = dict(ex.map(info, repos))
for r, i in res.items():
    i["copy_ok"] = i.get("lic") in COPY_OK
json.dump(res, open("repo_info.json", "w"), indent=1)
for r, i in res.items():
    if "error" in i:
        print("MISSING", r, i["error"])
    else:
        flag = ("ARCHIVED " if i["archived"] else "") + ("" if i["name"].lower() == r.lower() else f"-> {i['name']} ")
        print(f"{r:55} {i['stars']:>7} {i['lic']:14} {i['pushed']} {flag}")
