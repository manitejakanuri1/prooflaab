// S32: ONE live end-to-end suite for the four dashboards on STAGING. Real browser, real sign-in, real backend.
// No mocks, no fake responses, no hard-coded success. Refuses production.
//
//   node scripts/dev-tools/sidhu_s32_live_e2e.mjs --plan                       offline: full control matrix, nothing run
//   node scripts/dev-tools/sidhu_s32_live_e2e.mjs --anon --confirm-staging     live, signed out (route + API denial)
//   node scripts/dev-tools/sidhu_s32_live_e2e.mjs --confirm-staging \
//        --expect-entry index-XXXX.js [--roles admin,tpo,company,student,established] [--allow-writes] [--db-verify]
//
// Every row of the matrix is: Role | Page | Control | Expected route | API | DB effect | Live result | Status.
// Status is PASS only when the control was really exercised on the live site and every check held.
// Never-run rows are BLOCKED (with the reason) or NOT_TESTED. Untested controls are never counted as PASS.
//
// Provenance. Staging images and Hosting releases carry no commit SHA, so the suite compares the live entry bundle
// (index-<hash>.js in index.html) with --expect-entry: the entry name of `vite build --mode staging` of the expected
// SHA from a clean `git archive` (method proven: rebuilding main reproduces production's live entry exactly).
// A mismatch marks the whole run "not the expected SHA" (exit 4); results are kept, but are not release evidence.
//
// Sign-in (per role): E2E_<ROLE>_EMAIL / E2E_<ROLE>_PASSWORD / E2E_<ROLE>_USER_ID, ROLE = ADMIN | TPO | COMPANY |
// STUDENT | ESTABLISHED. Owner-approved, staging-only test accounts. Through the real form -> BFF -> HttpOnly + Secure
// cookie; /api/auth/session must name E2E_<ROLE>_USER_ID and the role's managed role, or the role FAILS before any
// click. Credentials, cookies and emails are never printed or saved.
//
// Safety. Only controls whose source handler provably has no backend effect (tabs, navigation, pure state setters)
// are clicked automatically. Every other control is BLOCKED unless a write recipe below covers it, --allow-writes is
// set, and its disposable fixture ids are given. --db-verify proves a recipe's database effect with a READ-ONLY query
// through scripts/dev-tools/staging_sql.sh (staging only; needs gcloud access).
//
// Exit: 0 = everything planned ran and passed on the expected build; 1 = a FAIL; 2 = BLOCKED / NOT_TESTED rows remain;
//       3 = refused; 4 = the live build is not the expected one.
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildInventory } from "./sidhu_s32_inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const EXIT = { OK: 0, FAIL: 1, INCOMPLETE: 2, REFUSED: 3, WRONG_BUILD: 4 };
export const STAGING = new Set(["prooflab-staging.web.app", "prooflab-staging.firebaseapp.com"]);
export const ROLES = {
  admin: { dashboard: "admin", managed: "admin", home: "/admin/dashboard", foreign: ["/college/dashboard", "/company/dashboard", "/student/dashboard"] },
  tpo: { dashboard: "college", managed: "college_admin", home: "/college/dashboard", foreign: ["/admin/dashboard", "/company/dashboard", "/student/dashboard"] },
  company: { dashboard: "company", managed: "startup", home: "/company/dashboard", foreign: ["/admin/dashboard", "/college/dashboard", "/student/dashboard"] },
  student: { dashboard: "student", managed: "student", home: "/student/dashboard", foreign: ["/admin/dashboard", "/college/dashboard", "/company/dashboard"] },
  established: { dashboard: "student", managed: "student", home: "/student/dashboard", foreign: ["/admin/dashboard", "/college/dashboard", "/company/dashboard"] },
};
// RPCs another role must not get data from (role isolation, called with the signed-in cookie).
const FOREIGN_RPC = {
  student: ["tpo_students", "admin_recruiters", "recruiter_talent"], established: ["tpo_students", "admin_recruiters"],
  tpo: ["admin_recruiters", "recruiter_talent"], company: ["tpo_students", "admin_recruiters"], admin: [],
};

/** Refuses anything but the staging site over https. */
export function assertStaging(base) {
  let u; try { u = new URL(base); } catch { throw new Error(`not a URL: ${base}`); }
  if (/(^|\.)prooflab\.co\.in$/i.test(u.hostname) || /prooflab-508214\./.test(u.hostname)) throw new Error(`refusing PRODUCTION (${u.hostname})`);
  if (!STAGING.has(u.hostname) || u.protocol !== "https:") throw new Error(`only ${[...STAGING].join(" / ")} over https (got ${u.host})`);
  return u.origin;
}

export function redact(s, secrets = []) {
  let t = String(s ?? "");
  for (const v of secrets) if (v && String(v).length >= 3) t = t.split(String(v)).join("[REDACTED]");
  return t.replace(/eyJ[\w-]{8,}\.[\w-]{8,}(\.[\w-]*)?/g, "[REDACTED-TOKEN]").replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, "[REDACTED-EMAIL]")
    .replace(/(__session|password|token)(["']?\s*[:=]\s*["']?)[^\s"';&,}]+/gi, "$1$2[REDACTED]");
}

// ------------------------------------------------------------------------------------------------ classification
const WRITE_LABEL = /\b(delete|remove|approve|reject|submit|send|save|create|assign|upload|record|start|shortlist|sponsor|reset|run|form|rebalance|import|accept|decline|confirm|publish|post|apply|verify|suspend|activate|deactivate|retake|retest|claim|mark|update|add|generate|regenerate|invite|clear|archive|restore)\b/i;
const WRITE_RPC = /(^|_)(create|set|send|delete|remove|assign|review|submit|record|approve|verify|update|start|run|form|rebalance|reset|accept|save|shortlist|outcome|log|touch|claim|mark|import|upload|run|insert|bulk|toggle|enroll)(_|$)/i;
/** SAFE = provably no backend effect (auto-clickable); WRITE = has or may have one; UNSURE = handler calls something the static trace cannot see. */
export function classify(ctl) {
  const writesByCall = (ctl.calls ?? []).some((c) => c.kind === "function" || c.kind === "api" || c.kind === "storage"
    || (c.kind === "rpc" && WRITE_RPC.test(c.name)) || (c.kind === "table" && (c.ops ?? []).some((o) => o !== "select")));
  if (writesByCall || WRITE_LABEL.test(ctl.label ?? "")) return "WRITE";
  if ((ctl.calls ?? []).length) return "READ";   // backend reads only (traced)
  const h = (ctl.handler ?? "").replace(/\s+/g, " ").trim();
  const pureSetter = /^(\(\) =>\s*)?(set[A-Z]\w*|onTabChange|onNavigate|onValueChange|navigate|setView|setTab|setOpen|toggle\w*)\b[^;]*$/.test(h)
    || /^set[A-Z]\w*$/.test(h) || /^\(\w*\) => set[A-Z]\w*\([^()]*\)$/.test(h) || /^\(\) => void? ?(onTabChange|onNavigate|go|open)\(/.test(h);
  if (ctl.element === "TabsTrigger" || ctl.event === "onValueChange" && ctl.element === "Tabs") return "SAFE";
  return pureSetter ? "SAFE" : "UNSURE";
}

const opsText = (calls) => (calls ?? []).filter((c) => c.kind === "table" && (c.ops ?? []).some((o) => o !== "select"))
  .map((c) => `${c.ops.filter((o) => o !== "select").join("/")} ${c.name}`).join("; ");
const apiText = (calls) => (calls ?? []).map((c) => c.kind === "rpc" ? `POST /api/db/rpc/${c.name}` : c.kind === "table" ? `/api/db/${c.name}` : c.kind === "function" ? `POST /api/functions/${c.name}` : c.kind === "api" ? c.name : `${c.kind}:${c.name}`).join("; ");

/** The full matrix from the source inventory, every row NOT_TESTED until the live run fills it. */
export function planMatrix(inv) {
  const rows = []; const seen = new Set();
  const roleOf = (d) => ({ admin: ["admin"], college: ["tpo"], company: ["company"], student: ["student", "established"] })[d] ?? [];
  for (const s of inv.screens) for (const role of roleOf(s.dashboard)) {
    rows.push({ role, page: `${s.nav} / ${s.inner}`, url: s.url, control: "(screen) open, refresh, unauthorized, offline", class: "SCREEN",
      expectedRoute: s.url.split("?")[0], api: [...new Set(s.calls.map((c) => c.kind === "rpc" ? `rpc/${c.name}` : c.kind === "table" ? `db/${c.name}` : `${c.kind}/${c.name}`))].slice(0, 12).join("; "),
      dbEffect: "read", liveResult: "", status: "NOT_TESTED", evidence: "" });
    for (const c of s.controls) {
      const key = `${role}|${s.url}|${c.file}:${c.line}`; if (seen.has(key)) continue; seen.add(key);
      const cls = classify(c);
      rows.push({ role, page: `${s.nav} / ${s.inner}`, url: s.url, control: `${(c.label ?? "").slice(0, 60)} [${c.file.replace("src/components/dashboard/", "")}:${c.line}]`,
        label: c.label, class: cls, expectedRoute: s.url.split("?")[0], api: apiText(c.calls), dbEffect: opsText(c.calls) || (cls === "WRITE" ? "write (untraced helper)" : "none"),
        liveResult: "", status: "NOT_TESTED", evidence: "" });
    }
    // Visible buttons with no handler at all (inventory "suspects"): interactive-looking, so they are rows too.
    for (const d of s.suspects ?? []) {
      const key = `${role}|${s.url}|${d.file}:${d.line}`; if (seen.has(key)) continue; seen.add(key);
      rows.push({ role, page: `${s.nav} / ${s.inner}`, url: s.url, control: `${(d.label ?? "").slice(0, 60)} [${d.file.replace("src/components/dashboard/", "")}:${d.line}]`,
        label: d.label, class: "DEAD", expectedRoute: s.url.split("?")[0], api: "none in source (no handler)", dbEffect: "none",
        liveResult: "", status: "NOT_TESTED", evidence: "" });
    }
  }
  return rows;
}

// ------------------------------------------------------------------------------------------------ write recipes
// Each: roles, fixture env vars, run(page, ctx) -> detail, db(ctx) -> read-only SQL proving the effect, matches(row).
export const RECIPES = [
  { id: "student-cert-add-delete", role: ["student", "established"], fixtures: [], matches: /StudentCertifications\.tsx/,
    async run(p, x) { await x.go("/student/dashboard?tab=profile&view=certifications"); const name = `S32 E2E cert ${x.runId}`;
      await p.getByRole("button", { name: /Add/ }).first().click(); await p.locator("#cert-name").fill(name);
      await x.expectCall(() => p.getByRole("button", { name: /^\s*Save\s*$/ }).first().click(), /\/api\/db\/student_certifications/, "POST");
      await p.reload(); await p.getByText(name).first().waitFor({ timeout: 15000 });
      await x.expectCall(() => p.getByRole("button", { name: new RegExp(`Remove|Delete`) }).first().click(), /\/api\/db\/student_certifications/, "DELETE");
      return `added and removed "${name}"; persisted across refresh`; },
    db: (x) => `select 'S32DB ' || count(*) from public.student_certifications where student_id = '${x.userId}' and name = 'S32 E2E cert ${x.runId}';`, expectDb: "0" },
  { id: "student-written-submit", role: ["student", "established"], fixtures: ["E2E_FIXTURE_WRITTEN_TASK_ID"], matches: /WrittenTaskPanel\.tsx/,
    async run(p, x) { await x.go("/student/dashboard?tab=lab");
      await p.getByRole("button", { name: /Write my answer/ }).first().click();
      await p.getByPlaceholder("Write your answer here...").fill(`S32 live E2E answer ${x.runId}: a hash map hashes the key to choose a bucket, so lookups are fast on average.`);
      const r = await x.expectCall(() => p.getByRole("button", { name: /^\s*Submit\s*$/ }).last().click(), /\/api\/functions\/submit-written-task/, "POST", 120000);
      await p.getByText(/Score \d+%|Sent for review|Needs \d+%/).first().waitFor({ timeout: 30000 });
      return `submit-written-task answered HTTP ${r}`; },
    db: (x) => `select 'S32DB ' || count(*) from public.task_submissions where task_id = '${x.env.E2E_FIXTURE_WRITTEN_TASK_ID}' and student_id = '${x.userId}' and created_at > now() - interval '30 minutes';`, expectDb: ">=1" },
  { id: "tpo-send-reminder", role: ["tpo"], fixtures: ["E2E_FIXTURE_QUIET_STUDENT_NAME", "E2E_FIXTURE_QUIET_STUDENT_ID"], matches: /TpoStudentProfile\.tsx/,
    async run(p, x) { await x.go("/college/dashboard?tab=students");
      await p.getByText(x.env.E2E_FIXTURE_QUIET_STUDENT_NAME).first().click();
      const r = await x.expectCall(() => p.getByRole("button", { name: /Send reminder/ }).first().click(), /\/api\/db\/rpc\/tpo_send_reminder/, "POST");
      return `tpo_send_reminder HTTP ${r}`; },
    db: (x) => `select 'S32DB ' || count(*) from public.interventions where student_id = '${x.env.E2E_FIXTURE_QUIET_STUDENT_ID}' and type = 'reminder' and created_at > now() - interval '30 minutes';`, expectDb: ">=1" },
  { id: "company-shortlist", role: ["company"], fixtures: ["E2E_FIXTURE_CANDIDATE_NAME", "E2E_FIXTURE_CANDIDATE_ID"], matches: /RecruiterDashboardContent\.tsx/,
    async run(p, x) { await x.go("/company/dashboard?tab=talent");
      await p.getByText(x.env.E2E_FIXTURE_CANDIDATE_NAME).first().click();
      await p.getByPlaceholder("Why them? (optional)").fill(`S32 ${x.runId}`);
      const r = await x.expectCall(() => p.getByRole("button", { name: /^\s*Shortlist\s*$/ }).last().click(), /\/api\/db\/rpc\/recruiter_shortlist/, "POST");
      return `recruiter_shortlist HTTP ${r}`; },
    db: (x) => `select 'S32DB ' || count(*) from public.recruiter_shortlists where student_id = '${x.env.E2E_FIXTURE_CANDIDATE_ID}' and note = 'S32 ${x.runId}';`, expectDb: "1" },
  { id: "admin-review-approve", role: ["admin"], fixtures: ["E2E_FIXTURE_REVIEW_SUBMISSION_ID"], matches: /ReviewedSubmissions\.tsx/,
    async run(p, x) { await x.go("/admin/dashboard?tab=reviewed-submissions");
      const r = await x.expectCall(() => p.getByRole("button", { name: /^\s*Approve/ }).first().click(), /\/api\/db\/rpc\/review_task_submission/, "POST");
      return `review_task_submission HTTP ${r}`; },
    db: (x) => `select 'S32DB ' || status from public.task_submissions where id = '${x.env.E2E_FIXTURE_REVIEW_SUBMISSION_ID}';`, expectDb: "passed" },
];

// S34 (TEJA): the recipes for the controls S34 made real live in their own file and join the same list.
RECIPES.push(...(await import("./s34_live_recipes.mjs")).default);

/** Runs one READ-ONLY query on STAGING through the repository's runner and returns the S32DB line's value. */
export function dbQuery(sql, { run = spawnSync } = {}) {
  if (!/^\s*select\b/i.test(sql) || /;\s*\S/.test(sql.trim().replace(/;\s*$/, "")) || /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(sql.replace(/'[^']*'/g, ""))) {
    throw new Error("db-verify accepts one SELECT only");
  }
  const dir = mkdtempSync(join(tmpdir(), "s32db-")); const f = join(dir, "q.sql");
  writeFileSync(f, `\\set ON_ERROR_STOP on\n\\pset tuples_only on\nbegin transaction read only;\n${sql}\nrollback;\n`);
  const r = run("bash", [join(ROOT, "scripts/dev-tools/staging_sql.sh"), f], { encoding: "utf8", timeout: 300000 });
  const line = String(r.stdout ?? "").split("\n").find((l) => l.includes("S32DB "));
  if (r.status !== 0 || !line) throw new Error(`staging read failed (exit ${r.status})`);
  return line.slice(line.indexOf("S32DB ") + 6).trim();
}
const dbOk = (got, want) => want.startsWith(">=") ? Number(got) >= Number(want.slice(2)) : got === want;

// ------------------------------------------------------------------------------------------------ live run
export async function provenance(base, expectEntry, fetchImpl = fetch) {
  const html = await (await fetchImpl(`${base}/`)).text();
  const live = html.match(/\/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
  if (!expectEntry) return { live, status: "UNVERIFIED", detail: "no --expect-entry given" };
  return { live, status: live === expectEntry ? "VERIFIED" : "MISMATCH", detail: `live ${live}, expected ${expectEntry}` };
}

export async function runLive({ base, roles, env, chromium, out, allowWrites, dbVerify, anon, expectEntry, inv, log = console.log }) {
  const rows = planMatrix(inv).filter((r) => anon || roles.includes(r.role));
  const prov = await provenance(base, expectEntry);
  log(`provenance: ${prov.status} (${prov.detail})`);
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const browser = await chromium.launch();
  const extra = [];
  try {
    for (const role of anon ? ["anonymous"] : roles) {
      const R = ROLES[role];
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await ctx.newPage();
      const net = []; const errors = [];
      page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) net.push({ m: r.request().method(), p: u.pathname, s: r.status(), t: r.headers()["content-type"] ?? "" }); });
      page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
      const shot = (n) => page.screenshot({ path: join(out, `${role}-${n.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`), mask: [page.locator("input, textarea")] }).catch(() => null);
      const go = async (path) => { await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {}); };
      const bad = (from) => net.slice(from).filter((n) => n.s >= 500 || /text\/html/.test(n.t) || (!anon && (n.s === 401 || n.s === 403)));
      const expectCall = async (act, re, method, timeout = 30000) => {
        const wait = page.waitForResponse((r) => re.test(new URL(r.url()).pathname) && r.request().method() === method, { timeout });
        await act(); const r = await wait; if (r.status() >= 400) throw new Error(`${method} ${new URL(r.url()).pathname} answered ${r.status()}`); return r.status();
      };
      let userId = null; const secrets = [];
      if (anon) {
        for (const row of rows.filter((r) => r.class === "SCREEN")) {
          const from = net.length; await go(row.url);
          const ok = await page.waitForURL((u) => u.pathname.startsWith("/auth"), { timeout: 20000 }).then(() => true, () => false);
          const leak = net.slice(from).filter((n) => n.p !== "/api/auth/session" && n.s < 300);
          row.liveResult = ok && !leak.length ? "signed-out visitor sent to /auth, no data answered" : `stayed on ${new URL(page.url()).pathname}; ${leak.map((n) => `${n.s} ${n.p}`).join(", ")}`;
          row.status = ok && !leak.length ? "PASS (signed-out only)" : "FAIL";
        }
        await ctx.close(); continue;
      }
      // Credentials and identity.
      const K = `E2E_${role.toUpperCase()}`;
      const email = env[`${K}_EMAIL`], password = env[`${K}_PASSWORD`], expectId = env[`${K}_USER_ID`];
      const blockRole = (why) => { for (const r of rows.filter((x) => x.role === role)) { r.status = "BLOCKED"; r.liveResult = why; } };
      if (!email || !password || !expectId) { blockRole(`no authorized account: set ${K}_EMAIL, ${K}_PASSWORD, ${K}_USER_ID`); await ctx.close(); continue; }
      secrets.push(email, password);
      try {
        await go("/auth");
        await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password);
        await expectCall(() => page.click('button[type="submit"]'), /^\/api\/auth\/login$/, "POST", 45000);
        const cookie = (await ctx.cookies(base)).find((c) => c.name === "__session");
        if (!cookie?.httpOnly || !cookie?.secure) throw new Error("session cookie missing, not HttpOnly or not Secure");
        const s = await ctx.request.get(`${base}/api/auth/session`); const body = await s.json();
        userId = body?.session?.user?.id; const managed = body?.session?.user?.user_metadata?.account_type;
        if (userId !== expectId || managed !== R.managed) throw new Error(`signed in as ${userId}/${managed}, expected ${expectId}/${R.managed}`);
      } catch (e) { blockRole(`sign-in failed: ${redact(e.message, secrets)}`); for (const r of rows.filter((x) => x.role === role)) r.status = "FAIL"; await ctx.close(); continue; }

      const x = { go, expectCall, env, runId, userId, page };
      // Screens: open, unauthorized/5xx/HTML, refresh persistence, offline + retry.
      for (const row of rows.filter((r) => r.role === role && r.class === "SCREEN")) {
        const from = net.length; errors.length = 0;
        try {
          await go(row.url); const at = new URL(page.url()); const path0 = at.pathname + at.search;
          if (!at.pathname.startsWith(R.home.split("/").slice(0, 2).join("/"))) throw new Error(`redirected to ${at.pathname}`);
          await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          const after = new URL(page.url()); if (after.pathname + after.search !== path0) throw new Error(`refresh moved to ${after.pathname}${after.search}`);
          await ctx.setOffline(true); await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForTimeout(1500);
          await ctx.setOffline(false); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
          const txt = (await page.locator("body").innerText()).trim();
          const b = bad(from);
          if (errors.length || txt.length < 30 || b.length) throw new Error(errors[0] ?? (b.length ? b.map((n) => `${n.s} ${n.m} ${n.p}`).join(", ") : "blank after retry"));
          row.liveResult = `opened; refresh kept ${path0}; recovered after offline; ${net.slice(from).length} API calls, none failing`; row.status = "PASS";
        } catch (e) { row.liveResult = redact(e.message, secrets).slice(0, 240); row.status = "FAIL"; }
        row.evidence = (await shot(row.url)) ?? "";
      }
      // SAFE controls: really clicked on the live page.
      for (const row of rows.filter((r) => r.role === role && r.class === "SAFE")) {
        const label = (row.label ?? "").trim();
        if (!label || /^\(icon/.test(label) || label.length > 50) { row.status = "BLOCKED"; row.liveResult = "no stable accessible name to click"; continue; }
        try {
          await go(row.url); const from = net.length;
          const el = page.getByRole("tab", { name: label, exact: true }).or(page.getByRole("button", { name: label, exact: true })).first();
          if (!(await el.count())) { row.status = "BLOCKED"; row.liveResult = "not rendered for this account's data"; continue; }
          await el.click({ timeout: 10000 }); await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          await page.keyboard.press("Escape").catch(() => {});
          const b = bad(from); if (b.length || errors.length) throw new Error(errors[0] ?? b.map((n) => `${n.s} ${n.p}`).join(", "));
          row.liveResult = `clicked; now ${new URL(page.url()).pathname}${new URL(page.url()).search}; ${net.slice(from).length} API calls ok`; row.status = "PASS";
        } catch (e) { row.liveResult = redact(e.message, secrets).slice(0, 240); row.status = "FAIL"; }
      }
      // DEAD controls (no handler in source): safe to click; a click that changes nothing is a broken interaction.
      for (const row of rows.filter((r) => r.role === role && r.class === "DEAD")) {
        const label = (row.label ?? "").trim();
        if (!label || /^\(icon/.test(label)) { row.status = "BLOCKED"; row.liveResult = "no stable accessible name to click"; continue; }
        try {
          await go(row.url); const from = net.length; const before = page.url();
          const el = page.getByRole("button", { name: label, exact: true }).first();
          if (!(await el.count())) { row.status = "BLOCKED"; row.liveResult = "not rendered for this account's data"; continue; }
          if (await el.isDisabled()) { row.status = "PASS"; row.liveResult = "rendered disabled (not a dead interaction)"; continue; }
          await el.click({ timeout: 10000 }); await page.waitForTimeout(1500);
          const changed = page.url() !== before || net.length > from || (await page.getByRole("dialog").count()) > 0;
          row.status = changed ? "PASS" : "FAIL"; row.liveResult = changed ? "click did something" : "control does nothing (no request, navigation or dialog)";
        } catch (e) { row.liveResult = redact(e.message, secrets).slice(0, 240); row.status = "FAIL"; }
        row.evidence = (await shot(`dead-${label}`)) ?? "";
      }
      // WRITE / READ / UNSURE controls: recipes only.
      for (const rec of RECIPES.filter((r) => r.role.includes(role))) {
        const covered = rows.filter((r) => r.role === role && r.class !== "SCREEN" && r.class !== "SAFE" && rec.matches.test(r.control));
        const missing = rec.fixtures.filter((f) => !env[f]);
        const result = { role, page: "(recipe)", url: "", control: rec.id, class: "RECIPE", expectedRoute: "", api: "", dbEffect: rec.db({ ...x, env }).replace(/\s+/g, " ").slice(0, 160), liveResult: "", status: "BLOCKED", evidence: "" };
        if (!allowWrites) result.liveResult = "write recipe not run (no --allow-writes)";
        else if (missing.length) result.liveResult = `fixture missing: ${missing.join(", ")}`;
        else {
          try {
            result.liveResult = await rec.run(page, x); result.status = "PASS (UI + API)";
            if (dbVerify) { const got = dbQuery(rec.db({ ...x, env })); result.liveResult += `; DB: ${got}`; result.status = dbOk(got, rec.expectDb) ? "PASS" : "FAIL"; }
            else result.liveResult += "; DB effect not verified (no --db-verify)";
          } catch (e) { result.liveResult = redact(e.message, secrets).slice(0, 240); result.status = "FAIL"; }
          result.evidence = (await shot(`recipe-${rec.id}`)) ?? "";
        }
        extra.push(result);
        for (const r of covered) { r.status = result.status.startsWith("PASS") ? "COVERED_BY_RECIPE" : result.status; r.liveResult = `see recipe ${rec.id}`; }
      }
      for (const r of rows.filter((r) => r.role === role && ["WRITE", "READ", "UNSURE"].includes(r.class) && r.status === "NOT_TESTED")) {
        r.status = "BLOCKED"; r.liveResult = r.class === "WRITE" ? "write control: no disposable-fixture recipe" : r.class === "READ" ? "reads via a handler: no recipe yet" : "handler not provably side-effect free: not auto-clicked";
      }
      // Role isolation: other dashboards and other roles' RPCs.
      for (const path of R.foreign) {
        await go(path); const stayed = new URL(page.url()).pathname.startsWith(path);
        extra.push({ role, page: "(isolation)", url: path, control: `open ${path}`, class: "ISOLATION", expectedRoute: "redirect away", api: "", dbEffect: "none", liveResult: stayed ? "stayed" : `sent to ${new URL(page.url()).pathname}`, status: stayed ? "FAIL" : "PASS", evidence: "" });
      }
      for (const fn of FOREIGN_RPC[role] ?? []) {
        const r = await ctx.request.post(`${base}/api/db/rpc/${fn}`, { data: {}, headers: { "content-type": "application/json", origin: base }, failOnStatusCode: false });
        const t = await r.text(); let rowsBack = 0; try { const j = JSON.parse(t); rowsBack = Array.isArray(j) ? j.length : 0; } catch { /* error body */ }
        const ok = r.status() >= 400 || rowsBack === 0;
        extra.push({ role, page: "(isolation)", url: `/api/db/rpc/${fn}`, control: `call ${fn}`, class: "ISOLATION", expectedRoute: "", api: `POST /api/db/rpc/${fn}`, dbEffect: "none", liveResult: `HTTP ${r.status()}, ${rowsBack} rows`, status: ok ? "PASS" : "FAIL", evidence: "" });
      }
      await ctx.close();
    }
  } finally { await browser.close().catch(() => {}); }
  return { rows: [...rows, ...extra], provenance: prov };
}

export function summarize(rows, prov) {
  const c = {}; for (const r of rows) { const k = r.status.startsWith("PASS") ? "PASS" : r.status; c[k] = (c[k] ?? 0) + 1; }
  const exit = prov?.status === "MISMATCH" ? EXIT.WRONG_BUILD : c.FAIL ? EXIT.FAIL : (c.BLOCKED || c.NOT_TESTED) ? EXIT.INCOMPLETE : EXIT.OK;
  return { counts: c, exit };
}
const csv = (rows) => ["Role,Page,Control,Class,Expected route,API,DB effect,Live result,Status,Evidence",
  ...rows.map((r) => [r.role, r.page, r.control, r.class, r.expectedRoute, r.api, r.dbEffect, r.liveResult, r.status, r.evidence].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const a = process.argv.slice(2); const has = (f) => a.includes(f); const val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : undefined; };
  const out = val("--out") ?? `e2e-out/s32/run-${new Date().toISOString().replace(/[:.]/g, "-")}`; mkdirSync(out, { recursive: true });
  const inv = buildInventory();
  if (has("--plan")) {
    const rows = planMatrix(inv); const s = summarize(rows, null);
    writeFileSync(join(out, "matrix.json"), JSON.stringify({ mode: "plan (nothing run)", rows }, null, 1)); writeFileSync(join(out, "matrix.csv"), csv(rows));
    const cls = {}; for (const r of rows) cls[r.class] = (cls[r.class] ?? 0) + 1;
    console.log(`PLAN: ${rows.length} rows ${JSON.stringify(cls)} -> ${out}/matrix.csv`); process.exit(s.exit);
  }
  let base; try { base = assertStaging(process.env.E2E_BASE ?? "https://prooflab-staging.web.app"); if (!has("--confirm-staging")) throw new Error("add --confirm-staging"); }
  catch (e) { console.log(`REFUSED: ${e.message}`); process.exit(EXIT.REFUSED); }
  const { chromium } = await import("playwright");
  const roles = (val("--roles") ?? Object.keys(ROLES).join(",")).split(",").filter((r) => ROLES[r]);
  const { rows, provenance: prov } = await runLive({ base, roles, env: process.env, chromium, out, allowWrites: has("--allow-writes"), dbVerify: has("--db-verify"), anon: has("--anon"), expectEntry: val("--expect-entry"), inv });
  const s = summarize(rows, prov);
  writeFileSync(join(out, "matrix.json"), JSON.stringify({ base, provenance: prov, counts: s.counts, rows }, null, 1)); writeFileSync(join(out, "matrix.csv"), csv(rows));
  console.log(`provenance ${prov.status}; ${JSON.stringify(s.counts)}; exit ${s.exit}; ${out}/matrix.csv`);
  process.exit(s.exit);
}
