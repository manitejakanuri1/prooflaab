// STAGING app tokens, signed exactly the way the staging auth-bridge signs them (F1: RS256 with
// the key in Secret Manager `prooflab-staging-app-signing-key`, kid = first 16 hex of sha256(n)).
// Read at run time, never printed or stored. Staging only: production keys are not readable here.
//
//   import { mintStaging, stagingSession } from "./staging_token.mjs";
//   mintStaging({ role: "service_role", sub: "my-check" }, 3600)          // database reads
//   stagingSession(userId, email)                                          // browser sign-in object
import { createHash, createPublicKey, createSign } from "node:crypto";
import { execSync } from "node:child_process";

let pem = null;
const key = () =>
  (pem ??= execSync("gcloud secrets versions access latest --secret=prooflab-staging-app-signing-key", { encoding: "utf8" }));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** A signed staging token carrying `claims`, valid for `ttl` seconds. */
export function mintStaging(claims, ttl = 3600) {
  const k = key();
  const kid = createHash("sha256").update(createPublicKey(k).export({ format: "jwk" }).n).digest("hex").slice(0, 16);
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", typ: "JWT", kid });
  const p = b64({ ...claims, iat: now, exp: now + ttl });
  return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(k).toString("base64url")}`;
}

/** The session object the website keeps in localStorage ('prooflab.auth.google') for a signed-in user. */
export function stagingSession(id, email, ttl = 3600) {
  const token = mintStaging({ sub: id, role: "authenticated", email, email_confirmed: true }, ttl);
  const now = new Date().toISOString();
  const exp = Math.floor(Date.now() / 1000) + ttl;
  return {
    access_token: token, refresh_token: "staging-test-no-refresh", expires_in: ttl, expires_at: exp,
    token_type: "bearer", provider_token: "",
    user: { id, aud: "authenticated", role: "authenticated", email, email_confirmed_at: now, phone: "",
            created_at: now, updated_at: now, last_sign_in_at: now, app_metadata: {}, user_metadata: {}, identities: [] },
  };
}
