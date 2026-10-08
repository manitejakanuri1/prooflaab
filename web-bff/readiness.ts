import {
  generateSessionId,
  type PrivateSession,
  sealSession,
} from "./session.ts";
import { loadSessionRecord } from "./sessionStore.ts";

/*
 * /ready is fail-closed. It answers ready only when ALL of these hold:
 *
 *   1. the release is explicitly enabled (BFF_RELEASE_READY is exactly "true");
 *   2. every setting the gateway needs is present and well formed;
 *   3. every backend it routes to answered its own health contract just now.
 *
 * Anything else - a missing setting, a slow or failing backend, an unexpected
 * error in this file - is "not ready". Nothing here is assumed healthy.
 */

interface Env {
  get(name: string): string | undefined;
}

export interface ReadinessDeps {
  env?: Env;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export interface Readiness {
  ok: boolean;
  state:
    | "security-migration-in-progress"
    | "invalid-configuration"
    | "dependency-unhealthy"
    | "readiness-check-failed"
    | "ready";
  // Names only (a setting or a backend). Never a value, an address or an error text.
  failed: string[];
}

export const RELEASE_READY_VAR = "BFF_RELEASE_READY";

// One slow backend may not hold /ready open: every outbound call is cut off here.
const PROBE_TIMEOUT_MS = 5_000;

// /ready is public. One answer is reused this long so it cannot be used to
// multiply traffic onto the backends.
const CACHE_MS = 10_000;

const BACKEND_URLS = [
  "AUTH_BRIDGE_URL",
  "POSTGREST_URL",
  "FUNCTIONS_URL",
  "FILES_URL",
  "ACCOUNTS_URL",
  "TRANSCRIBER_URL",
];

function httpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

async function invalidSettings(env: Env): Promise<string[]> {
  const bad: string[] = [];

  for (const name of BACKEND_URLS) {
    if (!httpsUrl(env.get(name) ?? "")) bad.push(name);
  }

  if (!(env.get("GOOGLE_API_KEY") ?? "").trim()) bad.push("GOOGLE_API_KEY");

  try {
    // The same key check every real session write goes through.
    await sealSession({} as PrivateSession, env.get("SESSION_KEY") ?? "");
  } catch {
    bad.push("SESSION_KEY");
  }

  const origins = (env.get("BROWSER_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (
    origins.length === 0 ||
    origins.some((origin) => httpsUrl(origin)?.origin !== origin)
  ) {
    bad.push("BROWSER_ORIGINS");
  }

  return bad;
}

/** Resolves only if `url` answers exactly `status` with JSON whose `field` is `value`. */
async function probe(
  fetcher: typeof fetch,
  url: string,
  status: number,
  field: string,
  value: unknown,
): Promise<void> {
  const res = await fetcher(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  });

  const body = await res.json();

  if (res.status !== status || body?.[field] !== value) {
    throw new Error("unexpected health answer");
  }
}

async function unhealthyBackends(
  env: Env,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<string[]> {
  const bounded: typeof fetch = (input, init) =>
    fetcher(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });

  const base = (name: string) => (env.get(name) ?? "").replace(/\/+$/, "");

  const checks: Record<string, Promise<unknown>> = {
    // The real path of every signed-in request: Google service identity ->
    // auth-bridge /service-token -> PostgREST web_sessions. A fresh random id
    // was never issued, so it reads as "no row"; any broken link throws.
    "session-store": loadSessionRecord(generateSessionId(), {
      env,
      fetcher: bounded,
    }),
    "auth-bridge": probe(
      bounded,
      `${base("AUTH_BRIDGE_URL")}/ready`,
      200,
      "ok",
      true,
    ),
    "functions": probe(
      bounded,
      `${base("FUNCTIONS_URL")}/ready`,
      200,
      "ok",
      true,
    ),
    "accounts": probe(
      bounded,
      `${base("ACCOUNTS_URL")}/ready`,
      200,
      "ok",
      true,
    ),
    "transcriber": probe(
      bounded,
      `${base("TRANSCRIBER_URL")}/ready`,
      200,
      "ok",
      true,
    ),
    // files-service has no /ready, and Google's edge swallows /healthz on a
    // run.app address. Its own JSON 404 for an unknown path is the only health
    // contract it has (the uptime check in scripts/setup_monitoring.py uses the same).
    // ponytail: proves the container answers, not that the bucket works; switch
    // to /ready once files-service has one.
    "files": probe(bounded, `${base("FILES_URL")}/`, 404, "error", "not found"),
  };

  const names = Object.keys(checks);
  const results = await Promise.allSettled(Object.values(checks));

  return names.filter((_, i) => results[i].status === "rejected");
}

export async function checkReadiness(
  deps: ReadinessDeps = {},
): Promise<Readiness> {
  try {
    const env = deps.env ?? Deno.env;

    if (env.get(RELEASE_READY_VAR) !== "true") {
      return {
        ok: false,
        state: "security-migration-in-progress",
        failed: [],
      };
    }

    const settings = await invalidSettings(env);

    if (settings.length > 0) {
      return { ok: false, state: "invalid-configuration", failed: settings };
    }

    const backends = await unhealthyBackends(
      env,
      deps.fetcher ?? fetch,
      deps.timeoutMs ?? PROBE_TIMEOUT_MS,
    );

    if (backends.length > 0) {
      return { ok: false, state: "dependency-unhealthy", failed: backends };
    }

    return { ok: true, state: "ready", failed: [] };
  } catch {
    return { ok: false, state: "readiness-check-failed", failed: [] };
  }
}

let cached: { at: number; value: Promise<Readiness> } | null = null;

/** checkReadiness, at most once per CACHE_MS. Concurrent callers share one check. */
export function readiness(deps: ReadinessDeps = {}): Promise<Readiness> {
  const now = (deps.now ?? Date.now)();

  if (!cached || now - cached.at >= CACHE_MS || now < cached.at) {
    cached = { at: now, value: checkReadiness(deps) };
  }

  return cached.value;
}

/** Tests only: forget the remembered answer. */
export function resetReadinessCache(): void {
  cached = null;
}
