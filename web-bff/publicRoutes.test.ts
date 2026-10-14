import { handleProxyRoute } from "./proxyRoutes.ts";
import { handlePublicRoute } from "./publicRoutes.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

const STUDENT_ID = "00000000-0000-0000-0000-0000000000aa";

function env() {
  const values: Record<string, string> = {
    POSTGREST_URL: "https://db.example.test",
    FUNCTIONS_URL: "https://functions.example.test",
  };

  return { get: (name: string) => values[name] };
}

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  cookie: string | null;
  body: string;
}

// A stand-in for PostgREST. `row` is what the database would return for the
// portfolio query AFTER its own filters, so `null` means "no public row".
function backend(row: Record<string, unknown> | null, work: unknown = []) {
  const calls: Call[] = [];

  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);

    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      cookie: headers.get("cookie"),
      body: typeof init?.body === "string" ? init.body : "",
    });

    if (String(input).includes("/rpc/portfolio_work")) {
      return Response.json(work);
    }

    return Response.json(row ? [row] : []);
  };

  return { calls, fetcher };
}

function deps(fetcher: typeof fetch) {
  return {
    env: env(),
    fetcher,
    serviceToken: async () => "SERVER_SERVICE_TOKEN",
  };
}

function publicRow(): Record<string, unknown> {
  return {
    id: "portfolio-row-id",
    student_id: STUDENT_ID,
    slug: "asha-k",
    bio: "I build small tools.",
    skills: ["python", "sql"],
    achievements: "Won the college hackathon.",
    is_public: true,
    created_at: "2026-09-01T00:00:00Z",
    student_profiles: {
      id: STUDENT_ID,
      user_id: STUDENT_ID,
      full_name: "Asha K",
      profile_photo_url: "https://storage.googleapis.com/bucket/a.png",
      total_xp: 120,
      email: "asha@example.test",
      phone: "9999999999",
      college_id: "college-1",
      roll_number: "21CS001",
    },
  };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://app.example.test${path}`, { headers });

Deno.test("reproduction: the general database proxy refuses an anonymous portfolio read", async () => {
  const { calls, fetcher } = backend(publicRow());

  const res = await handleProxyRoute(
    get("/api/db/student_portfolios?slug=eq.asha-k&is_public=eq.true"),
    { env: env(), fetcher, auth: { env: env(), loadSession: async () => null } },
  );

  assert(res?.status === 401, "anonymous /api/db must stay 401");
  assert(calls.length === 0, "nothing may reach the database");
});

Deno.test("a public portfolio is readable without a session", async () => {
  const work = [{
    task_id: "t1",
    title: "Count failed logins per user",
    category: "sql",
    kind: "code",
    language: "sql",
    score: 90,
    passed_count: 6,
    total_count: 6,
    passed_at: "2026-10-01T00:00:00Z",
    explanation_score: 80,
    set_by: null,
    submission_id: "secret-submission",
    code: "select 1",
  }];
  const { calls, fetcher } = backend(publicRow(), work);

  const res = await handlePublicRoute(
    get("/api/public/portfolio/asha-k"),
    deps(fetcher),
  );

  assert(res?.status === 200, `expected 200, got ${res?.status}`);
  assert(res.headers.get("cache-control") === "no-store", "must not be cached");
  assert(!res.headers.get("set-cookie"), "must not touch the session cookie");

  const body = await res.json();

  assert(body.full_name === "Asha K", "name missing");
  assert(body.bio === "I build small tools.", "bio missing");
  assert(body.work.length === 1, "work missing");
  assert(
    body.work[0].title === "Count failed logins per user",
    "work title missing",
  );

  // Exactly the allowlist. Anything else the database returns is dropped.
  assert(
    Object.keys(body).sort().join() ===
      "achievements,bio,full_name,profile_photo_url,skills,slug,total_xp,work",
    `unexpected portfolio fields: ${Object.keys(body)}`,
  );
  assert(
    Object.keys(body.work[0]).sort().join() ===
      "category,explanation_score,kind,language,passed_at,passed_count,score,set_by,task_id,title,total_count",
    `unexpected work fields: ${Object.keys(body.work[0])}`,
  );

  const text = JSON.stringify(body);

  for (
    const secret of [
      STUDENT_ID,
      "asha@example.test",
      "9999999999",
      "21CS001",
      "college-1",
      "secret-submission",
      "select 1",
      "SERVER_SERVICE_TOKEN",
    ]
  ) {
    assert(!text.includes(secret), `leaked: ${secret}`);
  }

  // The database is asked for public, active, link-visible portfolios only,
  // and for named columns only.
  const query = new URL(calls[0].url);

  assert(query.pathname === "/student_portfolios", "wrong table");
  assert(query.searchParams.get("slug") === "eq.asha-k", "slug filter");
  assert(query.searchParams.get("is_public") === "eq.true", "public filter");
  assert(
    query.searchParams.get("student_profiles.status") === "eq.active",
    "active filter",
  );
  assert(
    query.searchParams.get("student_profiles.profile_visibility") ===
      "eq.public",
    "visibility filter",
  );
  assert(
    !query.searchParams.get("select")!.includes("*"),
    "select must name columns",
  );
  assert(
    calls.every((c) => c.authorization === "Bearer SERVER_SERVICE_TOKEN"),
    "server credential expected",
  );
  assert(
    calls[1].body === JSON.stringify({ _student_id: STUDENT_ID }),
    "work is read for that student only",
  );
});

Deno.test("browser credentials and query strings are never forwarded", async () => {
  const { calls, fetcher } = backend(publicRow());

  await handlePublicRoute(
    get("/api/public/portfolio/asha-k?select=*&is_public=eq.false", {
      authorization: "Bearer BROWSER_TOKEN",
      cookie: "__session=BROWSER_COOKIE",
      apikey: "BROWSER_KEY",
    }),
    deps(fetcher),
  );

  for (const call of calls) {
    assert(!call.url.includes("eq.false"), "browser query reached the database");
    assert(call.cookie === null, "cookie forwarded");
    assert(!call.authorization?.includes("BROWSER"), "browser token forwarded");
  }
});

Deno.test("private, nonexistent and failing lookups give the same 404", async () => {
  const answers: string[] = [];

  // Private / suspended / hidden / unknown all look the same to the database
  // query: no row. A broken database must not look different either.
  const cases: Array<typeof fetch> = [
    backend(null).fetcher,
    async () => new Response("boom", { status: 500 }),
    async () => {
      throw new Error("network down");
    },
    async () => Response.json({ not: "an array" }),
  ];

  for (const fetcher of cases) {
    const res = await handlePublicRoute(
      get("/api/public/portfolio/someone"),
      deps(fetcher),
    );

    assert(res?.status === 404, `expected 404, got ${res?.status}`);
    answers.push(await res.text());
  }

  assert(new Set(answers).size === 1, "404 bodies differ");
  assert(answers[0] === '{"error":"not found"}', "unexpected 404 body");
});

Deno.test("a failing service credential is a 404, not a leak", async () => {
  const res = await handlePublicRoute(get("/api/public/portfolio/asha-k"), {
    env: env(),
    fetcher: backend(publicRow()).fetcher,
    serviceToken: async () => {
      throw new Error("bridge refused: SECRET DETAIL");
    },
  });

  assert(res?.status === 404, "expected 404");
  assert(!(await res.text()).includes("SECRET"), "error detail leaked");
});

Deno.test("unsafe slugs never reach the database", async () => {
  const { calls, fetcher } = backend(publicRow());

  for (
    const path of [
      "/api/public/portfolio/",
      "/api/public/portfolio/a/b",
      "/api/public/portfolio/..%2Fweb_sessions",
      "/api/public/portfolio/a%26is_public%3Deq.false",
      "/api/public/portfolio/a,b",
      "/api/public/portfolio/a.b",
      "/api/public/portfolio/" + "a".repeat(81),
    ]
  ) {
    const res = await handlePublicRoute(get(path), deps(fetcher));

    assert(res?.status === 404, `${path} expected 404, got ${res?.status}`);
  }

  assert(calls.length === 0, "an unsafe slug reached the database");
});

Deno.test("only GET is allowed", async () => {
  const { calls, fetcher } = backend(publicRow());

  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await handlePublicRoute(
      new Request("https://app.example.test/api/public/portfolio/asha-k", {
        method,
      }),
      deps(fetcher),
    );

    assert(res?.status === 405, `${method} expected 405`);
  }

  assert(calls.length === 0, "a write reached the database");
});

Deno.test("nothing else under /api/public is served, and other paths pass through", async () => {
  const { calls, fetcher } = backend(publicRow());

  for (
    const path of [
      "/api/public",
      "/api/public/",
      "/api/public/student_profiles",
      "/api/public/db/student_portfolios",
    ]
  ) {
    const res = await handlePublicRoute(get(path), deps(fetcher));

    assert(res?.status === 404, `${path} expected 404`);
  }

  assert(
    await handlePublicRoute(get("/api/db/student_portfolios"), deps(fetcher)) ===
      null,
    "/api/db must not be handled here",
  );
  assert(calls.length === 0, "unexpected database call");
});

Deno.test("a photo address that is not https is dropped", async () => {
  const row = publicRow();
  (row.student_profiles as Record<string, unknown>).profile_photo_url =
    "javascript:alert(1)";

  const res = await handlePublicRoute(
    get("/api/public/portfolio/asha-k"),
    deps(backend(row).fetcher),
  );

  assert((await res!.json()).profile_photo_url === null, "unsafe photo kept");
});
