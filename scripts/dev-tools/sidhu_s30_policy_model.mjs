// S30 (copy of the S29 model, unchanged logic): offline model of table GRANTS, ROW LEVEL SECURITY and POLICIES, replayed from the repository's migrations.
// Reads SQL files only. Executes no SQL and connects to nothing.
//
//   node scripts/dev-tools/sidhu_s29_policy_model.mjs [--out e2e-out/s29] [--tables a,b,c]
//
// Apply order (scripts/migrations.py is the authority for migration/):
//   1. supabase/migrations/*.sql that are NOT an identical copy of a migration/ file, by timestamp
//      (the Supabase history that the Cloud SQL restore reproduced);
//   2. migration/NN[x]-name.sql by number, excluding rollbacks, step* runbooks, *-production-* and rehearsals.
// Baseline (before step 1): Supabase's default privileges, i.e. a new public table is granted ALL to anon,
// authenticated and service_role, and row level security is off until enabled.
// Tracked per table: rls / force, table and column privileges per role, permissive + restrictive policies
// (create / alter / drop / rename), triggers (create / drop), and DO blocks that mention the table (not interpreted).
// Limits (reported, never hidden): statements built at run time inside DO blocks are not executed; the restored
// dump itself is not in the repository, so objects created ONLY by the dump are invisible.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ROLES = ["anon", "authenticated", "service_role"];
const PRIVS = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];

export function applyOrder(root = ROOT) {
  const norm = (s) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
  const h = (s) => createHash("md5").update(norm(s)).digest("hex");
  const migDir = join(root, "migration"), supDir = join(root, "supabase/migrations");
  const NAME = /^(\d+)([a-z]?)-(?!rollback)(.+)\.sql$/;
  const mig = readdirSync(migDir).map((f) => [f, f.match(NAME)]).filter(([f, m]) => m && !f.includes("-production-") && !f.includes("rehearsal") && !f.startsWith("step"))
    .sort((a, b) => Number(a[1][1]) - Number(b[1][1]) || a[1][2].localeCompare(b[1][2])).map(([f]) => join(migDir, f));
  const migHashes = new Set(readdirSync(migDir).filter((f) => f.endsWith(".sql")).map((f) => h(readFileSync(join(migDir, f), "utf8"))));
  const base = readdirSync(supDir).filter((f) => f.endsWith(".sql")).sort().map((f) => join(supDir, f)).filter((p) => !migHashes.has(h(readFileSync(p, "utf8"))));
  return [...base, ...mig];
}

/** Splits SQL into statements, respecting quotes, dollar quotes and comments. */
export function statements(sql) {
  const out = []; let cur = ""; let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") { const e = sql.indexOf("\n", i); i = e < 0 ? sql.length : e; continue; }
    if (ch === "/" && sql[i + 1] === "*") { const e = sql.indexOf("*/", i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (ch === "'") { const s = i; i++; while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1; cur += sql.slice(s, i + 1); i++; continue; }
    if (ch === "$") { const m = sql.slice(i).match(/^\$[A-Za-z_]*\$/); if (m) { const e = sql.indexOf(m[0], i + m[0].length); const end = e < 0 ? sql.length : e + m[0].length; cur += sql.slice(i, end); i = end; continue; } }
    if (ch === ";") { if (cur.trim()) out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const ident = (s) => s.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
// Balanced "( ... )" starting at index p of s; returns [inner, endIndex].
function paren(s, p) { let d = 0; for (let j = p; j < s.length; j++) { if (s[j] === "(") d++; else if (s[j] === ")" && --d === 0) return [s.slice(p + 1, j), j + 1]; else if (s[j] === "'") { j++; while (j < s.length && s[j] !== "'") j++; } } return [s.slice(p + 1), s.length]; }
function clause(s, kw) {
  const re = new RegExp(`\\b${kw}\\s*\\(`, "i"); const m = re.exec(s); if (!m) return null;
  return paren(s, m.index + m[0].length - 1)[0].replace(/\s+/g, " ").trim();
}
const roleList = (s) => s.split(",").map((r) => r.trim().replace(/"/g, "").toLowerCase()).filter(Boolean);
const privList = (s) => {
  const all = /^\s*all(\s+privileges)?\s*$/i.test(s);
  if (all) return { privs: PRIVS, cols: null };
  const cols = s.match(/\(([^)]*)\)/);
  return { privs: s.replace(/\([^)]*\)/g, "").split(",").map((p) => p.trim().toLowerCase()).filter((p) => PRIVS.includes(p)), cols: cols ? cols[1].split(",").map((c) => c.trim().replace(/"/g, "")) : null };
};

export function buildModel({ root = ROOT, files = applyOrder(root) } = {}) {
  const tables = new Map();
  const functions = new Map();   // latest CREATE FUNCTION text per name, in apply order
  const defaults = Object.fromEntries(ROLES.map((r) => [r, new Set(PRIVS)]));   // Supabase baseline default privileges
  const T = (n) => { n = ident(n); if (!tables.has(n)) tables.set(n, { name: n, created: null, rls: false, force: false, grants: Object.fromEntries(ROLES.map((r) => [r, new Set()])), colGrants: Object.fromEntries(ROLES.map((r) => [r, {}])), policies: new Map(), triggers: new Map(), doBlocks: [], history: [] }); return tables.get(n); };
  const rel = (f) => f.slice(root.length + 1).replace(/\\/g, "/");
  for (const f of files) {
    const where = rel(f);
    for (const st of statements(readFileSync(f, "utf8"))) {
      const s = st.replace(/\s+/g, " ");
      let m;
      if ((m = s.match(/^create (?:unlogged )?table (?:if not exists )?((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) {
        const t = T(m[1]); if (!t.created) { t.created = where; for (const r of ROLES) t.grants[r] = new Set(defaults[r]); } t.history.push(`create table @ ${where}`); continue;
      }
      if ((m = s.match(/^drop table (?:if exists )?((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) { tables.delete(ident(m[1])); continue; }
      if ((m = s.match(/^alter table (?:if exists )?(?:only )?((?:"?public"?\.)?"?[a-z_0-9]+"?) (enable|disable|force|no force) row level security/i))) {
        const t = T(m[1]); const a = m[2].toLowerCase();
        if (a === "enable") t.rls = true; else if (a === "disable") t.rls = false; else if (a === "force") t.force = true; else t.force = false;
        t.history.push(`${a} rls @ ${where}`); continue;
      }
      if ((m = s.match(/^alter table (?:if exists )?(?:only )?((?:"?public"?\.)?"?[a-z_0-9]+"?) rename to "?([a-z_0-9]+)"?/i))) { const old = ident(m[1]); const t = tables.get(old); if (t) { tables.delete(old); t.name = m[2]; tables.set(m[2], t); } continue; }
      if ((m = s.match(/^create policy ("[^"]+"|[a-z_0-9]+) on ((?:"?public"?\.)?"?[a-z_0-9]+"?)(.*)$/i))) {
        const t = T(m[2]); const rest = m[3];
        const name = m[1].replace(/"/g, "");
        const cmd = (rest.match(/\bfor (all|select|insert|update|delete)\b/i)?.[1] ?? "all").toLowerCase();
        const to = rest.match(/\bto ([a-z_, "]+?)(?= using| with check|$)/i);
        t.policies.set(name, { name, cmd, permissive: !/\bas restrictive\b/i.test(rest), roles: to ? roleList(to[1]) : ["public"], using: clause(rest, "using"), check: clause(rest, "with check"), at: where });
        t.history.push(`create policy ${name} @ ${where}`); continue;
      }
      if ((m = s.match(/^drop policy (?:if exists )?("[^"]+"|[a-z_0-9]+) on ((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) { const t = T(m[2]); t.policies.delete(m[1].replace(/"/g, "")); t.history.push(`drop policy ${m[1]} @ ${where}`); continue; }
      if ((m = s.match(/^alter policy ("[^"]+"|[a-z_0-9]+) on ((?:"?public"?\.)?"?[a-z_0-9]+"?)(.*)$/i))) {
        const t = T(m[2]); const name = m[1].replace(/"/g, ""); const p = t.policies.get(name); const rest = m[3];
        const rn = rest.match(/rename to ("[^"]+"|[a-z_0-9]+)/i);
        if (p && rn) { t.policies.delete(name); p.name = rn[1].replace(/"/g, ""); t.policies.set(p.name, p); }
        else if (p) { const u = clause(rest, "using"), c = clause(rest, "with check"), to = rest.match(/\bto ([a-z_, "]+?)(?= using| with check|$)/i); if (u) p.using = u; if (c) p.check = c; if (to) p.roles = roleList(to[1]); p.at = `${p.at}; altered @ ${where}`; }
        t.history.push(`alter policy ${name} @ ${where}`); continue;
      }
      if ((m = s.match(/^(grant|revoke) (.+?) on (?:table )?(all tables in schema public|(?:"?public"?\.)?"?[a-z_0-9]+"?(?:\s*,\s*(?:"?public"?\.)?"?[a-z_0-9]+"?)*) (?:to|from) (.+?)(?: with grant option| cascade| restrict)?$/i))) {
        if (/^(function|sequence|schema|all functions|all sequences|all routines|routine|procedure|type|domain)\b/i.test(m[3]) || /\bon (function|sequence|schema|all functions|all sequences)\b/i.test(s)) continue;
        const grant = m[1].toLowerCase() === "grant"; const { privs, cols } = privList(m[2]); const roles = roleList(m[4]).flatMap((r) => r === "public" ? ROLES.filter((x) => x !== "service_role") : [r]).filter((r) => ROLES.includes(r));
        const names = /^all tables/i.test(m[3]) ? [...tables.keys()] : m[3].split(",").map(ident);
        for (const n of names) {
          const t = T(n);
          for (const r of roles) {
            if (cols) for (const p of privs) { const set = (t.colGrants[r][p] ??= new Set()); for (const c of cols) grant ? set.add(c) : set.delete(c); }
            else for (const p of privs) { if (grant) t.grants[r].add(p); else { t.grants[r].delete(p); if (t.colGrants[r][p]) t.colGrants[r][p].clear(); } }
          }
          if (!/^all tables/i.test(m[3])) t.history.push(`${m[1].toLowerCase()} ${privs.join(",")}${cols ? `(${cols.join(",")})` : ""} ${roles.join(",")} @ ${where}`);
        }
        continue;
      }
      if ((m = s.match(/^alter default privileges (?:for role [a-z_]+ )?in schema public (grant|revoke) (.+?) on tables (?:to|from) (.+)$/i))) {
        const { privs } = privList(m[2]); for (const r of roleList(m[3]).filter((x) => ROLES.includes(x))) for (const p of privs) m[1].toLowerCase() === "grant" ? defaults[r].add(p) : defaults[r].delete(p);
        continue;
      }
      if ((m = s.match(/^create (?:or replace )?(?:constraint )?trigger ("?[a-z_0-9]+"?) (before|after|instead of) (.+?) on ((?:"?public"?\.)?"?[a-z_0-9]+"?) .*?execute (?:function|procedure) ((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) {
        const t = T(m[4]);
        const args = (s.slice(s.indexOf(m[5]) + m[5].length).match(/^\s*\(([^)]*)\)/)?.[1] ?? "").split(",").map((a) => a.trim().replace(/^'|'$/g, "")).filter(Boolean);
        t.triggers.set(m[1].replace(/"/g, ""), { name: m[1].replace(/"/g, ""), when: m[2].toLowerCase(), events: m[3].toLowerCase(), fn: ident(m[5]), args, at: where }); continue;
      }
      if ((m = s.match(/^drop trigger (?:if exists )?("?[a-z_0-9]+"?) on ((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) { T(m[2]).triggers.delete(m[1].replace(/"/g, "")); continue; }
      if ((m = st.match(/^create\s+(?:or\s+replace\s+)?function\s+((?:"?public"?\.)?"?[a-z_0-9]+"?)\s*\(/i))) {
        functions.set(ident(m[1]), { name: ident(m[1]), at: where, sql: st }); continue;
      }
      if ((m = s.match(/^drop function (?:if exists )?((?:"?public"?\.)?"?[a-z_0-9]+"?)/i))) { functions.delete(ident(m[1])); continue; }
      if (/^do\b/i.test(s)) {
        for (const t of tables.values()) if (new RegExp(`\\b${t.name}\\b`).test(s) && /policy|grant|revoke|row level/i.test(s)) t.doBlocks.push(where);
      }
    }
  }
  return { files: files.map(rel), tables, functions, defaults };
}

/** Plain-JSON view of one table. */
export const tableJson = (t) => t && ({
  name: t.name, created: t.created, rls: t.rls, force: t.force,
  grants: Object.fromEntries(Object.entries(t.grants).map(([r, s]) => [r, [...s].sort()])),
  colGrants: Object.fromEntries(Object.entries(t.colGrants).map(([r, o]) => [r, Object.fromEntries(Object.entries(o).filter(([, s]) => s.size).map(([p, s]) => [p, [...s].sort()]))])),
  policies: [...t.policies.values()], triggers: [...t.triggers.values()], doBlocks: [...new Set(t.doBlocks)],
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const out = arg("--out", "e2e-out/s29"); mkdirSync(out, { recursive: true });
  const model = buildModel();
  const want = arg("--tables", "");
  const names = want ? want.split(",") : [...model.tables.keys()].sort();
  const json = { generated: new Date().toISOString(), method: "offline replay of migration SQL text; nothing executed", files: model.files.length, tables: names.map((n) => tableJson(model.tables.get(n)) ?? { name: n, missing: true }) };
  writeFileSync(join(out, "s29-policy-model.json"), JSON.stringify(json, null, 1));
  console.log(`${model.files.length} migration files replayed; ${model.tables.size} tables; written ${out}/s29-policy-model.json`);
}
