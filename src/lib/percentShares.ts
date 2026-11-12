/**
 * Whole-number percentages that always add up to exactly 100.
 * Rounding each share on its own gave 24 + 24 + 35 + 18 = 101% on the Readiness tab.
 * Each share is rounded, then the leftover point goes to the share whose rounding was furthest off;
 * equal weights move together, so two parts that count the same never show different numbers
 * (unless nothing else can take the point). A null weight is "not assessed": no share.
 */
export function percentShares(weights: (number | null)[]): (number | null)[] {
  const sum = weights.reduce<number>((a, w) => a + (w ?? 0), 0);
  if (sum <= 0) return weights.map(() => null);
  const raw = weights.map((w) => (w == null ? null : (w / sum) * 100));
  const out = raw.map((r) => (r == null ? null : Math.round(r)));
  let diff = 100 - out.reduce<number>((a, v) => a + (v ?? 0), 0);
  const step = Math.sign(diff);
  // Groups of equal weight, the one whose rounding helps most first.
  const groups = [...new Set(weights.filter((w): w is number => w != null))]
    .map((w) => weights.flatMap((x, i) => (x === w ? [i] : [])))
    .sort((a, b) => step * ((raw[b[0]]! - out[b[0]]!) - (raw[a[0]]! - out[a[0]]!)));
  for (const pass of [true, false]) {           // pass 1 keeps ties together, pass 2 does not
    for (const g of groups) {
      for (const idxs of pass ? [g] : g.map((i) => [i])) {
        if (diff !== 0 && Math.abs(diff) >= idxs.length) { idxs.forEach((i) => { out[i]! += step; }); diff -= step * idxs.length; }
      }
    }
  }
  return out;
}
