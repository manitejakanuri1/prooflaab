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
