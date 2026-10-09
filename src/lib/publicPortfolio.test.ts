import assert from "node:assert/strict";
import test from "node:test";

import { fetchPublicPortfolio } from "./publicPortfolio.ts";

const answer = (body: unknown, status = 200, type = "application/json") =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": type },
    })) as typeof fetch;

test("a published portfolio is read from the public route without a cookie", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seenUrl = String(input);
    seenInit = init;

    return Response.json({
      slug: "asha-k",
      bio: "I build small tools.",
      skills: ["python"],
      achievements: null,
      full_name: "Asha K",
      profile_photo_url: null,
      total_xp: 120,
      work: [{ task_id: "t1", title: "Count failed logins per user" }],
    });
  }) as typeof fetch;

  const portfolio = await fetchPublicPortfolio("asha-k", fetcher);

  assert.equal(seenUrl, "/api/public/portfolio/asha-k");
  assert.equal(seenInit?.credentials, "omit");
  assert.equal(portfolio?.student_profiles.full_name, "Asha K");
  assert.equal(portfolio?.student_profiles.total_xp, 120);
  assert.equal(portfolio?.work.length, 1);
  assert.equal("student_id" in (portfolio ?? {}), false);
});

test("the slug is encoded, never spliced into the path", async () => {
  let seenUrl = "";

  await fetchPublicPortfolio("../db/web_sessions?x=1", (async (input) => {
    seenUrl = String(input);
    return new Response("{}", { status: 404 });
  }) as typeof fetch);

  assert.equal(
    seenUrl,
    "/api/public/portfolio/..%2Fdb%2Fweb_sessions%3Fx%3D1",
  );
});

test("private, unknown and unauthorised answers are all 'no portfolio'", async () => {
  assert.equal(await fetchPublicPortfolio("x", answer({ error: "not found" }, 404)), null);
  assert.equal(await fetchPublicPortfolio("x", answer({ error: "not authenticated" }, 401)), null);
  assert.equal(await fetchPublicPortfolio("x", answer({ error: "down" }, 503)), null);
});

test("the app's HTML page is not mistaken for a portfolio", async () => {
  assert.equal(
    await fetchPublicPortfolio("x", answer("<!doctype html><html></html>", 200, "text/html")),
    null,
  );
  assert.equal(await fetchPublicPortfolio("x", answer({ unexpected: true })), null);
});
