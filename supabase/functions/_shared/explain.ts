import { generateText } from "./llm.ts";

/**
 * The simple version of a task's question (owner's rule, 19 Sep 2026): the
 * same question told in child-simple words. One row per distinct title +
 * description in task_explainers, shared by every student on that task.
 * Used by task-explain (on open) and lot-writer (the moment a Lot is written).
 */

export async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Keep only the shape the screen draws; anything else from the model is dropped. */
export function clean(raw: any) {
  const brief = {
    in_one_line: str(raw?.in_one_line, 200),
    what_it_means: str(raw?.what_it_means, 700),
    steps: (Array.isArray(raw?.steps) ? raw.steps : []).map((s: unknown) => str(s, 300)).filter(Boolean).slice(0, 7),
    example: str(raw?.example, 700) || null,
    words: (Array.isArray(raw?.words) ? raw.words : [])
      .map((w: any) => ({ word: str(w?.word, 40), meaning: str(w?.meaning, 200) }))
      .filter((w: { word: string; meaning: string }) => w.word && w.meaning).slice(0, 5),
    done_when: str(raw?.done_when, 300),
  };
  if (!brief.in_one_line || !brief.what_it_means || brief.steps.length < 2 || !brief.done_when) return null;
  return brief;
}

export const prompt = (title: string, description: string, code: string | null, coding: boolean) => `
You explain a work task to an Indian engineering student who finds English and coding hard.
Explain it the way you would to a 12-year-old: short sentences, everyday words, no jargon without explaining it.
Do NOT solve the task and do NOT give the answer or the code. Only make the QUESTION crystal clear.

Task title: ${title}
Task: ${description}
${code ? `Code that comes with the task:\n${code.slice(0, 1500)}\n` : ""}${coding ? "This is a coding task, solved in the code editor inside the app.\n" : "This is a written task: the student types an answer inside the app.\n"}
Return JSON only:
{"in_one_line":"what you must do, in one simple sentence",
 "what_it_means":"2 to 4 short sentences: the situation and what is being asked, in simple words",
 "steps":["3 to 6 small steps, each one short action starting with a verb"],
 "example":"a tiny made-up example that shows what kind of thing is asked (not the answer), or null",
 "words":[{"word":"a hard word from the task","meaning":"its meaning in simple words"}],
 "done_when":"one sentence: how the student knows they have finished"}`.trim();


export type TaskText = { title: string | null; description: string | null; code_sample: string | null; sandbox_config_id: string | null };

/** Stored brief for this text, or a newly written one; null if the model fails twice. */
// deno-lint-ignore no-explicit-any
export async function explainTask(db: any, task: TaskText, userId: string | null) {
  const title = String(task.title ?? "").trim();
  const description = String(task.description ?? "").trim();
  if (description.length < 20) return { brief: null, cached: false };

  const key = await sha256(`${title}\n${description}`);
  const { data: saved } = await db.from("task_explainers").select("brief").eq("key", key).maybeSingle();
  if (saved) return { brief: saved.brief, cached: true };

  // Two tries: a reply that is not valid JSON, or misses a part, is asked again once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await generateText(
      prompt(title, description, task.code_sample ?? null, Boolean(task.sandbox_config_id)),
      { temperature: 0.4, maxOutputTokens: 1500 },
      { feature: "task-explain", userId },
    );
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(out.text.replace(/```json|```/g, "").replace(/,\s*([}\]])/g, "$1"));
    } catch { /* try again */ }
    const brief = clean(parsed);
    if (brief) {
      await db.from("task_explainers").upsert({ key, brief }, { onConflict: "key" });
      return { brief, cached: false };
    }
  }
  return { brief: null, cached: false };
}
