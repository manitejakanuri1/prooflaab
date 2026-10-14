// STAGING ONLY. Real-browser proof of the admin "Remove Task" guard and the /pricing redirect (6 Oct 2026).
//   E2E_BASE=https://prooflab-staging.web.app node scripts/dev-tools/staging_admin_task_delete_browser.mjs
// Setup (service token, staging): task WITH work = a fresh coding task for a synthetic load student, submitted
// through the real submit path; task WITHOUT work = a fresh task with nothing attached. Then as the staging admin:
//   1. Remove on the task with work -> "Not removed" message, task and its submission still in the database
//   2. Remove on the empty task -> confirmation dialog; dismiss -> still there; accept -> deleted
//   3. Student removal: cancel / a wrong word -> nothing removed (REMOVE is never typed)
//   4. /pricing -> lands on the home page
// Signs in for real (./bff_login.mjs); the minted-token-in-localStorage way no longer works. NOT RUN since this change.
// Exit code = number of failed checks. Leaves only the first task (with its submission) as evidence.
import { chromium } from "playwright";
import { cookieSignIn, credentialsFor } from "./bff_login.mjs";
import { execSync } from "node:child_process";

const BASE = process.env.E2E_BASE;
if (!BASE || !BASE.includes("staging")) throw new Error("E2E_BASE must be the staging site");
const ADMIN = { id: "ffed80fc-08ee-4cce-ac54-9432ef2d81f9", email: "e2e.admin@staging.prooflab.invalid" };
const py = (code) => execSync(`python -c "${code.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
const tag = Date.now().toString(36);
const setup = JSON.parse(py(
  "import sys,json; sys.path.insert(0,'scripts/dev-tools'); import st; " +
  "G='3545a46b-a17f-4f2e-8788-35ada1b5e699'; S='10ad0000-0000-4000-8000-000000014990'; " +
  "ref=st.call('svc','GET','task_sandbox_config?select=reference_solution&id=eq.'+G)[1][0]['reference_solution']; " +
  "mk=lambda t,cfg: st.call('svc','POST','tasks',{'student_id':S,'title':t,'description':'admin delete guard check','category':'technical','status':'pending','source':'lot','lot_category':'technical','difficulty':'Easy','sandbox_config_id':cfg})[1][0]['id']; " +
  `a=mk('DELGUARD with work ${tag}',G); b=mk('DELGUARD empty ${tag}',G); ` +
  "c,r=st.call('user:'+S,'FN','submit-sandbox-task',{'task_id':a,'code':ref}); " +
  "print(json.dumps({'a':a,'b':b,'submit':c}))"));
const count = (path) => Number(py(`import sys; sys.path.insert(0,'scripts/dev-tools'); import st; print(len(st.call('svc','GET','${path}')[1]))`));
if (setup.submit !== 200) throw new Error(`setup submit failed: ${setup.submit}`);

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
// Real sign-in: the form -> /api/auth/login -> HttpOnly cookie. E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD = a staging test admin.
await cookieSignIn(context, BASE, credentialsFor('admin'));
const page = await context.newPage();

async function openRowMenu(title) {
  await page.goto(`${BASE}/admin/dashboard?tab=task-oversight`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search tasks by title...").fill(title);
  const row = page.locator("tr", { hasText: title }).first();
  await row.waitFor({ timeout: 30000 });
  await row.locator("button").last().click();
}

// 1. task with work
await openRowMenu(`DELGUARD with work ${tag}`);
let dialogs = 0;
page.on("dialog", (d) => { dialogs++; void d.dismiss(); });
await page.getByRole("menuitem", { name: /Remove/ }).first().click();
await page.getByText("Not removed").first().waitFor({ timeout: 20000 }).catch(() => {});
check("task with a submission: refused with 'Not removed'", await page.getByText("Not removed").first().isVisible(), `confirm dialogs shown: ${dialogs}`);
check("task with a submission: task and submission still in the database",
  count(`tasks?select=id&id=eq.${setup.a}`) === 1 && count(`task_submissions?select=id&task_id=eq.${setup.a}`) >= 1);
page.removeAllListeners("dialog");

// 2. empty task: dismiss, then accept
await openRowMenu(`DELGUARD empty ${tag}`);
let asked = "";
page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
await page.getByRole("menuitem", { name: /Remove/ }).first().click();
await page.waitForTimeout(3000);
check("empty task: asks for confirmation; dismiss keeps it", asked.includes("Remove this task permanently") && count(`tasks?select=id&id=eq.${setup.b}`) === 1, asked);
await openRowMenu(`DELGUARD empty ${tag}`);
page.once("dialog", (d) => void d.accept());
await page.getByRole("menuitem", { name: /Remove/ }).first().click();
await page.getByText("Task removed successfully").first().waitFor({ timeout: 20000 }).catch(() => {});
check("empty task: accepting removes it", count(`tasks?select=id&id=eq.${setup.b}`) === 0);

// 3. Student removal needs the typed word REMOVE: cancel and a wrong word both leave the student untouched.
//    (REMOVE itself is never typed here.)
const LS = "Load Student 14989", LSID = "10ad0000-0000-4000-8000-000000014989";
for (const answer of [null, "remove please"]) {
  await page.goto(`${BASE}/admin/dashboard?tab=student-oversight`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Search student...").fill(LS);
  const row = page.locator("tr", { hasText: LS }).first();
  await row.waitFor({ timeout: 30000 });
  let prompt = "";
  page.once("dialog", (d) => { prompt = d.message(); void (answer === null ? d.dismiss() : d.accept(answer)); });
  await row.locator("button").last().click();
  await page.getByRole("menuitem", { name: /Remove student/ }).click();
  await page.waitForTimeout(4000);
  check(`removal ${answer === null ? "cancelled" : "with a wrong word"}: prompt requires REMOVE and student untouched`,
    prompt.includes("Type REMOVE") && prompt.includes("CANNOT be undone") && count(`student_profiles?select=id&id=eq.${LSID}`) === 1, prompt.slice(0, 60));
}

// 4. /pricing
await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded" });
await page.waitForURL((u) => !u.toString().includes("/pricing"), { timeout: 15000 }).catch(() => {});
check("/pricing redirects to the home page", new URL(page.url()).pathname === "/", page.url());

await browser.close();
console.log(`\n${failed === 0 ? "all checks passed" : `${failed} check(s) failed`}`);
process.exit(failed);
