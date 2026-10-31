/**
 * MF-128 (owner 31 Oct 2026): a Lot whose code or answer passed keeps "Passed", but when the spoken
 * explanation or "matches your work" is low the student gets one kind, specific note: what went wrong
 * and how to do better next time. Uses only the stored scores; null when nothing needs saying.
 */
export const LOW_SCORE = 50;

export function passedNote(voice: number | null | undefined, match: number | null | undefined): string | null {
  const lowVoice = voice != null && voice < LOW_SCORE;
  const lowMatch = match != null && match < LOW_SCORE;
  if (!lowVoice && !lowMatch) return null;
  const parts = ["Your work passed - well done."];
  if (lowMatch) {
    parts.push(`Your explanation did not match the work you submitted (${match}/100).`,
      "Next time, talk about your own work: what it takes in, what each part does, and what it gives back.");
  }
  if (lowVoice) {
    parts.push(`Your spoken explanation scored ${voice}/100.`,
      "Speak for the full 60 seconds in clear, full sentences: say what the task asked, how you solved it, and one case you checked.");
  }
  parts.push("You are close - one clear explanation lifts this score.");
  return parts.join(" ");
}
