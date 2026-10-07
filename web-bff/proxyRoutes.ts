import {
  type AuthRouteDeps,
  resolveAuthenticatedSession,
} from "./authRoutes.ts";
import { clearSessionCookie } from "./session.ts";

interface Env {
  get(name: string): string | undefined;
}

export interface ProxyRouteDeps {
  env?: Env;
  fetcher?: typeof fetch;
  auth?: AuthRouteDeps;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(
  body: unknown,
  status: number,
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

function copyRequestHeaders(req: Request): Headers {
  const out = new Headers();

  const allowed = [
    "accept",
    "content-type",
    "prefer",
    "range",
    "range-unit",
    "x-request-id",
    "x-session-id",
  ];

  for (const name of allowed) {
    const value = req.headers.get(name);
    if (value) out.set(name, value);
  }

  return out;
}

function responseHeaders(upstream: Response): Headers {
  const out = new Headers(SECURITY_HEADERS);

  for (
    const name of [
      "content-type",
      "content-range",
      "range-unit",
      "location",
    ]
  ) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }

  return out;
}

function safePath(value: string): boolean {
  if (!value) return false;
  if (value.includes("\\")) return false;

  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return "";
    }
  })();

  if (!decoded) return false;

  return !decoded.split("/").some(
    (part) => part === "." || part === "..",
  );
}

async function bodyFor(req: Request): Promise<ArrayBuffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }

  const body = await req.arrayBuffer();

  return body.byteLength > 0 ? body : undefined;
}

export async function handleProxyRoute(
  req: Request,
  deps: ProxyRouteDeps = {},
): Promise<Response | null> {
  const url = new URL(req.url);

  const isDb = url.pathname === "/api/db" ||
    url.pathname.startsWith("/api/db/");

  const isFunction = url.pathname.startsWith("/api/functions/");

  if (!isDb && !isFunction) {
    return null;
  }

  const env = deps.env ?? Deno.env;
  const fetcher = deps.fetcher ?? fetch;

  const postgrest = (env.get("POSTGREST_URL") ?? "").replace(/\/+$/, "");

  const functions = (env.get("FUNCTIONS_URL") ?? "").replace(/\/+$/, "");

  if (isDb && !postgrest) {
    return json({ error: "database proxy unavailable" }, 503);
  }

  if (isFunction && !functions) {
    return json({ error: "function proxy unavailable" }, 503);
  }

  let resolved;

  try {
    resolved = await resolveAuthenticatedSession(
      req,
      deps.auth ?? {
        env,
        fetcher,
      },
    );
  } catch {
    return json({ error: "session service unavailable" }, 503);
  }

  if (!resolved) {
    return json(
      { error: "not authenticated" },
      401,
      { "Set-Cookie": clearSessionCookie() },
    );
  }

  const headers = copyRequestHeaders(req);

  // Browser-supplied credentials are never trusted or forwarded.
  headers.delete("authorization");
  headers.delete("cookie");
  headers.delete("apikey");

  headers.set(
    "Authorization",
    `Bearer ${resolved.session.appAccessToken}`,
  );

  let target: string;

  if (isDb) {
    if (
      !["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"]
        .includes(req.method)
    ) {
      return json({ error: "method not allowed" }, 405, {
        Allow: "GET, HEAD, POST, PATCH, PUT, DELETE",
      });
    }

    const path = url.pathname
      .replace(/^\/api\/db\/?/, "");

    if (path && !safePath(path)) {
      return json({ error: "invalid database path" }, 400);
    }

    target = `${postgrest}${path ? `/${path}` : ""}${url.search}`;
  } else {
    if (req.method !== "POST") {
      return json({ error: "method not allowed" }, 405, {
        Allow: "POST",
      });
    }

    const slug = url.pathname
      .replace(/^\/api\/functions\//, "")
      .replace(/^\/+|\/+$/g, "");

    if (!safePath(slug) || slug.includes("/")) {
      return json({ error: "invalid function name" }, 400);
    }

    target = `${functions}/functions/v1/${
      encodeURIComponent(slug)
    }${url.search}`;
  }

  let upstream: Response;

  try {
    upstream = await fetcher(target, {
      method: req.method,
      headers,
      body: await bodyFor(req),
      redirect: "manual",
    });
  } catch {
    return json({ error: "backend unavailable" }, 502);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  });
}
