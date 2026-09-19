"""Read-only wiring audit: every table/function/rpc the code names must exist live,
and list live things nothing names (candidates for removal)."""
import json, os, re, collections

REPO = "C:/Users/manit/prooflabai-mvp"
api = json.load(open("api_surface.json"))
TABLES, RPCS = set(api["tables"]), set(api["rpcs"])

def files(root, exts):
    for d, _, fs in os.walk(root):
        if "node_modules" in d or "/dist" in d.replace("\\", "/"):
            continue
        for f in fs:
            if f.endswith(exts):
                yield os.path.join(d, f)

src = {p: open(p, encoding="utf8", errors="replace").read() for p in files(f"{REPO}/src", (".ts", ".tsx")) if not p.endswith("types.ts")}
fns = {p: open(p, encoding="utf8", errors="replace").read() for p in files(f"{REPO}/supabase/functions", (".ts",))}
sql = {p: open(p, encoding="utf8", errors="replace").read() for p in list(files(f"{REPO}/supabase/migrations", (".sql",))) + list(files(f"{REPO}/migration", (".sql",)))}
extra = {p: open(p, encoding="utf8", errors="replace").read() for p in files(f"{REPO}/accounts", (".py",))}
extra.update({p: open(p, encoding="utf8", errors="replace").read() for p in files(f"{REPO}/scripts", (".py", ".mjs", ".js", ".ts"))})

main = open(f"{REPO}/functions-service/main.ts", encoding="utf8").read()
SLUGS = set(re.findall(r"'([a-z0-9_-]+)'", main[main.index("const SLUGS"):main.index("];", main.index("const SLUGS"))]))

def uses(blob, pat):
    return {m for m in re.findall(pat, blob)}

code = {**src, **fns, **extra}
FROM = r"\.from\(\s*[\"'`]([a-z0-9_]+)[\"'`]"
RPC = r"\.rpc\(\s*[\"'`]([a-z0-9_]+)[\"'`]"
INV = r"functions\.invoke\(\s*[\"'`]([a-z0-9_-]+)[\"'`]"
FETCHF = r"/functions/v1/([a-z0-9_-]+)|FUNCTIONS_URL[^\n]*?/([a-z0-9_-]+)"

report = collections.defaultdict(list)
for p, t in code.items():
    short = p.replace(REPO + "/", "").replace("\\", "/")
    for name in uses(t, FROM):
        if name not in TABLES and "storage" not in t[max(0, t.find(name) - 60):t.find(name)]:
            report["MISSING table/view"].append(f"{name}  <- {short}")
    for name in uses(t, RPC):
        if name not in RPCS:
            report["MISSING rpc"].append(f"{name}  <- {short}")
    for name in uses(t, INV):
        if name not in SLUGS:
            report["MISSING function"].append(f"{name}  <- {short}")

allcode = "\n".join(code.values())
allsql = "\n".join(sql.values())
for t in sorted(TABLES):
    if not re.search(rf"\b{t}\b", allcode):
        # referenced by a SQL function body other than its own create/alter/policy lines?
        body_refs = [l for l in allsql.splitlines() if re.search(rf"\b{t}\b", l)
                     and not re.search(r"^\s*(create table|alter table|create policy|drop|grant|revoke|comment on|create index|create unique index|--)", l, re.I)]
        report["UNUSED by app code (table/view)"].append(f"{t}  (sql mentions: {len(body_refs)})")
for r in sorted(RPCS):
    if not re.search(rf"\b{r}\b", allcode):
        n = len(re.findall(rf"\b{r}\s*\(", allsql))
        report["UNUSED by app code (rpc)"].append(f"{r}  (sql calls/defs: {n})")
invoked = uses(allcode, INV) | {a or b for a, b in re.findall(FETCHF, allcode)}
sched = "scheduled-job"
for s in sorted(SLUGS):
    if s not in invoked and s != sched:
        report["function never invoked from app"].append(s)

for k, v in report.items():
    print(f"\n== {k} ({len(v)})")
    for x in sorted(set(v)):
        print("  ", x)
