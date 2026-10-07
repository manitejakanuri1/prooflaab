import { handleProxyRoute } from "./proxyRoutes.ts";
import { makeSessionCookie, type PrivateSession } from "./session.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

const NOW = 1_800_000_000_000;
const SESSION_ID = "B".repeat(43);

function session(): PrivateSession {
  return {
    v: 1,
    googleRefreshToken: "SERVER_REFRESH",
    appAccessToken: "SERVER_APP_ACCESS",
    appAccessExpiresAt: NOW + 3_600_000,
    expiresAt: NOW + 7 * 24 * 60 * 60 * 1000,
    user: {
      id: "00000000-0000-0000-0000-000000000001",
      email: "student@example.test",
      email_confirmed_at: null,
      role: "authenticated",
      user_metadata: {},
    },
  };
}

function env() {
  const values: Record<string, string> = {
    POSTGREST_URL: "https://db.example.test",
    FUNCTIONS_URL: "https://functions.example.test",
  };

  return {
    get(name: string) {
      return values[name];
    },
  };
}

function authDeps() {
  return {
    env: env(),
    now: () => NOW,
    loadSession: async () => session(),
  };
}

function cookie() {
  return makeSessionCookie(SESSION_ID, 3600)
    .split(";")[0];
}

Deno.test("database proxy injects server token and preserves query", async () => {
  let target = "";
  let authorization = "";
  let browserCookie = "";

  const fetcher: typeof fetch = async (input, init) => {
    target = String(input);

    const headers = new Headers(init?.headers);

    authorization = headers.get("authorization") ?? "";

    browserCookie = headers.get("cookie") ?? "";

    return Response.json(
      [{ id: 1 }],
      {
        headers: {
          "Content-Range": "0-0/1",
        },
      },
    );
  };

  const req = new Request(
    "https://prooflab.co.in/api/db/student_profiles?select=id&limit=1",
    {
      headers: {
        Cookie: cookie(),
        Authorization: "Bearer BROWSER_FAKE_TOKEN",
        Prefer: "count=exact",
      },
    },
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    fetcher,
    auth: authDeps(),
  });

  assert(res !== null, "database route not handled");
  assert(res.status === 200, "database proxy failed");

  assert(
    target ===
      "https://db.example.test/student_profiles?select=id&limit=1",
    `wrong database target: ${target}`,
  );

  assert(
    authorization === "Bearer SERVER_APP_ACCESS",
    "server token was not injected",
  );

  assert(
    browserCookie === "",
    "browser session cookie leaked upstream",
  );

  assert(
    res.headers.get("Content-Range") === "0-0/1",
    "PostgREST range header lost",
  );
});

Deno.test("database writes preserve body and content type", async () => {
  let method = "";
  let body = "";
  let contentType = "";

  const fetcher: typeof fetch = async (_input, init) => {
    method = init?.method ?? "";
    body = new TextDecoder().decode(
      init?.body as ArrayBuffer,
    );

    contentType = new Headers(init?.headers)
      .get("content-type") ?? "";

    return new Response(null, { status: 204 });
  };

  const req = new Request(
    "https://prooflab.co.in/api/db/rpc/test_fn",
    {
      method: "POST",
      headers: {
        Cookie: cookie(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ a: 1 }),
    },
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    fetcher,
    auth: authDeps(),
  });

  assert(res !== null, "db write not handled");
  assert(res.status === 204, "wrong db write status");
  assert(method === "POST", "method changed");
  assert(body === '{"a":1}', "request body changed");
  assert(
    contentType === "application/json",
    "content type lost",
  );
});

Deno.test("function proxy uses fixed functions service", async () => {
  let target = "";
  let authorization = "";

  const fetcher: typeof fetch = async (input, init) => {
    target = String(input);

    authorization = new Headers(init?.headers)
      .get("authorization") ?? "";

    return Response.json({ ok: true });
  };

  const req = new Request(
    "https://prooflab.co.in/api/functions/resume-parser",
    {
      method: "POST",
      headers: {
        Cookie: cookie(),
        "Content-Type": "application/json",
      },
      body: "{}",
    },
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    fetcher,
    auth: authDeps(),
  });

  assert(res !== null, "function route not handled");

  assert(
    target ===
      "https://functions.example.test/functions/v1/resume-parser",
    `wrong function target: ${target}`,
  );

  assert(
    authorization === "Bearer SERVER_APP_ACCESS",
    "function did not receive server-side token",
  );
});

Deno.test("proxy refuses unauthenticated browser", async () => {
  let called = false;

  const req = new Request(
    "https://prooflab.co.in/api/db/student_profiles",
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    fetcher: async () => {
      called = true;
      return new Response();
    },
    auth: {
      env: env(),
      now: () => NOW,
      loadSession: async () => null,
    },
  });

  assert(res !== null, "db route not handled");
  assert(res.status === 401, "unauthenticated request accepted");
  assert(!called, "backend called without authenticated session");
});

Deno.test("function proxy refuses extra path segments", async () => {
  const req = new Request(
    "https://prooflab.co.in/api/functions/resume-parser/evil",
    {
      method: "POST",
      headers: {
        Cookie: cookie(),
      },
    },
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    auth: authDeps(),
  });

  assert(res !== null, "function route not handled");
  assert(res.status === 400, "invalid function path accepted");
});

Deno.test("database proxy rejects unsupported method", async () => {
  const req = new Request(
    "https://prooflab.co.in/api/db/student_profiles",
    {
      method: "OPTIONS",
      headers: {
        Cookie: cookie(),
      },
    },
  );

  const res = await handleProxyRoute(req, {
    env: env(),
    auth: authDeps(),
  });

  assert(res !== null, "database route not handled");
  assert(res.status === 405, "unsupported method accepted");
});
