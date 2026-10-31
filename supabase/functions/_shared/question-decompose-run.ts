import { generateText } from "./llm.ts";
import { rateLimitResponse } from "./rate-limit.ts";
import { buildPrompt, MIN_PAGE_CHARS, parseQuestions } from "./question-decompose.ts";

/**
 * Cuts pages into bank questions (one AI call per page) and stores them with question_bank_add. Shared by the
 * question-decompose function (crawler, admin) and scheduled-job pregenerate-lots (college and admin material,
 * so it does not wait for Sunday's crawl). Never stores a guess: an AI failure or unreadable reply stores
 * nothing for that page, and the page is tried again next time.
 */
// deno-lint-ignore no-explicit-any
export async function decomposePages(db: any, ids: string[], opts: { service: boolean; adminId: string | null }) {
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
        { temperature: 0.3, maxOutputTokens: 3000, skipRateLimit: opts.service },
        { feature: "question-decompose", userId: opts.adminId },
      );
      text = out.text;
      model = `${out.provider}/${out.model}`;
    } catch (e) {
      // The AI provider is rate-limiting: stop here, the caller answers 429 and the rest waits for next time.
      if (rateLimitResponse(e, {})) return { results, stored, skipped, limited: e };
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

  return { results, stored, skipped, limited: null as unknown };
}
