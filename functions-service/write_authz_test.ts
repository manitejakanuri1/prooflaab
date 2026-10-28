// S41: every server function behind a website WRITE action refuses callers it must refuse, BEFORE it writes anything
// or spends money on an AI call. The REAL handlers are loaded through functions-service/main.ts (loadAll + router);
// only the network is replaced: every outbound call is recorded and answered by a stand-in. Tokens are really signed
// (HS256 with the test secret), so the real verification in _shared/appToken.ts decides.
//
//   deno test --no-lock --allow-env --allow-read --allow-import functions-service/write_authz_test.ts
const SECRET = "ci-only-not-a-real-secret-0123456789";
for (const [k, v] of Object.entries({
  PGRST_JWT_SECRET: SECRET, BACKEND: "google", POSTGREST_URL: "https://db.test", SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused", SUPABASE_ANON_KEY: "unused", FILES_URL: "https://files.test",
  ACCOUNTS_URL: "https://accounts.test", SITE_URL: "https://prooflab.co.in", DEEPSEEK_API_KEY: "test-key",
  WEBHOOK_SECRET: "test-webhook", ALLOWED_ORIGINS: "https://prooflab.co.in",
})) Deno.env.set(k, v);

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

const calls: { method: string; url: string; body: string }[] = [];
const roles: Record<string, string> = {};
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  calls.push({ method, url, body: typeof init?.body === "string" ? init.body : "" });
  if (url.includes("metadata.google.internal")) return new Response("", { status: 404 });
  if (url.includes("rpc/account_is_suspended")) return Response.json(false);
  if (url.includes("rpc/check_rate_limit")) return Response.json({ allowed: true, hits: 1, limit: 100 });
  if (url.includes("user_roles")) {
    const id = (url.match(/user_id=eq\.([0-9a-f-]{36})/) ?? [])[1];
    return Response.json(id && roles[id] ? [{ role: roles[id], user_id: id }] : []);
  }
  if (url.startsWith("https://db.test")) return Response.json([]);
  return Response.json({});
}) as typeof fetch;

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(claims: Record<string, unknown>, secret = SECRET) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), body = b64(JSON.stringify(claims));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(String.fromCharCode(...sig))}`;
}

const { loadAll, router, failed } = await import("./main.ts");
await loadAll();

const STUDENT = "00000000-0000-4000-8000-0000000000a1";
roles[STUDENT] = "student";
const now = Math.floor(Date.now() / 1000);
const BAD: Record<string, string | null> = {
  "no ticket": null,
  "a garbage ticket": "not.a.token",
  "a ticket signed with another key": await sign({ sub: STUDENT, role: "authenticated", exp: now + 600 }, "some-other-secret-0123456789"),
  "an expired ticket": await sign({ sub: STUDENT, role: "authenticated", exp: now - 60 }),
  "a ticket with no person in it": await sign({ role: "authenticated", exp: now + 600 }),
};
const studentTicket = await sign({ sub: STUDENT, role: "authenticated", exp: now + 600, email: "s@x.test" });
const BODY = JSON.stringify({ email: "new@x.test", full_name: "N", password: "Xx123456!", college_name: "C", code: "print(1)",
  language: "python", task_id: "00000000-0000-4000-8000-0000000000b1", level_id: "00000000-0000-4000-8000-0000000000c1",
  answers: [], student_ids: [STUDENT], message: "hi", events: [], interests: [] });

async function call(slug: string, ticket: string | null, body = BODY) {
  calls.length = 0;
  const res = await router(new Request(`https://fn.test/${slug}`, {
    method: "POST", body,
    headers: { "Content-Type": "application/json", Origin: "https://prooflab.co.in", ...(ticket ? { Authorization: `Bearer ${ticket}` } : {}) },
  }));
  const text = await res.text();
  const writes = calls.filter((c) => c.method !== "GET" && !/account_is_suspended|check_rate_limit|metadata\.google/.test(c.url));
  const ai = calls.filter((c) => !/db\.test|files\.test|accounts\.test|metadata\.google/.test(c.url));
  return { status: res.status, text, writes, ai };
}

// Every website write action served by a function (S41: 23 had no test anywhere).
const SIGNED_IN_ONLY = ["app-guide-chat", "assign_tasks", "client-log", "company-lot", "company-voice-play", "create-admin-user",
  "create-college-user", "create-company-user", "interests-analyze", "level-quiz-submit", "levels-place", "lot-writer",
  "mock-interview-generate", "mock-interview-score", "resume-assessment-submit", "resume-code-execute", "resume-coding-generate",
  "resume-improve", "resume-question-generator", "run-sandbox", "task-explain"];
const NOT_FOR_STUDENTS = ["assign_tasks", "company-lot", "create-admin-user", "create-college-user", "create-company-user"];

Deno.test("every function under test is loaded by the service", () => {
  for (const slug of [...SIGNED_IN_ONLY, "security-log"]) assert(!failed.has(slug), `${slug} failed to load: ${failed.get(slug)}`);
});

for (const slug of SIGNED_IN_ONLY) {
  for (const [who, ticket] of Object.entries(BAD)) {
    Deno.test(`${slug}: ${who} -> 401, nothing written, no AI call`, async () => {
      const r = await call(slug, ticket);
      assert(r.status === 401, `${slug} answered ${r.status} ${r.text.slice(0, 120)} to ${who}`);
      assert(r.writes.length === 0, `${slug} wrote for ${who}: ${r.writes.map((w) => `${w.method} ${w.url}`).join(", ")}`);
      assert(r.ai.length === 0, `${slug} called out for ${who}: ${r.ai.map((w) => w.url).join(", ")}`);
    });
  }
}

for (const slug of NOT_FOR_STUDENTS) {
  Deno.test(`${slug}: a signed-in STUDENT -> 403, nothing written, no AI call`, async () => {
    const r = await call(slug, studentTicket);
    assert(r.status === 403, `${slug} answered ${r.status} ${r.text.slice(0, 120)} to a student`);
    assert(r.writes.length === 0 && r.ai.length === 0, `${slug} acted for a student`);
  });
}

Deno.test("control: a valid student ticket gets past the ticket check of the student functions (the 401s above are real)", async () => {
  for (const slug of SIGNED_IN_ONLY.filter((s) => !NOT_FOR_STUDENTS.includes(s))) {
    const r = await call(slug, studentTicket);
    assert(r.status !== 401, `${slug} refused a valid student ticket: ${r.status} ${r.text.slice(0, 120)}`);
  }
});

Deno.test("security-log (signed-out by design): only the closed list of events is recorded, one row each", async () => {
  const unknown = await call("security-log", null, JSON.stringify({ event_type: "drop_table_users", detail: "x" }));
  assert(unknown.writes.length === 0, `an unknown event was written: ${unknown.writes.map((w) => w.url).join(", ")}`);
  const known = await call("security-log", null, JSON.stringify({ event_type: "login_failed", reason: "invalid_credentials", email: "a@b.test" }));
  assert(known.status < 300, `login_failed answered ${known.status}`);
  const logged = known.writes.filter((w) => w.url.endsWith("rpc/log_security_event"));
  assert(logged.length === 1, `expected one log_security_event, got ${known.writes.map((w) => w.url).join(", ")}`);
  assert(/"p_event_type":"login_failed"/.test(logged[0].body), "the event name is the one from the closed list");
});
