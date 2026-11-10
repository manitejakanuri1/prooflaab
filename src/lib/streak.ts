// QA week 8 retest: the stored streak is only rewritten when a Lot is finished, so a run broken by a missed
// day kept showing (e.g. "3 days") until the next Lot, then fell to 1. Show what the server will count:
// the run is alive only if the last counted day is today or the previous Lot day (Saturday before a Monday).
export function liveStreak(days: number, lastCounted: string | null, today: string): number {
  if (!lastCounted || days <= 0) return 0;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);   // Sunday is the rest day
  return lastCounted >= d.toISOString().slice(0, 10) ? days : 0;
}
