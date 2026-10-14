// S40: the anonymous API probe must FAIL on every kind of exposure, so a PASS from it means something. OFFLINE.
//   node --test scripts/dev-tools/sidhu_s40_anon_api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { probes, judge, run, SENSITIVE } from "./sidhu_s40_anon_api.mjs";

const closed = { method: "GET", path: "/api/db/student_profiles", expect: "closed" };

test("every closed contract route and every sensitive address is probed", () => {
  const p = probes();
  for (const path of ["/api/db/student_profiles", "/api/functions/level-open", "/api/accounts/remove", "/api/transcriber/transcribe"])
    assert.ok(p.some((x) => x.path === path && x.expect === "closed"), path);
  assert.equal(p.filter((x) => x.source === "sensitive").length, SENSITIVE.length);
});

test("a closed route that answers data, 200, a redirect or a 5xx is a FAIL; 401/403 is a PASS", () => {
  assert.equal(judge(closed, 401, '{"error":"sign in"}', "none").verdict, "PASS");
  assert.equal(judge(closed, 403, "", "forged").verdict, "PASS");
  for (const [s, b] of [[200, '[{"id":1}]'], [200, "[]"], [302, ""], [500, "oops"], [0, "ECONNRESET"], [401, '[{"id":1}]']])
    assert.equal(judge(closed, s, b, "none").verdict, "FAIL", `${s} ${b}`);
});

test("an error body that leaks internals is a FAIL even when refused", () => {
  for (const b of ["Traceback (most recent call last)", "at handler (file:///app/main.ts:1:1)", "postgres://u:p@h/db", '{"stack":"x"}', "PGRST_JWT_SECRET missing"])
    assert.equal(judge(closed, 401, b, "none").verdict, "FAIL", b);
});

test("open routes: a signed-out session, open signup or a successful anonymous write is a FAIL", () => {
  assert.equal(judge({ method: "GET", path: "/api/auth/session", expect: "open" }, 200, '{"session":{"user":{}}}', "none").verdict, "FAIL");
  assert.equal(judge({ method: "GET", path: "/api/auth/session", expect: "open" }, 200, '{"session":null}', "none").verdict, "PASS");
  assert.equal(judge({ method: "POST", path: "/api/auth/signup", expect: "open" }, 200, "{}", "none").verdict, "FAIL");
  assert.equal(judge({ method: "POST", path: "/api/auth/update", expect: "open" }, 200, "{}", "none").verdict, "FAIL");
  assert.equal(judge({ method: "POST", path: "/api/auth/logout", expect: "open" }, 200, "{}", "none").verdict, "PASS");
});

test("run() sends every probe twice (no credentials, forged token) and never a real credential", async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push([url, init.headers.Authorization ?? null, init.headers.Cookie ?? null]); return new Response('{"error":"x"}', { status: 401 }); };
  const out = await run("https://prooflab-staging.web.app", fetcher);
  assert.equal(out.length, probes().length * 2);
  assert.ok(seen.every(([, , cookie]) => cookie === null), "no cookie is ever sent");
  assert.ok(seen.every(([, auth]) => auth === null || auth.endsWith(".forged")), "only the forged token");
});
