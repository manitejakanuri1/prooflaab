// Verifying a Google Identity Platform ID token.
//
// Written out by hand rather than pulled from a library because every one of
// these checks matters and skipping any of them is a real hole:
//
//   signature  - obvious; without it anyone writes their own token
//   iss        - without it, a token from ANY Google project is accepted
//   aud        - same; aud is what pins the token to THIS project
//   exp        - without it, a token stolen last year still works
//   sub        - the whole point; no subject means no identity
//
// The aud/iss pair is the one people leave out. A Firebase token from a
// stranger's hobby project is perfectly valid and correctly signed by Google -
// it simply is not for us.
import { keyFor } from './jwks.ts';

const PROJECT = Deno.env.get('GCP_PROJECT') ?? 'prooflab-508214';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;

export interface Verified {
  sub: string;
  email?: string;
  email_verified?: boolean;
}

// Returns a Uint8Array explicitly backed by an ArrayBuffer. Uint8Array.from
// gives Uint8Array<ArrayBufferLike>, which crypto.subtle.verify rejects because
// that could be a SharedArrayBuffer.
function b64url(part: string): Uint8Array<ArrayBuffer> {
  const pad = part.length % 4 === 0 ? '' : '='.repeat(4 - (part.length % 4));
  const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64url(part)));
}

/** The verified claims, or null. Null is always "refuse", never "probably fine". */
export async function verifyGoogleToken(token: string): Promise<Verified | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256') return null;          // no "alg: none", no HS256 confusion
  const kid = typeof header.kid === 'string' ? header.kid : null;
  if (!kid) return null;

  const key = await keyFor(kid);
  if (!key) return null;

  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64url(parts[2]), signed,
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.iat === 'number' && payload.iat > now + 300) return null; // clock skew allowance
  if (payload.iss !== ISSUER) return null;
  if (payload.aud !== PROJECT) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) return null;

  return {
    sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    email_verified: payload.email_verified === true,
  };
}
