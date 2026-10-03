// Verifying an application token (F1) and obtaining a service token.
//
// The auth-bridge is the only signer. Everyone else VERIFIES:
//   RS256 - against the bridge's public keys, given as APP_JWT_PUBLIC_JWKS
//           (public, not a secret; the same JSON PostgREST is started with);
//   HS256 - only while the legacy PGRST_JWT_SECRET is still configured on this
//           service. Remove that variable and HS256 is refused outright.
//
// files-service/appToken.ts is a byte-for-byte copy (its image is built from its
// own folder); CI fails if the two differ.

type Env = { get(name: string): string | undefined };

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const rsaKeys = new Map<string, Promise<Map<string, CryptoKey>>>();
function publicKeys(jwks: string): Promise<Map<string, CryptoKey>> {
  let p = rsaKeys.get(jwks);
  if (!p) {
    p = (async () => {
      const out = new Map<string, CryptoKey>();
      try {
        for (const k of (JSON.parse(jwks).keys ?? []) as Record<string, string>[]) {
          if (k.kty !== 'RSA' || !k.kid || !k.n || !k.e) continue;   // public RSA keys only; never an oct key
          out.set(k.kid, await crypto.subtle.importKey('jwk',
            { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
            { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
        }
      } catch {
        console.error('APP_JWT_PUBLIC_JWKS is not valid JSON - RS256 tokens will be refused');
      }
      return out;
    })();
    rsaKeys.set(jwks, p);
  }
  return p;
}

/** The verified claims, or null. Null is always "refuse". Checks signature, algorithm and expiry. */
export async function verifyAppToken(token: string, env: Env = Deno.env): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromB64(parts[1])));
  } catch {
    return null;
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let ok = false;
  try {
    if (header.alg === 'RS256') {
      const jwks = env.get('APP_JWT_PUBLIC_JWKS') ?? '';
      const key = jwks && typeof header.kid === 'string' ? (await publicKeys(jwks)).get(header.kid) : undefined;
      if (!key) return null;
      ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64(parts[2]), signed);
    } else if (header.alg === 'HS256') {
      const secret = env.get('PGRST_JWT_SECRET') ?? '';
      if (!secret) return null;
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
      ok = await crypto.subtle.verify('HMAC', key, fromB64(parts[2]), signed);
    }
  } catch {
    return null;
  }
  if (!ok) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

let cached: { token: string; expires: number } | null = null;

/**
 * A short-lived service_role token from the bridge, or null when SIGNER_URL is
 * not set (the caller then falls back to its legacy self-signed token).
 * This service proves who it is with its own Google identity token - no shared secret.
 */
export async function bridgeServiceToken(env: Env = Deno.env, fetcher: typeof fetch = fetch): Promise<string | null> {
  const signer = (env.get('SIGNER_URL') ?? '').replace(/\/$/, '');
  if (!signer) return null;
  const now = Date.now();
  if (cached && cached.expires > now + 30_000) return cached.token;

  const id = await fetcher(
    `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(signer)}`,
    { headers: { 'Metadata-Flavor': 'Google' } });
  if (!id.ok) throw new Error(`could not get this service's identity token: ${id.status}`);
  const res = await fetcher(`${signer}/service-token`, {
    method: 'POST', headers: { Authorization: `Bearer ${(await id.text()).trim()}` },
  });
  if (!res.ok) throw new Error(`the signer refused a service token: ${res.status}`);
  const body = await res.json() as { access_token: string; expires_in: number };
  cached = { token: body.access_token, expires: now + body.expires_in * 1000 };
  return cached.token;
}

/** Test hook: forget the cached service token. */
export function resetServiceTokenCache(): void { cached = null; }
