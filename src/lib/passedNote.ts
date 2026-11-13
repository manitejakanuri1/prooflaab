/**
 * Owner decision 1 Nov 2026 (replaces the 31 Oct MF-128 rule that kept "Passed" whatever the voice):
 * the green "Passed" shows only when the work passed AND the spoken explanation scored LOW_SCORE (50)
 * or more. Otherwise the badge reads "Code passed · voice needs redo" ("Answer passed · ..." for a
 * written task). A missing voice score counts as not 50+. passedNote() still gives the kind, specific
 * note on what went wrong and how to do better. Uses only the stored scores.
 */
export const LOW_SCORE = 50;

// Polish pass C1: there is no voice redo, so the label says what it is: a low voice score (under 5/10).
export function passedLabel(kind: string | null | undefined, voice: number | null | undefined): string {
  if (voice != null && voice >= LOW_SCORE) return "Passed";
  return `${kind === "written" ? "Answer" : "Code"} passed · ${voice == null ? "no voice yet" : "low voice score"}`;
}

export function passedNote(voice: number | null | undefined, match: number | null | undefined): string | null {
  const lowVoice = voice != null && voice < LOW_SCORE;
  const lowMatch = match != null && match < LOW_SCORE;
  if (!lowVoice && !lowMatch) return null;
  const parts = ["Your work passed - well done."];
  if (lowMatch) {
    parts.push(`Talk check: ${match < 30 ? "not matched" : "partly matched"} - your explanation did not fully match the work you submitted.`,
      "Next time, talk about your own work: what it takes in, what each part does, and what it gives back.");
  }
  if (lowVoice) {
    parts.push(`Your voice scored ${Math.round(voice) / 10}/10.`,
      "Low voice score. Next time talk about what you tried and changed.");
  }
  parts.push("You are close - one clear explanation lifts this score.");
  return parts.join(" ");
}
