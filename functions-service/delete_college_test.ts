// 13 Oct: Admin -> Colleges -> Delete college removes the college AND its admin's role and login (so the email can be
// used again), refuses while students remain, and is admin-only. "Add college" answers a clear 409 when the email
// already has a login. The REAL handlers run through functions-service/main.ts; database and accounts are stand-ins.
//
//   deno test --no-lock --allow-env --allow-import --allow-read functions-service/delete_college_test.ts
const SECRET = "ci-only-not-a-real-secret-0123456789";
for (const [k, v] of Object.entries({
  PGRST_JWT_SECRET: SECRET, BACKEND: "google", POSTGREST_URL: "https://db.test", SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused", SUPABASE_ANON_KEY: "unused", ACCOUNTS_URL: "https://accounts.test",
  WEBHOOK_SECRET: "test-webhook", SITE_URL: "https://prooflab.co.in", ALLOWED_ORIGINS: "https://prooflab.co.in",
})) Deno.env.set(k, v);

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1), TPO_EMPTY = id(2), TPO_FULL = id(3), TPO_ORPHAN = id(4), TPO_TWO = id(5), STUDENT = id(6);
const C_EMPTY = id(101), C_FULL = id(102), C_TWO_A = id(103), C_TWO_B = id(104);

let DB: Record<string, Record<string, unknown>[]> = {};
function reset() {
  DB = {
    user_roles: [
      { user_id: ADMIN, role: "admin" }, { user_id: TPO_EMPTY, role: "college_admin" }, { user_id: TPO_FULL, role: "college_admin" },
      { user_id: TPO_ORPHAN, role: "college_admin" }, { user_id: TPO_TWO, role: "college_admin" }, { user_id: STUDENT, role: "student" },
    ],
    colleges: [
      { id: C_EMPTY, user_id: TPO_EMPTY, name: "Empty College" }, { id: C_FULL, user_id: TPO_FULL, name: "Full College" },
      { id: C_TWO_A, user_id: TPO_TWO, name: "Two A" }, { id: C_TWO_B, user_id: TPO_TWO, name: "Two B" },
    ],
    student_profiles: [{ id: id(201), college_id: C_FULL }, { id: id(202), college_id: C_FULL }],
  };
}

function matches(url: URL) {
  const table = url.pathname.split("/").pop()!;
  return (DB[table] ?? []).filter((r) => [...url.searchParams].every(([col, raw]) =>
    ["select", "order", "limit", "offset"].includes(col) || !raw.startsWith("eq.") || String(r[col]) === raw.slice(3)));
}

const writes: string[] = [];
let accountsAnswer: () => Response = () => Response.json({ deleted: true });
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.hostname === "metadata.google.internal") return new Response("", { status: 404 });
  if (url.hostname === "accounts.test") {
    writes.push(`${req.method} accounts${url.pathname} ${await req.text()}`);
    return accountsAnswer();
  }
  if (url.pathname.endsWith("rpc/account_is_suspended")) return Response.json(false);
  if (url.pathname.endsWith("rpc/check_rate_limit")) return Response.json({ allowed: true, hits: 1, limit: 100 });
  const table = url.pathname.split("/").pop()!;
  const rows = matches(url);
  if (req.method === "DELETE") {
    writes.push(`DELETE ${table}`);
    DB[table] = (DB[table] ?? []).filter((r) => !rows.includes(r));
    return new Response(null, { status: 204 });
  }
  if (req.method === "HEAD" || (req.headers.get("prefer") ?? "").includes("count=exact")) {
    return new Response(req.method === "HEAD" ? null : "[]", { status: 200, headers: { "Content-Range": `*/${rows.length}` } });
  }
  if ((req.headers.get("accept") ?? "").includes("vnd.pgrst.object")) {
    return rows.length === 1 ? Response.json(rows[0]) : Response.json({ code: "PGRST116" }, { status: 406 });
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

async function call(slug: string, who: string, body: Record<string, unknown>) {
  writes.length = 0;
  const res = await router(new Request(`https://fn.test/${slug}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", Origin: "https://prooflab.co.in", Authorization: `Bearer ${await ticket(who)}` },
  }));
  return { status: res.status, out: await res.json().catch(() => ({})), writes: [...writes] };
}

Deno.test("delete-college is loaded", () => assert(!failed.has("delete-college"), `load failed: ${failed.get("delete-college")}`));

Deno.test("a non-admin cannot delete a college: 403, nothing deleted", async () => {
  reset();
  for (const who of [STUDENT, TPO_EMPTY]) {
    const r = await call("delete-college", who, { college_id: C_EMPTY });
    assert(r.status === 403 && r.writes.length === 0, `${who}: ${r.status} ${r.writes}`);
  }
});

Deno.test("a college with students is refused: 409, nothing deleted", async () => {
  reset();
  const r = await call("delete-college", ADMIN, { college_id: C_FULL });
  assert(r.status === 409 && /still has 2 students/.test(r.out.error) && r.writes.length === 0, JSON.stringify(r));
});

Deno.test("an empty college: college row, admin role, then the admin's login are deleted (email reusable)", async () => {
  reset();
  const r = await call("delete-college", ADMIN, { college_id: C_EMPTY });
  assert(r.status === 200 && r.out.college_deleted && r.out.login_deleted, JSON.stringify(r));
  assert(r.writes[0] === "DELETE colleges" && r.writes[1] === "DELETE user_roles", r.writes.join(" | "));
  assert(r.writes[2].startsWith("POST accounts/delete-user") && r.writes[2].includes(TPO_EMPTY), r.writes.join(" | "));
});

Deno.test("a leftover college admin (college already gone): role and login deleted", async () => {
  reset();
  const r = await call("delete-college", ADMIN, { user_id: TPO_ORPHAN });
  assert(r.status === 200 && r.out.login_deleted && r.writes.join("|").includes(`delete-user {"user_id":"${TPO_ORPHAN}"}`), JSON.stringify(r));
});

Deno.test("never deletes a login that still owns a college, or that is not a college admin", async () => {
  reset();
  for (const user_id of [TPO_TWO, STUDENT, ADMIN]) {
    const r = await call("delete-college", ADMIN, { user_id });
    assert(r.status === 409 && r.writes.length === 0, `${user_id}: ${JSON.stringify(r)}`);
  }
  const r = await call("delete-college", ADMIN, { college_id: C_TWO_A });
  assert(r.status === 200 && r.out.college_deleted && !r.out.login_deleted && !r.writes.join("|").includes("delete-user"),
    `owner still has Two B: ${JSON.stringify(r)}`);
});

Deno.test("the login delete failing is reported, not hidden", async () => {
  reset();
  accountsAnswer = () => Response.json({ error: "account is no longer empty; refusing login rollback" }, { status: 409 });
  try {
    const r = await call("delete-college", ADMIN, { college_id: C_EMPTY });
    assert(r.status === 200 && r.out.college_deleted && !r.out.login_deleted && /no longer empty/.test(r.out.note), JSON.stringify(r));
  } finally {
    accountsAnswer = () => Response.json({ deleted: true });
  }
});

Deno.test("add college: an email that already has a login -> clear 409, not a vague 500", async () => {
  reset();
  accountsAnswer = () => Response.json({ error: "An account with this email already exists" }, { status: 409 });
  try {
    const r = await call("create-college-user", ADMIN, { name: "TEJA", email: "taken@example.test", status: "active" });
    assert(r.status === 409 && /already has a ProofLab login/.test(r.out.error), JSON.stringify(r));
  } finally {
    accountsAnswer = () => Response.json({ deleted: true });
  }
});
