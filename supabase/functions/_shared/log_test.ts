import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { scrub, cleanRequestId, subjectOf, hashUser } from "./log.ts";

Deno.test("scrub removes emails, tokens and keys", () => {
  const s = scrub("mail a.b@x.co with Bearer abc.def.ghi and AIzaSyCNv0YWVP5QTDRb4WPVccmosCMC8cH7nnw and sk-abcdefghijklmnop1234");
  assert(!s.includes("a.b@x.co"));
  assert(!s.includes("AIzaSy"));
  assert(!s.includes("sk-abc"));
  assert(s.includes("[email]"));
});

Deno.test("scrub cuts long text", () => {
  const s = scrub("x".repeat(5000), 100);
  assert(s.length < 200);
  assert(s.includes("[cut"));
});

Deno.test("request id: keeps a good one, replaces a bad one", () => {
  assertEquals(cleanRequestId("abcd-1234-efgh"), "abcd-1234-efgh");
  assert(cleanRequestId("bad id with spaces!") !== "bad id with spaces!");
  assert(cleanRequestId(null).length >= 32);
});

Deno.test("subjectOf reads sub from a token without verifying", () => {
  const payload = btoa(JSON.stringify({ sub: "user-123" })).replace(/=/g, "");
  assertEquals(subjectOf(`Bearer h.${payload}.s`), "user-123");
  assertEquals(subjectOf("Bearer nonsense"), null);
  assertEquals(subjectOf(null), null);
});

Deno.test("hashUser is stable and short", async () => {
  const a = await hashUser("user-123");
  assertEquals(a, await hashUser("user-123"));
  assertEquals(a.length, 12);
});
