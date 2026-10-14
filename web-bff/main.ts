import { handleAuthRoute } from "./authRoutes.ts";
import { handleProxyRoute } from "./proxyRoutes.ts";
import { handlePublicRoute } from "./publicRoutes.ts";
import { readiness } from "./readiness.ts";
import { rejectCrossSiteBrowserWrite } from "./requestGuard.ts";

const PORT = Number(Deno.env.get("PORT") ?? "8080");

const BROWSER_ORIGINS = (Deno.env.get("BROWSER_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Liveness only: the process answers. It says nothing about readiness (/ready).
  // /health is the one to call on Cloud Run: Google's edge answers /healthz on a
  // run.app address itself, with its own 404. /healthz stays for local callers.
  if (
    req.method === "GET" &&
    (url.pathname === "/health" || url.pathname === "/healthz")
  ) {
    return json({
      ok: true,
      service: "prooflab-web-bff",
    });
  }

  const crossSiteRefusal = rejectCrossSiteBrowserWrite(
    req,
    BROWSER_ORIGINS,
  );

  if (crossSiteRefusal) {
    return crossSiteRefusal;
  }

  const authResponse = await handleAuthRoute(req);
  if (authResponse) return authResponse;

  // Signed-out reads: published portfolios only (publicRoutes.ts).
  const publicResponse = await handlePublicRoute(req);
  if (publicResponse) return publicResponse;

  const proxyResponse = await handleProxyRoute(req);
  if (proxyResponse) return proxyResponse;

  /*
   * Closed (503) by default.
   *
   * It opens only when the release is explicitly enabled, the configuration is
   * valid and every backend answered its health check just now (readiness.ts).
   * Returning 503 otherwise prevents a partially integrated BFF from being
   * mistaken for the production-ready gateway.
   */
  if (req.method === "GET" && url.pathname === "/ready") {
    const { ok, state, failed } = await readiness();

    return json(
      {
        ok,
        service: "prooflab-web-bff",
        state,
        ...(failed.length > 0 ? { failed } : {}),
      },
      ok ? 200 : 503,
    );
  }

  // Secure default: nothing is proxied unless explicitly implemented.
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  console.log(`prooflab-web-bff listening on :${PORT}`);
  Deno.serve({ port: PORT }, handler);
}
