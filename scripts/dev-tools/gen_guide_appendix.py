"""Builds the reference appendices of the developer guide straight from the code and the live schema.
Nothing is typed by hand here, so it cannot drift from the project.
Output: HTML fragments in the folder given as argv[1] (routes.html, tables.html, screens.html, functions.html)."""
import json, os, re, sys, glob, collections, html

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = sys.argv[1]
OPENAPI = sys.argv[2]
e = html.escape
c = lambda s: f"<code>{e(s)}</code>"

# ---------------------------------------------------------------- routes
app = open(os.path.join(ROOT, "src", "App.tsx"), encoding="utf-8").read()
routes = []
for chunk in app.split("<Route")[1:]:
    pm = re.search(r'path="([^"]+)"', chunk)
    if not pm: continue
    guard = re.search(r'allowedRoles=\{\[([^\]]*)\]\}', chunk[:700])
    comps = [x for x in re.findall(r"<([A-Z][A-Za-z0-9]+)", chunk[:700]) if x not in ("RoleBasedProtectedRoute", "ProtectedRoute", "Route", "Suspense")]
    nav = re.search(r'Navigate to="([^"]+)"', chunk[:400])
    page = comps[0] if comps else (("redirects to " + nav.group(1)) if nav else "?")
    g = guard.group(1).replace('"', "").replace("'", "") if guard else ("logged in" if "ProtectedRoute" in chunk[:300] else "public")
    routes.append((pm.group(1), page, g))
with open(os.path.join(OUT, "routes.html"), "w", encoding="utf-8") as f:
    f.write("<table><tr><th>Web address</th><th>Screen (page component)</th><th>Who may open it</th></tr>")
    for p, s, g in routes:
        f.write(f"<tr><td>{c(p)}</td><td>{c(s)}</td><td>{e(g)}</td></tr>")
    f.write("</table>")

# ---------------------------------------------------------------- data dictionary
api = json.load(open(OPENAPI, encoding="utf-8"))
defs = api["definitions"]
fks = collections.defaultdict(list)          # table -> [(col, target table.col)]
incoming = collections.defaultdict(list)
areas = [
    ("People and login", "user_roles admin_users student_profiles student_contact student_intake student_interests college_profiles colleges startup_profiles startups recruiters user_preferences"),
    ("Resume", "resume_claims resume_assessments resume_scorecards public_resume_scorecards student_certifications"),
    ("Tracks and lessons", "level_tracks track_phases levels level_content level_syllabus topic_links student_tracks student_levels student_week_plan student_skills topic_ratings question_calibration skill_aliases"),
    ("Daily tasks (Lots) and jobs", "tasks task_templates lot_templates task_explainers task_assignments task_submissions task_rubric_config task_sandbox_config task_applications job_opportunities"),
    ("Content", "source_registry source_content crawl_queue"),
    ("Squads and seasons", "seasons squads squad_members squad_matches squad_weekly_scores student_weekly_scores squad_scoring_rules squad_name_themes"),
    ("Voice and interview", "voice_explanations mock_interviews"),
    ("Proof and trust (older system)", "proof_uploads proof_appeals trust_scores ai_verifications github_verifications conceptual_tests conceptual_answer_keys cosigns verification_settings"),
    ("Engagement", "student_streaks coding_streaks xp_logs student_credits badges student_badges quests student_quests student_activity_events manual_adjustment_log student_portfolios"),
    ("Company and college tools", "recruiter_links recruiter_link_views recruiter_shortlists recruiter_views interventions learning_resources announcements"),
    ("AI, safety and audit", "llm_usage llm_usage_by_student llm_cache ai_templates rate_limits security_events audit_logs notifications"),
    ("Imports", "student_imports student_import_rows removed_students"),
]
for t, d in defs.items():
    for col, p in d.get("properties", {}).items():
        m = re.search(r"Foreign Key to `([^`]+)`", p.get("description", "") or "")
        if m:
            fks[t].append((col, m.group(1)))
            incoming[m.group(1).split(".")[0]].append((t, col))
placed = set()
with open(os.path.join(OUT, "tables.html"), "w", encoding="utf-8") as f:
    for area, names in areas:
        f.write(f"<h3>{e(area)}</h3>")
        for t in names.split():
            if t not in defs:
                continue
            placed.add(t)
            d = defs[t]
            req = set(d.get("required", []))
            f.write(f'<div style="page-break-inside:avoid;margin-bottom:3mm"><h4>{c(t)}</h4><table><tr><th style="width:26%">Column</th><th style="width:22%">Type</th><th>Notes</th></tr>')
            for col, p in d.get("properties", {}).items():
                desc = (p.get("description") or "").replace("\n", " ")
                notes = []
                if "Primary Key" in desc:
                    notes.append("<b>PK</b>")
                m = re.search(r"Foreign Key to `([^`]+)`", desc)
                if m:
                    notes.append("FK &rarr; " + c(m.group(1)))
                if col in req and "default" not in p and "Primary Key" not in desc:
                    notes.append("required")
                if "default" in p:
                    notes.append("default " + e(str(p["default"])[:30]))
                f.write(f"<tr><td>{c(col)}</td><td>{e(p.get('format', p.get('type', '')))}</td><td>{' &middot; '.join(notes)}</td></tr>")
            f.write("</table>")
            inc = incoming.get(t, [])
            if inc:
                f.write("<p style='font-size:9pt'><b>Referenced by:</b> " + ", ".join(c(f"{a}.{b}") for a, b in inc[:12]) + "</p>")
            f.write("</div>")
    rest = sorted(set(defs) - placed)
    if rest:
        f.write("<h3>Other tables and views</h3><ul>" + "".join(f"<li>{c(t)}: " + ", ".join(e(k) for k in list(defs[t].get('properties', {}))[:14]) + "</li>" for t in rest) + "</ul>")

# ---------------------------------------------------------------- screens
INV = re.compile(r'functions\.invoke\(\s*["\']([\w-]+)["\']')
RPC = re.compile(r'\.rpc\(\s*["\']([\w]+)["\']')
FROM = re.compile(r'\.from\(\s*["\']([\w]+)["\']')
NAV = re.compile(r'navigate\(\s*[`"\']([^`"\']+)[`"\']')
LINK = re.compile(r'<(?:Link|NavLink)[^>]*\bto=["{`\']+([^"`\'}]+)')
HREF = re.compile(r'(?:window\.location\.(?:href|assign)\s*=\s*|location\.href\s*=\s*)[`"\']([^`"\']+)')
FETCH = re.compile(r'fetch\(\s*[`"\']?([^`"\',)\s]{6,60})')
buckets = {"proofs", "resumes", "voice-explanations", "profile-photos"}
files = []
for base in ("src/pages", "src/components", "src/hooks", "src/lib", "src/contexts"):
    for p in glob.glob(os.path.join(ROOT, base, "**", "*.ts*"), recursive=True):
        if "components/ui/" in p.replace("\\", "/") or p.endswith(".d.ts"):
            continue
        files.append(p)
groups = collections.OrderedDict((k, []) for k in ["Pages", "Student", "College", "Admin", "Company (startup + recruiter)", "Season", "Auth and onboarding", "Hooks", "Lib and contexts", "Shared components"])
def group(p):
    q = p.replace("\\", "/")
    if "/src/pages/" in q: return "Pages"
    if "/dashboard/student/" in q: return "Student"
    if "/dashboard/college/" in q: return "College"
    if "/dashboard/admin/" in q: return "Admin"
    if "/dashboard/startup/" in q or "/dashboard/recruiter/" in q or "/recruiter/" in q: return "Company (startup + recruiter)"
    if "/season/" in q: return "Season"
    if "/auth/" in q or "/onboarding/" in q: return "Auth and onboarding"
    if "/src/hooks/" in q: return "Hooks"
    if "/src/lib/" in q or "/src/contexts/" in q: return "Lib and contexts"
    return "Shared components"
for p in sorted(files):
    s = open(p, encoding="utf-8", errors="replace").read()
    inv, rpc, frm = sorted(set(INV.findall(s))), sorted(set(RPC.findall(s))), sorted(set(FROM.findall(s)))
    st = sorted(x for x in frm if x in buckets); tb = [x for x in frm if x not in buckets]
    nav = sorted(set(NAV.findall(s)) | set(LINK.findall(s)) | set(HREF.findall(s)))
    ext = sorted(set(m for m in FETCH.findall(s) if "transcribe" in m.lower() or "accounts" in m.lower() or "TRANSCRIBER" in m or "ACCOUNTS" in m))
    if not (inv or rpc or tb or st or nav or ext):
        continue
    groups[group(p)].append((os.path.relpath(p, os.path.join(ROOT, "src")).replace("\\", "/"), inv, rpc, tb, st, nav, ext))
with open(os.path.join(OUT, "screens.html"), "w", encoding="utf-8") as f:
    for g, rows in groups.items():
        if not rows: continue
        f.write(f"<h3>{e(g)} ({len(rows)} files)</h3><table><tr><th style='width:22%'>File</th><th>Server functions it calls</th><th>Database functions (rpc)</th><th>Tables / buckets</th><th>Goes to (navigate / link)</th></tr>")
        for fn, inv, rpc, tb, st, nav, ext in rows:
            f.write("<tr><td>" + c(fn) + "</td><td>" + ", ".join(c(x) for x in inv) + (", " + ", ".join(c(x) for x in ext) if ext else "") + "</td><td>" +
                    ", ".join(c(x) for x in rpc) + "</td><td>" + ", ".join(c(x) for x in tb) + (" <i>bucket:</i> " + ", ".join(c(x) for x in st) if st else "") +
                    "</td><td>" + ", ".join(c(x) for x in nav[:8]) + "</td></tr>")
        f.write("</table>")

# ---------------------------------------------------------------- functions
rows = []
for d in sorted(glob.glob(os.path.join(ROOT, "supabase", "functions", "*", "index.ts"))):
    name = d.replace("\\", "/").split("/")[-2]
    s = open(d, encoding="utf-8", errors="replace").read()
    frm = sorted(set(FROM.findall(s)) - buckets)
    rpc = sorted(set(RPC.findall(s)))
    feats = sorted(set(re.findall(r"feature:\s*['\"]([\w-]+)['\"]", s)))
    ai = "generateText" in s or "generateGradedConfig" in s or "explainTask" in s or "ensureTopicSteps" in s
    shared = sorted(set(re.findall(r'_shared/([\w-]+)\.ts', s)))
    calls = []
    if "runOnOwnRunner" in s or "code-runner" in s or "runCode" in s: calls.append("code-runner")
    if "resend" in s.lower(): calls.append("Resend email")
    if "ACCOUNTS" in s or "accounts" in s.lower() and "fetch" in s: calls.append("accounts service")
    lines = s.count("\n")
    auth = "guest-safe" if "getClaims" not in s else "needs login"
    rows.append((name, lines, auth, ai, feats, frm, rpc, shared, calls))
with open(os.path.join(OUT, "functions.html"), "w", encoding="utf-8") as f:
    f.write("<table><tr><th style='width:16%'>Function</th><th>Lines</th><th>Login</th><th>AI</th><th>Tables it reads/writes</th><th>Database functions</th><th>Other services</th></tr>")
    for name, lines, auth, ai, feats, frm, rpc, shared, calls in rows:
        f.write(f"<tr><td>{c(name)}</td><td>{lines}</td><td>{auth}</td><td>{'AI' if ai else '&mdash;'}{' (' + ', '.join(feats) + ')' if feats else ''}</td><td>" + ", ".join(c(x) for x in frm) +
                "</td><td>" + ", ".join(c(x) for x in rpc) + "</td><td>" + ", ".join(calls) + "</td></tr>")
    f.write("</table>")

# ---------------------------------------------------------------- where each database function is defined
used = set()
for g in groups.values():
    for r in g: used |= set(r[2])
loc = {}
mig = sorted(glob.glob(os.path.join(ROOT, "supabase", "migrations", "*.sql")))
for m in mig:
    s = open(m, encoding="utf-8", errors="replace").read()
    for fn in re.findall(r"create (?:or replace )?function\s+public\.(\w+)", s, re.I):
        loc[fn] = os.path.basename(m)
with open(os.path.join(OUT, "dbfunctions.html"), "w", encoding="utf-8") as f:
    f.write("<table><tr><th>Database function (called from the website)</th><th>Last defined in migration</th></tr>")
    for fn in sorted(used):
        f.write(f"<tr><td>{c(fn)}</td><td>{c(loc.get(fn, 'not found in migrations (built-in or older)'))}</td></tr>")
    f.write("</table>")
print("routes", len(routes), "tables", len(placed), "screen files", sum(len(v) for v in groups.values()), "functions", len(rows), "db fns", len(used))
