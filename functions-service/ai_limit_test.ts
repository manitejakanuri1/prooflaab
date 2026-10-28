// MF-055: every AI call is rate limited, and a limiter that cannot answer BLOCKS the call (fails closed).
// Real handlers and the real generateText; only the network is replaced. No real AI call is made.
//
//   deno test --no-lock --allow-env --allow-read --allow-import functions-service/ai_limit_test.ts
const SECRET = "ci-only-not-a-real-secret-0123456789";
for (const [k, v] of Object.entries({
  PGRST_JWT_SECRET: SECRET, BACKEND: "google", POSTGREST_URL: "https://db.test", SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "unused", SUPABASE_ANON_KEY: "unused", DEEPSEEK_API_KEY: "test-key",
  ALLOWED_ORIGINS: "https://prooflab.co.in",
})) Deno.env.set(k, v);

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

/** What the stand-in rate limiter answers: under the limit, over it, a 500, or no answer at all. */
let limiter: "ok" | "over" | "error" | "down" = "ok";
let aiCalls = 0;
globalThis.fetch = (async (input: Request | URL | string) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("metadata.google.internal")) return new Response("", { status: 404 });
  if (url.includes("rpc/account_is_suspended")) return Response.json(false);
  if (url.includes("rpc/check_rate_limit")) {
    if (limiter === "down") throw new TypeError("connection refused");
    if (limiter === "error") return new Response("boom", { status: 500 });
    return Response.json(limiter === "over"
      ? { allowed: false, hits: 7, limit: 6, remaining: 0, retry_after: 42 }
      : { allowed: true, hits: 1, limit: 6, remaining: 5, retry_after: 60 });
  }
  if (url.startsWith("https://api.deepseek.com/")) {
    aiCalls++;
    return Response.json({
      choices: [{ message: { content: "Open Profile, then Resume." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
  }
  if (url.startsWith("https://db.test")) return Response.json([]);
  return Response.json({});
}) as typeof fetch;

const b64 = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sign(claims: Record<string, unknown>) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })), body = b64(JSON.stringify(claims));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(String.fromCharCode(...sig))}`;
}

const { loadAll, router } = await import("./main.ts");
await loadAll();
const { generateText } = await import("../supabase/functions/_shared/llm.ts");
const { RateLimitError } = await import("../supabase/functions/_shared/rate-limit.ts");

const ticket = await sign({ sub: "00000000-0000-4000-8000-0000000000a1", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
const chat = async (message: string) => {
  const res = await router(new Request("https://fn.test/app-guide-chat", {
    method: "POST",
    body: JSON.stringify({ message }),
    headers: { "Content-Type": "application/json", Origin: "https://prooflab.co.in", Authorization: `Bearer ${ticket}` },
  }));
  return { status: res.status, retryAfter: res.headers.get("Retry-After"), body: await res.json() };
};

for (const mode of ["over", "error", "down"] as const) {
  Deno.test(`app-guide-chat: limiter ${mode} -> 429, "try again in a moment", no AI call`, async () => {
    limiter = mode;
    aiCalls = 0;
    const r = await chat(`where is my roadmap (${mode})`);
    assert(r.status === 429, `answered ${r.status}`);
    assert(/try again in a moment/i.test(r.body.error), `message: ${r.body.error}`);
    assert(r.retryAfter !== null, "no Retry-After");
    assert(aiCalls === 0, `${aiCalls} AI calls made`);
  });

  Deno.test(`generateText (every AI feature): limiter ${mode} -> refused before any AI call`, async () => {
    limiter = mode;
    aiCalls = 0;
    let refused: unknown = null;
    try {
      await generateText(`grade this (${mode})`, { cache: false }, { feature: "resume-assessment-submit", userId: "00000000-0000-4000-8000-0000000000a1" });
    } catch (err) {
      refused = err;
    }
    assert(refused instanceof RateLimitError, `not refused: ${refused}`);
    assert(aiCalls === 0, `${aiCalls} AI calls made`);
  });
}

Deno.test("control: under the limit, the chat answers and makes exactly one AI call", async () => {
  limiter = "ok";
  aiCalls = 0;
  const r = await chat("how do I upload my resume (control)");
  assert(r.status === 200, `answered ${r.status}: ${JSON.stringify(r.body)}`);
  assert(aiCalls === 1, `${aiCalls} AI calls`);
});
