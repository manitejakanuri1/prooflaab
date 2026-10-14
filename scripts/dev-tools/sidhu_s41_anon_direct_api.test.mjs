// S41: the direct-API probe must FAIL on any leak, so its PASS means something. OFFLINE.
//   node --test scripts/dev-tools/sidhu_s41_anon_direct_api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { judge, run, TABLES, STABLE_FUNCTIONS } from "./sidhu_s41_anon_direct_api.mjs";

test("refusals and empty answers pass", () => {
  for (const [s, b] of [[401, '{"code":"42501"}'], [400, '{"message":"admin only"}'], [200, "[]"], [200, '{"error":"not a college account"}'],
    [200, '{"season":null}'], [200, "0"], [200, "false"], [200, '{"skills":[],"squads":[]}']]) assert.equal(judge("x", s, b)[0], "PASS", b);
});

test("any row, any personal field, a filled list or a 5xx fails", () => {
  for (const [s, b] of [[200, '[{"id":1}]'], [200, '{"contact":"a@b.co"}'], [200, '{"full_name":"Asha K"}'], [200, '{"squads":[{"id":1}]}'], [502, "bad gateway"]])
    assert.equal(judge("x", s, b)[0], "FAIL", b);
});

test("only the public branch list may return rows, and only its own columns", () => {
  assert.equal(judge("tpo_naming_themes", 200, '[{"theme":"Titans","branch":"CSE","customized":false,"default_theme":"Titans"}]')[0], "PASS");
  assert.equal(judge("tpo_naming_themes", 200, '[{"theme":"Titans","branch":"CSE","college_id":"x"}]')[0], "FAIL");
  assert.equal(judge("tpo_home", 200, '[{"theme":"Titans","branch":"CSE"}]')[0], "FAIL");
});

test("run() reads only: GET for tables, POST {} to functions, never a token", async () => {
  const seen = [];
  await run(async (url, init = {}) => { seen.push([url, init.method ?? "GET", init.headers?.Authorization, init.body]); return new Response("[]", { status: 200 }); });
  assert.equal(seen.length, TABLES.length + STABLE_FUNCTIONS.length);
  assert.ok(seen.every(([, , auth]) => auth === undefined), "no Authorization header");
  assert.ok(seen.filter(([u]) => !u.includes("/rpc/")).every(([u, m]) => m === "GET" && u.includes("limit=1")));
  assert.ok(seen.filter(([u]) => u.includes("/rpc/")).every(([, m, , b]) => m === "POST" && b === "{}"));
});
