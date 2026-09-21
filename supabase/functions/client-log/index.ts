import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard } from "../_shared/rate-limit.ts";
import { cors, corsHeaders as corsStatic } from "../_shared/cors.ts";
import { scrub } from "../_shared/log.ts";

/**
 * Receives the student's step trail from the browser: pages opened, buttons pressed, server calls and their
 * result, screen errors. Stored in app_events (kept 90 days), read only by admins.
 *
 * Privacy: only the step and its result. Every text field is cut short and scrubbed (emails, tokens, keys).
 * The browser never sends what the student typed, and this function stores nothing of the request body except
 * the fields below. Only students are recorded; anyone else gets a quiet 204.
 */

const KINDS = new Set(["page", "click", "call", "error"]);
const MAX_EVENTS = 50;

const reply = (status: number, body?: unknown, headers: Record<string, string> = corsStatic) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

const text = (v: unknown, n: number) => (typeof v === "string" && v ? scrub(v, n) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(600000, Math.round(v))) : null);
const id = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "POST only" }, corsHeaders);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return reply(401, { error: "Missing authorization" }, corsHeaders);
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    const callerId = claims?.claims?.sub as string | undefined;
    if (!callerId) return reply(401, { error: "Unauthorized" }, corsHeaders);

    // A busy student sends a batch every few seconds; this cap is far above that and stops a runaway loop.
    const limited = await guard(req, { bucket: "client-log", limit: 600, windowSeconds: 60, userId: callerId, corsHeaders });
    if (limited) return limited;

    const body = await req.json().catch(() => ({}));
    const list = Array.isArray(body?.events) ? body.events.slice(0, MAX_EVENTS) : [];
    if (list.length === 0) return reply(204, undefined, corsHeaders);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profile } = await db.from("student_profiles").select("id").eq("user_id", callerId).maybeSingle();
    if (!profile) return reply(204, undefined, corsHeaders);     // only students are recorded

    const now = Date.now();
    const rows = list
      .filter((e: any) => e && KINDS.has(e.kind))
      .map((e: any) => {
        const at = typeof e.ts === "number" && e.ts > now - 3600_000 && e.ts <= now + 60_000 ? new Date(e.ts).toISOString() : new Date(now).toISOString();
        const message = text(e.detail?.message, 200);
        const http = num(e.detail?.http);
        return {
          created_at: at,
          student_id: profile.id,
          session_id: id(e.session_id),
          request_id: id(e.request_id),
          kind: e.kind,
          screen: text(e.screen, 120),
          action: text(e.action, 80),
          target: text(e.target, 80),
          status: e.status === "ok" ? "ok" : e.status ? "error" : null,
          duration_ms: num(e.duration_ms),
          detail: message || http !== null ? { ...(message ? { message } : {}), ...(http !== null ? { http } : {}) } : null,
          app_version: text(e.app_version, 20),
        };
      });
    if (rows.length === 0) return reply(204, undefined, corsHeaders);

    const { error } = await db.from("app_events").insert(rows);
    if (error) console.error("client-log: insert failed:", error.message);
    return reply(204, undefined, corsHeaders);
  } catch (err) {
    console.error("client-log failed:", err);
    return reply(204, undefined, corsHeaders);    // the trail must never break the student's screen
  }
});
