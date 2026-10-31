import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { guard, rateLimitResponse } from "../_shared/rate-limit.ts";
import { schedulerCaller } from "../_shared/googleIdentity.ts";
import { cors } from "../_shared/cors.ts";
import { decomposePages } from "../_shared/question-decompose-run.ts";

/**
 * Cuts crawled pages into small, tagged practice questions and files them in the question bank (migration 147).
 *
 * Questions go live straight away (migration 200, owner 31 Oct 2026): each one becomes its own page, the Lot
 * writer turns it into a checked Daily Lot, and from week 2 the picker prefers these bank Lots. An admin can
 * hide a question (Admin > Work > Question bank).
 *
 * Who may call it: the crawler or Cloud Scheduler (Google identity or the webhook secret), a signed-in admin, or a
 * college for its own material it just submitted (one page, once).
 *   POST {}                              -> the next pages nobody has tried yet (limit 1-5, default 3)
 *   POST {"limit": 5}
 *   POST {"limit": 5, "since": "<ISO time>"}  -> only pages fetched from that time (the crawler's own run)
 *   POST {"source_content_id": "<id>"}   -> one specific page, even if it was tried before (admin re-run)
 *
 * It never stores a guess: an AI failure or an unreadable reply stores nothing, and the page is tried again on
 * the next run. A page the AI honestly returns no questions for is recorded as tried, so it is not paid for twice.
 * The skill tag is not chosen here or by the AI: the database tags each question from the fixed skill list.
 */

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const corsHeaders = cors(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const db = createClient(url, serviceKey);

    // 1. Who is calling: a service caller (crawler, scheduler) or an admin.
    let adminId: string | null = null;
    const service = await schedulerCaller(req);
    if (!service) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
      const authClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: claims, error: claimsError } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
      if (claimsError || !claims?.claims?.sub) return json({ error: "Unauthorized" }, 401);
      adminId = claims.claims.sub as string;
      const { data: roles } = await db.from("user_roles").select("role").eq("user_id", adminId);
      if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) {
        // A college may ask for its OWN just-submitted material, once (owner 31 Oct 2026: no waiting, no approval).
        const peek = await req.clone().json().catch(() => ({}));
        const pageId = typeof peek?.source_content_id === "string" && UUID.test(peek.source_content_id) ? peek.source_content_id : null;
        const { data: college } = await db.from("colleges").select("id").eq("user_id", adminId).maybeSingle();
        const { data: own } = pageId && college
          ? await db.from("source_content").select("id").eq("id", pageId).eq("submitted_by_college_id", college.id).maybeSingle()
          : { data: null };
        const { data: tried } = own
          ? await db.from("question_bank_attempts").select("source_content_id").eq("source_content_id", pageId).maybeSingle()
          : { data: null };
        if (!own || tried) return json({ error: "Forbidden" }, 403);
      }
    }

    // 2. Spam cap. The crawler shares one address, so its allowance is larger.
    const limited = await guard(req, {
      bucket: "question-decompose", limit: service ? 120 : 30, windowSeconds: 3600, userId: adminId, corsHeaders,
    });
    if (limited) return limited;

    // 3. Which pages
    const body = await req.json().catch(() => ({}));
    let ids: string[];
    if (body?.source_content_id !== undefined) {
      if (typeof body.source_content_id !== "string" || !UUID.test(body.source_content_id)) {
        return json({ error: "source_content_id must be a page id" }, 400);
      }
      ids = [body.source_content_id];
    } else {
      const limit = Number.isInteger(body?.limit) ? Math.min(MAX_LIMIT, Math.max(1, body.limit)) : DEFAULT_LIMIT;
      const since = typeof body?.since === "string" && !Number.isNaN(Date.parse(body.since)) ? body.since : null;
      const { data, error } = await db.rpc("question_bank_pending", { _limit: limit, _since: since });
      if (error) {
        console.error("question-decompose: could not list pending pages:", error.message);
        return json({ error: "Could not list pages" }, 500);
      }
      ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    }

    // 4. One page at a time: each is one AI call, and a page that fails must not stop the others.
    const out = await decomposePages(db, ids, { service: Boolean(service), adminId });
    if (out.limited) {
      const limitedByAi = rateLimitResponse(out.limited, corsHeaders);
      if (limitedByAi) return limitedByAi;
    }
    const { results, stored, skipped } = out;

    console.log(`question-decompose: ${ids.length} page(s), ${stored} stored, ${skipped} skipped`);
    return json({ ok: true, pages: ids.length, stored, skipped, results });
  } catch (e) {
    console.error("question-decompose error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
