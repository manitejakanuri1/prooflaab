// F1: token verification. Every case but the first two is a refusal.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { bridgeServiceToken, resetServiceTokenCache, verifyAppToken } from "./appToken.ts";

const b64 = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const soon = () => Math.floor(Date.now() / 1000) + 600;

async function rsa(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const sign = async (payload: object, header: object = { alg: "RS256", kid }) => {
    const body = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
    return `${body}.${b64(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body))))}`;
  };
  return { sign, jwk: { kty: "RSA", n: jwk.n, e: jwk.e, kid, alg: "RS256", use: "sig" } };
}
async function hs(secret: string, payload: object) {
  const body = `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(payload))}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${body}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))))}`;
}
const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });

Deno.test("RS256 token signed by the bridge key is accepted", async () => {
  const a = await rsa("a");
  const claims = await verifyAppToken(await a.sign({ sub: "u1", role: "authenticated", exp: soon() }),
    env({ APP_JWT_PUBLIC_JWKS: JSON.stringify({ keys: [a.jwk] }) }));
  assertEquals(claims?.sub, "u1");
});

Deno.test("legacy HS256 is accepted only while the legacy secret is configured", async () => {
  const token = await hs("legacy-secret-legacy-secret-legacy!", { sub: "u1", role: "authenticated", exp: soon() });
  assertEquals((await verifyAppToken(token, env({ PGRST_JWT_SECRET: "legacy-secret-legacy-secret-legacy!" })))?.sub, "u1");
  assertEquals(await verifyAppToken(token, env({})), null);
  assertEquals(await verifyAppToken(token, env({ PGRST_JWT_SECRET: "another-secret-another-secret-123456" })), null);
});

Deno.test("refusals: other key, unknown kid, expired, alg none, HS256 signed with the PUBLIC key, oct key in the JWKS", async () => {
  const a = await rsa("a");
  const b = await rsa("a");                       // same kid, different key
  const jwks = JSON.stringify({ keys: [a.jwk] });
  const e = env({ APP_JWT_PUBLIC_JWKS: jwks });
  const good = { sub: "u1", role: "service_role", exp: soon() };
  assertEquals(await verifyAppToken(await b.sign(good), e), null);
  assertEquals(await verifyAppToken(await a.sign(good, { alg: "RS256", kid: "zzz" }), e), null);
  assertEquals(await verifyAppToken(await a.sign({ ...good, exp: 1 }), e), null);
  assertEquals(await verifyAppToken(`${b64(JSON.stringify({ alg: "none" }))}.${b64(JSON.stringify(good))}.`, e), null);
  // Algorithm confusion: an attacker signs HS256 using the published public key text as the secret.
  assertEquals(await verifyAppToken(await hs(jwks, good), e), null);
  assertEquals(await verifyAppToken(await hs(a.jwk.n!, good), e), null);
  // A symmetric key smuggled into the public key list is never used.
  const withOct = env({ APP_JWT_PUBLIC_JWKS: JSON.stringify({ keys: [{ kty: "oct", k: b64("s3cret"), kid: "a" }] }) });
  assertEquals(await verifyAppToken(await a.sign(good), withOct), null);
  assertEquals(await verifyAppToken("garbage", e), null);
});

Deno.test("service token: fetched from the signer with this service's identity, then cached", async () => {
  resetServiceTokenCache();
  const calls: string[] = [];
  const fake = ((url: string, init?: RequestInit) => {
    calls.push(url);
    if (url.startsWith("http://metadata.google.internal")) {
      assert(url.includes("audience=https%3A%2F%2Fbridge.example"));
      return Promise.resolve(new Response("ID.TOKEN"));
    }
    assertEquals((init?.headers as Record<string, string>).Authorization, "Bearer ID.TOKEN");
    return Promise.resolve(Response.json({ access_token: "svc.token", expires_in: 600 }));
  }) as unknown as typeof fetch;
  const e = env({ SIGNER_URL: "https://bridge.example/" });
  assertEquals(await bridgeServiceToken(e, fake), "svc.token");
  assertEquals(await bridgeServiceToken(e, fake), "svc.token");
  assertEquals(calls.length, 2);                                   // second call served from the cache
  assertEquals(await bridgeServiceToken(env({}), fake), null);     // not configured -> legacy path
  resetServiceTokenCache();
});
