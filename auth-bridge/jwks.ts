// Google's public keys, kept current.
//
// This is the entire reason this service exists. PostgREST can only be handed a
// fixed set of keys at startup (open request since 2019: PostgREST#1130), while
// Google rotates the keys that sign Identity Platform tokens roughly daily. A
// fixed copy therefore stops matching and every login begins failing with 401.
//
// So the verification happens here instead, against a key set that refreshes.

const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Jwk { kid: string; n: string; e: string; alg?: string; kty: string }

let cache = new Map<string, CryptoKey>();
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;

// Google sends Cache-Control with the real lifetime; this is only the floor
// between forced refreshes, so a burst of unknown-kid requests cannot turn into
// a burst of outbound fetches.
const MIN_REFRESH_MS = 60_000;

async function refresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const res = await fetch(JWKS_URL);
    if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
    const body = await res.json() as { keys: Jwk[] };

    const next = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      if (!jwk.kid || jwk.kty !== 'RSA') continue;
      next.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      );
    }
    if (next.size === 0) throw new Error('jwks returned no usable keys');
    cache = next;
    fetchedAt = Date.now();
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * The key for this token's `kid`.
 *
 * A miss triggers one refresh and a single retry, which is what makes rotation
 * invisible: the first token signed with a new key refetches the set, and every
 * token after that is already cached. Returns null rather than throwing so an
 * unrecognised key is a refusal, never a 500.
 */
export async function keyFor(kid: string): Promise<CryptoKey | null> {
  if (cache.size === 0) await refresh();

  const hit = cache.get(kid);
  if (hit) return hit;

  if (Date.now() - fetchedAt > MIN_REFRESH_MS) {
    await refresh();
    return cache.get(kid) ?? null;
  }
  return null;
}
