/**
 * Login against Google Identity Platform, shaped like supabase.auth.
 *
 * Why a shim instead of editing the app: `supabase.auth.*` is called from 80
 * places across 43 files. Rewriting each one is 43 chances to miss a branch and
 * lock somebody out. Instead this module offers the same method names with the
 * same return shapes, so the app keeps calling what it always called and the
 * provider underneath changes.
 *
 * Two tokens live here, and the distinction matters:
 *
 *   - Google's ID token (RS256) proves who the person is. Short-lived, refreshed
 *     against Google.
 *   - The bridge token (HS256) is what PostgREST accepts, minted by the
 *     auth-bridge from a verified Google token. This is the one exposed as
 *     `session.access_token`, because that is the value the rest of the app
 *     hands to the database.
 *
 * The bridge never decides who may see what. All 145 row-level security policies
 * still do that, reading `sub` exactly as they did under Supabase - which is why
 * every account kept its original UUID during the migration.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string;
const BRIDGE_URL = import.meta.env.VITE_AUTH_BRIDGE_URL as string;

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';
const SECURETOKEN = 'https://securetoken.googleapis.com/v1/token';

const STORAGE_KEY = 'prooflab.auth.google';

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// shapes the app already expects
// ---------------------------------------------------------------------------

export interface GoogleUser {
  id: string;
  aud: string;
  role: string;
  email: string;
  email_confirmed_at: string | null;
  phone: string;
  created_at: string;
  updated_at: string;
  last_sign_in_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
}

export interface GoogleSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  token_type: 'bearer';
  user: GoogleUser;
  /** Google's own ID token. Not used by the database; used to refresh. */
  provider_token: string;
}

type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED';

type Listener = (event: AuthEvent, session: GoogleSession | null) => void;

interface Result<T> {
  data: T;
  error: { message: string; status?: number } | null;
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let current: GoogleSession | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit(event: AuthEvent, session: GoogleSession | null): void {
  for (const fn of listeners) {
    // One listener throwing must not stop the others from being told.
    try {
      fn(event, session);
    } catch (err) {
      console.error('auth listener failed', err);
    }
  }
}

function persist(session: GoogleSession | null): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage blocked. The session still works for this
    // tab; it just will not survive a reload. Not worth failing a login over.
  }
}

function restore(): GoogleSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GoogleSession) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// talking to Google
// ---------------------------------------------------------------------------

async function identity<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${IDENTITY}/accounts:${path}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(readableError(json)), { status: res.status });
  }
  return json as T;
}

/**
 * Google returns machine codes like EMAIL_NOT_FOUND. Those must not reach a
 * student, and they must not leak which half of the pair was wrong - that turns
 * a login form into an account-existence oracle.
 */
function readableError(json: { error?: { message?: string } }): string {
  const code = json?.error?.message ?? 'UNKNOWN';
  if (code.startsWith('EMAIL_NOT_FOUND')) return 'Invalid login credentials';
  if (code.startsWith('INVALID_PASSWORD')) return 'Invalid login credentials';
  if (code.startsWith('INVALID_LOGIN_CREDENTIALS')) return 'Invalid login credentials';
  if (code.startsWith('USER_DISABLED')) return 'This account has been disabled';
  if (code.startsWith('EMAIL_EXISTS')) return 'An account with this email already exists';
  if (code.startsWith('WEAK_PASSWORD')) return 'Password should be at least 6 characters';
  if (code.startsWith('TOO_MANY_ATTEMPTS')) {
    return 'Too many attempts. Please wait a few minutes and try again';
  }
  if (code.startsWith('INVALID_EMAIL')) return 'That email address is not valid';
  return 'Could not sign in. Please try again';
}

/** The claims inside a token, read without verifying - the bridge already did. */
function claimsOf(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return null;
  }
}

const subjectOf = (token: string): string | null => {
  const sub = claimsOf(token)?.sub;
  return typeof sub === 'string' ? sub : null;
};

/** Exchange a verified Google token for the HS256 token PostgREST accepts. */
async function exchange(idToken: string): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`${BRIDGE_URL}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    // Google's edge rejects a POST with no body at all, so send an empty object.
    body: '{}',
  });
  if (!res.ok) throw new Error('Could not start your session. Please try again');
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return { token: json.access_token, expiresIn: json.expires_in };
}

interface SignInResponse {
  localId: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiresIn: string;
  displayName?: string;
}

interface LookupResponse {
  users?: Array<{
    localId: string;
    email: string;
    emailVerified?: boolean;
    createdAt?: string;
    lastLoginAt?: string;
    customAttributes?: string;
    displayName?: string;
    providerUserInfo?: unknown[];
  }>;
}

/**
 * Build the user object the app expects. `user_metadata` is read in several
 * screens, so it is filled from Google's custom attributes where present rather
 * than left empty.
 */
async function buildUser(
  idToken: string,
  fallback: { id: string; email: string; confirmed?: boolean },
): Promise<GoogleUser> {
  let found: NonNullable<LookupResponse['users']>[number] | undefined;
  try {
    const res = await identity<LookupResponse>('lookup', { idToken });
    found = res.users?.[0];
  } catch {
    // A lookup failure must not fail a login that Google already accepted.
  }

  const meta: Record<string, unknown> = {};
  if (found?.customAttributes) {
    try {
      Object.assign(meta, JSON.parse(found.customAttributes));
    } catch {
      // Ignore attributes that are not JSON.
    }
  }
  if (found?.displayName) meta.full_name = found.displayName;
  if (found?.email ?? fallback.email) meta.email = found?.email ?? fallback.email;

  const asIso = (ms?: string) => (ms ? new Date(Number(ms)).toISOString() : null);

  return {
    // fallback.id first: it is the database's id, resolved by the bridge.
    // found.localId is Identity Platform's, which the database has never seen.
    id: fallback.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: found?.email ?? fallback.email,
    email_confirmed_at: (found?.emailVerified || fallback.confirmed)
      ? (asIso(found?.createdAt) ?? new Date().toISOString())
      : null,
    phone: '',
    created_at: asIso(found?.createdAt) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_sign_in_at: asIso(found?.lastLoginAt),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: meta,
    identities: found?.providerUserInfo ?? [],
  };
}

/** Turn a Google sign-in response into a session the app can use. */
async function sessionFrom(res: SignInResponse): Promise<GoogleSession> {
  const { token, expiresIn } = await exchange(res.idToken);

  // The id the rest of the app uses must be the one the DATABASE knows, not the
  // one Identity Platform invented. For accounts migrated in August they are the
  // same; for accounts created since, Google's id looks like
  // SOBgobKpvxNgqQIBQSnsIaoIoBv1 and every query built from it fails with a 400,
  // because the columns are uuid. The bridge already resolved it - it is the
  // subject of the token it just returned - so take it from there.
  const user = await buildUser(res.idToken, {
    id: subjectOf(token) ?? res.localId,
    email: res.email,
    // Identity Platform reports every account it creates as unverified and
    // cannot be told otherwise without an administrator credential. The bridge
    // carries the database's answer instead, which is what a college sets when
    // it enrols a student.
    confirmed: claimsOf(token)?.email_confirmed === true,
  });
  return {
    access_token: token,
    refresh_token: res.refreshToken,
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    token_type: 'bearer',
    user,
    provider_token: res.idToken,
  };
}

// ---------------------------------------------------------------------------
// keeping the session alive
// ---------------------------------------------------------------------------

function scheduleRefresh(session: GoogleSession | null): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!session) return;

  const dueInMs = session.expires_at * 1000 - Date.now() - REFRESH_MARGIN_MS;
  refreshTimer = setTimeout(() => void refreshSession(), Math.max(dueInMs, 1000));
}

function setSessionInternal(session: GoogleSession | null, event: AuthEvent): void {
  current = session;
  persist(session);
  scheduleRefresh(session);
  emit(event, session);
}

async function refreshSession(): Promise<GoogleSession | null> {
  const stale = current;
  if (!stale?.refresh_token) return null;

  try {
    const res = await fetch(`${SECURETOKEN}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stale.refresh_token,
      }),
    });
    if (!res.ok) throw new Error('refresh rejected');
    const json = (await res.json()) as {
      id_token: string;
      refresh_token: string;
      user_id: string;
    };

    const { token, expiresIn } = await exchange(json.id_token);
    const fresh: GoogleSession = {
      ...stale,
      // Keep the database id across a refresh. Taking Google's id here would
      // silently change who the app thinks you are, an hour into a session.
      user: { ...stale.user, id: subjectOf(token) ?? stale.user.id },
      access_token: token,
      refresh_token: json.refresh_token,
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      provider_token: json.id_token,
    };
    setSessionInternal(fresh, 'TOKEN_REFRESHED');
    return fresh;
  } catch {
    // A refresh that cannot be completed means the session is over. Say so
    // plainly rather than leaving the app holding a token the database rejects.
    setSessionInternal(null, 'TOKEN_REFRESHED');
    return null;
  }
}

/**
 * Google's own ID token, refreshed first if it is close to expiring. The file
 * service verifies this against Google directly, rather than trusting the
 * database token, so a bug in the bridge could never grant access to files.
 */
export async function currentIdToken(): Promise<string | null> {
  if (!current) return null;
  if (current.expires_at * 1000 - Date.now() < REFRESH_MARGIN_MS) {
    const fresh = await refreshSession();
    return fresh?.provider_token ?? null;
  }
  return current.provider_token;
}

/** The current database token, refreshed first if it is about to expire. */
export async function currentAccessToken(): Promise<string | null> {
  if (!current) return null;
  if (current.expires_at * 1000 - Date.now() < REFRESH_MARGIN_MS) {
    const fresh = await refreshSession();
    return fresh?.access_token ?? null;
  }
  return current.access_token;
}

// Bring back whatever was in storage, and check it is still valid, before the
// app asks. A stored session whose token has expired is refreshed rather than
// handed over.
const restored = restore();
if (restored) {
  current = restored;
  if (restored.expires_at * 1000 - Date.now() < REFRESH_MARGIN_MS) {
    void refreshSession();
  } else {
    scheduleRefresh(restored);
  }
}

// ---------------------------------------------------------------------------
// the supabase.auth-shaped surface
// ---------------------------------------------------------------------------

function ok<T>(data: T): Result<T> {
  return { data, error: null };
}

function fail<T>(empty: T, err: unknown): Result<T> {
  const message = err instanceof Error ? err.message : 'Something went wrong';
  const status = (err as { status?: number })?.status;
  return { data: empty, error: { message, status } };
}

export const googleAuth = {
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    try {
      const res = await identity<SignInResponse>('signInWithPassword', {
        email,
        password,
        returnSecureToken: true,
      });
      const session = await sessionFrom(res);
      setSessionInternal(session, 'SIGNED_IN');
      return ok({ user: session.user, session });
    } catch (err) {
      return fail({ user: null, session: null }, err);
    }
  },

  async signUp({
    email,
    password,
    options,
  }: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }) {
    try {
      const res = await identity<SignInResponse>('signUp', {
        email,
        password,
        returnSecureToken: true,
      });

      // Whatever the sign-up form collected is stored on the account, so the
      // screens that read user_metadata keep working.
      if (options?.data && Object.keys(options.data).length > 0) {
        await identity('update', {
          idToken: res.idToken,
          customAttributes: JSON.stringify(options.data),
          ...(typeof options.data.full_name === 'string'
            ? { displayName: options.data.full_name }
            : {}),
        }).catch(() => undefined);
      }

      await identity('sendOobCode', {
        requestType: 'VERIFY_EMAIL',
        idToken: res.idToken,
        ...(options?.emailRedirectTo ? { continueUrl: options.emailRedirectTo } : {}),
      }).catch(() => undefined);

      const session = await sessionFrom(res);
      setSessionInternal(session, 'SIGNED_IN');
      return ok({ user: session.user, session });
    } catch (err) {
      return fail({ user: null, session: null }, err);
    }
  },

  async signOut() {
    setSessionInternal(null, 'SIGNED_OUT');
    return { error: null };
  },

  async getSession() {
    return ok({ session: current });
  },

  async getUser() {
    if (!current) return ok({ user: null });
    return ok({ user: current.user });
  },

  async refreshSession() {
    const session = await refreshSession();
    return session
      ? ok({ user: session.user, session })
      : fail({ user: null, session: null }, new Error('Your session has expired'));
  },

  /**
   * Adopt a session the caller already holds. Used by the password-reset and
   * email-link screens, which arrive with a Google token in the URL rather than
   * a password.
   */
  async setSession({ refresh_token }: { access_token?: string; refresh_token: string }) {
    try {
      current = { ...(current ?? ({} as GoogleSession)), refresh_token };
      const session = await refreshSession();
      if (!session) throw new Error('That link has expired. Please request a new one');
      return ok({ user: session.user, session });
    } catch (err) {
      return fail({ user: null, session: null }, err);
    }
  },

  async updateUser({
    password,
    email,
    data,
  }: {
    password?: string;
    email?: string;
    data?: Record<string, unknown>;
  }) {
    if (!current) {
      return fail({ user: null }, new Error('You need to be signed in to do that'));
    }
    try {
      const res = await identity<{ idToken?: string; refreshToken?: string }>('update', {
        idToken: current.provider_token,
        ...(password ? { password } : {}),
        ...(email ? { email } : {}),
        ...(data ? { customAttributes: JSON.stringify({ ...current.user.user_metadata, ...data }) } : {}),
        ...(typeof data?.full_name === 'string' ? { displayName: data.full_name } : {}),
        returnSecureToken: true,
      });

      // Changing a password or an email invalidates the old token, and Google
      // hands back a new one. Adopt it, or the next database call fails.
      if (res.idToken) {
        const refreshed: GoogleSession = {
          ...current,
          provider_token: res.idToken,
          refresh_token: res.refreshToken ?? current.refresh_token,
        };
        const { token, expiresIn } = await exchange(res.idToken);
        refreshed.access_token = token;
        refreshed.expires_in = expiresIn;
        refreshed.expires_at = Math.floor(Date.now() / 1000) + expiresIn;
        refreshed.user = await buildUser(res.idToken, {
          id: current.user.id,
          email: email ?? current.user.email,
        });
        setSessionInternal(refreshed, 'USER_UPDATED');
        return ok({ user: refreshed.user });
      }

      return ok({ user: current.user });
    } catch (err) {
      return fail({ user: null }, err);
    }
  },

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
    try {
      await identity('sendOobCode', {
        requestType: 'PASSWORD_RESET',
        email,
        ...(options?.redirectTo ? { continueUrl: options.redirectTo } : {}),
      });
      // Deliberately succeeds whether or not the address exists, so the form
      // cannot be used to discover who has an account.
      return ok({});
    } catch {
      return ok({});
    }
  },

  async resend({ email, type }: { email: string; type: string }) {
    try {
      if (type === 'signup' && current) {
        await identity('sendOobCode', {
          requestType: 'VERIFY_EMAIL',
          idToken: current.provider_token,
        });
      } else {
        await identity('sendOobCode', { requestType: 'PASSWORD_RESET', email });
      }
      return ok({});
    } catch (err) {
      return fail({}, err);
    }
  },

  async signInWithOtp({ email, options }: { email: string; options?: { emailRedirectTo?: string } }) {
    try {
      await identity('sendOobCode', {
        requestType: 'EMAIL_SIGNIN',
        email,
        ...(options?.emailRedirectTo ? { continueUrl: options.emailRedirectTo } : {}),
      });
      return ok({ user: null, session: null });
    } catch (err) {
      return fail({ user: null, session: null }, err);
    }
  },

  /**
   * Sign in with a Google account rather than a password. Three of the existing
   * accounts use this, so it is refused loudly rather than silently doing
   * nothing - a button that appears to work and does not is worse than one that
   * says why.
   */
  async signInWithOAuth(_args: { provider: string; options?: { redirectTo?: string } }) {
    return fail(
      { provider: _args.provider, url: null },
      new Error('Google sign-in is not switched on yet. Please use your email and password'),
    );
  },

  onAuthStateChange(callback: Listener) {
    listeners.add(callback);
    // supabase-js reports the starting state asynchronously; match that, or
    // components that set state in the callback do it during render.
    setTimeout(() => callback('INITIAL_SESSION', current), 0);
    return {
      data: {
        subscription: {
          id: 'google-identity',
          callback,
          unsubscribe: () => {
            listeners.delete(callback);
          },
        },
      },
    };
  },
};

/** Test seam: drop all state between cases. */
export function __resetForTests(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  current = null;
  listeners.clear();
  persist(null);
}
