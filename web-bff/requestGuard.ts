const SAFE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

export function rejectCrossSiteBrowserWrite(
  req: Request,
): Response | null {
  if (SAFE_METHODS.has(req.method)) {
    return null;
  }

  const url = new URL(req.url);

  /*
   * Sec-Fetch-Site is set by modern browsers and cannot be set freely by
   * page JavaScript. Reject both cross-site and same-site-but-cross-origin
   * writes: a sibling subdomain must not be able to drive a cookie-authenticated
   * ProofLab request.
   *
   * Missing Sec-Fetch-Site is allowed for trusted non-browser tooling/tests.
   */
  const fetchSite = req.headers
    .get("Sec-Fetch-Site")
    ?.toLowerCase();

  if (
    fetchSite === "cross-site" ||
    fetchSite === "same-site"
  ) {
    return denied();
  }

  /*
   * Browsers normally send Origin on state-changing fetches.
   * If it exists, require exact origin equality.
   */
  const origin = req.headers.get("Origin");

  if (origin) {
    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      return denied();
    }

    if (parsed.origin !== url.origin) {
      return denied();
    }
  }

  return null;
}

function denied(): Response {
  return new Response(
    JSON.stringify({
      error: "cross-origin request refused",
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
      },
    },
  );
}
