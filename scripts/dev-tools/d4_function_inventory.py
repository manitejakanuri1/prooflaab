"""D4: per-function security inventory of every public function on staging.

Input: a dump made by e2e-out/d34/inv.sql (FN/TRG/POL/VIEW rows). Output: e2e-out/d4-inventory.json,
one record per function with grants, callers (browser / server / scripts / SQL / triggers / policies /
views), the creating and granting migrations, and source flags (auth checks, writes, sensitive tables).
Source flags only nominate candidates; sensitive functions are proven by behaviour tests elsewhere.

    python scripts/dev-tools/d4_function_inventory.py e2e-out/d34/inv.txt
"""
import base64, json, os, re, subprocess, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
dump = open(sys.argv[1], encoding="utf-8").read().splitlines()
rows = lambda k: [json.loads(l[len(k) + 1:]) for l in dump if l.startswith(k + "|")]
b64 = lambda s: base64.b64decode(s).decode("utf-8", "replace")
FN, TRG, POL, VIEW = rows("FN"), rows("TRG"), rows("POL"), rows("VIEW")
M = json.load(open(os.path.join(ROOT, "scripts", "rpc_manifest.json"), encoding="utf-8"))

files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
code = {}
for f in files:
    if not re.search(r"\.(ts|tsx|js|mjs|py|sh)$", f) or f.endswith("integrations/supabase/types.ts") or f.startswith(("docs/", "e2e-out/")):
        continue
    try:
        code[f] = open(os.path.join(ROOT, f), encoding="utf-8").read()
    except (UnicodeDecodeError, FileNotFoundError):
        pass
migs = {f: open(os.path.join(ROOT, f), encoding="utf-8", errors="replace").read().lower()
        for f in sorted(files) if f.startswith("migration/") and f.endswith(".sql") and "rollback" not in f}

def where(f):
    if f.startswith("src/"):
        return "browser"
    if f.startswith(("scripts/", "e2e/", "tests/")) or "/test" in f or f.endswith(("_test.ts", ".test.ts", "_test.py")):
        return "script"
    return "server"

src = {f["sig"]: b64(f["src"]) for f in FN}
secdef = {f["sig"]: f["secdef"] for f in FN}
pol_text = [(p["table"], p["name"], b64(p["qual"]) + " " + b64(p["check"])) for p in POL]
view_text = [(v["name"], b64(v["def"])) for v in VIEW]
trig = {}
for t in TRG:
    trig.setdefault(t["fn"], []).append(f"{t['table']}.{t['name']}")

cls_of = {}
for k in ("server_only", "sql_internal", "policy_helper", "admin_only", "user_callable", "pending_review"):
    for s in M[k]:
        cls_of[s] = k

SENSITIVE = {
    "scores": r"\b(score|scores|points|grade)\b", "xp": r"total_xp|\bxp\b", "submissions": r"task_submissions|submissions\b",
    "tasks": r"\btasks\b", "roles": r"user_roles", "notifications": r"\bnotifications\b", "security_events": r"security_events",
    "accounts": r"auth\.users|student_profiles", "college": r"\bcolleges\b|college_id", "recruiter": r"recruiter",
    "company": r"compan|startup",
}
out = []
for f in FN:
    sig, name, s = f["sig"], f["name"], src[f["sig"]]
    low = s.lower()
    word = re.compile(r"\b" + re.escape(name) + r"\s*\(")
    rpc = re.compile(r"""rpc\(\s*['"`]""" + re.escape(name) + r"""['"`]|/rpc/""" + re.escape(name) + r"""\b|['"]""" + re.escape(name) + r"""['"]""")
    callers = {"browser": [], "server": [], "script": []}
    for path, text in code.items():
        if rpc.search(text):
            callers[where(path)].append(path)
    sql_callers = [o for o, t in src.items() if o != sig and word.search(t)]
    created = [m for m, t in migs.items() if re.search(r"create\s+(or\s+replace\s+)?function\s+(public\.)?" + re.escape(name) + r"\s*\(", t)]
    granted = [m for m, t in migs.items() if re.search(r"grant\s+execute\s+on\s+function\s+(public\.)?" + re.escape(name) + r"\b", t)]
    args = f["args"] or ""
    out.append({
        "signature": sig, "class_before": cls_of.get(sig, "unlisted"), "language": f["lang"], "security_definer": f["secdef"],
        "owner": f["owner"], "config": f["config"], "volatility": {"i": "immutable", "s": "stable", "v": "volatile"}[f["vol"]],
        "returns": f["ret"], "trigger_function": f["ret"] == "trigger",
        "execute": {"PUBLIC": f["pub"], "anon": f["anon"], "authenticated": f["auth"], "service_role": f["svc"]},
        "fixed_search_path": any(c.startswith("search_path=") for c in (f["config"] or [])),
        "callers": {**callers, "sql": [{"fn": o, "caller_secdef": secdef[o]} for o in sql_callers],
                    "triggers": trig.get(sig, []),
                    "policies": [f"{t}.{n}" for t, n, txt in pol_text if word.search(txt)],
                    "views": [v for v, txt in view_text if word.search(txt)]},
        "created_in": created, "granted_in": granted,
        "uses": {k: bool(re.search(p, low)) for k, p in {
            "auth.uid": r"auth\.uid\(\)", "auth.role": r"auth\.role\(\)", "is_admin": r"is_admin\(\)", "has_role": r"has_role\(",
            "college_scope": r"college_owns_student\(|viewer_college_id\(|my_approved_college_ids\(",
            "recruiter_scope": r"is_verified_recruiter\(|my_recruiter_id\(", "company_scope": r"my_company_ok\(|startup_id|company_id",
            "raises": r"raise\s+exception"}.items()},
        "writes": sorted(set(m.group(2) for m in re.finditer(r"\b(insert\s+into|update|delete\s+from)\s+(?:only\s+)?(public\.\w+|\w+)", low)
                             if m.group(2) not in ("set", "of", "on", "public", "to"))),
        "touches": sorted(k for k, p in SENSITIVE.items() if re.search(p, low)),
        "id_args": [a.strip() for a in args.split(",") if re.search(r"(student|user|profile|account|college|recruiter|company|startup|candidate|target)\w*\s+uuid", a)],
        "source_lines": s.count("\n") + 1,
    })
json.dump(out, open(os.path.join(ROOT, "e2e-out", "d4-inventory.json"), "w", encoding="utf-8"), indent=1)
print(f"{len(out)} functions -> e2e-out/d4-inventory.json")
