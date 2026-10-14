import { checkReadiness, readiness, resetReadinessCache } from "./readiness.ts";
import { resetBridgeServiceTokenCache } from "./serviceToken.ts";
import { handler } from "./main.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function key(): string {
  const bytes = new Uint8Array(32);
  bytes.fill(11);

  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const GOOD: Record<string, string> = {
  BFF_RELEASE_READY: "true",
  GOOGLE_API_KEY: "TEST_GOOGLE_API_KEY",
  SESSION_KEY: key(),
  BROWSER_ORIGINS: "https://prooflab.example.test",
  AUTH_BRIDGE_URL: "https://bridge.example.test",
  POSTGREST_URL: "https://db.example.test",
  FUNCTIONS_URL: "https://functions.example.test",
  FILES_URL: "https://files.example.test",
  ACCOUNTS_URL: "https://accounts.example.test",
  TRANSCRIBER_URL: "https://transcriber.example.test",
};

function env(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

function reply(body: unknown, status = 200): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    { status },
  );
}

type Answer = () => Response | Promise<Response>;

// Every backend answering its real health contract.
function healthy(): Record<string, Answer> {
  return {
    "metadata.google.internal": () => reply("GOOGLE_IDENTITY_TOKEN"),
    "bridge.example.test/service-token": () =>
      reply({ access_token: "SERVICE_TOKEN", expires_in: 3600 }),
    "bridge.example.test/ready": () => reply({ ok: true, alg: "RS256" }),
    "db.example.test/web_sessions": () => reply([]),
    "functions.example.test/ready": () =>
      reply({ ok: true, loaded: 32, expected: 32 }),
    "accounts.example.test/ready": () => reply({ ok: true }),
    "transcriber.example.test/ready": () => reply({ ok: true, model: "base" }),
    "files.example.test/": () => reply({ error: "not found" }, 404),
  };
}

function backends(answers: Record<string, Answer>) {
  const calls: { target: string; bounded: boolean }[] = [];

  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const target = url.hostname === "metadata.google.internal"
      ? url.hostname
      : `${url.hostname}${url.pathname}`;

    calls.push({ target, bounded: init?.signal instanceof AbortSignal });

    const answer = answers[target];
    if (!answer) return Promise.reject(new Error(`unexpected call ${target}`));

    return Promise.resolve(answer());
  }) as typeof fetch;

  return { fetcher, calls };
}

function run(
  values: Record<string, string | undefined>,
  answers: Record<string, Answer> = healthy(),
) {
  resetBridgeServiceTokenCache();
  const { fetcher, calls } = backends(answers);

  return checkReadiness({ env: env(values), fetcher }).then((result) => ({
    result,
    calls,
  }));
}

Deno.test("ready is closed by default and calls nothing", async () => {
  const { BFF_RELEASE_READY: _, ...notEnabled } = GOOD;
  const { result, calls } = await run(notEnabled);

  assert(result.ok === false, "ready opened without release enablement");
  assert(
    result.state === "security-migration-in-progress",
    `unexpected state ${result.state}`,
  );
  assert(calls.length === 0, "a closed gateway contacted a backend");
});

Deno.test("only the exact value true enables the release", async () => {
  for (const value of ["", "TRUE", "True", "1", "yes", " true", "true "]) {
    const { result, calls } = await run({ ...GOOD, BFF_RELEASE_READY: value });

    assert(result.ok === false, `"${value}" opened ready`);
    assert(calls.length === 0, `"${value}" contacted a backend`);
  }
});

Deno.test("ready opens when enabled, configured and every backend is healthy", async () => {
  const { result, calls } = await run(GOOD);

  assert(result.ok === true, `not ready: ${JSON.stringify(result)}`);
  assert(result.state === "ready", `unexpected state ${result.state}`);
  assert(result.failed.length === 0, "a ready answer listed failures");

  const called = calls.map((call) => call.target).sort().join(" ");
  const expected = Object.keys(healthy()).sort().join(" ");

  assert(called === expected, `backends checked: ${called}`);
  assert(
    calls.every((call) => call.bounded),
    "an outbound call had no timeout",
  );
});

Deno.test("an invalid setting keeps ready closed and calls nothing", async () => {
  const broken: [string, string | undefined][] = [
    ["AUTH_BRIDGE_URL", undefined],
    ["POSTGREST_URL", ""],
    ["FUNCTIONS_URL", "http://functions.example.test"],
    ["FILES_URL", "not a url"],
    ["ACCOUNTS_URL", undefined],
    ["TRANSCRIBER_URL", "ftp://transcriber.example.test"],
    ["GOOGLE_API_KEY", "  "],
    ["SESSION_KEY", undefined],
    ["SESSION_KEY", "too-short"],
    ["BROWSER_ORIGINS", undefined],
    ["BROWSER_ORIGINS", "http://prooflab.example.test"],
    ["BROWSER_ORIGINS", "https://prooflab.example.test/path"],
    ["BROWSER_ORIGINS", "https://prooflab.example.test,*"],
  ];

  for (const [name, value] of broken) {
    const { result, calls } = await run({ ...GOOD, [name]: value });

    assert(result.ok === false, `${name}=${value} opened ready`);
    assert(
      result.state === "invalid-configuration",
      `${name}=${value}: state ${result.state}`,
    );
    assert(
      result.failed.join() === name,
      `${name}=${value}: reported ${result.failed}`,
    );
    assert(calls.length === 0, `${name}=${value}: contacted a backend`);
  }
});

Deno.test("each unhealthy backend keeps ready closed and is named", async () => {
  const bad: [string, Answer][] = [
    ["wrong status", () => reply({ ok: true }, 503)],
    ["not ok", () => reply({ ok: false })],
    ["html page", () => reply("<!doctype html><title>Site</title>")],
    ["redirect", () => reply({ ok: true }, 302)],
    [
      "network error",
      () => Promise.reject(new TypeError("connection refused")),
    ],
  ];

  const probes: [string, string][] = [
    ["bridge.example.test/ready", "auth-bridge"],
    ["functions.example.test/ready", "functions"],
    ["accounts.example.test/ready", "accounts"],
    ["transcriber.example.test/ready", "transcriber"],
    ["files.example.test/", "files"],
  ];

  for (const [target, name] of probes) {
    for (const [what, answer] of bad) {
      const { result } = await run(GOOD, { ...healthy(), [target]: answer });

      assert(result.ok === false, `${name} ${what}: ready opened`);
      assert(
        result.state === "dependency-unhealthy",
        `${name} ${what}: state ${result.state}`,
      );
      assert(
        result.failed.join() === name,
        `${name} ${what}: reported ${result.failed}`,
      );
    }
  }
});

Deno.test("a files service answering 200 is not treated as healthy", async () => {
  // Its health contract is its own JSON 404. Anything else is some other server.
  const { result } = await run(GOOD, {
    ...healthy(),
    "files.example.test/": () => reply({ ok: true }),
  });

  assert(result.ok === false, "ready opened");
  assert(result.failed.join() === "files", `reported ${result.failed}`);
});

Deno.test("a broken link in the session store chain keeps ready closed", async () => {
  const links = [
    "metadata.google.internal",
    "bridge.example.test/service-token",
    "db.example.test/web_sessions",
  ];

  for (const target of links) {
    const { result } = await run(GOOD, {
      ...healthy(),
      [target]: () => reply({ error: "refused" }, 500),
    });

    assert(result.ok === false, `${target}: ready opened`);
    assert(
      result.failed.join() === "session-store",
      `${target}: reported ${result.failed}`,
    );
  }
});

Deno.test("several failures are all reported", async () => {
  const { result } = await run(GOOD, {
    ...healthy(),
    "functions.example.test/ready": () => reply({ ok: false }, 503),
    "db.example.test/web_sessions": () => reply({}, 500),
  });

  assert(
    result.failed.join() === "session-store,functions",
    `reported ${result.failed}`,
  );
});

Deno.test("a backend that never answers is cut off, not waited for", async () => {
  resetBridgeServiceTokenCache();
  const answers = healthy();

  const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));

    if (url.hostname !== "transcriber.example.test") {
      const target = url.hostname === "metadata.google.internal"
        ? url.hostname
        : `${url.hostname}${url.pathname}`;
      return Promise.resolve(answers[target]());
    }

    // Hangs for ever unless the caller's own deadline aborts it.
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
      );
    });
  }) as typeof fetch;

  const result = await checkReadiness({
    env: env(GOOD),
    fetcher,
    timeoutMs: 20,
  });

  assert(result.ok === false, "ready opened while a backend hung");
  assert(
    result.failed.join() === "transcriber",
    `reported ${result.failed}`,
  );
});

Deno.test("an unexpected error inside the check keeps ready closed", async () => {
  const result = await checkReadiness({
    env: {
      get() {
        throw new Error("environment unavailable");
      },
    },
  });

  assert(result.ok === false, "ready opened after an internal error");
  assert(
    result.state === "readiness-check-failed",
    `unexpected state ${result.state}`,
  );
});

Deno.test("a not-ready answer names things but never leaks a value", async () => {
  const { result } = await run(GOOD, {
    ...healthy(),
    "functions.example.test/ready": () => reply({ ok: false, secret: "LEAK" }),
  });

  const text = JSON.stringify(result);

  for (
    const value of [...Object.values(GOOD).slice(1), "LEAK", "SERVICE_TOKEN"]
  ) {
    assert(!text.includes(value), `answer contains ${value}`);
  }
});

Deno.test("one answer is reused briefly, then checked again", async () => {
  resetReadinessCache();
  resetBridgeServiceTokenCache();

  const answers = healthy();
  const { fetcher, calls } = backends(answers);

  let now = 1_800_000_000_000;
  const deps = { env: env(GOOD), fetcher, now: () => now };

  assert((await readiness(deps)).ok === true, "first check was not ready");
  const first = calls.length;

  // A backend breaks. Within the window the remembered answer is reused.
  answers["functions.example.test/ready"] = () => reply({ ok: false }, 503);
  now += 9_999;

  assert((await readiness(deps)).ok === true, "answer was not reused");
  assert(calls.length === first, "a reused answer contacted a backend");

  // After the window the breakage is seen: ready closes again.
  now += 1;
  const later = await readiness(deps);

  assert(later.ok === false, "a stale ready answer outlived its window");
  assert(later.failed.join() === "functions", `reported ${later.failed}`);

  resetReadinessCache();
});

Deno.test("GET /ready on the real handler is 503 by default", async () => {
  resetReadinessCache();
  Deno.env.delete("BFF_RELEASE_READY");

  const res = await handler(new Request("https://bff.example.test/ready"));
  const body = await res.json();

  assert(res.status === 503, `expected 503, got ${res.status}`);
  assert(body.ok === false, "body claims ok");
  assert(body.service === "prooflab-web-bff", "service name changed");
  assert(
    body.state === "security-migration-in-progress",
    `unexpected state ${body.state}`,
  );
  assert(
    res.headers.get("Cache-Control") === "no-store",
    "ready answer is cacheable",
  );

  resetReadinessCache();
});

Deno.test("GET /ready stays 503 when only the release switch is set", async () => {
  resetReadinessCache();
  Deno.env.set("BFF_RELEASE_READY", "true");

  try {
    // Nothing else is configured and no backend is reachable in a unit test.
    const res = await handler(new Request("https://bff.example.test/ready"));
    const body = await res.json();

    assert(res.status === 503, `expected 503, got ${res.status}`);
    assert(body.ok === false, "body claims ok");
  } finally {
    Deno.env.delete("BFF_RELEASE_READY");
    resetReadinessCache();
  }
});

Deno.test("GET /health and /healthz give the same liveness answer", async () => {
  const answers: string[] = [];

  for (const path of ["/health", "/healthz"]) {
    const res = await handler(new Request(`https://bff.example.test${path}`));
    const text = await res.text();
    const body = JSON.parse(text);

    assert(res.status === 200, `${path}: expected 200, got ${res.status}`);
    assert(body.ok === true, `${path}: not ok`);
    assert(
      body.service === "prooflab-web-bff",
      `${path}: service name changed`,
    );

    answers.push(text);
  }

  assert(answers[0] === answers[1], "/health and /healthz answers differ");
});

Deno.test("only GET reaches the liveness answer", async () => {
  const res = await handler(
    new Request("https://bff.example.test/health", { method: "POST" }),
  );

  assert(res.status !== 200, `POST /health answered ${res.status}`);
});

Deno.test("a live /health does not open /ready", async () => {
  resetReadinessCache();
  Deno.env.delete("BFF_RELEASE_READY");

  const health = await handler(new Request("https://bff.example.test/health"));
  await health.body?.cancel();

  const ready = await handler(new Request("https://bff.example.test/ready"));
  const body = await ready.json();

  assert(health.status === 200, `health answered ${health.status}`);
  assert(ready.status === 503, `ready answered ${ready.status}`);
  assert(body.ok === false, "ready claims ok");

  resetReadinessCache();
});
