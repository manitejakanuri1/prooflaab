// MF-060 / MF-097: one wording for a squad match on the student and college Matches tabs.
// settle_round (migration 163) saves status ('scheduled' | 'played' | 'no_activity') and decided_by
// ('score' | 'draw' | 'no_activity' | 'higher_seed'). A drawn semi-final or final goes to the higher seed.
export interface MatchResultLike {
  status: string;
  decided_by?: string | null;
  home_points: number | null;
  away_points: number | null;
}

export const SEED_WIN = "won as higher seed";

export function matchStatus(m: MatchResultLike): string {
  if (m.decided_by === "higher_seed") return "Decided on seed";
  if (m.status === "played") return "Played";
  if (m.status === "no_activity") return "No activity";
  if (m.status === "scheduled") return "Scheduled";
  return m.status.charAt(0).toUpperCase() + m.status.slice(1);
}

/** The week points of each side ("21–0"), or "–" while the match has no result. */
export function matchScore(m: MatchResultLike): string {
  const settled = m.status === "played" || m.decided_by === "higher_seed";
  return settled && m.home_points != null && m.away_points != null ? `${m.home_points}–${m.away_points}` : "–";
}
