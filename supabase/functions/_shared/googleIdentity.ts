// Google service identity, both directions (G11, G12).
//
//   verifyGoogleIdentity  - is this request really from a named Google service account?
//                           (Cloud Scheduler presenting an identity token to a job endpoint)
//   identityTokenFor      - this service's own identity token for another service
//                           (functions calling the code runner behind Cloud Run IAM)
//
// This replaces long-lived shared secrets in request headers: nothing to leak, nothing to
// rotate, and the caller is a specific account rather than "whoever has the string".
import { secretMatches } from "./secret.ts";

const CERTS = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
let keys = new Map<string, CryptoKey>();
let fetchedAt = 0;

function decode(part: string): Uint8Array<ArrayBuffer> {
  const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
  const bin = atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function googleKey(kid: string): Promise<CryptoKey | null> {
  if (!keys.has(kid) && Date.now() - fetchedAt > 60_000) {
    const res = await fetch(CERTS);
    if (res.ok) {
      const next = new Map<string, CryptoKey>();
      for (const k of ((await res.json()).keys ?? []) as Record<string, string>[]) {
        if (k.kty !== "RSA" || !k.kid) continue;
        next.set(k.kid, await crypto.subtle.importKey("jwk", { kty: "RSA", n: k.n, e: k.e, alg: "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
      }
      if (next.size) { keys = next; fetchedAt = Date.now(); }
    }
  }
  return keys.get(kid) ?? null;
}

type KeyFor = (kid: string) => Promise<CryptoKey | null>;

/** The verified service-account email, or null. Null always means "refuse". */
export async function verifyGoogleIdentity(
  token: string, opts: { audience: string; allowed: string[]; keyFor?: KeyFor },
): Promise<string | null> {
  if (!opts.audience || opts.allowed.length === 0) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const key = await (opts.keyFor ?? googleKey)(header.kid);
    if (!key) return null;
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (!ISSUERS.has(payload.iss) || payload.aud !== opts.audience) return null;
    if (payload.email_verified !== true || typeof payload.email !== "string") return null;
    return opts.allowed.includes(payload.email) ? payload.email : null;
  } catch {
    return null;
  }
}

type Env = { get(name: string): string | undefined };

/**
 * May this request start a scheduled job?
 *   - a Google identity token from a listed scheduler account, minted for SCHEDULER_AUDIENCE; or
 *   - the shared webhook secret - unless SCHEDULER_AUTH=oidc, which turns the secret off.
 * Returns who was accepted ("oidc:<account>" or "webhook"), or null.
 */
export async function schedulerCaller(req: Request, env: Env = Deno.env, keyFor?: KeyFor): Promise<string | null> {
  const auth = req.headers.get("Authorization");
  const allowed = (env.get("SCHEDULER_CALLERS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (auth?.startsWith("Bearer ") && allowed.length) {
    const who = await verifyGoogleIdentity(auth.slice(7).trim(),
      { audience: env.get("SCHEDULER_AUDIENCE") ?? "", allowed, keyFor });
    if (who) return `oidc:${who}`;
  }
  if (env.get("SCHEDULER_AUTH") === "oidc") return null;
  return secretMatches(req.headers.get("x-webhook-secret"), env.get("WEBHOOK_SECRET")) ? "webhook" : null;
}

let mine: { audience: string; token: string; expires: number } | null = null;

/** This service's Google identity token for `audience` (another Cloud Run service's URL). */
export async function identityTokenFor(audience: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (mine && mine.audience === audience && mine.expires > Date.now() + 60_000) return mine.token;
  const res = await fetcher(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}`,
    { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) throw new Error(`could not get this service's identity token: ${res.status}`);
  const token = (await res.text()).trim();
  let exp = Date.now() + 50 * 60_000;
  try { exp = JSON.parse(new TextDecoder().decode(decode(token.split(".")[1]))).exp * 1000; } catch { /* keep the default */ }
  mine = { audience, token, expires: exp };
  return token;
}
