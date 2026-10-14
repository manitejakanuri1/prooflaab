// Security gate 14 Oct (run-1 P0 assign_tasks): the REAL assign_tasks handler, loaded through functions-service/main.ts,
// refuses every out-of-scope request BEFORE it reads student data, calls an AI provider or writes anything.
// Positive controls prove the refusals are not a blanket 403: an admin and an approved, active college targeting
// its own students get past the scope check (they reach the AI provider, which the stand-in fails -> 502).
// Only the network is replaced; tokens are really signed and verified.
//
//   deno test --no-lock --allow-env --allow-read --allow-import functions-service/assign_tasks_scope_test.ts
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

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1), TPO_A = id(2), TPO_B_PENDING = id(3), TPO_SUSPENDED = id(4), COMPANY = id(5), STUDENT_A = id(6);
const COL_A = id(101), COL_B = id(102), COL_S = id(103);
const STU_A1 = id(201), STU_A2 = id(202), STU_B1 = id(203);
const TPL_ADMIN = id(301), TPL_OTHER_COLLEGE = id(302), TPL_OWN = id(303);

// A tiny in-memory PostgREST: eq / in filters, and the single-object Accept header.
const DB: Record<string, Record<string, unknown>[]> = {
  user_roles: [
    { user_id: ADMIN, role: "admin" }, { user_id: TPO_A, role: "college_admin" },
    { user_id: TPO_B_PENDING, role: "college_admin" }, { user_id: TPO_SUSPENDED, role: "college_admin" },
    { user_id: COMPANY, role: "startup" }, { user_id: STUDENT_A, role: "student" },
  ],
  colleges: [
    { id: COL_A, user_id: TPO_A, verification_status: "approved", status: "active" },
    { id: COL_B, user_id: TPO_B_PENDING, verification_status: "pending", status: "active" },
    { id: COL_S, user_id: TPO_SUSPENDED, verification_status: "approved", status: "suspended" },
  ],
  student_profiles: [
    { id: STU_A1, college_id: COL_A, full_name: "A1" }, { id: STU_A2, college_id: COL_A, full_name: "A2" },
    { id: STU_B1, college_id: COL_B, full_name: "B1" },
  ],
  task_templates: [
    { id: TPL_ADMIN, created_by: ADMIN, title: "Admin template", description: "An admin template description." },
    { id: TPL_OTHER_COLLEGE, created_by: TPO_B_PENDING, title: "Other", description: "Another college's private template." },
    { id: TPL_OWN, created_by: TPO_A, title: "Own", description: "This college's own template description." },
  ],
};

function query(url: URL): Record<string, unknown>[] {
  const table = url.pathname.split("/").pop()!;
  let rows = DB[table] ?? [];
  for (const [col, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset"].includes(col)) continue;
    if (raw.startsWith("eq.")) rows = rows.filter((r) => String(r[col]) === raw.slice(3));
    else if (raw.startsWith("in.(")) {
      const set = new Set(raw.slice(4, -1).split(",").map((s) => s.replace(/"/g, "")));
      rows = rows.filter((r) => set.has(String(r[col])));
    }
  }
  return rows;
}

const calls: { method: string; url: string }[] = [];
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  calls.push({ method: req.method.toUpperCase(), url: req.url });
  if (url.hostname === "metadata.google.internal") return new Response("", { status: 404 });
  if (url.hostname !== "db.test") return new Response("provider down (test stand-in)", { status: 503 });
  if (url.pathname.endsWith("rpc/account_is_suspended")) return Response.json(false);
  if (url.pathname.endsWith("rpc/check_rate_limit")) return Response.json({ allowed: true, hits: 1, limit: 100 });
  if (req.method !== "GET") return Response.json([]);
  const rows = query(url);
  if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
    return rows.length === 1 ? Response.json(rows[0]) : Response.json({ code: "PGRST116", message: "0 or many rows" }, { status: 406 });
  }
  return Response.json(rows);
}) as typeof fetch;

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function ticket(sub: string) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(String.fromCharCode(...sig))}`;
}

const { loadAll, router, failed } = await import("./main.ts");
await loadAll();

async function call(who: string, body: Record<string, unknown>) {
  calls.length = 0;
  const res = await router(new Request("https://fn.test/assign_tasks", {
    method: "POST", body: JSON.stringify({ due_date: "2026-12-31", ...body }),
    headers: { "Content-Type": "application/json", Origin: "https://prooflab.co.in", Authorization: `Bearer ${await ticket(who)}` },
  }));
  const text = await res.text();
  const writes = calls.filter((c) => c.method !== "GET" && !/account_is_suspended|check_rate_limit|metadata\.google/.test(c.url));
  const ai = calls.filter((c) => !/db\.test|metadata\.google/.test(c.url));
  const profileReads = calls.filter((c) => c.method === "GET" && c.url.includes("student_profiles") && !c.url.includes("select=id&"));
  return { status: res.status, text, writes, ai, profileReads };
}

function refused(r: Awaited<ReturnType<typeof call>>, status: number, what: string) {
  assert(r.status === status, `${what}: expected ${status}, got ${r.status} ${r.text.slice(0, 160)}`);
  assert(r.writes.length === 0, `${what}: wrote ${r.writes.map((w) => `${w.method} ${w.url}`).join(", ")}`);
  assert(r.ai.length === 0, `${what}: called an AI provider`);
  assert(r.profileReads.length === 0, `${what}: read student profile details`);
}
function reachedAi(r: Awaited<ReturnType<typeof call>>, what: string) {
  assert(r.status !== 403 && r.status !== 400 && r.status !== 401, `${what}: refused ${r.status} ${r.text.slice(0, 160)}`);
  assert(r.ai.length > 0, `${what}: never reached the AI step (status ${r.status})`);
}

const MANUAL = { mode: "manual", title: "Cross tenant", description: "A description of at least twenty characters." };

Deno.test("assign_tasks is loaded", () => assert(!failed.has("assign_tasks"), `load failed: ${failed.get("assign_tasks")}`));

for (const mode of ["manual", "ai", "personalized"]) {
  Deno.test(`${mode}: college A targeting a college-B student -> 403, nothing read, written or sent to AI`, async () => {
    refused(await call(TPO_A, { ...MANUAL, mode, keywords: "react", selected_students: [STU_B1] }), 403, mode);
  });
  Deno.test(`${mode}: college A mixing its own and a foreign student -> 403`, async () => {
    refused(await call(TPO_A, { ...MANUAL, mode, keywords: "react", selected_students: [STU_A1, STU_B1] }), 403, mode);
  });
  Deno.test(`${mode}: an unknown student id -> 403`, async () => {
    refused(await call(TPO_A, { ...MANUAL, mode, keywords: "react", selected_students: [id(999)] }), 403, mode);
  });
}

Deno.test("template: college A cannot assign from another college's private template", async () => {
  refused(await call(TPO_A, { mode: "template", template_id: TPL_OTHER_COLLEGE, selected_students: [STU_A1] }), 403, "template");
});

Deno.test("a college whose approval is pending -> 403 even for its own student", async () => {
  refused(await call(TPO_B_PENDING, { mode: "personalized", selected_students: [STU_B1] }), 403, "pending college");
});

Deno.test("a suspended college -> 403 even for its own students", async () => {
  refused(await call(TPO_SUSPENDED, { mode: "personalized", selected_students: [STU_A1] }), 403, "suspended college");
});

Deno.test("a company (startup) -> 403: no screen calls assign_tasks for companies", async () => {
  refused(await call(COMPANY, { mode: "personalized", selected_students: [STU_A1] }), 403, "company");
});

Deno.test("a student -> 403", async () => {
  refused(await call(STUDENT_A, { mode: "personalized", selected_students: [STU_A1] }), 403, "student");
});

Deno.test("a malformed student list -> 400 before anything else", async () => {
  refused(await call(TPO_A, { mode: "personalized", selected_students: ["x'; drop"] }), 400, "malformed list");
  refused(await call(TPO_A, { mode: "personalized", selected_students: "not-a-list" }), 400, "string list");
});

// Positive controls.
Deno.test("control: college A, its own two students, personalized -> passes scope, reads profiles, reaches AI", async () => {
  const r = await call(TPO_A, { mode: "personalized", selected_students: [STU_A1, STU_A2] });
  reachedAi(r, "own students");
  assert(r.profileReads.length > 0, "own-student profiles were not read");
});
Deno.test("control: college A, AI preview with no students -> reaches AI", async () => {
  reachedAi(await call(TPO_A, { mode: "ai", keywords: "react", selected_students: [] }), "preview");
});
Deno.test("control: college A may use an admin template and its own template", async () => {
  reachedAi(await call(TPO_A, { mode: "template", template_id: TPL_ADMIN, selected_students: [STU_A1] }), "admin template");
  reachedAi(await call(TPO_A, { mode: "template", template_id: TPL_OWN, selected_students: [STU_A1] }), "own template");
});
Deno.test("control: an admin may target students of any college", async () => {
  reachedAi(await call(ADMIN, { mode: "personalized", selected_students: [STU_A1, STU_B1] }), "admin");
});
