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

  const response = await deps.fetcher(`${deps.postgrest}/web_sessions`, {
    method: "POST",
    headers: await headers(deps, {
      Prefer: "return=minimal",
    }),
    body: JSON.stringify({
      session_hash: sessionHash,
      user_id: session.user.id,
      encrypted_payload: encryptedPayload,
      created_at: nowIso,
      last_seen_at: nowIso,
      expires_at: new Date(session.expiresAt).toISOString(),
      revoked_at: null,
    }),
  });

  if (!response.ok) {
    throw new Error(`could not create browser session: ${response.status}`);
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
