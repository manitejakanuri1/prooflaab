import { bridgeServiceToken } from "./serviceToken.ts";
import {
  hashSessionId,
  type PrivateSession,
  sealSession,
  unsealSession,
} from "./session.ts";

interface Env {
  get(name: string): string | undefined;
}

interface SessionStoreDeps {
  env?: Env;
  fetcher?: typeof fetch;
  serviceToken?: () => Promise<string>;
  now?: () => number;
}

interface StoredSessionRow {
  encrypted_payload: string;
  expires_at: string;
  revoked_at?: string | null;
}

export interface ManagedLoginIdentity {
  allowed: boolean;
  reason?: string;
  role?: string;
  full_name?: string | null;
  account_type?: string;
  has_completed_wizard?: boolean;
  college_id?: string | null;
  onboarding_status?: string | null;
}

function config(deps: SessionStoreDeps) {
  const env = deps.env ?? Deno.env;
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now ?? Date.now;

  const postgrest = (env.get("POSTGREST_URL") ?? "").replace(/\/+$/, "");
  const sessionKey = env.get("SESSION_KEY") ?? "";

  if (!postgrest) {
    throw new Error("POSTGREST_URL is missing");
  }

  if (!sessionKey) {
    throw new Error("SESSION_KEY is missing");
  }

  const token = deps.serviceToken
    ? deps.serviceToken
    : () => bridgeServiceToken(env, fetcher);

  return {
    env,
    fetcher,
    now,
    postgrest,
    sessionKey,
    token,
  };
}

async function headers(
  deps: ReturnType<typeof config>,
  extra: Record<string, string> = {},
): Promise<Headers> {
  const token = await deps.token();

  return new Headers({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  });
}

function rowUrl(base: string, sessionHash: string): string {
  const q = new URLSearchParams({
    session_hash: `eq.${sessionHash}`,
  });

  return `${base}/web_sessions?${q.toString()}`;
}

export async function loadManagedLoginIdentity(
  userId: string,
  depsInput: SessionStoreDeps = {},
): Promise<ManagedLoginIdentity> {
  const deps = config(depsInput);

  const response = await deps.fetcher(
    `${deps.postgrest}/rpc/web_login_identity`,
    {
      method: "POST",
      headers: await headers(deps),
      body: JSON.stringify({
        _user_id: userId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `could not resolve managed login identity: ${response.status}`,
    );
  }

  const body = await response.json();

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new Error("invalid managed login identity");
  }

  const value = body as Record<string, unknown>;

  return {
    allowed: value.allowed === true,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    role: typeof value.role === "string" ? value.role : undefined,
    full_name: typeof value.full_name === "string" ? value.full_name : null,
    account_type: typeof value.account_type === "string"
      ? value.account_type
      : undefined,
    has_completed_wizard: value.has_completed_wizard === true,
    college_id: typeof value.college_id === "string" ? value.college_id : null,
    onboarding_status: typeof value.onboarding_status === "string"
      ? value.onboarding_status
      : null,
  };
}

/**
 * Persist a new browser session.
 *
 * Only SHA-256(session id) and AES-GCM encrypted credentials enter the DB.
 * The raw browser cookie value is never stored.
 */
export async function createSessionRecord(
  sessionId: string,
  session: PrivateSession,
  depsInput: SessionStoreDeps = {},
): Promise<void> {
  const deps = config(depsInput);
  const sessionHash = await hashSessionId(sessionId);
  const encryptedPayload = await sealSession(session, deps.sessionKey);
  const nowIso = new Date(deps.now()).toISOString();

  const response = await deps.fetcher(
    `${deps.postgrest}/rpc/web_replace_session`,
    {
      method: "POST",
      headers: await headers(deps, {
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({
        _session_hash: sessionHash,
        _user_id: session.user.id,
        _encrypted_payload: encryptedPayload,
        _created_at: nowIso,
        _expires_at: new Date(session.expiresAt).toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `could not replace browser session: ${response.status}`,
    );
  }
}

/**
 * Resolve the opaque cookie to its encrypted server-side session.
 *
 * Revoked, missing, corrupted and expired sessions all behave as signed out.
 */
export async function loadSessionRecord(
  sessionId: string,
  depsInput: SessionStoreDeps = {},
): Promise<PrivateSession | null> {
  const deps = config(depsInput);
  const sessionHash = await hashSessionId(sessionId);

  const query = new URLSearchParams({
    session_hash: `eq.${sessionHash}`,
    revoked_at: "is.null",
    select: "encrypted_payload,expires_at,revoked_at",
    limit: "1",
  });

  const response = await deps.fetcher(
    `${deps.postgrest}/web_sessions?${query.toString()}`,
    {
      method: "GET",
      headers: await headers(deps, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`could not read browser session: ${response.status}`);
  }

  const rows = await response.json() as StoredSessionRow[];

  if (!Array.isArray(rows) || rows.length !== 1) {
    return null;
  }

  const row = rows[0];

  if (
    typeof row.encrypted_payload !== "string" ||
    row.revoked_at
  ) {
    return null;
  }

  const opened = await unsealSession(
    row.encrypted_payload,
    deps.sessionKey,
    deps.now(),
  );

  if (!opened) {
    return null;
  }

  return opened;
}

/**
 * Replace encrypted credentials after token refresh and update last_seen_at.
 */
export async function updateSessionRecord(
  sessionId: string,
  session: PrivateSession,
  depsInput: SessionStoreDeps = {},
): Promise<void> {
  const deps = config(depsInput);
  const sessionHash = await hashSessionId(sessionId);
  const encryptedPayload = await sealSession(session, deps.sessionKey);

  const response = await deps.fetcher(
    rowUrl(deps.postgrest, sessionHash),
    {
      method: "PATCH",
      headers: await headers(deps, {
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({
        user_id: session.user.id,
        encrypted_payload: encryptedPayload,
        last_seen_at: new Date(deps.now()).toISOString(),
        expires_at: new Date(session.expiresAt).toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`could not update browser session: ${response.status}`);
  }
}

/**
 * Server-side logout.
 *
 * We revoke instead of deleting immediately so security/audit tooling can
 * distinguish a deliberate logout from an unknown session id.
 */
export async function revokeSessionRecord(
  sessionId: string,
  depsInput: SessionStoreDeps = {},
): Promise<void> {
  const deps = config(depsInput);
  const sessionHash = await hashSessionId(sessionId);

  const response = await deps.fetcher(
    rowUrl(deps.postgrest, sessionHash),
    {
      method: "PATCH",
      headers: await headers(deps, {
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({
        revoked_at: new Date(deps.now()).toISOString(),
        last_seen_at: new Date(deps.now()).toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`could not revoke browser session: ${response.status}`);
  }
}

export interface LoginGate {
  allowed: boolean;
  reason?: string;
  retry_after?: number;
}

/**
 * Asks the database whether this email and address may try a password now (migration 156).
 * Throws when the answer cannot be read: the caller refuses the sign-in rather than letting it through.
 */
export async function checkLoginGate(
  email: string,
  ip: string,
  depsInput: SessionStoreDeps = {},
): Promise<LoginGate> {
  const deps = config(depsInput);

  const response = await deps.fetcher(`${deps.postgrest}/rpc/web_login_gate`, {
    method: "POST",
    headers: await headers(deps),
    body: JSON.stringify({ _email: email, _ip: ip }),
  });

  if (!response.ok) {
    throw new Error(`could not check sign-in limits: ${response.status}`);
  }

  const body = await response.json() as Record<string, unknown> | null;

  if (!body || typeof body.allowed !== "boolean") {
    throw new Error("invalid sign-in limit answer");
  }

  return {
    allowed: body.allowed,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    retry_after: typeof body.retry_after === "number" ? body.retry_after : undefined,
  };
}

export interface SecurityEvent {
  event_type: string;
  severity: "info" | "warning" | "critical";
  user_id?: string | null;
  email?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  detail?: Record<string, unknown>;
}

/** Writes one security event as the server (source 'server'), never on a browser's word. */
export async function writeSecurityEvent(
  event: SecurityEvent,
  depsInput: SessionStoreDeps = {},
): Promise<void> {
  const deps = config(depsInput);

  const response = await deps.fetcher(`${deps.postgrest}/rpc/log_security_event`, {
    method: "POST",
    headers: await headers(deps),
    body: JSON.stringify({
      p_event_type: event.event_type,
      p_severity: event.severity,
      p_source: "server",
      p_user_id: event.user_id ?? null,
      p_email: event.email ?? null,
      p_ip: event.ip ?? null,
      p_user_agent: event.user_agent ?? null,
      p_detail: event.detail ?? {},
    }),
  });

  if (!response.ok) {
    throw new Error(`could not write security event: ${response.status}`);
  }
}
