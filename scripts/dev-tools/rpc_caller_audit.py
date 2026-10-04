"""Who calls each public database function, and who can execute it on staging (read-only analysis).

    python scripts/dev-tools/rpc_caller_audit.py e2e-out/staging-fn-acl.txt

Input: lines `FN|signature|secdef|anon|authenticated|service_role|public|return type` (from
pg_proc / has_function_privilege on staging). Cross-references:
  browser   - supabase.rpc("name") under src/
  server    - .rpc('name') / rpc/name under supabase/functions, functions-service, accounts,
              transcription-worker, crawler, bug-finder; scheduled-job JOBS map
  sql       - referenced from other SQL (policies, views, other functions) in supabase/migrations
  revoked   - the LAST migration statement about the function revokes anon/authenticated
Prints one row per function that anon or authenticated can execute, with a proposed class:
  A server-only   not called by the browser, called by a server, secdef, migrations meant it revoked
  B user-callable called by the browser
  C admin         admin_* called by the browser (keeps its own is_admin check)
  D unclear       anything else (left alone)
"""
import glob, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
rows = [l.rstrip("\n").split("|") for l in open(sys.argv[1], encoding="utf-8") if l.startswith("FN|")]


def files(*globs):
    out = []
    for g in globs:
        out += glob.glob(os.path.join(ROOT, g), recursive=True)
    return [f for f in out if os.path.isfile(f) and "node_modules" not in f]


def text(f):
    return open(f, encoding="utf-8", errors="ignore").read()


RPC = re.compile(r"""\.rpc\(\s*['"]([a-z_0-9]+)['"]|rpc/([a-z_0-9]+)""")
browser = {m.group(1) or m.group(2) for f in files("src/**/*.ts", "src/**/*.tsx") if ".test." not in f for m in RPC.finditer(text(f))}
server_files = files("supabase/functions/**/*.ts", "functions-service/**/*.ts", "accounts/*.py", "transcription-worker/*.py",
                     "crawler/*.py", "bug-finder/*.mjs", "files-service/*.ts", "auth-bridge/*.ts")
server = {}
for f in server_files:
    if "_test" in f or "test_" in os.path.basename(f):
        continue
    for m in RPC.finditer(text(f)):
        server.setdefault(m.group(1) or m.group(2), set()).add(os.path.relpath(f, ROOT).replace("\\", "/"))
jobs = text(os.path.join(ROOT, "supabase/functions/scheduled-job/index.ts"))
for name in re.findall(r"'([a-z_]+)'", jobs[jobs.find("JOBS"):jobs.find("JOBS") + 2000]):
    server.setdefault(name, set()).add("scheduled-job JOBS")

migs = sorted(files("supabase/migrations/*.sql"))
mig_text = {f: text(f).lower() for f in migs}
STMT = re.compile(r"(revoke|grant)\s+(?:all|execute)(?:\s+privileges)?\s+on\s+function\s+public\.([a-z_0-9]+)\b[^;]*?\b(from|to)\b([^;]*);", re.S)
last = {}
for f in migs:
    for m in STMT.finditer(mig_text[f]):
        kind, name, _, who = m.group(1), m.group(2), m.group(3), m.group(4)
        if any(r in who for r in ("anon", "authenticated", "public")):
            last[name] = (kind, os.path.basename(f))
# names revoked/granted inside DO-blocks by array (e.g. server_rpc_grants) count as server grants
sqlref = {}
for f in migs:
    for name in set(re.findall(r"public\.([a-z_0-9]+)\s*\(", mig_text[f])):
        sqlref.setdefault(name, 0)
        sqlref[name] += 1

out = []
for _, sig, secdef, anon, auth, svc, pub, rt in rows:
    if rt == "trigger" or (anon != "t" and auth != "t"):
        continue
    name = sig.split("(")[0]
    b = name in browser
    s = sorted(server.get(name, []))
    rv = last.get(name)
    if b and name.startswith("admin_"):
        cls = "C admin"
    elif b:
        cls = "B user-callable"
    elif s and secdef == "t" and (rv is None or rv[0] == "revoke"):
        cls = "A server-only"
    else:
        cls = "D unclear"
    out.append((cls, sig, secdef, anon, auth, svc, pub, "browser" if b else "", ";".join(s)[:90], f"{rv[0]} in {rv[1]}" if rv else "no anon/auth statement"))
for r in sorted(out):
    print(" | ".join(r))
print("\ncounts:", {c: sum(1 for r in out if r[0] == c) for c in sorted({r[0] for r in out})})
