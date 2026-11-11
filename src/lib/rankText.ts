/** Retest 11 Nov 2026: a rank of 0 or none is "Not ranked yet", never "#0" or "0/11". */
export function rankText(rank: number | null | undefined, outOf?: number | null): string {
  if (!rank) return "Not ranked yet";
  return outOf ? `${rank}/${outOf}` : `#${rank}`;
}

/** The squad page's next match: hidden in a rest week (the "Rest round" line shows instead). */
export function showNextMatch(next: unknown, restWeek: boolean): boolean {
  return !!next && !restWeek;
}

