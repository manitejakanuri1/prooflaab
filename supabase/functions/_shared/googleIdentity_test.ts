// G11: who may start a scheduled job.
import { assertEquals } from "jsr:@std/assert@1";
import { schedulerCaller, verifyGoogleIdentity } from "./googleIdentity.ts";

const b64 = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const soon = () => Math.floor(Date.now() / 1000) + 600;
const pair = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const other = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const sign = async (payload: object, key = pair.privateKey) => {
  const body = `${b64(JSON.stringify({ alg: "RS256", kid: "k1" }))}.${b64(JSON.stringify(payload))}`;
  return `${body}.${b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(body))))}`;
};
const keyFor = (kid: string) => Promise.resolve(kid === "k1" ? pair.publicKey : null);
const SA = "scheduler@p.iam.gserviceaccount.com";
const AUD = "https://functions.example";
const good = { iss: "https://accounts.google.com", aud: AUD, exp: soon(), email: SA, email_verified: true };
const env = (v: Record<string, string>) => ({ get: (k: string) => v[k] });
const req = (headers: Record<string, string>) => new Request("https://f/scheduled-job", { method: "POST", headers });

Deno.test("a listed scheduler account, for this audience, signed by Google, is accepted", async () => {
  assertEquals(await verifyGoogleIdentity(await sign(good), { audience: AUD, allowed: [SA], keyFor }), SA);
});

Deno.test("refused: unlisted account, wrong audience, expired, other issuer, other key, no allow-list", async () => {
  const o = { audience: AUD, allowed: [SA], keyFor };
  assertEquals(await verifyGoogleIdentity(await sign({ ...good, email: "x@p.iam.gserviceaccount.com" }), o), null);
  assertEquals(await verifyGoogleIdentity(await sign({ ...good, aud: "https://other" }), o), null);
  assertEquals(await verifyGoogleIdentity(await sign({ ...good, exp: 1 }), o), null);
  assertEquals(await verifyGoogleIdentity(await sign({ ...good, iss: "https://evil" }), o), null);
  assertEquals(await verifyGoogleIdentity(await sign(good, other.privateKey), o), null);
  assertEquals(await verifyGoogleIdentity(await sign(good), { ...o, allowed: [] }), null);
  assertEquals(await verifyGoogleIdentity("not.a.token", o), null);
});

Deno.test("scheduler: identity is accepted; the webhook secret works only until SCHEDULER_AUTH=oidc", async () => {
  const base = { SCHEDULER_CALLERS: SA, SCHEDULER_AUDIENCE: AUD, WEBHOOK_SECRET: "s3cret-s3cret-s3cret" };
  assertEquals(await schedulerCaller(req({ Authorization: `Bearer ${await sign(good)}` }), env(base), keyFor), `oidc:${SA}`);
  assertEquals(await schedulerCaller(req({ "x-webhook-secret": "s3cret-s3cret-s3cret" }), env(base), keyFor), "webhook");
  const strict = env({ ...base, SCHEDULER_AUTH: "oidc" });
  assertEquals(await schedulerCaller(req({ "x-webhook-secret": "s3cret-s3cret-s3cret" }), strict, keyFor), null);
  assertEquals(await schedulerCaller(req({ Authorization: `Bearer ${await sign(good)}` }), strict, keyFor), `oidc:${SA}`);
  assertEquals(await schedulerCaller(req({ Authorization: `Bearer ${await sign({ ...good, email: "x@y" })}` }), strict, keyFor), null);
  assertEquals(await schedulerCaller(req({}), strict, keyFor), null);
  assertEquals(await schedulerCaller(req({ "x-webhook-secret": "wrong" }), env(base), keyFor), null);
});
