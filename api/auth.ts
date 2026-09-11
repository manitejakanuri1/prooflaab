// Turning a bearer token into "who is asking".
//
// Deliberately small and deliberately swappable. Today it verifies an HS256
// token signed with a secret we hold, which is enough to prove the whole chain
// - token in, claims out, RLS filters - works end to end.
//
// Phase 4 replaces verify() with Identity Platform's RS256 verification against
// Google's public keys. Nothing else in the service changes, because everything
// downstream only ever sees the Claims object this returns.
import { verify as jwtVerify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import type { Claims } from './db.ts';

const SECRET = Deno.env.get('API_JWT_SECRET') ?? '';

let key: CryptoKey | null = null;
async function signingKey(): Promise<CryptoKey> {
  if (!SECRET) throw new Error('API_JWT_SECRET is not set');
  key ??= await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return key;
}

/**
 * Claims for this request, or null if there is no usable token.
 *
 * Null means anonymous, not "error" - plenty of the policies allow a logged-out
 * reader (a public portfolio, a verified public proof). The caller decides
 * whether anonymous is acceptable for that route; this only reports the truth.
 *
 * A token that is present but bad also returns null. An invalid token must
 * never be treated as "probably fine": it is exactly the case an attacker
 * controls.
 */
export async function claimsFrom(req: Request): Promise<Claims | null> {
  const header = req.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;

  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;

  try {
    const payload = await jwtVerify(token, await signingKey());
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) return null;
    return {
      sub,
      role: typeof payload.role === 'string' ? payload.role : 'authenticated',
      email: typeof payload.email === 'string' ? payload.email : undefined,
    };
  } catch {
    // expired, wrong signature, malformed - all the same answer
    return null;
  }
}
