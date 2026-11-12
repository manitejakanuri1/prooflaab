/** Retest 11 Nov 2026: a rank of 0 or none is "Not ranked yet", never "#0" or "0/11". */
export function rankText(rank: number | null | undefined, outOf?: number | null): string {
  if (!rank) return "Not ranked yet";
  return outOf ? `${rank}/${outOf}` : `#${rank}`;
}

/** The squad page's next match: hidden in a rest week (the "Rest round" line shows instead). */
export function showNextMatch(next: unknown, restWeek: boolean): boolean {
  return !!next && !restWeek;
}


/**
 * Owner E2E 12 Nov R1: "Next match" showed a time already gone. The next match is the soonest scheduled
 * one still ahead. A scheduled match whose time has passed is waiting for its week to be scored: it is
 * returned as `waiting`, never as next.
 */
export function pickNextMatch<M extends { status: string; scheduled_at: string }>(
  matches: M[], now: Date = new Date(),
): { next: M | null; waiting: M | null } {
  const sched = matches.filter((m) => m.status === "scheduled")
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at));
  return {
    next: sched.find((m) => Date.parse(m.scheduled_at) > now.getTime()) ?? null,
    waiting: [...sched].reverse().find((m) => Date.parse(m.scheduled_at) <= now.getTime()) ?? null,
  };
}

/**
 * Owner E2E 12 Nov R2: the words for a seeded squad follow generate_section_knockout / generate_section_finals
 * (migrations 184, 210) exactly: 4+ seeded -> semi-finals 1v4, 2v3; 3 -> seed 1 waits in the final, 2v3 semi;
 * 2 -> final. No league points in the whole section (no league match played) -> no final, no champion.
 * `section` = every squad of this season in the same bracket. Null when the squad has no seed/bracket.
 */
export function seedLine(
  squad: { seed: number | null; bracket?: string | null },
  section: { seed: number | null; points: number }[],
): { long: string; short: string } | null {
  const { seed, bracket } = squad;
  if (!seed || !bracket) return null;
  if (!section.some((s) => s.points > 0)) {
    return {
      long: `Seed ${seed} in ${bracket}, but no league match was played in this section, so there is no final or champion this season.`,
      short: `Seed ${seed} · no final (no league points)`,
    };
  }
  const n = section.filter((s) => s.seed != null).length;
  if (n === 3 && seed === 1) return { long: "Bye to the final as seed 1.", short: "Bye to final · seed 1" };
  if (n >= 3) return { long: `Through to the semi-final as seed ${seed}.`, short: `Semi-final · seed ${seed}` };
  if (n === 2) return { long: `Through to the final as seed ${seed}.`, short: `Final · seed ${seed}` };
  return { long: `Seed ${seed} in ${bracket}: one squad, so no knockout.`, short: `Seed ${seed} · no knockout` };
}

/**
 * Owner E2E 12 Nov R4: on TEST a whole 12-week season fits in one day, so every fixture read "12 Nov".
 * When matches of different weeks fall on the same day, the time is added; on REAL (7-day weeks) the
 * date alone stays. `fast` = the TEST fast-week build flag.
 */
export function whenFormatFor(ms: { scheduled_at: string; round_number?: number | null }[], fast = false): string {
  if (fast) return "d MMM, h:mm a";
  const weekOn = new Map<string, number | null | undefined>();
  for (const m of ms) {
    const day = new Date(m.scheduled_at).toDateString();
    if (weekOn.has(day) && weekOn.get(day) !== m.round_number) return "d MMM, h:mm a";
    weekOn.set(day, m.round_number);
  }
  return "d MMM";
}
