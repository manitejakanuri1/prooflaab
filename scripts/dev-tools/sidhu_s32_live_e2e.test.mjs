// Deterministic tests for the S32 live suite's guards and logic (no network, no browser, no database).
//   node --test scripts/dev-tools/sidhu_s32_live_e2e.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStaging, classify, dbQuery, EXIT, planMatrix, provenance, RECIPES, redact, summarize } from "./sidhu_s32_live_e2e.mjs";
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
  // the known dead / destructive controls are WRITE or UNSURE, never SAFE
  for (const re of [/Delete Account/, /Configure Email Templates/, /Manage Notification Rules/]) {
    const r = rows.find((x) => re.test(x.control)); assert.ok(r, String(re)); assert.notEqual(r.class, "SAFE", r.control);
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
