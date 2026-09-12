// Where a function's `createClient` actually points.
//
// All 41 functions do the same thing: build a Supabase client from
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then use .from(), .rpc() and
// occasionally .storage. This module keeps that call identical and changes what
// sits behind it.
//
//   BACKEND unset (or anything but 'google')
//       the real Supabase client. Nothing changes, and the same file still
//       deploys to Supabase.
//
//   BACKEND=google
//       PostgREST on Cloud Run for the database, and the mounted Cloud Storage
//       buckets for files.
//
// The service-role key has no equivalent on Google: PostgREST decides what a
// caller may do from the `role` claim in a signed token. So one is minted here
// with role=service_role, signed with the same secret PostgREST was started
// with. That role has BYPASSRLS, exactly as on Supabase - which is why this
// module is only ever imported by server-side function code and never by
// anything a browser can reach.

import { createClient as createSupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.50.3';

const BACKEND = Deno.env.get('BACKEND') ?? '';
export const USING_GOOGLE = BACKEND === 'google';

const POSTGREST_URL = Deno.env.get('POSTGREST_URL') ?? '';
const JWT_SECRET = Deno.env.get('PGRST_JWT_SECRET') ?? '';

/** Where Cloud Run mounts the buckets. Empty when running on Supabase. */
const PRIVATE_MOUNT = Deno.env.get('PRIVATE_MOUNT') ?? '/mnt/private';
const PUBLIC_MOUNT = Deno.env.get('PUBLIC_MOUNT') ?? '/mnt/public';

const PUBLIC_BUCKETS = new Set(['profile-photos']);

// ---------------------------------------------------------------------------
// the service-role token
// ---------------------------------------------------------------------------

let cached: { token: string; expires: number } | null = null;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlText = (text: string) => b64url(new TextEncoder().encode(text));

/**
 * A short-lived HS256 token carrying role=service_role.
 *
 * Ten minutes, renewed on demand. A long-lived copy of this would be the single
 * most dangerous string in the system - it reads every row in the database - so
 * it is minted in memory, never stored, and never sent anywhere except
 * PostgREST.
 */
async function serviceToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expires > now + 30_000) return cached.token;
  if (!JWT_SECRET) throw new Error('PGRST_JWT_SECRET is not set; cannot reach the database');

  const issued = Math.floor(now / 1000);
  const expires = issued + 600;

  const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64urlText(JSON.stringify({ role: 'service_role', iat: issued, exp: expires }));

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${header}.${payload}`),
  );

  const token = `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
  cached = { token, expires: expires * 1000 };
  return token;
}

// ---------------------------------------------------------------------------
// files, straight off the mounted buckets
// ---------------------------------------------------------------------------

function mountedPath(bucket: string, path: string): string {
  const root = PUBLIC_BUCKETS.has(bucket) ? PUBLIC_MOUNT : PRIVATE_MOUNT;
  return `${root}/${bucket}/${path}`;
}

/**
 * The three functions that touch files only ever download one or ask for a
 * temporary link. Reading is a plain file read from the mounted bucket - no
 * token, no network hop, and the function is trusted server code already.
 */
function storageFor(bucket: string) {
  return {
    async download(path: string): Promise<{ data: Blob | null; error: Error | null }> {
      try {
        const bytes = await Deno.readFile(mountedPath(bucket, path));
        return { data: new Blob([bytes]), error: null };
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return { data: null, error: new Error('Object not found') };
        }
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },

    async createSignedUrl(
      path: string,
      _expiresIn: number,
    ): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
      // Deliberately refused rather than faked. Cloud Storage can sign a URL,
      // but only with a key this service does not hold, and handing back an
      // unsigned link would quietly make a private proof public. The caller
      // reports the failure to the user instead.
      return {
        data: null,
        error: new Error(
          'Signed download links are not available on this backend yet. ' +
          'Serve the file through the file service instead.',
        ),
      };
    },

    async remove(paths: string[]): Promise<{ data: null; error: Error | null }> {
      try {
        for (const path of paths) {
          await Deno.remove(mountedPath(bucket, path)).catch((err) => {
            if (!(err instanceof Deno.errors.NotFound)) throw err;
          });
        }
        return { data: null, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },

    async upload(
      path: string,
      body: ArrayBuffer | Uint8Array | Blob,
      _options?: { contentType?: string; upsert?: boolean },
    ): Promise<{ data: { path: string } | null; error: Error | null }> {
      try {
        const full = mountedPath(bucket, path);
        await Deno.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
        const bytes = body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : body instanceof Uint8Array
          ? body
          : new Uint8Array(body);
        await Deno.writeFile(full, bytes);
        return { data: { path }, error: null };
      } catch (err) {
        return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  };
}


// ---------------------------------------------------------------------------
// identifying the caller
// ---------------------------------------------------------------------------

/**
 * 29 functions call auth.getClaims(token) and 10 call auth.getUser(token), both
 * to learn who is asking. On Supabase that is a network round trip to the auth
 * service. Here the token was minted by our own auth-bridge and signed with the
 * secret this process already holds, so it is verified in place - fewer moving
 * parts and no dependency on a second service being up to answer "who is this".
 *
 * The verification is real: signature, algorithm and expiry are all checked. A
 * decode-only shortcut would let anyone hand us a token they wrote themselves.
 */
async function verifyCallerToken(
  token: string,
): Promise<{ sub: string; role?: string; email?: string } | null> {
  if (!JWT_SECRET) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const fromB64 = (s: string) => {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(fromB64(parts[1])));
  } catch {
    return null;
  }

  if (header.alg !== 'HS256') return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'HMAC', key, fromB64(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;

  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) return null;

  return {
    sub,
    role: typeof payload.role === 'string' ? payload.role : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}

/** The pieces of supabase.auth the 41 functions actually use. */
const authShim = {
  async getClaims(token: string) {
    const claims = await verifyCallerToken(token);
    return claims
      ? { data: { claims }, error: null }
      : { data: null, error: { message: 'invalid token', status: 401 } };
  },

  async getUser(token: string) {
    const claims = await verifyCallerToken(token);
    return claims
      ? { data: { user: { id: claims.sub, email: claims.email ?? '', role: claims.role } }, error: null }
      : { data: { user: null }, error: { message: 'invalid token', status: 401 } };
  },

  admin: {
    // Creating and inviting accounts lives in Identity Platform, not in the
    // database, so these three are the last pieces of the move. Refused loudly
    // rather than silently doing nothing: a college pressing "add students" and
    // getting a clear error is recoverable; one that appears to work and creates
    // nobody is not.
    createUser(): never {
      throw new Error('createUser is not wired to Identity Platform yet');
    },
    generateLink(): never {
      throw new Error('generateLink is not wired to Identity Platform yet');
    },
    listUsers(): never {
      throw new Error('listUsers is not wired to Identity Platform yet');
    },
  },
};

// ---------------------------------------------------------------------------
// the client the functions receive
// ---------------------------------------------------------------------------

/**
 * supabase-js addresses tables at <url>/rest/v1/<table>; our PostgREST serves
 * from the root. Same rewrite as the browser client, for the same reason.
 */
const restFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const fixed = url.replace(`${POSTGREST_URL}/rest/v1`, POSTGREST_URL);
  if (typeof input === 'string' || input instanceof URL) return fetch(fixed, init);
  return fetch(new Request(fixed, input), init);
};

/**
 * Drop-in for supabase-js `createClient`.
 *
 * On Supabase the arguments are used as given. On Google they are ignored - the
 * destination comes from POSTGREST_URL and the identity from a minted
 * service-role token - because every one of the 41 call sites passes the same
 * two environment variables and there is nothing to be gained from threading
 * them through.
 */
export function createClient(url: string, key: string, options?: unknown) {
  if (!USING_GOOGLE) {
    // deno-lint-ignore no-explicit-any
    return createSupabaseClient(url, key, options as any);
  }

  if (!POSTGREST_URL) throw new Error('BACKEND=google but POSTGREST_URL is not set');

  const base = createSupabaseClient(POSTGREST_URL, 'postgrest-needs-no-api-key', {
    accessToken: () => serviceToken(),
    global: { fetch: restFetch },
    db: { schema: 'public' },
  });

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'storage') return { from: storageFor };
      if (prop === 'auth') return authShim;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof base;
}

export { serviceToken };
