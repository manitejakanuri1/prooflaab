/**
 * URL/header rules for browser -> same-origin web BFF traffic.
 *
 * Supabase's query builders still generate their familiar:
 *   /rest/v1/...       and
 *   /functions/v1/...
 *
 * Only the transport changes:
 *   /rest/v1/...       -> /api/db/...
 *   /functions/v1/...  -> /api/functions/...
 *
 * Browser bearer/api-key/cookie headers are never forwarded deliberately.
 * Authentication is the HttpOnly session cookie managed by the browser.
 */

export type BffLane = "db" | "function";

export function rewriteBffUrl(
  rawUrl: string,
  lane: BffLane,
  appOrigin: string,
): string {
  const origin = new URL(appOrigin).origin;
  const url = new URL(rawUrl, origin);

  if (url.origin !== origin) {
    throw new Error("BFF transport refused a cross-origin request");
  }

  if (lane === "db") {
    if (
      url.pathname !== "/rest/v1" &&
      !url.pathname.startsWith("/rest/v1/")
    ) {
      throw new Error("BFF database transport received an unexpected path");
    }

    const suffix = url.pathname.slice("/rest/v1".length);
    url.pathname = `/api/db${suffix}`;

    return url.href;
  }

  if (!url.pathname.startsWith("/functions/v1/")) {
    throw new Error("BFF function transport received an unexpected path");
  }

  const suffix = url.pathname.slice("/functions/v1/".length);

  if (!suffix || suffix.includes("/")) {
    throw new Error("BFF function transport received an invalid function name");
  }

  url.pathname = `/api/functions/${suffix}`;

  return url.href;
}

export function sanitizeBffHeaders(
  ...sources: Array<HeadersInit | undefined>
): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;

    for (const [name, value] of new Headers(source)) {
      headers.set(name, value);
    }
  }

  headers.delete("authorization");
  headers.delete("apikey");
  headers.delete("cookie");

  return headers;
}

export const SESSION_EXPIRED_MESSAGE = "Session expired - sign in again";
export const SERVER_BUSY_MESSAGE = "The server is busy. Please try again in a moment.";

/**
 * E2E 12 Nov items 14/16/17: one place that turns transport failures into words a person can read.
 * - Our BFF answers {"error":"not authenticated"} (401) when the session cookie has run out.
 * - Our BFF always answers JSON. A text/html 5xx is Google's own "Error 502 (Server Error)" page from the
 *   hosting edge; on TEST those came back in ~25 ms and never reached Cloud Run (no request logged), so
 *   one quick retry is safe. Slow ones are not retried (the server may have done the work).
 * Returns what happened, plus a JSON Response that supabase-js turns into error.message (and functions
 * callers can read with error.context.json()).
 */
export type TransportVerdict = "ok" | "expired" | "edge";

export async function classifyBffResponse(res: Response): Promise<TransportVerdict> {
  if (res.status === 401) {
    const body = await res.clone().json().catch(() => null) as { error?: unknown } | null;
    return body?.error === "not authenticated" ? "expired" : "ok";
  }
  if (res.status >= 500 && (res.headers.get("content-type") ?? "").includes("text/html")) return "edge";
  return "ok";
}

export function friendlyBffResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ message, error: message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
