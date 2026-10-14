// Security gate 14 Oct (run-1 P0 resume-parser): a storage path can never leave the folder its caller checked.
// The REAL resume-parser handler runs through functions-service/main.ts; the network is stubbed and Deno.readFile
// is replaced by a recorder, so the test sees exactly which file the server would have read.
//
//   deno test --no-lock --allow-env --allow-import --allow-read functions-service/storage_path_test.ts
const SECRET = "ci-only-not-a-real-secret-0123456789";
for (const [k, v] of Object.entries({
  PGRST_JWT_SECRET: SECRET, BACKEND: "google", POSTGREST_URL: "https://db.test", SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused", SUPABASE_ANON_KEY: "unused", FILES_URL: "https://files.test",
  FILE_GRANT_SECRET: "test-grant", PRIVATE_MOUNT: "/mnt-test/private", PUBLIC_MOUNT: "/mnt-test/public",
  SITE_URL: "https://prooflab.co.in", DEEPSEEK_API_KEY: "test-key", ALLOWED_ORIGINS: "https://prooflab.co.in",
})) Deno.env.set(k, v);

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

const A = "00000000-0000-4000-8000-0000000000a1", B = "00000000-0000-4000-8000-0000000000b2";

const reads: string[] = [];
const realReadFile = Deno.readFile;
// deno-lint-ignore no-explicit-any
(Deno as any).readFile = async (p: string | URL) => {
  const s = String(p);
  if (s.startsWith("/mnt-test/")) { reads.push(s); return new Uint8Array([1, 2, 3]); }
  return await realReadFile(p);
};

globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.hostname === "metadata.google.internal") return new Response("", { status: 404 });
  if (url.hostname !== "db.test") return new Response("provider down (test stand-in)", { status: 503 });
  if (url.pathname.endsWith("rpc/account_is_suspended")) return Response.json(false);
  if (url.pathname.endsWith("rpc/check_rate_limit")) return Response.json({ allowed: true, hits: 1, limit: 100 });
  if (url.pathname.endsWith("/student_profiles")) {
    const row = { id: url.searchParams.get("user_id")?.slice(3) };
    return (req.headers.get("accept") ?? "").includes("vnd.pgrst.object") ? Response.json(row) : Response.json([row]);
  }
  return Response.json([]);
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
const { isSafeObjectPath, createClient } = await import("../supabase/functions/_shared/backend.ts");

async function parse(storage_path: string) {
  reads.length = 0;
  const res = await router(new Request("https://fn.test/resume-parser", {
    method: "POST", body: JSON.stringify({ storage_path }),
    headers: { "Content-Type": "application/json", Origin: "https://prooflab.co.in", Authorization: `Bearer ${await ticket(A)}` },
  }));
  await res.body?.cancel();
  return { status: res.status, reads: [...reads] };
}

Deno.test("resume-parser is loaded", () => assert(!failed.has("resume-parser"), `load failed: ${failed.get("resume-parser")}`));

for (const path of [`${A}/../${B}/cv.docx`, `${A}/./../${B}/cv.pdf`, `${A}//../${B}/cv.docx`, `${A}/x/../../${B}/cv.docx`, `${A}/..\\${B}\\cv.docx`]) {
  Deno.test(`resume-parser: student A asking for ${JSON.stringify(path)} reads no file`, async () => {
    const r = await parse(path);
    assert(r.reads.length === 0, `read ${r.reads.join(", ")}`);
    assert(r.status >= 400, `answered ${r.status}`);
  });
}

Deno.test("control: student A's own resume is read from A's folder", async () => {
  const r = await parse(`${A}/cv.docx`);
  assert(r.reads.length === 1 && r.reads[0] === `/mnt-test/private/resumes/${A}/cv.docx`, `reads: ${r.reads.join(", ")}`);
});

Deno.test("control: a student cannot name another folder directly (existing prefix check)", async () => {
  const r = await parse(`${B}/cv.docx`);
  assert(r.status === 403 && r.reads.length === 0, `answered ${r.status}, reads ${r.reads.join(", ")}`);
});

Deno.test("isSafeObjectPath: refuses traversal shapes, accepts normal object names", () => {
  for (const bad of ["", "/abs/x", "a/../b", "..", "a/./b", "a//b", "a/", "a\\b", "a\0b"]) assert(!isSafeObjectPath(bad), `accepted ${JSON.stringify(bad)}`);
  for (const ok of [`${A}/cv.pdf`, `${A}/1700000000-my..resume.v2.docx`, "a/b/c.webm"]) assert(isSafeObjectPath(ok), `refused ${ok}`);
});

Deno.test("every storage entry point refuses a traversal path (download, remove, upload, signed link)", async () => {
  const s = createClient("https://db.test", "unused").storage.from("voice-explanations");
  reads.length = 0;
  const bad = `${A}/../${B}/v.webm`;
  assert((await s.download(bad)).error?.message === "invalid storage path", "download");
  assert((await s.remove([bad])).error?.message === "invalid storage path", "remove");
  assert((await s.upload(bad, new Uint8Array([1]))).error?.message === "invalid storage path", "upload");
  assert((await s.createSignedUrl(bad, 60)).error?.message === "invalid storage path", "signed link");
  assert(reads.length === 0, "a file was read");
  const good = await s.createSignedUrl(`${A}/v.webm`, 60);
  assert(good.data?.signedUrl.startsWith(`https://files.test/file/voice-explanations/${A}/v.webm?grant=`), "control: signed link for a normal path");
});
