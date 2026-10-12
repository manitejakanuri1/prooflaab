// S40: the E2E infrastructure itself (failure bundles, readiness). OFFLINE.
//   node --test scripts/dev-tools/sidhu_s40_e2e_infra.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { failureBundle } from "./sidhu_s32_live_e2e.mjs";
import { requirements, readiness, ROLES } from "./sidhu_s40_e2e_readiness.mjs";

const rows = [
  { role: "tpo", page: "Squads", control: "Assign", class: "WRITE", expectedRoute: "", api: "POST /api/db/rpc/assign_to_squad", status: "FAIL",
    liveResult: "failed for tpo.person@college.test with token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig and password=Hunter2!" },
  { role: "tpo", page: "Home", control: "open", class: "SCREEN", status: "PASS", liveResult: "ok" },
  { role: "admin", page: "People", control: "x", class: "SCREEN", status: "FAIL", liveResult: "other role" },
];

test("failure bundle: only the role's FAIL rows; nothing when the role passed", () => {
  const b = failureBundle({ role: "tpo", rows, url: "https://prooflab-staging.web.app/college/dashboard", net: [], errors: [], html: "" });
  assert.equal(b.failed.length, 1);
  assert.equal(failureBundle({ role: "company", rows, url: "", net: [], errors: [], html: "" }), null);
});

test("failure bundle: no email, token, password, cookie or typed input survives", () => {
  const b = failureBundle({
    role: "tpo", rows, secrets: ["Hunter2!", "tpo.person@college.test"],
    url: "https://prooflab-staging.web.app/college/dashboard?email=tpo.person@college.test",
    net: [{ m: "POST", p: "/api/db/rpc/assign_to_squad", s: 500, t: "application/json" }],
    errors: ["TypeError at line 3 for tpo.person@college.test"],
    html: '<div>tpo.person@college.test</div><input type="password" value="Hunter2!"><textarea>my notes</textarea><span>__session=abc123def</span>',
  });
  const text = JSON.stringify(b);
  for (const secret of ["Hunter2!", "tpo.person@college.test", "eyJhbGciOiJIUzI1NiJ9", "my notes", "abc123def"])
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.deepEqual(b.api_calls, ["POST /api/db/rpc/assign_to_squad 500"], "method, path and status only");
  assert.match(b.reproduce, /--roles tpo/);
});

test("readiness: names come from the workflow; each pass lists what it lacks", () => {
  const req = requirements();
  assert.equal(req.readOnly.length, ROLES.length * 3);
  for (const n of req.readOnly) assert.ok(req.secrets.includes(n), `${n} is read by the workflow`);
  assert.ok(req.destructive.includes("E2E_DISPOSABLE_STUDENT_EMAIL"));
  assert.ok(req.provenance.includes("QA_WIF_PROVIDER") && req.provenance.includes("QA_SERVICE_ACCOUNT"));
  const none = readiness(req, new Set(), new Set(), false);
  assert.equal(none.environment, false);
  assert.equal(none.readOnly.length, 15);
  const all = readiness(req, new Set(req.secrets), new Set(req.vars), true);
  assert.deepEqual([all.readOnly, all.writes, all.destructive, all.provenance], [[], [], [], []]);
});
