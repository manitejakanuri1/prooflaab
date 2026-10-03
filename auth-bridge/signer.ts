// The application signer (F1).
//
// Until now every backend service held the same HS256 secret, so any one of
// them could write a token for any user or for service_role. With
// APP_SIGNING_KEY set, this bridge signs RS256 with a private key that only it
// can read; everyone else verifies with the public half (served at
// /.well-known/jwks.json, and given to PostgREST as its jwt-secret).
//
// Without APP_SIGNING_KEY it behaves exactly as before (HS256 with
// PGRST_JWT_SECRET), so deploying this code changes nothing until the key is
// configured.

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s: string) => b64url(new TextEncoder().encode(s));

export interface PublicJwk { kty: 'RSA'; n: string; e: string; alg: 'RS256'; use: 'sig'; kid: string }

export interface Signer {
  alg: 'RS256' | 'HS256';
  sign(claims: Record<string, unknown>): Promise<string>;
  /** Public keys for verifiers. Empty for HS256: a shared secret has no public half. */
  jwks(): { keys: PublicJwk[] };
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function makeSigner(pem: string, secret: string): Promise<Signer> {
  if (pem.trim()) {
    const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    // Extractable only so the PUBLIC numbers (n, e) can be read out below.
    const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), alg, true, ['sign']);
    const jwk = await crypto.subtle.exportKey('jwk', key);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwk.n!)));
    const kid = Array.from(digest.slice(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const header = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    return {
      alg: 'RS256',
      async sign(claims) {
        const body = `${header}.${b64urlStr(JSON.stringify(claims))}`;
        const sig = await crypto.subtle.sign(alg, key, new TextEncoder().encode(body));
        return `${body}.${b64url(new Uint8Array(sig))}`;
      },
      jwks: () => ({ keys: [{ kty: 'RSA', n: jwk.n!, e: jwk.e!, alg: 'RS256', use: 'sig', kid }] }),
    };
  }

  let hmac: CryptoKey | null = null;
  const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  return {
    alg: 'HS256',
    async sign(claims) {
      hmac ??= await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const body = `${header}.${b64urlStr(JSON.stringify(claims))}`;
      const sig = await crypto.subtle.sign('HMAC', hmac, new TextEncoder().encode(body));
      return `${body}.${b64url(new Uint8Array(sig))}`;
    },
    jwks: () => ({ keys: [] }),
  };
}

// ---------------------------------------------------------------------------
// Service callers: another Cloud Run service proves who it is with the Google
// identity token its own service account gets from the metadata server. No
// shared secret is involved, and a service that is not on the list gets nothing.
// ---------------------------------------------------------------------------

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

function decode(part: string): Uint8Array<ArrayBuffer> {
  const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The verified service-account email, or null. Null always means "refuse". */
export async function verifyServiceCaller(
  token: string,
  opts: { keyFor: (kid: string) => Promise<CryptoKey | null>; audience: string; allowed: string[] },
): Promise<string | null> {
  if (!opts.audience || opts.allowed.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const key = await opts.keyFor(header.kid);
  if (!key) return null;
  let ok = false;
  try {
    ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return null;
  }
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.has(payload.iss)) return null;
  if (payload.aud !== opts.audience) return null;        // minted for THIS bridge, not replayed from elsewhere
  if (payload.email_verified !== true || typeof payload.email !== 'string') return null;
  return opts.allowed.includes(payload.email) ? payload.email : null;
}
