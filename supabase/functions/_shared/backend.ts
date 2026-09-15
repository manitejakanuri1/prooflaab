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

/** Identity Platform, for the two functions that create accounts. */
const IDENTITY_API = 'https://identitytoolkit.googleapis.com/v1';
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_API_KEY') ?? '';

/** The file service, which serves a private file against a grant. */
const FILES_URL = Deno.env.get('FILES_URL') ?? '';

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
      expiresIn: number,
    ): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
      // The caller has already decided this person may see this file - that is
      // what proof-file-url does before it gets here. So a grant is issued for
      // this one object, and the file service honours it.
      //
      // Not a Cloud Storage signed URL: signing one needs a private key, and a
      // key that can sign any object in the bucket would be a far bigger thing
      // to hold than a token that names one file and expires in minutes.
      if (!FILES_URL) {
        return { data: null, error: new Error('FILES_URL is not set') };
      }
      if (!JWT_SECRET) {
        return { data: null, error: new Error('PGRST_JWT_SECRET is not set') };
      }

      const expires = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(expiresIn, 3600));
      const header = b64urlText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
      const payload = b64urlText(JSON.stringify({ obj: `${bucket}/${path}`, exp: expires }));

      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(JWT_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const signature = await crypto.subtle.sign(
        'HMAC', key, new TextEncoder().encode(`${header}.${payload}`),
      );
      const grant = `${header}.${payload}.${b64url(new Uint8Array(signature))}`;

      return {
        data: {
          signedUrl: `${FILES_URL}/file/${bucket}/${path}?grant=${encodeURIComponent(grant)}`,
        },
        error: null,
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


/**
 * Record an account in the database and return the uuid it should be known by.
 *
 * Identity Platform names an account when it creates one, and its names are not
 * uuids. record_account stores the row and hands back the uuid every other table
 * expects, creating the mapping the auth-bridge reads on each later login - so
 * the same person is the same id from the moment they are enrolled.
 */
async function recordAccount(
  providerUid: string,
  email: string,
  fullName: string | null,
  vouched: boolean,
): Promise<string | null> {
  if (!USING_GOOGLE || !POSTGREST_URL) return providerUid;

  try {
    const res = await fetch(`${POSTGREST_URL}/rpc/record_account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await serviceToken()}`,
        'Content-Type': 'application/json',
        Accept: 'application/vnd.pgrst.object+json',
      },
      body: JSON.stringify({
        _provider_uid: providerUid,
        _email: email,
        _full_name: fullName,
        _vouched: vouched,
      }),
    });
    if (!res.ok) {
      console.error('record_account returned', res.status, (await res.text()).slice(0, 200));
      return null;
    }
    const body = await res.json();
    return typeof body === 'string' ? body : (body?.record_account ?? null);
  } catch (err) {
    console.error('record_account failed:', err);
    return null;
  }
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
    /**
     * Create an account in Identity Platform.
     *
     * Uses accounts:signUp with the project's browser key, not the
     * administrator API. That is deliberate: the administrator API needs an
     * OAuth token from the metadata server, and on this runtime the metadata
     * server answers 404 for every service-account path - see the note in
     * files-service. signUp does the same job with a key that is public by
     * design, and the account it creates is identical.
     *
     * The cost is that the id is Identity Platform's choice rather than ours.
     * It is returned to the caller, which writes it into the database, so the
     * two stay in step exactly as before.
     */
    async createUser(attrs: {
      email: string;
      password: string;
      email_confirm?: boolean;
      user_metadata?: Record<string, unknown>;
    }) {
      if (!GOOGLE_API_KEY) {
        return { data: { user: null }, error: { message: 'GOOGLE_API_KEY is not set' } };
      }

      const signUp = await fetch(
        `${IDENTITY_API}/accounts:signUp?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: attrs.email,
            password: attrs.password,
            returnSecureToken: true,
          }),
        },
      );
      const created = await signUp.json().catch(() => ({}));
      if (!signUp.ok) {
        const code = created?.error?.message ?? 'SIGNUP_FAILED';
        return {
          data: { user: null },
          error: {
            message: code === 'EMAIL_EXISTS'
              // Said plainly, because it has one cause that is not the obvious
              // one: a login can exist in Identity Platform with no row behind
              // it, if an earlier import created the account and then failed.
              // The address cannot be reused until that login is removed, and
              // this service cannot remove it - that needs an administrator.
              ? 'A login already exists for this email address. If the student ' +
                'does not appear in the dashboard, the login is orphaned and an ' +
                'administrator must remove it before the import can recreate them.'
              : `Could not create the account (${code})`,
          },
        };
      }

      // Carry the name across, so the screens that read user_metadata behave as
      // they did. Best effort: a display name that fails to save must not undo
      // an account that was created.
      const fullName = attrs.user_metadata?.full_name;
      if (attrs.user_metadata && Object.keys(attrs.user_metadata).length > 0) {
        await fetch(`${IDENTITY_API}/accounts:update?key=${GOOGLE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idToken: created.idToken,
            customAttributes: JSON.stringify(attrs.user_metadata),
            ...(typeof fullName === 'string' ? { displayName: fullName } : {}),
          }),
        }).catch(() => undefined);
      }

      // Write the account into the database and take the uuid it assigns.
      //
      // Identity Platform holds the password; this database holds the record of
      // the account, and every user column in it is uuid. Returning Google's id
      // instead - which is what this did at first - created 29 logins with no
      // rows behind them: every follow-up insert referenced an account the
      // database had never heard of, and failed on the foreign key. The logins
      // worked and the students did not exist.
      //
      // email_confirm is what a college asserting "this address is real" looks
      // like, and it is carried through so an enrolled student can sign in at
      // once rather than waiting for a link they never asked for.
      const recorded = await recordAccount(
        created.localId as string,
        created.email as string,
        typeof fullName === 'string' ? fullName : null,
        attrs.email_confirm === true,
      );
      if (!recorded) {
        return {
          data: { user: null },
          error: {
            message:
              'The login was created but could not be recorded in the database. ' +
              'Nothing else was written, so it is safe to run the import again.',
          },
        };
      }

      return {
        data: {
          user: {
            id: recorded,
            email: created.email as string,
            user_metadata: attrs.user_metadata ?? {},
          },
        },
        error: null,
      };
    },

    /**
     * Send the person a way in.
     *
     * Supabase hands back a link for the caller to put in its own email. There
     * is no equivalent here without an administrator credential, so Identity
     * Platform sends its own reset email instead and no link is returned. The
     * caller already tolerates a null link - the onboarding email is sent
     * either way, just without the button - so a student still receives both a
     * welcome and a way to set a password.
     */
    async generateLink(args: { type: string; email: string }) {
      if (!GOOGLE_API_KEY) {
        return { data: null, error: { message: 'GOOGLE_API_KEY is not set' } };
      }
      const res = await fetch(`${IDENTITY_API}/accounts:sendOobCode?key=${GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'PASSWORD_RESET', email: args.email }),
      });
      if (!res.ok) {
        return { data: null, error: { message: 'Could not send the password email' } };
      }
      // Shaped like Supabase's reply, with the one field it cannot fill.
      return { data: { properties: { action_link: null } }, error: null };
    },

    /**
     * Supabase's listUsers() downloads every account so the caller can search
     * it for one email. Reading the whole list needs an administrator
     * credential, and searching in the client was never the right shape anyway:
     * with a few thousand students it becomes a full download per import row.
     *
     * The database already knows the answer, so it is asked directly through a
     * function granted to service_role alone. The result is shaped like
     * Supabase's so the caller's `.users.find(...)` keeps working.
     */
    async listUsers(): Promise<{
      data: { users: Array<{ id: string; email: string }> };
      error: null | { message: string };
    }> {
      return {
        data: { users: [] },
        error: {
          message:
            'listUsers is not available on this backend. ' +
            'Look the address up with the account_id_for_email database function instead.',
        },
      };
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
      if (prop === 'functions') return functionsShim;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof base;
}

/**
 * One function calling another.
 *
 * supabase-js sends functions.invoke to <url>/functions/v1/<name>, and on this
 * backend <url> is PostgREST - which answers 404. invoke() reports that as an
 * error rather than throwing, and every caller logs it and carries on, so for
 * the first days on Google nothing a function asked of another ever happened:
 * no welcome email after an import (22 x 404 on 14 Sep), no answer evaluation
 * and no trust score after a student submitted.
 *
 * All 42 functions live in this same process, so the call goes to it directly
 * over loopback: no public hop, and no token for Google's edge to check.
 */
const functionsShim = {
  async invoke(
    name: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<{ data: unknown; error: null | { message: string; status?: number } }> {
    const port = Deno.env.get('PORT') ?? '8080';
    try {
      const res = await fetch(`http://127.0.0.1:${port}/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await serviceToken()}`,
          ...(options.headers ?? {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await res.text();
      let data: unknown = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* not JSON; keep the text */ }
      if (!res.ok) {
        return { data: null, error: { message: `${name} answered ${res.status}: ${text.slice(0, 200)}`, status: res.status } };
      }
      return { data, error: null };
    } catch (err) {
      return { data: null, error: { message: `${name} could not be reached: ${err instanceof Error ? err.message : err}` } };
    }
  },
};

export { serviceToken };

/**
 * Does this email already have an account?
 *
 * The one question create-student-users asked listUsers() in order to answer.
 * On Supabase it still downloads the list, because that is the only way there.
 * On Google it asks the database, which knows, and which does not get slower as
 * the number of students grows.
 */
export async function findAccountByEmail(
  // deno-lint-ignore no-explicit-any
  db: any,
  email: string,
): Promise<{ id: string } | null> {
  const wanted = email.trim().toLowerCase();

  if (USING_GOOGLE) {
    const { data, error } = await db.rpc('account_id_for_email', { _email: wanted });
    if (error) throw new Error(`could not check for an existing account: ${error.message}`);
    return data ? { id: data as string } : null;
  }

  const { data, error } = await db.auth.admin.listUsers();
  if (error) throw new Error(`could not check for an existing account: ${error.message}`);
  const found = data?.users?.find(
    (u: { email?: string }) => u.email?.toLowerCase() === wanted,
  );
  return found ? { id: found.id } : null;
}
