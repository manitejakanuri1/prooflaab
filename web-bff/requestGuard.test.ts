import { rejectCrossSiteBrowserWrite } from "./requestGuard.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("same-origin browser POST is allowed", () => {
  const req = new Request(
    "https://prooflab.co.in/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://prooflab.co.in",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );

  assert(
    rejectCrossSiteBrowserWrite(req) === null,
    "same-origin POST was rejected",
  );
});

Deno.test("cross-site browser POST is refused", async () => {
  const req = new Request(
    "https://prooflab.co.in/api/auth/logout",
    {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
    },
  );

  const res = rejectCrossSiteBrowserWrite(req);

  assert(res !== null, "cross-site POST was accepted");
  assert(res.status === 403, "wrong refusal status");

  const body = await res.json();

  assert(
    body.error === "cross-origin request refused",
    "wrong refusal response",
  );
});

Deno.test("sibling subdomain write is refused", () => {
  const req = new Request(
    "https://prooflab.co.in/api/db/student_profiles",
    {
      method: "PATCH",
      headers: {
        Origin: "https://evil.prooflab.co.in",
        "Sec-Fetch-Site": "same-site",
      },
    },
  );

  const res = rejectCrossSiteBrowserWrite(req);

  assert(
    res?.status === 403,
    "same-site cross-origin write was accepted",
  );
});

Deno.test("mismatched Origin is refused even without fetch metadata", () => {
  const req = new Request(
    "https://prooflab.co.in/api/functions/run-code",
    {
      method: "POST",
      headers: {
        Origin: "https://other.example",
      },
    },
  );

  const res = rejectCrossSiteBrowserWrite(req);

  assert(
    res?.status === 403,
    "mismatched Origin was accepted",
  );
});

Deno.test("same-origin GET is unaffected", () => {
  const req = new Request(
    "https://prooflab.co.in/api/auth/session",
    {
      method: "GET",
      headers: {
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );

  assert(
    rejectCrossSiteBrowserWrite(req) === null,
    "safe GET was rejected",
  );
});

Deno.test("non-browser tooling without Origin remains supported", () => {
  const req = new Request(
    "https://prooflab.co.in/api/functions/run-code",
    {
      method: "POST",
    },
  );

  assert(
    rejectCrossSiteBrowserWrite(req) === null,
    "non-browser request was rejected",
  );
});

Deno.test("Firebase Hosting origin is allowed when explicitly trusted", () => {
  const req = new Request(
    "https://prooflab-staging-web-bff-xyz.a.run.app/api/auth/login",
    {
      method: "POST",
      headers: {
        Origin: "https://prooflab-staging.web.app",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );

  assert(
    rejectCrossSiteBrowserWrite(
      req,
      ["https://prooflab-staging.web.app"],
    ) === null,
    "trusted Hosting origin was rejected",
  );
});

Deno.test("unconfigured origin stays refused behind a rewrite", () => {
  const req = new Request(
    "https://prooflab-staging-web-bff-xyz.a.run.app/api/auth/login",
    {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "same-origin",
      },
    },
  );

  const res = rejectCrossSiteBrowserWrite(
    req,
    ["https://prooflab-staging.web.app"],
  );

  assert(
    res?.status === 403,
    "unconfigured browser origin was accepted",
  );
});
