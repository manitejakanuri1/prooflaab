import {
  clearSessionCookie,
  generateSessionId,
  makeSessionCookie,
  type PrivateSession,
  readSessionCookie,
  type SessionUser,
} from "./session.ts";

import {
  createSessionRecord,
  loadManagedLoginIdentity,
  loadSessionRecord,
  type ManagedLoginIdentity,
  revokeSessionRecord,
  updateSessionRecord,
} from "./sessionStore.ts";

const IDENTITY = "https://identitytoolkit.googleapis.com/v1";
const SECURETOKEN = "https://securetoken.googleapis.com/v1/token";

const ABSOLUTE_SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Env {
  get(name: string): string | undefined;
}

type CreateSession = (
  id: string,
  session: PrivateSession,
) => Promise<void>;

type LoadSession = (
  id: string,
) => Promise<PrivateSession | null>;

type UpdateSession = (
  id: string,
  session: PrivateSession,
) => Promise<void>;

type RevokeSession = (
  id: string,
) => Promise<void>;

type LoadLoginIdentity = (
  userId: string,
) => Promise<ManagedLoginIdentity>;

export interface AuthRouteDeps {
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => number;
  newSessionId?: () => string;

  createSession?: CreateSession;
  loadSession?: LoadSession;
  updateSession?: UpdateSession;
  revokeSession?: RevokeSession;
  loadLoginIdentity?: LoadLoginIdentity;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

function claimsOf(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;

    const padded = part.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (part.length % 4)) % 4);

    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function safeSession(session: PrivateSession) {
  return {
    user: session.user,
    expires_at: Math.floor(session.expiresAt / 1000),
  };
}

function config(input: AuthRouteDeps) {
  const env = input.env ?? Deno.env;
  const fetcher = input.fetcher ?? fetch;
  const now = input.now ?? Date.now;

  const googleApiKey = env.get("GOOGLE_API_KEY") ?? "";
  const bridge = (env.get("AUTH_BRIDGE_URL") ?? "").replace(/\/+$/, "");

  const storeDeps = {
    env,
    fetcher,
    now,
  };

  return {
    env,
    fetcher,
    now,
    googleApiKey,
    bridge,

    newSessionId: input.newSessionId ?? generateSessionId,

    createSession: input.createSession ??
      ((id: string, session: PrivateSession) =>
        createSessionRecord(id, session, storeDeps)),

    loadSession: input.loadSession ??
      ((id: string) => loadSessionRecord(id, storeDeps)),

    updateSession: input.updateSession ??
      ((id: string, session: PrivateSession) =>
        updateSessionRecord(id, session, storeDeps)),

    revokeSession: input.revokeSession ??
      ((id: string) => revokeSessionRecord(id, storeDeps)),

    loadLoginIdentity: input.loadLoginIdentity ??
      ((userId: string) => loadManagedLoginIdentity(userId, storeDeps)),
  };
}

class LoginRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * The exact sentence for each login refusal (owner, 14 Oct). Reason codes come from web_login_identity
 * (migrations 102, 110, 115); an unknown code gets the old general sentence.
 */
const REFUSAL_MESSAGES: Record<string, string> = {
  college_pending_approval:
    "Your college is waiting for approval by ProofLab. You can sign in after an administrator approves it.",
  college_suspended: "Your college account is suspended. Please contact ProofLab.",
  college_rejected: "Your college registration was not approved. Please contact ProofLab.",
  college_account_unavailable: "This college account is not available. Please contact ProofLab.",
  college_not_active: "Your college's ProofLab account is not active yet. Please contact your college.",
  student_not_college_managed:
    "Your student account is not active. Please contact your college.",
  company_account_unavailable: "This company account is not available. Please contact ProofLab.",
  account_not_provisioned:
    "This email is not registered with ProofLab. Please ask your college or the ProofLab admin.",
  identity_missing: "This account has been removed. Please contact your college or ProofLab.",
};
export const refusalMessage = (reason: string | undefined) =>
  (reason && REFUSAL_MESSAGES[reason]) ||
  "Account access is managed by your college or platform administrator";

async function exchangeAppToken(
  idToken: string,
  cfg: ReturnType<typeof config>,
): Promise<
  { token: string; expiresIn: number; subject: string; confirmed: boolean }
> {
  if (!cfg.bridge) throw new Error("AUTH_BRIDGE_URL is missing");

  const response = await cfg.fetcher(`${cfg.bridge}/token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (response.status === 403) {
    // The bridge applies the managed-login rule itself (security gate 14 Oct) and says which reason.
    const refused = await response.json().catch(() => ({})) as { reason?: unknown };
    throw new LoginRefused(typeof refused.reason === "string" ? refused.reason : "");
  }
  if (!response.ok) {
    throw new Error(`auth bridge rejected token: ${response.status}`);
  }

  const body = await response.json() as {
    access_token?: unknown;
    expires_in?: unknown;
  };

  if (
    typeof body.access_token !== "string" ||
    typeof body.expires_in !== "number" ||
    body.expires_in <= 0
  ) {
    throw new Error("auth bridge returned invalid token");
  }

  const claims = claimsOf(body.access_token);

  const subject = claims?.sub;

  if (typeof subject !== "string" || !UUID.test(subject)) {
    throw new Error("auth bridge returned invalid subject");
  }

  return {
    token: body.access_token,
    expiresIn: body.expires_in,
    subject,
    confirmed: claims?.email_confirmed === true,
  };
}

async function login(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  if (!cfg.googleApiKey) {
    return json({ error: "authentication unavailable" }, 503);
  }

  let input: { email?: unknown; password?: unknown };

  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }

  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    !input.email.trim() ||
    !input.password
  ) {
    return json({ error: "email and password are required" }, 400);
  }

  const response = await cfg.fetcher(
    `${IDENTITY}/accounts:signInWithPassword?key=${
      encodeURIComponent(cfg.googleApiKey)
    }`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email.trim(),
        password: input.password,
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    return json({ error: "Invalid login credentials" }, 401);
  }

  const identity = await response.json() as {
    email?: unknown;
    idToken?: unknown;
    refreshToken?: unknown;
  };

  if (
    typeof identity.idToken !== "string" ||
    typeof identity.refreshToken !== "string" ||
    typeof identity.email !== "string"
  ) {
    return json({ error: "authentication unavailable" }, 503);
  }

  let exchanged;

  try {
    exchanged = await exchangeAppToken(identity.idToken, cfg);
  } catch (err) {
    if (err instanceof LoginRefused) {
      return json({ error: refusalMessage(err.reason), reason: err.reason || undefined }, 403);
    }
    return json({ error: "Could not start your session" }, 503);
  }

  let managedIdentity: ManagedLoginIdentity;

  try {
    managedIdentity = await cfg.loadLoginIdentity(
      exchanged.subject,
    );
  } catch {
    return json(
      { error: "Could not verify account access" },
      503,
    );
  }

  if (
    managedIdentity.allowed !== true ||
    !managedIdentity.role
  ) {
    return json({ error: refusalMessage(managedIdentity.reason), reason: managedIdentity.reason }, 403);
  }

  const now = cfg.now();

  const userMetadata: Record<string, unknown> = {
    email: identity.email,
    account_type: managedIdentity.role,
    has_completed_wizard: managedIdentity.has_completed_wizard === true,
  };

  if (managedIdentity.full_name) {
    userMetadata.full_name = managedIdentity.full_name;
  }

  if (managedIdentity.college_id) {
    userMetadata.college_id = managedIdentity.college_id;
  }

  if (managedIdentity.onboarding_status) {
    userMetadata.onboarding_status = managedIdentity.onboarding_status;
  }

  const user: SessionUser = {
    id: exchanged.subject,
    email: identity.email,
    email_confirmed_at: exchanged.confirmed
      ? new Date(now).toISOString()
      : null,
    role: "authenticated",
    user_metadata: userMetadata,
  };

  const session: PrivateSession = {
    v: 1,
    googleRefreshToken: identity.refreshToken,
    appAccessToken: exchanged.token,
    appAccessExpiresAt: now + exchanged.expiresIn * 1000,
    user,
    expiresAt: now + ABSOLUTE_SESSION_MS,
  };

  const sessionId = cfg.newSessionId();

  try {
    await cfg.createSession(sessionId, session);
  } catch {
    return json({ error: "Could not start your session" }, 503);
  }

  return json(
    {
      session: safeSession(session),
    },
    200,
    {
      "Set-Cookie": makeSessionCookie(
        sessionId,
        Math.floor(ABSOLUTE_SESSION_MS / 1000),
      ),
    },
  );
}

async function refreshStoredSession(
  sessionId: string,
  session: PrivateSession,
  cfg: ReturnType<typeof config>,
): Promise<PrivateSession> {
  if (!cfg.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is missing");
  }

  const response = await cfg.fetcher(
    `${SECURETOKEN}?key=${encodeURIComponent(cfg.googleApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.googleRefreshToken,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Google refresh rejected");
  }

  const refreshed = await response.json() as {
    id_token?: unknown;
    refresh_token?: unknown;
  };

  if (
    typeof refreshed.id_token !== "string" ||
    typeof refreshed.refresh_token !== "string"
  ) {
    throw new Error("Google returned invalid refresh response");
  }

  const exchanged = await exchangeAppToken(refreshed.id_token, cfg);

  if (exchanged.subject !== session.user.id) {
    throw new Error("refreshed identity changed subject");
  }

  const next: PrivateSession = {
    ...session,
    googleRefreshToken: refreshed.refresh_token,
    appAccessToken: exchanged.token,
    appAccessExpiresAt: cfg.now() + exchanged.expiresIn * 1000,
  };

  await cfg.updateSession(sessionId, next);

  return next;
}

/*
 * How long one successful "is this account still allowed" answer is trusted for a session.
 * Short on purpose: it is the upper bound on how long a suspended account could keep working
 * if the database triggers of migration 101 were missing.
 */
export const ACCOUNT_RECHECK_MS = 30_000;
const ACCOUNT_CHECK_ENTRIES = 5_000;
const accountCheckedAt = new Map<string, number>();

function rememberAccountCheck(sessionId: string, at: number): void {
  // Bounded: the oldest entry goes first. Losing one only costs an extra check.
  if (accountCheckedAt.size >= ACCOUNT_CHECK_ENTRIES) {
    const oldest = accountCheckedAt.keys().next().value;
    if (oldest !== undefined) accountCheckedAt.delete(oldest);
  }
  accountCheckedAt.delete(sessionId);
  accountCheckedAt.set(sessionId, at);
}

/** Tests only: forget every remembered account check. */
export function resetAccountRecheckCache(): void {
  accountCheckedAt.clear();
}

export async function resolveAuthenticatedSession(
  req: Request,
  deps: AuthRouteDeps = {},
): Promise<{ sessionId: string; session: PrivateSession } | null> {
  const cfg = config(deps);
  const sessionId = readSessionCookie(req);

  if (!sessionId) return null;

  let session = await cfg.loadSession(sessionId);

  if (!session) return null;

  /*
   * A session is only as good as the account behind it NOW. An administrator may have suspended
   * the college or company, removed the student or changed the role since the cookie was issued,
   * so the rule that gates sign-in (web_login_identity) also gates the use of a session.
   *
   * Two layers. The database revokes the session row itself the moment the account stops being
   * allowed (migration 101), and that row is read just above on every request, so suspension is
   * immediate at no extra cost. This re-check is the safety net for anything the triggers do not
   * cover and for a database where 101 is not applied yet. It asks at most once per
   * ACCOUNT_RECHECK_MS for each session, so the worst case without the triggers is that long.
   *
   * If the rule cannot be asked this throws and every caller answers 503: fail closed, never
   * "allowed because we could not check". A failed check is not remembered.
   */
  const checkedAt = accountCheckedAt.get(sessionId);

  if (
    checkedAt === undefined ||
    cfg.now() - checkedAt >= ACCOUNT_RECHECK_MS ||
    cfg.now() < checkedAt
  ) {
    const identity = await cfg.loadLoginIdentity(session.user.id);

    if (
      identity.allowed !== true ||
      identity.role !== session.user.user_metadata?.account_type
    ) {
      accountCheckedAt.delete(sessionId);

      try {
        await cfg.revokeSession(sessionId);
      } catch {
        // Best effort. The session is refused either way.
      }

      return null;
    }

    rememberAccountCheck(sessionId, cfg.now());
  }

  if (
    session.appAccessExpiresAt - cfg.now() <
      REFRESH_MARGIN_MS
  ) {
    try {
      session = await refreshStoredSession(
        sessionId,
        session,
        cfg,
      );
    } catch {
      try {
        await cfg.revokeSession(sessionId);
      } catch {
        // Best effort. Caller treats the session as signed out.
      }

      return null;
    }
  }

  return {
    sessionId,
    session,
  };
}

async function currentSession(
  req: Request,
  deps: AuthRouteDeps,
): Promise<Response> {
  let resolved: {
    sessionId: string;
    session: PrivateSession;
  } | null;

  try {
    resolved = await resolveAuthenticatedSession(req, deps);
  } catch {
    return json({ error: "session service unavailable" }, 503);
  }

  if (!resolved) {
    return json(
      { session: null },
      200,
      { "Set-Cookie": clearSessionCookie() },
    );
  }

  return json({
    session: safeSession(resolved.session),
  });
}

async function logout(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  const sessionId = readSessionCookie(req);

  if (sessionId) {
    try {
      await cfg.revokeSession(sessionId);
    } catch {
      return json(
        { error: "Could not complete logout" },
        503,
        { "Set-Cookie": clearSessionCookie() },
      );
    }
  }

  return json(
    { ok: true },
    200,
    { "Set-Cookie": clearSessionCookie() },
  );
}

async function googleIdentityAction(
  path: string,
  body: Record<string, unknown>,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  if (!cfg.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is missing");
  }

  return await cfg.fetcher(
    `${IDENTITY}/accounts:${path}?key=${encodeURIComponent(cfg.googleApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

/*
 * The website address to put in emailed links. Firebase Hosting rewrites /api/** to this
 * service, so req.url is the service's own run.app address, which Identity Platform does not
 * allowlist: sendOobCode answers UNAUTHORIZED_DOMAIN and no email is sent. The browser's Origin
 * is the website address, and main.ts has already refused any Origin not in BROWSER_ORIGINS.
 */
function siteOrigin(req: Request): string {
  const origin = req.headers.get("Origin");

  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      // Not a URL: fall back to this service's own address.
    }
  }

  return new URL(req.url).origin;
}

async function requestPasswordReset(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  let input: { email?: unknown };

  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }

  if (
    typeof input.email !== "string" ||
    !input.email.trim()
  ) {
    return json({ error: "email is required" }, 400);
  }

  if (!cfg.googleApiKey) {
    return json(
      { error: "authentication unavailable" },
      503,
    );
  }

  const origin = siteOrigin(req);

  try {
    const sent = await googleIdentityAction(
      "sendOobCode",
      {
        requestType: "PASSWORD_RESET",
        email: input.email.trim(),
        continueUrl: `${origin}/reset-password`,
      },
      cfg,
    );

    // The answer to the browser stays the same either way (no account enumeration), but a
    // refusal must reach the server log: it used to vanish, and the screen still said "sent".
    if (!sent.ok) {
      const body = await sent.json().catch(() => ({})) as {
        error?: { message?: unknown };
      };
      console.error(
        "password reset email not sent:",
        sent.status,
        String(body.error?.message ?? "unknown"),
      );
    }
  } catch {
    return json(
      { error: "password reset service unavailable" },
      503,
    );
  }

  // Deliberately return the same response whether the address exists or not.
  // This prevents account enumeration.
  return json({ ok: true });
}

async function verifyPasswordReset(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  let input: { oob_code?: unknown };

  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }

  if (
    typeof input.oob_code !== "string" ||
    !input.oob_code.trim()
  ) {
    return json({ error: "reset code is required" }, 400);
  }

  let response: Response;

  try {
    response = await googleIdentityAction(
      "resetPassword",
      {
        oobCode: input.oob_code.trim(),
      },
      cfg,
    );
  } catch {
    return json(
      { error: "password reset service unavailable" },
      503,
    );
  }

  if (!response.ok) {
    return json(
      { error: "That reset link is invalid or has expired" },
      400,
    );
  }

  const body = await response.json().catch(() => ({})) as {
    email?: unknown;
    requestType?: unknown;
  };

  if (body.requestType !== "PASSWORD_RESET") {
    return json(
      { error: "That reset link is invalid or has expired" },
      400,
    );
  }

  return json({
    ok: true,
    email: typeof body.email === "string" ? body.email : null,
  });
}

async function completePasswordReset(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  let input: {
    oob_code?: unknown;
    new_password?: unknown;
  };

  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }

  if (
    typeof input.oob_code !== "string" ||
    !input.oob_code.trim()
  ) {
    return json({ error: "reset code is required" }, 400);
  }

  if (
    typeof input.new_password !== "string" ||
    input.new_password.length < 6
  ) {
    return json(
      { error: "Password should be at least 6 characters" },
      400,
    );
  }

  let response: Response;

  try {
    response = await googleIdentityAction(
      "resetPassword",
      {
        oobCode: input.oob_code.trim(),
        newPassword: input.new_password,
      },
      cfg,
    );
  } catch {
    return json(
      { error: "password reset service unavailable" },
      503,
    );
  }

  if (!response.ok) {
    return json(
      { error: "That reset link is invalid or has expired" },
      400,
    );
  }

  return json({ ok: true });
}

async function confirmEmail(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  let input: { oob_code?: unknown };

  try {
    input = await req.json();
  } catch {
    return json({ error: "invalid request" }, 400);
  }

  if (
    typeof input.oob_code !== "string" ||
    !input.oob_code.trim()
  ) {
    return json(
      { error: "verification code is required" },
      400,
    );
  }

  let response: Response;

  try {
    response = await googleIdentityAction(
      "update",
      {
        oobCode: input.oob_code.trim(),
      },
      cfg,
    );
  } catch {
    return json(
      { error: "email verification service unavailable" },
      503,
    );
  }

  if (!response.ok) {
    return json(
      {
        error: "That verification link is invalid or has expired",
      },
      400,
    );
  }

  return json({ ok: true });
}

async function refreshGoogleForAction(
  sessionId: string,
  session: PrivateSession,
  cfg: ReturnType<typeof config>,
): Promise<{
  idToken: string;
  session: PrivateSession;
}> {
  if (!cfg.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is missing");
  }

  const response = await cfg.fetcher(
    `${SECURETOKEN}?key=${encodeURIComponent(cfg.googleApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.googleRefreshToken,
      }),
    },
  );

  if (!response.ok) {
    throw new Error("Google refresh rejected");
  }

  const refreshed = await response.json() as {
    id_token?: unknown;
    refresh_token?: unknown;
  };

  if (
    typeof refreshed.id_token !== "string" ||
    typeof refreshed.refresh_token !== "string"
  ) {
    throw new Error(
      "Google returned invalid refresh response",
    );
  }

  const exchanged = await exchangeAppToken(
    refreshed.id_token,
    cfg,
  );

  if (exchanged.subject !== session.user.id) {
    throw new Error(
      "refreshed identity changed subject",
    );
  }

  const next: PrivateSession = {
    ...session,
    googleRefreshToken: refreshed.refresh_token,
    appAccessToken: exchanged.token,
    appAccessExpiresAt: cfg.now() +
      exchanged.expiresIn * 1000,
  };

  await cfg.updateSession(
    sessionId,
    next,
  );

  return {
    idToken: refreshed.id_token,
    session: next,
  };
}

async function updateCurrentUser(
  req: Request,
  deps: AuthRouteDeps,
): Promise<Response> {
  const cfg = config(deps);

  let resolved;

  try {
    resolved = await resolveAuthenticatedSession(
      req,
      deps,
    );
  } catch {
    return json(
      {
        error: "session service unavailable",
      },
      503,
    );
  }

  if (!resolved) {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  }

  let input: {
    password?: unknown;
    email?: unknown;
    data?: unknown;
  };

  try {
    input = await req.json();
  } catch {
    return json(
      { error: "invalid request" },
      400,
    );
  }

  const password = typeof input.password === "string"
    ? input.password
    : undefined;

  // Security gate 14 Oct (run-1 P1): the login email is never changed here. Identity Platform would rebind
  // the login to an address nobody proved (no verify-before-change flow), and no screen changes email:
  // accounts are managed, so an administrator changes it. Refused before any provider call.
  if (input.email !== undefined) {
    return json(
      { error: "the login email can only be changed by an administrator" },
      400,
    );
  }
  const rawData = input.data &&
      typeof input.data === "object" &&
      !Array.isArray(input.data)
    ? input.data as Record<
      string,
      unknown
    >
    : {};

  if (
    password === undefined &&
    Object.keys(rawData).length === 0
  ) {
    return json(
      { error: "nothing to update" },
      400,
    );
  }

  if (
    password !== undefined &&
    password.length < 6
  ) {
    return json(
      {
        error: "Password should be at least 6 characters",
      },
      400,
    );
  }

  const safeData: Record<string, unknown> = {};

  if (
    typeof rawData.full_name === "string"
  ) {
    const name = rawData.full_name.trim();

    if (
      name &&
      name.length <= 120
    ) {
      safeData.full_name = name;
    }
  }

  if (
    typeof rawData.onboarded === "boolean"
  ) {
    safeData.onboarded = rawData.onboarded;
  }

  let action;

  try {
    action = await refreshGoogleForAction(
      resolved.sessionId,
      resolved.session,
      cfg,
    );
  } catch {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  }

  const providerBody: Record<string, unknown> = {
    idToken: action.idToken,
    returnSecureToken: true,
  };

  if (password !== undefined) {
    providerBody.password = password;
  }

  if (
    typeof safeData.full_name === "string"
  ) {
    providerBody.displayName = safeData.full_name;
  }

  let providerResponse: Response | null = null;

  // Metadata-only updates do not need a Google
  // account mutation unless displayName changes.
  if (
    password !== undefined ||
    typeof safeData.full_name === "string"
  ) {
    try {
      providerResponse = await googleIdentityAction(
        "update",
        providerBody,
        cfg,
      );
    } catch {
      return json(
        {
          error: "Could not update your account",
        },
        503,
      );
    }

    if (!providerResponse.ok) {
      return json(
        {
          error: "Could not update your account",
        },
        400,
      );
    }
  }

  let next = action.session;

  let nextIdToken: string | null = null;

  if (providerResponse) {
    const provider = await providerResponse
      .json()
      .catch(() => ({})) as {
        idToken?: unknown;
        refreshToken?: unknown;
        email?: unknown;
      };

    if (
      typeof provider.idToken ===
        "string"
    ) {
      nextIdToken = provider.idToken;
    }

    if (
      typeof provider.refreshToken ===
        "string"
    ) {
      next = {
        ...next,
        googleRefreshToken: provider.refreshToken,
      };
    }
  }

  if (nextIdToken) {
    try {
      const exchanged = await exchangeAppToken(
        nextIdToken,
        cfg,
      );

      if (
        exchanged.subject !==
          next.user.id
      ) {
        throw new Error(
          "updated identity changed subject",
        );
      }

      next = {
        ...next,
        appAccessToken: exchanged.token,
        appAccessExpiresAt: cfg.now() +
          exchanged.expiresIn *
            1000,
      };
    } catch {
      return json(
        {
          error: "Could not refresh your secure session",
        },
        503,
      );
    }
  }

  next = {
    ...next,
    user: {
      ...next.user,
      user_metadata: {
        ...next.user.user_metadata,
        ...safeData,
      },
    },
  };

  try {
    await cfg.updateSession(
      resolved.sessionId,
      next,
    );
  } catch {
    return json(
      {
        error: "Could not save your secure session",
      },
      503,
    );
  }

  return json({
    user: next.user,
  });
}

async function resendVerification(
  req: Request,
  deps: AuthRouteDeps,
): Promise<Response> {
  const cfg = config(deps);

  let resolved;

  try {
    resolved = await resolveAuthenticatedSession(
      req,
      deps,
    );
  } catch {
    return json(
      {
        error: "session service unavailable",
      },
      503,
    );
  }

  if (!resolved) {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  }

  let input: {
    account_type?: unknown;
  } = {};

  try {
    input = await req.json();
  } catch {
    // account_type is optional.
  }

  const requested = typeof input.account_type ===
      "string"
    ? input.account_type
    : "";

  const allowedRoles = new Set([
    "student",
    "college_admin",
    "startup",
  ]);

  const accountType = allowedRoles.has(requested) ? requested : "student";

  let action;

  try {
    action = await refreshGoogleForAction(
      resolved.sessionId,
      resolved.session,
      cfg,
    );
  } catch {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie": clearSessionCookie(),
      },
    );
  }

  const origin = siteOrigin(req);

  let response: Response;

  try {
    response = await googleIdentityAction(
      "sendOobCode",
      {
        requestType: "VERIFY_EMAIL",
        idToken: action.idToken,
        continueUrl: `${origin}/auth/callback?type=${
          encodeURIComponent(
            accountType,
          )
        }`,
      },
      cfg,
    );
  } catch {
    return json(
      {
        error: "Could not resend verification email",
      },
      503,
    );
  }

  if (!response.ok) {
    return json(
      {
        error: "Could not resend verification email",
      },
      400,
    );
  }

  return json({ ok: true });
}

export async function handleAuthRoute(
  req: Request,
  deps: AuthRouteDeps = {},
): Promise<Response | null> {
  const url = new URL(req.url);
  const cfg = config(deps);

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/login"
  ) {
    return await login(req, cfg);
  }

  if (
    req.method === "GET" &&
    url.pathname === "/api/auth/session"
  ) {
    return await currentSession(req, deps);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/logout"
  ) {
    return await logout(req, cfg);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/password-reset/request"
  ) {
    return await requestPasswordReset(req, cfg);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/password-reset/verify"
  ) {
    return await verifyPasswordReset(req, cfg);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/password-reset/complete"
  ) {
    return await completePasswordReset(req, cfg);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/verify-email"
  ) {
    return await confirmEmail(req, cfg);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/signup"
  ) {
    return json(
      {
        error:
          "Account creation is managed by your college or platform administrator",
      },
      403,
    );
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/update"
  ) {
    return await updateCurrentUser(req, deps);
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/auth/resend-verification"
  ) {
    return await resendVerification(req, deps);
  }

  return null;
}
