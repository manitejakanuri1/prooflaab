// S32 (S28 inventory, unchanged logic; regenerated on the release source): static, source-based inventory of the four dashboards. Reads source only; changes nothing.
//
//   node scripts/dev-tools/sidhu_s28_inventory.mjs [--openapi <staging-openapi.json>] [--out <dir>]
//
// For every screen (dashboard -> primary nav -> inner tab -> URL -> root component) it follows the REAL
// import graph under src/, and for every reachable file it extracts:
//   - controls: JSX elements with onClick / onSubmit / onValueChange / onCheckedChange / onChange, their label,
//     the handler expression, and the backend calls made inside that handler's body (one level of local calls);
//   - calls: supabase .rpc("x"), .from("table"), .storage.from("bucket"), functions.invoke("slug"), fetch("/api/..");
//   - suspects: <Button> with no handler / not submit / not a trigger or link; controls that are always disabled.
// Each call is checked against the repository's sources of truth:
//   - RPC / table: created in supabase/migrations or migration/ (and NOT dropped later), or listed in the staging
//     PostgREST schema (--openapi, an anonymous GET of the API root; it only lists what the anonymous role can see);
//   - function: in SLUGS of functions-service/main.ts AND a folder in supabase/functions/;
//   - /api path: handled by web-bff.
// Output: <out>/s28-inventory.json (machine-readable matrix) and a printed summary.
// Status words are about SOURCE only: IMPLEMENTED_IN_SOURCE, or ENDPOINT_NOT_FOUND / ENDPOINT_DROPPED (KNOWN_BROKEN
// candidates that a person must confirm). Nothing here proves anything ran.
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
const D = "src/components/dashboard";
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

// ---------------------------------------------------------------- screens (from the routers, read by hand)
const S = "/student/dashboard", C = "/college/dashboard", K = "/company/dashboard", A = "/admin/dashboard";
const scr = (dashboard, nav, inner, url, roots, note = "") => ({ dashboard, nav, inner, url, roots: roots.map((r) => `${D}/${r}.tsx`), note });
export const SCREENS = [
  scr("student", "Floor", "-", `${S}?tab=lab`, ["student/StudentDailyCard", "student/StudentAssignedTasksPage"]),
  scr("student", "Floor", "assigned tasks (old link)", "/student/tasks/assigned", ["student/StudentDailyCard", "student/StudentAssignedTasksPage"]),
  ...[["entries", "Recent work", "BuildLogEntries"], ["progress", "Progress", "StudentProgressPage"], ["skills", "Skills evidence", "StudentSkillsProved"], ["history", "History", "StudentHistory"]]
    .map(([v, l, c]) => scr("student", "Build-log", l, `${S}?tab=log&view=${v}`, [`student/${c}`])),
  ...["overview", "members", "matches", "standings", "achievements", "leaderboards", "season"]
    .map((v) => scr("student", "Squad", v, `${S}?tab=squad`, ["student/StudentSquadPage"], "inner tab is component state, not in the URL")),
  ...[["proof", "Readiness", "StudentResumeHistoryPage"], ["roadmap", "Roadmap", "StudentRoadmapPage"], ["resume", "Resume", "StudentResumeCheckPage"],
    ["interview", "Mock interview", "MockInterview"], ["certifications", "Certifications", "StudentCertifications"], ["achievements", "Badges", "StudentAchievements"],
    ["role", "Role preference", "StudentRolePreference"], ["privacy", "Privacy", "StudentPrivacy"], ["portfolio", "Portfolio", "StudentPortfolioPage"], ["settings", "Settings", "StudentSettingsPage"]]
    .map(([v, l, c]) => scr("student", "Profile", l, `${S}?tab=profile&view=${v}`, [`student/${c}`])),
  scr("student", "Profile", "Roadmap (old link)", "/student/roadmap", ["student/StudentRoadmapPage"]),
  scr("student", "(chrome)", "header + sidebar", `${S}`, ["student/StudentHeader", "student/StudentSidebar"]),

  scr("college", "Home", "-", `${C}?tab=home`, ["college/TpoHome"]),
  scr("college", "Students", "-", `${C}?tab=students`, ["college/TpoStudents"]),
  ...["standings", "overview", "members", "matches", "assign", "manage", "performance", "achievements", "leaderboards"]
    .map((v) => scr("college", "Squads", v, `${C}?tab=squads`, ["college/TpoSquads"], "inner tab is component state, not in the URL")),
  scr("college", "Insights", "-", `${C}?tab=insights`, ["college/TpoInsights"]),
  scr("college", "(account)", "Notifications", `${C}?tab=notifications`, ["college/NotificationsSection"]),
  scr("college", "(account)", "Profile", `${C}?tab=profile`, ["college/CollegeProfilePage"]),
  scr("college", "(account)", "Settings", `${C}?tab=settings`, ["college/CollegeSettingsPage"]),
  scr("college", "(chrome)", "header + sidebar", `${C}`, ["college/CollegeDashboardHeader", "college/CollegeDashboardSidebar"]),

  scr("company", "Home", "-", `${K}`, ["recruiter/RecruiterDashboardContent"], "section activeTab=home"),
  scr("company", "Talent", "-", `${K}?tab=talent`, ["recruiter/RecruiterDashboardContent"], "section activeTab=talent"),
  scr("company", "Lots", "My Lots", `${K}?tab=lots&view=active`, ["recruiter/RecruiterDashboardContent"], "section activeTab=lots; needs verification"),
  scr("company", "Lots", "Create a Lot", `${K}?tab=lots&view=create`, ["recruiter/RecruiterDashboardContent"], "section activeTab=shortlist; needs verification"),
  scr("company", "Lots", "Submissions", `${K}?tab=lots&view=submissions`, ["startup/StartupSubmissionsPage"], "needs verification"),
  scr("company", "Lots", "Reviews", `${K}?tab=lots&view=reviews`, ["startup/StartupSubmissionsPage"], "initialFilter=unreviewed; needs verification"),
  scr("company", "Hiring", "Shortlist", `${K}?tab=hiring&view=shortlist`, ["recruiter/RecruiterDashboardContent"], "section activeTab=shortlist; needs verification"),
  scr("company", "Hiring", "Job posts", `${K}?tab=hiring&view=jobs`, ["startup/StartupJobsPage"], "needs verification"),
  scr("company", "(account)", "Settings", `${K}?tab=settings`, ["startup/StartupSettingsPage"]),
  scr("company", "(chrome)", "header + sidebar + banner", `${K}`, ["startup/StartupDashboardHeader", "startup/StartupSidebar", "startup/VerificationBanner"]),
];
const ADMIN = {
  Home: [["dashboard", "Overview", "AdminDashboardOverview"], ["analytics", "Reports", "AdminAnalytics"], ["announcements", "Announcements", "ContentManagement"]],
  People: [["students", "Students", "EnhancedUserManagement"], ["colleges", "Colleges", "EnhancedUserManagement"], ["startups", "Companies", "EnhancedUserManagement,RecruiterOversight"],
    ["college-oversight", "College users", "CollegeOversight"], ["student-oversight", "Student oversight", "StudentOversight"], ["settings", "Admins & roles", "SystemSettings"]],
  Work: [["task-oversight", "Lots & tasks", "TaskOversight"], ["daily-lots", "Daily Lots", "DailyLots"], ["submissions", "Submissions", "AdminSubmissions"],
    ["reviewed-submissions", "Flags & reviews", "ReviewedSubmissions"], ["assign-tasks", "Assign tasks", "AdminAssignTasks"], ["content-library", "Content library", "ContentLibrary"],
    ["jobs", "Job sources", "ContentManagement"], ["resources", "Resources", "ContentManagement"]],
  Operations: [["token-usage", "AI usage", "TokenUsage"], ["ops-jobs", "Jobs & health", "AdminOpsHealth"], ["security-events", "Security & audit", "SecurityEvents"],
    ["student-trace", "Errors & traces", "StudentTrace"], ["bug-finder", "Bug finder", "BugFinder"]],
};
for (const [nav, kids] of Object.entries(ADMIN)) for (const [id, label, comps] of kids) SCREENS.push(scr("admin", nav, label, `${A}?tab=${id}`, comps.split(",").map((c) => `admin/${c}`)));
SCREENS.push(scr("admin", "People", "Students (old link)", `${A}/user-management/students`, ["admin/EnhancedUserManagement"]));
SCREENS.push(scr("admin", "(chrome)", "header + sidebar + notifications", `${A}`, ["admin/AdminHeader", "admin/AdminSidebar", "admin/AdminNotificationsPopover"]));

// ---------------------------------------------------------------- sources of truth
function sqlObjects() {
  const files = [
    ...readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(ROOT, "supabase/migrations", f)),
    ...readdirSync(join(ROOT, "migration")).filter((f) => f.endsWith(".sql") && !/rollback/i.test(f)).sort((a, b) => (parseInt(a) || 999) - (parseInt(b) || 999) || a.localeCompare(b)).map((f) => join(ROOT, "migration", f)),
  ];
  const fn = new Map(), table = new Map();   // name -> { created, droppedAfter, where }
  const touch = (m, name, op, f) => { const e = m.get(name) ?? { created: false, dropped: false, where: [] }; if (op === "create") { e.created = true; e.dropped = false; } else e.dropped = true; e.where.push(`${op} ${rel(f)}`); m.set(name, e); };
  for (const f of files) {
    const sql = readFileSync(f, "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/\b(create(?:\s+or\s+replace)?\s+function|drop\s+function(?:\s+if\s+exists)?)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)) touch(fn, m[2].toLowerCase(), /^drop/i.test(m[1]) ? "drop" : "create", f);
    for (const m of sql.matchAll(/\b(create\s+(?:unlogged\s+)?table(?:\s+if\s+not\s+exists)?|create(?:\s+or\s+replace)?\s+(?:materialized\s+)?view(?:\s+if\s+not\s+exists)?|drop\s+(?:table|view|materialized\s+view)(?:\s+if\s+exists)?)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi)) touch(table, m[2].toLowerCase(), /^drop/i.test(m[1]) ? "drop" : "create", f);
    for (const m of sql.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)/gi)) { touch(table, m[1].toLowerCase(), "drop", f); touch(table, m[2].toLowerCase(), "create", f); }
  }
  return { fn, table };
}
function functionSlugs() {
  const main = readFileSync(join(ROOT, "functions-service/main.ts"), "utf8");
  const block = main.slice(main.indexOf("const SLUGS"), main.indexOf("];", main.indexOf("const SLUGS")));
  return new Set([...block.matchAll(/"([a-z0-9_-]+)"/g)].map((m) => m[1]).filter((s) => existsSync(join(ROOT, "supabase/functions", s, "index.ts"))));
}
function bffPrefixes() {
  return ["/api/auth/", "/api/db", "/api/functions/", "/api/files/", "/api/accounts/remove", "/api/transcriber/transcribe"];   // web-bff/main.ts + proxyRoutes.ts
}

// ---------------------------------------------------------------- source parsing
const cache = new Map();
const read = (p) => { if (!cache.has(p)) cache.set(p, readFileSync(p, "utf8")); return cache.get(p); };
function resolveImport(from, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  return null;
}
const SKIP = /src[\\/](components[\\/]ui|integrations)[\\/]|src[\\/]lib[\\/]utils\.ts$/;
function importsOf(file) {
  const out = [];
  for (const m of read(file).matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g)) {
    if (/^type\s/.test(m[0].slice(7))) continue;
    const r = resolveImport(file, m[2]);
    if (r && !SKIP.test(r)) out.push({ file: r, names: m[1].replace(/[{}]/g, " ").split(/[\s,]+/).filter((n) => /^[A-Za-z_]/.test(n) && n !== "as") });
  }
  return out;
}
function closure(roots) {
  const seen = new Set(); const stack = [...roots];
  while (stack.length) { const f = stack.pop(); if (seen.has(f) || !existsSync(f)) continue; seen.add(f); for (const i of importsOf(f)) stack.push(i.file); }
  return [...seen];
}
// Balanced segment starting at text[i] (one of { ( [), returns end index (exclusive). Skips strings/template literals roughly.
function balanced(text, i) {
  const open = text[i], close = { "{": "}", "(": ")", "[": "]" }[open]; let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"' || ch === "'" || ch === "`") { const q = ch; j++; while (j < text.length && text[j] !== q) { if (text[j] === "\\") j++; j++; } continue; }
    if (ch === open) depth++; else if (ch === close && --depth === 0) return j + 1;
  }
  return text.length;
}
const lineOf = (text, i) => text.slice(0, i).split("\n").length;

export function callsIn(text, offset = 0, whole = text) {
  const out = [];
  const add = (kind, name, i) => out.push({ kind, name, line: lineOf(whole, offset + i) });
  for (const m of text.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g)) add("rpc", m[1], m.index);
  for (const m of text.matchAll(/\.rpc\(\s*([a-zA-Z_][\w]*)\s*(?:as\s+never)?\s*,/g)) add("rpc", `<dynamic:${m[1]}>`, m.index);
  for (const m of text.matchAll(/storage\s*\.from\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) add("storage", m[1], m.index);
  for (const m of text.matchAll(/(?<!storage\s*)\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*(?:as\s+never\s*)?\)/g)) add("table", m[1], m.index);
  for (const m of text.matchAll(/(?<!storage\s*)\.from\(\s*([a-zA-Z_]\w*)\s*(?:as\s+never\s*)?\)/g)) add("table", `<dynamic:${m[1]}>`, m.index);
  for (const m of text.matchAll(/functions\s*\.invoke\(\s*["'`]([a-zA-Z0-9_-]+)["'`]/g)) add("function", m[1], m.index);
  for (const m of text.matchAll(/fetch\(\s*["'`](\/api\/[^"'`?]+)/g)) add("api", m[1], m.index);
  return out;
}
// The table op that follows a .from("x") call (select / insert / update / upsert / delete).
function tableOps(text) {
  const ops = new Map();
  for (const m of text.matchAll(/\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*(?:as\s+never\s*)?\)\s*\.(select|insert|update|upsert|delete)\b/g)) {
    const s = ops.get(m[1]) ?? new Set(); s.add(m[2]); ops.set(m[1], s);
  }
  return ops;
}
// Inner-tab blocks: <TabsContent value="x"> ... </TabsContent>  and  {x === "y" && ( ... )}
function blocks(text) {
  const out = [];
  for (const m of text.matchAll(/<TabsContent\s+value=["']([^"']+)["'][^>]*>/g)) {
    const end = text.indexOf("</TabsContent>", m.index);
    out.push({ key: m[1], start: m.index, end: end < 0 ? text.length : end });
  }
  for (const m of text.matchAll(/\b(?:activeTab|tab|view|v|section|current)\s*===\s*["']([a-z0-9-]+)["']\s*&&\s*\(/g)) {
    const p = m.index + m[0].length - 1;
    out.push({ key: m[1], start: m.index, end: balanced(text, p) });
  }
  return out;
}
const blockAt = (bl, i) => bl.filter((b) => i >= b.start && i < b.end).map((b) => b.key);

function labelOf(text, tagStart, tagEnd, tagName) {
  const attr = text.slice(tagStart, tagEnd).match(/(?:aria-label|title)=["']([^"']+)["']/);
  if (attr) return attr[1];
  const close = text.indexOf(`</${tagName}>`, tagEnd);
  if (close > 0 && close - tagEnd < 600) {
    const inner = text.slice(tagEnd, close).replace(/<[^>]+>/g, " ").replace(/\{[^}]*\}/g, (s) => (/["'`]/.test(s) ? s.replace(/[^A-Za-z0-9 '"`.,&-]/g, " ") : " ")).replace(/\s+/g, " ").trim();
    if (inner) return inner.slice(0, 60);
  }
  const nearby = text.slice(tagEnd, tagEnd + 200).match(/>\s*([A-Za-z][^<{]{1,50})/);
  return nearby ? nearby[1].trim() : "(icon / no text)";
}
// Definition body of a local function / const in the same file.
function localBody(text, name) {
  const re = new RegExp(`(?:const|let|function)\\s+${name}\\b[^=({]*(?:=\\s*(?:useCallback\\()?\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z_]\\w*)\\s*(?::[^=]*)?=>\\s*|\\([^)]*\\)\\s*(?::[^{]*)?)`);
  const m = re.exec(text); if (!m) return null;
  let i = m.index + m[0].length; while (/\s/.test(text[i])) i++;
  if (text[i] === "{" || text[i] === "(") return { start: i, end: balanced(text, i) };
  const semi = text.indexOf(";", i); return { start: i, end: semi < 0 ? i + 200 : semi };
}
function traceHandler(text, expr, depth = 0, visited = new Set(), offset = 0) {
  const calls = callsIn(expr, offset, text);
  if (depth > 2) return calls;
  const names = new Set([...expr.matchAll(/(?<![\w.])([a-z][A-Za-z0-9_]*)\s*\(/g)].map((m) => m[1]));
  const bare = expr.trim().match(/^\{?\s*([a-z][A-Za-z0-9_]*)\s*\}?$/); if (bare) names.add(bare[1]);
  for (const n of names) {
    if (visited.has(n) || ["set", "if", "navigate", "toast", "e", "async", "await", "Promise"].includes(n) || /^set[A-Z]/.test(n)) continue;
    visited.add(n);
    const b = localBody(text, n); if (!b) continue;
    const body = text.slice(b.start, b.end);
    for (const c of traceHandler(text, body, depth + 1, visited, b.start)) calls.push({ ...c, via: c.via ?? n });
  }
  return calls;
}
export function controlsIn(file) {
  const text = read(file); const bl = blocks(text); const out = []; const suspects = [];
  for (const m of text.matchAll(/<([A-Z][A-Za-z.]*|button|form|input|select|a)\b/g)) {
    const tagStart = m.index; let j = tagStart + 1, depth = 0;
    for (; j < text.length; j++) { const ch = text[j]; if (ch === "{") depth++; else if (ch === "}") depth--; else if (ch === ">" && depth === 0) break; }
    const tag = text.slice(tagStart, j + 1);
    const ev = tag.match(/\b(onClick|onSubmit|onValueChange|onCheckedChange|onChange|onSelect)=\{/);
    const tagName = m[1];
    if (ev) {
      const p = tagStart + ev.index + ev[0].length - 1;
      const expr = text.slice(p + 1, balanced(text, p) - 1).trim();
      if (ev[1] === "onChange" && !/type=["'](file|checkbox|radio)["']|<select|Select/.test(tag) && tagName !== "select") continue;   // typing in a box is not an action
      const calls = traceHandler(text, expr, 0, new Set(), p + 1);
      out.push({ file: rel(file), line: lineOf(text, tagStart), element: tagName, event: ev[1], label: labelOf(text, tagStart, j + 1, tagName), handler: expr.replace(/\s+/g, " ").slice(0, 120), calls: dedupe(calls), inner: blockAt(bl, tagStart), disabled: /\bdisabled(\s|\/|>|=\{true\})/.test(tag) ? "always" : /\bdisabled=\{/.test(tag) ? "conditional" : "no" });
    } else if (tagName === "Button" || tagName === "button") {
      if (/type=["']submit["']|asChild/.test(tag)) continue;
      const before = text.slice(Math.max(0, tagStart - 160), tagStart);
      if (/(Trigger|Close|Link|<a\b|PopoverTrigger|DropdownMenuTrigger|SheetTrigger|DialogTrigger|AlertDialogAction|AlertDialogCancel)[^<]*>\s*$/.test(before)) continue;
      suspects.push({ file: rel(file), line: lineOf(text, tagStart), label: labelOf(text, tagStart, j + 1, tagName), why: /\{\.\.\.[a-zA-Z]/.test(tag) ? "props spread (handler may come from parent)" : "no onClick, not submit, not a trigger/link", inner: blockAt(bl, tagStart) });
    }
  }
  return { controls: out, suspects };
}
const dedupe = (calls) => { const seen = new Set(); return calls.filter((c) => { const k = `${c.kind}:${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; }); };

// ---------------------------------------------------------------- build
export function buildInventory({ openapi } = {}) {
  const sql = sqlObjects(); const slugs = functionSlugs(); const api = bffPrefixes();
  const oa = openapi ? JSON.parse(readFileSync(openapi, "utf8")) : null;
  const oaRpc = new Set(oa ? Object.keys(oa.paths).filter((p) => p.startsWith("/rpc/")).map((p) => p.slice(5)) : []);
  const oaTab = new Set(oa ? Object.keys(oa.paths).filter((p) => !p.startsWith("/rpc/") && p !== "/").map((p) => p.slice(1)) : []);
  const check = (c) => {
    if (c.kind === "rpc") {
      if (c.name.startsWith("<dynamic")) return { status: "DYNAMIC", evidence: "name chosen at run time" };
      const e = sql.fn.get(c.name.toLowerCase());
      if (e?.created && !e.dropped) return { status: "IMPLEMENTED_IN_SOURCE", evidence: e.where.at(-1) };
      if (oaRpc.has(c.name)) return { status: "IMPLEMENTED_IN_SOURCE", evidence: "staging PostgREST schema (anonymous listing)" };
      if (e?.dropped) return { status: "ENDPOINT_DROPPED", evidence: e.where.at(-1) };
      return { status: "ENDPOINT_NOT_FOUND", evidence: "no create in migrations; not in anonymous staging listing (may exist for signed-in roles or in the restored base dump)" };
    }
    if (c.kind === "table") {
      if (c.name.startsWith("<dynamic")) return { status: "DYNAMIC", evidence: "table name chosen at run time" };
      const e = sql.table.get(c.name.toLowerCase());
      if (oaTab.has(c.name)) return { status: "IMPLEMENTED_IN_SOURCE", evidence: "staging PostgREST schema (anonymous listing)" };
      if (e?.created && !e.dropped) return { status: "IMPLEMENTED_IN_SOURCE", evidence: e.where.at(-1) };
      if (e?.dropped) return { status: "ENDPOINT_DROPPED", evidence: e.where.at(-1) };
      return { status: "ENDPOINT_NOT_FOUND", evidence: "no create in migrations; not in anonymous staging listing (may be in the restored base dump)" };
    }
    if (c.kind === "function") return slugs.has(c.name) ? { status: "IMPLEMENTED_IN_SOURCE", evidence: "functions-service SLUGS + supabase/functions" } : { status: "ENDPOINT_NOT_FOUND", evidence: "not in functions-service SLUGS" };
    if (c.kind === "api") return api.some((p) => c.name.startsWith(p)) ? { status: "IMPLEMENTED_IN_SOURCE", evidence: "web-bff route" } : { status: "ENDPOINT_NOT_FOUND", evidence: "no web-bff route" };
    return { status: "IMPLEMENTED_IN_SOURCE", evidence: "storage bucket via files service" };
  };

  const fileInfo = new Map();
  const info = (f) => {
    if (!fileInfo.has(f)) {
      const text = read(f);
      const { controls, suspects } = controlsIn(f);
      const ops = tableOps(text);
      const calls = dedupe(callsIn(text)).map((c) => ({ ...c, ops: c.kind === "table" ? [...(ops.get(c.name) ?? [])] : undefined, ...check(c) }));
      for (const ctl of controls) ctl.calls = ctl.calls.map((c) => ({ ...c, ...check(c) }));
      fileInfo.set(f, { file: rel(f), controls, suspects, calls, blocks: [...new Set(blocks(text).map((b) => b.key))] });
    }
    return fileInfo.get(f);
  };

  const screens = SCREENS.map((s) => {
    const roots = s.roots.map((r) => join(ROOT, r));
    const files = closure(roots);
    const infos = files.map(info);
    // A screen that is one inner tab of a shared component only owns the controls in its block (or outside any block).
    const key = s.note.match(/section activeTab=(\w+)/)?.[1] ?? (["Squad", "Squads"].includes(s.nav) ? s.inner : null);
    const mine = (c) => !key || c.inner.length === 0 || c.inner.includes(key) || !roots.some((r) => rel(r) === c.file);
    return {
      ...s,
      files: infos.map((i) => i.file),
      controls: infos.flatMap((i) => i.controls).filter(mine),
      suspects: infos.flatMap((i) => i.suspects).filter(mine),
      calls: infos.flatMap((i) => i.calls.map((c) => ({ ...c, file: i.file }))),
    };
  });
  const all = [...fileInfo.values()];
  const uniqueCalls = new Map();
  for (const i of all) for (const c of i.calls) { const k = `${c.kind}:${c.name}`; const e = uniqueCalls.get(k) ?? { kind: c.kind, name: c.name, status: c.status, evidence: c.evidence, ops: new Set(), files: new Set() }; (c.ops ?? []).forEach((o) => e.ops.add(o)); e.files.add(`${i.file}:${c.line}`); uniqueCalls.set(k, e); }
  return {
    generated: new Date().toISOString(),
    method: "static source analysis (import graph + handler bodies); nothing here was executed",
    screens,
    endpoints: [...uniqueCalls.values()].map((e) => ({ ...e, ops: [...e.ops], files: [...e.files] })).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    totals: {
      screens: screens.length,
      files: all.length,
      controls: new Set(all.flatMap((i) => i.controls.map((c) => `${c.file}:${c.line}`))).size,
      controlsWithBackendCall: new Set(all.flatMap((i) => i.controls.filter((c) => c.calls.length).map((c) => `${c.file}:${c.line}`))).size,
      suspects: new Set(all.flatMap((i) => i.suspects.map((c) => `${c.file}:${c.line}`))).size,
      endpointConnections: all.reduce((n, i) => n + i.calls.length, 0),
      uniqueEndpoints: uniqueCalls.size,
    },
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file:///${resolve(process.argv[1]).replace(/\\/g, "/")}`).href;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const out = arg("--out") ?? "e2e-out/s28";
  mkdirSync(out, { recursive: true });
  const inv = buildInventory({ openapi: arg("--openapi") });
  writeFileSync(join(out, "s28-inventory.json"), JSON.stringify(inv, null, 1));
  console.log(JSON.stringify(inv.totals));
  const byStatus = {}; for (const e of inv.endpoints) (byStatus[e.status] ??= []).push(`${e.kind}:${e.name}`);
  for (const [s, l] of Object.entries(byStatus)) console.log(`${s} (${l.length})${s === "IMPLEMENTED_IN_SOURCE" ? "" : `: ${l.join(", ")}`}`);
  for (const d of ["student", "college", "company", "admin"]) {
    const ss = inv.screens.filter((s) => s.dashboard === d);
    console.log(`${d}: ${ss.length} screens, ${new Set(ss.flatMap((s) => s.controls.map((c) => `${c.file}:${c.line}`))).size} controls, ${new Set(ss.flatMap((s) => s.calls.map((c) => `${c.kind}:${c.name}`))).size} distinct endpoints`);
  }
  console.log(`written ${out}/s28-inventory.json`);
}
