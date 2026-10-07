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
  loadSessionRecord,
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

export interface AuthRouteDeps {
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => number;
  newSessionId?: () => string;

  createSession?: CreateSession;
  loadSession?: LoadSession;
  updateSession?: UpdateSession;
  revokeSession?: RevokeSession;
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
  };
}

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
  } catch {
    return json({ error: "Could not start your session" }, 503);
  }

  const now = cfg.now();

  const user: SessionUser = {
    id: exchanged.subject,
    email: identity.email,
    email_confirmed_at: exchanged.confirmed
      ? new Date(now).toISOString()
      : null,
    role: "authenticated",
    user_metadata: {
      email: identity.email,
    },
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

export async function resolveAuthenticatedSession(
  req: Request,
  deps: AuthRouteDeps = {},
): Promise<{ sessionId: string; session: PrivateSession } | null> {
  const cfg = config(deps);
  const sessionId = readSessionCookie(req);

  if (!sessionId) return null;

  let session = await cfg.loadSession(sessionId);

  if (!session) return null;

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
    `${IDENTITY}/accounts:${path}?key=${
      encodeURIComponent(cfg.googleApiKey)
    }`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
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

  const origin = new URL(req.url).origin;

  try {
    await googleIdentityAction(
      "sendOobCode",
      {
        requestType: "PASSWORD_RESET",
        email: input.email.trim(),
        continueUrl: `${origin}/reset-password`,
      },
      cfg,
    );
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
    email:
      typeof body.email === "string"
        ? body.email
        : null,
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
        error:
          "That verification link is invalid or has expired",
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
    `${SECURETOKEN}?key=${
      encodeURIComponent(cfg.googleApiKey)
    }`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token:
          session.googleRefreshToken,
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
    googleRefreshToken:
      refreshed.refresh_token,
    appAccessToken: exchanged.token,
    appAccessExpiresAt:
      cfg.now() +
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

async function signup(
  req: Request,
  cfg: ReturnType<typeof config>,
): Promise<Response> {
  let input: {
    email?: unknown;
    password?: unknown;
    full_name?: unknown;
    account_type?: unknown;
  };

  try {
    input = await req.json();
  } catch {
    return json(
      { error: "invalid request" },
      400,
    );
  }

  const email =
    typeof input.email === "string"
      ? input.email.trim()
      : "";

  const password =
    typeof input.password === "string"
      ? input.password
      : "";

  const fullName =
    typeof input.full_name === "string"
      ? input.full_name.trim()
      : "";

  const accountType =
    typeof input.account_type === "string"
      ? input.account_type
      : "";

  const allowedRoles = new Set([
    "student",
    "college_admin",
    "startup",
  ]);

  if (
    !email ||
    !email.includes("@") ||
    password.length < 6 ||
    !fullName ||
    fullName.length > 120 ||
    !allowedRoles.has(accountType)
  ) {
    return json(
      { error: "invalid signup details" },
      400,
    );
  }

  if (!cfg.googleApiKey) {
    return json(
      { error: "authentication unavailable" },
      503,
    );
  }

  let response: Response;

  try {
    response = await googleIdentityAction(
      "signUp",
      {
        email,
        password,
        returnSecureToken: true,
      },
      cfg,
    );
  } catch {
    return json(
      { error: "authentication unavailable" },
      503,
    );
  }

  if (!response.ok) {
    const provider =
      await response.json().catch(() => ({})) as {
        error?: {
          message?: unknown;
        };
      };

    const code =
      typeof provider.error?.message === "string"
        ? provider.error.message
        : "";

    if (code.startsWith("EMAIL_EXISTS")) {
      return json(
        {
          error:
            "An account with this email already exists",
        },
        409,
      );
    }

    if (code.startsWith("WEAK_PASSWORD")) {
      return json(
        {
          error:
            "Password should be at least 6 characters",
        },
        400,
      );
    }

    if (code.startsWith("TOO_MANY_ATTEMPTS")) {
      return json(
        {
          error:
            "Too many attempts. Please wait and try again",
        },
        429,
      );
    }

    return json(
      { error: "Could not create account" },
      400,
    );
  }

  const created = await response.json() as {
    email?: unknown;
    idToken?: unknown;
    refreshToken?: unknown;
  };

  if (
    typeof created.idToken !== "string" ||
    typeof created.refreshToken !== "string" ||
    typeof created.email !== "string"
  ) {
    return json(
      { error: "authentication unavailable" },
      503,
    );
  }

  let idToken = created.idToken;
  let refreshToken = created.refreshToken;

  // Store the display name with Google when possible.
  try {
    const updated =
      await googleIdentityAction(
        "update",
        {
          idToken,
          displayName: fullName,
          returnSecureToken: true,
        },
        cfg,
      );

    if (updated.ok) {
      const body =
        await updated.json() as {
          idToken?: unknown;
          refreshToken?: unknown;
        };

      if (typeof body.idToken === "string") {
        idToken = body.idToken;
      }

      if (
        typeof body.refreshToken === "string"
      ) {
        refreshToken =
          body.refreshToken;
      }
    }
  } catch {
    // Display name is helpful metadata,
    // not a reason to destroy a valid signup.
  }

  const origin = new URL(req.url).origin;

  // Verification mail is best effort, matching
  // the application's existing signup behaviour.
  try {
    await googleIdentityAction(
      "sendOobCode",
      {
        requestType: "VERIFY_EMAIL",
        idToken,
        continueUrl:
          `${origin}/auth/callback?type=${
            encodeURIComponent(accountType)
          }`,
      },
      cfg,
    );
  } catch {
    // Resend is available after signup.
  }

  let exchanged;

  try {
    exchanged =
      await exchangeAppToken(
        idToken,
        cfg,
      );
  } catch {
    return json(
      {
        error:
          "Account created, but the secure session could not start. Please sign in to continue",
      },
      503,
    );
  }

  const now = cfg.now();

  const user: SessionUser = {
    id: exchanged.subject,
    email: created.email,
    email_confirmed_at:
      exchanged.confirmed
        ? new Date(now).toISOString()
        : null,
    role: "authenticated",
    user_metadata: {
      email: created.email,
      full_name: fullName,
      account_type: accountType,
    },
  };

  const session: PrivateSession = {
    v: 1,
    googleRefreshToken:
      refreshToken,
    appAccessToken:
      exchanged.token,
    appAccessExpiresAt:
      now +
      exchanged.expiresIn * 1000,
    user,
    expiresAt:
      now +
      ABSOLUTE_SESSION_MS,
  };

  const sessionId =
    cfg.newSessionId();

  try {
    await cfg.createSession(
      sessionId,
      session,
    );
  } catch {
    return json(
      {
        error:
          "Account created, but the secure session could not start. Please sign in to continue",
      },
      503,
    );
  }

  return json(
    {
      session:
        safeSession(session),
    },
    200,
    {
      "Set-Cookie":
        makeSessionCookie(
          sessionId,
          Math.floor(
            ABSOLUTE_SESSION_MS /
              1000,
          ),
        ),
    },
  );
}

async function updateCurrentUser(
  req: Request,
  deps: AuthRouteDeps,
): Promise<Response> {
  const cfg = config(deps);

  let resolved;

  try {
    resolved =
      await resolveAuthenticatedSession(
        req,
        deps,
      );
  } catch {
    return json(
      {
        error:
          "session service unavailable",
      },
      503,
    );
  }

  if (!resolved) {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie":
          clearSessionCookie(),
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

  const password =
    typeof input.password === "string"
      ? input.password
      : undefined;

  const email =
    typeof input.email === "string"
      ? input.email.trim()
      : undefined;

  const rawData =
    input.data &&
      typeof input.data === "object" &&
      !Array.isArray(input.data)
      ? input.data as Record<
          string,
          unknown
        >
      : {};

  if (
    password === undefined &&
    email === undefined &&
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
        error:
          "Password should be at least 6 characters",
      },
      400,
    );
  }

  if (
    email !== undefined &&
    (!email || !email.includes("@"))
  ) {
    return json(
      {
        error:
          "That email address is not valid",
      },
      400,
    );
  }

  const safeData:
    Record<string, unknown> = {};

  if (
    typeof rawData.full_name === "string"
  ) {
    const name =
      rawData.full_name.trim();

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
    safeData.onboarded =
      rawData.onboarded;
  }

  let action;

  try {
    action =
      await refreshGoogleForAction(
        resolved.sessionId,
        resolved.session,
        cfg,
      );
  } catch {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie":
          clearSessionCookie(),
      },
    );
  }

  const providerBody:
    Record<string, unknown> = {
      idToken: action.idToken,
      returnSecureToken: true,
  };

  if (password !== undefined) {
    providerBody.password =
      password;
  }

  if (email !== undefined) {
    providerBody.email =
      email;
  }

  if (
    typeof safeData.full_name === "string"
  ) {
    providerBody.displayName =
      safeData.full_name;
  }

  let providerResponse:
    Response | null = null;

  // Metadata-only updates do not need a Google
  // account mutation unless displayName changes.
  if (
    password !== undefined ||
    email !== undefined ||
    typeof safeData.full_name === "string"
  ) {
    try {
      providerResponse =
        await googleIdentityAction(
          "update",
          providerBody,
          cfg,
        );
    } catch {
      return json(
        {
          error:
            "Could not update your account",
        },
        503,
      );
    }

    if (!providerResponse.ok) {
      return json(
        {
          error:
            "Could not update your account",
        },
        400,
      );
    }
  }

  let next =
    action.session;

  let nextIdToken:
    string | null = null;

  if (providerResponse) {
    const provider =
      await providerResponse
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
      nextIdToken =
        provider.idToken;
    }

    if (
      typeof provider.refreshToken ===
        "string"
    ) {
      next = {
        ...next,
        googleRefreshToken:
          provider.refreshToken,
      };
    }
  }

  if (nextIdToken) {
    try {
      const exchanged =
        await exchangeAppToken(
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
        appAccessToken:
          exchanged.token,
        appAccessExpiresAt:
          cfg.now() +
          exchanged.expiresIn *
            1000,
      };
    } catch {
      return json(
        {
          error:
            "Could not refresh your secure session",
        },
        503,
      );
    }
  }

  next = {
    ...next,
    user: {
      ...next.user,
      ...(email !== undefined
        ? {
            email,
            email_confirmed_at:
              null,
          }
        : {}),
      user_metadata: {
        ...next.user.user_metadata,
        ...safeData,
        ...(email !== undefined
          ? { email }
          : {}),
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
        error:
          "Could not save your secure session",
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
    resolved =
      await resolveAuthenticatedSession(
        req,
        deps,
      );
  } catch {
    return json(
      {
        error:
          "session service unavailable",
      },
      503,
    );
  }

  if (!resolved) {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie":
          clearSessionCookie(),
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

  const requested =
    typeof input.account_type ===
      "string"
      ? input.account_type
      : "";

  const allowedRoles = new Set([
    "student",
    "college_admin",
    "startup",
  ]);

  const accountType =
    allowedRoles.has(requested)
      ? requested
      : "student";

  let action;

  try {
    action =
      await refreshGoogleForAction(
        resolved.sessionId,
        resolved.session,
        cfg,
      );
  } catch {
    return json(
      { error: "not authenticated" },
      401,
      {
        "Set-Cookie":
          clearSessionCookie(),
      },
    );
  }

  const origin =
    new URL(req.url).origin;

  let response: Response;

  try {
    response =
      await googleIdentityAction(
        "sendOobCode",
        {
          requestType:
            "VERIFY_EMAIL",
          idToken:
            action.idToken,
          continueUrl:
            `${origin}/auth/callback?type=${
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
        error:
          "Could not resend verification email",
      },
      503,
    );
  }

  if (!response.ok) {
    return json(
      {
        error:
          "Could not resend verification email",
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
    return await signup(req, cfg);
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
