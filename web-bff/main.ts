import { handleAuthRoute } from "./authRoutes.ts";
import { handleProxyRoute } from "./proxyRoutes.ts";
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

  if (req.method === "GET" && url.pathname === "/healthz") {
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

  const proxyResponse = await handleProxyRoute(req);
  if (proxyResponse) return proxyResponse;

  /*
   * Deliberately NOT ready yet.
   *
   * Authentication, encrypted HttpOnly sessions and authenticated backend
   * proxying now exist, but frontend cutover, deployment wiring and live
   * integration validation are still incomplete.
   *
   * Returning 503 prevents a partially integrated BFF from being mistaken for
   * the production-ready gateway.
   */
  if (req.method === "GET" && url.pathname === "/ready") {
    return json(
      {
        ok: false,
        service: "prooflab-web-bff",
        state: "security-migration-in-progress",
      },
      503,
    );
  }

  // Secure default: nothing is proxied unless explicitly implemented.
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  console.log(`prooflab-web-bff listening on :${PORT}`);
  Deno.serve({ port: PORT }, handler);
}
