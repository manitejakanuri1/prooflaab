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
export const KNOWN = {
  // Function-body references (bodyReferences), reviewed S41 13 Oct 2026:
  "remove_students->proof_uploads": "migration 106 rewrites remove_students in place (execute replace(pg_get_functiondef ...)); the live body reads task_submissions (S34/S36, staging read-only)",
  "thread_post_count->topic_threads": "trigger function of the feed; its table thread_posts and topic_threads were dropped together in migration 26, so nothing can fire it (clean-up candidate)",
};

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

/** Argument TYPES of a parameter list, so overloads are told apart: "(_a uuid, _b boolean default false)" -> "uuid,boolean". */
export function argTypes(list) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of list) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch; }
  if (cur.trim()) parts.push(cur);
  const MULTI = /^(double|timestamp|time|character|bit|interval)\b/i;
  return parts.map((p) => {
    let t = p.replace(/\s+default\s+[\s\S]*$/i, "").replace(/\s*=\s*[\s\S]*$/, "").trim().replace(/^(in|out|inout|variadic)\s+/i, "");
    const words = t.split(/\s+/);
    if (words.length > 1 && !MULTI.test(t)) t = words.slice(1).join(" ");   // drop the parameter name
    return t.toLowerCase().replace(/^public\./, "").replace(/\s+/g, " ")
      .replace(/^int4$|^int$/, "integer").replace(/^bool$/, "boolean").replace(/^varchar.*$/, "character varying")
      .replace(/^timestamptz$/, "timestamp with time zone").replace(/^int8$/, "bigint");
  }).join(",");
}

/** Text from an opening "(" to its matching ")". */
function parenAt(sql, i) {
  let d = 0;
  for (let j = i; j < sql.length; j++) { if (sql[j] === "(") d++; else if (sql[j] === ")" && --d === 0) return sql.slice(i + 1, j); }
  return "";
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
      // The body: from "as $tag$" to the same "$tag$" (S41: checked for calls to objects that no longer exist).
      const as = /\bas\s+(\$[a-z_]*\$)/i.exec(sql.slice(m.index, m.index + 4000));
      const start = as ? m.index + as.index + as[0].length : -1;
      const body = as ? sql.slice(start, sql.indexOf(as[1], start)) : "";
      const sig = argTypes(parenAt(sql, m.index + m[0].length - 1));
      // A new function (or one re-created after a drop) gets PostgreSQL's default: EXECUTE for PUBLIC.
      if (!e || e.dropped) fn.set(m[2].toLowerCase(), { exists: true, dropped: false, browser: true, where: rel(f), body, sigs: new Set([sig]) });
      else { e.exists = true; e.where = rel(f); e.body = body; (e.sigs ??= new Set()).add(sig); }
    });
    // A drop with an argument list removes that overload only (stage 37 drops the OLD generate_round_robin(uuid,
    // boolean) after creating the new three-argument one); without one, every overload.
    at(/\bdrop\s+function\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?(\s*\()?/gi, (m) => {
      const name = m[1].toLowerCase(), e = fn.get(name) ?? { sigs: new Set() };
      if (m[2]) e.sigs?.delete(argTypes(parenAt(sql, m.index + m[0].length - 1))); else e.sigs = new Set();
      const gone = !e.sigs || e.sigs.size === 0;
      fn.set(name, { ...e, exists: !gone, dropped: gone, where: rel(f) });
    });
    // alter function public.a(args) rename to b
    at(/\balter\s+function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)/gi, (m) => {
      const from = fn.get(m[1].toLowerCase()); if (!from) return;
      const sig = argTypes(m[2]);
      from.sigs?.delete(sig);
      if (!from.sigs || from.sigs.size === 0) { from.exists = false; from.dropped = true; }
      const to = fn.get(m[3].toLowerCase());
      if (to && to.exists) to.sigs.add(sig);
      else fn.set(m[3].toLowerCase(), { exists: true, dropped: false, browser: from.browser, where: rel(f), body: from.body, sigs: new Set([sig]) });
    });
    at(/\b(grant|revoke)\s+(?:all(?:\s+privileges)?|execute)\s+on\s+function\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\([^)]*\)\s+(to|from)\s+([^;]+);/gi, (m) => {
      const who = m[4].toLowerCase();
      const e = fn.get(m[2].toLowerCase()); if (!e) return;
      const browserRole = /\b(authenticated|public)\b/.test(who);
      if (m[1].toLowerCase() === "grant" && /\bauthenticated\b|\bpublic\b/.test(who)) e.browser = true;
      if (m[1].toLowerCase() === "revoke" && browserRole) e.browser = false;
    });
    at(/\bcreate\s+type\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: true, type: true, where: rel(f) }));
    at(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(?!if\b)([a-z_][a-z0-9_]*)\b(?!"?\s*\.)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: true, where: rel(f) }));
    at(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(?!if\b)([a-z_][a-z0-9_]*)\b(?!"?\s*\.)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: true, where: rel(f) }));
    at(/\bdrop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?(?!if\b)([a-z_][a-z0-9_]*)\b(?!"?\s*\.)"?/gi, (m) => table.set(m[1].toLowerCase(), { exists: false, dropped: true, where: rel(f) }));
    at(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)/gi, (m) => {
      table.set(m[1].toLowerCase(), { exists: false, dropped: true, where: rel(f) }); table.set(m[2].toLowerCase(), { exists: true, where: rel(f) });
    });
    for (const [, run] of events.sort((a, b) => a[0] - b[0])) run();   // in file order
  }
  return { fn, table };
}

/**
 * S41: inside every function that still exists, each schema-qualified reference (public.x( for a function, public.x
 * for a table or view) must name something that still exists. PostgreSQL only finds a broken one when that line
 * runs. Dynamic SQL strings are included: a name inside execute '...public.x...' fails the same way.
 */
export function bodyReferences(s) {
  const out = [];
  for (const [name, e] of s.fn) {
    if (!e.exists || !e.body) continue;
    for (const m of e.body.matchAll(/\bpublic\.([a-z_][a-z0-9_]*)\s*(\()?/gi)) {
      // "insert into public.t (cols)" has a parenthesis too, so a name is fine if it exists as either kind.
      const ref = m[1].toLowerCase(), isCall = !!m[2] && !s.table.has(ref);
      const t = s.table.get(ref), f = s.fn.get(ref);
      const status = (t?.exists || f?.exists) ? "OK" : (t || f) ? "ENDPOINT_DROPPED" : "ENDPOINT_NOT_FOUND";
      if (status !== "OK") out.push({ kind: isCall ? "body-call" : "body-table", name: ref, in: name, where: e.where, status });
    }
  }
  return out;
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
