import contract from "./routes.contract.json" with { type: "json" };

/*
 * The website -> gateway -> backend routing, checked through the whole gateway
 * as wired in main.ts. No network: every outbound call is the stand-in below.
 *
 * Staging settings are set before main.ts loads, because it reads the allowed
 * browser origins once at start, exactly as the container does.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SITE = "https://prooflab-staging.web.app";

const SETTINGS: Record<string, string> = {
  BROWSER_ORIGINS: `${SITE},https://prooflab-staging.firebaseapp.com`,
  GOOGLE_API_KEY: "TEST_GOOGLE_API_KEY",
  AUTH_BRIDGE_URL: "https://bridge.example.test",
  POSTGREST_URL: "https://db.example.test",
  FUNCTIONS_URL: "https://functions.example.test",
  FILES_URL: "https://files.example.test",
  ACCOUNTS_URL: "https://accounts.example.test",
  TRANSCRIBER_URL: "https://transcriber.example.test",
};

for (const [name, value] of Object.entries(SETTINGS)) Deno.env.set(name, value);

const { handler } = await import("./main.ts");

interface Route {
  match: string;
  prefix?: boolean;
  example?: string;
  method: string;
  anonymous: "open" | "closed";
}

const routes = contract.routes as Route[];
const pathOf = (route: Route) => route.example ?? route.match;

// Every outbound call the gateway makes lands here and is counted.
const outbound: string[] = [];
const realFetch = globalThis.fetch;

function standIn() {
  outbound.length = 0;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    outbound.push(String(input));
    return Promise.resolve(Response.json({ error: "stand-in" }, { status: 500 }));
  }) as typeof fetch;
}

// The gateway runs behind Firebase Hosting: the request arrives on the Cloud
// Run address while the browser's Origin is the public site.
const call = (path: string, init: RequestInit = {}) =>
  handler(
    new Request(`https://prooflab-staging-web-bff.example.test${path}`, init),
  );

const isFallThrough = async (res: Response) =>
  res.status === 404 && (await res.clone().text()) === '{"error":"not found"}';

Deno.test("every address the website calls has a gateway route", async () => {
  standIn();

  try {
    for (const route of routes) {
      const res = await call(pathOf(route), { method: route.method });

      if (route.match === "/api/public/portfolio/") {
        // An unpublished/missing slug intentionally returns the EXACT SAME
        // 404 JSON as an unknown route. Distinguishing them by body would
        // reveal whether a private portfolio exists. So the wiring is proved
        // by behaviour instead: only the public handler answers a write to
        // this path with 405. Unwired, the same request is the plain 404.
        // (This file runs in CI with no file-read permission, like the
        // container; it must not read main.ts from disk.)
        const write = await call(pathOf(route), { method: "POST" });
        assert(
          write.status === 405 && write.headers.get("allow") === "GET",
          "public portfolio handler is not wired into the gateway",
        );
        assert(
          res.status === 200 || res.status === 404,
          `public portfolio route returned unexpected ${res.status}`,
        );
      } else {
        assert(
          !(await isFallThrough(res)),
          `${route.method} ${pathOf(route)} is not routed by the gateway`,
        );
      }
      assert(
        (res.headers.get("content-type") ?? "").includes("application/json"),
        `${pathOf(route)} did not answer JSON`,
      );
      assert(
        res.headers.get("cache-control") === "no-store",
        `${pathOf(route)} may be cached`,
      );
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("database, functions, files, accounts and transcriber need a login, and nothing is sent without one", async () => {
  standIn();

  try {
    for (const route of routes.filter((r) => r.anonymous === "closed")) {
      const res = await call(pathOf(route), { method: route.method });

      assert(
        res.status === 401,
        `${route.method} ${pathOf(route)} expected 401, got ${res.status}`,
      );
    }

    assert(
      outbound.length === 0,
      `an anonymous request reached a backend: ${outbound.join(", ")}`,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("a made-up session cookie is not a login", async () => {
  standIn();

  try {
    for (const route of routes.filter((r) => r.anonymous === "closed")) {
      const res = await call(pathOf(route), {
        method: route.method,
        headers: { cookie: "__session=not-a-real-session" },
      });

      assert(
        res.status === 401 || res.status === 503,
        `${pathOf(route)} expected a refusal, got ${res.status}`,
      );
    }

    // A forged cookie fails to open before any backend is asked about it.
    assert(
      !outbound.some((url) =>
        url.startsWith("https://db.example.test/student_profiles") ||
        url.startsWith("https://functions.example.test") ||
        url.startsWith("https://files.example.test") ||
        url.startsWith("https://accounts.example.test") ||
        url.startsWith("https://transcriber.example.test")
      ),
      "a forged cookie reached a data backend",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("an anonymous visitor has no session and is told so plainly", async () => {
  standIn();

  try {
    const res = await call("/api/auth/session");

    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert((await res.json()).session === null, "an anonymous session was invented");
    assert(outbound.length === 0, "the session check reached a backend with no cookie");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("writes from another site are refused on every route; the staging site is allowed through", async () => {
  standIn();

  try {
    for (const route of routes.filter((r) => r.method !== "GET")) {
      const path = pathOf(route);

      for (
        const headers of <Record<string, string>[]> [
          { origin: "https://evil.example.test" },
          { origin: "https://prooflab-staging.web.app.evil.example.test" },
          { origin: "http://prooflab-staging.web.app" },
          { origin: SITE, "sec-fetch-site": "cross-site" },
          { origin: SITE, "sec-fetch-site": "same-site" },
          { origin: "null" },
        ]
      ) {
        const res = await call(path, { method: route.method, headers });

        assert(
          res.status === 403,
          `${path} from ${JSON.stringify(headers)} expected 403, got ${res.status}`,
        );
      }

      const allowed = await call(path, {
        method: route.method,
        headers: { origin: SITE, "sec-fetch-site": "same-origin" },
      });

      // Not "status is not 403": public sign-up is switched off and answers
      // 403 for its own reason. Only the cross-origin refusal is wrong here.
      assert(
        !(await allowed.text()).includes("cross-origin request refused"),
        `${path} refused the staging site itself`,
      );
    }

    assert(
      !outbound.some((url) => !url.includes("example.test")),
      "an unexpected address was called",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("nothing outside the contract is proxied", async () => {
  standIn();

  try {
    for (
      const path of [
        "/api",
        "/api/",
        "/api/unknown",
        "/api/auth",
        "/api/auth/unknown",
        "/api/accounts",
        "/api/accounts/create",
        "/api/accounts/remove/extra",
        "/api/transcriber",
        "/api/transcriber/other",
        "/api/functions",
        "/api/files",
        "/api/service-token",
        "/api/ready",
        "/service-token",
        "/rest/v1/student_profiles",
      ]
    ) {
      const res = await call(path);

      assert(
        await isFallThrough(res),
        `${path} expected the plain 404, got ${res.status}`,
      );
    }

    assert(outbound.length === 0, "an unknown path reached a backend");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("wrong methods and unsafe names are refused before any backend is called", async () => {
  standIn();

  try {
    // Anonymous: the login check comes first, so these are all 401.
    for (
      const [method, path] of [
        ["GET", "/api/functions/level-open"],
        ["GET", "/api/accounts/remove"],
        ["GET", "/api/transcriber/transcribe"],
        ["POST", "/api/files/proof-files/a/b.pdf"],
        ["POST", "/api/functions/a/b"],
        ["GET", "/api/files/only-a-bucket"],
      ]
    ) {
      const res = await call(path, { method });

      assert(
        res.status >= 400 && res.status < 500,
        `${method} ${path} expected a refusal, got ${res.status}`,
      );
    }

    // The auth routes answer only their own method.
    for (const route of routes.filter((r) => r.anonymous === "open")) {
      const other = route.method === "GET" ? "DELETE" : "GET";
      const res = await call(route.match, { method: other });

      assert(
        res.status >= 400 && res.status < 500,
        `${other} ${route.match} expected a refusal, got ${res.status}`,
      );
    }

    assert(outbound.length === 0, "a refused request reached a backend");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("with the staging settings but no release switch, /ready stays closed and /health stays up", async () => {
  standIn();

  try {
    const health = await call("/health");
    const ready = await call("/ready");

    assert(health.status === 200, "/health must answer");
    assert(ready.status === 503, `/ready expected 503, got ${ready.status}`);
    assert((await ready.json()).ok === false, "/ready claimed to be ready");
    assert(outbound.length === 0, "a closed /ready probed the backends");
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("clean up: the settings this file set are removed", () => {
  for (const name of Object.keys(SETTINGS)) Deno.env.delete(name);
});
