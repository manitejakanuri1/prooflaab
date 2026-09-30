/**
 * The optional "try your code" box on a written Lot (migration 48:
 * task_rubric_config.scratch_language). Decided from the Lot writer's OWN
 * structured reply (its scratch_language field, same AI call as the rest of
 * the Lot), never from words in the title or scenario.
 */

export const SCRATCH_LANGUAGES = new Set(["python", "javascript", "java", "c", "cpp", "go", "ruby", "php"]);

type Db = { from: (table: string) => any };

/** The language to store, or null. Only a written (rubric) technical Lot, only an allowlisted value. */
export function scratchLanguageFor(
  mode: "sandbox" | "rubric",
  lotCategory: string,
  value: unknown,
): string | null {
  if (mode !== "rubric" || lotCategory !== "technical") return null;
  return typeof value === "string" && SCRATCH_LANGUAGES.has(value) ? value : null;
}

/**
 * Put the language on the Lot's rubric config and return the config id the Lot
 * should use. A Lot on its own config: that row gets the language. A Lot on the
 * shared generic fallback (used by unrelated tasks, never given a language): a
 * dedicated copy of it is made first, identical checklist, with the language.
 * Any failure keeps the original config (no scratchpad) rather than failing the Lot.
 */
export async function applyScratchLanguage(db: Db, configId: string | null, language: string | null): Promise<string | null> {
  if (!configId || !language) return configId;
  const { data: cfg, error } = await db.from("task_rubric_config")
    .select("id, prompt_text, criteria, min_words, max_words, pass_threshold, reference_answer, created_by, is_generic_fallback")
    .eq("id", configId).maybeSingle();
  if (error || !cfg) {
    console.error("applyScratchLanguage: config not read:", error?.message ?? "missing");
    return configId;
  }
  if (!cfg.is_generic_fallback) {
    const { error: upd } = await db.from("task_rubric_config")
      .update({ scratch_language: language }).eq("id", configId).eq("is_generic_fallback", false);
    if (upd) console.error("applyScratchLanguage: update failed:", upd.message);
    return configId;
  }
  const { data: copy, error: ins } = await db.from("task_rubric_config").insert({
    prompt_text: cfg.prompt_text,
    criteria: cfg.criteria,
    min_words: cfg.min_words,
    max_words: cfg.max_words,
    pass_threshold: cfg.pass_threshold,
    reference_answer: cfg.reference_answer,
    created_by: cfg.created_by ?? null,
    origin: "auto_fallback",
    is_generic_fallback: false,
    scratch_language: language,
  }).select("id").single();
  if (ins || !copy) {
    console.error("applyScratchLanguage: dedicated copy failed:", ins?.message ?? "missing");
    return configId;
  }
  return copy.id as string;
}
