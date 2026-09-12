// The token bridge.
//
// Google Identity Platform signs tokens with RS256 keys it rotates. PostgREST
// can only hold a fixed key given at startup (PostgREST#1130, still open), so a
// pasted copy of Google's keys stops matching within a day and every login
// starts failing. This service sits between them: it verifies Google's token
// against keys that refresh, then issues an equivalent HS256 token PostgREST
// already understands.
//
// Deliberately narrow. It holds no passwords, opens no database, keeps no
// state, and makes no decision about who may see what - it copies a verified
// subject from one token to another. The 145 RLS policies still decide
// everything, exactly as before.
//
// Worst case if it breaks: nobody can log in. Not: the wrong person gets in.
import { verifyGoogleToken } from './verify.ts';

const PORT = Number(Deno.env.get('PORT') ?? 8080);
const TTL_SECONDS = Number(Deno.env.get('TOKEN_TTL') ?? 3600);

/**
 * Where to ask for the uuid belonging to a Google account.
 *
 * Identity Platform names an account when it creates one, and its names are not
 * uuids. Every user column in the database is uuid and 264 auth.uid() checks
 * compare against one, so the name has to be translated before it reaches a
 * token. Telling Identity Platform to use a uuid instead would need an
 * administrator credential, and the metadata server on this runtime cannot
 * issue one - so the translation happens here, where a token is minted anyway.
 *
 * The seven accounts migrated in August kept their uuids as their Identity
 * Platform ids, so for them this costs nothing: resolve_account_uuid recognises
 * a uuid and hands it straight back without touching the database.
 */
const POSTGREST_URL = Deno.env.get('POSTGREST_URL') ?? '';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://prooflaab.vercel.app')
  .split(',').map((s) => s.trim()).filter(Boolean);
const PREVIEW = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

function allowOrigin(origin: string | null): string {
  if (origin && (ALLOWED.includes(origin) || PREVIEW.test(origin))) return origin;
  return ALLOWED[0];
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowOrigin(origin),
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin',
      // A token must never be cached by a browser or a CDN.
      'Cache-Control': 'no-store',
    },
  });
}

// The signing key PostgREST was configured with. Read once at startup so a
// missing secret fails loudly on deploy rather than quietly on first login.
const SECRET = Deno.env.get('PGRST_JWT_SECRET') ?? '';
if (!SECRET) console.error('PGRST_JWT_SECRET is not set - every exchange will fail');

let signingKey: CryptoKey | null = null;
async function key(): Promise<CryptoKey> {
  signingKey ??= await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return signingKey;
}

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s: string) =>
  b64url(new TextEncoder().encode(s));

/**
 * An HS256 token carrying the same subject, shaped the way the RLS policies
 * expect: `sub` is read by auth.uid(), `role` is the Postgres role PostgREST
 * switches to.
 *
 * Its lifetime is capped independently of Google's, so a long-lived Google
 * session cannot produce an indefinitely valid database token.
 */
async function mint(
  sub: string,
  email?: string,
  role = 'authenticated',
  ttl = TTL_SECONDS,
): Promise<{ token: string; exp: number }> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;

  const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlStr(JSON.stringify({
    ...(sub ? { sub } : {}),
    role,
    ...(email ? { email } : {}),
    iat: now,
    exp,
  }));

  const sig = await crypto.subtle.sign(
    'HMAC', await key(), new TextEncoder().encode(`${header}.${payload}`),
  );
  return { token: `${header}.${payload}.${b64url(new Uint8Array(sig))}`, exp };
}

/** Looks like a uuid? Then no lookup is needed at all. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The uuid for this account.
 *
 * Uses the same secret this service already holds to mint a short service_role
 * token, so no new credential is introduced - the bridge can already sign
 * tokens, that is its whole job.
 *
 * A failure here refuses the login rather than falling back to the Google name.
 * Issuing a token with an unusable subject would produce a student who is a
 * stranger to their own work, which is far worse than being told to try again.
 */
async function resolveUuid(providerUid: string, email?: string): Promise<string | null> {
  if (UUID.test(providerUid)) return providerUid;
  if (!POSTGREST_URL) return null;

  const { token } = await mint('', undefined, 'service_role', 60);

  try {
    const res = await fetch(`${POSTGREST_URL}/rpc/resolve_account_uuid`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.pgrst.object+json',
      },
      body: JSON.stringify({ _provider_uid: providerUid, _email: email ?? null }),
    });
    if (!res.ok) {
      console.error('resolve_account_uuid returned', res.status);
      return null;
    }
    const body = await res.json();
    const uuid = typeof body === 'string' ? body : body?.resolve_account_uuid;
    return typeof uuid === 'string' && UUID.test(uuid) ? uuid : null;
  } catch (err) {
    console.error('resolve_account_uuid failed:', err);
    return null;
  }
}

async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('Origin');
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') return json({}, 204, origin);
  if (url.pathname === '/healthz') return json({ ok: true }, 200, origin);

  if (url.pathname === '/token' && req.method === 'POST') {
    const auth = req.headers.get('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return json({ error: 'missing bearer token' }, 401, origin);
    }

    const verified = await verifyGoogleToken(auth.slice(7).trim());
    if (!verified) {
      // One message for every failure: expired, forged, wrong project, wrong
      // algorithm. Telling a caller WHICH check failed helps only the attacker.
      return json({ error: 'invalid token' }, 401, origin);
    }

    const uuid = await resolveUuid(verified.sub, verified.email);
    if (!uuid) {
      return json({ error: 'could not establish your account' }, 503, origin);
    }

    const { token, exp } = await mint(uuid, verified.email);
    return json({
      access_token: token,
      token_type: 'bearer',
      expires_in: exp - Math.floor(Date.now() / 1000),
    }, 200, origin);
  }

  return json({ error: 'not found' }, 404, origin);
}

if (import.meta.main) {
  console.log(`auth-bridge listening on :${PORT}`);
  Deno.serve({ port: PORT }, handler);
}

export { handler, mint };
