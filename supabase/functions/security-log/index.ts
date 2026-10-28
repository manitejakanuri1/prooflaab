import { serve } from "../_shared/serve.ts";

/**
 * Closed (MF-007, 28 Oct 2026). This used to take "login failed" and similar records from browsers. Anyone on the
 * internet could post one straight to the functions address and it showed on the admin Security page, while real
 * failures from the sign-in page never arrived (the website refuses signed-out function calls).
 * The login server (web-bff) now writes every sign-in event itself (migration 156). Nothing is accepted here.
 * Kept as a stub until the owner agrees to delete it.
 */
serve(() =>
  new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  })
);
