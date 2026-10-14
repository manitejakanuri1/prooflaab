import { handler } from "./main.ts";

/*
 * The whole gateway, as wired in main.ts, with no settings and no network.
 * It pins the order of the routes: the signed-out portfolio route must not
 * open, shadow or stand in for anything that needs a login, and it must not
 * change what /health and /ready mean.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const call = (path: string, init?: RequestInit) =>
  handler(new Request(`https://bff.example.test${path}`, init));

const DB_PATHS = [
  "/api/db/student_portfolios?slug=eq.asha-k&is_public=eq.true",
  "/api/db/student_profiles",
  "/api/db/rpc/portfolio_work",
  // The URL parser folds these back into /api/db before any route sees them.
  "/api/public/../db/student_profiles",
  "/api/public/portfolio/../../db/student_profiles",
];

Deno.test("with no settings the database route is unavailable, not open", async () => {
  for (const path of DB_PATHS) {
    const res = await call(path);

    assert(res.status === 503, `${path} expected 503, got ${res.status}`);
  }
});

Deno.test("with a database configured, an anonymous caller is refused before anything is sent", async () => {
  // No network permission is granted to this file: a request that tried to
  // reach this address would throw, not answer 401.
  Deno.env.set("POSTGREST_URL", "https://db.example.test");

  try {
    for (const path of DB_PATHS) {
      const res = await call(path);

      assert(res.status === 401, `${path} expected 401, got ${res.status}`);
    }

    // The same settings do not turn the public route into a way in: its own
    // read fails (no network, no credential) and that is the usual 404.
    const shared = await call("/api/public/portfolio/asha-k");

    assert(shared.status === 404, `expected 404, got ${shared.status}`);
  } finally {
    Deno.env.delete("POSTGREST_URL");
  }
});

Deno.test("the public route answers only its own path, and never 200 without a database", async () => {
  for (
    const path of [
      "/api/public/portfolio/asha-k",
      "/api/public/portfolio/..%2F..%2Fdb%2Fstudent_profiles",
      "/api/public/db/student_profiles",
      "/api/public/student_profiles",
      "/api/public",
    ]
  ) {
    const res = await call(path);

    assert(res.status === 404, `${path} expected 404, got ${res.status}`);
    assert(
      await res.text() === '{"error":"not found"}',
      `${path} gave a different 404 body`,
    );
  }
});

Deno.test("a signed-in cookie or token changes nothing on the public route", async () => {
  const res = await call("/api/public/portfolio/asha-k", {
    headers: {
      cookie: "__session=ANYTHING",
      authorization: "Bearer ANYTHING",
    },
  });

  assert(res.status === 404, `expected 404, got ${res.status}`);
  assert(!res.headers.get("set-cookie"), "the public route touched the cookie");
});

Deno.test("the public route cannot be written to", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await call("/api/public/portfolio/asha-k", {
      method,
      headers: { origin: "https://evil.example.test" },
    });

    assert(
      res.status === 403 || res.status === 405,
      `${method} expected a refusal, got ${res.status}`,
    );
  }
});

Deno.test("/health and /ready keep their separate meanings", async () => {
  const health = await call("/health");
  const ready = await call("/ready");

  assert(health.status === 200, "/health must answer while the process is up");
  assert(ready.status === 503, "/ready must stay closed with no settings");
  assert((await ready.json()).ok === false, "/ready claimed to be ready");

  // Neither name is served by the public route under another spelling.
  for (const path of ["/api/public/health", "/api/public/ready"]) {
    assert((await call(path)).status === 404, `${path} expected 404`);
  }
});
