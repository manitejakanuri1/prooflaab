// S41: contract drift across the WHOLE frontend (every file under src/, not only the dashboard screens the S32
// inventory follows) against what the repository actually provides. STATIC: reads source, runs nothing.
//
//   node scripts/dev-tools/sidhu_s41_contract_drift.mjs [--out dir]
//
// For every call the website makes it records: kind (rpc / table / function / storage / api), where it is called,
// whether it exists (created in a migration and not dropped later; a functions-service SLUG with a folder; a gateway
// route; a storage bucket the files service serves), and for RPCs whether a BROWSER may run it: the final state of
// EXECUTE for the authenticated role, replayed from every grant / revoke / create / drop in migration order.
// A call that cannot work for a signed-in user is a finding: ENDPOINT_NOT_FOUND, ENDPOINT_DROPPED,
// BROWSER_FORBIDDEN (server-only function called from the browser), FUNCTION_NOT_ROUTED, API_NOT_ROUTED,
// BUCKET_NOT_SERVED. Output: FULL_ENDPOINT_COVERAGE.json. Exit 1 if any finding is not in KNOWN (reviewed) below.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callsIn } from "./sidhu_s32_inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const rel = (p) => relative(ROOT, p).replace(/\\/g, "/");

/** Findings a person reviewed and accepted, with the reason. Anything else fails the check. */
export const KNOWN = {};

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(f) && !/\.test\.|\.d\.ts$/.test(f) && !p.includes(join("integrations", "supabase", "types"))) out.push(p);
  }
  return out;
}

export function migrationFiles() {
  // Same order as the S32 inventory: the dated supabase history first, then the numbered authority files.
  return [
    ...readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(ROOT, "supabase/migrations", f)),
    ...readdirSync(join(ROOT, "migration")).filter((f) => /^\d+[a-z]?-(?!rollback).+\.sql$/.test(f) && !/production|rehearsal/.test(f))
      .sort((a, b) => (parseInt(a) - parseInt(b)) || a.localeCompare(b)).map((f) => join(ROOT, "migration", f)),
  ];
}

/** Replays the SQL: which functions / tables exist at the end, and whether `authenticated` may EXECUTE each function. */
export function sqlState(files = migrationFiles(), read = (f) => readFileSync(f, "utf8")) {
  const fn = new Map(), table = new Map();
  for (const f of files) {
    const sql = read(f).replace(/--[^\n]*/g, "");
    const events = [];
    const at = (re, cb) => { for (const m of sql.matchAll(re)) events.push([m.index, () => cb(m)]); };
    at(/\bcreate\s+(or\s+replace\s+)?function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi, (m) => {
      const e = fn.get(m[2].toLowerCase());
      // A new function (or one re-created after a drop) gets PostgreSQL's default: EXECUTE for PUBLIC.
      if (!e || e.dropped) fn.set(m[2].toLowerCase(), { exists: true, dropped: false, browser: true, where: rel(f) });
      else { e.exists = true; e.where = rel(f); }
    });
    at(/\bdrop\s+function\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi, (m) => {
      const e = fn.get(m[1].toLowerCase()) ?? {}; fn.set(m[1].toLowerCase(), { ...e, exists: false, dropped: true, where: rel(f) });
    });
    at(/\b(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\([^)]*\)\s+(to|from)\s+([^;]+);/gi, (m) => {
      const who = m[4].toLowerCase();
      const e = fn.get(m[2].toLowerCase()); if (!e) return;
      const browserRole = /\b(authenticated|public)\b/.test(who);
      if (m[1].toLowerCase() === "grant" && /\bauthenticated\b|\bpublic\b/.test(who)) e.browser = true;
      if (m[1].toLowerCase() === "revoke" && browserRole) e.browser = false;
    });
    at(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: true, where: rel(f) }));
    at(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: true, where: rel(f) }));
    at(/\bdrop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: false, dropped: true, where: rel(f) }));
    at(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)/gi, (m) => {
      table.set(m[1].toLowerCase(), { exists: false, dropped: true, where: rel(f) }); table.set(m[2].toLowerCase(), { exists: true, where: rel(f) });
    });
    for (const [, run] of events.sort((a, b) => a[0] - b[0])) run();   // in file order
  }
  return { fn, table };
}

export function slugs() {
  const main = readFileSync(join(ROOT, "functions-service/main.ts"), "utf8");
  const block = main.slice(main.indexOf("const SLUGS"), main.indexOf("];", main.indexOf("const SLUGS")));
  return new Set([...block.matchAll(/"([a-z0-9_-]+)"/g)].map((m) => m[1]).filter((s) => existsSync(join(ROOT, "supabase/functions", s, "index.ts"))));
}

export function apiRoutes() {
  const c = JSON.parse(readFileSync(join(ROOT, "web-bff/routes.contract.json"), "utf8"));
  return c.routes.map((r) => ({ match: r.match, prefix: !!r.prefix }));
}

export function buckets() {
  const files = readFileSync(join(ROOT, "files-service/main.ts"), "utf8");
  const block = files.slice(files.indexOf("const BUCKETS"), files.indexOf("};", files.indexOf("const BUCKETS")));
  return new Set([...block.matchAll(/'([a-z0-9-]+)'\s*:/g)].map((m) => m[1]));
}

/** Pure: judge one call against the provided state. */
export function judge(call, s) {
  const n = call.name;
  if (n.startsWith("<dynamic:")) return "DYNAMIC";
  if (call.kind === "rpc") {
    const e = s.fn.get(n.toLowerCase());
    if (!e) return "ENDPOINT_NOT_FOUND";
    if (!e.exists) return "ENDPOINT_DROPPED";
    return e.browser ? "OK" : "BROWSER_FORBIDDEN";
  }
  if (call.kind === "server-rpc") {
    const e = s.fn.get(n.toLowerCase());
    return !e ? "ENDPOINT_NOT_FOUND" : e.exists ? "OK" : "ENDPOINT_DROPPED";
  }
  if (call.kind === "table") {
    const e = s.table.get(n.toLowerCase());
    return !e ? "ENDPOINT_NOT_FOUND" : e.exists ? "OK" : "ENDPOINT_DROPPED";
  }
  if (call.kind === "function") return s.slugs.has(n) ? "OK" : "FUNCTION_NOT_ROUTED";
  if (call.kind === "storage") return s.buckets.has(n) ? "OK" : "BUCKET_NOT_SERVED";
  if (call.kind === "api") return s.api.some((r) => (r.prefix ? n.startsWith(r.match) : n === r.match)) ? "OK" : "API_NOT_ROUTED";
  return "OK";
}

export function scan() {
  const state = { ...sqlState(), slugs: slugs(), api: apiRoutes(), buckets: buckets() };
  const uses = new Map();
  for (const file of walk(join(ROOT, "src"))) {
    const text = readFileSync(file, "utf8");
    for (const c of callsIn(text)) {
      const k = `${c.kind}:${c.name}`;
      const u = uses.get(k) ?? { kind: c.kind, name: c.name, callers: [] };
      u.callers.push(`${rel(file)}:${c.line}`);
      uses.set(k, u);
    }
  }
  // Server-side callers (functions service, accounts, workers): they run as service_role, so only existence matters.
  const server = [];
  for (const dir of ["supabase/functions", "functions-service"]) if (existsSync(join(ROOT, dir))) server.push(...walk(join(ROOT, dir)));
  for (const dir of ["accounts", "transcription-worker", "transcriber", "crawler", "bug-finder"]) {
    if (!existsSync(join(ROOT, dir))) continue;
    for (const f of readdirSync(join(ROOT, dir))) if (/\.(py|mjs|js|ts)$/.test(f) && !/test/.test(f)) server.push(join(ROOT, dir, f));
  }
  for (const file of server) {
    const text = readFileSync(file, "utf8");
    const names = [...text.matchAll(/\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g), ...text.matchAll(/["'`]\/?rpc\/([a-zA-Z0-9_]+)/g)];
    for (const m of names) {
      const k = `server-rpc:${m[1]}`;
      const u = uses.get(k) ?? { kind: "server-rpc", name: m[1], callers: [] };
      u.callers.push(`${rel(file)}:${text.slice(0, m.index).split(/\r?\n/).length}`);
      uses.set(k, u);
    }
  }
  const endpoints = [...uses.values()].map((u) => ({ ...u, status: judge(u, state) })).sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
  return { endpoints, state };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2); const i = a.indexOf("--out"); const out = i >= 0 ? a[i + 1] : "e2e-out/s41";
  mkdirSync(out, { recursive: true });
  const { endpoints } = scan();
  const findings = endpoints.filter((e) => !["OK", "DYNAMIC"].includes(e.status));
  const unknown = findings.filter((f) => !KNOWN[`${f.kind}:${f.name}`]);
  const counts = {}; for (const e of endpoints) counts[e.status] = (counts[e.status] ?? 0) + 1;
  writeFileSync(join(out, "FULL_ENDPOINT_COVERAGE.json"), JSON.stringify({ generated: new Date().toISOString(), kind: "STATIC source check (nothing run)", counts, endpoints }, null, 1));
  console.log(`endpoints ${endpoints.length} ${JSON.stringify(counts)}`);
  for (const f of findings) console.log(`${KNOWN[`${f.kind}:${f.name}`] ? "known  " : "FINDING"} ${f.status.padEnd(19)} ${f.kind}:${f.name}  <- ${f.callers.slice(0, 3).join(", ")}${f.callers.length > 3 ? ` +${f.callers.length - 3}` : ""}`);
  process.exit(unknown.length ? 1 : 0);
}
