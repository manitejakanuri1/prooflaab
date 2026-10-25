import { serve } from "../_shared/serve.ts";
import { createClient } from "../_shared/backend.ts";
import { generateText } from "../_shared/llm.ts";
import { guard, rateLimitResponse } from "../_shared/rate-limit.ts";
import { schedulerCaller } from "../_shared/googleIdentity.ts";
import { cors } from "../_shared/cors.ts";
import { buildPrompt, MIN_PAGE_CHARS, parseQuestions } from "../_shared/question-decompose.ts";

/**
 * Cuts crawled pages into small, tagged practice questions and files them in the question bank (migration 147).
 *
 * Step one only: the questions wait as 'draft' until an admin approves them (Admin > Work > Question bank).
 * Nothing here changes how a student's Lot is chosen.
 *
 * Who may call it: the crawler or Cloud Scheduler (Google identity or the webhook secret), or a signed-in admin.
 *   POST {}                              -> the next pages nobody has tried yet (limit 1-5, default 3)
 *   POST {"limit": 5}
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
      if (!(roles ?? []).some((r: { role: string }) => r.role === "admin")) return json({ error: "Forbidden" }, 403);
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
      const { data, error } = await db.rpc("question_bank_pending", { _limit: limit });
      if (error) {
        console.error("question-decompose: could not list pending pages:", error.message);
        return json({ error: "Could not list pages" }, 500);
      }
      ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
    }

    // 4. One page at a time: each is one AI call, and a page that fails must not stop the others.
    const results: Record<string, unknown>[] = [];
    let stored = 0;
    let skipped = 0;
    for (const id of ids) {
      const { data: page } = await db.from("source_content")
        .select("id, title, markdown, hidden_at").eq("id", id).maybeSingle();
      if (!page) { results.push({ id, error: "page not found" }); continue; }
      if (page.hidden_at || (page.markdown ?? "").length < MIN_PAGE_CHARS) {
        results.push({ id, skipped: "page is hidden or too short" });
        continue;
      }

      let text: string;
      let model = "";
      try {
        const out = await generateText(
          buildPrompt(page.title, page.markdown),
          { temperature: 0.3, maxOutputTokens: 3000, skipRateLimit: Boolean(service) },
          { feature: "question-decompose", userId: adminId },
        );
        text = out.text;
        model = `${out.provider}/${out.model}`;
      } catch (e) {
        const limitedByAi = rateLimitResponse(e, corsHeaders);
        if (limitedByAi) return limitedByAi;
        console.error(`question-decompose: AI failed for ${id}:`, e);
        results.push({ id, error: "the AI could not be reached; nothing stored" });
        continue;
      }

      const parsed = parseQuestions(text);
      if (!parsed.ok) {
        console.error(`question-decompose: unreadable reply for ${id}: ${text.slice(0, 200)}`);
        results.push({ id, error: "the AI reply could not be read; nothing stored" });
        continue;
      }

      const { data: added, error: addError } = await db.rpc("question_bank_add", {
        _source_content_id: id,
        _items: parsed.items,
        _provenance: { by: "question-decompose", model, rejected_before_save: parsed.rejected.length },
      });
      if (addError) {
        console.error(`question-decompose: could not save for ${id}:`, addError.message);
        results.push({ id, error: "could not save the questions" });
        continue;
      }
      const r = (added ?? {}) as { stored?: number; skipped?: number };
      stored += r.stored ?? 0;
      skipped += (r.skipped ?? 0) + parsed.rejected.length;
      results.push({ id, stored: r.stored ?? 0, skipped: (r.skipped ?? 0) + parsed.rejected.length, model });
    }

    console.log(`question-decompose: ${ids.length} page(s), ${stored} stored, ${skipped} skipped`);
    return json({ ok: true, pages: ids.length, stored, skipped, results });
  } catch (e) {
    console.error("question-decompose error:", e);
    return json({ error: "Internal server error" }, 500);
  }
});
