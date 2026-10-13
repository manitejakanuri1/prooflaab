// Security gate 14 Oct (run-1 P2): a name from a college's student CSV is text in the welcome email, never markup.
// The REAL send-onboarding-email handler runs through functions-service/main.ts as the import calls it (webhook
// secret); the network is stubbed and the email body sent to the provider is captured.
//
//   deno test --no-lock --allow-env --allow-import --allow-read functions-service/onboarding_email_test.ts
for (const [k, v] of Object.entries({
  PGRST_JWT_SECRET: "ci-only-not-a-real-secret-0123456789", BACKEND: "google", POSTGREST_URL: "https://db.test",
  SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "unused", SUPABASE_ANON_KEY: "unused",
  SITE_URL: "https://prooflab.co.in", WEBHOOK_SECRET: "test-webhook", RESEND_API_KEY: "re_test",
  EMAIL_FROM: "ProofLab <noreply@notify.prooflab.co.in>", ALLOWED_ORIGINS: "https://prooflab.co.in",
})) Deno.env.set(k, v);

function assert(ok: unknown, why: string): asserts ok {
  if (!ok) throw new Error(why);
}

const sent: string[] = [];
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);
  if (url.hostname === "metadata.google.internal") return new Response("", { status: 404 });
  if (url.hostname === "api.resend.com") {
    sent.push(await req.text());
    return Response.json({ id: "email-1" });
  }
  if (url.pathname.endsWith("/email_templates")) return new Response("", { status: 406 });  // no saved wording
  return Response.json([]);
}) as typeof fetch;

const { loadAll, router } = await import("./main.ts");
await loadAll();

async function send(name: string, actionLink?: string) {
  sent.length = 0;
  const res = await router(new Request("https://fn.test/send-onboarding-email", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-webhook-secret": "test-webhook" },
    body: JSON.stringify({ userType: "student", email: "s@example.test", name, actionLink }),
  }));
  await res.body?.cancel();
  assert(sent.length === 1, `expected one email, got ${sent.length} (status ${res.status})`);
  return JSON.parse(sent[0]).html as string;
}

Deno.test("a CSV name with markup is escaped in the welcome email", async () => {
  const html = await send('Asha<a href="https://evil.example">Reset your password</a><img src=x onerror=1>');
  assert(!html.includes('<a href="https://evil.example"') && !html.includes("<img src=x"), "markup from the name reached the email");
  assert(html.includes("Asha&lt;a href=&quot;https://evil.example&quot;&gt;"), "the name is not shown as text");
});

Deno.test("control: a plain name and the import's set-password link appear normally", async () => {
  const html = await send("Asha Rao", "https://prooflab-508214.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=abc");
  assert(html.includes("Welcome Asha Rao!"), "plain name missing");
  assert(html.includes('href="https://prooflab-508214.firebaseapp.com/__/auth/action?mode=resetPassword&amp;oobCode=abc"'), "link missing or broken");
});
