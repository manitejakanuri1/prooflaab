// Progress page (QA retest round 2): the newest season's finished weeks, the latest 8 by week number,
// shown week 1 -> 12. Rows from older seasons are left out, so week numbers never mix.
export interface WeekRow { season_id: string; week: number; points: number; computed_at: string }

export function latestWeeks(rows: WeekRow[], n = 8): { week: number; points: number }[] {
  if (!rows.length) return [];
  const newest = rows.reduce((a, b) => (b.computed_at > a.computed_at ? b : a)).season_id;
  return rows.filter((r) => r.season_id === newest)
    .sort((a, b) => a.week - b.week)
    .slice(-n)
    .map((r) => ({ week: r.week, points: r.points }));
}

// "Last week" = the highest finished week; the change line compares it with the week before it.
export function weekChangeText(weeks: { week: number; points: number }[]): string {
  if (weeks.length < 2) return "No earlier week";
  const last = weeks[weeks.length - 1].points, before = weeks[weeks.length - 2].points;
  if (before === 0) return last > 0 ? "up from a quiet week" : "same as the week before";
  return `${last >= before ? "+" : ""}${Math.round(((last - before) / before) * 100)}% vs the week before`;
}
