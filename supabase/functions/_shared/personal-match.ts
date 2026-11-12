// Owner 12 Nov 2026: how many brand-new AI personal tasks one college (or admin) may create in 7 days.
export const PERSONAL_AI_PER_WEEK = 30;

type Profile = { branch?: string | null; year_of_study?: string | null; key_interests?: unknown; preferred_skills?: unknown } | null | undefined;

const words = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

/** Similarity of a student to the student a saved task was written for: 2 per shared skill/interest, 1 for the same
 * branch. When either has no skills or interests filled in, the same branch and the same year count 1 each instead. */
export function personalMatch(student: Profile, writtenFor: Profile): number {
  if (!student || !writtenFor) return 0;
  const a = new Set([...words(student.key_interests), ...words(student.preferred_skills)]);
  const b = new Set([...words(writtenFor.key_interests), ...words(writtenFor.preferred_skills)]);
  const same = (k: "branch" | "year_of_study") => {
    const x = String(student[k] ?? "").trim().toLowerCase();
    return x !== "" && x === String(writtenFor[k] ?? "").trim().toLowerCase() ? 1 : 0;
  };
  if (a.size === 0 || b.size === 0) return same("branch") + same("year_of_study");
  let score = same("branch");
  for (const w of a) if (b.has(w)) score += 2;
  return score;
}
