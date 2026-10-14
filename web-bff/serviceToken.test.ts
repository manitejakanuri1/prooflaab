import {
  resetBridgeServiceTokenCache,
  bridgeServiceToken,
} from "./serviceToken.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function env(values: Record<string, string>) {
  return {
    get(name: string): string | undefined {
      return values[name];
    },
  };
}

Deno.test("BFF obtains short-lived service token through auth bridge", async () => {
  resetBridgeServiceTokenCache();

  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const fakeFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;

    calls.push({ url, init });

    if (url.startsWith("http://metadata.google.internal/")) {
      return new Response("GOOGLE_IDENTITY_TOKEN", { status: 200 });
    }

    if (url === "https://auth.example.test/service-token") {
      return Response.json({
        access_token: "SHORT_LIVED_SERVICE_TOKEN",
        expires_in: 600,
      });
    }

    return new Response("unexpected", { status: 500 });
  };

  const token = await bridgeServiceToken(
    env({ AUTH_BRIDGE_URL: "https://auth.example.test/" }),
    fakeFetch as typeof fetch,
  );

  assert(token === "SHORT_LIVED_SERVICE_TOKEN", "wrong service token");
  assert(calls.length === 2, "expected metadata + bridge calls");

  assert(
    calls[0].url.includes(
      "audience=https%3A%2F%2Fauth.example.test",
    ),
    "wrong metadata audience",
  );

  const metadataHeaders = new Headers(calls[0].init?.headers);
  assert(
    metadataHeaders.get("Metadata-Flavor") === "Google",
    "metadata protection header missing",
  );

  const bridgeHeaders = new Headers(calls[1].init?.headers);
  assert(
    bridgeHeaders.get("Authorization") ===
      "Bearer GOOGLE_IDENTITY_TOKEN",
    "Google identity token not presented to bridge",
  );
});

Deno.test("service token is cached before expiry", async () => {
  resetBridgeServiceTokenCache();

  let calls = 0;

  const fakeFetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    calls++;

    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;

    if (url.startsWith("http://metadata.google.internal/")) {
      return new Response("IDENTITY", { status: 200 });
    }

    return Response.json({
      access_token: "CACHED_TOKEN",
      expires_in: 600,
    });
  };

  const e = env({
    AUTH_BRIDGE_URL: "https://auth.example.test",
  });

  const first = await bridgeServiceToken(e, fakeFetch as typeof fetch);
  const second = await bridgeServiceToken(e, fakeFetch as typeof fetch);

  assert(first === "CACHED_TOKEN", "first token wrong");
  assert(second === "CACHED_TOKEN", "cached token wrong");
  assert(calls === 2, "cached request unexpectedly called network");
});

Deno.test("missing auth bridge configuration fails closed", async () => {
  resetBridgeServiceTokenCache();

  let refused = false;

  try {
    await bridgeServiceToken(env({}));
  } catch {
    refused = true;
  }

  assert(refused, "missing AUTH_BRIDGE_URL was accepted");
});

Deno.test("bridge refusal fails closed", async () => {
  resetBridgeServiceTokenCache();

  const fakeFetch = async (
    input: string | URL | Request,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;

    if (url.startsWith("http://metadata.google.internal/")) {
      return new Response("IDENTITY", { status: 200 });
    }

    return new Response("no", { status: 403 });
  };

  let refused = false;

  try {
    await bridgeServiceToken(
      env({ AUTH_BRIDGE_URL: "https://auth.example.test" }),
      fakeFetch as typeof fetch,
    );
  } catch {
    refused = true;
  }

  assert(refused, "403 from auth bridge was accepted");
});
