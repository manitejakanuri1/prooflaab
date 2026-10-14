// Deterministic tests for the S32 live suite's guards and logic (no network, no browser, no database).
//   node --test scripts/dev-tools/sidhu_s32_live_e2e.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStaging, classify, dbQuery, emailDelivery, EXIT, planMatrix, PROTECTED_NOTICES, provenance, RECIPES, redact, revisionProvenance, summarize } from "./sidhu_s32_live_e2e.mjs";
import { buildInventory } from "./sidhu_s32_inventory.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const inv = buildInventory();

test("only the staging site over https; production always refused", () => {
  assert.equal(assertStaging("https://prooflab-staging.web.app/x"), "https://prooflab-staging.web.app");
  for (const b of ["https://prooflab.co.in", "https://www.prooflab.co.in", "https://prooflab-508214.web.app", "http://prooflab-staging.web.app", "https://evil.example", "https://prooflab-staging.web.app.evil.example"]) {
    assert.throws(() => assertStaging(b), undefined, b);
  }
});

test("redaction removes emails, tokens, cookie values and given secrets", () => {
  const s = redact("a.b@c.io pw Hunter22! __session=abc123 eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.x", ["Hunter22!"]);
  assert.ok(!/a\.b@c\.io|Hunter22!|abc123|eyJhbGci/.test(s), s);
});

test("classification never auto-clicks anything that writes or might write", () => {
  assert.equal(classify({ label: "Members", element: "TabsTrigger", handler: "", calls: [] }), "SAFE");
  assert.equal(classify({ label: "Filters", handler: "() => setOpen(true)", calls: [] }), "SAFE");
  assert.equal(classify({ label: "Delete Account", handler: "", calls: [] }), "WRITE");                       // by label
  assert.equal(classify({ label: "Go", handler: "doIt", calls: [{ kind: "rpc", name: "tpo_send_reminder" }] }), "WRITE");
  assert.equal(classify({ label: "Go", handler: "x", calls: [{ kind: "function", name: "submit-written-task" }] }), "WRITE");
  assert.equal(classify({ label: "Go", handler: "x", calls: [{ kind: "table", name: "tasks", ops: ["insert"] }] }), "WRITE");
  assert.equal(classify({ label: "Open", handler: "() => void openProfile(c.id)", calls: [{ kind: "rpc", name: "recruiter_proof_profile" }] }), "READ");
  assert.equal(classify({ label: "Open", handler: "() => void doShortlist()", calls: [] }), "UNSURE");          // untraced helper: not auto-clicked
});

test("every inventory control of the real source is in the plan, none counted as PASS", () => {
  const rows = planMatrix(inv);
  assert.ok(rows.length > 400);
  assert.equal(rows.filter((r) => r.status.startsWith("PASS")).length, 0);
  for (const role of ["admin", "tpo", "company", "student", "established"]) assert.ok(rows.some((r) => r.role === role), role);
  // S34 wired the former dead buttons: the dialog openers are safe, the account deletion is never auto-clicked,
  // and none of them is still a handler-less (DEAD) control.
  const del = rows.find((x) => /Delete Account \[student\/DeleteAccountDialog/.test(x.control));
  assert.ok(del, "student Delete Account row"); assert.equal(del.class, "WRITE", del.control);
  for (const re of [/Configure Email Templates/, /Manage Notification Rules/]) {
    const r = rows.find((x) => re.test(x.control)); assert.ok(r, String(re)); assert.equal(r.class, "SAFE", r.control);
  }
  const confirm = rows.find((x) => /Delete my account.*DeleteAccountDialog/.test(x.control));
  assert.ok(confirm, "the confirm button"); assert.equal(confirm.class, "WRITE", confirm.control);
  for (const re of [/Delete Account \[student/, /Configure Email Templates/, /Manage Notification Rules/]) {
    assert.equal(rows.filter((x) => x.class === "DEAD" && re.test(x.control)).length, 0, `still dead: ${re}`);
  }
});

test("db-verify accepts exactly one SELECT and runs it read-only through staging_sql.sh", () => {
  for (const bad of ["delete from tasks", "select 1; delete from tasks", "update x set a=1", "select 1; select 2"]) {
    assert.throws(() => dbQuery(bad, { run: () => ({ status: 0, stdout: "S32DB 1" }) }), /one SELECT/, bad);
  }
  let seen = "";
  const got = dbQuery("select 'S32DB ' || 1;", { run: (cmd, args) => { seen = args.join(" "); return { status: 0, stdout: "x\nS32DB 1\nROLLBACK\n" }; } });
  assert.equal(got, "1");
  assert.match(seen, /staging_sql\.sh/);
  assert.throws(() => dbQuery("select 1;", { run: () => ({ status: 1, stdout: "" }) }), /staging read failed/);
});

test("every write recipe proves its effect with a single SELECT", () => {
  const x = { env: Object.fromEntries(RECIPES.flatMap((r) => r.fixtures).map((f) => [f, "00000000-0000-4000-8000-000000000000"])), runId: "20261010", userId: "00000000-0000-4000-8000-000000000001" };
  for (const r of RECIPES) {
    const sql = r.db(x);
    assert.match(sql, /^select 'S32DB '/, r.id);
    assert.doesNotThrow(() => dbQuery(sql, { run: () => ({ status: 0, stdout: "S32DB 1" }) }), r.id);
  }
});

test("provenance: live entry compared with the expected build", async () => {
  const fake = (entry) => async () => ({ text: async () => `<script type="module" src="/assets/${entry}"></script>` });
  assert.equal((await provenance("https://s", "index-A.js", fake("index-A.js"))).status, "VERIFIED");
  assert.equal((await provenance("https://s", "index-A.js", fake("index-B.js"))).status, "MISMATCH");
  assert.equal((await provenance("https://s", undefined, fake("index-B.js"))).status, "UNVERIFIED");
});

test("exit codes: wrong build beats everything; FAIL beats incomplete; untested is never OK", () => {
  assert.equal(summarize([{ status: "PASS" }], { status: "MISMATCH" }).exit, EXIT.WRONG_BUILD);
  assert.equal(summarize([{ status: "PASS" }, { status: "FAIL" }], { status: "VERIFIED" }).exit, EXIT.FAIL);
  assert.equal(summarize([{ status: "PASS" }, { status: "BLOCKED" }], { status: "VERIFIED" }).exit, EXIT.INCOMPLETE);
  assert.equal(summarize([{ status: "NOT_TESTED" }], { status: "VERIFIED" }).exit, EXIT.INCOMPLETE);
  assert.equal(summarize([{ status: "PASS" }], { status: "VERIFIED" }).exit, EXIT.OK);
});

const node = (args, env = {}) => spawnSync(process.execPath, [join(HERE, "sidhu_s32_live_e2e.mjs"), ...args], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env }, encoding: "utf8", timeout: 120000 });
test("CLI: refuses production and refuses without --confirm-staging (exit 3); plan mode is incomplete (exit 2)", () => {
  assert.equal(node(["--anon", "--confirm-staging"], { E2E_BASE: "https://prooflab.co.in" }).status, EXIT.REFUSED);
  assert.equal(node(["--anon"]).status, EXIT.REFUSED);
  const p = node(["--plan", "--out", join(HERE, "../../e2e-out/s32/test-plan")]);
  assert.equal(p.status, EXIT.INCOMPLETE, p.stdout + p.stderr);
  assert.match(p.stdout, /PLAN: \d+ rows/);
});

// ---------------------------------------------------------------- S34 additions
test("S34: Firebase preview channels of the staging site are staging; look-alikes are not", () => {
  assert.equal(assertStaging("https://prooflab-staging--s34-abc123.web.app/"), "https://prooflab-staging--s34-abc123.web.app");
  for (const b of ["https://prooflab-stagingx--s34.web.app", "https://prooflab--s34.web.app", "https://prooflab-508214--s34.web.app", "http://prooflab-staging--s34.web.app"]) {
    assert.throws(() => assertStaging(b), undefined, b);
  }
});

test("S34: backend provenance needs every expected revision at 100% traffic", () => {
  const gcloud = (traffic) => () => ({ status: 0, stdout: JSON.stringify({ status: { traffic } }) });
  assert.equal(revisionProvenance(undefined).status, "UNVERIFIED");
  assert.equal(revisionProvenance("functions=prooflab-staging-functions-00079-voc", { run: gcloud([{ revisionName: "prooflab-staging-functions-00079-voc", percent: 100 }]) }).status, "VERIFIED");
  const canary = revisionProvenance("functions=prooflab-staging-functions-00079-voc", { run: gcloud([{ revisionName: "prooflab-staging-functions-00075-git", percent: 100 }, { revisionName: "prooflab-staging-functions-00079-voc", percent: 0, tag: "s34" }]) });
  assert.equal(canary.status, "MISMATCH", "a 0%-traffic canary is not the deployed build");
  assert.match(canary.detail, /00075-git=100%/);
  assert.equal(revisionProvenance("functions=x", { run: () => ({ status: 1, stdout: "" }) }).status, "UNVERIFIED");
  assert.equal(revisionProvenance("functions=bad name;rm", { run: gcloud([]) }).status, "UNVERIFIED");
});

test("S34: an unverified build can never exit OK, even if every row passed", () => {
  assert.equal(summarize([{ status: "PASS" }], { status: "UNVERIFIED" }).exit, EXIT.INCOMPLETE);
  assert.equal(summarize([{ status: "PASS" }], null).exit, EXIT.INCOMPLETE);
});

test("S34: twelve recipes; the account deletion is destructive and needs its own disposable identity", () => {
  assert.ok(RECIPES.length >= 14);
  const del = RECIPES.find((r) => r.id === "student-delete-own-account");
  assert.equal(del.destructive, true);
  assert.deepEqual(del.fixtures, ["E2E_DISPOSABLE_STUDENT_EMAIL", "E2E_DISPOSABLE_STUDENT_PASSWORD", "E2E_DISPOSABLE_STUDENT_USER_ID"]);
  assert.equal(RECIPES.filter((r) => r.destructive).length, 1, "only the deletion is destructive");
});

test("S34: every recipe covers at least one real control of the S34 source", () => {
  const rows = planMatrix(inv);
  for (const r of RECIPES) {
    assert.ok(rows.some((x) => r.role.includes(x.role) && r.matches.test(x.control)), r.id);
  }
});

// ---------------------------------------------------------------- S36 additions
test("S36: test-email delivery is PASS only when the provider reports 'delivered'", async () => {
  const res = (status, body) => async () => ({ status, ok: status < 300, json: async () => body });
  const none = async () => {};
  assert.match(await emailDelivery("abcd1234-0000", {}), /^BLOCKED: .*not verified/);
  assert.match(await emailDelivery("abcd1234-0000", { E2E_RESEND_READ_KEY: "k" }, { fetchImpl: res(200, { last_event: "delivered" }), sleep: none }), /delivered/);
  await assert.rejects(emailDelivery("abcd1234-0000", { E2E_RESEND_READ_KEY: "k" }, { fetchImpl: res(200, { last_event: "bounced" }), sleep: none }), /not delivered: bounced/);
  assert.match(await emailDelivery("abcd1234-0000", { E2E_RESEND_READ_KEY: "k" }, { fetchImpl: res(200, { last_event: "sent" }), sleep: none, tries: 2 }), /^BLOCKED: .*last event: sent/);
  assert.match(await emailDelivery("abcd1234-0000", { E2E_RESEND_READ_KEY: "k" }, { fetchImpl: res(403, {}), sleep: none }), /^BLOCKED/);
  await assert.rejects(emailDelivery("../x", { E2E_RESEND_READ_KEY: "k" }), /invalid message id/);
});

test("S36: the recipes cover the protected-notice refusal and the real test email; the deletion checks the S36 answer", () => {
  assert.ok(RECIPES.find((r) => r.id === "admin-notification-protected-refused"));
  const send = RECIPES.find((r) => r.id === "admin-email-send-test");
  assert.ok(send && !send.destructive);
  assert.deepEqual(PROTECTED_NOTICES, ["review_outcome", "sponsored_task", "college_linked"]);
  const del = String(RECIPES.find((r) => r.id === "student-delete-own-account").run);
  assert.match(del, /login_deleted !== true/, "checks the S36 response field, not the old login_failures");
  assert.match(del, /Nothing was changed/, "reports staging's safe refusal as BLOCKED, not PASS");
  assert.match(RECIPES.find((r) => r.id === "student-delete-own-account").db({ env: { E2E_DISPOSABLE_STUDENT_USER_ID: "u" } }), /login_deleted_at is not null/);
});
