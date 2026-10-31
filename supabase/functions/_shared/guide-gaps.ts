/**
 * MF-015: a written Lot is refused when its marking guide expects the student to use a fact the task
 * text never gives (a long task cut short lost exactly these). A plain number match could not tell given
 * data from the guide's own answer ("24 years"), so one small AI call reads the task and the guide
 * together. Any failure answers [] so a Lot is never blocked by this check alone.
 */
import { generateText } from "./llm.ts";

export function guideGapPrompt(taskText: string, criteria: { name?: unknown; description?: unknown }[]): string {
  const guide = criteria.map((c, i) => `${i + 1}. ${String(c?.name ?? "")}: ${String(c?.description ?? "")}`).join("\n");
  return `A student sees ONLY the TASK below. The MARKING GUIDE is hidden from them.

List a fact ONLY when a student would be STUCK without it: the guide gives marks for using specific given data (a number, price, date, name, list, rule, required output wording or table value) and the task never provides that data, so even a strong student could not earn those marks.
Read the whole task first: anything the task states anywhere, in any words, is NOT missing.
Do NOT list:
- answers, results or conclusions the student is meant to work out (for example a total they must calculate);
- general knowledge a student of this subject should know (for example the faces of a die);
- choices the student is free to make, or details they can reasonably invent;
- example values the guide gives as "e.g.".
When unsure, do not list it.

TASK:
${taskText.slice(0, 4000)}

MARKING GUIDE:
${guide.slice(0, 3000)}

Reply with JSON only: {"missing": ["short description of each missing fact"]}. Use an empty array when the task gives everything.`;
}

/** The model's reply as a list of missing facts; anything unreadable counts as none. */
export function parseGuideGaps(text: string): string[] {
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    const list = Array.isArray(parsed?.missing) ? parsed.missing : [];
    return list.filter((x: unknown) => typeof x === "string" && x.trim()).map((x: string) => x.trim().slice(0, 200)).slice(0, 5);
  } catch {
    return [];
  }
}

export async function guideGaps(
  taskText: string,
  criteria: { name?: unknown; description?: unknown }[],
  feature: string,
  usageCtx: { userId?: string | null; studentId?: string | null },
): Promise<string[]> {
  try {
    const { text } = await generateText(guideGapPrompt(taskText, criteria),
      { temperature: 0, maxOutputTokens: 300, json: true }, { feature: `${feature}:guide-gaps`, ...usageCtx });
    return parseGuideGaps(text);
  } catch (e) {
    console.warn(`guide-gaps check skipped (${feature}): ${(e as Error).message}`);
    return [];
  }
}
