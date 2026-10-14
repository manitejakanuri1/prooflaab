// S31: browser checks for the review UI and the S28 gaps. LOCAL ONLY, MOCKED NETWORK (real React app, Playwright).
//
//   npx vite --port 5201 --strictPort                 (another terminal, in this repo)
//   APP=http://localhost:5201 node scripts/dev-tools/sidhu_s31_dashboards_browser.mjs
//
// Covers: the 16 Squad inner tabs with squad data (S28 left them NOT-PROVEN); the pending-review badges on the
// TPO "Flagged Submissions" button and the Admin "Flags & reviews" tab; the reviewer list's flag label, the exact
// review request and its outcome messages; the student outage regression (S28: endless spinner) on Floor and Squad;
// the student's neutral "sent for review" wording. Every /api/** call is answered by the fake backend below.
// A PASS is VERIFIED_BY_LOCAL_TEST only. Exit 0 only if nothing FAILED. All data is synthetic.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const APP = process.env.APP ?? "http://localhost:5201";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(APP)) { console.log(`REFUSED: local dev server only, not ${APP}`); process.exit(3); }
const OUT = process.env.E2E_OUT ?? "e2e-out/s31/browser";
mkdirSync(OUT, { recursive: true });
const results = [];
const rec = (area, check, status, detail = "") => { results.push({ area, check, status, detail: String(detail).slice(0, 240) }); console.log(`${status.padEnd(10)} ${area}: ${check}${detail ? `  (${String(detail).slice(0, 150)})` : ""}`); };
const ok = (a, c, cond, d = "") => rec(a, c, cond ? "PASS" : "FAIL", d);

const now = new Date().toISOString();
const USER = "aaaaaaaa-0000-4000-8000-000000000031";
const SP = "bbbbbbbb-0000-4000-8000-000000000031";
const COLLEGE = "cccccccc-0000-4000-8000-000000000031";
const SQ = "dddddddd-0000-4000-8000-000000000031";
const SUB1 = "eeeeeeee-0000-4000-8000-000000000031", SUB2 = "eeeeeeee-0000-4000-8000-000000000032";
const TASK = "ffffffff-0000-4000-8000-000000000031";
const PROFILE = { id: SP, user_id: USER, full_name: "S31 Synthetic Student", college_id: COLLEGE, status: "active", onboarding_status: "active" };
const SQUAD = { id: SQ, name: "S31 Squad", college_id: COLLEGE, points: 12, wins: 1, losses: 0, draws: 0, rank: 1, season_id: null, cohort: "A", archived_at: null, created_at: now };
const FLAGGED = [
  { submission_id: SUB1, task_id: TASK, task_title: "Explain hash maps", student_id: SP, student_name: "S31 Synthetic Student", score: 75, flags: ["copied_answer"], rubric_scores: [], code: "answer one", created_at: now },
  { submission_id: SUB2, task_id: TASK, task_title: "Explain trees", student_id: SP, student_name: "S31 Synthetic Student", score: 70, flags: ["copied_answer"], rubric_scores: [], code: "answer two", created_at: now },
];
const RPC_DEFAULTS = {
  tpo_home: { students: 0, active_this_week: 0, active_today: 0, needs_attention: 0, squads: 1, reserves: 0, season: null, leader: null, attention_breakdown: [] },
  my_college_id: COLLEGE,
  tpo_insights: { students: 0, active_today: 0, participation_this_week: 0, participation_last_week: 0, skill_gaps: [], squad_health: [], attention_total: 0 },
  tpo_college_report: { branches: [], squad_trends: [], seasons: [] },
  tpo_placement_report: { pipeline: {}, hired_total: 0, hires: [], by_company: [] },
};

function backend(st) {
  return async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    const one = (req.headers().accept ?? "").includes("vnd.pgrst.object");
    const json = (b, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    st.calls.push({ method: req.method(), path, body });
    if (path === "/api/auth/session") return json({ session: { user: { id: USER, email: "s31@synthetic.invalid", email_confirmed_at: now, role: "authenticated", user_metadata: { account_type: st.role, full_name: "S31 Synthetic", has_completed_wizard: true, onboarding_status: "active" } }, expires_at: 9999999999 } });
    if (path === "/api/db/user_roles") { const row = { role: st.role, has_completed_wizard: true }; return json(one ? row : [row]); }
    if (st.outage && (path.startsWith("/api/db/") || path.startsWith("/api/functions/"))) return json({ message: "S31 simulated outage" }, 500);
    if (path.startsWith("/api/db/rpc/")) {
      const fn = path.slice(12);
      if (fn in st.rpc) { const v = typeof st.rpc[fn] === "function" ? st.rpc[fn](body) : st.rpc[fn]; return json(v); }
      if (fn in RPC_DEFAULTS) return json(RPC_DEFAULTS[fn]);
      return json(one ? null : []);
    }
    if (path.startsWith("/api/db/")) {
      const t = path.slice(8);
      if (req.method() === "GET" && t in st.tables) return json(one ? (st.tables[t][0] ?? null) : st.tables[t], one && !st.tables[t].length ? 406 : 200);
      if (req.method() === "GET") return one ? json({ code: "PGRST116" }, 406) : json([]);
      return json(one ? {} : [], 201);
    }
    if (path.startsWith("/api/functions/")) { const slug = path.slice(15); return json(st.fn[slug] ?? {}); }
    return json({ error: "not found" }, 404);
  };
}
const browser = await chromium.launch();
async function open(role, over = {}) {
  const st = { role, calls: [], rpc: {}, fn: {}, tables: {}, outage: false, ...over };
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.route("**/api/**", backend(st));
  const page = await ctx.newPage(); const crashes = [];
  page.on("pageerror", (e) => crashes.push(String(e.message).slice(0, 160)));
  return { st, ctx, page, crashes };
}
const settle = async (p) => { await p.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 20000 }).catch(() => {}); await p.waitForTimeout(700); };
const go = async (p, path) => { await p.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 }); await settle(p); };
const text = async (p) => (await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
const studentTables = () => ({ student_profiles: [PROFILE], student_intake: [{ user_id: USER, has_seen_welcome: true, intake_completed_at: now }],
  squad_members: [{ id: "m1", squad_id: SQ, student_id: SP, role: "captain", joined_at: now }], squads: [SQUAD] });

try {
  // 1. Squad inner tabs with squad data.
  for (const [role, path, labels, extra] of [
    ["student", "/student/dashboard?tab=squad", ["Overview", "Members", "Matches", "Standings", "Achievements", "Leaderboards", "Season"], { tables: studentTables() }],
    ["college_admin", "/college/dashboard?tab=squads", ["Standings", "Overview", "Members", "Matches", "Assign", "Manage", "Performance", "Achievements", "Leaderboards"], { tables: { squads: [SQUAD], squad_members: [] } }],
  ]) {
    const { ctx, page, crashes } = await open(role, extra);
    await go(page, path);
    let shown = 0;
    for (const l of labels) {
      const tab = page.getByRole("tab", { name: new RegExp(`^\\s*${l}\\s*$`) }).first();
      if (!(await tab.count())) { rec(`${role} squad`, `${l} tab shown`, "FAIL", "tab missing with squad data"); continue; }
      shown++; crashes.length = 0;
      await tab.click(); await settle(page);
      const t = await text(page);
      ok(`${role} squad`, `${l} renders`, crashes.length === 0 && !/Something went wrong/i.test(t) && t.length > 40, crashes[0] ?? "");
    }
    await shot(page, `${role}-squad`);
    rec(`${role} squad`, `${shown}/${labels.length} inner tabs present with squad data`, shown === labels.length ? "PASS" : "FAIL");
    await ctx.close();
  }

  // 2. Pending-review badges (shared cache with the list).
  {
    const { ctx, page } = await open("college_admin", { rpc: { needs_review_submissions: FLAGGED } });
    await go(page, "/college/dashboard?tab=students");
    const btn = page.getByRole("button", { name: /Flagged Submissions/ }).first();
    ok("college", "Flagged Submissions shows the waiting count (2)", /Flagged Submissions\s*2/.test((await btn.innerText().catch(() => "")).replace(/\s+/g, " ")), await btn.innerText().catch(() => "missing"));
    await shot(page, "college-badge");
    await ctx.close();
    const empty = await open("college_admin", { rpc: { needs_review_submissions: [] } });
    await go(empty.page, "/college/dashboard?tab=students");
    const b2 = (await empty.page.getByRole("button", { name: /Flagged Submissions/ }).first().innerText().catch(() => "")).trim();
    ok("college", "no badge when nothing is waiting", b2 === "Flagged Submissions", b2);
    await empty.ctx.close();
  }
  {
    const { st, ctx, page } = await open("admin", { rpc: { needs_review_submissions: FLAGGED, review_task_submission: (b) => (b?._submission_id === SUB2 ? { ok: true, status: "already_completed", xp_awarded: 0 } : { ok: true, status: "passed", xp_awarded: 20 }) } });
    await go(page, "/admin/dashboard?tab=reviewed-submissions");
    const tab = page.getByRole("tab", { name: /Flags & reviews/ }).first();
    ok("admin", "Flags & reviews tab shows the waiting count (2)", /Flags & reviews\s*2/.test((await tab.innerText().catch(() => "")).replace(/\s+/g, " ")), await tab.innerText().catch(() => "missing"));
    // 3. Reviewer list: label, exact request, outcome toasts.
    ok("admin", "copied_answer flag shown in plain words", /Nearly word-for-word the same as another student's earlier answer to this same question/.test(await text(page)));
    const approve = page.getByRole("button", { name: /^\s*Approve/ });
    if (await approve.count()) {
      const from = st.calls.length; await approve.first().click(); await page.waitForTimeout(1200);
      const c = st.calls.slice(from).find((x) => x.path === "/api/db/rpc/review_task_submission");
      ok("admin", "Approve -> rpc/review_task_submission {_submission_id, _approve: true}", c?.body?._submission_id === SUB1 && c?.body?._approve === true, JSON.stringify(c?.body ?? null));
      ok("admin", "approve toast names the XP and that the student was told", /Approved \(\+20 XP\)\. The student has been told\./.test(await text(page)));
      const from2 = st.calls.length; await approve.nth(1).click().catch(() => {}); await page.waitForTimeout(1200);
      const c2 = st.calls.slice(from2).find((x) => x.path === "/api/db/rpc/review_task_submission");
      if (c2) ok("admin", "moot review toast: already passed with a later answer", /already passed this task with a later answer/.test(await text(page)));
      else rec("admin", "moot review toast", "NOT-PROVEN", "second Approve not clickable after the first refresh");
    } else rec("admin", "Approve button", "FAIL", "no Approve button in the list");
    await shot(page, "admin-reviews");
    await ctx.close();
  }

  // 4. Outage regression (S28): Floor and Squad show a screen, not an endless spinner; no request storm.
  for (const tab of ["lab", "squad"]) {
    const { st, ctx, page } = await open("student", { outage: true });
    await page.goto(`${APP}/student/dashboard?tab=${tab}`, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForTimeout(15000);
    const profiles = st.calls.filter((c) => c.path === "/api/db/student_profiles").length;
    const spin = await page.locator(".animate-spin").count();
    const len = (await text(page)).length;
    ok("student outage", `${tab}: a screen within 15 s and no request storm`, spin === 0 && len > 40 && profiles <= 10, `text=${len} spinners=${spin} student_profiles requests=${profiles}`);
    await shot(page, `student-outage-${tab}`);
    await ctx.close();
  }

  // 5. The student's wording when an answer is held for a person.
  {
    const task = { task_id: TASK, status: "in_progress", tasks: { id: TASK, title: "Explain hash maps", description: "d", status: "pending", started_at: now, rubric_config_id: "r", sandbox_config_id: null, created_by_type: "system", lot_date: null, created_at: now } };
    const { ctx, page } = await open("student", { tables: { ...studentTables(), task_assignments: [task] },
      rpc: { rubric_task_view: { task_id: TASK, title: "Explain hash maps", prompt_text: "p", criteria: [{ id: "c1", name: "Correct", description: "x", max_points: 10 }], min_words: 3, max_words: 300, pass_threshold: 60 } },
      fn: { "submit-written-task": { score: 72, pass_threshold: 60, status: "needs_review", already_completed: false, xp_awarded: 0, scores: [], needs_review: true } } });
    await go(page, "/student/dashboard?tab=lab");
    const write = page.getByRole("button", { name: /Write my answer/ }).first();
    if (await write.count()) {
      await write.click(); await settle(page);
      await page.getByPlaceholder("Write your answer here...").fill("A hash map hashes the key to pick a bucket.");
      await page.getByRole("button", { name: /^\s*Submit\s*$/ }).last().click(); await page.waitForTimeout(1500);
      const t = await text(page);
      ok("student", "held answer: neutral wording, no accusation", /Sent for review/.test(t) && !/cheat|copied|plagiar|suspici/i.test(t), (t.match(/Sent for review[^.]*\./) ?? ["no message"])[0]);
      await shot(page, "student-needs-review");
    } else rec("student", "Write my answer", "NOT-PROVEN", "no written task button with the synthetic assignment");
    await ctx.close();
  }
} finally { await browser.close().catch(() => {}); }

writeFileSync(`${OUT}/results.json`, JSON.stringify({ app: APP, at: new Date().toISOString(), kind: "VERIFIED_BY_LOCAL_TEST (mocked network)", results }, null, 1));
const n = (s) => results.filter((r) => r.status === s).length;
console.log(`\nPASS ${n("PASS")}  FAIL ${n("FAIL")}  NOT-PROVEN ${n("NOT-PROVEN")}`);
process.exit(n("FAIL") ? 1 : 0);
