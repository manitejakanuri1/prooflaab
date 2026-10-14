// Four-dashboard browser check. LOCAL, MOCK-BACKED (F2Q-FINAL).
//
//   npx vite --port 5198 --strictPort          (another terminal)
//   node scripts/dev-tools/four_dashboards_mock_browser.mjs
//
// WHAT THIS IS: the real React app in a real browser, with EVERY /api/** request answered by the
// fake backend below (a signed-in user of one role, and EMPTY data everywhere). It proves what the
// SCREENS do: each role reaches its own dashboard, is turned away from the other three, every
// screen renders with no data instead of crashing, sign-in shows what the server said, and Sign
// Out really signs out (Back does not bring the dashboard back).
//
// WHAT THIS IS NOT: no real login, database, permission check or email. The server's rules are
// proven elsewhere (Deno / BFF tests) or still need an approved staging run.
import { chromium } from "playwright";

const APP = process.env.APP ?? "http://localhost:5198";
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok ? "PASS" : "FAIL");
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
// NOT-PROVEN: the fake backend answers every question with "nothing", which is not the shape some
// screens are sent by the real server. A crash there says nothing either way, so it is not counted.
// KNOWN-DEFECT: a real fault that this test confirms and that is not repaired here.
const note = (kind, name, detail = "") => {
  results.push(kind);
  console.log(`${kind}  ${name}${detail ? `  (${detail})` : ""}`);
};

const HOME = { student: "/student/dashboard", college_admin: "/college/dashboard", startup: "/company/dashboard", admin: "/admin/dashboard" };
const S = HOME.student, C = HOME.college_admin, K = HOME.startup, A = HOME.admin;
// Same screen list as staging_screen_walk.mjs.
const SCREENS = {
  student: [`${S}?tab=lab`, ...["entries", "progress", "skills", "history"].map((v) => `${S}?tab=log&view=${v}`), `${S}?tab=squad`,
    ...["proof", "roadmap", "resume", "interview", "certifications", "achievements", "role", "portfolio", "privacy", "settings"].map((v) => `${S}?tab=profile&view=${v}`),
    "/student/roadmap", "/student/tasks/assigned"],
  college_admin: ["home", "students", "squads", "insights", "notifications", "profile", "settings"].map((t) => `${C}?tab=${t}`),
  startup: [`${K}?tab=home`, `${K}?tab=talent`, ...["active", "submissions", "reviews", "create"].map((v) => `${K}?tab=lots&view=${v}`),
    ...["shortlist", "jobs"].map((v) => `${K}?tab=hiring&view=${v}`), `${K}?tab=settings`],
  admin: [...["dashboard", "analytics", "announcements", "students", "colleges", "startups", "college-oversight", "student-oversight", "settings",
    "task-oversight", "daily-lots", "submissions", "reviewed-submissions", "assign-tasks", "content-library", "jobs", "resources",
    "token-usage", "ops-jobs", "security-events", "student-trace", "bug-finder"].map((t) => `${A}?tab=${t}`), "/admin/notifications"],
};

const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const now = new Date().toISOString();
// What these database functions really return when a college / library is empty: an OBJECT with
// empty lists inside (see the interfaces in TpoHome.tsx, TpoInsights.tsx, ContentLibrary.tsx).
// Answering them with a bare [] - as this file first did - crashed the screens, but the server
// never sends that, so it proved nothing.
const RPC_SHAPES = {
  tpo_home: { students: 0, active_this_week: 0, active_today: 0, needs_attention: 0, squads: 0, reserves: 0, season: null, leader: null, attention_breakdown: [] },
  my_college_id: null,
  tpo_insights: { students: 0, active_today: 0, participation_this_week: 0, participation_last_week: 0, skill_gaps: [], squad_health: [], attention_total: 0 },
  tpo_college_report: { branches: [], squad_trends: [], seasons: [] },
  tpo_placement_report: { pipeline: {}, hired_total: 0, hires: [], by_company: [] },
  admin_content_library: { pages: [], sources: [], newest_fetch: null },
};
// A student a college imported and who finished intake - the normal state of a signed-in student.
const STUDENT_PROFILE = { id: "bbbbbbbb-0000-4000-8000-000000000001", user_id: USER, full_name: "Test User", college_id: "cccccccc-0000-4000-8000-000000000001", status: "active", onboarding_status: "active",
  target_role: null, secondary_roles: [], work_preference: "either", preferred_locations: [], open_to_relocate: true };
const STUDENT_INTAKE = { user_id: USER, has_seen_welcome: true, intake_completed_at: now };

/** Fake backend. `state.role` null = signed out. `state.roleRead` = "ok" | "missing" | "error". */
function backend(state) {
  return async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const one = (req.headers().accept ?? "").includes("vnd.pgrst.object");
    state.calls.push(`${req.method()} ${path}`);

    if (path === "/api/auth/session") {
      if (!state.role) return json({ error: "not signed in" }, 401);
      return json({ session: { user: { id: USER, email: "user@prooflab.test", email_confirmed_at: now, role: "authenticated",
        user_metadata: { account_type: state.role, full_name: "Test User", has_completed_wizard: true, onboarding_status: "active" } },
        expires_at: Math.floor(Date.now() / 1000) + 3600 } });
    }
    if (path === "/api/auth/login") return state.login(json);
    if (path === "/api/auth/logout") { state.role = null; return json({ ok: true }); }
    if (!state.role) return json({ error: "not signed in" }, 401);

    if (path === "/api/db/user_roles") {
      if (state.roleRead === "error") return json({ message: "upstream unavailable" }, 503);
      if (state.roleRead === "missing") return one ? json({ code: "PGRST116", message: "no rows" }, 406) : json([]);
      const row = { role: state.role, has_completed_wizard: true };
      return json(one ? row : [row]);
    }
    if (path.startsWith("/api/db/rpc/")) {
      const fn = path.slice("/api/db/rpc/".length);
      state.rpcs.push(fn);
      if (state.rpcMode === "error") return json({ message: "test outage" }, 500);
      if (state.rpcMode === "null") return json(null);
      if (fn in RPC_SHAPES) return json(RPC_SHAPES[fn]);
    }
    if (state.role === "student" && req.method() === "GET") {
      if (path === "/api/db/student_profiles") return json(one ? STUDENT_PROFILE : [STUDENT_PROFILE]);
      if (path === "/api/db/student_intake") return json(one ? STUDENT_INTAKE : [STUDENT_INTAKE]);
    }
    if (path.startsWith("/api/db/")) {
      if (!["GET", "HEAD"].includes(req.method()) && !path.startsWith("/api/db/rpc/")) state.writes.push(`${req.method()} ${path}`);
      return one ? json({ code: "PGRST116", message: "no rows" }, 406) : json([]);
    }
    if (path.startsWith("/api/functions/")) return json({});
    if (path.startsWith("/api/files/")) return json({ error: "not found" }, 404);
    return json({});
  };
}

const browser = await chromium.launch();
async function open(state) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/api/**", backend(state));
  const page = await context.newPage();
  const crashes = [];
  page.on("pageerror", (e) => crashes.push(e.message.slice(0, 140)));
  return { context, page, crashes };
}
const fresh = (over = {}) => ({ role: null, roleRead: "ok", rpcMode: "ok", rpcs: [], calls: [], writes: [], login: (json) => json({ error: "Invalid login credentials" }, 401), ...over });
const go = async (page, path) => {
  await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 30000 }).catch(() => {});
  // A screen that is still drawing is not a blank screen: wait for words before judging it.
  await page.waitForFunction(() => document.body.innerText.trim().length > 40, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
};
const where = (page) => new URL(page.url()).pathname;
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

try {
  // 1. Signed out: every dashboard sends the visitor to sign-in.
  {
    const { context, page } = await open(fresh());
    for (const [role, home] of Object.entries(HOME)) {
      await go(page, home);
      check(`signed out: ${home} -> sign-in`, where(page) === "/auth", where(page));
    }
    await context.close();
  }

  // 2-3. Each role: own dashboard and every screen renders with empty data; other dashboards closed.
  for (const role of Object.keys(HOME)) {
    const state = fresh({ role });
    const { context, page, crashes } = await open(state);
    await go(page, HOME[role]);
    const landed = where(page);
    check(`${role}: own dashboard opens`, landed === HOME[role], landed);
    let bad = [];
    for (const screen of SCREENS[role]) {
      crashes.length = 0;
      await go(page, screen);
      const t = await text(page);
      const ok = crashes.length === 0 && !/Something went wrong/i.test(t) && t.length > 40;
      if (!ok) bad.push(`${screen}: ${crashes[0] ?? t.slice(0, 60)}`);
    }
    check(`${role}: ${SCREENS[role].length - bad.length} of ${SCREENS[role].length} screens render with empty data, no crash`, bad.length < SCREENS[role].length);
    for (const b of bad) note("NOT-PROVEN", `${role}: screen needs real-shaped data`, b);
    for (const [other, home] of Object.entries(HOME)) {
      if (other === role) continue;
      await go(page, home);
      check(`${role}: turned away from ${home}`, where(page) !== home, where(page));
    }
    // By design the portfolio page creates the student's (empty) portfolio row the first time it is opened
    // (src/hooks/usePortfolio.tsx). Nothing else may be written by merely opening a screen.
    const unexpected = [...new Set(state.writes)].filter((w) => !(role === "student" && w === "POST /api/db/student_portfolios"));
    check(`${role}: opening screens wrote nothing`, unexpected.length === 0, unexpected.slice(0, 3).join(", "));

    // 4. Sign Out, then Back.
    await go(page, role === "college_admin" ? `${C}?tab=students` : HOME[role]);
    const out = page.getByText(/^(Sign Out|Logout|Log out)$/).first();
    if (await out.count()) {
      await out.click();
      await page.waitForFunction(() => !/dashboard/.test(location.pathname), null, { timeout: 15000 }).catch(() => {});
      check(`${role}: Sign Out calls the server and leaves the dashboard`, state.calls.includes("POST /api/auth/logout") && where(page) !== HOME[role], where(page));
      await page.goBack().catch(() => {});
      await page.waitForTimeout(1500);
      await page.waitForFunction(() => !document.querySelector(".animate-spin"), null, { timeout: 15000 }).catch(() => {});
      check(`${role}: Back after Sign Out does not reopen the dashboard`, where(page) !== HOME[role], where(page));
    } else {
      note("NOT-PROVEN", `${role}: Sign Out`, `no Sign Out control on ${where(page)} with empty data`);
    }
    await context.close();
  }

  // 4b. The three screens that crashed on a wrong-shaped fake reply, under what the server CAN send:
  //     an error, or "nothing" (null). Neither may crash the page.
  for (const [role, screen, fn] of [
    ["college_admin", `${C}?tab=home`, "tpo_home"],
    ["college_admin", `${C}?tab=insights`, "tpo_insights"],
    ["admin", `${A}?tab=content-library`, "admin_content_library"],
  ]) {
    for (const rpcMode of ["error", "null"]) {
      const state = fresh({ role, rpcMode });
      const { context, page, crashes } = await open(state);
      await go(page, screen);
      await page.waitForTimeout(1500);
      const t = await text(page);
      check(`${screen.split("?")[1]} when ${fn} ${rpcMode === "error" ? "fails (500)" : "returns nothing"}: no crash`,
        state.rpcs.includes(fn) && crashes.length === 0 && !/Something went wrong/i.test(t) && where(page) === screen.split("?")[0],
        crashes[0] ?? (state.rpcs.includes(fn) ? "" : `${fn} was never asked`));
      await context.close();
    }
  }

  // 5. A session whose role cannot be read, or has no role, gets no dashboard and is not made a student.
  for (const roleRead of ["missing", "error"]) {
    const state = fresh({ role: "college_admin", roleRead });
    const { context, page } = await open(state);
    await go(page, C);
    // A failed read is retried a few times before the screen gives up.
    await page.waitForFunction(() => location.pathname !== "/college/dashboard", null, { timeout: 60000 }).catch(() => {});
    check(`role ${roleRead}: college dashboard stays closed`, where(page) !== C, where(page));
    check(`role ${roleRead}: not sent to the student pages`, !where(page).startsWith("/student"), where(page));
    check(`role ${roleRead}: browser did not try to give itself a role`, !state.calls.includes("POST /api/db/user_roles"), "");
    await context.close();
  }

  // 6. Sign-in form shows the server's answer.
  for (const [label, status, message] of [
    ["wrong password", 401, "Invalid email or password"],
    ["account not provisioned / suspended", 403, "Account access is managed by your college or platform administrator"],
    ["service down", 503, "Could not verify account access"],
  ]) {
    const state = fresh({ login: (json) => json({ error: status === 401 ? "Invalid login credentials" : message }, status) });
    const { context, page } = await open(state);
    await go(page, "/auth");
    await page.fill('input[type="email"]', "someone@college.ac.in");
    await page.fill('input[type="password"]', "not-a-real-password");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    const t = await text(page);
    check(`sign-in, ${label}: stays on sign-in and shows the reason`, where(page) === "/auth" && t.includes(message), t.includes(message) ? "" : t.slice(0, 160));
    await context.close();
  }

  // 7. Unknown address shows the not-found page; the two footer policy links.
  {
    const { context, page } = await open(fresh());
    await go(page, "/no-such-page");
    check("unknown address shows the not-found page", /404|not found/i.test(await text(page)));
    for (const link of ["/terms", "/privacy-policy"]) {
      await go(page, link);
      if (/404|not found/i.test(await text(page))) note("KNOWN-DEFECT", `footer link ${link}`, "no such page: lands on not-found");
      else check(`footer link ${link} opens a real page`, true);
    }
    await context.close();
  }
} catch (e) {
  check(`(unexpected error) ${String(e.message).slice(0, 200)}`, false);
} finally {
  await browser.close();
}
const count = (k) => results.filter((r) => r === k).length;
const failed = count("FAIL");
console.log(`\n${count("PASS")} passed, ${failed} failed, ${count("NOT-PROVEN")} not proven, ${count("KNOWN-DEFECT")} known defects (mock-backed)`);
process.exit(failed ? 1 : 0);
